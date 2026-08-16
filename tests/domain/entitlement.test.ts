import { describe, expect, it } from 'vitest';
import {
  explainDenial,
  getPlanRules,
  nextPackToSpend,
  passesRemaining,
  planCoversClass,
  resolveEntitlement,
  type ClassFacts,
  type PassPackFacts,
} from '@/lib/domain/entitlement';
import type { MembershipState } from '@/lib/domain/membership';

const NOW = new Date('2026-08-17T10:00:00Z'); // a Monday

const active: MembershipState = {
  state: 'ACTIVE',
  canBook: true,
  status: 'ACTIVE',
  source: 'STRIPE',
  currentPeriodEnd: new Date('2026-09-17T00:00:00Z'),
  graceEndsAt: null,
  overrideUntil: null,
  overrideReason: null,
};

const lapsed: MembershipState = {
  ...active,
  state: 'INACTIVE',
  canBook: false,
  status: 'CANCELED',
};

const override: MembershipState = {
  ...active,
  source: 'OVERRIDE',
  overrideUntil: new Date('2026-09-01T00:00:00Z'),
};

function cls(over: Partial<ClassFacts> = {}): ClassFacts {
  return { name: 'BLITZ42', dayOfWeek: 1, startTimeLocal: '18:30', payg: false, ...over };
}

