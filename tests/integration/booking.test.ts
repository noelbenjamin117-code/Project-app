import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bookClass, cancelBooking, cancelClassInstance } from '@/lib/services/booking';
import { getStrikeState } from '@/lib/services/strikes';
import { localToUtc, toLocalDate } from '@/lib/time';
import {
  bookedMemberIds,
  createClass,
  createUser,
  prisma,
  resetDb,
  waitlistOrder,
} from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('capacity', () => {
  it('books members up to capacity and waitlists the rest', async () => {
    const cls = await createClass({ capacity: 2 });
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()]);

    const first = await bookClass(a, { classInstanceId: cls.id });
    const second = await bookClass(b, { classInstanceId: cls.id });
    const third = await bookClass(c, { classInstanceId: cls.id });

    expect(first.waitlisted).toBe(false);
    expect(second.waitlisted).toBe(false);
    expect(third.waitlisted).toBe(true);
    expect(third.waitlistPosition).toBe(1);

    expect(await bookedMemberIds(cls.id)).toHaveLength(2);
  });

  it('never exceeds capacity when everyone books at the same instant', async () => {
    const cls = await createClass({ capacity: 3 });
    const members = await Promise.all(Array.from({ length: 10 }, () => createUser()));

    // The class row lock is what makes this safe: the bookings serialise on it.
    await Promise.all(members.map((m) => bookClass(m, { classInstanceId: cls.id })));

    expect(await bookedMemberIds(cls.id)).toHaveLength(3);
    expect(await waitlistOrder(cls.id)).toHaveLength(7);
  });

  it('refuses a second live booking for the same member', async () => {
    const cls = await createClass();
    const member = await createUser();

    await bookClass(member, { classInstanceId: cls.id });
    await expect(bookClass(member, { classInstanceId: cls.id })).rejects.toThrow(
      /already booked/i,
    );
  });

  it('lets a member re-book after cancelling', async () => {
    const cls = await createClass();
    const member = await createUser();

    const { booking } = await bookClass(member, { classInstanceId: cls.id });
    await cancelBooking(member, booking.id);

    const again = await bookClass(member, { classInstanceId: cls.id });
    expect(again.waitlisted).toBe(false);
  });

  it('refuses to book a cancelled class or one that already started', async () => {
    const cancelled = await createClass();
    const coach = await createUser('COACH');
    await cancelClassInstance(coach, cancelled.id, 'Snow');

    const member = await createUser();
    await expect(bookClass(member, { classInstanceId: cancelled.id })).rejects.toThrow(
      /cancelled/i,
    );

    const past = await createClass({
      date: toLocalDate(new Date(Date.now() - 2 * 86_400_000)),
    });
    await expect(bookClass(member, { classInstanceId: past.id })).rejects.toThrow(
      /already started/i,
    );
  });
});

