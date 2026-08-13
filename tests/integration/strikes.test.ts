import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookClass,
  cancelBooking,
  cancelClassInstance,
  checkIn,
  markNoShow,
  unmarkNoShow,
} from '@/lib/services/booking';
import { forgiveStrike, getStrikeState, liftSuspension } from '@/lib/services/strikes';
import { localToUtc, toLocalDate } from '@/lib/time';
import { createClass, createUser, prisma, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

/** Tomorrow, so a 5:30pm class with a 2-hour rule is still cancellable. */
const tomorrow = () => toLocalDate(new Date(Date.now() + 86_400_000));

describe('late cancels', () => {
  it('records a strike and flags the booking', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, policy: 'RELATIVE', relativeHours: 2 });
    const member = await createUser();

    const { booking } = await bookClass(
      member,
      { classInstanceId: cls.id },
      localToUtc(date, '08:00'),
    );
    const result = await cancelBooking(member, booking.id, localToUtc(date, '17:00'));

    expect(result.outcome.isLate).toBe(true);
    expect(result.booking.lateCancel).toBe(true);
    expect(result.strikeState.currentWeight).toBe(1);

    const strikes = await prisma.strikeEvent.findMany({ where: { memberId: member.id } });
    expect(strikes).toHaveLength(1);
    expect(strikes[0].type).toBe('LATE_CANCEL');
  });

  it('records nothing when cancelling inside the window', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, policy: 'RELATIVE', relativeHours: 2 });
    const member = await createUser();

    const { booking } = await bookClass(
      member,
      { classInstanceId: cls.id },
      localToUtc(date, '08:00'),
    );
    const result = await cancelBooking(member, booking.id, localToUtc(date, '12:00'));

    expect(result.outcome.isLate).toBe(false);
    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(0);
  });

  it('never counts a cancel made within 15 minutes of booking', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, policy: 'RELATIVE', relativeHours: 2 });
    const member = await createUser();

    // Booked at 5pm — already inside the 3:30pm deadline — then thought better of it.
    const bookedAt = localToUtc(date, '17:00');
    const { booking } = await bookClass(member, { classInstanceId: cls.id }, bookedAt);
    const result = await cancelBooking(member, booking.id, localToUtc(date, '17:10'));

    expect(result.outcome.isLate).toBe(false);
    expect(result.outcome.reason).toBe('FRESH_BOOKING');
    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(0);
  });

  it('gives a promoted member a fresh grace window, end to end', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, capacity: 1, policy: 'RELATIVE', relativeHours: 2 });
    const [holder, waiting] = await Promise.all([createUser(), createUser()]);

    const early = localToUtc(date, '08:00');
    const held = await bookClass(holder, { classInstanceId: cls.id }, early);
    await bookClass(waiting, { classInstanceId: cls.id }, early);

    // Holder cancels at 5:00pm — late for them, and it promotes the waiter
    // well inside the 3:30pm deadline.
    const promotionTime = localToUtc(date, '17:00');
    await cancelBooking(holder, held.booking.id, promotionTime);

    const promoted = await prisma.booking.findFirstOrThrow({
      where: { classInstanceId: cls.id, memberId: waiting.id },
    });
    expect(promoted.status).toBe('BOOKED');

    // 20 minutes later they cancel: inside their 30-minute promotion grace.
    const result = await cancelBooking(
      waiting,
      promoted.id,
      new Date(promotionTime.getTime() + 20 * 60_000),
    );

    expect(result.outcome.isLate).toBe(false);
    expect(result.outcome.reason).toBe('WAITLIST_PROMOTION');
    expect(await prisma.strikeEvent.count({ where: { memberId: waiting.id } })).toBe(0);
  });

  it('does count the promoted member once their grace has run out', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, capacity: 1, policy: 'RELATIVE', relativeHours: 2 });
    const [holder, waiting] = await Promise.all([createUser(), createUser()]);

    const early = localToUtc(date, '08:00');
    const held = await bookClass(holder, { classInstanceId: cls.id }, early);
    await bookClass(waiting, { classInstanceId: cls.id }, early);

    const promotionTime = localToUtc(date, '16:00');
    await cancelBooking(holder, held.booking.id, promotionTime);

    const promoted = await prisma.booking.findFirstOrThrow({
      where: { classInstanceId: cls.id, memberId: waiting.id },
    });
    const result = await cancelBooking(
      waiting,
      promoted.id,
      new Date(promotionTime.getTime() + 31 * 60_000),
    );

    expect(result.outcome.isLate).toBe(true);
  });

  it('gives no strike to a member who never came off the waitlist', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, capacity: 1, policy: 'RELATIVE', relativeHours: 2 });
    const [holder, waiting] = await Promise.all([createUser(), createUser()]);

    const early = localToUtc(date, '08:00');
    await bookClass(holder, { classInstanceId: cls.id }, early);
    const queued = await bookClass(waiting, { classInstanceId: cls.id }, early);

    // Leaves the waitlist at 5pm, long past the deadline.
    const result = await cancelBooking(waiting, queued.booking.id, localToUtc(date, '17:00'));

    expect(result.outcome.isLate).toBe(false);
    expect(result.outcome.exemption).toBe('WAITLISTED');
    expect(await prisma.strikeEvent.count({ where: { memberId: waiting.id } })).toBe(0);
  });
});

