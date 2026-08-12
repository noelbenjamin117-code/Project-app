'use client';

import { useState, useTransition } from 'react';
import {
  cancelClassAction,
  coachBookMemberAction,
  restoreClassAction,
} from '@/app/actions/booking';

/**
 * The one-off changes a coach makes to a single class: adding a walk-in, and
 * cancelling the class for a holiday or a sick coach. Cancelling here never
 * penalises anyone booked in.
 */
export function ClassAdminPanel({
  classInstanceId,
  cancelled,
  addableMembers,
}: {
  classInstanceId: string;
  cancelled: boolean;
  addableMembers: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [memberId, setMemberId] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState('');

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setConfirmingCancel(false);
        setMemberId('');
        setReason('');
      }
    });

  return (
    <section className="card p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/40">
        Class admin
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

      {!cancelled && (
        <div className="mb-6">
          <label className="label" htmlFor="walkin">
            Add someone who showed up
          </label>
          <div className="flex gap-2">
            <select
              id="walkin"
              className="input flex-1"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
            >
              <option value="">Choose a member…</option>
              {addableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              disabled={pending || !memberId}
              onClick={() => act(() => coachBookMemberAction(classInstanceId, memberId))}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {cancelled ? (
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() => act(() => restoreClassAction(classInstanceId))}
        >
          Restore this class
        </button>
      ) : confirmingCancel ? (
        <div className="rounded-lg border border-bad/40 bg-bad/5 p-4">
          <p className="font-semibold text-bad">Cancel this class?</p>
          <p className="mt-1 text-sm text-white/70">
            Everyone booked in is released and notified. Nobody gets a strike.
          </p>
          <input
            className="input mt-3"
            placeholder="Reason (shown to members) — e.g. Coach out sick"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="btn-secondary"
              disabled={pending}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep it
            </button>
            <button
              className="btn-danger"
              disabled={pending}
              onClick={() => act(() => cancelClassAction(classInstanceId, reason))}
            >
              {pending ? 'Cancelling…' : 'Cancel class'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-danger" onClick={() => setConfirmingCancel(true)}>
          Cancel this class
        </button>
      )}
    </section>
  );
}
