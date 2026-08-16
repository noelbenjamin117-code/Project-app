import { gymConfig } from '~/gym.config';
import type { MembershipState } from '@/lib/domain/membership';

/** One rule about which classes a plan covers. All stated fields must match. */
export interface AllowMatcher {
  classNames?: readonly string[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days?: readonly number[];
  /** Wall-clock start times, "HH:mm". */
  times?: readonly string[];
}

export interface PlanRules {
  name: string;
  priceLabel: string;
  description: string;
  /** Classes a week, or null for no cap. */
  weeklyLimit: number | null;
  allows: 'ALL' | readonly AllowMatcher[];
}

export type PlanKey = keyof typeof gymConfig.membership.plans;

export function getPlanRules(planKey: string | null | undefined): PlanRules | null {
  if (!planKey) return null;
  const plans = gymConfig.membership.plans as Record<string, PlanRules>;
  return plans[planKey] ?? null;
}

export interface ClassFacts {
  /** Class type, e.g. "HYROX". */
  name: string;
  /** ISO weekday of the class, 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** Wall-clock start, "HH:mm". */
  startTimeLocal: string;
  /** No membership covers it; anyone may book and pays separately. */
  payg: boolean;
}

export interface PassPackFacts {
  id: string;
  passesTotal: number;
  passesUsed: number;
  expiresAt: Date;
}

export type EntitlementSource = 'PAYG' | 'PLAN' | 'PASS' | 'OVERRIDE' | 'NONE';

export type DenialReason =
  | 'NO_MEMBERSHIP'
  | 'MEMBERSHIP_ENDED'
  | 'PAYMENT_FAILED'
  | 'PLAN_EXCLUDES_CLASS'
  | 'WEEKLY_LIMIT_REACHED'
  | 'PASSES_EXPIRED_OR_SPENT';

export interface Entitlement {
  allowed: boolean;
  source: EntitlementSource;
  reason: DenialReason | null;
  /** The pack a pass would come from, so the caller knows what to spend. */
  passPackId: string | null;
  /** For plans with a cap: how many they have left this week, after this one. */
  weeklyRemaining: number | null;
  weeklyLimit: number | null;
  /** Passes left across all unexpired packs. */
  passesRemaining: number;
}

/** Does this plan's allow-list cover this class? */
export function planCoversClass(rules: PlanRules, cls: ClassFacts): boolean {
  // Pay-as-you-go classes sit outside every membership by definition.
  if (cls.payg) return false;
  if (rules.allows === 'ALL') return true;

  return rules.allows.some((matcher) => {
    if (matcher.classNames && !matcher.classNames.includes(cls.name)) return false;
    if (matcher.days && !matcher.days.includes(cls.dayOfWeek)) return false;
    if (matcher.times && !matcher.times.includes(cls.startTimeLocal)) return false;
    // An empty matcher would allow everything, which is never what is meant.
    return Boolean(matcher.classNames || matcher.days || matcher.times);
  });
}

export function passesRemaining(packs: PassPackFacts[], now: Date): number {
  return packs
    .filter((pack) => pack.expiresAt.getTime() > now.getTime())
    .reduce((total, pack) => total + Math.max(0, pack.passesTotal - pack.passesUsed), 0);
}

/** The pack to spend from: whichever expires soonest, so nothing is wasted. */
export function nextPackToSpend(packs: PassPackFacts[], now: Date): PassPackFacts | null {
  return (
    packs
      .filter(
        (pack) =>
          pack.expiresAt.getTime() > now.getTime() && pack.passesUsed < pack.passesTotal,
      )
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())[0] ?? null
  );
}

/**
 * Decide whether somebody may book one specific class, and what pays for it.
 *
 * The order is deliberate. Pay-as-you-go classes are open to anyone, because
 * they are not part of any membership and the gym collects for them
 * separately. After that a manual override wins, then the member's plan, and
 * a pass pack is the fallback — so a member never burns a bought pass on a
 * class their membership already covers.
 */