describe('gym-cancelled classes', () => {
  it('releases every booking without a single strike', async () => {
    const cls = await createClass({ capacity: 2 });
    const coach = await createUser('COACH');
    const members = await Promise.all([createUser(), createUser(), createUser()]);

    for (const member of members) {
      await bookClass(member, { classInstanceId: cls.id });
    }

    const { notifiedMemberIds } = await cancelClassInstance(coach, cls.id, 'Coach out sick');

    expect(notifiedMemberIds).toHaveLength(3);
    expect(await prisma.strikeEvent.count()).toBe(0);
    expect(
      await prisma.booking.count({ where: { classInstanceId: cls.id, status: 'CANCELLED' } }),
    ).toBe(3);

    for (const member of members) {
      expect((await getStrikeState(member.id)).currentWeight).toBe(0);
    }
  });

  it('withdraws a strike that was already recorded for that class', async () => {
    const date = tomorrow();
    const cls = await createClass({ date, policy: 'RELATIVE', relativeHours: 2 });
    const coach = await createUser('COACH');
    const member = await createUser();

    const { booking } = await bookClass(
      member,
      { classInstanceId: cls.id },
      localToUtc(date, '08:00'),
    );
    await cancelBooking(member, booking.id, localToUtc(date, '17:00'));
    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(1);

    // The gym then calls the class off entirely — that strike is not deserved.
    await cancelClassInstance(coach, cls.id, 'Power cut');

    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(0);
    expect((await getStrikeState(member.id)).currentWeight).toBe(0);
  });
});

