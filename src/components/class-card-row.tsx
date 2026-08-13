'use client';

import { useState, useTransition } from 'react';
import { bookClassAction, cancelBookingAction, checkInAction } from '@/app/actions/booking';
import type { DeadlineReason } from '@/lib/domain/cancellation';

export interface ClassCardView {
  id: string;
  name: string;
  notes: string | null;
  timeLabel: string;
  coachName: string | null;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  spotsLeft: number;
  cancelled: boolean;
  cancelledReason: string | null;
  started: boolean;
  myBooking: {
    id: string;
    status: 'BOOKED' | 'WAITLISTED' | 'CANCELLED';
    checkedIn: boolean;
    waitlistPosition: number | null;
    /** Already formatted in gym time, e.g. "9:00pm tonight". */
    deadlineLabel: string;
    deadlinePassed: boolean;
    deadlineReason: DeadlineReason;
  } | null;
}

export function ClassCardRow({
  card,
  suspended,
  suspendedUntilLabel,
  lateCancelWarning,
}: {
  card: ClassCardView;
  suspended: boolean;
  suspendedUntilLabel: string | null;
  lateCancelWarning: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const booking = card.myBooking;

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      setConfirmingCancel(false);
    });

  return (
    <div
      className={`card px-4 py-3 ${card.cancelled ? 'opacity-60' : ''} ${
        booking?.status === 'BOOKED' ? 'border-ok/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{card.timeLabel}</p>
          <p className="truncate text-sm text-white/50">
            {card.name}
            {card.coachName && ` · ${card.coachName}`}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {card.cancelled ? (
            <span className="pill bg-bad/15 text-bad">Cancelled</span>
          ) : booking?.status === 'BOOKED' ? (
            <span className="pill bg-ok/15 text-ok">
              {booking.checkedIn ? 'Checked in' : "You're in"}
            </span>
          ) : booking?.status === 'WAITLISTED' ? (
            <span className="pill bg-warn/15 text-warn">Waitlist #{booking.waitlistPosition}</span>
          ) : card.spotsLeft > 0 ? (
            <span className="text-sm text-white/50">{card.spotsLeft} left</span>
          ) : (
            <span className="pill bg-white/10 text-white/60">
              Full{card.waitlistCount > 0 && ` · ${card.waitlistCount} waiting`}
            </span>
          )}
        </div>
      </div>

      {/* Anything a member needs to know before booking — e.g. a drop-in fee
          that membership does not cover. */}
      {card.notes && !card.cancelled && (
        <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{card.notes}</p>
      )}

      {card.cancelled && card.cancelledReason && (
        <p className="mt-2 text-sm text-bad/80">{card.cancelledReason} — no strike, no penalty.</p>
      )}

      {/* The deadline is always shown as a real moment in time, never as a
          restatement of the rule. */}
      {booking?.status === 'BOOKED' && !card.cancelled && (
        <p className="mt-2 text-sm text-white/60">
          {booking.deadlinePassed ? (
            <span className="text-warn">Cancelling now counts as a late cancel.</span>
          ) : (
            <>
              Cancel free until{' '}
              <span className="font-semibold text-white">{booking.deadlineLabel}</span>
              {/* When a grace window is what's holding the deadline open, say
                  so — otherwise "free until 2:58am" reads as arbitrary. */}
              {booking.deadlineReason === 'WAITLIST_PROMOTION' && (
                <span className="text-white/40"> · extra time, you were just promoted</span>
              )}
              {booking.deadlineReason === 'FRESH_BOOKING' && (
                <span className="text-white/40">
                  {' '}
                  · the free window for this class has passed, so you have 15 minutes to change
                  your mind
                </span>
              )}
            </>
          )}
        </p>
      )}

      {booking?.status === 'WAITLISTED' && !card.cancelled && (
        <p className="mt-2 text-sm text-white/60">
          We'll move you in automatically if a spot opens. No strike if you never get in.
        </p>
      )}

      {!card.cancelled && !card.started && (
        <div className="mt-3 flex gap-2">
          {!booking && (
            <button
              className="btn-primary flex-1"
              disabled={pending || suspended}
              onClick={() => act(() => bookClassAction(card.id))}
            >
              {suspended
                ? `Paused until ${suspendedUntilLabel ?? 'later'}`
                : card.spotsLeft > 0
                  ? 'Book'
                  : 'Join waitlist'}
            </button>
          )}

          {booking && booking.status !== 'CANCELLED' && !confirmingCancel && (
            <button
              className="btn-secondary flex-1"
              disabled={pending}
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Self check-in: available from 30 minutes before the class starts. */}
      {booking?.status === 'BOOKED' && !booking.checkedIn && !card.cancelled && card.started && (
        <button
          className="btn-primary mt-3 w-full"
          disabled={pending}
          onClick={() => act(() => checkInAction(booking.id))}
        >
          Check in
        </button>
      )}

      {confirmingCancel && booking && (
        <div className="mt-3 rounded-lg border border-edge bg-ink p-3">
          {booking.deadlinePassed && booking.status === 'BOOKED' ? (
            <>
              <p className="text-sm font-semibold text-warn">This is a late cancel</p>
              {/* Never a silent strike: the running total is on screen before
                  they confirm. */}
              <p className="mt-1 text-sm text-white/70">{lateCancelWarning}</p>
            </>
          ) : (
            <p className="text-sm text-white/70">
              {booking.status === 'WAITLISTED'
                ? "You'll come off the waitlist. No strike."
                : `You're inside the free window (until ${booking.deadlineLabel}). No strike.`}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              className="btn-secondary flex-1"
              disabled={pending}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep my spot
            </button>
            <button
              className={`flex-1 ${booking.deadlinePassed ? 'btn-danger' : 'btn-primary'}`}
              disabled={pending}
              onClick={() => act(() => cancelBookingAction(booking.id))}
            >
              {pending ? 'Cancelling…' : 'Cancel booking'}
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <p
          role="status"
          className={`mt-2 text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
