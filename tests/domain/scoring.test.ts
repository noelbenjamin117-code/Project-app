import { describe, expect, it } from 'vitest';
import {
  compareScores,
  estimateOneRepMax,
  formatDuration,
  formatScore,
  isLiftPr,
  parseDuration,
  rankScores,
} from '@/lib/domain/scoring';

describe('ordering by score type', () => {
  it('ranks a faster time first', () => {
    const ranked = rankScores('TIME', [
      { timeSeconds: 240 },
      { timeSeconds: 181 },
      { timeSeconds: 300 },
    ]);
    expect(ranked.map((r) => r.score.timeSeconds)).toEqual([181, 240, 300]);
  });

  it('puts every finisher ahead of every capped athlete', () => {
    // A finish of 9:59 beats a cap with 200 reps: they finished, the other did not.
    const ranked = rankScores('TIME', [
      { cappedOut: true, capReps: 200 },
      { timeSeconds: 599 },
    ]);
    expect(ranked[0].score.timeSeconds).toBe(599);
    expect(ranked[1].score.cappedOut).toBe(true);
  });

  it('orders capped athletes by reps completed', () => {
    const ranked = rankScores('TIME', [
      { cappedOut: true, capReps: 12 },
      { cappedOut: true, capReps: 40 },
      { cappedOut: true, capReps: 5 },
    ]);
    expect(ranked.map((r) => r.score.capReps)).toEqual([40, 12, 5]);
  });

  it('ranks AMRAP by rounds then extra reps', () => {
    const ranked = rankScores('ROUNDS_REPS', [
      { rounds: 12, reps: 3 },
      { rounds: 12, reps: 14 },
      { rounds: 13, reps: 0 },
    ]);
    expect(ranked.map((r) => `${r.score.rounds}+${r.score.reps}`)).toEqual([
      '13+0',
      '12+14',
      '12+3',
    ]);
  });

  it('ranks reps and load highest-first', () => {
    expect(rankScores('REPS', [{ reps: 90 }, { reps: 142 }]).map((r) => r.score.reps)).toEqual([
      142, 90,
    ]);
    expect(
      rankScores('LOAD', [{ loadKg: 100 }, { loadKg: 142.5 }]).map((r) => r.score.loadKg),
    ).toEqual([142.5, 100]);
  });

  it('shares a rank on a tie and skips the next one', () => {
    const ranked = rankScores('TIME', [
      { timeSeconds: 200 },
      { timeSeconds: 200 },
      { timeSeconds: 260 },
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('treats a missing time as worse than any recorded one', () => {
    expect(compareScores('TIME', { timeSeconds: 600 }, {})).toBeLessThan(0);
  });
});

describe('formatting', () => {
  it('formats durations the way a whiteboard reads', () => {
    expect(formatDuration(201)).toBe('3:21');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('shows a capped result as cap plus reps', () => {
    expect(formatScore('TIME', { cappedOut: true, capReps: 12 }, 1200)).toBe('20:00 CAP + 12');
  });

  it('formats each score shape', () => {
    expect(formatScore('ROUNDS_REPS', { rounds: 12, reps: 8 })).toBe('12 + 8');
    expect(formatScore('REPS', { reps: 142 })).toBe('142 reps');
    expect(formatScore('LOAD', { loadKg: 102.5 })).toBe('102.5 kg');
    expect(formatScore('LOAD', { loadKg: 100 })).toBe('100 kg');
  });

  it('parses the times members actually type', () => {
    expect(parseDuration('3:21')).toBe(201);
    expect(parseDuration('12')).toBe(12);
    expect(parseDuration('1:01:01')).toBe(3661);
    expect(parseDuration('nonsense')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('lift PRs across rep schemes', () => {
  const history = [
    { movementId: 'back-squat', reps: 1, loadKg: 140 },
    { movementId: 'back-squat', reps: 3, loadKg: 120 },
    { movementId: 'deadlift', reps: 1, loadKg: 180 },
  ];

  it('counts a heavier triple as a PR even though it is under the single', () => {
    expect(isLiftPr({ movementId: 'back-squat', reps: 3, loadKg: 125 }, history)).toBe(true);
  });

  it('does not let a heavy triple overwrite the one-rep record', () => {
    // 3x125 is not a 1RM PR — different record entirely.
    expect(isLiftPr({ movementId: 'back-squat', reps: 1, loadKg: 125 }, history)).toBe(false);
  });

  it('keeps movements independent', () => {
    expect(isLiftPr({ movementId: 'deadlift', reps: 3, loadKg: 100 }, history)).toBe(true);
  });

  it('needs a strictly heavier load — matching your best is not a PR', () => {
    expect(isLiftPr({ movementId: 'back-squat', reps: 1, loadKg: 140 }, history)).toBe(false);
    expect(isLiftPr({ movementId: 'back-squat', reps: 1, loadKg: 140.5 }, history)).toBe(true);
  });

  it('estimates a 1RM for context without inventing a record', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 3)).toBe(110);
  });
});
