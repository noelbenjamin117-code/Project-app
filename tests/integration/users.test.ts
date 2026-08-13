import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  changeOwnPassword,
  changeRole,
  createUser,
  resetPassword,
  setUserActive,
} from '@/lib/services/users';
import { bootstrapGym } from '@/lib/bootstrap';
import { verifyPassword } from '@/lib/password';
import { createUser as makeUser, prisma, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('first-run setup', () => {
  it('creates the owner, the schedule and the benchmark library', async () => {
    const owner = await bootstrapGym(prisma, {
      ownerName: 'Dana Reyes',
      ownerEmail: 'Dana@Example.com',
      ownerPassword: 'chalkbucket99',
      includeSchedule: true,
      includeBenchmarks: true,
      activeFrom: '2026-08-13',
    });

    expect(owner.role).toBe('OWNER');
    // Email is normalised, so signing in is not case-sensitive.
    expect(owner.email).toBe('dana@example.com');
    expect(await verifyPassword('chalkbucket99', owner.passwordHash)).toBe(true);

    // 5 classes a day, Monday to Friday.
    expect(await prisma.classTemplate.count()).toBe(25);
    expect(await prisma.wodDefinition.count({ where: { isBenchmark: true } })).toBe(10);
    expect(await prisma.movement.count()).toBeGreaterThan(0);
  });

  it('can create just the owner, with nothing else', async () => {
    await bootstrapGym(prisma, {
      ownerName: 'Dana Reyes',
      ownerEmail: 'dana@example.com',
      ownerPassword: 'chalkbucket99',
      includeSchedule: false,
      includeBenchmarks: false,
      activeFrom: '2026-08-13',
    });

    expect(await prisma.classTemplate.count()).toBe(0);
    expect(await prisma.wodDefinition.count()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses to run once the gym has any user at all', async () => {
    await makeUser('MEMBER');

    await expect(
      bootstrapGym(prisma, {
        ownerName: 'Interloper',
        ownerEmail: 'someone@else.com',
        ownerPassword: 'chalkbucket99',
        includeSchedule: false,
        includeBenchmarks: false,
        activeFrom: '2026-08-13',
      }),
    ).rejects.toThrow(/already been set up/i);

    expect(await prisma.user.count({ where: { role: 'OWNER' } })).toBe(0);
  });

  it('gives the templates the gym cancellation rules, not a generic default', async () => {
    await bootstrapGym(prisma, {
      ownerName: 'Dana Reyes',
      ownerEmail: 'dana@example.com',
      ownerPassword: 'chalkbucket99',
      includeSchedule: true,
      includeBenchmarks: false,
      activeFrom: '2026-08-13',
    });

    const monday = await prisma.classTemplate.findMany({
      where: { dayOfWeek: 1 },
      orderBy: { startTimeLocal: 'asc' },
    });

    expect(
      monday.map((t) => [t.startTimeLocal, t.cancelPolicyType, t.cancelAbsoluteTimeLocal ?? t.cancelRelativeHours]),
    ).toEqual([
      ['06:00', 'ABSOLUTE', '21:00'],
      ['07:00', 'ABSOLUTE', '21:00'],
      ['09:30', 'NONE', null],
      ['17:30', 'RELATIVE', 2],
      ['18:30', 'RELATIVE', 2],
    ]);
  });
});

describe('creating accounts', () => {
  it('lets an owner add a member who can then sign in', async () => {
    const owner = await makeUser('OWNER');
    const created = await createUser(owner, {
      name: 'Jamie Fitzgerald',
      email: 'Jamie@Example.com ',
      role: 'MEMBER',
      password: 'thruster-4821',
    });

    expect(created.email).toBe('jamie@example.com');
    expect(created.role).toBe('MEMBER');
    expect(await verifyPassword('thruster-4821', created.passwordHash)).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const owner = await makeUser('OWNER');
    await createUser(owner, {
      name: 'Jamie',
      email: 'jamie@example.com',
      role: 'MEMBER',
      password: 'thruster-4821',
    });

    await expect(
      createUser(owner, {
        name: 'Jamie Again',
        email: 'jamie@example.com',
        role: 'MEMBER',
        password: 'thruster-9999',
      }),
    ).rejects.toThrow(/already uses that email/i);
  });

  it('refuses a weak starting password or a missing name', async () => {
    const owner = await makeUser('OWNER');

    await expect(
      createUser(owner, { name: 'Jamie', email: 'a@b.com', role: 'MEMBER', password: 'short' }),
    ).rejects.toThrow(/8 characters/i);

    await expect(
      createUser(owner, { name: '  ', email: 'a@b.com', role: 'MEMBER', password: 'longenough1' }),
    ).rejects.toThrow(/their name/i);
  });

  it('does not let a coach create accounts', async () => {
    const coach = await makeUser('COACH');
    await expect(
      createUser(coach, {
        name: 'Sneaky Owner',
        email: 'sneaky@example.com',
        role: 'OWNER',
        password: 'thruster-4821',
      }),
    ).rejects.toThrow(/permission/i);
  });

  it('does not let a member create accounts', async () => {
    const member = await makeUser('MEMBER');
    await expect(
      createUser(member, {
        name: 'Sneaky',
        email: 'sneaky@example.com',
        role: 'MEMBER',
        password: 'thruster-4821',
      }),
    ).rejects.toThrow(/permission/i);
  });
});

describe('passwords', () => {
  it('lets an owner reset somebody who is locked out', async () => {
    const owner = await makeUser('OWNER');
    const member = await makeUser('MEMBER');

    await resetPassword(owner, member.id, 'brand-new-password');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(await verifyPassword('brand-new-password', after.passwordHash)).toBe(true);
  });

  it('does not let a coach or member reset anyone elses password', async () => {
    const coach = await makeUser('COACH');
    const member = await makeUser('MEMBER');

    await expect(resetPassword(coach, member.id, 'brand-new-password')).rejects.toThrow(
      /permission/i,
    );
    await expect(resetPassword(member, coach.id, 'brand-new-password')).rejects.toThrow(
      /permission/i,
    );
  });

  it('lets a member change their own password with the current one', async () => {
    const owner = await makeUser('OWNER');
    const created = await createUser(owner, {
      name: 'Jamie',
      email: 'jamie@example.com',
      role: 'MEMBER',
      password: 'starting-password',
    });
    const session = { id: created.id, email: created.email, name: created.name, role: created.role };

    await changeOwnPassword(session, 'starting-password', 'my-own-password');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(await verifyPassword('my-own-password', after.passwordHash)).toBe(true);
  });

  it('refuses a password change without the correct current password', async () => {
    const owner = await makeUser('OWNER');
    const created = await createUser(owner, {
      name: 'Jamie',
      email: 'jamie@example.com',
      role: 'MEMBER',
      password: 'starting-password',
    });
    const session = { id: created.id, email: created.email, name: created.name, role: created.role };

    await expect(
      changeOwnPassword(session, 'wrong-password', 'my-own-password'),
    ).rejects.toThrow(/not right/i);
  });
});

describe('roles and deactivation', () => {
  it('lets an owner promote a member to coach', async () => {
    const owner = await makeUser('OWNER');
    const member = await makeUser('MEMBER');

    await changeRole(owner, member.id, 'COACH');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.role).toBe('COACH');
  });

  /**
   * The gym can never be left without an owner, and the reason is the
   * self-demotion rule rather than the owner count: only an owner can change
   * roles, and nobody can change their own. So a sole owner has no way to
   * demote themselves, and any other owner doing the demoting is themselves a
   * second owner.
   */
  it('never lets an owner demote themselves', async () => {
    const owner = await makeUser('OWNER');
    await expect(changeRole(owner, owner.id, 'MEMBER')).rejects.toThrow(/your own role/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.role).toBe('OWNER');
  });

  it('lets one owner demote another when there are two', async () => {
    const owner = await makeUser('OWNER');
    const other = await makeUser('OWNER');

    await changeRole(owner, other.id, 'MEMBER');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(after.role).toBe('MEMBER');
    expect(await prisma.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });

  it('does not let a coach change roles', async () => {
    const coach = await makeUser('COACH');
    const member = await makeUser('MEMBER');
    await expect(changeRole(coach, member.id, 'COACH')).rejects.toThrow(/permission/i);
  });

  it('blocks a deactivated user from being treated as active', async () => {
    const owner = await makeUser('OWNER');
    const member = await makeUser('MEMBER');

    await setUserActive(owner, member.id, false);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.active).toBe(false);
  });

  it('does not let an owner deactivate themselves', async () => {
    const owner = await makeUser('OWNER');
    await expect(setUserActive(owner, owner.id, false)).rejects.toThrow(/your own account/i);
  });

  it('keeps a deactivated members history intact', async () => {
    const owner = await makeUser('OWNER');
    const member = await makeUser('MEMBER');
    await setUserActive(owner, member.id, false);

    expect(await prisma.user.count({ where: { id: member.id } })).toBe(1);
  });
});
