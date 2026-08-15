'use server';

import { redirect } from 'next/navigation';
import { createSession } from '@/lib/auth';
import { toErrorResponse } from '@/lib/errors';
import { claimAccount } from '@/lib/services/migration';

export interface ClaimFormState {
  error: string | null;
}

/**
 * Claim, sign in, and go straight to payment. The member never sees a
 * separate sign-in step — the link is the authentication.
 */
export async function claimAccountAction(
  _prev: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  let userId: string;
  try {
    userId = await claimAccount(token, password);
  } catch (error) {
    return { error: toErrorResponse(error).body.error };
  }

  await createSession(userId);
  redirect('/account/membership?claimed=1');
}
