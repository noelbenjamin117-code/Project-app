'use client';

import { useState, useTransition } from 'react';
import type { Role } from '@prisma/client';
import {
  changeRoleAction,
  resetPasswordAction,
  setUserActiveAction,
} from '@/app/actions/users';

/** Owner-only controls: reset a password, change a role, deactivate. */
export function MemberAccountPanel({
  userId,
  role,
  active,
  isSelf,
  suggestedPassword,
}: {
  userId: string;
  role: Role;
  active: boolean;
  isSelf: boolean;
  suggestedPassword: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState(suggestedPassword);

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) setResetting(false);
    });

  return (
    <section className="card p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/40">
        Account
      </h3>

      {feedback && (
        <p
          role="status"
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            feedback.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            className="input w-56"
            defaultValue={role}
            disabled={pending || isSelf}
            title={isSelf ? 'You cannot change your own role' : undefined}
            onChange={(e) => act(() => changeRoleAction(userId, e.target.value as Role))}
          >
            <option value="MEMBER">Member</option>
            <option value="COACH">Coach</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>

        {!resetting && (
          <button className="btn-secondary" onClick={() => setResetting(true)} disabled={pending}>
            Reset password
          </button>
        )}

        <button
          className={active ? 'btn-danger ml-auto' : 'btn-secondary ml-auto'}
          disabled={pending || (isSelf && active)}
          title={isSelf && active ? 'You cannot deactivate yourself' : undefined}
          onClick={() => act(() => setUserActiveAction(userId, !active))}
        >
          {active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      {resetting && (
        <div className="mt-4 rounded-lg border border-edge bg-ink p-4">
          <label className="label" htmlFor="new-password">
            New password
          </label>
          <div className="flex gap-2">
            <input
              id="new-password"
              className="input font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              className="btn-secondary"
              onClick={() => setResetting(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => act(() => resetPasswordAction(userId, password))}
            >
              Set it
            </button>
          </div>
          <p className="mt-2 text-xs text-white/40">
            They can change it themselves afterwards from their Account page.
          </p>
        </div>
      )}

      {!active && (
        <p className="mt-4 text-sm text-white/50">
          Deactivated. They cannot sign in, and they no longer appear in lists — but their
          bookings, scores and PRs are all kept.
        </p>
      )}
    </section>
  );
}
