'use server';

import { redirect } from 'next/navigation';
import { authenticate, createSession, destroySession } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';

export interface AuthFormState {
  error: string | null;
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const user = await authenticate(email, password);
  // One message for both cases, so the form can't be used to discover which
  // email addresses belong to members.
  if (!user) return { error: 'Email or password is incorrect.' };

  await createSession(user.id);
  redirect(atLeast(user.role, 'COACH') ? '/coach' : '/schedule');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/login');
}
