import 'server-only';
import type { Booking, ClassInstance, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan, assertSelfOrStaff, atLeast } from '@/lib/permissions';
import { conflict, notFound } from '@/lib/errors';
import { formatDeadline, formatDateTime } from '@/lib/time';
import { evaluateCancellation, type CancellationOutcome } from '@/lib/domain/cancellation';
import { getStrikeState, recordStrike, removeStrike } from '@/lib/services/strikes';
import { getMembershipState } from '@/lib/services/membership';
import { explainCannotBook } from '@/lib/domain/membership';
import type { StrikeState } from '@/lib/domain/strikes';

type Tx = Prisma.TransactionClient;

/**
 * Take an exclusive lock on the class row.
 *
 * Every mutation that can change who holds a spot in a class goes through this
 * first, which makes the class row the mutex for that class. Two members
 * cancelling at the same instant serialise here, so each promotion sees the
 * other's result: two different people come off the waitlist, capacity is
 * never exceeded, and nobody is promoted twice.
 *
 * At ten classes a day this costs nothing, and it is far easier to reason
 * about than optimistic retries or a job queue.
 */
async function lockClass(tx: Tx, classInstanceId: string): Promise<ClassInstance> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "ClassInstance" WHERE id = ${classInstanceId} FOR UPDATE
  `;
  if (locked.length === 0) throw notFound('That class no longer exists.');

  const instance = await tx.classInstance.findUnique({ where: { id: classInstanceId } });
  if (!instance) throw notFound('That class no longer exists.');
  return instance;
}

export interface BookResult {
  booking: Booking;
  waitlisted: boolean;
  /** 1-based position when waitlisted. */
  waitlistPosition: number | null;
}

export async function bookClass(
  actor: SessionUser,
  input: { classInstanceId: string; memberId?: string; source?: 'SELF' | 'COACH' | 'WALK_IN' },
  now: Date = new Date(),
): Promise<BookResult> {
  const memberId = input.memberId ?? actor.id;
  const bookingForSomeoneElse = memberId !== actor.id;
  if (bookingForSomeoneElse) assertCan(actor, 'markAttendance');

  // Both of these are only checked for self-service bookings: a coach putting
  // someone in by hand is a deliberate override.
  if (!bookingForSomeoneElse) {
    // Membership first — needing to pay is a different problem from being
    // suspended, and the member should be told the one that actually applies.
    const membership = await getMembershipState(memberId, now);
    if (!membership.canBook) {
      throw conflict(explainCannotBook(membership), 'MEMBERSHIP_REQUIRED');
    }

    const state = await getStrikeState(memberId, now);
    if (state.suspended && state.suspendedUntil) {
      throw conflict(
        `Your bookings are paused until ${formatDateTime(state.suspendedUntil)}.`,
        'SUSPENDED',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const instance = await lockClass(tx, input.classInstanceId);

    if (instance.status === 'CANCELLED') {
      throw conflict('That class has been cancelled.', 'CLASS_CANCELLED');
    }
    if (instance.startsAt <= now) {
      throw conflict('That class has already started.', 'CLASS_STARTED');
    }

    const existing = await tx.booking.findFirst({
      where: { classInstanceId: instance.id, memberId, status: { not: 'CANCELLED' } },
    });
    if (existing) {
      throw conflict(
        existing.status === 'WAITLISTED'
          ? 'You are already on the waitlist for that class.'
          : 'You are already booked into that class.',
        'ALREADY_BOOKED',
      );
    }

    const bookedCount = await tx.booking.count({
      where: { classInstanceId: instance.id, status: 'BOOKED' },
    });
    const full = bookedCount >= instance.capacity;

    const booking = await tx.booking.create({
      data: {
        classInstanceId: instance.id,
        memberId,
        status: full ? 'WAITLISTED' : 'BOOKED',
        source: input.source ?? (bookingForSomeoneElse ? 'COACH' : 'SELF'),
        bookedAt: now,
        waitlistedAt: full ? now : null,
      },
    });

    const waitlistPosition = full
      ? await tx.booking.count({
          where: {
            classInstanceId: instance.id,
            status: 'WAITLISTED',
            waitlistedAt: { lte: now },
          },
        })
      : null;

    return { booking, waitlisted: full, waitlistPosition };
  });
}

export interface CancelResult {
  booking: Booking;
  outcome: CancellationOutcome;
  promotedMemberId: string | null;
  strikeState: StrikeState;
}

export async function cancelBooking(
  actor: SessionUser,
  bookingId: string,
  now: Date = new Date(),
): Promise<CancelResult> {
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { classInstance: true },
  });
  if (!existing) throw notFound('That booking no longer exists.');
  assertSelfOrStaff(actor, existing.memberId);

  const result = await prisma.$transaction(async (tx) => {
    const instance = await lockClass(tx, existing.classInstanceId);

    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw notFound('That booking no longer exists.');
    if (booking.status === 'CANCELLED') {
      throw conflict('That booking is already cancelled.', 'ALREADY_CANCELLED');
    }

    const outcome = evaluateCancellation({
      now,
      classStatus: instance.status,
      bookingStatus: booking.status,
      classDeadline: instance.cancelDeadlineAt,
      booking: { bookedAt: booking.bookedAt, promotedAt: booking.promotedAt },
    });

    const heldASpot = booking.status === 'BOOKED';

    const cancelled = await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancelledAt: now, lateCancel: outcome.isLate },
    });

    if (outcome.isLate) {
      await recordStrike(tx, {
        memberId: booking.memberId,
        bookingId: booking.id,
        type: 'LATE_CANCEL',
        occurredAt: now,
      });
    }

    // Cancelling late still frees the spot and still promotes the waitlist —
    // the strike is the only consequence.
    const promoted = heldASpot ? await promoteWaitlist(tx, instance, now) : [];

    return { booking: cancelled, outcome, promotedMemberId: promoted[0] ?? null };
  });

  const strikeState = await getStrikeState(existing.memberId, now);

  if (result.outcome.isLate) {
    await prisma.notification.create({
      data: {
        userId: existing.memberId,
        kind: strikeState.suspended ? 'SUSPENDED' : 'STRIKE_RECORDED',
        title: strikeState.suspended ? 'Your bookings are paused' : 'Late cancel recorded',
        body: strikeState.suspended
          ? `You reached ${strikeState.currentWeight} strikes. You can attend classes you already booked, but new bookings are paused until ${formatDateTime(strikeState.suspendedUntil!)}.`
          : `You're at ${strikeState.currentWeight} of ${strikeState.threshold} strikes in the last 30 days.`,
        href: '/account/strikes',
      },
    });
  }

  return { ...result, strikeState };
}

