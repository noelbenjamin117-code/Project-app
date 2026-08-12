'use client';

import { useState, useTransition } from 'react';
import { WEEKDAY_LABEL } from '@/lib/domain/schedule';
import {
  archiveTemplateAction,
  createTemplateAction,
  updateTemplateAction,
} from '@/app/actions/schedule';

export interface TemplateView {
  id: string;
  name: string;
  dayOfWeek: number;
  dayLabel: string;
  startTimeLocal: string;
  durationMinutes: number;
  capacity: number;
  defaultCoachId: string | null;
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal: string | null;
  cancelRelativeHours: number | null;
  policyLabel: string;
}

type Draft = {
  name: string;
  dayOfWeek: number;
  startTimeLocal: string;
  durationMinutes: number;
  capacity: number;
  defaultCoachId: string;
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal: string;
  cancelRelativeHours: number;
};

const BLANK: Draft = {
  name: '',
  dayOfWeek: 1,
  startTimeLocal: '06:00',
  durationMinutes: 60,
  capacity: 16,
  defaultCoachId: '',
  cancelPolicyType: 'RELATIVE',
  cancelAbsoluteTimeLocal: '21:00',
  cancelRelativeHours: 2,
};

export function TemplateEditor({
  templates,
  coaches,
}: {
  templates: TemplateView[];
  coaches: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [applyToFuture, setApplyToFuture] = useState(false);

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setEditingId(null);
        setCreating(false);
        setApplyToFuture(false);
      }
    });

  const toInput = (d: Draft) => ({
    name: d.name.trim() || `${d.startTimeLocal} class`,
    dayOfWeek: d.dayOfWeek,
    startTimeLocal: d.startTimeLocal,
    durationMinutes: d.durationMinutes,
    capacity: d.capacity,
    defaultCoachId: d.defaultCoachId || null,
    cancelPolicyType: d.cancelPolicyType,
    cancelAbsoluteTimeLocal: d.cancelAbsoluteTimeLocal,
    cancelRelativeHours: d.cancelRelativeHours,
  });

  const startEdit = (template: TemplateView) => {
    setDraft({
      name: template.name,
      dayOfWeek: template.dayOfWeek,
      startTimeLocal: template.startTimeLocal,
      durationMinutes: template.durationMinutes,
      capacity: template.capacity,
      defaultCoachId: template.defaultCoachId ?? '',
      cancelPolicyType: template.cancelPolicyType,
      cancelAbsoluteTimeLocal: template.cancelAbsoluteTimeLocal ?? '21:00',
      cancelRelativeHours: template.cancelRelativeHours ?? 2,
    });
    setEditingId(template.id);
    setCreating(false);
  };

  const byDay = [1, 2, 3, 4, 5, 6, 7]
    .map((day) => ({ day, items: templates.filter((t) => t.dayOfWeek === day) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6">
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

      {byDay.map(({ day, items }) => (
        <section key={day}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
            {WEEKDAY_LABEL[day]}
          </h3>
          <div className="space-y-2">
            {items.map((template) =>
              editingId === template.id ? (
                <DraftForm
                  key={template.id}
                  draft={draft}
                  setDraft={setDraft}
                  coaches={coaches}
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  extra={
                    <label className="mt-3 flex items-start gap-3 rounded-lg border border-edge bg-ink p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-[#f2542d]"
                        checked={applyToFuture}
                        onChange={(e) => setApplyToFuture(e.target.checked)}
                      />
                      <span className="text-white/70">
                        Also apply to classes already on the calendar.
                        <span className="block text-xs text-white/40">
                          Off by default — people who already booked agreed to the current
                          capacity and cancellation rule.
                        </span>
                      </span>
                    </label>
                  }
                  onSave={() =>
                    act(() => updateTemplateAction(template.id, toInput(draft), applyToFuture))
                  }
                  onDelete={() => act(() => archiveTemplateAction(template.id, false))}
                />
              ) : (
                <div key={template.id} className="card flex items-center gap-4 px-4 py-3">
                  <div className="w-20 shrink-0 text-lg font-bold">
                    {template.startTimeLocal}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{template.name}</p>
                    <p className="text-sm text-white/50">
                      {template.capacity} spots · {template.durationMinutes} min ·{' '}
                      {template.policyLabel}
                    </p>
                  </div>
                  <button
                    className="btn-secondary px-3 py-2 text-xs"
                    onClick={() => startEdit(template)}
                  >
                    Edit
                  </button>
                </div>
              ),
            )}
          </div>
        </section>
      ))}

      {creating ? (
        <DraftForm
          draft={draft}
          setDraft={setDraft}
          coaches={coaches}
          pending={pending}
          onCancel={() => setCreating(false)}
          onSave={() => act(() => createTemplateAction(toInput(draft)))}
        />
      ) : (
        <button
          className="btn-secondary"
          onClick={() => {
            setDraft(BLANK);
            setCreating(true);
            setEditingId(null);
          }}
        >
          Add a class to the week
        </button>
      )}
    </div>
  );
}

function DraftForm({
  draft,
  setDraft,
  coaches,
  pending,
  onCancel,
  onSave,
  onDelete,
  extra,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  coaches: Array<{ id: string; name: string }>;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  extra?: React.ReactNode;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <div className="card space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={draft.name}
            placeholder="6:00am WOD"
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Day</label>
          <select
            className="input"
            value={draft.dayOfWeek}
            onChange={(e) => set('dayOfWeek', Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {WEEKDAY_LABEL[day]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Start (gym local time)</label>
          <input
            className="input"
            type="time"
            value={draft.startTimeLocal}
            onChange={(e) => set('startTimeLocal', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Capacity</label>
          <input
            className="input"
            type="number"
            min={1}
            value={draft.capacity}
            onChange={(e) => set('capacity', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Duration (minutes)</label>
          <input
            className="input"
            type="number"
            min={15}
            step={5}
            value={draft.durationMinutes}
            onChange={(e) => set('durationMinutes', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Coach</label>
          <select
            className="input"
            value={draft.defaultCoachId}
            onChange={(e) => set('defaultCoachId', e.target.value)}
          >
            <option value="">Unassigned</option>
            {coaches.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-edge pt-4">
        <label className="label">Cancellation rule</label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['ABSOLUTE', 'By a set time the day before'],
              ['RELATIVE', 'A number of hours before'],
              ['NONE', 'Any time before class'],
            ] as const
          ).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => set('cancelPolicyType', type)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                draft.cancelPolicyType === type
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-edge text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {draft.cancelPolicyType === 'ABSOLUTE' && (
          <div className="mt-3 max-w-xs">
            <label className="label">Deadline on the previous day</label>
            <input
              className="input"
              type="time"
              value={draft.cancelAbsoluteTimeLocal}
              onChange={(e) => set('cancelAbsoluteTimeLocal', e.target.value)}
            />
            <p className="mt-1 text-xs text-white/40">
              Always this wall-clock time locally, including across daylight saving changes.
            </p>
          </div>
        )}

        {draft.cancelPolicyType === 'RELATIVE' && (
          <div className="mt-3 max-w-xs">
            <label className="label">Hours before class start</label>
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={draft.cancelRelativeHours}
              onChange={(e) => set('cancelRelativeHours', Number(e.target.value))}
            />
          </div>
        )}
      </div>

      {extra}

      <div className="flex gap-2 border-t border-edge pt-4">
        <button className="btn-primary" onClick={onSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        {onDelete && (
          <button className="btn-danger ml-auto" onClick={onDelete} disabled={pending}>
            Remove from week
          </button>
        )}
      </div>
    </div>
  );
}
