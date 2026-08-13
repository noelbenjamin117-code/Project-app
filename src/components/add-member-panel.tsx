'use client';

import { useState, useTransition } from 'react';
import type { Role } from '@prisma/client';
import { createUserAction } from '@/app/actions/users';

/**
 * How people get accounts. The owner sets a starting password and passes it
 * on; the member changes it themselves from their Account page.
 */
export function AddMemberPanel({ suggestedPassword }: { suggestedPassword: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [password, setPassword] = useState(suggestedPassword);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Add someone
      </button>
    );
  }

  const submit = () =>
    startTransition(async () => {
      const result = await createUserAction({ name, email, role, password });
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setName('');
        setEmail('');
        setRole('MEMBER');
        // A fresh suggestion, so the next person does not reuse this password.
        setPassword(`${suggestedPassword.split('-')[0]}-${Math.floor(Math.random() * 9000) + 1000}`);
      }
    });

  return (
    <section className="card space-y-4 p-5">
      <h3 className="font-semibold">Add someone</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-name">
            Name
          </label>
          <input
            id="new-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jamie Fitzgerald"
          />
        </div>
        <div>
          <label className="label" htmlFor="new-email">
            Email
          </label>
          <input
            id="new-email"
            className="input"
            type="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jamie@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="new-role">
            Role
          </label>
          <select
            id="new-role"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="MEMBER">Member</option>
            <option value="COACH">Coach — can run rosters and programme</option>
            <option value="OWNER">Owner — can also manage people</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="new-password">
            Starting password
          </label>
          <input
            id="new-password"
            className="input font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-white/40">
            Text this to them. They can change it under Account.
          </p>
        </div>
      </div>

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

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Adding…' : 'Add them'}
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </section>
  );
}
