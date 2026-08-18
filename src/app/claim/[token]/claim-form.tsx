'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { claimAccountAction, type ClaimFormState } from '@/app/actions/claim';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Setting up…' : 'Set password and continue'}
    </button>
  );
}

export function ClaimForm({ token }: { token: string }) {
  const [state, action] = useActionState<ClaimFormState, FormData>(claimAccountAction, {
    error: null,
  });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="password">
          Choose a password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
          placeholder="At least 8 characters"
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}

      <SubmitButton />

      <p className="text-center text-xs text-white/30">
        Next you’ll set up your membership payment.
      </p>
    </form>
  );
}
