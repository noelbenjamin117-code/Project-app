import 'server-only';
import type { BookingStatus, ClassStatus } from '@prisma/client';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { notFound } from '@/lib/errors';
import { addLocalDays, localDateRange, todayLocal, type LocalDate } from '@/lib/time';
import { effectiveCancelDeadline, type DeadlineReason } from '@/lib/domain/cancellation';
import { getStrikeStates } from '@/lib/services/strikes';
import type { StrikeState } from '@/lib/domain/strikes';

export interface ClassCard {
  id: string;
  name: string;
  notes: string | null;
  date: LocalDate;
  startsAt: Date;
  endsAt: Date;
  status: ClassStatus;
  cancelledReason: string | null;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  spotsLeft: number;
  coachName: string | null;
  /** The viewer's own booking, if any. */
  myBooking: {
    id: string;
    status: BookingStatus;
    checkedInAt: Date | null;
    promotedAt: Date | null;
    /** Free-cancel deadline for this member on this class. */
    deadline: Date;
    deadlineReason: DeadlineReason;
    waitlistPosition: number | null;
  } | null;
}

/**
 * The member-facing schedule: a window of days with counts and the viewer's
 * own booking state attached to each class.
 */
export async function getSchedule(
  viewerId: string | null,
  options: { from?: LocalDate; days?: number } = {},
  now: Date = new Date(),
): Promise<Map<LocalDate, ClassCard[]>> {
  const from = options.from ?? todayLocal(now);
  const to = addLocalDays(from, (options.days ?? 7) - 1);

  const instances = await prisma.classInstance.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { startsAt: 'asc' },
    include: {
      coach: { select: { name: true } },
      bookings: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          memberId: true,
          status: true,
          checkedInAt: true,
          bookedAt: true,
          promotedAt: true,
          waitlistedAt: true,
        },
      },
    },
  });

  const byDate = new Map<LocalDate, ClassCard[]>();
  for (const date of localDateRange(from, to)) byDate.set(date, []);

  for (const instance of instances) {
    const booked = instance.bookings.filter((b) => b.status === 'BOOKED');
    const waitlisted = instance.bookings
      .filter((b) => b.status === 'WAITLISTED')
      .sort((a, b) => {
        const at = a.waitlistedAt?.getTime() ?? 0;
        const bt = b.waitlistedAt?.getTime() ?? 0;
        return at === bt ? a.id.localeCompare(b.id) : at - bt;
      });

    const mine = viewerId ? instance.bookings.find((b) => b.memberId === viewerId) : undefined;
    const myDeadline = mine
      ? effectiveCancelDeadline(instance.cancelDeadlineAt, {
          bookedAt: mine.bookedAt,
          promotedAt: mine.promotedAt,
        })
      : null;

    const card: ClassCard = {
      id: instance.id,
      name: instance.name,
      notes: instance.notes,
      date: instance.date,
      startsAt: instance.startsAt,
      endsAt: instance.endsAt,
      status: instance.status,
      cancelledReason: instance.cancelledReason,
      capacity: instance.capacity,
      bookedCount: booked.length,
      waitlistCount: waitlisted.length,
      spotsLeft: Math.max(0, instance.capacity - booked.length),
      coachName: instance.coach?.name ?? null,
      myBooking: mine
        ? {
            id: mine.id,
            status: mine.status,
            checkedInAt: mine.checkedInAt,
            promotedAt: mine.promotedAt,
            deadline: myDeadline!.deadline,
            deadlineReason: myDeadline!.reason,
            waitlistPosition:
              mine.status === 'WAITLISTED'
                ? waitlisted.findIndex((w) => w.id === mine.id) + 1
                : null,
          }
        : null,
    };

    byDate.get(instance.date)?.push(card);
  }

  return byDate;
}

export async function getClassCard(
  viewerId: string | null,
  classInstanceId: string,
  now: Date = new Date(),
): Promise<ClassCard> {
  const instance = await prisma.classInstance.findUnique({
    where: { id: classInstanceId },
    select: { date: true },
  });
  if (!instance) throw notFound('That class no longer exists.');

  const schedule = await getSchedule(viewerId, { from: instance.date, days: 1 }, now);
  const card = schedule.get(instance.date)?.find((c) => c.id === classInstanceId);
  if (!card) throw notFound('That class no longer exists.');
  return card;
}

