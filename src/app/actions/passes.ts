'use server';

import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import { createPackCheckout } from '@/lib/services/passes';
import type { ActionResult } from '@/app/actions/booking';

export async function buyPassesAction(priceId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  let url: string;
  try {
    url = await createPackCheckout(user, priceId);
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }

  redirect(url);
}
