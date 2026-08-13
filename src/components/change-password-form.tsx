'use client';

import { useState, useTransition } from 'react';
import { changeOwnPasswordAction } from '@/app/actions/users';

/**
 * Members are given a starting password by the owner, so they need somewhere
 * to change it to something only they know.
 */
export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  if (!open) {
    return (
      <button className="btn-secondary w-full" onClick={() => setOpen(true)}>
        Change my password
      </button>
    );
  }

  const submit = () => {
    if (next !== confirm) {
      setFeedback({ ok: false, text: "Those passwords don't match." });
      return;
    }
    startTransition(async () => {
      const result = await changeOwnPasswordAction(current, next);
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setCurrent('');
        setNext('');
        setConfirm('');
        setOpen(false);
      }
    });
  };

  return (
    <div className="card space-y-3 p-4">
      <h3 className="font-semibold">Change your password</h3>

      <input
        className="input"
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />

      {feedback && (
        <p role="status" className={`text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}>
          {feedback.text}
        </p>
      )}

      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button className="btn-primary flex-1" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
