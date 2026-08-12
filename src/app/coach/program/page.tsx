import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { listWodDefinitions } from '@/lib/services/programming';
import { addLocalDays, formatTime, todayLocal } from '@/lib/time';
import { WodProgrammer, type ScheduledWodView } from '@/components/wod-programmer';

export const dynamic = 'force-dynamic';

export default async function ProgramPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  assertCan(user, 'programWod');

  const params = await searchParams;
  const date = params.date ?? todayLocal();

  const [classes, definitions, scheduled] = await Promise.all([
    prisma.classInstance.findMany({
      where: { date, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
      select: { id: true, name: true, startsAt: true },
    }),
    listWodDefinitions(),
    prisma.scheduledWod.findMany({
      where: { date },
      include: {
        wodDefinition: { include: { scalingOptions: true } },
        classes: { select: { classInstanceId: true } },
        _count: { select: { results: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const scheduledViews: ScheduledWodView[] = scheduled.map((item) => ({
    id: item.id,
    name: item.wodDefinition.name ?? 'Workout',
    type: item.wodDefinition.type,
    description: item.wodDefinition.description,
    notes: item.notes,
    classNames:
      item.classes.length === 0
        ? ['All classes']
        : item.classes.map(
            (c) => classes.find((cls) => cls.id === c.classInstanceId)?.name ?? 'Class',
          ),
    resultCount: item._count.results,
    scalingOptions: item.wodDefinition.scalingOptions.map((o) => ({
      level: o.level,
      description: o.description,
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Programming</h2>
        <p className="mt-1 text-white/50">
          Build a WOD, attach scaling options, and put it on a date.
        </p>
      </div>

      <WodProgrammer
        date={date}
        prevDate={addLocalDays(date, -1)}
        nextDate={addLocalDays(date, 1)}
        classes={classes.map((c) => ({
          id: c.id,
          label: `${formatTime(c.startsAt)} ${c.name}`,
        }))}
        library={definitions.map((d) => ({
          id: d.id,
          name: d.name ?? 'Untitled',
          type: d.type,
          isBenchmark: d.isBenchmark,
        }))}
        scheduled={scheduledViews}
      />
    </div>
  );
}
