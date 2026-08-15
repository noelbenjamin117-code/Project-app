'use client';

import { useState, useTransition } from 'react';
import { openBillingPortalAction, startCheckoutAction } from '@/app/actions/membership';

/**
 * Both buttons redirect to a Stripe-hosted page. On success the action
 * redirects and nothing comes back — so only a failure ever renders here.
 */
export function MembershipActions({
  priceId,
  hasMembership,
  portalOnly,
}: {
  priceId?: string;
  hasMembership?: boolean;
  portalOnly?: boolean;
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
      {hasMembership ? (
        <button
          className={portalOnly ? 'btn-secondary w-full' : 'btn-secondary w-full'}
          disabled={pending}
          onClick={() => run(openBillingPortalAction)}
        >
          {pending ? 'Opening…' : 'Manage membership, card and invoices'}
        </button>
      ) : (
        <button
          className="btn-primary w-full"
          disabled={pending || !priceId}
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
