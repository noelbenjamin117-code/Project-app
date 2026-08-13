import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookClass,
  cancelBooking,
  cancelClassInstance,
  markNoShow,
  undoCheckIn,
} from '@/lib/services/booking';
import { forgiveStrike, liftSuspension } from '@/lib/services/strikes';
import { getRoster } from '@/lib/services/classes';
import { createTemplate, updateTemplate } from '@/lib/services/schedule';
import { createWodDefinition, scheduleWod } from '@/lib/services/programming';
import { getMemberHistory, logResult } from '@/lib/services/results';
import { atLeast, can } from '@/lib/permissions';
import { toLocalDate } from '@/lib/time';
import { createClass, createUser, prisma, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('role hierarchy', () => {
  it('treats owner as a superset of coach, and coach of member', () => {
    expect(atLeast('OWNER', 'COACH')).toBe(true);
    expect(atLeast('OWNER', 'MEMBER')).toBe(true);
    expect(atLeast('COACH', 'MEMBER')).toBe(true);
    expect(atLeast('COACH', 'OWNER')).toBe(false);
    expect(atLeast('MEMBER', 'COACH')).toBe(false);
  });

  it('reserves lifting a suspension for the owner alone', () => {
    expect(can({ role: 'OWNER' }, 'liftSuspension')).toBe(true);
    expect(can({ role: 'COACH' }, 'liftSuspension')).toBe(false);
    expect(can({ role: 'MEMBER' }, 'liftSuspension')).toBe(false);
  });

  it('lets both coaches and owners forgive a strike', () => {
    expect(can({ role: 'OWNER' }, 'forgiveStrike')).toBe(true);
    expect(can({ role: 'COACH' }, 'forgiveStrike')).toBe(true);
    expect(can({ role: 'MEMBER' }, 'forgiveStrike')).toBe(false);
  });

  it('grants nothing to a signed-out visitor', () => {
    expect(can(null, 'viewRoster')).toBe(false);
    expect(can(null, 'markAttendance')).toBe(false);
  });
});

/**
 * The UI hides what a member cannot do, but hiding is not enforcement. These
 * call the services directly — the same path an API request takes — to prove
 * the checks are server-side.
 */
describe('members cannot reach staff actions', () => {
  it('cannot view a class roster', async () => {
    const member = await createUser();
    const cls = await createClass();
    await expect(getRoster(member, cls.id)).rejects.toThrow(/permission/i);
  });

  it('cannot mark a no-show', async () => {
    const member = await createUser();
    const victim = await createUser();
    const cls = await createClass({
      date: toLocalDate(new Date(Date.now() - 2 * 86_400_000)),
    });
    const booking = await prisma.booking.create({
      data: { classInstanceId: cls.id, memberId: victim.id, status: 'BOOKED' },
    });

    await expect(markNoShow(member, booking.id)).rejects.toThrow(/permission/i);
    expect(await prisma.strikeEvent.count()).toBe(0);
  });

  it('cannot undo somebody elses check-in', async () => {
    const member = await createUser();
    const cls = await createClass();
    const booking = await prisma.booking.create({
      data: { classInstanceId: cls.id, memberId: member.id, status: 'BOOKED' },
    });
    await expect(undoCheckIn(member, booking.id)).rejects.toThrow(/permission/i);
  });

  it('cannot cancel a class for everyone', async () => {
    const member = await createUser();
    const cls = await createClass();
    await expect(cancelClassInstance(member, cls.id, 'I overslept')).rejects.toThrow(
      /permission/i,
    );
  });

  it('cannot edit the weekly schedule', async () => {
    const member = await createUser();
    await expect(
      createTemplate(member, {
        name: 'Ghost class',
        dayOfWeek: 1,
        startTimeLocal: '06:00',
        durationMinutes: 60,
        capacity: 10,
        cancelPolicyType: 'NONE',
      }),
    ).rejects.toThrow(/permission/i);
  });

  it('cannot programme a WOD', async () => {
    const member = await createUser();
    await expect(
      createWodDefinition(member, { type: 'AMRAP', description: 'AMRAP 20' }),
    ).rejects.toThrow(/permission/i);
  });

  it('cannot forgive their own strike', async () => {
    const member = await createUser();
    const cls = await createClass();
    const booking = await prisma.booking.create({
      data: { classInstanceId: cls.id, memberId: member.id, status: 'CANCELLED' },
    });
    const strike = await prisma.strikeEvent.create({
      data: {
        memberId: member.id,
        bookingId: booking.id,
        type: 'LATE_CANCEL',
        weight: 1,
        occurredAt: new Date(),
      },
    });

    await expect(forgiveStrike(strike.id, member, 'I had a good reason')).rejects.toThrow(
      /permission/i,
    );
    const after = await prisma.strikeEvent.findUniqueOrThrow({ where: { id: strike.id } });
    expect(after.forgivenAt).toBeNull();
  });

  it('cannot lift their own suspension', async () => {
    const member = await createUser();
    await expect(liftSuspension(member.id, member)).rejects.toThrow(/permission/i);
  });

  it('cannot book or cancel on behalf of another member', async () => {
    const [member, other] = await Promise.all([createUser(), createUser()]);
    const cls = await createClass({ capacity: 5 });

    await expect(
      bookClass(member, { classInstanceId: cls.id, memberId: other.id }),
    ).rejects.toThrow(/permission/i);

    const { booking } = await bookClass(other, { classInstanceId: cls.id });
    await expect(cancelBooking(member, booking.id)).rejects.toThrow(/only manage your own/i);
  });

  it('cannot read another members history or log a score as them', async () => {
    const [member, other] = await Promise.all([createUser(), createUser()]);

    await expect(getMemberHistory(member, other.id)).rejects.toThrow(/only manage your own/i);

    const coach = await createUser('COACH');
    const wod = await createWodDefinition(coach, { type: 'AMRAP', description: 'AMRAP 20' });
    await expect(
      logResult(member, { wodDefinitionId: wod.id, scalingLevel: 'RX', rounds: 5, reps: 0 }, other.id),
    ).rejects.toThrow(/only manage your own/i);
  });
});

describe('coaches are limited to coach powers', () => {
  it('can run a roster and mark attendance', async () => {
    const coach = await createUser('COACH');
    const cls = await createClass();
    await expect(getRoster(coach, cls.id)).resolves.toBeTruthy();
  });

  it('can forgive a strike but cannot lift a suspension', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const cls = await createClass();
    const booking = await prisma.booking.create({
      data: { classInstanceId: cls.id, memberId: member.id, status: 'CANCELLED' },
    });
    const strike = await prisma.strikeEvent.create({
      data: {
        memberId: member.id,
        bookingId: booking.id,
        type: 'LATE_CANCEL',
        weight: 1,
        occurredAt: new Date(),
      },
    });

    await expect(forgiveStrike(strike.id, coach, 'Called ahead')).resolves.toBeTruthy();
    await expect(liftSuspension(member.id, coach)).rejects.toThrow(/permission/i);
  });

  it('can programme and schedule a WOD', async () => {
    const coach = await createUser('COACH');
    const wod = await createWodDefinition(coach, {
      type: 'FOR_TIME',
      description: '21-15-9',
      isBenchmark: true,
      scalingOptions: [{ level: 'RX', description: 'As prescribed' }],
    });

    await expect(
      scheduleWod(coach, { wodDefinitionId: wod.id, date: toLocalDate(new Date()) }),
    ).resolves.toBeTruthy();
  });

  it('can edit the weekly schedule', async () => {
    const coach = await createUser('COACH');
    const template = await createTemplate(coach, {
      name: '6:00am WOD',
      dayOfWeek: 1,
      startTimeLocal: '06:00',
      durationMinutes: 60,
      capacity: 16,
      cancelPolicyType: 'ABSOLUTE',
      cancelAbsoluteTimeLocal: '21:00',
    });

    const updated = await updateTemplate(coach, template.id, { capacity: 20 });
    expect(updated.capacity).toBe(20);
  });
});

describe('owners can do everything', () => {
  it('can lift a suspension', async () => {
    const owner = await createUser('OWNER');
    const member = await createUser();
    await expect(liftSuspension(member.id, owner, 'Spoke to them')).resolves.toBeTruthy();
  });

  it('can act on any members bookings', async () => {
    const owner = await createUser('OWNER');
    const member = await createUser();
    const cls = await createClass({ capacity: 5 });

    const { booking } = await bookClass(owner, {
      classInstanceId: cls.id,
      memberId: member.id,
    });
    await expect(cancelBooking(owner, booking.id)).resolves.toBeTruthy();
  });
});