/**
 * Fill any free spots from the waitlist, oldest first.
 *
 * Ordering is (waitlistedAt, id) rather than a stored position column: a
 * position integer has to be renumbered on every join, leave and promotion,
 * and gets it wrong the moment two of those happen at once. A timestamp never
 * needs rewriting.
 *
 * This loops rather than promoting one, so raising a class's capacity pulls in
 * everyone it should.
 */
async function promoteWaitlist(tx: Tx, instance: ClassInstance, now: Date): Promise<string[]> {
  if (instance.status === 'CANCELLED') return [];

  const promoted: string[] = [];

  for (;;) {
    const bookedCount = await tx.booking.count({
      where: { classInstanceId: instance.id, status: 'BOOKED' },
    });
    if (bookedCount >= instance.capacity) break;

    const next = await tx.booking.findFirst({
      where: { classInstanceId: instance.id, status: 'WAITLISTED' },
      orderBy: [{ waitlistedAt: 'asc' }, { id: 'asc' }],
    });
    if (!next) break;

    await tx.booking.update({
      where: { id: next.id },
      data: { status: 'BOOKED', promotedAt: now },
    });

    await tx.notification.create({
      data: {
        userId: next.memberId,
        kind: 'WAITLIST_PROMOTED',
        title: `You're in — ${instance.name}`,
        body: `A spot opened up for ${formatDateTime(instance.startsAt)}. You can cancel free until ${formatDeadline(
          laterOf(instance.cancelDeadlineAt, addMinutes(now, 30)),
          now,
        )}.`,
        href: `/classes/${instance.id}`,
      },
    });

    promoted.push(next.memberId);
  }

  return promoted;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/**
 * Self check-in opens shortly before the class and closes when it ends, so a
 * member cannot check themselves in for tomorrow from their sofa. Coaches are
 * not restricted — they fix up the roster whenever they get to it.
 */
const SELF_CHECKIN_OPENS_MINUTES_BEFORE = 30;

export async function checkIn(
  actor: SessionUser,
  bookingId: string,
  now: Date = new Date(),
): Promise<Booking> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { classInstance: true },
  });
  if (!booking) throw notFound('That booking no longer exists.');
  assertSelfOrStaff(actor, booking.memberId);

  if (booking.status !== 'BOOKED') {
    throw conflict(
      booking.status === 'WAITLISTED'
        ? "You're still on the waitlist for that class."
        : 'That booking was cancelled.',
      'NOT_BOOKED',
    );
  }
  if (booking.classInstance.status === 'CANCELLED') {
    throw conflict('That class was cancelled.', 'CLASS_CANCELLED');
  }

  const isStaff = atLeast(actor.role, 'COACH');
  if (!isStaff) {
    const opens = new Date(
      booking.classInstance.startsAt.getTime() - SELF_CHECKIN_OPENS_MINUTES_BEFORE * 60_000,
    );
    if (now < opens) {
      throw conflict('Check-in opens 30 minutes before class.', 'TOO_EARLY');
    }
    if (now > booking.classInstance.endsAt) {
      throw conflict('That class has finished — ask your coach to check you in.', 'TOO_LATE');
    }
  }

  // Checking in contradicts a no-show, so drop the strike that went with it.
  await removeStrike(prisma, { bookingId: booking.id, type: 'NO_SHOW' });

  return prisma.booking.update({
    where: { id: booking.id },
    data: { checkedInAt: now, checkedInById: actor.id, noShow: false },
  });
}

