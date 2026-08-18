'use client';

import { useState, useTransition } from 'react';
import type { ScalingLevel, ScoreType } from '@prisma/client';
import { SCALING_LABEL, SCALING_ORDER, formatDuration, parseDuration } from '@/lib/domain/scoring';
import { logScoreAction } from '@/app/actions/results';

export interface ExistingScore {
  scalingLevel: ScalingLevel;
  timeSeconds: number | null;
  rounds: number | null;
  reps: number | null;
  loadKg: number | null;
  cappedOut: boolean;
  capReps: number | null;
  notes: string | null;
}

/**
 * One form for every score shape. Which inputs appear is driven by the WOD's
 * score type, so a member never sees a "rounds" box on a lifting day.
 */
export function LogScoreForm({
  wodDefinitionId,
  scheduledWodId,
  classInstanceId,
  scoreType,
  timeCapSeconds,
  availableLevels,
  existing,
}: {
  wodDefinitionId: string;
  scheduledWodId?: string | null;
  classInstanceId?: string | null;
  scoreType: ScoreType;
  timeCapSeconds: number | null;
  availableLevels: ScalingLevel[];
  existing?: ExistingScore;
}) {
  const levels = SCALING_ORDER.filter((l) => availableLevels.includes(l));
  const [open, setOpen] = useState(!existing);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [level, setLevel] = useState<ScalingLevel>(existing?.scalingLevel ?? levels[0] ?? 'RX');
  const [timeInput, setTimeInput] = useState(
    existing?.timeSeconds != null ? formatDuration(existing.timeSeconds) : '',
  );
  const [cappedOut, setCappedOut] = useState(existing?.cappedOut ?? false);
  const [capReps, setCapReps] = useState(existing?.capReps?.toString() ?? '');
  const [rounds, setRounds] = useState(existing?.rounds?.toString() ?? '');
  const [reps, setReps] = useState(existing?.reps?.toString() ?? '');
  const [loadKg, setLoadKg] = useState(existing?.loadKg?.toString() ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  if (!open) {
    return (
      <button className="btn-secondary mt-3 w-full" onClick={() => setOpen(true)}>
        Edit score
      </button>
    );
  }

  const submit = () => {
    const parsedTime = parseDuration(timeInput);
    if (scoreType === 'TIME' && !cappedOut && parsedTime == null) {
      setFeedback({ ok: false, text: 'Enter a time like 3:21.' });
      return;
    }

    startTransition(async () => {
      const result = await logScoreAction({
        wodDefinitionId,
        scheduledWodId: scheduledWodId ?? null,
        classInstanceId: classInstanceId ?? null,
        scalingLevel: level,
        timeSeconds: scoreType === 'TIME' && !cappedOut ? parsedTime : null,
        rounds: scoreType === 'ROUNDS_REPS' ? toInt(rounds) : null,
        reps:
          scoreType === 'ROUNDS_REPS' || scoreType === 'REPS' ? toInt(reps) ?? 0 : null,
        loadKg: scoreType === 'LOAD' ? toFloat(loadKg) : null,
        cappedOut: scoreType === 'TIME' ? cappedOut : false,
        capReps: cappedOut ? toInt(capReps) ?? 0 : null,
        notes: notes.trim() || null,
      });
      setFeedback({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok && existing) setOpen(false);
    });
  };

  return (
    <div className="card mt-3 space-y-4 p-4">
      <div>
        <span className="label">Scaling</span>
        <div className="flex gap-2">
          {levels.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLevel(option)}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold ${
                level === option
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-edge text-white/60'
              }`}
            >
              {SCALING_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      {scoreType === 'TIME' && (
        <div className="space-y-3">
          {!cappedOut && (
            <div>
              <label className="label" htmlFor="time">
                Time
              </label>
              <input
                id="time"
                className="input"
                inputMode="numeric"
                placeholder="3:21"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
              />
            </div>
          )}

          {timeCapSeconds != null && (
            <label className="flex items-center gap-3 text-sm text-white/70">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand"
                checked={cappedOut}
                onChange={(e) => setCappedOut(e.target.checked)}
              />
              Hit the {formatDuration(timeCapSeconds)} cap
            </label>
          )}

          {cappedOut && (
            <div>
              <label className="label" htmlFor="capReps">
                Reps completed at the cap
              </label>
              <input
                id="capReps"
                className="input"
                inputMode="numeric"
                placeholder="12"
                value={capReps}
                onChange={(e) => setCapReps(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {scoreType === 'ROUNDS_REPS' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="rounds">
              Rounds
            </label>
            <input
              id="rounds"
              className="input"
              inputMode="numeric"
              value={rounds}
              onChange={(e) => setRounds(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="reps">
              + Reps
            </label>
            <input
              id="reps"
              className="input"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
            />
          </div>
        </div>
      )}

      {scoreType === 'REPS' && (
        <div>
          <label className="label" htmlFor="totalReps">
            Total reps
          </label>
          <input
            id="totalReps"
            className="input"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </div>
      )}

      {scoreType === 'LOAD' && (
        <div>
          <label className="label" htmlFor="load">
            Load (kg)
          </label>
          <input
            id="load"
            className="input"
            inputMode="decimal"
            placeholder="102.5"
            value={loadKg}
            onChange={(e) => setLoadKg(e.target.value)}
          />
        </div>
      )}

      <div>
        <label className="label" htmlFor="notes">
          Notes (optional)
        </label>
        <input
          id="notes"
          className="input"
          placeholder="Scaled to 30kg, felt strong"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {feedback && (
        <p role="status" className={`text-sm ${feedback.ok ? 'text-ok' : 'text-bad'}`}>
          {feedback.text}
        </p>
      )}

      <div className="flex gap-2">
        {existing && (
          <button className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </button>
        )}
        <button className="btn-primary flex-1" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Save score'}
        </button>
      </div>
    </div>
  );
}

function toInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFloat(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