function pack(over: Partial<PassPackFacts> = {}): PassPackFacts {
  return {
    id: 'pack-1',
    passesTotal: 5,
    passesUsed: 0,
    expiresAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function resolve(input: {
  membership?: MembershipState;
  planKey?: string | null;
  cls?: ClassFacts;
  bookingsThisWeek?: number;
  packs?: PassPackFacts[];
}) {
  return resolveEntitlement({
    membership: input.membership ?? active,
    planKey: input.planKey ?? 'UNLIMITED',
    cls: input.cls ?? cls(),
    bookingsThisWeek: input.bookingsThisWeek ?? 0,
    packs: input.packs ?? [],
    now: NOW,
  });
}

describe('the gym’s real plans', () => {
  it('are all configured, so a Stripe plan key always resolves', () => {
    for (const key of ['UNLIMITED', 'TIER1', 'TIER2', 'HYROX_WF', 'OFF_PEAK']) {
      expect(getPlanRules(key), key).not.toBeNull();
    }
  });

  it('gives an unknown or missing plan key no rules rather than guessing', () => {
    expect(getPlanRules('SOMETHING_ELSE')).toBeNull();
    expect(getPlanRules(null)).toBeNull();
    expect(getPlanRules(undefined)).toBeNull();
  });
});

describe('planCoversClass', () => {
  it('lets an unlimited plan into anything that is not pay-as-you-go', () => {
    const rules = getPlanRules('UNLIMITED')!;
    expect(planCoversClass(rules, cls())).toBe(true);
    expect(planCoversClass(rules, cls({ name: 'BUILD42', dayOfWeek: 4 }))).toBe(true);
  });

  it('keeps every plan out of a pay-as-you-go class', () => {
    for (const key of ['UNLIMITED', 'TIER1', 'TIER2', 'HYROX_WF', 'OFF_PEAK']) {
      expect(planCoversClass(getPlanRules(key)!, cls({ payg: true })), key).toBe(false);
    }
  });

  it('holds the HYROX plan to Wednesday and Friday HYROX', () => {
    const rules = getPlanRules('HYROX_WF')!;
    expect(planCoversClass(rules, cls({ name: 'HYROX', dayOfWeek: 3 }))).toBe(true);
    expect(planCoversClass(rules, cls({ name: 'HYROX', dayOfWeek: 5 }))).toBe(true);
    // Sunday HYROX is not theirs, and neither is Wednesday's CALIBRATE42.
    expect(planCoversClass(rules, cls({ name: 'HYROX', dayOfWeek: 7 }))).toBe(false);
    expect(planCoversClass(rules, cls({ name: 'CALIBRATE42', dayOfWeek: 3 }))).toBe(false);
  });

  it('holds Off Peak to the 9:30s and the Thursday 4:30', () => {
    const rules = getPlanRules('OFF_PEAK')!;
    expect(planCoversClass(rules, cls({ dayOfWeek: 1, startTimeLocal: '09:30' }))).toBe(true);
    expect(planCoversClass(rules, cls({ dayOfWeek: 5, startTimeLocal: '09:30' }))).toBe(true);
    expect(planCoversClass(rules, cls({ dayOfWeek: 4, startTimeLocal: '16:30' }))).toBe(true);
    // The evening rush is exactly what they are not paying for.
    expect(planCoversClass(rules, cls({ dayOfWeek: 1, startTimeLocal: '18:30' }))).toBe(false);
    expect(planCoversClass(rules, cls({ dayOfWeek: 1, startTimeLocal: '06:00' }))).toBe(false);
    // 4:30pm only exists on Thursday, but the rule says so rather than relying on it.
    expect(planCoversClass(rules, cls({ dayOfWeek: 2, startTimeLocal: '16:30' }))).toBe(false);
  });
});

describe('pass packs', () => {
  it('counts what is left, ignoring anything expired', () => {
    const packs = [
      pack({ id: 'a', passesTotal: 5, passesUsed: 2 }),
      pack({ id: 'b', passesTotal: 10, passesUsed: 10 }),
      pack({ id: 'c', passesTotal: 4, expiresAt: new Date('2026-08-01T00:00:00Z') }),
    ];
    expect(passesRemaining(packs, NOW)).toBe(3);
  });

  it('spends the pack that expires soonest, so nothing is wasted', () => {
    const soon = pack({ id: 'soon', expiresAt: new Date('2026-09-01T00:00:00Z') });
    const later = pack({ id: 'later', expiresAt: new Date('2026-12-01T00:00:00Z') });
    expect(nextPackToSpend([later, soon], NOW)?.id).toBe('soon');
  });

  it('skips a soon-to-expire pack that has nothing left on it', () => {
    const empty = pack({
      id: 'empty',
      passesTotal: 3,
      passesUsed: 3,
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    });
    const usable = pack({ id: 'usable' });
    expect(nextPackToSpend([empty, usable], NOW)?.id).toBe('usable');
  });

  it('has nothing to spend once every pack is expired', () => {
    expect(nextPackToSpend([pack({ expiresAt: new Date('2026-08-01T00:00:00Z') })], NOW)).toBeNull();
  });
});

describe('resolveEntitlement', () => {
  it('lets a paid-up unlimited member book, on the plan', () => {
    const result = resolve({});
    expect(result).toMatchObject({ allowed: true, source: 'PLAN', passPackId: null });
    expect(result.weeklyLimit).toBeNull();
  });

  it('lets anyone into a pay-as-you-go class, membership or not', () => {
    const result = resolve({ membership: lapsed, planKey: null, cls: cls({ payg: true }) });
    expect(result).toMatchObject({ allowed: true, source: 'PAYG', passPackId: null });
  });

  it('never spends a pass on a pay-as-you-go class', () => {
    const result = resolve({
      membership: lapsed,
      planKey: null,
      cls: cls({ payg: true }),
      packs: [pack()],
    });
    expect(result.source).toBe('PAYG');
    expect(result.passPackId).toBeNull();
  });

  it('lets a paying member in when their plan key is missing or unrecognised', () => {
    // Rather than lock somebody out of the gym they pay for because a Stripe
    // price lost its metadata. Under-enforcing beats refusing a paying member.
    for (const planKey of [null, 'PLAN_WE_DO_NOT_KNOW']) {
      expect(resolve({ planKey }), String(planKey)).toMatchObject({
        allowed: true,
        source: 'PLAN',
        weeklyLimit: null,
      });
    }
  });

  it('still keeps an unrecognised plan out of a pay-as-you-go class’s free ride', () => {
    // PAYG is allowed for everyone, but as PAYG — never billed to a plan.
    expect(resolve({ planKey: null, cls: cls({ payg: true }) }).source).toBe('PAYG');
  });

  it('turns away somebody with no membership and no passes', () => {
    const neverJoined: MembershipState = { ...lapsed, status: 'NONE', source: 'NONE' };
    expect(resolve({ membership: neverJoined, planKey: null })).toMatchObject({
      allowed: false,
      reason: 'NO_MEMBERSHIP',
    });
  });

  it('tells a cancelled member and a failed payment apart', () => {
    // Two different problems with two different fixes: one picks a plan again,
    // the other updates a card.
    expect(resolve({ membership: lapsed, planKey: null }).reason).toBe('MEMBERSHIP_ENDED');

    const failed: MembershipState = { ...lapsed, status: 'PAST_DUE' };
    expect(resolve({ membership: failed, planKey: null }).reason).toBe('PAYMENT_FAILED');
  });

  it('lets a manual override through whatever Stripe says', () => {
    const result = resolve({ membership: override, planKey: null });
    expect(result).toMatchObject({ allowed: true, source: 'OVERRIDE' });
  });

  describe('weekly limits', () => {
    it('counts a Tier 1 member down through their three', () => {
      expect(resolve({ planKey: 'TIER1', bookingsThisWeek: 0 }).weeklyRemaining).toBe(2);
      expect(resolve({ planKey: 'TIER1', bookingsThisWeek: 1 }).weeklyRemaining).toBe(1);
      expect(resolve({ planKey: 'TIER1', bookingsThisWeek: 2 }).weeklyRemaining).toBe(0);
    });

    it('stops a Tier 2 member at two', () => {
      expect(resolve({ planKey: 'TIER2', bookingsThisWeek: 1 })).toMatchObject({
        allowed: true,
        source: 'PLAN',
      });
      expect(resolve({ planKey: 'TIER2', bookingsThisWeek: 2 })).toMatchObject({
        allowed: false,
        reason: 'WEEKLY_LIMIT_REACHED',
        weeklyLimit: 2,
        weeklyRemaining: 0,
      });
    });

    it('never caps the unlimited plan', () => {
      expect(resolve({ planKey: 'UNLIMITED', bookingsThisWeek: 11 })).toMatchObject({
        allowed: true,
        source: 'PLAN',
        weeklyRemaining: null,
      });
    });
  });

  describe('the order things are spent in', () => {
    it('uses the plan first, so a bought pass is not wasted on a covered class', () => {
      const result = resolve({ planKey: 'UNLIMITED', packs: [pack()] });
      expect(result.source).toBe('PLAN');
      expect(result.passPackId).toBeNull();
    });

    it('falls back to a pass when the plan does not cover the class', () => {
      const result = resolve({
        planKey: 'HYROX_WF',
        cls: cls({ name: 'BLITZ42', dayOfWeek: 1 }),
        packs: [pack({ id: 'p9' })],
      });
      expect(result).toMatchObject({ allowed: true, source: 'PASS', passPackId: 'p9' });
    });

    it('falls back to a pass when the weekly allowance is gone', () => {
      const result = resolve({
        planKey: 'TIER2',
        bookingsThisWeek: 2,
        packs: [pack({ id: 'p9' })],
      });
      expect(result).toMatchObject({ allowed: true, source: 'PASS', passPackId: 'p9' });
    });

    it('lets a lapsed member book on a pass they already bought', () => {
      const result = resolve({ membership: lapsed, planKey: 'TIER1', packs: [pack({ id: 'p9' })] });
      expect(result).toMatchObject({ allowed: true, source: 'PASS', passPackId: 'p9' });
    });

    it('does not let an expired pass in', () => {
      const result = resolve({
        membership: lapsed,
        planKey: null,
        packs: [pack({ expiresAt: new Date('2026-08-01T00:00:00Z') })],
      });
      expect(result).toMatchObject({ allowed: false, reason: 'PASSES_EXPIRED_OR_SPENT' });
    });
  });
});

describe('what the member is told', () => {
  it('says which class their plan misses, by name', () => {
    const result = resolve({
      planKey: 'OFF_PEAK',
      cls: cls({ name: 'BLITZ42', startTimeLocal: '18:30' }),
    });
    expect(explainDenial(result, cls({ name: 'BLITZ42' }))).toContain('BLITZ42');
  });

  it('says how many classes the plan gives them and when it resets', () => {
    const result = resolve({ planKey: 'TIER1', bookingsThisWeek: 3 });
    const message = explainDenial(result, cls());
    expect(message).toContain('3');
    expect(message).toContain('Monday');
  });

  it('never leaks a plan key or a Stripe status into the message', () => {
    const cases = [
      resolve({ membership: lapsed, planKey: null }),
      resolve({ membership: { ...lapsed, status: 'PAST_DUE' }, planKey: null }),
      resolve({ planKey: 'TIER1', bookingsThisWeek: 3 }),
      resolve({ planKey: 'HYROX_WF', cls: cls({ name: 'BLITZ42' }) }),
      resolve({
        membership: lapsed,
        planKey: null,
        packs: [pack({ expiresAt: new Date('2026-08-01T00:00:00Z') })],
      }),
    ];
    for (const result of cases) {
      const message = explainDenial(result, cls());
      for (const leak of ['TIER1', 'TIER2', 'HYROX_WF', 'OFF_PEAK', 'UNLIMITED', 'past_due']) {
        expect(message, leak).not.toContain(leak);
      }
    }
  });

  it('always offers a way forward rather than just a no', () => {
    for (const result of [
      resolve({ membership: lapsed, planKey: null }),
      resolve({ planKey: 'TIER1', bookingsThisWeek: 3 }),
      resolve({ planKey: 'HYROX_WF', cls: cls({ name: 'BLITZ42' }) }),
    ]) {
      expect(explainDenial(result, cls())).toMatch(/pass|membership/i);
    }
  });
});
