'use client';

import { useState, useTransition } from 'react';
import { refreshMembershipAction } from '@/app/actions/membership';

export interface MembershipView {
  statusLabel: string;
  tone: 'ok' | 'warn' | 'bad';
  planName: string | null;
  periodEndLabel: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailedLabel: string | null;
  hasStripeCustomer: boolean;
}

const TONE_CLASS = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
} as const;

/**
 * Read-only for the owner. Changes are made in Stripe, and the webhook brings
 * them back — two places to edit a subscription is how they drift apart.
 */
export function MemberMembershipPanel({
  userId,
  membership,
}: {
  userId: string;
  membership: MembershipView;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">
          Membership
        </h3>
        <span className={`pill ${TONE_CLASS[membership.tone]}`}>{membership.statusLabel}</span>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        {membership.planName && (
          <p className="font-semibold text-white">{membership.planName}</p>
        )}

        {membership.periodEndLabel && (
          <p className="text-white/60">
            {membership.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {membership.periodEndLabel}
          </p>
        )}

        {membership.paymentFailedLabel && (
          <p className="text-warn">Payment failed {membership.paymentFailedLabel}</p>
        )}

        {!membership.hasStripeCustomer && (
          <p className="text-white/50">
            Not linked to Stripe yet. They'll be linked automatically when they subscribe, or
            when a Stripe customer with their email address is found.
          </p>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={`mt-3 text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}
        >
          {feedback.text}
        </p>
      )}

      {membership.hasStripeCustomer && (
        <button
          className="btn-secondary mt-4 px-3 py-2 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await refreshMembershipAction(userId);
              setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
            })
          }
        >
          {pending ? 'Checking…' : 'Re-check with Stripe'}
        </button>
      )}

      <p className="mt-3 text-xs text-white/30">
        Changes are made in Stripe and appear here automatically.
      </p>
    </section>
  );
}
