import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bookClass, cancelBooking, markNoShow, setBookingPaid } from '@/lib/services/booking';
import { localToUtc, toLocalDate } from '@/lib/time';
import {
  createClass,
  createUser,
  givePasses,
  passesLeft,
  prisma,
  resetDb,
} from './helpers';

/**
 * These run against real Postgres and the real booking path, because the whole
 * point of the entitlement rules is what happens when somebody presses Book.
 */

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * A fixed week so the Monday-to-Sunday counting is unambiguous:
 * 2026-09-07 is a Monday, 2026-09-13 the Sunday that closes the same week, and
 * 2026-09-14 the Monday that opens the next one.
 */
const MON = '2026-09-07';
const TUE = '2026-09-08';
const WED = '2026-09-09';
const THU = '2026-09-10';
const FRI = '2026-09-11';
const SUN = '2026-09-13';
const NEXT_MON = '2026-09-14';

/** A moment well before any of those classes, so nothing is a late cancel. */
const NOW = localToUtc('2026-09-01', '09:00');

async function book(member: { id: string; email: string; name: string; role: 'MEMBER' | 'COACH' | 'OWNER' }, classInstanceId: string) {
  return bookClass(member, { classInstanceId }, NOW);
}

async function expectRefused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected the booking to be refused, but it went through');
  } catch (error) {
    return (error as Error).message;
  }
}

