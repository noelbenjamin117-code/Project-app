export type ScoreType = 'TIME' | 'ROUNDS_REPS' | 'REPS' | 'LOAD';
export type ScalingLevel = 'RX_PLUS' | 'RX' | 'SCALED';
export type WodType = 'AMRAP' | 'EMOM' | 'FOR_TIME' | 'RFT' | 'STRENGTH';

export const SCALING_LABEL: Record<ScalingLevel, string> = {
  RX_PLUS: 'Rx+',
  RX: 'Rx',
  SCALED: 'Scaled',
};

/** Best-to-worst display order. Leaderboards never mix levels. */
export const SCALING_ORDER: ScalingLevel[] = ['RX_PLUS', 'RX', 'SCALED'];

export const WOD_TYPE_LABEL: Record<WodType, string> = {
  AMRAP: 'AMRAP',
  EMOM: 'EMOM',
  FOR_TIME: 'For Time',
  RFT: 'Rounds For Time',
  STRENGTH: 'Strength',
};

/** The score shape each WOD type is logged in. */
export const DEFAULT_SCORE_TYPE: Record<WodType, ScoreType> = {
  AMRAP: 'ROUNDS_REPS',
  EMOM: 'REPS',
  FOR_TIME: 'TIME',
  RFT: 'TIME',
  STRENGTH: 'LOAD',
};

export interface ScoreValue {
  timeSeconds?: number | null;
  rounds?: number | null;
  reps?: number | null;
  loadKg?: number | null;
  cappedOut?: boolean;
  capReps?: number | null;
}

/**
 * Order two scores of the same type. Negative means `a` ranks ahead of `b`.
 *
 * The one non-obvious rule is the time cap: everybody who finished beats
 * everybody who capped, however many reps the capped athlete got. Among capped
 * athletes, more reps ranks higher. That is how a whiteboard is read in a gym —
 * "20:00 CAP + 12" is a worse result than any finishing time.
 */
export function compareScores(type: ScoreType, a: ScoreValue, b: ScoreValue): number {
  switch (type) {
    case 'TIME': {
      const aCapped = !!a.cappedOut;
      const bCapped = !!b.cappedOut;
      if (aCapped !== bCapped) return aCapped ? 1 : -1;
      if (aCapped && bCapped) return (b.capReps ?? 0) - (a.capReps ?? 0);
      return (a.timeSeconds ?? Infinity) - (b.timeSeconds ?? Infinity);
    }
    case 'ROUNDS_REPS': {
      const byRounds = (b.rounds ?? 0) - (a.rounds ?? 0);
      if (byRounds !== 0) return byRounds;
      return (b.reps ?? 0) - (a.reps ?? 0);
    }
    case 'REPS':
      return (b.reps ?? 0) - (a.reps ?? 0);
    case 'LOAD':
      return (b.loadKg ?? 0) - (a.loadKg ?? 0);
  }
}

/** True when `candidate` is strictly better than `best`. */
export function isBetterScore(
  type: ScoreType,
  candidate: ScoreValue,
  best: ScoreValue | null | undefined,
): boolean {
  if (!best) return true;
  return compareScores(type, candidate, best) < 0;
}

/** Rank a set of scores, sharing a rank on ties (1, 1, 3, …). */
export function rankScores<T extends ScoreValue>(
  type: ScoreType,
  scores: T[],
): Array<{ rank: number; score: T }> {
  const sorted = scores.slice().sort((a, b) => compareScores(type, a, b));
  const ranked: Array<{ rank: number; score: T }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const rank =
      i > 0 && compareScores(type, sorted[i], sorted[i - 1]) === 0 ? ranked[i - 1].rank : i + 1;
    ranked.push({ rank, score: sorted[i] });
  }
  return ranked;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 201 -> "3:21", 3661 -> "1:01:01" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(seconds).padStart(2, '0')}`
    : `${mm}:${String(seconds).padStart(2, '0')}`;
}

/** "3:21" | "20:00 CAP + 12" | "12 + 8" | "142 reps" | "102.5 kg" */
export function formatScore(type: ScoreType, score: ScoreValue, timeCapSeconds?: number | null): string {
  switch (type) {
    case 'TIME':
      if (score.cappedOut) {
        const cap = timeCapSeconds ? formatDuration(timeCapSeconds) : 'CAP';
        return `${cap} CAP + ${score.capReps ?? 0}`;
      }
      return score.timeSeconds != null ? formatDuration(score.timeSeconds) : '—';
    case 'ROUNDS_REPS':
      return `${score.rounds ?? 0} + ${score.reps ?? 0}`;
    case 'REPS':
      return `${score.reps ?? 0} reps`;
    case 'LOAD':
      return score.loadKg != null ? `${trimNumber(score.loadKg)} kg` : '—';
  }
}

/** "12 rounds + 8 reps" — the long form, for a member's own history. */
export function describeScore(
  type: ScoreType,
  score: ScoreValue,
  timeCapSeconds?: number | null,
): string {
  if (type === 'ROUNDS_REPS') {
    return `${score.rounds ?? 0} rounds + ${score.reps ?? 0} reps`;
  }
  return formatScore(type, score, timeCapSeconds);
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Parse "3:21" or "1:01:01" or "201" into seconds. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// ---------------------------------------------------------------------------
// PR detection
// ---------------------------------------------------------------------------

export interface LiftAttempt {
  movementId: string;
  reps: number;
  loadKg: number;
}

/**
 * A lift PR is per (movement, rep count): a 3RM and a 1RM are different
 * records, so 3x100kg must never overwrite 1x140kg, and beating your own 3RM
 * is a PR even though it is nowhere near your 1RM.
 */
export function isLiftPr(
  attempt: LiftAttempt,
  history: LiftAttempt[],
): boolean {
  const best = history
    .filter((h) => h.movementId === attempt.movementId && h.reps === attempt.reps)
    .reduce<number>((max, h) => Math.max(max, h.loadKg), 0);
  return attempt.loadKg > best;
}

/**
 * Epley estimate, shown alongside a lift for context. Deliberately NOT treated
 * as a PR of its own — members chase real numbers on the bar, and an estimated
 * 1RM that "PRs" off a set of ten is noise.
 */
export function estimateOneRepMax(loadKg: number, reps: number): number {
  if (reps <= 1) return loadKg;
  return Math.round(loadKg * (1 + reps / 30) * 10) / 10;
}

/** Key a benchmark PR on the WOD and the scaling level it was done at. */
export function benchmarkPrKey(wodDefinitionId: string, scalingLevel: ScalingLevel): string {
  return `${wodDefinitionId}:${scalingLevel}`;
}
