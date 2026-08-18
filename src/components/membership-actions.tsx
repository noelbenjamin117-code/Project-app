'use client';

import { useState, useTransition } from 'react';
import { openBillingPortalAction, startCheckoutAction } from '@/app/actions/membership';
import { buyPassesAction } from '@/app/actions/passes';

/**
 * Both buttons redirect to a Stripe-hosted page. On success the action
 * redirects and nothing comes back — so only a failure ever renders here.
 */
export function MembershipActions({
  mode,
  priceId,
}: {
  mode: 'subscribe' | 'manage';
  priceId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
    });

  return (
    <div className="mt-4">
      {mode === 'manage' ? (
        <button
          className="btn-secondary w-full"
          disabled={pending}
          onClick={() => run(openBillingPortalAction)}
        >
          {pending ? 'Opening…' : 'Update card, invoices and cancelling'}
        </button>
      ) : (
        <button
          className="btn-primary w-full"
          disabled={pending}
          onClick={() => run(() => startCheckoutAction(priceId!))}
        >
          {pending ? 'Taking you to Stripe…' : 'Choose this plan'}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Buying a block of passes — a one-off payment rather than a subscription. */
export function BuyPassesButton({ priceId }: { priceId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className="mt-1 text-xs font-semibold text-brand underline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await buyPassesAction(priceId);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? 'Opening…' : 'Buy'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </>
  );
}