export interface RosterEntry {
  bookingId: string;
  memberId: string;
  memberName: string;
  status: BookingStatus;
  source: string;
  checkedInAt: Date | null;
  noShow: boolean;
  lateCancel: boolean;
  cancelledAt: Date | null;
  waitlistPosition: number | null;
  promotedAt: Date | null;
  strikes: StrikeState;
  /** Shown next to the name so a coach knows before they mark a no-show. */
  riskLevel: 'NONE' | 'NEAR' | 'AT_THRESHOLD' | 'SUSPENDED';
}

export interface Roster {
  classInstance: {
    id: string;
    name: string;
    date: LocalDate;
    startsAt: Date;
    endsAt: Date;
    status: ClassStatus;
    capacity: number;
    coachName: string | null;
    cancelledReason: string | null;
  };
  booked: RosterEntry[];
  waitlisted: RosterEntry[];
  cancelled: RosterEntry[];
  attendanceCount: number;
}

/**
 * The coach's class roster: who is in, who is waiting, who cancelled late, and
 * an at-risk marker beside anyone close to a suspension.
 */
export async function getRoster(
  actor: SessionUser,
  classInstanceId: string,
  now: Date = new Date(),
): Promise<Roster> {
  assertCan(actor, 'viewRoster');

  const instance = await prisma.classInstance.findUnique({
    where: { id: classInstanceId },
    include: {
      coach: { select: { name: true } },
      bookings: {
        include: { member: { select: { id: true, name: true } } },
        orderBy: [{ waitlistedAt: 'asc' }, { bookedAt: 'asc' }],
      },
    },
  });
  if (!instance) throw notFound('That class no longer exists.');

  const strikeStates = await getStrikeStates(
    instance.bookings.map((b) => b.memberId),
    now,
  );

  let waitlistPosition = 0;
  const toEntry = (booking: (typeof instance.bookings)[number]): RosterEntry => {
    const strikes = strikeStates.get(booking.memberId)!;
    return {
      bookingId: booking.id,
      memberId: booking.memberId,
      memberName: booking.member.name,
      status: booking.status,
      source: booking.source,
      checkedInAt: booking.checkedInAt,
      noShow: booking.noShow,
      lateCancel: booking.lateCancel,
      cancelledAt: booking.cancelledAt,
      waitlistPosition: booking.status === 'WAITLISTED' ? ++waitlistPosition : null,
      promotedAt: booking.promotedAt,
      strikes,
      riskLevel: riskLevel(strikes),
    };
  };

  const entries = instance.bookings.map(toEntry);

  return {
    classInstance: {
      id: instance.id,
      name: instance.name,
      date: instance.date,
      startsAt: instance.startsAt,
      endsAt: instance.endsAt,
      status: instance.status,
      capacity: instance.capacity,
      coachName: instance.coach?.name ?? null,
      cancelledReason: instance.cancelledReason,
    },
    booked: entries.filter((e) => e.status === 'BOOKED'),
    waitlisted: entries.filter((e) => e.status === 'WAITLISTED'),
    cancelled: entries.filter((e) => e.status === 'CANCELLED'),
    attendanceCount: entries.filter((e) => e.checkedInAt).length,
  };
}

function riskLevel(state: StrikeState): RosterEntry['riskLevel'] {
  if (state.suspended) return 'SUSPENDED';
  if (state.weightToSuspension <= 0) return 'AT_THRESHOLD';
  if (state.oneMoreLateCancelSuspends || state.oneMoreNoShowSuspends) return 'NEAR';
  return 'NONE';
}

/**
 * Everything the gym TV needs, in one query pass. Public — the whiteboard has
 * no login and shows nothing a member on the floor cannot already see.
 */
export async function getWhiteboardData(now: Date = new Date()) {
  const today = todayLocal(now);

  const [scheduled, upcoming] = await Promise.all([
    prisma.scheduledWod.findMany({
      where: { date: today },
      include: {
        wodDefinition: { include: { scalingOptions: true } },
        results: {
          include: { member: { select: { id: true, name: true } } },
        },
        classes: { select: { classInstanceId: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.classInstance.findMany({
      where: { startsAt: { gte: now }, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      take: gymConfig.whiteboard.upcomingClasses,
      include: {
        coach: { select: { name: true } },
        bookings: { where: { status: 'BOOKED' }, select: { id: true } },
      },
    }),
  ]);

  return {
    date: today,
    generatedAt: now,
    scheduled,
    upcoming: upcoming.map((c) => ({
      id: c.id,
      name: c.name,
      startsAt: c.startsAt,
      coachName: c.coach?.name ?? null,
      bookedCount: c.bookings.length,
      capacity: c.capacity,
    })),
  };
}
