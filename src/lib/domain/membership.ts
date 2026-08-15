import { gymConfig } from '~/gym.config';

export type MembershipStatus =
  | 'NONE'
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'INCOMPLETE'
  | 'CANCELED'
  | 'PAUSED';

/** The mirrored Stripe fields this calculation is allowed to see. */
export interface MembershipMirror {
  status: MembershipStatus;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
}

export interface OverrideInput {
  id: string;
  activeUntil: Date;
  reason: string;
  revokedAt?: Date | null;
}

export type MembershipSource = 'STRIPE' | 'OVERRIDE' | 'NONE';

export interface MembershipState {
  /** The only thing the booking path asks about. */
  canBook: boolean;
  /** Paying normally, in the failed-payment grace window, or neither. */
  state: 'ACTIVE' | 'GRACE' | 'INACTIVE';
  source: MembershipSource;
  /** When the grace window runs out, if they're in one. */
  graceEndsAt: Date | null;
  /** When the manual override runs out, if one is in force. */
  overrideUntil: Date | null;
  overrideReason: string | null;
  /** Next renewal, for display. */
  currentPeriodEnd: Date | null;
  status: MembershipStatus;
}

const DAY_MS = 86_400_000;

/**
 * Work out whether somebody may book.
 *
 * Derived on every read from the mirrored Stripe fields and any manual
 * override, never stored. A stored "is a member" boolean is exactly the thing
 * that goes stale the day a payment fails at 3am.
 *
 * Order matters: an owner's manual override wins over whatever Stripe thinks,
 * because the owner has usually just been handed cash.
 *
 * NOTE: v1 sells one unlimited plan, so being active is the whole entitlement
 * question. Limited plans — N classes a week, off-peak only, HYROX-only — need
 * per-plan entitlement rules that deliberately do not exist yet. Until they
 * do, any active subscription can book anything.
 */
export function computeMembershipState(
  mirror: MembershipMirror | null,
  overrides: OverrideInput[] = [],
  now: Date = new Date(),
  graceDays: number = gymConfig.membership.pastDueGraceDays,
): MembershipState {
  const live = overrides
    .filter((o) => !o.revokedAt && o.activeUntil.getTime() > now.getTime())
    .sort((a, b) => b.activeUntil.getTime() - a.activeUntil.getTime())[0];

  const base = {
    currentPeriodEnd: mirror?.currentPeriodEnd ?? null,
    status: mirror?.status ?? 'NONE',
  };

  if (live) {
    return {
      ...base,
      canBook: true,
      state: 'ACTIVE',
      source: 'OVERRIDE',
      graceEndsAt: null,
      overrideUntil: live.activeUntil,
      overrideReason: live.reason,
    };
  }

  const inactive: MembershipState = {
    ...base,
    canBook: false,
    state: 'INACTIVE',
    source: mirror ? 'STRIPE' : 'NONE',
    graceEndsAt: null,
    overrideUntil: null,
    overrideReason: null,
  };

  if (!mirror) return inactive;

  if (mirror.status === 'ACTIVE' || mirror.status === 'TRIALING') {
    return { ...inactive, canBook: true, state: 'ACTIVE', source: 'STRIPE' };
  }

  if (mirror.status === 'PAST_DUE') {
    // Stripe is retrying the card. Give them a few days to fix it before the
    // booking button stops working.
    const since = mirror.pastDueSince ?? now;
    const graceEndsAt = new Date(since.getTime() + graceDays * DAY_MS);
    if (now.getTime() <= graceEndsAt.getTime()) {
      return { ...inactive, canBook: true, state: 'GRACE', source: 'STRIPE', graceEndsAt };
    }
    return { ...inactive, graceEndsAt };
  }

  return inactive;
}

/**
 * What a member is told when they cannot book. Never a Stripe status, never an
 * error code — just what has happened and what to do about it.
 */
export function explainCannotBook(state: MembershipState): string {
  switch (state.status) {
    case 'PAST_DUE':
      return 'Your last payment didn’t go through, so booking is paused. Update your card and it’ll come straight back.';
    case 'CANCELED':
      return 'Your membership has ended. Start it again to book classes.';
    case 'PAUSED':
      return 'Your membership is paused. Restart it to book classes.';
    case 'INCOMPLETE':
      return 'Your membership didn’t finish setting up. Finish it and you’re good to go.';
    default:
      return 'You need a membership to book classes.';
  }
}
