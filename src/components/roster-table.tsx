'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  coachCheckInAction,
  coachUndoCheckInAction,
  markNoShowAction,
  unmarkNoShowAction,
} from '@/app/actions/booking';

export interface RosterRowView {
  bookingId: string;
  memberId: string;
  memberName: string;
  status: 'BOOKED' | 'WAITLISTED' | 'CANCELLED';
  source: string;
  checkedIn: boolean;
  noShow: boolean;
  lateCancel: boolean;
  cancelledLabel: string | null;
  waitlistPosition: number | null;
  promotedLabel: string | null;
  riskLevel: 'NONE' | 'NEAR' | 'AT_THRESHOLD' | 'SUSPENDED';
  strikeSummary: string;
  membershipLapsed: boolean;
}

const RISK_STYLE: Record<RosterRowView['riskLevel'], string | null> = {
  NONE: null,
  NEAR: 'bg-warn/15 text-warn',
  AT_THRESHOLD: 'bg-bad/15 text-bad',
  SUSPENDED: 'bg-bad/25 text-bad',
};

const RISK_LABEL: Record<RosterRowView['riskLevel'], string | null> = {
  NONE: null,
  NEAR: 'Near limit',
  AT_THRESHOLD: 'At limit',
  SUSPENDED: 'Suspended',
};

export function RosterTable({
  classInstanceId,
  booked,
  waitlisted,
  cancelled,
  classStarted,
  classCancelled,
  canForgive,
}: {
  classInstanceId: string;
  booked: RosterRowView[];
  waitlisted: RosterRowView[];
  cancelled: RosterRowView[];
  classStarted: boolean;
  classCancelled: boolean;
  canForgive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.error || result.message) {
        setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      }
    });

  return (
    <div className="space-y-6">
      {feedback && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            feedback.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'
          }`}
        >
          {feedback.text}
        </p>
      )}

      <section className="card overflow-hidden">
        <h3 className="border-b border-edge px-4 py-3 font-semibold">
          In the class ({booked.length})
        </h3>

        {booked.length === 0 ? (
          <p className="px-4 py-6 text-center text-white/40">Nobody booked yet.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {booked.map((row) => (
              <li key={row.bookingId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/coach/members/${row.memberId}`}
                    className="font-semibold hover:text-brand"
                  >
                    {row.memberName}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    {/* Shown before a coach marks anyone, so they know the
                        consequence of the tap they're about to make. */}
                    {RISK_LABEL[row.riskLevel] && (
                      <span className={`pill ${RISK_STYLE[row.riskLevel]}`}>
                        {RISK_LABEL[row.riskLevel]} · {row.strikeSummary}
                      </span>
                    )}
                    {/* Booked while paying, lapsed since. The booking stands;
                        the coach just knows to have a word. */}
                    {row.membershipLapsed && (
                      <span className="pill bg-bad/15 text-bad">Membership lapsed</span>
                    )}
                    {row.source === 'WALK_IN' && (
                      <span className="pill bg-white/10 text-white/50">Walk-in</span>
                    )}
                    {row.promotedLabel && (
                      <span className="text-white/40">Promoted {row.promotedLabel}</span>
                    )}
                  </div>
                </div>

                {row.noShow ? (
                  <div className="flex items-center gap-2">
                    <span className="pill bg-bad/15 text-bad">No-show</span>
                    <button
                      className="btn-secondary px-3 py-2 text-xs"
                      disabled={pending}
                      onClick={() => act(() => unmarkNoShowAction(row.bookingId, classInstanceId))}
                    >
                      Undo
                    </button>
                  </div>
                ) : row.checkedIn ? (
                  <div className="flex items-center gap-2">
                    <span className="pill bg-ok/15 text-ok">Here</span>
                    <button
                      className="btn-secondary px-3 py-2 text-xs"
                      disabled={pending}
                      onClick={() =>
                        act(() => coachUndoCheckInAction(row.bookingId, classInstanceId))
                      }
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-primary px-3 py-2 text-xs"
                      disabled={pending || classCancelled}
                      onClick={() => act(() => coachCheckInAction(row.bookingId, classInstanceId))}
                    >
                      Check in
                    </button>
                    <button
                      className="btn-danger px-3 py-2 text-xs"
                      // No-shows can only be marked once the class has started
                      // — before that there is nothing to be absent from.
                      disabled={pending || !classStarted || classCancelled}
                      title={!classStarted ? "Class hasn't started yet" : undefined}
                      onClick={() => act(() => markNoShowAction(row.bookingId, classInstanceId))}
                    >
                      No-show
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {waitlisted.length > 0 && (
        <section className="card overflow-hidden">
          <h3 className="border-b border-edge px-4 py-3 font-semibold">
            Waitlist ({waitlisted.length})
          </h3>
          <ul className="divide-y divide-edge">
            {waitlisted.map((row) => (
              <li key={row.bookingId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-sm font-bold text-white/40">
                  {row.waitlistPosition}
                </span>
                <Link
                  href={`/coach/members/${row.memberId}`}
                  className="min-w-0 flex-1 truncate font-semibold hover:text-brand"
                >
                  {row.memberName}
                </Link>
                <span className="text-xs text-white/40">
                  Moves up automatically if a spot frees
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cancelled.length > 0 && (
        <section className="card overflow-hidden">
          <h3 className="border-b border-edge px-4 py-3 font-semibold">
            Cancelled ({cancelled.length})
          </h3>
          <ul className="divide-y divide-edge">
            {cancelled.map((row) => (
              <li key={row.bookingId} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Link
                  href={`/coach/members/${row.memberId}`}
                  className="min-w-0 flex-1 truncate hover:text-brand"
                >
                  {row.memberName}
                </Link>
                {/* Late cancel and no-show are separate facts and both stay
                    visible to the coach. */}
                {row.lateCancel && <span className="pill bg-warn/15 text-warn">Late cancel</span>}
                <span className="text-white/40">{row.cancelledLabel}</span>
                {canForgive && row.lateCancel && (
                  <Link
                    href={`/coach/members/${row.memberId}`}
                    className="text-xs text-brand underline"
                  >
                    Forgive
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
