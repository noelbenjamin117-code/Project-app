/**
 * Top up the class booking horizon.
 *
 * The app also calls ensureHorizon() whenever someone opens the schedule, so in
 * practice the horizon stays full on its own. This script exists for the case
 * where nobody has opened the app for a while, and as something to point a
 * scheduled job at:
 *
 *   npm run classes:generate
 */
import { PrismaClient } from '@prisma/client';
import { gymConfig } from '../gym.config';
import { expandTemplates } from '../src/lib/domain/schedule';
import { addLocalDays, todayLocal } from '../src/lib/time';

const prisma = new PrismaClient();

async function main() {
  const from = todayLocal();
  const to = addLocalDays(from, gymConfig.scheduleHorizonDays);

  const templates = await prisma.classTemplate.findMany({ where: { archived: false } });
  const specs = expandTemplates(
    templates.map((t) => ({
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
    })),
    from,
    to,
  );

  // skipDuplicates + the (templateId, date) unique constraint make this safe to
  // run as often as you like; existing classes are never touched, so a coach's
  // per-day edit or cancellation survives.
  const result = await prisma.classInstance.createMany({
    data: specs.map((spec) => ({
      templateId: spec.templateId,
      name: spec.name,
      date: spec.date,
      startsAt: spec.startsAt,
      endsAt: spec.endsAt,
      capacity: spec.capacity,
      coachId: spec.coachId,
      cancelPolicyType: spec.cancelPolicyType,
      cancelAbsoluteTimeLocal: spec.cancelAbsoluteTimeLocal,
      cancelRelativeHours: spec.cancelRelativeHours,
      cancelDeadlineAt: spec.cancelDeadlineAt,
    })),
    skipDuplicates: true,
  });

  console.log(`${from} → ${to}: ${result.count} new classes (${specs.length} in range).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
