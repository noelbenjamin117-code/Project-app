import 'server-only';
import type { Prisma, Result, ScalingLevel, ScoreType } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertSelfOrStaff } from '@/lib/permissions';
import { AppError, notFound } from '@/lib/errors';
import { todayLocal, type LocalDate } from '@/lib/time';
import { compareScores, isLiftPr, type ScoreValue } from '@/lib/domain/scoring';

type Tx = Prisma.TransactionClient;

export interface LiftInput {
  movementId: string;
  reps: number;
  loadKg: number;
}

export interface ResultInput {
  wodDefinitionId: string;
  scheduledWodId?: string | null;
  classInstanceId?: string | null;
  scalingLevel: ScalingLevel;
  timeSeconds?: number | null;
  rounds?: number | null;
  reps?: number | null;
  loadKg?: number | null;
  cappedOut?: boolean;
  capReps?: number | null;
  notes?: string | null;
  performedOn?: LocalDate;
  lifts?: LiftInput[];
}

/**
 * Check the submitted score actually fits the WOD's score type. Each type
 * populates exactly one shape; anything else is a bug in the client or someone
 * poking at the API.
 */
function validateScore(scoreType: ScoreType, input: ResultInput): void {
  const fail = (message: string) => {
    throw new AppError(message, 422, 'INVALID_SCORE');
  };

  switch (scoreType) {
    case 'TIME':
      if (input.cappedOut) {
        if (input.capReps == null || input.capReps < 0) fail('Enter the reps completed at the cap.');
      } else if (input.timeSeconds == null || input.timeSeconds <= 0) {
        fail('Enter a finishing time.');
      }
      break;
    case 'ROUNDS_REPS':
      if (input.rounds == null || input.rounds < 0) fail('Enter the rounds completed.');
      if (input.reps == null || input.reps < 0) fail('Enter the extra reps (0 if none).');
      break;
    case 'REPS':
      if (input.reps == null || input.reps < 0) fail('Enter the total reps.');
      break;
    case 'LOAD':
      if (input.loadKg == null || input.loadKg <= 0) fail('Enter the load in kg.');
      break;
  }
}

/**
 * Log or update a score.
 *
 * A member may log a score for a WOD they were not checked into — someone who
 * did Fran on their own at 6pm still owns that number. Those results count
 * toward personal history and the all-time benchmark board; the per-class
 * leaderboard only shows scores tied to that class.
 */
export async function logResult(
  actor: SessionUser,
  input: ResultInput,
  memberId: string = actor.id,
  now: Date = new Date(),
): Promise<Result> {
  assertSelfOrStaff(actor, memberId);

  const definition = await prisma.wodDefinition.findUnique({
    where: { id: input.wodDefinitionId },
  });
  if (!definition) throw notFound('That workout no longer exists.');

  validateScore(definition.scoreType, input);

  const performedOn = input.performedOn ?? todayLocal(now);

  const data = {
    memberId,
    wodDefinitionId: definition.id,
    scheduledWodId: input.scheduledWodId ?? null,
    classInstanceId: input.classInstanceId ?? null,
    scalingLevel: input.scalingLevel,
    timeSeconds: input.cappedOut ? null : input.timeSeconds ?? null,
    rounds: input.rounds ?? null,
    reps: input.reps ?? null,
    loadKg: input.loadKg ?? null,
    cappedOut: input.cappedOut ?? false,
    capReps: input.cappedOut ? input.capReps ?? 0 : null,
    notes: input.notes?.trim() || null,
    performedOn,
  };

  const result = await prisma.$transaction(async (tx) => {
    // One score per member per programmed WOD; ad-hoc logs (no scheduledWodId)
    // are free to repeat, since NULLs don't collide in a unique index.
    const existing = input.scheduledWodId
      ? await tx.result.findFirst({
          where: { memberId, scheduledWodId: input.scheduledWodId },
        })
      : null;

    const saved = existing
      ? await tx.result.update({ where: { id: existing.id }, data })
      : await tx.result.create({ data });

    await tx.liftResult.deleteMany({ where: { resultId: saved.id } });
    for (const lift of input.lifts ?? []) {
      await tx.liftResult.create({
        data: {
          memberId,
          movementId: lift.movementId,
          reps: lift.reps,
          loadKg: lift.loadKg,
          resultId: saved.id,
          performedOn,
        },
      });
    }

    await recomputeWodPrs(tx, memberId, definition.id, definition.scoreType);
    for (const movementId of new Set((input.lifts ?? []).map((l) => l.movementId))) {
      await recomputeLiftPrs(tx, memberId, movementId);
    }

    return saved;
  });

  return prisma.result.findUniqueOrThrow({ where: { id: result.id } });
}

