'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { unauthorized, toErrorResponse } from '@/lib/errors';
import {
  bookClass,
  cancelBooking,
  checkIn,
  markNoShow,
  unmarkNoShow,
  undoCheckIn,
  cancelClassInstance,
  restoreClassInstance,
} from '@/lib/services/booking';

export interface ActionResult {
  ok: boolean;
  message: string | null;
  error: string | null;
}

const ok = (message: string | null = null): ActionResult => ({ ok: true, message, error: null });

/**
 * Every action re-reads the session and re-checks permissions server-side.
 * The UI hides what a member can't do, but hiding is not enforcement.
 */
async function run(fn: (user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) => Promise<ActionResult>) {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: null, error: unauthorized().message };

  try {
    return await fn(user);
  } catch (error) {
    return { ok: false, message: null, error: toErrorResponse(error).body.error };
  }
}

function refreshMemberViews() {
  revalidatePath('/schedule');
  revalidatePath('/today');
  revalidatePath('/account/strikes');
}

export async function bookClassAction(classInstanceId: string): Promise<ActionResult> {
  return run(async (user) => {
    const result = await bookClass(user, { classInstanceId });
    refreshMemberViews();
    revalidatePath(`/classes/${classInstanceId}`);
    return ok(
      result.waitlisted
        ? `Class is full — you're #${result.waitlistPosition} on the waitlist. We'll tell you if a spot opens.`
        : "You're booked in.",
    );
  });
}

export async function cancelBookingAction(bookingId: string): Promise<ActionResult> {
  return run(async (user) => {
    const result = await cancelBooking(user, bookingId);
    refreshMemberViews();
    revalidatePath(`/classes/${result.booking.classInstanceId}`);

    if (result.outcome.isLate) {
      const state = result.strikeState;
      return ok(
        state.suspended
          ? `Cancelled. That was a late cancel and your bookings are now paused.`
          : `Cancelled. That counted as a late cancel — you're at ${state.currentWeight} of ${state.threshold} strikes.`,
      );
    }
    return ok('Cancelled. No strike.');
  });
}

export async function checkInAction(bookingId: string): Promise<ActionResult> {
  return run(async (user) => {
    await checkIn(user, bookingId);
    refreshMemberViews();
    revalidatePath('/coach');
    return ok("You're checked in.");
  });
}

// ---------------------------------------------------------------------------
// Coach-only
// ---------------------------------------------------------------------------

export async function coachCheckInAction(
  bookingId: string,
  classInstanceId: string,
): Promise<ActionResult> {
  return run(async (user) => {
    await checkIn(user, bookingId);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    return ok(null);
  });
}

export async function coachUndoCheckInAction(
  bookingId: string,
  classInstanceId: string,
): Promise<ActionResult> {
  return run(async (user) => {
    await undoCheckIn(user, bookingId);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    return ok(null);
  });
}

export async function markNoShowAction(
  bookingId: string,
  classInstanceId: string,
): Promise<ActionResult> {
  return run(async (user) => {
    const { strikeState } = await markNoShow(user, bookingId);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    return ok(
      strikeState.suspended
        ? 'Marked as no-show. That member is now suspended from booking.'
        : `Marked as no-show (${strikeState.currentWeight} of ${strikeState.threshold} strikes).`,
    );
  });
}

export async function unmarkNoShowAction(
  bookingId: string,
  classInstanceId: string,
): Promise<ActionResult> {
  return run(async (user) => {
    await unmarkNoShow(user, bookingId);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    return ok('No-show removed, strike withdrawn.');
  });
}

export async function coachBookMemberAction(
  classInstanceId: string,
  memberId: string,
  source: 'COACH' | 'WALK_IN' = 'WALK_IN',
): Promise<ActionResult> {
  return run(async (user) => {
    const result = await bookClass(user, { classInstanceId, memberId, source });
    revalidatePath(`/coach/classes/${classInstanceId}`);
    return ok(result.waitlisted ? 'Class is full — added to the waitlist.' : 'Added to the class.');
  });
}

export async function cancelClassAction(
  classInstanceId: string,
  reason: string,
): Promise<ActionResult> {
  return run(async (user) => {
    const { notifiedMemberIds } = await cancelClassInstance(user, classInstanceId, reason);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    revalidatePath('/coach');
    revalidatePath('/schedule');
    return ok(
      `Class cancelled. ${notifiedMemberIds.length} ${
        notifiedMemberIds.length === 1 ? 'member' : 'members'
      } notified — nobody gets a strike.`,
    );
  });
}

export async function restoreClassAction(classInstanceId: string): Promise<ActionResult> {
  return run(async (user) => {
    await restoreClassInstance(user, classInstanceId);
    revalidatePath(`/coach/classes/${classInstanceId}`);
    revalidatePath('/coach');
    return ok('Class restored. Members will need to re-book.');
  });
}
