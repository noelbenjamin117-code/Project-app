import 'server-only';
import type { Prisma, StrikeType } from '@prisma/client';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { notFound } from '@/lib/errors';
import { computeStrikeState, type StrikeState } from '@/lib/domain/strikes';

type Db = Prisma.TransactionClient | typeof prisma;

export const STRIKE_WEIGHT: Record<StrikeType, number> = {
  LATE_CANCEL: gymConfig.strikes.lateCancelWeight,
  NO_SHOW: gymConfig.strikes.noShowWeight,
};

/**
 * Record a strike. The weight is copied from config onto the row so that
 * changing the weights later never rewrites what a member already served.
 *
 * Unique on (bookingId, type), so a double-submitted roster cannot strike the
 * same member twice for the same class.
 */
export async function recordStrike(
  db: Db,
  input: { memberId: string; bookingId: string; type: StrikeType; occurredAt: Date },
): Promise<void> {
  await db.strikeEvent.upsert({
    where: { bookingId_type: { bookingId: input.bookingId, type: input.type } },
    create: {
      memberId: input.memberId,
      bookingId: input.bookingId,
      type: input.type,
      weight: STRIKE_WEIGHT[input.type],
      occurredAt: input.occurredAt,
    },
    update: {},
  });
}

/** Undo a strike that was recorded and then reversed (e.g. no-show un-marked). */
export async function removeStrike(
  db: Db,
  input: { bookingId: string; type: StrikeType },
): Promise<void> {
  await db.strikeEvent.deleteMany({
    where: { bookingId: input.bookingId, type: input.type },
  });
}

export async function getStrikeState(
  memberId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<StrikeState> {
  const [events, overrides] = await Promise.all([
    db.strikeEvent.findMany({
      where: { memberId },
      orderBy: { occurredAt: 'desc' },
      include: { booking: { include: { classInstance: true } } },
    }),
    db.suspensionOverride.findMany({ where: { memberId } }),
  ]);

  return computeStrikeState(
    events.map((e) => ({
      id: e.id,
      type: e.type,
      weight: e.weight,
      occurredAt: e.occurredAt,
      forgivenAt: e.forgivenAt,
    })),
    overrides.map((o) => ({ id: o.id, liftedAt: o.liftedAt })),
    now,
  );
}

/**
 * Strike state for many members at once — the roster needs an at-risk
 * indicator next to every name without running a query per row.
 */
export async function getStrikeStates(
  memberIds: string[],
  now: Date = new Date(),
  db: Db = prisma,
): Promise<Map<string, StrikeState>> {
  if (memberIds.length === 0) return new Map();

  const [events, overrides] = await Promise.all([
    db.strikeEvent.findMany({ where: { memberId: { in: memberIds } } }),
    db.suspensionOverride.findMany({ where: { memberId: { in: memberIds } } }),
  ]);

  const byMember = new Map<string, StrikeState>();
  for (const memberId of memberIds) {
    byMember.set(
      memberId,
      computeStrikeState(
        events
          .filter((e) => e.memberId === memberId)
          .map((e) => ({
            id: e.id,
            type: e.type,
            weight: e.weight,
            occurredAt: e.occurredAt,
            forgivenAt: e.forgivenAt,
          })),
        overrides
          .filter((o) => o.memberId === memberId)
          .map((o) => ({ id: o.id, liftedAt: o.liftedAt })),
        now,
      ),
    );
  }
  return byMember;
}

/**
 * Forgive a strike. The event is marked, never deleted — who forgave what and
 * why has to survive, and the suspension recomputes from the remaining events
 * on the next read.
 */
export async function forgiveStrike(
  strikeId: string,
  actor: SessionUser,
  reason?: string,
): Promise<StrikeState> {
  assertCan(actor, 'forgiveStrike');

  const strike = await prisma.strikeEvent.findUnique({ where: { id: strikeId } });
  if (!strike) throw notFound('That strike no longer exists.');

  await prisma.strikeEvent.update({
    where: { id: strikeId },
    data: {
      forgivenAt: new Date(),
      forgivenById: actor.id,
      forgivenReason: reason?.trim() || null,
    },
  });

  const state = await getStrikeState(strike.memberId);
  if (!state.suspended) {
    await notifyIfLifted(strike.memberId);
  }
  return state;
}

/** Undo a forgiveness (mis-clicks happen), leaving the audit trail intact. */
export async function unforgiveStrike(strikeId: string, actor: SessionUser): Promise<StrikeState> {
  assertCan(actor, 'forgiveStrike');

  const strike = await prisma.strikeEvent.findUnique({ where: { id: strikeId } });
  if (!strike) throw notFound('That strike no longer exists.');

  await prisma.strikeEvent.update({
    where: { id: strikeId },
    data: { forgivenAt: null, forgivenById: null, forgivenReason: null },
  });
  return getStrikeState(strike.memberId);
}

/**
 * Lift a suspension immediately. This writes an override rather than clearing
 * strikes: the strikes stay on the record and the suspension stays computed.
 */
export async function liftSuspension(
  memberId: string,
  actor: SessionUser,
  reason?: string,
): Promise<StrikeState> {
  assertCan(actor, 'liftSuspension');

  await prisma.suspensionOverride.create({
    data: {
      memberId,
      liftedAt: new Date(),
      byUserId: actor.id,
      reason: reason?.trim() || null,
    },
  });

  await notifyIfLifted(memberId);
  return getStrikeState(memberId);
}

async function notifyIfLifted(memberId: string): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: memberId,
      kind: 'SUSPENSION_LIFTED',
      title: 'Your bookings are open again',
      body: 'You can book classes as normal.',
      href: '/schedule',
    },
  });
}