describe('weekly class limits', () => {
  it('lets a Tier 1 member book three in a week and stops the fourth', async () => {
    const member = await createUser('MEMBER', 'Tier One', { plan: 'TIER1' });
    const classes = await Promise.all(
      [MON, TUE, WED, THU].map((date) => createClass({ date, capacity: 10 })),
    );

    for (const cls of classes.slice(0, 3)) {
      await expect(book(member, cls.id)).resolves.toMatchObject({ waitlisted: false });
    }

    const message = await expectRefused(book(member, classes[3].id));
    expect(message).toContain('3');
    expect(message).toContain('Monday');
  });

  it('starts the count again on Monday, not on a rolling seven days', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    const thisWeek = await Promise.all(
      [FRI, SUN].map((date) => createClass({ date, capacity: 10 })),
    );
    const nextWeek = await createClass({ date: NEXT_MON, capacity: 10 });

    for (const cls of thisWeek) await book(member, cls.id);
    // Friday and Sunday used up the two; the Monday two days later is a new week.
    await expect(book(member, nextWeek.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('hands the week’s slot back when a member cancels in time', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    const [a, b, c] = await Promise.all(
      [MON, TUE, WED].map((date) => createClass({ date, capacity: 10 })),
    );

    const first = await book(member, a.id);
    await book(member, b.id);
    await expectRefused(book(member, c.id));

    await cancelBooking(member, first.booking.id, NOW);
    await expect(book(member, c.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('does not hand the slot back on a late cancel', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    const [a, b, c] = await Promise.all(
      [MON, TUE, WED].map((date) => createClass({ date, capacity: 10, startTimeLocal: '17:30' })),
    );

    const first = await book(member, a.id);
    await book(member, b.id);

    // Ten minutes before Monday's class: inside the two-hour window.
    const late = new Date(localToUtc(MON, '17:30').getTime() - 10 * 60_000);
    const result = await cancelBooking(member, first.booking.id, late);
    expect(result.outcome.isLate).toBe(true);

    // The slot is gone: they held it past the point anyone else could take it.
    await expectRefused(book(member, c.id));
  });

  it('offers no waitlist once the weekly limit is reached', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    const [a, b] = await Promise.all(
      [MON, TUE].map((date) => createClass({ date, capacity: 10 })),
    );
    // A full class, so a booking would otherwise land on the waitlist.
    const full = await createClass({ date: WED, capacity: 1 });
    const someoneElse = await createUser('MEMBER', 'Regular');
    await book(someoneElse, full.id);

    await book(member, a.id);
    await book(member, b.id);

    await expectRefused(book(member, full.id));
    const waitlisted = await prisma.booking.count({
      where: { memberId: member.id, status: 'WAITLISTED' },
    });
    expect(waitlisted).toBe(0);
  });

  it('leaves the unlimited plan uncapped', async () => {
    const member = await createUser('MEMBER', 'All In', { plan: 'UNLIMITED' });
    const dates = [MON, TUE, WED, THU, FRI];
    for (const date of dates) {
      const cls = await createClass({ date, capacity: 10 });
      await expect(book(member, cls.id)).resolves.toMatchObject({ waitlisted: false });
    }
  });
});

describe('plans that only cover some classes', () => {
  it('lets the HYROX plan into Wednesday and Friday HYROX', async () => {
    const member = await createUser('MEMBER', 'Hyroxer', { plan: 'HYROX_WF' });
    const wed = await createClass({ date: WED, name: 'HYROX', capacity: 10 });
    const fri = await createClass({ date: FRI, name: 'HYROX', capacity: 10 });

    await expect(book(member, wed.id)).resolves.toMatchObject({ waitlisted: false });
    await expect(book(member, fri.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('keeps the HYROX plan out of a Monday BLITZ42, by name', async () => {
    const member = await createUser('MEMBER', 'Hyroxer', { plan: 'HYROX_WF' });
    const blitz = await createClass({ date: MON, name: 'BLITZ42', capacity: 10 });

    const message = await expectRefused(book(member, blitz.id));
    expect(message).toContain('BLITZ42');
    expect(message).not.toContain('HYROX_WF');
  });

  it('lets Off Peak into a 9:30 but not the evening', async () => {
    const member = await createUser('MEMBER', 'Off Peaker', { plan: 'OFF_PEAK' });
    const morning = await createClass({ date: MON, startTimeLocal: '09:30', capacity: 10 });
    const evening = await createClass({ date: MON, startTimeLocal: '18:30', capacity: 10 });

    await expect(book(member, morning.id)).resolves.toMatchObject({ waitlisted: false });
    await expectRefused(book(member, evening.id));
  });

  it('lets Off Peak into the Thursday 4:30', async () => {
    const member = await createUser('MEMBER', 'Off Peaker', { plan: 'OFF_PEAK' });
    const cls = await createClass({ date: THU, startTimeLocal: '16:30', capacity: 10 });
    await expect(book(member, cls.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('keeps Off Peak out of a Wednesday 9:30 if one is ever added', async () => {
    // There is no Wednesday 9:30 on the timetable today. The plan states its
    // days anyway, so adding one later does not quietly widen the plan.
    const member = await createUser('MEMBER', 'Off Peaker', { plan: 'OFF_PEAK' });
    const cls = await createClass({ date: WED, startTimeLocal: '09:30', capacity: 10 });
    await expectRefused(book(member, cls.id));
  });
});

describe('pay-as-you-go classes', () => {
  it('lets somebody with no membership at all book one', async () => {
    const member = await createUser('MEMBER', 'Drop In', { paying: false });
    const sunday = await createClass({ date: SUN, name: 'HYROX', payg: true, capacity: 10 });

    await expect(book(member, sunday.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('does not count toward a capped plan’s week', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    const sunday = await createClass({ date: SUN, name: 'HYROX', payg: true, capacity: 10 });
    const [a, b] = await Promise.all(
      [MON, TUE].map((date) => createClass({ date, capacity: 10 })),
    );

    await book(member, sunday.id);
    // Their two plan classes are both still there.
    await expect(book(member, a.id)).resolves.toMatchObject({ waitlisted: false });
    await expect(book(member, b.id)).resolves.toMatchObject({ waitlisted: false });
  });

  it('never spends a class pass', async () => {
    const member = await createUser('MEMBER', 'Drop In', { paying: false });
    await givePasses(member.id, 5);
    const sunday = await createClass({ date: SUN, name: 'HYROX', payg: true, capacity: 10 });

    const result = await book(member, sunday.id);
    expect(result.booking.passPackId).toBeNull();
    expect(await passesLeft(member.id)).toBe(5);
  });

  it('is ticked off as paid by a coach, and can be un-ticked', async () => {
    const coach = await createUser('COACH', 'Coach Kim');
    const member = await createUser('MEMBER', 'Drop In', { paying: false });
    const sunday = await createClass({ date: SUN, payg: true, capacity: 10 });
    const { booking } = await book(member, sunday.id);

    const paid = await setBookingPaid(coach, booking.id, true, NOW);
    expect(paid.paidAt).not.toBeNull();
    expect(paid.paidById).toBe(coach.id);

    const undone = await setBookingPaid(coach, booking.id, false, NOW);
    expect(undone.paidAt).toBeNull();
  });

  it('has nothing to collect on a class the membership already covers', async () => {
    const coach = await createUser('COACH', 'Coach Kim');
    const member = await createUser('MEMBER', 'Regular');
    const cls = await createClass({ date: MON, capacity: 10 });
    const { booking } = await book(member, cls.id);

    await expect(setBookingPaid(coach, booking.id, true, NOW)).rejects.toThrow(
      /covered by membership/i,
    );
  });

  it('cannot be ticked paid by a member', async () => {
    const member = await createUser('MEMBER', 'Drop In', { paying: false });
    const sunday = await createClass({ date: SUN, payg: true, capacity: 10 });
    const { booking } = await book(member, sunday.id);

    await expect(setBookingPaid(member, booking.id, true, NOW)).rejects.toThrow();
  });
});

describe('class passes', () => {
  it('gets a lapsed member into a class and spends one pass', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 5);
    const cls = await createClass({ date: MON, capacity: 10 });

    const result = await book(member, cls.id);
    expect(result.booking.passPackId).not.toBeNull();
    expect(await passesLeft(member.id)).toBe(4);
  });

  it('runs out, and says so', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 1);
    const [a, b] = await Promise.all(
      [MON, TUE].map((date) => createClass({ date, capacity: 10 })),
    );

    await book(member, a.id);
    const message = await expectRefused(book(member, b.id));
    expect(message).toMatch(/passes/i);
  });

  it('will not accept an expired pack', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 5, { expiresAt: new Date(NOW.getTime() - 86_400_000) });
    const cls = await createClass({ date: MON, capacity: 10 });

    await expectRefused(book(member, cls.id));
  });

  it('spends from the pack that expires first', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    const soon = await givePasses(member.id, 2, {
      expiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
    });
    await givePasses(member.id, 10, { expiresAt: new Date(NOW.getTime() + 90 * 86_400_000) });
    const cls = await createClass({ date: MON, capacity: 10 });

    const result = await book(member, cls.id);
    expect(result.booking.passPackId).toBe(soon.id);
  });

  it('hands the pass back when the member cancels in time', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 3);
    const cls = await createClass({ date: MON, capacity: 10 });

    const { booking } = await book(member, cls.id);
    expect(await passesLeft(member.id)).toBe(2);

    await cancelBooking(member, booking.id, NOW);
    expect(await passesLeft(member.id)).toBe(3);
  });

  it('burns the pass on a late cancel', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 3);
    const cls = await createClass({ date: MON, startTimeLocal: '17:30', capacity: 10 });

    const { booking } = await book(member, cls.id);
    const late = new Date(localToUtc(MON, '17:30').getTime() - 10 * 60_000);
    const result = await cancelBooking(member, booking.id, late);

    expect(result.outcome.isLate).toBe(true);
    expect(await passesLeft(member.id)).toBe(2);
  });

  it('burns the pass on a no-show', async () => {
    const coach = await createUser('COACH', 'Coach Kim');
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 3);
    const cls = await createClass({ date: MON, startTimeLocal: '17:30', capacity: 10 });

    const { booking } = await book(member, cls.id);
    const afterStart = new Date(localToUtc(MON, '17:30').getTime() + 5 * 60_000);
    await markNoShow(coach, booking.id, afterStart);

    expect(await passesLeft(member.id)).toBe(2);
  });

  it('does not spend a pass to sit on a waitlist', async () => {
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    await givePasses(member.id, 3);
    const other = await createUser('MEMBER', 'Regular');
    const cls = await createClass({ date: MON, capacity: 1 });

    await book(other, cls.id);
    const result = await book(member, cls.id);

    expect(result.waitlisted).toBe(true);
    expect(result.booking.passPackId).toBeNull();
    expect(await passesLeft(member.id)).toBe(3);
  });

  it('is not spent when the plan already covers the class', async () => {
    const member = await createUser('MEMBER', 'All In', { plan: 'UNLIMITED' });
    await givePasses(member.id, 5);
    const cls = await createClass({ date: MON, capacity: 10 });

    const result = await book(member, cls.id);
    expect(result.booking.passPackId).toBeNull();
    expect(await passesLeft(member.id)).toBe(5);
  });

  it('covers a class the plan excludes without touching the plan’s week', async () => {
    const member = await createUser('MEMBER', 'Tier Two', { plan: 'TIER2' });
    await givePasses(member.id, 5);
    const [a, b, extra] = await Promise.all(
      [MON, TUE, WED].map((date) => createClass({ date, capacity: 10 })),
    );

    await book(member, a.id);
    await book(member, b.id);

    // Third class of the week: the plan is spent, so the pass covers it.
    const third = await book(member, extra.id);
    expect(third.booking.passPackId).not.toBeNull();
    expect(await passesLeft(member.id)).toBe(4);

    // And that pass-paid class does not eat into next week either.
    const nextWeek = await createClass({ date: NEXT_MON, capacity: 10 });
    const after = await book(member, nextWeek.id);
    expect(after.booking.passPackId).toBeNull();
  });
});

describe('the coach adding somebody by hand', () => {
  it('is never blocked by entitlement — the coach is the judgement call', async () => {
    const coach = await createUser('COACH', 'Coach Kim');
    const member = await createUser('MEMBER', 'Lapsed', { paying: false });
    const cls = await createClass({ date: MON, capacity: 10 });

    const result = await bookClass(
      coach,
      { classInstanceId: cls.id, memberId: member.id, source: 'WALK_IN' },
      NOW,
    );
    expect(result.waitlisted).toBe(false);
    expect(result.booking.passPackId).toBeNull();
  });
});

describe('the generated timetable', () => {
  it('marks only the Sunday class pay-as-you-go', async () => {
    const { DEFAULT_TEMPLATE_SHAPES } = await import('@/lib/bootstrap');
    const payg = DEFAULT_TEMPLATE_SHAPES.filter((shape) => shape.payg);

    expect(payg).toHaveLength(1);
    expect(payg[0]).toMatchObject({ dayOfWeek: 7, name: 'HYROX', startTimeLocal: '09:30' });
  });

  it('carries payg from template to generated class', async () => {
    const { generateClassInstances } = await import('@/lib/services/schedule');
    await prisma.classTemplate.create({
      data: {
        name: 'HYROX',
        dayOfWeek: 7,
        startTimeLocal: '09:30',
        durationMinutes: 42,
        capacity: 30,
        payg: true,
        cancelPolicyType: 'NONE',
        activeFrom: MON,
      },
    });

    await generateClassInstances(MON, toLocalDate(localToUtc(NEXT_MON, '12:00')));
    const sunday = await prisma.classInstance.findFirst({ where: { date: SUN } });
    expect(sunday?.payg).toBe(true);
  });
});
