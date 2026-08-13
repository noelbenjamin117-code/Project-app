import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteResult,
  getBenchmarkLeaderboard,
  getLeaderboard,
  getMemberPrs,
  logResult,
} from '@/lib/services/results';
import { createWodDefinition, scheduleWod } from '@/lib/services/programming';
import type { SessionUser } from '@/lib/auth';
import { createUser, prisma, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

async function fran(coach: SessionUser) {
  return createWodDefinition(coach, {
    name: 'Fran',
    isBenchmark: true,
    type: 'FOR_TIME',
    timeCapSeconds: 600,
    description: '21-15-9 thruster / pull-up',
    scalingOptions: [
      { level: 'RX', description: 'As prescribed' },
      { level: 'SCALED', description: 'Banded pull-ups' },
    ],
  });
}

describe('logging scores', () => {
  it('validates the score against the WOD score type', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await expect(
      logResult(member, { wodDefinitionId: wod.id, scalingLevel: 'RX' }),
    ).rejects.toThrow(/finishing time/i);

    await expect(
      logResult(member, { wodDefinitionId: wod.id, scalingLevel: 'RX', timeSeconds: 201 }),
    ).resolves.toBeTruthy();
  });

  it('requires reps at the cap for a capped result, and clears the time', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await expect(
      logResult(member, { wodDefinitionId: wod.id, scalingLevel: 'RX', cappedOut: true }),
    ).rejects.toThrow(/reps completed/i);

    const saved = await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      cappedOut: true,
      capReps: 12,
      timeSeconds: 999,
    });

    expect(saved.cappedOut).toBe(true);
    expect(saved.capReps).toBe(12);
    expect(saved.timeSeconds).toBeNull();
  });

  it('keeps one score per member per programmed WOD, updating on re-submit', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);
    const scheduled = await scheduleWod(coach, {
      wodDefinitionId: wod.id,
      date: '2026-06-15',
    });

    await logResult(member, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      timeSeconds: 240,
    });
    await logResult(member, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      timeSeconds: 201,
    });

    const results = await prisma.result.findMany({ where: { memberId: member.id } });
    expect(results).toHaveLength(1);
    expect(results[0].timeSeconds).toBe(201);
  });

  it('lets a member log a benchmark they did outside class', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    const first = await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 240,
      performedOn: '2026-05-01',
    });
    const second = await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 220,
      performedOn: '2026-06-01',
    });

    // Ad-hoc logs are not tied to a scheduled WOD, so they can repeat.
    expect(first.id).not.toBe(second.id);
    expect(second.classInstanceId).toBeNull();
  });
});

describe('PR detection', () => {
  it('flags each result that beat everything before it', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 300,
      performedOn: '2026-01-01',
    });
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 330,
      performedOn: '2026-02-01',
    });
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 250,
      performedOn: '2026-03-01',
    });

    const results = await prisma.result.findMany({
      where: { memberId: member.id },
      orderBy: { performedOn: 'asc' },
    });

    // First effort is a PR by definition, the slower one is not, the faster is.
    expect(results.map((r) => r.isPr)).toEqual([true, false, true]);
  });

  it('keeps scaling levels on separate ladders', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 250,
      performedOn: '2026-01-01',
    });
    // Slower, but Scaled — a first Scaled effort is its own PR.
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'SCALED',
      timeSeconds: 400,
      performedOn: '2026-02-01',
    });

    const results = await prisma.result.findMany({
      where: { memberId: member.id },
      orderBy: { performedOn: 'asc' },
    });
    expect(results.map((r) => r.isPr)).toEqual([true, true]);
  });

  it('recomputes when a backdated result changes the order of history', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 250,
      performedOn: '2026-03-01',
    });
    // Logged later, but performed earlier and faster — it dethrones the other.
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 200,
      performedOn: '2026-01-01',
    });

    const results = await prisma.result.findMany({
      where: { memberId: member.id },
      orderBy: { performedOn: 'asc' },
    });
    expect(results.map((r) => ({ on: r.performedOn, pr: r.isPr }))).toEqual([
      { on: '2026-01-01', pr: true },
      { on: '2026-03-01', pr: false },
    ]);
  });

  it('restores an earlier PR when the better result is deleted', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const wod = await fran(coach);

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 300,
      performedOn: '2026-01-01',
    });
    const better = await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 200,
      performedOn: '2026-02-01',
    });

    await deleteResult(member, better.id);

    const remaining = await prisma.result.findMany({ where: { memberId: member.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].isPr).toBe(true);
  });

  it('tracks lift PRs per rep scheme', async () => {
    const coach = await createUser('COACH');
    const member = await createUser();
    const squat = await prisma.movement.create({
      data: { name: 'Back Squat', isBarbellLift: true },
    });
    const strength = await createWodDefinition(coach, {
      type: 'STRENGTH',
      description: 'Back Squat, heavy triple',
    });

    await logResult(member, {
      wodDefinitionId: strength.id,
      scalingLevel: 'RX',
      loadKg: 140,
      performedOn: '2026-01-01',
      lifts: [{ movementId: squat.id, reps: 1, loadKg: 140 }],
    });
    await logResult(member, {
      wodDefinitionId: strength.id,
      scalingLevel: 'RX',
      loadKg: 120,
      performedOn: '2026-02-01',
      lifts: [{ movementId: squat.id, reps: 3, loadKg: 120 }],
    });

    const prs = await getMemberPrs(member, member.id);
    const byReps = Object.fromEntries(prs.liftPrs.map((l) => [l.reps, l.loadKg]));

    // A 3RM and a 1RM stand as separate records.
    expect(byReps).toEqual({ 1: 140, 3: 120 });
  });
});