export async function deleteResult(
  actor: SessionUser,
  resultId: string,
): Promise<void> {
  const result = await prisma.result.findUnique({
    where: { id: resultId },
    include: { wodDefinition: true, liftResults: true },
  });
  if (!result) throw notFound('That result no longer exists.');
  assertSelfOrStaff(actor, result.memberId);

  await prisma.$transaction(async (tx) => {
    const movementIds = new Set(result.liftResults.map((l) => l.movementId));
    await tx.result.delete({ where: { id: resultId } });
    // Deleting a result can dethrone a PR, so the flags are rebuilt rather
    // than left pointing at a row that no longer exists.
    await recomputeWodPrs(tx, result.memberId, result.wodDefinitionId, result.wodDefinition.scoreType);
    for (const movementId of movementIds) {
      await recomputeLiftPrs(tx, result.memberId, movementId);
    }
  });
}

/**
 * Rebuild the PR flags for one member on one WOD.
 *
 * A result is a PR if it beat everything the member had done before it, so the
 * flags stay on the results that were PRs at the time and a member's history
 * reads as a progression. Walking chronologically also means a backdated entry
 * correctly demotes anything it should.
 *
 * Scaling levels are separate ladders: a Scaled PR is not measured against an
 * Rx effort.
 */
async function recomputeWodPrs(
  tx: Tx,
  memberId: string,
  wodDefinitionId: string,
  scoreType: ScoreType,
): Promise<void> {
  const results = await tx.result.findMany({
    where: { memberId, wodDefinitionId },
    orderBy: [{ performedOn: 'asc' }, { createdAt: 'asc' }],
  });

  const bestByLevel = new Map<ScalingLevel, ScoreValue>();

  for (const result of results) {
    const score: ScoreValue = {
      timeSeconds: result.timeSeconds,
      rounds: result.rounds,
      reps: result.reps,
      loadKg: result.loadKg,
      cappedOut: result.cappedOut,
      capReps: result.capReps,
    };
    const best = bestByLevel.get(result.scalingLevel);
    const isPr = !best || compareScores(scoreType, score, best) < 0;
    if (isPr) bestByLevel.set(result.scalingLevel, score);

    if (result.isPr !== isPr) {
      await tx.result.update({ where: { id: result.id }, data: { isPr } });
    }
  }
}

/** Same walk for barbell lifts, keyed on (movement, reps) so a 3RM and a 1RM
 *  are independent records. */
async function recomputeLiftPrs(tx: Tx, memberId: string, movementId: string): Promise<void> {
  const lifts = await tx.liftResult.findMany({
    where: { memberId, movementId },
    orderBy: [{ performedOn: 'asc' }, { createdAt: 'asc' }],
  });

  const seen: Array<{ movementId: string; reps: number; loadKg: number }> = [];
  for (const lift of lifts) {
    const isPr = isLiftPr({ movementId, reps: lift.reps, loadKg: lift.loadKg }, seen);
    seen.push({ movementId, reps: lift.reps, loadKg: lift.loadKg });
    if (lift.isPr !== isPr) {
      await tx.liftResult.update({ where: { id: lift.id }, data: { isPr } });
    }
  }
}

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  rank: number;
  resultId: string;
  memberId: string;
  memberName: string;
  scalingLevel: ScalingLevel;
  score: ScoreValue;
  isPr: boolean;
  notes: string | null;
}

/**
 * Leaderboard for one programmed WOD.
 *
 * Rows are fetched with typed score columns and ordered in application code by
 * the same comparator the rest of the app uses, so the whiteboard, the class
 * board and a member's history can never disagree about who won. At one class
 * board's worth of rows the sort is free, and it keeps the time-cap rule in a
 * single place instead of duplicated into SQL.
 */
export async function getLeaderboard(
  scheduledWodId: string,
  options: { scalingLevel?: ScalingLevel | null } = {},
): Promise<{ rows: LeaderboardRow[]; scoreType: ScoreType; timeCapSeconds: number | null }> {
  const scheduled = await prisma.scheduledWod.findUnique({
    where: { id: scheduledWodId },
    include: { wodDefinition: true },
  });
  if (!scheduled) throw notFound('That workout is not on the schedule.');

  const results = await prisma.result.findMany({
    where: {
      scheduledWodId,
      ...(options.scalingLevel ? { scalingLevel: options.scalingLevel } : {}),
    },
    include: { member: { select: { id: true, name: true } } },
  });

  return {
    scoreType: scheduled.wodDefinition.scoreType,
    timeCapSeconds: scheduled.wodDefinition.timeCapSeconds,
    rows: rankRows(results, scheduled.wodDefinition.scoreType),
  };
}

