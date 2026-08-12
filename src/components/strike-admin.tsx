'use client';

import { useState, useTransition } from 'react';
import {
  forgiveStrikeAction,
  liftSuspensionAction,
  unforgiveStrikeAction,
} from '@/app/actions/strikes';

export interface StrikeRowView {
  id: string;
  type: 'LATE_CANCEL' | 'NO_SHOW';
  weight: number;
  occurredLabel: string;
  classLabel: string | null;
  counting: boolean;
  consumed: boolean;
  expiresLabel: string;
  forgiven: boolean;
  forgivenByName: string | null;
  forgivenReason: string | null;
  forgivenLabel: string | null;
}

const TYPE_LABEL = { LATE_CANCEL: 'Late cancel', NO_SHOW: 'No-show' } as const;

export function StrikeAdmin({
  memberId,
  rows,
  currentWeight,
  threshold,
  suspended,
  canForgive,
  canLift,
}: {
  memberId: string;
  rows: StrikeRowView[];
  currentWeight: number;
  threshold: number;
  suspended: boolean;
  canForgive: boolean;
  canLift: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [forgivingId, setForgivingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [liftReason, setLiftReason] = useState('');
  const [liftOpen, setLiftOpen] = useState(false);

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setForgivingId(null);
        setReason('');
        setLiftOpen(false);
        setLiftReason('');
      }
    });

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge px-5 py-4">
        <h3 className="font-semibold">
          Strikes{' '}
          <span className="ml-1 text-white/40">
            {/* While a pause is running its strikes are spent on it, so the
                running total reads 0 — say that rather than showing a bare
                "0 of 4" next to a suspended member. */}
            {suspended
              ? 'all counted toward the current pause'
              : `${currentWeight} of ${threshold} in the last 30 days`}
          </span>
        </h3>

        {suspended && canLift && !liftOpen && (
          <button className="btn-secondary px-3 py-2 text-xs" onClick={() => setLiftOpen(true)}>
            Lift suspension now
          </button>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={`px-5 py-3 text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}
        >
          {feedback.text}
        </p>
      )}

      {liftOpen && (
        <div className="border-b border-edge bg-white/[0.02] px-5 py-4">
          <p className="text-sm text-white/70">
            This lifts the pause immediately. The strikes stay on their record.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Reason (optional)"
              value={liftReason}
              onChange={(e) => setLiftReason(e.target.value)}
            />
            <button className="btn-secondary" onClick={() => setLiftOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => act(() => liftSuspensionAction(memberId, liftReason))}
            >
              Lift it
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-white/40">No strikes on record.</p>
      ) : (
        <ul className="divide-y divide-edge">
          {rows.map((row) => (
            <li key={row.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {TYPE_LABEL[row.type]}
                    <span className="ml-2 text-sm font-normal text-white/40">
                      weight {row.weight}
                    </span>
                  </p>
                  <p className="text-sm text-white/50">
                    {row.occurredLabel}
                    {row.classLabel && ` · ${row.classLabel}`}
                  </p>

                  {row.forgiven ? (
                    <p className="mt-1 text-sm text-ok">
                      Forgiven by {row.forgivenByName ?? 'a coach'} on {row.forgivenLabel}
                      {row.forgivenReason && ` — "${row.forgivenReason}"`}
                    </p>
                  ) : row.consumed ? (
                    <p className="mt-1 text-sm text-white/40">
                      {suspended
                        ? 'Counted toward the current pause'
                        : 'Counted toward a pause already served'}
                    </p>
                  ) : row.counting ? (
                    <p className="mt-1 text-sm text-white/40">Drops off {row.expiresLabel}</p>
                  ) : (
                    <p className="mt-1 text-sm text-white/40">
                      Expired {row.expiresLabel} — no longer counting
                    </p>
                  )}
                </div>

                {canForgive && (
                  <div className="shrink-0">
                    {row.forgiven ? (
                      <button
                        className="btn-secondary px-3 py-2 text-xs"
                        disabled={pending}
                        onClick={() => act(() => unforgiveStrikeAction(row.id, memberId))}
                      >
                        Undo
                      </button>
                    ) : (
                      forgivingId !== row.id && (
                        <button
                          className="btn-secondary px-3 py-2 text-xs"
                          onClick={() => setForgivingId(row.id)}
                        >
                          Forgive
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              {forgivingId === row.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Why? (optional, kept on the record)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="btn-secondary"
                    onClick={() => setForgivingId(null)}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    disabled={pending}
                    onClick={() => act(() => forgiveStrikeAction(row.id, memberId, reason))}
                  >
                    Forgive
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
