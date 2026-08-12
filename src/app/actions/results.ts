'use server';

import { revalidatePath } from 'next/cache';
import type { ScalingLevel } from '@prisma/client';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import { deleteResult, logResult, type LiftInput } from '@/lib/services/results';
import type { ActionResult } from '@/app/actions/booking';

export interface LogScoreInput {
  wodDefinitionId: string;
  scheduledWodId?: string | null;
  classInstanceId?: string | null;
  scalingLevel: ScalingLevel;
  timeSeconds?: number | null;
  rounds?: number | null;
  reps?: number | null;
  loadKg?: number | null;
  cappedOut?: boolean;
  capReps?: number | null;
  notes?: string | null;
  lifts?: LiftInput[];
}

export async function logScoreAction(input: LogScoreInput): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    const result = await logResult(user, input);
    revalidatePath('/today');
    revalidatePath('/history');
    return {
      ok: true,
      message: result.isPr ? "Score saved — that's a PR!" : 'Score saved.',
      error: null,
    };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

export async function deleteResultAction(resultId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    await deleteResult(user, resultId);
    revalidatePath('/today');
    revalidatePath('/history');
    return { ok: true, message: 'Score removed.', error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}
