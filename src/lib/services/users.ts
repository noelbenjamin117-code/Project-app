import 'server-only';
import type { Role, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { assertCan, atLeast } from '@/lib/permissions';
import { AppError, conflict, forbidden, notFound } from '@/lib/errors';

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  password: string;
}

/**
 * Add a member, coach or owner.
 *
 * There is no CLI in production, so this is the only way people get accounts —
 * the owner creates them with a starting password and passes it on.
 */
export async function createUser(actor: SessionUser, input: CreateUserInput): Promise<User> {
  assertCan(actor, 'manageUsers');

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new AppError('Enter a valid email address.', 422, 'INVALID_EMAIL');
  if (input.password.length < 8) {
    throw new AppError('The starting password needs at least 8 characters.', 422, 'WEAK_PASSWORD');
  }
  if (!input.name.trim()) throw new AppError('Enter their name.', 422, 'INVALID_NAME');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('Someone already uses that email address.', 'EMAIL_TAKEN');

  return prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
}

/** Owner sets a new password for someone who is locked out. */
export async function resetPassword(
  actor: SessionUser,
  userId: string,
  newPassword: string,
): Promise<void> {
  assertCan(actor, 'manageUsers');
  if (newPassword.length < 8) {
    throw new AppError('Use at least 8 characters.', 422, 'WEAK_PASSWORD');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('That person no longer exists.');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

/** Anyone can change their own password, given the current one. */
export async function changeOwnPassword(
  actor: SessionUser,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) {
    throw new AppError('Use at least 8 characters.', 422, 'WEAK_PASSWORD');
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user) throw notFound('Account not found.');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError('That current password is not right.', 422, 'WRONG_PASSWORD');
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

/**
 * Deactivating blocks sign-in and hides someone from lists without deleting
 * their history — a member who leaves keeps their scores on the leaderboard.
 */
export async function setUserActive(
  actor: SessionUser,
  userId: string,
  active: boolean,
): Promise<void> {
  assertCan(actor, 'manageUsers');
  if (userId === actor.id && !active) {
    throw conflict('You cannot deactivate your own account.', 'SELF_DEACTIVATE');
  }

  await prisma.user.update({ where: { id: userId }, data: { active } });
}

export async function changeRole(
  actor: SessionUser,
  userId: string,
  role: Role,
): Promise<void> {
  assertCan(actor, 'manageUsers');
  if (!atLeast(actor.role, 'OWNER')) throw forbidden();

  if (userId === actor.id) {
    throw conflict('You cannot change your own role.', 'SELF_ROLE_CHANGE');
  }

  // Never let the last owner demote themselves out of existence.
  if (role !== 'OWNER') {
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (target?.role === 'OWNER') {
      const owners = await prisma.user.count({ where: { role: 'OWNER', active: true } });
      if (owners <= 1) {
        throw conflict('The gym needs at least one owner.', 'LAST_OWNER');
      }
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });
}

/** A readable starting password the owner can text to a member. */
export function suggestPassword(): string {
  const words = [
    'barbell', 'kettlebell', 'burpee', 'thruster', 'deadlift', 'wallball',
    'rower', 'jumprope', 'pullup', 'squat', 'snatch', 'chalk',
  ];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  return `${word}-${digits}`;
}
