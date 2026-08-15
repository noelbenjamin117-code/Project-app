'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { toErrorResponse, unauthorized } from '@/lib/errors';
import {
  exportClaimLinks,
  importMembers,
  regenerateClaimToken,
  type ImportOptions,
} from '@/lib/services/migration';
import { appUrl } from '@/lib/stripe';
import type { ActionResult } from '@/app/actions/booking';

export interface ImportSummaryView {
  parsed: number;
  created: number;
  alreadyExisted: number;
  skippedDropIns: number;
  problems: Array<{ line: number; reason: string }>;
  headers: string[];
  preview: Array<{ name: string; email: string; legacyPlan: string | null }>;
}

export async function importMembersAction(
  csv: string,
  options: ImportOptions,
): Promise<{ error: string | null; summary: ImportSummaryView | null }> {
  const user = await getSessionUser();
  if (!user) return { error: unauthorized().message, summary: null };

  try {
    const summary = await importMembers(user, csv, options);
    if (!options.dryRun) {
      revalidatePath('/coach/migration');
      revalidatePath('/coach/members');
    }
    return { error: null, summary };
  } catch (error) {
    return { error: toErrorResponse(error).body.error, summary: null };
  }
}

export async function exportClaimLinksAction(
  onlyUnclaimed: boolean,
): Promise<{ error: string | null; csv: string | null }> {
  const user = await getSessionUser();
  if (!user) return { error: unauthorized().message, csv: null };

  try {
    const csv = await exportClaimLinks(user, appUrl(), { onlyUnclaimed });
    revalidatePath('/coach/migration');
    return { error: null, csv };
  } catch (error) {
    return { error: toErrorResponse(error).body.error, csv: null };
  }
}

export async function regenerateClaimAction(userId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    await regenerateClaimToken(user, userId);
    revalidatePath('/coach/migration');
    return { ok: true, message: 'New link issued — download the list again to send it.', error: null };
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}
