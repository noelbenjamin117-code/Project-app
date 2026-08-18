import 'server-only';
import { prisma } from '@/lib/db';
import { localWeekBounds, todayLocal } from '@/lib/time';
import { getPlanRules } from '@/lib/domain/entitlement';
import { getBalance } from '@/lib/services/passes';

export interface Allowance {
  planName: string | null;
  /** Classes a week the plan allows, or null when it is uncapped. */
  weeklyLimit: number | null;
  used: number;
  remaining: number | null;
  /** Passes left across every unexpired pack. */
  passes: number;
  passesLow: boolean;
}

/**
 * What the member has left this week.
 *
 * Shown before they run out rather than at the moment they are refused — the
 * same principle as warning somebody before a strike suspends them. Counted
 * over the same Monday-to-Sunday week the booking gate enforces, and over the
 * same bookings: pay-as-you-go classes and pass-paid classes are not part of
 * the plan's allowance.
 */
export async function getAllowance(
  memberId: string,
  now: Date = new Date(),
): Promise<Allowance> {
  const week = localWeekBounds(todayLocal(now));

  const [membership, used, balance] = await Promise.all([
    prisma.membership.findUnique({ where: { userId: memberId } }),
    prisma.booking.count({
      where: {
        memberId,
        status: { not: 'CANCELLED' },
        classInstance: { date: { gte: week.from, lte: week.to }, payg: false },
        passPackId: null,
      },
    }),
    getBalance(memberId, now),
  ]);

  const rules = getPlanRules(membership?.planKey);

  return {
    planName: rules?.name ?? null,
    weeklyLimit: rules?.weeklyLimit ?? null,
    used,
    remaining: rules?.weeklyLimit == null ? null : Math.max(0, rules.weeklyLimit - used),
    passes: balance.remaining,
    passesLow: balance.low,
  };
}
