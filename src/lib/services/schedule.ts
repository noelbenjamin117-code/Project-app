import 'server-only';
import type { ClassTemplate, Prisma } from '@prisma/client';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { notFound } from '@/lib/errors';
import { addLocalDays, todayLocal, type LocalDate } from '@/lib/time';
import { expandTemplates, type TemplateSpec } from '@/lib/domain/schedule';
import { classCancelDeadline } from '@/lib/domain/cancellation';

type Db = Prisma.TransactionClient | typeof prisma;

function toSpec(t: ClassTemplate): TemplateSpec {
  return {
    id: t.id,
    name: t.name,
    dayOfWeek: t.dayOfWeek,
    startTimeLocal: t.startTimeLocal,
    durationMinutes: t.durationMinutes,
    capacity: t.capacity,
    defaultCoachId: t.defaultCoachId,
    cancelPolicyType: t.cancelPolicyType,
    cancelAbsoluteTimeLocal: t.cancelAbsoluteTimeLocal,
    cancelRelativeHours: t.cancelRelativeHours,
    activeFrom: t.activeFrom,
    activeUntil: t.activeUntil,
    archived: t.archived,
    notes: t.notes,
  };
}

/**
 * Materialise class instances for a local date range.
 *
 * Idempotent: the (templateId, date) unique constraint means running this
 * twice, or on an overlapping range, changes nothing. Existing instances are
 * left exactly as they are so that a coach's per-day edit — a swapped coach, a
 * holiday cancellation — is never overwritten by the generator.
 */
export async function generateClassInstances(
  from: LocalDate,
  to: LocalDate,
  db: Db = prisma,
): Promise<{ created: number; skipped: number }> {
  const templates = await db.classTemplate.findMany({ where: { archived: false } });
  const specs = expandTemplates(templates.map(toSpec), from, to);

  let created = 0;
  let skipped = 0;

  for (const spec of specs) {
    const result = await db.classInstance.createMany({
      data: [
        {
          templateId: spec.templateId,
          name: spec.name,
          notes: spec.notes,
          date: spec.date,
          startsAt: spec.startsAt,
          endsAt: spec.endsAt,
          capacity: spec.capacity,
          coachId: spec.coachId,
          cancelPolicyType: spec.cancelPolicyType,
          cancelAbsoluteTimeLocal: spec.cancelAbsoluteTimeLocal,
          cancelRelativeHours: spec.cancelRelativeHours,
          cancelDeadlineAt: spec.cancelDeadlineAt,
        },
      ],
      skipDuplicates: true,
    });
    if (result.count > 0) created += result.count;
    else skipped += 1;
  }

  return { created, skipped };
}

/**
 * Keep the booking horizon topped up. Safe to call on every schedule page load
 * and from a cron — it only ever adds the days that are missing.
 */
export async function ensureHorizon(now: Date = new Date()): Promise<void> {
  const today = todayLocal(now);
  await generateClassInstances(today, addLocalDays(today, gymConfig.scheduleHorizonDays));
}

export interface TemplateInput {
  name: string;
  dayOfWeek: number;
  startTimeLocal: string;
  durationMinutes: number;
  capacity: number;
  defaultCoachId?: string | null;
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal?: string | null;
  cancelRelativeHours?: number | null;
  notes?: string | null;
  activeFrom?: LocalDate;
}

export async function createTemplate(
  actor: SessionUser,
  input: TemplateInput,
  now: Date = new Date(),
): Promise<ClassTemplate> {
  assertCan(actor, 'manageTemplates');

  const template = await prisma.classTemplate.create({
    data: {
      name: input.name,
      dayOfWeek: input.dayOfWeek,
      startTimeLocal: input.startTimeLocal,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
      defaultCoachId: input.defaultCoachId ?? null,
      cancelPolicyType: input.cancelPolicyType,
      cancelAbsoluteTimeLocal:
        input.cancelPolicyType === 'ABSOLUTE' ? input.cancelAbsoluteTimeLocal ?? null : null,
      cancelRelativeHours:
        input.cancelPolicyType === 'RELATIVE' ? input.cancelRelativeHours ?? null : null,
      notes: input.notes?.trim() || null,
      activeFrom: input.activeFrom ?? todayLocal(now),
    },
  });

  await ensureHorizon(now);
  return template;
}