describe('waitlist promotion', () => {
  it('promotes the longest-waiting member when a spot frees', async () => {
    const cls = await createClass({ capacity: 1 });
    const [holder, first, second] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
    ]);

    const held = await bookClass(holder, { classInstanceId: cls.id });
    // Distinct waitlist timestamps, joined in a known order.
    await bookClass(first, { classInstanceId: cls.id }, new Date(Date.now() - 60_000));
    await bookClass(second, { classInstanceId: cls.id }, new Date());

    expect(await waitlistOrder(cls.id)).toEqual([first.id, second.id]);

    const result = await cancelBooking(holder, held.booking.id);

    expect(result.promotedMemberId).toBe(first.id);
    expect(await bookedMemberIds(cls.id)).toEqual([first.id]);
    expect(await waitlistOrder(cls.id)).toEqual([second.id]);
  });

  it('stamps promotedAt so the promoted member gets their grace window', async () => {
    const cls = await createClass({ capacity: 1 });
    const [holder, waiting] = await Promise.all([createUser(), createUser()]);

    const held = await bookClass(holder, { classInstanceId: cls.id });
    await bookClass(waiting, { classInstanceId: cls.id });
    await cancelBooking(holder, held.booking.id);

    const promoted = await prisma.booking.findFirstOrThrow({
      where: { classInstanceId: cls.id, memberId: waiting.id },
    });
    expect(promoted.status).toBe('BOOKED');
    expect(promoted.promotedAt).not.toBeNull();
  });

  it('promotes two different people when two members cancel at the same instant', async () => {
    const cls = await createClass({ capacity: 2 });
    const [holderA, holderB, waitA, waitB, waitC] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);

    const a = await bookClass(holderA, { classInstanceId: cls.id });
    const b = await bookClass(holderB, { classInstanceId: cls.id });
    await bookClass(waitA, { classInstanceId: cls.id }, new Date(Date.now() - 120_000));
    await bookClass(waitB, { classInstanceId: cls.id }, new Date(Date.now() - 60_000));
    await bookClass(waitC, { classInstanceId: cls.id }, new Date());

    // The race the row lock exists for: without it both cancels could promote
    // the same person, or overfill the class.
    const [resultA, resultB] = await Promise.all([
      cancelBooking(holderA, a.booking.id),
      cancelBooking(holderB, b.booking.id),
    ]);

    const promoted = [resultA.promotedMemberId, resultB.promotedMemberId].sort();
    expect(promoted).toEqual([waitA.id, waitB.id].sort());

    const booked = await bookedMemberIds(cls.id);
    expect(booked).toHaveLength(2);
    expect(new Set(booked)).toEqual(new Set([waitA.id, waitB.id]));
    expect(await waitlistOrder(cls.id)).toEqual([waitC.id]);
  });

  it('does not promote anyone when a waitlisted member leaves the waitlist', async () => {
    const cls = await createClass({ capacity: 1 });
    const [holder, first, second] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
    ]);

    await bookClass(holder, { classInstanceId: cls.id });
    const waiting = await bookClass(first, { classInstanceId: cls.id });
    await bookClass(second, { classInstanceId: cls.id });

    const result = await cancelBooking(first, waiting.booking.id);

    expect(result.promotedMemberId).toBeNull();
    expect(await bookedMemberIds(cls.id)).toEqual([holder.id]);
    expect(await waitlistOrder(cls.id)).toEqual([second.id]);
  });

  it('still promotes when the person cancelling is late', async () => {
    // 5:30pm class with a 2-hour rule; cancelling at 5:00pm is late.
    const date = toLocalDate(new Date(Date.now() + 86_400_000));
    const cls = await createClass({ date, capacity: 1, policy: 'RELATIVE', relativeHours: 2 });
    const [holder, waiting] = await Promise.all([createUser(), createUser()]);

    const held = await bookClass(holder, { classInstanceId: cls.id });
    await bookClass(waiting, { classInstanceId: cls.id });

    const result = await cancelBooking(holder, held.booking.id, localToUtc(date, '17:00'));

    expect(result.outcome.isLate).toBe(true);
    // A late cancel is still a freed spot for the next person.
    expect(result.promotedMemberId).toBe(waiting.id);
  });
});

describe('suspension blocks new bookings', () => {
  it('stops a suspended member booking, but a coach can still add them', async () => {
    const member = await createUser();
    const coach = await createUser('COACH');
    const cls = await createClass({ capacity: 5 });

    // Four weighted strikes in the window.
    const past = await createClass({
      date: toLocalDate(new Date(Date.now() - 5 * 86_400_000)),
    });
    for (const [index, type] of (['NO_SHOW', 'NO_SHOW'] as const).entries()) {
      const booking = await prisma.booking.create({
        data: {
          classInstanceId: past.id,
          memberId: member.id,
          status: 'CANCELLED',
          bookedAt: new Date(Date.now() - 6 * 86_400_000),
        },
      });
      await prisma.strikeEvent.create({
        data: {
          memberId: member.id,
          bookingId: booking.id,
          type,
          weight: 2,
          occurredAt: new Date(Date.now() - (index + 1) * 86_400_000),
        },
      });
    }

    expect((await getStrikeState(member.id)).suspended).toBe(true);

    await expect(bookClass(member, { classInstanceId: cls.id })).rejects.toThrow(/paused/i);

    // A coach putting someone in by hand is a deliberate override.
    const added = await bookClass(coach, { classInstanceId: cls.id, memberId: member.id });
    expect(added.booking.status).toBe('BOOKED');
  });
});
