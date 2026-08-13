'use server';

import { revalidatePath } from 'next/cache';
import type { Role } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  changeOwnPassword,
  changeRole,
  createUser,
  resetPassword,
  setUserActive,
} from '@/lib/services/users';
import type { ActionResult } from '@/app/actions/booking';

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    const message = await fn();
    return { ok: true, message, error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

export async function createUserAction(input: {
  name: string;
  email: string;
  role: Role;
  password: string;
}): Promise<ActionResult> {
  return run(async () => {
    const actor = (await getSessionUser())!;
    const created = await createUser(actor, input);
    revalidatePath('/coach/members');
    return `${created.name} added. Give them their email and the starting password — they can change it under Account.`;
  });
}

export async function resetPasswordAction(
  userId: string,
  newPassword: string,
): Promise<ActionResult> {
  return run(async () => {
    const actor = (await getSessionUser())!;
    await resetPassword(actor, userId, newPassword);
    revalidatePath(`/coach/members/${userId}`);
    return 'Password reset. Pass the new one on to them.';
  });
}

export async function setUserActiveAction(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  return run(async () => {
    const actor = (await getSessionUser())!;
    await setUserActive(actor, userId, active);
    revalidatePath(`/coach/members/${userId}`);
    revalidatePath('/coach/members');
    return active
      ? 'Reactivated — they can sign in again.'
      : 'Deactivated. They can no longer sign in, but their history and scores are kept.';
  });
}

export async function changeRoleAction(userId: string, role: Role): Promise<ActionResult> {
  return run(async () => {
    const actor = (await getSessionUser())!;
    await changeRole(actor, userId, role);
    revalidatePath(`/coach/members/${userId}`);
    revalidatePath('/coach/members');
    return `Role changed to ${role.toLowerCase()}.`;
  });
}

export async function changeOwnPasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult> {
  return run(async () => {
    const actor = (await getSessionUser())!;
    await changeOwnPassword(actor, currentPassword, newPassword);
    return 'Password changed.';
  });
}