describe('no-shows', () => {
  const pastDate = () => toLocalDate(new Date(Date.now() - 2 * 86_400_000));

  async function bookedPastClass() {
    const date = pastDate();
    const cls = await createClass({ date, policy: 'NONE' });
    const member = await createUser();
    const booking = await prisma.booking.create({
      data: {
        classInstanceId: cls.id,
        memberId: member.id,
        status: 'BOOKED',
        bookedAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    return { cls, member, booking };
  }

  it('is worth two strikes and is coach-marked only', async () => {
    const coach = await createUser('COACH');
    const { member, booking } = await bookedPastClass();

    const { strikeState } = await markNoShow(coach, booking.id);

    expect(strikeState.currentWeight).toBe(2);
    const strike = await prisma.strikeEvent.findFirstOrThrow({ where: { memberId: member.id } });
    expect(strike.type).toBe('NO_SHOW');
    expect(strike.weight).toBe(2);
  });

  it('cannot be marked before the class has started', async () => {
    const coach = await createUser('COACH');
    const cls = await createClass({ date: tomorrow() });
    const member = await createUser();
    const { booking } = await bookClass(member, { classInstanceId: cls.id });

    await expect(markNoShow(coach, booking.id)).rejects.toThrow(/hasn't started/i);
  });

  it('is withdrawn when the coach undoes it', async () => {
    const coach = await createUser('COACH');
    const { member, booking } = await bookedPastClass();

    await markNoShow(coach, booking.id);
    await unmarkNoShow(coach, booking.id);

    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(0);
    expect((await getStrikeState(member.id)).currentWeight).toBe(0);
  });

  it('is withdrawn when the member turns out to have been checked in', async () => {
    const coach = await createUser('COACH');
    const { member, booking } = await bookedPastClass();

    await markNoShow(coach, booking.id);
    await checkIn(coach, booking.id);

    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(0);
  });

  it('cannot strike the same booking twice', async () => {
    const coach = await createUser('COACH');
    const { member, booking } = await bookedPastClass();

    await markNoShow(coach, booking.id);
    await markNoShow(coach, booking.id);

    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(1);
  });
});

describe('forgiveness and lifting', () => {
  async function suspendedMember() {
    const member = await createUser();
    const cls = await createClass({
      date: toLocalDate(new Date(Date.now() - 5 * 86_400_000)),
    });

    for (let i = 0; i < 2; i++) {
      const booking = await prisma.booking.create({
        data: {
          classInstanceId: cls.id,
          memberId: member.id,
          status: 'CANCELLED',
          bookedAt: new Date(Date.now() - 6 * 86_400_000),
        },
      });
      await prisma.strikeEvent.create({
        data: {
          memberId: member.id,
          bookingId: booking.id,
          type: 'NO_SHOW',
          weight: 2,
          occurredAt: new Date(Date.now() - (i + 1) * 86_400_000),
        },
      });
    }
    return member;
  }

  it('recomputes the suspension away when a coach forgives a strike', async () => {
    const member = await suspendedMember();
    const coach = await createUser('COACH');

    expect((await getStrikeState(member.id)).suspended).toBe(true);

    const strike = await prisma.strikeEvent.findFirstOrThrow({ where: { memberId: member.id } });
    const state = await forgiveStrike(strike.id, coach, 'Sick kid, called ahead');

    expect(state.suspended).toBe(false);
    expect(state.currentWeight).toBe(2);
  });

  it('keeps the forgiveness as an audit trail rather than deleting the strike', async () => {
    const member = await suspendedMember();
    const coach = await createUser('COACH');
    const strike = await prisma.strikeEvent.findFirstOrThrow({ where: { memberId: member.id } });

    await forgiveStrike(strike.id, coach, 'Called ahead');

    const after = await prisma.strikeEvent.findUniqueOrThrow({ where: { id: strike.id } });
    expect(after.forgivenAt).not.toBeNull();
    expect(after.forgivenById).toBe(coach.id);
    expect(after.forgivenReason).toBe('Called ahead');
    // Still on the record, just not counting.
    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(2);
  });

  it('lets an owner lift a suspension immediately without deleting strikes', async () => {
    const member = await suspendedMember();
    const owner = await createUser('OWNER');

    const state = await liftSuspension(member.id, owner, 'First offence, spoke to them');

    expect(state.suspended).toBe(false);
    expect(await prisma.strikeEvent.count({ where: { memberId: member.id } })).toBe(2);
    expect(await prisma.suspensionOverride.count({ where: { memberId: member.id } })).toBe(1);
  });

  it('lets the member book again the moment the suspension is lifted', async () => {
    const member = await suspendedMember();
    const owner = await createUser('OWNER');
    const cls = await createClass();

    await expect(bookClass(member, { classInstanceId: cls.id })).rejects.toThrow(/paused/i);

    await liftSuspension(member.id, owner);

    const booked = await bookClass(member, { classInstanceId: cls.id });
    expect(booked.booking.status).toBe('BOOKED');
  });
});
