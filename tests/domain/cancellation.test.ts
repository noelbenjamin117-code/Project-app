import { describe, expect, it } from 'vitest';
import {
  classCancelDeadline,
  effectiveCancelDeadline,
  evaluateCancellation,
} from '@/lib/domain/cancellation';
import { localToUtc } from '@/lib/time';

const GRACE = { freshBookingMinutes: 15, waitlistPromotionMinutes: 30 };

/** A booking made comfortably in advance, so no grace window is in play. */
const bookedLongAgo = { bookedAt: localToUtc('2026-06-01', '10:00') };

describe('ABSOLUTE cancellation window (9pm the previous day)', () => {
  const startsAt = localToUtc('2026-06-15', '06:00');
  const deadline = classCancelDeadline('2026-06-15', startsAt, {
    type: 'ABSOLUTE',
    absoluteTimeLocal: '21:00',
  });

  const evaluate = (nowLocal: [string, string]) =>
    evaluateCancellation({
      now: localToUtc(nowLocal[0], nowLocal[1]),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

  it('is free well before the deadline', () => {
    expect(evaluate(['2026-06-14', '18:00']).isLate).toBe(false);
  });

  it('is free at exactly 9:00pm the previous day', () => {
    expect(evaluate(['2026-06-14', '21:00']).isLate).toBe(false);
  });

  it('is late one minute after the deadline', () => {
    expect(evaluate(['2026-06-14', '21:01']).isLate).toBe(true);
  });

  it('is late the following morning, before the class', () => {
    expect(evaluate(['2026-06-15', '05:00']).isLate).toBe(true);
  });
});

describe('RELATIVE cancellation window (2 hours before)', () => {
  const startsAt = localToUtc('2026-06-15', '17:30');
  const deadline = classCancelDeadline('2026-06-15', startsAt, {
    type: 'RELATIVE',
    relativeHours: 2,
  });

  const evaluate = (time: string) =>
    evaluateCancellation({
      now: localToUtc('2026-06-15', time),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

  it('is free more than two hours out', () => {
    expect(evaluate('15:00').isLate).toBe(false);
  });

  it('is free at exactly two hours out', () => {
    expect(evaluate('15:30').isLate).toBe(false);
  });

  it('is late inside two hours', () => {
    expect(evaluate('15:31').isLate).toBe(true);
    expect(evaluate('17:00').isLate).toBe(true);
  });
});

describe('NONE cancellation window', () => {
  const startsAt = localToUtc('2026-06-15', '09:30');
  const deadline = classCancelDeadline('2026-06-15', startsAt, { type: 'NONE' });

  const evaluate = (time: string) =>
    evaluateCancellation({
      now: localToUtc('2026-06-15', time),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

  it('is free any time right up to the start', () => {
    expect(evaluate('08:00').isLate).toBe(false);
    expect(evaluate('09:29').isLate).toBe(false);
    expect(evaluate('09:30').isLate).toBe(false);
  });

  it('is late only once the class has started', () => {
    expect(evaluate('09:31').isLate).toBe(true);
  });
});

describe('grace windows', () => {
  const startsAt = localToUtc('2026-06-15', '06:00');
  const deadline = classCancelDeadline('2026-06-15', startsAt, {
    type: 'ABSOLUTE',
    absoluteTimeLocal: '21:00',
  });

  it('never counts a cancel within 15 minutes of booking, even well past the deadline', () => {
    // Booked at 5:00am on the day, long after the 9pm deadline passed.
    const bookedAt = localToUtc('2026-06-15', '05:00');
    const outcome = evaluateCancellation({
      now: localToUtc('2026-06-15', '05:10'),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: { bookedAt },
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(false);
    expect(outcome.reason).toBe('FRESH_BOOKING');
  });

  it('starts counting again once the fat-finger window closes', () => {
    const bookedAt = localToUtc('2026-06-15', '05:00');
    const outcome = evaluateCancellation({
      now: localToUtc('2026-06-15', '05:16'),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: { bookedAt },
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(true);
  });

  it('gives a member promoted inside the window a fresh 30 minutes', () => {
    // Promoted at 5:00am, well after the 9pm deadline — not their choice.
    const promotedAt = localToUtc('2026-06-15', '05:00');
    const outcome = evaluateCancellation({
      now: localToUtc('2026-06-15', '05:25'),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: { bookedAt: localToUtc('2026-06-10', '12:00'), promotedAt },
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(false);
    expect(outcome.reason).toBe('WAITLIST_PROMOTION');
    expect(outcome.deadline.toISOString()).toBe(
      new Date(promotedAt.getTime() + 30 * 60_000).toISOString(),
    );
  });

  it('counts a late cancel once the promotion grace expires', () => {
    const promotedAt = localToUtc('2026-06-15', '05:00');
    const outcome = evaluateCancellation({
      now: localToUtc('2026-06-15', '05:31'),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: { bookedAt: localToUtc('2026-06-10', '12:00'), promotedAt },
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(true);
  });

  it('does not shorten a deadline that is already later than the grace window', () => {
    // Promoted a week early: the class policy is the more generous rule.
    const promotedAt = localToUtc('2026-06-08', '12:00');
    const outcome = effectiveCancelDeadline(
      deadline,
      { bookedAt: localToUtc('2026-06-08', '11:00'), promotedAt },
      GRACE,
    );

    expect(outcome.deadline.getTime()).toBe(deadline.getTime());
    expect(outcome.reason).toBe('POLICY');
  });
});

describe('exemptions', () => {
  const startsAt = localToUtc('2026-06-15', '06:00');
  const deadline = classCancelDeadline('2026-06-15', startsAt, {
    type: 'ABSOLUTE',
    absoluteTimeLocal: '21:00',
  });
  // Deliberately way past the deadline, so only the exemption can save them.
  const now = localToUtc('2026-06-15', '05:55');

  it('gives no strike when the gym cancelled the class', () => {
    const outcome = evaluateCancellation({
      now,
      classStatus: 'CANCELLED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(false);
    expect(outcome.exemption).toBe('GYM_CANCELLED');
  });

  it('gives no strike to a member who never came off the waitlist', () => {
    const outcome = evaluateCancellation({
      now,
      classStatus: 'SCHEDULED',
      bookingStatus: 'WAITLISTED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

    expect(outcome.isLate).toBe(false);
    expect(outcome.exemption).toBe('WAITLISTED');
  });

  it('reports a within-deadline cancel as exempt rather than merely not-late', () => {
    const outcome = evaluateCancellation({
      now: localToUtc('2026-06-14', '20:00'),
      classStatus: 'SCHEDULED',
      bookingStatus: 'BOOKED',
      classDeadline: deadline,
      booking: bookedLongAgo,
      grace: GRACE,
    });

    expect(outcome.exemption).toBe('WITHIN_DEADLINE');
  });
});