export function resolveEntitlement(input: {
  membership: MembershipState;
  planKey: string | null;
  cls: ClassFacts;
  /** Bookings the member already holds in this class's week, excluding this one. */
  bookingsThisWeek: number;
  packs: PassPackFacts[];
  now: Date;
}): Entitlement {
  const { membership, planKey, cls, bookingsThisWeek, packs, now } = input;
  const remaining = passesRemaining(packs, now);

  const base: Entitlement = {
    allowed: false,
    source: 'NONE',
    reason: 'NO_MEMBERSHIP',
    passPackId: null,
    weeklyRemaining: null,
    weeklyLimit: null,
    passesRemaining: remaining,
  };

  // Anyone can book a pay-as-you-go class, member or not. It is the one place
  // the membership gate deliberately does not apply.
  if (cls.payg) {
    return { ...base, allowed: true, source: 'PAYG', reason: null };
  }

  const spendable = nextPackToSpend(packs, now);

  // A hand-granted override is the owner saying yes regardless.
  if (membership.source === 'OVERRIDE' && membership.canBook) {
    return { ...base, allowed: true, source: 'OVERRIDE', reason: null };
  }

  const rules = getPlanRules(planKey);

  // A paid-up member whose plan we cannot identify — a price missing its
  // metadata, a membership set up by hand — is let in with no restrictions.
  // They are paying; the failure is ours, and locking them out of the gym they
  // pay for is far worse than not enforcing a limit we cannot see.
  if (membership.canBook && !rules) {
    return { ...base, allowed: true, source: 'PLAN', reason: null };
  }

  if (membership.canBook && rules) {
    if (!planCoversClass(rules, cls)) {
      // Their plan does not run to this class — but a pass still might.
      return spendable
        ? { ...base, allowed: true, source: 'PASS', reason: null, passPackId: spendable.id }
        : { ...base, reason: 'PLAN_EXCLUDES_CLASS' };
    }

    if (rules.weeklyLimit != null && bookingsThisWeek >= rules.weeklyLimit) {
      return spendable
        ? {
            ...base,
            allowed: true,
            source: 'PASS',
            reason: null,
            passPackId: spendable.id,
            weeklyRemaining: 0,
            weeklyLimit: rules.weeklyLimit,
          }
        : {
            ...base,
            reason: 'WEEKLY_LIMIT_REACHED',
            weeklyRemaining: 0,
            weeklyLimit: rules.weeklyLimit,
          };
    }

    return {
      ...base,
      allowed: true,
      source: 'PLAN',
      reason: null,
      weeklyLimit: rules.weeklyLimit,
      weeklyRemaining:
        rules.weeklyLimit == null ? null : rules.weeklyLimit - bookingsThisWeek - 1,
    };
  }

  // No usable membership. A pass is the last thing that can get them in.
  if (spendable) {
    return { ...base, allowed: true, source: 'PASS', reason: null, passPackId: spendable.id };
  }

  if (remaining === 0 && packs.length > 0) {
    return { ...base, reason: 'PASSES_EXPIRED_OR_SPENT' };
  }

  return { ...base, reason: noMembershipReason(membership.status) };
}

/**
 * Which flavour of "you have no membership" this is. A member whose card
 * failed needs to hear something different from somebody who never joined —
 * one has a card to fix, the other has a plan to pick.
 */
function noMembershipReason(status: MembershipState['status']): DenialReason {
  switch (status) {
    case 'PAST_DUE':
    case 'INCOMPLETE':
      return 'PAYMENT_FAILED';
    case 'CANCELED':
    case 'PAUSED':
      return 'MEMBERSHIP_ENDED';
    default:
      return 'NO_MEMBERSHIP';
  }
}

/**
 * What the member is told when they cannot book. Never a plan key, never a
 * status code — just what has happened and the way out of it.
 */
export function explainDenial(entitlement: Entitlement, cls: ClassFacts): string {
  switch (entitlement.reason) {
    case 'MEMBERSHIP_ENDED':
      return 'Your membership has ended. Start it again to book classes.';
    case 'PAYMENT_FAILED':
      return 'Your last payment didn’t go through, so booking is paused. Update your card and it comes straight back.';
    case 'PLAN_EXCLUDES_CLASS':
      return `Your membership doesn’t include ${cls.name}. Buy a class pass or move up a plan to book it.`;
    case 'WEEKLY_LIMIT_REACHED':
      return `You’ve used all ${entitlement.weeklyLimit} of this week’s classes. Buy a class pass, or book again from Monday.`;
    case 'PASSES_EXPIRED_OR_SPENT':
      return 'Your class passes have run out. Buy more, or start a membership.';
    default:
      return 'You need a membership to book classes.';
  }
}
