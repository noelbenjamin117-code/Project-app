import { describe, expect, it } from 'vitest';
import { computeStrikeState, previewStrike, type StrikeInput } from '@/lib/domain/strikes';

const CONFIG = {
  lateCancelWeight: 1,
  noShowWeight: 2,
  threshold: 4,
  windowDays: 30,
  suspensionDays: 7,
};

const DAY = 86_400_000;
const NOW = new Date('2026-06-30T12:00:00.000Z');
const daysAgo = (days: number, from: Date = NOW) => new Date(from.getTime() - days * DAY);

function lateCancel(id: string, at: Date, forgivenAt?: Date): StrikeInput {
  return { id, type: 'LATE_CANCEL', weight: 1, occurredAt: at, forgivenAt };
}
function noShow(id: string, at: Date, forgivenAt?: Date): StrikeInput {
  return { id, type: 'NO_SHOW', weight: 2, occurredAt: at, forgivenAt };
}

describe('strike accrual', () => {
  it('counts nothing for a member with a clean record', () => {
    const state = computeStrikeState([], [], NOW, CONFIG);
    expect(state.currentWeight).toBe(0);
    expect(state.suspended).toBe(false);
    expect(state.weightToSuspension).toBe(4);
  });

  it('weights a no-show double a late cancel', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(3)), noShow('b', daysAgo(2))],
      [],
      NOW,
      CONFIG,
    );
    expect(state.currentWeight).toBe(3);
    expect(state.suspended).toBe(false);
  });

  it('suspends at the threshold and reports when it lifts', () => {
    const last = daysAgo(1);
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(5)), lateCancel('b', daysAgo(4)), noShow('c', last)],
      [],
      NOW,
      CONFIG,
    );

    expect(state.suspended).toBe(true);
    expect(state.suspendedSince?.toISOString()).toBe(last.toISOString());
    expect(state.suspendedUntil?.toISOString()).toBe(
      new Date(last.getTime() + 7 * DAY).toISOString(),
    );
  });

  it('does not suspend below the threshold', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(5)), lateCancel('b', daysAgo(4)), lateCancel('c', daysAgo(1))],
      [],
      NOW,
      CONFIG,
    );
    expect(state.currentWeight).toBe(3);
    expect(state.suspended).toBe(false);
  });
});

describe('the rolling 30-day window', () => {
  it('still counts a strike 29 days old', () => {
    const state = computeStrikeState([lateCancel('a', daysAgo(29))], [], NOW, CONFIG);
    expect(state.currentWeight).toBe(1);
    expect(state.events[0].counting).toBe(true);
  });

  it('drops a strike the moment it passes 30 days', () => {
    // One millisecond either side of the boundary.
    const justInside = new Date(NOW.getTime() - 30 * DAY + 1);
    const justOutside = new Date(NOW.getTime() - 30 * DAY - 1);

    expect(computeStrikeState([lateCancel('a', justInside)], [], NOW, CONFIG).currentWeight).toBe(1);
    expect(computeStrikeState([lateCancel('a', justOutside)], [], NOW, CONFIG).currentWeight).toBe(0);
  });

  it('slides continuously rather than resetting at a month boundary', () => {
    const strikes = [
      lateCancel('a', new Date('2026-05-20T12:00:00.000Z')),
      lateCancel('b', new Date('2026-06-02T12:00:00.000Z')),
    ];

    // On 10 June both are inside the window despite spanning the month end.
    const inJune = computeStrikeState(strikes, [], new Date('2026-06-10T12:00:00.000Z'), CONFIG);
    expect(inJune.currentWeight).toBe(2);

    // By 25 June the May strike has aged out on its own.
    const later = computeStrikeState(strikes, [], new Date('2026-06-25T12:00:00.000Z'), CONFIG);
    expect(later.currentWeight).toBe(1);
  });

  it('will not suspend on four strikes spread beyond the window', () => {
    const state = computeStrikeState(
      [
        lateCancel('a', daysAgo(80)),
        lateCancel('b', daysAgo(60)),
        lateCancel('c', daysAgo(40)),
        lateCancel('d', daysAgo(1)),
      ],
      [],
      NOW,
      CONFIG,
    );

    expect(state.currentWeight).toBe(1);
    expect(state.suspended).toBe(false);
  });
});

describe('suspension expiry', () => {
  const triggered = [
    lateCancel('a', daysAgo(20)),
    lateCancel('b', daysAgo(19)),
    noShow('c', daysAgo(18)),
  ];

  it('is active during the seven days', () => {
    const during = new Date(daysAgo(18).getTime() + 3 * DAY);
    expect(computeStrikeState(triggered, [], during, CONFIG).suspended).toBe(true);
  });

  it('lifts itself on day seven with no job, flag or cleanup', () => {
    const after = new Date(daysAgo(18).getTime() + 7 * DAY + 1);
    const state = computeStrikeState(triggered, [], after, CONFIG);

    expect(state.suspended).toBe(false);
    expect(state.suspendedUntil).toBeNull();
  });

  it('records the suspension in history even after the strikes age out', () => {
    // Long after everything has expired, the suspension that happened is still
    // derivable — the walk evaluates the window as it looked at the time.
    const state = computeStrikeState(triggered, [], new Date('2026-12-31T00:00:00Z'), CONFIG);

    expect(state.suspended).toBe(false);
    expect(state.currentWeight).toBe(0);
    expect(state.suspensions).toHaveLength(1);
    expect(state.suspensions[0].triggeredByStrikeId).toBe('c');
  });
});