/**
 * All-time board for a benchmark: each member's single best effort at each
 * scaling level, however long ago they did it.
 */
export async function getBenchmarkLeaderboard(
  wodDefinitionId: string,
  options: { scalingLevel?: ScalingLevel | null; since?: LocalDate | null } = {},
): Promise<{ rows: LeaderboardRow[]; scoreType: ScoreType; timeCapSeconds: number | null }> {
  const definition = await prisma.wodDefinition.findUnique({ where: { id: wodDefinitionId } });
  if (!definition) throw notFound('That workout no longer exists.');

  const results = await prisma.result.findMany({
    where: {
      wodDefinitionId,
      ...(options.scalingLevel ? { scalingLevel: options.scalingLevel } : {}),
      ...(options.since ? { performedOn: { gte: options.since } } : {}),
    },
    include: { member: { select: { id: true, name: true } } },
  });

  // Keep only each member's best effort per scaling level.
  const best = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    const key = `${result.memberId}:${result.scalingLevel}`;
    const current = best.get(key);
    if (!current || compareScores(definition.scoreType, toScore(result), toScore(current)) < 0) {
      best.set(key, result);
    }
  }

  return {
    scoreType: definition.scoreType,
    timeCapSeconds: definition.timeCapSeconds,
    rows: rankRows([...best.values()], definition.scoreType),
  };
}

type ResultWithMember = Result & { member: { id: string; name: string } };

function toScore(result: Result): ScoreValue {
  return {
    timeSeconds: result.timeSeconds,
    rounds: result.rounds,
    reps: result.reps,
    loadKg: result.loadKg,
    cappedOut: result.cappedOut,
    capReps: result.capReps,
  };
}

function rankRows(results: ResultWithMember[], scoreType: ScoreType): LeaderboardRow[] {
  const sorted = results
    .slice()
    .sort((a, b) => compareScores(scoreType, toScore(a), toScore(b)));

  const rows: LeaderboardRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const tied =
      i > 0 && compareScores(scoreType, toScore(sorted[i]), toScore(sorted[i - 1])) === 0;
    rows.push({
      rank: tied ? rows[i - 1].rank : i + 1,
      resultId: sorted[i].id,
      memberId: sorted[i].memberId,
      memberName: sorted[i].member.name,
      scalingLevel: sorted[i].scalingLevel,
      score: toScore(sorted[i]),
      isPr: sorted[i].isPr,
      notes: sorted[i].notes,
    });
  }
  return rows;
}

/** A member's own history, newest first. */
export async function getMemberHistory(
  actor: SessionUser,
  memberId: string,
  limit = 50,
) {
  assertSelfOrStaff(actor, memberId);
  return prisma.result.findMany({
    where: { memberId },
    orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      wodDefinition: true,
      liftResults: { include: { movement: true } },
      classInstance: { select: { id: true, name: true } },
    },
  });
}

/** Personal bests, for the top of a member's history page. */
export async function getMemberPrs(actor: SessionUser, memberId: string) {
  assertSelfOrStaff(actor, memberId);

  const [wodPrs, liftPrs] = await Promise.all([
    prisma.result.findMany({
      where: { memberId, isPr: true, wodDefinition: { isBenchmark: true } },
      orderBy: { performedOn: 'desc' },
      include: { wodDefinition: true },
    }),
    prisma.liftResult.findMany({
      where: { memberId, isPr: true },
      orderBy: [{ movementId: 'asc' }, { reps: 'asc' }, { performedOn: 'desc' }],
      include: { movement: true },
    }),
  ]);

  // Only the standing best per (movement, reps) — the walk flags every effort
  // that was a PR when it happened, which is right for history but noisy here.
  const standing = new Map<string, (typeof liftPrs)[number]>();
  for (const lift of liftPrs) {
    const key = `${lift.movementId}:${lift.reps}`;
    const current = standing.get(key);
    if (!current || lift.loadKg > current.loadKg) standing.set(key, lift);
  }

  const standingWods = new Map<string, (typeof wodPrs)[number]>();
  for (const result of wodPrs) {
    const key = `${result.wodDefinitionId}:${result.scalingLevel}`;
    const current = standingWods.get(key);
    if (
      !current ||
      compareScores(result.wodDefinition.scoreType, toScore(result), toScore(current)) < 0
    ) {
      standingWods.set(key, result);
    }
  }

  return { wodPrs: [...standingWods.values()], liftPrs: [...standing.values()] };
}