/**
 * Edit a template.
 *
 * By default the change only affects classes generated from now on: people
 * already booked into next Tuesday's class agreed to the capacity and
 * cancellation rule that were in force when they booked. `applyToFuture` is
 * the explicit opt-in to push the change onto already-generated classes that
 * have not happened yet.
 */
export async function updateTemplate(
  actor: SessionUser,
  templateId: string,
  input: Partial<TemplateInput>,
  options: { applyToFuture?: boolean } = {},
  now: Date = new Date(),
): Promise<ClassTemplate> {
  assertCan(actor, 'manageTemplates');

  const existing = await prisma.classTemplate.findUnique({ where: { id: templateId } });
  if (!existing) throw notFound('That class template no longer exists.');

  const policyType = input.cancelPolicyType ?? existing.cancelPolicyType;

  const template = await prisma.classTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name ?? undefined,
      dayOfWeek: input.dayOfWeek ?? undefined,
      startTimeLocal: input.startTimeLocal ?? undefined,
      durationMinutes: input.durationMinutes ?? undefined,
      capacity: input.capacity ?? undefined,
      defaultCoachId: input.defaultCoachId === undefined ? undefined : input.defaultCoachId,
      cancelPolicyType: input.cancelPolicyType ?? undefined,
      cancelAbsoluteTimeLocal:
        policyType === 'ABSOLUTE'
          ? input.cancelAbsoluteTimeLocal ?? existing.cancelAbsoluteTimeLocal
          : null,
      cancelRelativeHours:
        policyType === 'RELATIVE'
          ? input.cancelRelativeHours ?? existing.cancelRelativeHours
          : null,
      notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
    },
  });

  if (options.applyToFuture) {
    await applyTemplateToFutureInstances(template, now);
  }

  await ensureHorizon(now);
  return template;
}

/**
 * Push a template's current settings onto its future instances, recomputing
 * each deadline against that instance's own local date so DST stays correct.
 */
async function applyTemplateToFutureInstances(
  template: ClassTemplate,
  now: Date,
): Promise<number> {
  const future = await prisma.classInstance.findMany({
    where: { templateId: template.id, startsAt: { gt: now }, status: 'SCHEDULED' },
  });

  for (const instance of future) {
    const deadline = classCancelDeadline(instance.date, instance.startsAt, {
      type: template.cancelPolicyType,
      absoluteTimeLocal: template.cancelAbsoluteTimeLocal,
      relativeHours: template.cancelRelativeHours,
    });

    await prisma.classInstance.update({
      where: { id: instance.id },
      data: {
        capacity: template.capacity,
        cancelPolicyType: template.cancelPolicyType,
        cancelAbsoluteTimeLocal: template.cancelAbsoluteTimeLocal,
        cancelRelativeHours: template.cancelRelativeHours,
        notes: template.notes,
        cancelDeadlineAt: deadline,
      },
    });
  }

  return future.length;
}

/**
 * Retire a template. Already-generated future classes are left alone unless
 * asked for — a coach removing "Saturday 9:30" from the pattern still has to
 * decide what happens to the ones people have already booked.
 */
export async function archiveTemplate(
  actor: SessionUser,
  templateId: string,
  options: { cancelFutureInstances?: boolean; reason?: string } = {},
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'manageTemplates');

  await prisma.classTemplate.update({
    where: { id: templateId },
    data: { archived: true, activeUntil: todayLocal(now) },
  });

  if (options.cancelFutureInstances) {
    const { cancelClassInstance } = await import('@/lib/services/booking');
    const future = await prisma.classInstance.findMany({
      where: { templateId, startsAt: { gt: now }, status: 'SCHEDULED' },
    });
    for (const instance of future) {
      await cancelClassInstance(actor, instance.id, options.reason ?? 'Class removed', now);
    }
  }
}

export async function assignCoach(
  actor: SessionUser,
  classInstanceId: string,
  coachId: string | null,
): Promise<void> {
  assertCan(actor, 'manageTemplates');
  await prisma.classInstance.update({
    where: { id: classInstanceId },
    data: { coachId },
  });
}