describe('forgiveness', () => {
  const strikes = [
    lateCancel('a', daysAgo(5)),
    lateCancel('b', daysAgo(4)),
    noShow('c', daysAgo(1)),
  ];

  it('un-suspends a member the moment a strike is forgiven', () => {
    expect(computeStrikeState(strikes, [], NOW, CONFIG).suspended).toBe(true);

    const forgiven = [
      strikes[0],
      strikes[1],
      { ...strikes[2], forgivenAt: NOW }, // forgive the no-show, worth 2
    ];
    const state = computeStrikeState(forgiven, [], NOW, CONFIG);

    expect(state.suspended).toBe(false);
    expect(state.currentWeight).toBe(2);
  });

  it('keeps a forgiven strike visible in history but out of the count', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(3), NOW)],
      [],
      NOW,
      CONFIG,
    );

    expect(state.currentWeight).toBe(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].counting).toBe(false);
  });

  it('leaves the member suspended if forgiving one strike is not enough', () => {
    const heavy = [
      noShow('a', daysAgo(5)),
      noShow('b', daysAgo(4)),
      noShow('c', daysAgo(1)),
    ];
    const forgiven = [{ ...heavy[0], forgivenAt: NOW }, heavy[1], heavy[2]];

    expect(computeStrikeState(forgiven, [], NOW, CONFIG).suspended).toBe(true);
  });
});

describe('owner override', () => {
  const strikes = [
    lateCancel('a', daysAgo(5)),
    lateCancel('b', daysAgo(4)),
    noShow('c', daysAgo(2)),
  ];

  it('lifts an active suspension immediately', () => {
    const state = computeStrikeState(
      strikes,
      [{ id: 'o1', liftedAt: daysAgo(1) }],
      NOW,
      CONFIG,
    );

    expect(state.suspended).toBe(false);
    // The strikes stay on the record and stay visible in history…
    expect(state.events).toHaveLength(3);
    expect(state.suspensions).toHaveLength(1);
    // …but they were consumed by the suspension that has now been lifted, so
    // the member is not left one strike away from being suspended again.
    expect(state.currentWeight).toBe(0);
    expect(state.events.every((e) => e.consumed)).toBe(true);
  });

  it('ignores an override that predates the suspension', () => {
    const state = computeStrikeState(
      strikes,
      [{ id: 'o1', liftedAt: daysAgo(10) }],
      NOW,
      CONFIG,
    );
    expect(state.suspended).toBe(true);
  });
});

describe('strikes are consumed by the suspension they trigger', () => {
  it('does not immediately re-suspend a member who has served their pause', () => {
    const base = new Date('2026-06-01T12:00:00.000Z');
    const strikes = [
      lateCancel('a', new Date(base.getTime())),
      lateCancel('b', new Date(base.getTime() + DAY)),
      noShow('c', new Date(base.getTime() + 2 * DAY)), // triggers at weight 4
    ];

    // Nine days later the pause has ended.
    const afterServing = new Date(base.getTime() + 11 * DAY);
    const served = computeStrikeState(strikes, [], afterServing, CONFIG);
    expect(served.suspended).toBe(false);
    expect(served.currentWeight).toBe(0);

    // One more late cancel must not re-trigger off the already-served strikes.
    const withAnother = [...strikes, lateCancel('d', afterServing)];
    const state = computeStrikeState(withAnother, [], afterServing, CONFIG);

    expect(state.suspended).toBe(false);
    expect(state.currentWeight).toBe(1);
  });

  it('suspends again once fresh strikes reach the threshold on their own', () => {
    const base = new Date('2026-06-01T12:00:00.000Z');
    const after = new Date(base.getTime() + 11 * DAY);
    const strikes = [
      lateCancel('a', base),
      lateCancel('b', new Date(base.getTime() + DAY)),
      noShow('c', new Date(base.getTime() + 2 * DAY)),
      noShow('d', after),
      noShow('e', new Date(after.getTime() + DAY)),
    ];

    const state = computeStrikeState(strikes, [], new Date(after.getTime() + DAY), CONFIG);
    expect(state.suspended).toBe(true);
    expect(state.suspensions).toHaveLength(2);
  });
});

describe('warnings before the penalty', () => {
  it('flags a member sitting one late cancel from suspension', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(5)), lateCancel('b', daysAgo(4)), lateCancel('c', daysAgo(3))],
      [],
      NOW,
      CONFIG,
    );

    expect(state.currentWeight).toBe(3);
    expect(state.oneMoreLateCancelSuspends).toBe(true);
  });

  it('flags a member for whom only a no-show would tip the balance', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(5)), lateCancel('b', daysAgo(4))],
      [],
      NOW,
      CONFIG,
    );

    expect(state.oneMoreLateCancelSuspends).toBe(false);
    expect(state.oneMoreNoShowSuspends).toBe(true);
  });

  it('stops warning once the member is already suspended', () => {
    const state = computeStrikeState(
      [noShow('a', daysAgo(3)), noShow('b', daysAgo(2))],
      [],
      NOW,
      CONFIG,
    );

    expect(state.suspended).toBe(true);
    expect(state.oneMoreLateCancelSuspends).toBe(false);
  });

  it('tells the member exactly where a late cancel leaves them', () => {
    const state = computeStrikeState(
      [lateCancel('a', daysAgo(5)), lateCancel('b', daysAgo(4))],
      [],
      NOW,
      CONFIG,
    );

    const preview = previewStrike(state, 'LATE_CANCEL', CONFIG);
    expect(preview.newWeight).toBe(3);
    expect(preview.willSuspend).toBe(false);
    expect(preview.message).toContain('3 of 4');

    const noShowPreview = previewStrike(state, 'NO_SHOW', CONFIG);
    expect(noShowPreview.willSuspend).toBe(true);
    expect(noShowPreview.message).toContain('pauses your bookings');
  });
});
