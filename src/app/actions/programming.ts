'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  createWodDefinition,
  scheduleWod,
  unscheduleWod,
  updateWodDefinition,
  type WodDefinitionInput,
} from '@/lib/services/programming';
import type { ActionResult } from '@/app/actions/booking';

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    const message = await fn();
    revalidatePath('/coach/program');
    revalidatePath('/coach');
    revalidatePath('/today');
    return { ok: true, message, error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

/** Build a WOD and put it on the calendar in one step — the normal flow. */
export async function createAndScheduleWodAction(
  definition: WodDefinitionInput,
  date: string,
  classInstanceIds: string[],
  notes?: string,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    const created = await createWodDefinition(user, definition);
    await scheduleWod(user, {
      wodDefinitionId: created.id,
      date,
      classInstanceIds,
      notes,
    });
    return `Programmed for ${date}.`;
  });
}

/** Re-use an existing benchmark on a new date. */
export async function scheduleExistingWodAction(
  wodDefinitionId: string,
  date: string,
  classInstanceIds: string[],
  notes?: string,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await scheduleWod(user, { wodDefinitionId, date, classInstanceIds, notes });
    return `Programmed for ${date}.`;
  });
}

export async function updateWodDefinitionAction(
  wodDefinitionId: string,
  input: Partial<WodDefinitionInput>,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await updateWodDefinition(user, wodDefinitionId, input);
    return 'Workout updated.';
  });
}

export async function unscheduleWodAction(scheduledWodId: string): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await unscheduleWod(user, scheduledWodId);
    return 'Removed from the calendar.';
  });
}
