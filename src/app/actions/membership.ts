'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  createCheckoutSession,
  createPortalSession,
  grantOverride,
  refreshFromStripe,
  revokeOverride,
} from '@/lib/services/membership';
import type { ActionResult } from '@/app/actions/booking';

/**
 * Both of these hand off to Stripe-hosted pages, so no card details ever
 * reach this app.
 */
export async function startCheckoutAction(priceId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  let url: string;
  try {
    url = await createCheckoutSession(user, priceId);
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }

  redirect(url);
}

export async function openBillingPortalAction(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  let url: string;
  try {
    url = await createPortalSession(user);
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }

  redirect(url);
}

/** Owner-only: re-read a member's subscription from Stripe. */
export async function refreshMembershipAction(userId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    await refreshFromStripe(user, userId);
    revalidatePath(`/coach/members/${userId}`);
    revalidatePath('/coach/members');
    return { ok: true, message: 'Refreshed from Stripe.', error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

/** Owner-only: mark a member active by hand, with a reason kept on the record. */
export async function grantOverrideAction(
  memberId: string,
  activeUntil: string,
  reason: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    // A date input gives a local calendar day; treat it as end of that day so
    // "active until the 30th" includes the 30th.
    await grantOverride(user, memberId, new Date(`${activeUntil}T23:59:59`), reason);
    revalidatePath(`/coach/members/${memberId}`);
    revalidatePath('/coach/members');
    return { ok: true, message: 'Marked active. They can book straight away.', error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

export async function revokeOverrideAction(overrideId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    await revokeOverride(user, overrideId);
    revalidatePath('/coach/members');
    return { ok: true, message: 'Override ended.', error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}
