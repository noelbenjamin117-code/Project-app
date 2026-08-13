import 'server-only';
import type { ScalingLevel, ScoreType, WodDefinition, WodType } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { AppError, notFound } from '@/lib/errors';
import type { LocalDate } from '@/lib/time';
import { DEFAULT_SCORE_TYPE } from '@/lib/domain/scoring';

export interface ScalingOptionInput {
  level: ScalingLevel;
  description: string;
}

export interface WodDefinitionInput {
  name?: string | null;
  isBenchmark?: boolean;
  type: WodType;
  scoreType?: ScoreType;
  timeCapSeconds?: number | null;
  description: string;
  scalingOptions?: ScalingOptionInput[];
}

export async function createWodDefinition(
  actor: SessionUser,
  input: WodDefinitionInput,
): Promise<WodDefinition> {
  assertCan(actor, 'programWod');

  if (!input.description.trim()) {
    throw new AppError('A workout needs a description.', 422, 'INVALID_WOD');
  }

  // Each WOD type has an obvious score shape; the coach can override it for
  // the odd workout that is scored differently.
  const scoreType = input.scoreType ?? DEFAULT_SCORE_TYPE[input.type];

  return prisma.wodDefinition.create({
    data: {
      name: input.name?.trim() || null,
      isBenchmark: input.isBenchmark ?? false,
      type: input.type,
      scoreType,
      timeCapSeconds: input.timeCapSeconds ?? null,
      description: input.description.trim(),
      createdById: actor.id,
      scalingOptions: {
        create: (input.scalingOptions ?? []).map((o) => ({
          level: o.level,
          description: o.description.trim(),
        })),
      },
    },
  });
}

export async function updateWodDefinition(
  actor: SessionUser,
  wodDefinitionId: string,
  input: Partial<WodDefinitionInput>,
): Promise<WodDefinition> {
  assertCan(actor, 'programWod');

  const existing = await prisma.wodDefinition.findUnique({ where: { id: wodDefinitionId } });
  if (!existing) throw notFound('That workout no longer exists.');

  return prisma.$transaction(async (tx) => {
    if (input.scalingOptions) {
      await tx.wodScalingOption.deleteMany({ where: { wodDefinitionId } });
      for (const option of input.scalingOptions) {
        await tx.wodScalingOption.create({
          data: {
            wodDefinitionId,
            level: option.level,
            description: option.description.trim(),
          },
        });
      }
    }

    return tx.wodDefinition.update({
      where: { id: wodDefinitionId },
      data: {
        name: input.name === undefined ? undefined : input.name?.trim() || null,
        isBenchmark: input.isBenchmark ?? undefined,
        type: input.type ?? undefined,
        scoreType: input.scoreType ?? undefined,
        timeCapSeconds: input.timeCapSeconds === undefined ? undefined : input.timeCapSeconds,
        description: input.description?.trim() ?? undefined,
      },
    });
  });
}

/**
 * Put a WOD on the calendar.
 *
 * `classInstanceIds` empty means "every class that day", which is the normal
 * case. Naming specific classes covers the days when the 6am crew does
 * something different from the evening crew.
 */
export async function scheduleWod(
  actor: SessionUser,
  input: {
    wodDefinitionId: string;
    date: LocalDate;
    notes?: string | null;
    classInstanceIds?: string[];
  },
) {
  assertCan(actor, 'programWod');

  const definition = await prisma.wodDefinition.findUnique({
    where: { id: input.wodDefinitionId },
  });
  if (!definition) throw notFound('That workout no longer exists.');

  return prisma.$transaction(async (tx) => {
    const scheduled = await tx.scheduledWod.create({
      data: {
        wodDefinitionId: input.wodDefinitionId,
        date: input.date,
        notes: input.notes?.trim() || null,
      },
    });

    for (const classInstanceId of input.classInstanceIds ?? []) {
      await tx.scheduledWodClass.create({
        data: { scheduledWodId: scheduled.id, classInstanceId },
      });
    }

    return scheduled;
  });
}

export async function updateScheduledWod(
  actor: SessionUser,
  scheduledWodId: string,
  input: { date?: LocalDate; notes?: string | null; classInstanceIds?: string[] },
) {
  assertCan(actor, 'programWod');

  return prisma.$transaction(async (tx) => {
    if (input.classInstanceIds) {
      await tx.scheduledWodClass.deleteMany({ where: { scheduledWodId } });
      for (const classInstanceId of input.classInstanceIds) {
        await tx.scheduledWodClass.create({
          data: { scheduledWodId, classInstanceId },
        });
      }
    }

    return tx.scheduledWod.update({
      where: { id: scheduledWodId },
      data: {
        date: input.date ?? undefined,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
      },
    });
  });
}

export async function unscheduleWod(actor: SessionUser, scheduledWodId: string): Promise<void> {
  assertCan(actor, 'programWod');
  await prisma.scheduledWod.delete({ where: { id: scheduledWodId } });
}

/** Everything programmed for a local date, with scaling options attached. */
export async function getScheduledWodsForDate(date: LocalDate) {
  return prisma.scheduledWod.findMany({
    where: { date },
    include: {
      wodDefinition: { include: { scalingOptions: true } },
      classes: { include: { classInstance: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The WOD that applies to one class: either scheduled specifically for it, or
 * scheduled for the whole day.
 */
export async function getWodForClass(classInstanceId: string, date: LocalDate) {
  const scheduled = await getScheduledWodsForDate(date);
  return (
    scheduled.find((s) => s.classes.some((c) => c.classInstanceId === classInstanceId)) ??
    scheduled.find((s) => s.classes.length === 0) ??
    null
  );
}

export async function listWodDefinitions(options: { benchmarksOnly?: boolean } = {}) {
  return prisma.wodDefinition.findMany({
    where: options.benchmarksOnly ? { isBenchmark: true } : undefined,
    orderBy: [{ isBenchmark: 'desc' }, { name: 'asc' }, { createdAt: 'desc' }],
    include: { scalingOptions: true },
  });
}

export async function listMovements() {
  return prisma.movement.findMany({ orderBy: { name: 'asc' } });
}
