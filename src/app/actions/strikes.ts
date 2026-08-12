'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import { forgiveStrike, liftSuspension, unforgiveStrike } from '@/lib/services/strikes';
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

export async function forgiveStrikeAction(
  strikeId: string,
  memberId: string,
  reason: string,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    const state = await forgiveStrike(strikeId, user, reason);
    revalidatePath(`/coach/members/${memberId}`);
    revalidatePath('/account/strikes');
    return state.suspended
      ? `Strike forgiven. They're still suspended — ${state.currentWeight} of ${state.threshold}.`
      : `Strike forgiven. They're at ${state.currentWeight} of ${state.threshold} and can book.`;
  });
}

export async function unforgiveStrikeAction(
  strikeId: string,
  memberId: string,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await unforgiveStrike(strikeId, user);
    revalidatePath(`/coach/members/${memberId}`);
    revalidatePath('/account/strikes');
    return 'Forgiveness reversed.';
  });
}

export async function liftSuspensionAction(
  memberId: string,
  reason: string,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await liftSuspension(memberId, user, reason);
    revalidatePath(`/coach/members/${memberId}`);
    revalidatePath('/account/strikes');
    return 'Suspension lifted. They can book again right away.';
  });
}
