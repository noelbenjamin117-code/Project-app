'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  createCheckoutSession,
  createPortalSession,
  refreshFromStripe,
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
