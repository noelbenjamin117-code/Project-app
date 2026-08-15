import { describe, expect, it } from 'vitest';
import {
  computeMembershipState,
  explainCannotBook,
  type MembershipMirror,
  type OverrideInput,
} from '@/lib/domain/membership';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const DAY = 86_400_000;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * DAY);

const mirror = (over: Partial<MembershipMirror> = {}): MembershipMirror => ({
  status: 'ACTIVE',
  currentPeriodEnd: daysFromNow(20),
  pastDueSince: null,
  ...over,
});

const override = (over: Partial<OverrideInput> = {}): OverrideInput => ({
  id: 'ov1',
  activeUntil: daysFromNow(30),
  reason: 'Paid cash for August',
  revokedAt: null,
  ...over,
});

describe('who may book', () => {
  it('lets an active subscriber book', () => {
    const state = computeMembershipState(mirror({ status: 'ACTIVE' }), [], NOW);
    expect(state.canBook).toBe(true);
    expect(state.state).toBe('ACTIVE');
    expect(state.source).toBe('STRIPE');
  });

  it('lets somebody on a trial book', () => {
    expect(computeMembershipState(mirror({ status: 'TRIALING' }), [], NOW).canBook).toBe(true);
  });

  it('stops somebody with no membership at all', () => {
    const state = computeMembershipState(null, [], NOW);
    expect(state.canBook).toBe(false);
    expect(state.source).toBe('NONE');
  });

  it.each(['CANCELED', 'INCOMPLETE', 'PAUSED', 'NONE'] as const)(
    'stops somebody whose membership is %s',
    (status) => {
      expect(computeMembershipState(mirror({ status }), [], NOW).canBook).toBe(false);
    },
  );
});

describe('the failed-payment grace period', () => {
  it('lets a past-due member keep booking inside the window', () => {
    const state = computeMembershipState(
      mirror({ status: 'PAST_DUE', pastDueSince: hoursAgo(12) }),
      [],
      NOW,
      3,
    );

    expect(state.canBook).toBe(true);
    expect(state.state).toBe('GRACE');
    expect(state.graceEndsAt?.getTime()).toBe(hoursAgo(12).getTime() + 3 * DAY);
  });

  it('still lets them book on the very last moment of the window', () => {
    const since = new Date(NOW.getTime() - 3 * DAY);
    expect(
      computeMembershipState(mirror({ status: 'PAST_DUE', pastDueSince: since }), [], NOW, 3)
        .canBook,
    ).toBe(true);
  });

  it('stops them a moment after it runs out', () => {
    const since = new Date(NOW.getTime() - 3 * DAY - 1);
    const state = computeMembershipState(
      mirror({ status: 'PAST_DUE', pastDueSince: since }),
      [],
      NOW,
      3,
    );

    expect(state.canBook).toBe(false);
    expect(state.state).toBe('INACTIVE');
    // Still reports when it ended, so the member can be told.
    expect(state.graceEndsAt).not.toBeNull();
  });

  it('takes the grace length from config rather than assuming three days', () => {
    const since = new Date(NOW.getTime() - 5 * DAY);
    expect(
      computeMembershipState(mirror({ status: 'PAST_DUE', pastDueSince: since }), [], NOW, 7)
        .canBook,
    ).toBe(true);
    expect(
      computeMembershipState(mirror({ status: 'PAST_DUE', pastDueSince: since }), [], NOW, 3)
        .canBook,
    ).toBe(false);
  });

  it('starts the clock now when we somehow never recorded a failure time', () => {
    const state = computeMembershipState(
      mirror({ status: 'PAST_DUE', pastDueSince: null }),
      [],
      NOW,
      3,
    );
    // Fail open: they get the full window rather than being locked out by a
    // missing timestamp.
    expect(state.canBook).toBe(true);
  });
});

describe('a manual override', () => {
  it('beats a cancelled Stripe subscription', () => {
    const state = computeMembershipState(mirror({ status: 'CANCELED' }), [override()], NOW);

    expect(state.canBook).toBe(true);
    expect(state.source).toBe('OVERRIDE');
    expect(state.overrideReason).toBe('Paid cash for August');
  });

  it('beats an expired grace period', () => {
    const state = computeMembershipState(
      mirror({ status: 'PAST_DUE', pastDueSince: new Date(NOW.getTime() - 30 * DAY) }),
      [override()],
      NOW,
      3,
    );
    expect(state.canBook).toBe(true);
    expect(state.source).toBe('OVERRIDE');
  });

  it('stops counting once it expires', () => {
    const expired = override({ activeUntil: new Date(NOW.getTime() - 1) });
    const state = computeMembershipState(mirror({ status: 'CANCELED' }), [expired], NOW);

    expect(state.canBook).toBe(false);
    expect(state.source).toBe('STRIPE');
  });

  it('stops counting once it is revoked', () => {
    const revoked = override({ revokedAt: hoursAgo(1) });
    expect(computeMembershipState(mirror({ status: 'CANCELED' }), [revoked], NOW).canBook).toBe(
      false,
    );
  });

  it('takes the longest-running override when there are several', () => {
    const state = computeMembershipState(
      mirror({ status: 'NONE' }),
      [
        override({ id: 'a', activeUntil: daysFromNow(5), reason: 'Short' }),
        override({ id: 'b', activeUntil: daysFromNow(40), reason: 'Long' }),
      ],
      NOW,
    );
    expect(state.overrideReason).toBe('Long');
    expect(state.overrideUntil?.getTime()).toBe(daysFromNow(40).getTime());
  });

  it('does not disturb somebody who is already paying normally', () => {
    const state = computeMembershipState(mirror({ status: 'ACTIVE' }), [override()], NOW);
    // The override still wins, which is harmless — they can book either way.
    expect(state.canBook).toBe(true);
  });
});

describe('what a member is told', () => {
  it('never mentions Stripe, a status code or an error', () => {
    for (const status of ['PAST_DUE', 'CANCELED', 'PAUSED', 'INCOMPLETE', 'NONE'] as const) {
      const message = explainCannotBook(
        computeMembershipState(mirror({ status, pastDueSince: new Date(0) }), [], NOW),
      );
      expect(message).not.toMatch(/stripe/i);
      expect(message).not.toMatch(/past_due|incomplete|canceled/i);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it('tells a lapsed member what to do about it', () => {
    const message = explainCannotBook(
      computeMembershipState(mirror({ status: 'CANCELED' }), [], NOW),
    );
    expect(message).toMatch(/start it again/i);
  });
});
