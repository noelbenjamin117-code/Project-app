'use client';

import { useState, useTransition } from 'react';
import {
  grantOverrideAction,
  refreshMembershipAction,
  revokeOverrideAction,
} from '@/app/actions/membership';

export interface MembershipView {
  label: string;
  tone: 'ok' | 'warn' | 'bad';
  canBook: boolean;
  nextBillingLabel: string | null;
  graceEndsLabel: string | null;
  overrideUntilLabel: string | null;
  overrideReason: string | null;
  hasStripeCustomer: boolean;
}

export interface OverrideRow {
  id: string;
  activeUntilLabel: string;
  reason: string;
  byName: string;
  createdLabel: string;
  revoked: boolean;
}

const TONE_CLASS = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
} as const;

/**
 * Subscriptions are changed in Stripe, not here — two places to edit the same
 * thing is how they drift apart. The one exception is a manual override, for
 * cash payments and comps, which is recorded with who and why.
 */
export function MemberMembershipPanel({
  userId,
  membership,
  overrides,
  canManage,
}: {
  userId: string;
  membership: MembershipView;
  overrides: OverrideRow[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [granting, setGranting] = useState(false);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setGranting(false);
        setUntil('');
        setReason('');
      }
    });

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">
          Membership
        </h3>
        <span className={`pill ${TONE_CLASS[membership.tone]}`}>{membership.label}</span>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        {membership.nextBillingLabel && (
          <p className="text-white/60">
            Next billing <span className="text-white">{membership.nextBillingLabel}</span>
          </p>
        )}
        {membership.graceEndsLabel && (
          <p className="text-warn">
            Payment failed — can book until {membership.graceEndsLabel}
          </p>
        )}
        {membership.overrideUntilLabel && (
          <p className="text-ok">
            Set active by hand until {membership.overrideUntilLabel}
            {membership.overrideReason && ` — "${membership.overrideReason}"`}
          </p>
        )}
        {!membership.canBook && (
          <p className="text-bad">Cannot book new classes. Existing bookings still stand.</p>
        )}
        {!membership.hasStripeCustomer && (
          <p className="text-white/50">
            Not linked to Stripe yet. They'll link automatically when they subscribe, or when a
            Stripe customer with their email is found.
          </p>
        )}
      </div>

      {feedback && (
        <p role="status" className={`mt-3 text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}>
          {feedback.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {membership.hasStripeCustomer && (
          <button
            className="btn-secondary px-3 py-2 text-xs"
            disabled={pending}
            onClick={() => act(() => refreshMembershipAction(userId))}
          >
            {pending ? 'Checking…' : 'Re-check with Stripe'}
          </button>
        )}

        {canManage && !granting && (
          <button
            className="btn-secondary px-3 py-2 text-xs"
            onClick={() => setGranting(true)}
          >
            Mark active by hand
          </button>
        )}
      </div>

      {granting && (
        <div className="mt-4 rounded-lg border border-edge bg-ink p-4">
          <p className="text-sm text-white/70">
            For a cash payment, a staff comp or a family member. This beats whatever Stripe says,
            and is kept on the record.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="override-until">
                Active until
              </label>
              <input
                id="override-until"
                className="input"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="override-reason">
                Reason
              </label>
              <input
                id="override-reason"
                className="input"
                placeholder="Paid cash for August"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() => setGranting(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={pending || !until || !reason.trim()}
              onClick={() => act(() => grantOverrideAction(userId, until, reason))}
            >
              Mark active
            </button>
          </div>
        </div>
      )}

      {overrides.length > 0 && (
        <div className="mt-5 border-t border-edge pt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            Manual overrides
          </h4>
          <ul className="space-y-2 text-sm">
            {overrides.map((override) => (
              <li key={override.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={override.revoked ? 'text-white/40 line-through' : 'text-white/80'}>
                    Until {override.activeUntilLabel} — "{override.reason}"
                  </p>
                  <p className="text-xs text-white/40">
                    {override.byName} on {override.createdLabel}
                    {override.revoked && ' · ended early'}
                  </p>
                </div>
                {canManage && !override.revoked && (
                  <button
                    className="shrink-0 text-xs text-white/40 underline"
                    disabled={pending}
                    onClick={() => act(() => revokeOverrideAction(override.id))}
                  >
                    End now
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
