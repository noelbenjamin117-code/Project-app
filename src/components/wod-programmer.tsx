'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { ScalingLevel, WodType } from '@prisma/client';
import {
  DEFAULT_SCORE_TYPE,
  SCALING_LABEL,
  SCALING_ORDER,
  WOD_TYPE_LABEL,
  parseDuration,
} from '@/lib/domain/scoring';
import {
  createAndScheduleWodAction,
  scheduleExistingWodAction,
  unscheduleWodAction,
} from '@/app/actions/programming';

export interface ScheduledWodView {
  id: string;
  name: string;
  type: WodType;
  description: string;
  notes: string | null;
  classNames: string[];
  resultCount: number;
  scalingOptions: Array<{ level: ScalingLevel; description: string }>;
}

const WOD_TYPES: WodType[] = ['AMRAP', 'EMOM', 'FOR_TIME', 'RFT', 'STRENGTH'];

export function WodProgrammer({
  date,
  prevDate,
  nextDate,
  classes,
  library,
  scheduled,
}: {
  date: string;
  prevDate: string;
  nextDate: string;
  classes: Array<{ id: string; label: string }>;
  library: Array<{ id: string; name: string; type: WodType; isBenchmark: boolean }>;
  scheduled: ScheduledWodView[];
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');

  const [name, setName] = useState('');
  const [type, setType] = useState<WodType>('AMRAP');
  const [description, setDescription] = useState('');
  const [isBenchmark, setIsBenchmark] = useState(false);
  const [timeCap, setTimeCap] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [existingId, setExistingId] = useState('');
  const [scaling, setScaling] = useState<Record<ScalingLevel, string>>({
    RX_PLUS: '',
    RX: 'As prescribed',
    SCALED: '',
  });

  const act = (fn: () => Promise<{ ok: boolean; message: string | null; error: string | null }>) =>
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setName('');
        setDescription('');
        setNotes('');
        setTimeCap('');
        setSelectedClasses([]);
      }
    });

  const submitNew = () => {
    if (!description.trim()) {
      setFeedback({ ok: false, text: 'Add the workout itself.' });
      return;
    }
    act(() =>
      createAndScheduleWodAction(
        {
          name: name.trim() || null,
          isBenchmark,
          type,
          scoreType: DEFAULT_SCORE_TYPE[type],
          timeCapSeconds: parseDuration(timeCap),
          description,
          scalingOptions: SCALING_ORDER.filter((level) => scaling[level].trim()).map((level) => ({
            level,
            description: scaling[level],
          })),
        },
        date,
        selectedClasses,
        notes,
      ),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/coach/program?date=${prevDate}`} className="btn-secondary text-xs">
          ← {prevDate}
        </Link>
        <p className="text-lg font-bold">{date}</p>
        <Link href={`/coach/program?date=${nextDate}`} className="btn-secondary text-xs">
          {nextDate} →
        </Link>
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

      {scheduled.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">
            On the board for {date}
          </h3>
          {scheduled.map((item) => (
            <div key={item.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold">
                    {item.name}
                    <span className="pill ml-2 bg-brand/15 text-brand">
                      {WOD_TYPE_LABEL[item.type]}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-white/70">
                    {item.description}
                  </p>
                  <p className="mt-2 text-xs text-white/40">
                    {item.classNames.join(', ')} · {item.resultCount} scores logged
                  </p>
                </div>
                <button
                  className="btn-secondary shrink-0 px-3 py-2 text-xs"
                  disabled={pending}
                  onClick={() => act(() => unscheduleWodAction(item.id))}
                >
                  Remove
                </button>
              </div>

              {item.scalingOptions.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-edge pt-3 text-sm">
                  {item.scalingOptions.map((option) => (
                    <p key={option.level}>
                      <span className="font-semibold text-brand">
                        {SCALING_LABEL[option.level]}
                      </span>{' '}
                      <span className="text-white/70">{option.description}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="card p-5">
        <div className="mb-4 flex gap-2">
          <button
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === 'new' ? 'bg-brand/15 text-brand' : 'text-white/50'
            }`}
            onClick={() => setMode('new')}
          >
            New workout
          </button>
          <button
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === 'existing' ? 'bg-brand/15 text-brand' : 'text-white/50'
            }`}
            onClick={() => setMode('existing')}
          >
            Re-use a benchmark
          </button>
        </div>

        {mode === 'existing' ? (
          <div className="space-y-4">
            <div>
              <label className="label">Workout</label>
              <select
                className="input"
                value={existingId}
                onChange={(e) => setExistingId(e.target.value)}
              >
                <option value="">Choose…</option>
                {library.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {WOD_TYPE_LABEL[item.type]}
                    {item.isBenchmark ? ' (benchmark)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-white/40">
                Re-using a benchmark is what makes today's time comparable to the last time the
                gym did it.
              </p>
            </div>

            <ClassPicker
              classes={classes}
              selected={selectedClasses}
              onChange={setSelectedClasses}
            />

            <button
              className="btn-primary"
              disabled={pending || !existingId}
              onClick={() =>
                act(() => scheduleExistingWodAction(existingId, date, selectedClasses, notes))
              }
            >
              {pending ? 'Saving…' : 'Put it on the board'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Name (optional)</label>
                <input
                  className="input"
                  value={name}
                  placeholder="Fran, or leave blank for a daily WOD"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Format</label>
                <select
                  className="input"
                  value={type}
                  onChange={(e) => setType(e.target.value as WodType)}
                >
                  {WOD_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {WOD_TYPE_LABEL[option]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-white/40">
                  Scored as {DEFAULT_SCORE_TYPE[type].toLowerCase().replace('_', ' + ')}.
                </p>
              </div>
            </div>

            <div>
              <label className="label">The workout</label>
              <textarea
                className="input min-h-32 font-mono text-sm"
                value={description}
                placeholder={'21-15-9 reps for time:\nThruster 43/30kg\nPull-up'}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Time cap (optional)</label>
                <input
                  className="input"
                  placeholder="10:00"
                  value={timeCap}
                  onChange={(e) => setTimeCap(e.target.value)}
                />
                <p className="mt-1 text-xs text-white/40">
                  Capped athletes rank after everyone who finished, ordered by reps.
                </p>
              </div>
              <label className="flex items-center gap-3 self-end pb-3 text-sm text-white/70">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand"
                  checked={isBenchmark}
                  onChange={(e) => setIsBenchmark(e.target.checked)}
                />
                It's a benchmark (re-usable, tracked for PRs)
              </label>
            </div>

            <div className="space-y-2 border-t border-edge pt-4">
              <label className="label">Scaling options</label>
              {SCALING_ORDER.map((level) => (
                <div key={level} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-sm font-semibold text-brand">
                    {SCALING_LABEL[level]}
                  </span>
                  <input
                    className="input"
                    placeholder={level === 'RX' ? 'As prescribed' : 'Leave blank to skip'}
                    value={scaling[level]}
                    onChange={(e) => setScaling({ ...scaling, [level]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="label">Coach's note (optional)</label>
              <input
                className="input"
                value={notes}
                placeholder="Go out hard, this one's short."
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <ClassPicker
              classes={classes}
              selected={selectedClasses}
              onChange={setSelectedClasses}
            />

            <button className="btn-primary" disabled={pending} onClick={submitNew}>
              {pending ? 'Saving…' : 'Put it on the board'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ClassPicker({
  classes,
  selected,
  onChange,
}: {
  classes: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="border-t border-edge pt-4">
      <label className="label">Which classes?</label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
            selected.length === 0 ? 'border-brand bg-brand/15 text-brand' : 'border-edge text-white/60'
          }`}
        >
          All classes
        </button>
        {classes.map((cls) => {
          const active = selected.includes(cls.id);
          return (
            <button
              key={cls.id}
              type="button"
              onClick={() =>
                onChange(active ? selected.filter((id) => id !== cls.id) : [...selected, cls.id])
              }
              className={`rounded-lg border px-3 py-2 text-sm ${
                active ? 'border-brand bg-brand/15 text-brand' : 'border-edge text-white/60'
              }`}
            >
              {cls.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
