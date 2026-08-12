'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  archiveTemplate,
  createTemplate,
  updateTemplate,
  type TemplateInput,
} from '@/lib/services/schedule';
import type { ActionResult } from '@/app/actions/booking';

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    const message = await fn();
    revalidatePath('/coach/templates');
    revalidatePath('/coach');
    revalidatePath('/schedule');
    return { ok: true, message, error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

export async function createTemplateAction(input: TemplateInput): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await createTemplate(user, input);
    return 'Class added to the weekly schedule.';
  });
}

export async function updateTemplateAction(
  templateId: string,
  input: Partial<TemplateInput>,
  applyToFuture: boolean,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await updateTemplate(user, templateId, input, { applyToFuture });
    return applyToFuture
      ? 'Saved, and applied to classes already on the calendar.'
      : 'Saved. Classes already on the calendar keep their current settings.';
  });
}

export async function archiveTemplateAction(
  templateId: string,
  cancelFutureInstances: boolean,
): Promise<ActionResult> {
  return run(async () => {
    const user = (await getSessionUser())!;
    await archiveTemplate(user, templateId, {
      cancelFutureInstances,
      reason: 'Class removed from the schedule',
    });
    return cancelFutureInstances
      ? 'Removed, and upcoming classes cancelled — members were notified with no strike.'
      : 'Removed from the weekly pattern. Classes already scheduled still run.';
  });
}