describe('leaderboards', () => {
  it('ranks a class board with capped athletes behind finishers', async () => {
    const coach = await createUser('COACH');
    const wod = await fran(coach);
    const scheduled = await scheduleWod(coach, {
      wodDefinitionId: wod.id,
      date: '2026-06-15',
    });

    const [fast, slow, capped] = await Promise.all([
      createUser('MEMBER', 'Fast Member'),
      createUser('MEMBER', 'Slow Member'),
      createUser('MEMBER', 'Capped Member'),
    ]);

    await logResult(fast, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      timeSeconds: 201,
    });
    await logResult(slow, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      timeSeconds: 480,
    });
    await logResult(capped, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      cappedOut: true,
      capReps: 30,
    });

    const board = await getLeaderboard(scheduled.id);
    expect(board.rows.map((r) => r.memberName)).toEqual([
      'Fast Member',
      'Slow Member',
      'Capped Member',
    ]);
  });

  it('filters a board to one scaling level', async () => {
    const coach = await createUser('COACH');
    const wod = await fran(coach);
    const scheduled = await scheduleWod(coach, {
      wodDefinitionId: wod.id,
      date: '2026-06-15',
    });

    const [rx, scaled] = await Promise.all([
      createUser('MEMBER', 'Rx Member'),
      createUser('MEMBER', 'Scaled Member'),
    ]);
    await logResult(rx, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'RX',
      timeSeconds: 300,
    });
    await logResult(scaled, {
      wodDefinitionId: wod.id,
      scheduledWodId: scheduled.id,
      scalingLevel: 'SCALED',
      timeSeconds: 240,
    });

    const rxOnly = await getLeaderboard(scheduled.id, { scalingLevel: 'RX' });
    expect(rxOnly.rows.map((r) => r.memberName)).toEqual(['Rx Member']);
  });

  it('shows only each members best effort on the all-time benchmark board', async () => {
    const coach = await createUser('COACH');
    const wod = await fran(coach);
    const member = await createUser('MEMBER', 'Repeat Member');

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 300,
      performedOn: '2026-01-01',
    });
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 220,
      performedOn: '2026-05-01',
    });

    const board = await getBenchmarkLeaderboard(wod.id);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].score.timeSeconds).toBe(220);
  });

  it('can restrict the benchmark board to efforts since a date', async () => {
    const coach = await createUser('COACH');
    const wod = await fran(coach);
    const member = await createUser('MEMBER', 'Repeat Member');

    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 200,
      performedOn: '2026-01-01',
    });
    await logResult(member, {
      wodDefinitionId: wod.id,
      scalingLevel: 'RX',
      timeSeconds: 260,
      performedOn: '2026-06-01',
    });

    const recent = await getBenchmarkLeaderboard(wod.id, { since: '2026-03-01' });
    expect(recent.rows[0].score.timeSeconds).toBe(260);
  });
});
