import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { WEEKDAY_LABEL } from '@/lib/domain/schedule';
import { describePolicy } from '@/lib/domain/cancellation';
import { TemplateEditor, type TemplateView } from '@/components/template-editor';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  assertCan(user, 'manageTemplates');

  const [templates, coaches] = await Promise.all([
    prisma.classTemplate.findMany({
      where: { archived: false },
      orderBy: [{ dayOfWeek: 'asc' }, { startTimeLocal: 'asc' }],
    }),
    prisma.user.findMany({
      where: { role: { in: ['COACH', 'OWNER'] }, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const views: TemplateView[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    dayOfWeek: t.dayOfWeek,
    dayLabel: WEEKDAY_LABEL[t.dayOfWeek],
    startTimeLocal: t.startTimeLocal,
    durationMinutes: t.durationMinutes,
    capacity: t.capacity,
    defaultCoachId: t.defaultCoachId,
    cancelPolicyType: t.cancelPolicyType,
    cancelAbsoluteTimeLocal: t.cancelAbsoluteTimeLocal,
    cancelRelativeHours: t.cancelRelativeHours,
    notes: t.notes,
    payg: t.payg,
    policyLabel: describePolicy({
      type: t.cancelPolicyType,
      absoluteTimeLocal: t.cancelAbsoluteTimeLocal,
      relativeHours: t.cancelRelativeHours,
    }),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Weekly schedule</h2>
        <p className="mt-1 text-white/50">
          These templates generate the classes members book. Each one carries its own
          cancellation rule.
        </p>
      </div>

      <TemplateEditor templates={views} coaches={coaches} />
    </div>
  );
}
