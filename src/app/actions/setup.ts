'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { bootstrapGym } from '@/lib/bootstrap';
import { ensureHorizon } from '@/lib/services/schedule';
import { todayLocal } from '@/lib/time';

export interface SetupFormState {
  error: string | null;
}

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  confirm: z.string(),
  includeSchedule: z.boolean(),
  includeBenchmarks: z.boolean(),
});

export async function runSetup(
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  // Guarded here as well as in the page: the page check only stops someone
  // seeing the form, this stops them posting to it.
  if ((await prisma.user.count()) > 0) {
    return { error: 'This gym has already been set up. Sign in instead.' };
  }

  const parsed = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    includeSchedule: formData.get('includeSchedule') === 'on',
    includeBenchmarks: formData.get('includeBenchmarks') === 'on',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: "Those passwords don't match." };
  }

  let ownerId: string;
  try {
    const owner = await bootstrapGym(prisma, {
      ownerName: parsed.data.name,
      ownerEmail: parsed.data.email,
      ownerPassword: parsed.data.password,
      includeSchedule: parsed.data.includeSchedule,
      includeBenchmarks: parsed.data.includeBenchmarks,
      activeFrom: todayLocal(),
    });
    ownerId = owner.id;
  } catch (error) {
    console.error('Setup failed', error);
    return { error: 'Setup failed. Please try again.' };
  }

  // Materialise the first eight weeks of classes so the schedule is not empty
  // the moment the owner lands on it.
  if (parsed.data.includeSchedule) {
    await ensureHorizon();
  }

  await createSession(ownerId);
  redirect('/coach');
}
