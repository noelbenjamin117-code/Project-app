'use client';

import { useState, useTransition } from 'react';
import { openBillingPortalAction, startCheckoutAction } from '@/app/actions/membership';

/**
 * Both buttons redirect to a Stripe-hosted page. On success the action
 * redirects and nothing comes back — so only a failure ever renders here.
 */
export function MembershipActions({ mode }: { mode: 'subscribe' | 'manage' }) {
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
          onClick={() => run(startCheckoutAction)}
        >
          {pending ? 'Taking you to Stripe…' : 'Start membership'}
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