export async function undoCheckIn(actor: SessionUser, bookingId: string): Promise<Booking> {
  assertCan(actor, 'markAttendance');
  return prisma.booking.update({
    where: { id: bookingId },
    data: { checkedInAt: null, checkedInById: null },
  });
}

/**
 * No-shows are marked by a coach, never inferred automatically. An auto-marker
 * would quietly strike members on the days a coach forgets to run the roster.
 */
export async function markNoShow(
  actor: SessionUser,
  bookingId: string,
  now: Date = new Date(),
): Promise<{ booking: Booking; strikeState: StrikeState }> {
  assertCan(actor, 'markAttendance');

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { classInstance: true },
  });
  if (!booking) throw notFound('That booking no longer exists.');

  if (booking.status !== 'BOOKED') {
    throw conflict('Only a held booking can be a no-show.', 'NOT_BOOKED');
  }
  if (booking.classInstance.status === 'CANCELLED') {
    throw conflict('That class was cancelled — nobody can be a no-show.', 'CLASS_CANCELLED');
  }
  if (now < booking.classInstance.startsAt) {
    throw conflict("That class hasn't started yet.", 'CLASS_NOT_STARTED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { noShow: true, checkedInAt: null, checkedInById: null },
    });
    await recordStrike(tx, {
      memberId: booking.memberId,
      bookingId: booking.id,
      type: 'NO_SHOW',
      occurredAt: booking.classInstance.startsAt,
    });
  });

  const strikeState = await getStrikeState(booking.memberId, now);
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

  await prisma.notification.create({
    data: {
      userId: booking.memberId,
      kind: strikeState.suspended ? 'SUSPENDED' : 'STRIKE_RECORDED',
      title: strikeState.suspended ? 'Your bookings are paused' : 'No-show recorded',
      body: strikeState.suspended
        ? `You can attend classes you already booked, but new bookings are paused until ${formatDateTime(strikeState.suspendedUntil!)}.`
        : `You're at ${strikeState.currentWeight} of ${strikeState.threshold} strikes in the last 30 days.`,
      href: '/account/strikes',
    },
  });

  return { booking: updated, strikeState };
}

export async function unmarkNoShow(actor: SessionUser, bookingId: string): Promise<Booking> {
  assertCan(actor, 'markAttendance');

  return prisma.$transaction(async (tx) => {
    await removeStrike(tx, { bookingId, type: 'NO_SHOW' });
    return tx.booking.update({ where: { id: bookingId }, data: { noShow: false } });
  });
}

// ---------------------------------------------------------------------------
// Class-level cancellation
// ---------------------------------------------------------------------------

/**
 * The gym pulling a class (holiday, coach sick) never penalises anyone: every
 * booking is released without a strike, and any strike already attached to
 * those bookings is withdrawn.
 */
export async function cancelClassInstance(
  actor: SessionUser,
  classInstanceId: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ notifiedMemberIds: string[] }> {
  assertCan(actor, 'cancelClass');

  return prisma.$transaction(async (tx) => {
    const instance = await lockClass(tx, classInstanceId);
    if (instance.status === 'CANCELLED') {
      throw conflict('That class is already cancelled.', 'ALREADY_CANCELLED');
    }

    // Everyone still holding a spot or a waitlist place gets released and told.
    const affected = await tx.booking.findMany({
      where: { classInstanceId, status: { not: 'CANCELLED' } },
    });

    // Strikes are withdrawn for every booking on this class, including people
    // who late-cancelled before the gym called it off. The class never ran, so
    // their cancellation cost nobody a spot.
    const allBookings = await tx.booking.findMany({
      where: { classInstanceId },
      select: { id: true },
    });

    await tx.classInstance.update({
      where: { id: classInstanceId },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledReason: reason.trim() || null,
        cancelledById: actor.id,
      },
    });

    await tx.booking.updateMany({
      where: { classInstanceId, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', cancelledAt: now, lateCancel: false },
    });

    await tx.strikeEvent.deleteMany({
      where: { bookingId: { in: allBookings.map((b) => b.id) } },
    });

    await tx.booking.updateMany({
      where: { classInstanceId },
      data: { lateCancel: false, noShow: false },
    });

    await tx.notification.createMany({
      data: affected.map((b) => ({
        userId: b.memberId,
        kind: 'CLASS_CANCELLED' as const,
        title: `${instance.name} is cancelled`,
        body: `${formatDateTime(instance.startsAt)}${reason.trim() ? ` — ${reason.trim()}` : ''}. No strike, no penalty.`,
        href: '/schedule',
      })),
    });

    return { notifiedMemberIds: affected.map((b) => b.memberId) };
  });
}

export async function restoreClassInstance(
  actor: SessionUser,
  classInstanceId: string,
): Promise<void> {
  assertCan(actor, 'cancelClass');
  await prisma.classInstance.update({
    where: { id: classInstanceId },
    data: { status: 'SCHEDULED', cancelledAt: null, cancelledReason: null, cancelledById: null },
  });
}
