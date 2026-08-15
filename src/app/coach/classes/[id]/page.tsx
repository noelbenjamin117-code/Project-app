import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { getRoster } from '@/lib/services/classes';
import { getWodForClass } from '@/lib/services/programming';
import { formatDateTime, formatDeadline, formatTime } from '@/lib/time';
import { RosterTable, type RosterRowView } from '@/components/roster-table';
import { ClassAdminPanel } from '@/components/class-admin-panel';

export const dynamic = 'force-dynamic';

export default async function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const now = new Date();
  const roster = await getRoster(user, id, now);
  const wod = await getWodForClass(id, roster.classInstance.date);

  const members = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const alreadyIn = new Set([
    ...roster.booked.map((e) => e.memberId),
    ...roster.waitlisted.map((e) => e.memberId),
  ]);

  const toView = (entry: (typeof roster.booked)[number]): RosterRowView => ({
    bookingId: entry.bookingId,
    memberId: entry.memberId,
    memberName: entry.memberName,
    status: entry.status,
    source: entry.source,
    checkedIn: entry.checkedInAt != null,
    noShow: entry.noShow,
    lateCancel: entry.lateCancel,
    cancelledLabel: entry.cancelledAt ? formatDateTime(entry.cancelledAt) : null,
    waitlistPosition: entry.waitlistPosition,
    promotedLabel: entry.promotedAt ? formatDeadline(entry.promotedAt, now) : null,
    riskLevel: entry.riskLevel,
    strikeSummary: `${entry.strikes.currentWeight}/${entry.strikes.threshold}`,
    membershipLapsed: entry.membershipLapsed,
  });

  const started = roster.classInstance.startsAt <= now;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coach" className="text-sm text-white/40 hover:text-white">
          ← Back to today
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">
              {formatTime(roster.classInstance.startsAt)} · {roster.classInstance.name}
            </h2>
            <p className="text-white/50">
              {formatDateTime(roster.classInstance.startsAt)}
              {roster.classInstance.coachName && ` · ${roster.classInstance.coachName}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">
              {roster.booked.length}
              <span className="text-base font-normal text-white/40">
                /{roster.classInstance.capacity}
              </span>
            </p>
            <p className="text-sm text-white/50">{roster.attendanceCount} checked in</p>
          </div>
        </div>
      </div>

      {roster.classInstance.status === 'CANCELLED' && (
        <div className="card border-bad/40 bg-bad/5 p-4">
          <p className="font-semibold text-bad">This class is cancelled</p>
          <p className="mt-1 text-sm text-white/70">
            {roster.classInstance.cancelledReason ?? 'No reason given'} — every booking was released
            and nobody received a strike.
          </p>
        </div>
      )}

      {wod && (
        <section className="card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">
            Today's WOD
          </h3>
          <p className="mt-2 font-bold">{wod.wodDefinition.name ?? 'Workout'}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-white/70">
            {wod.wodDefinition.description}
          </p>
        </section>
      )}

      <RosterTable
        classInstanceId={id}
        booked={roster.booked.map(toView)}
        waitlisted={roster.waitlisted.map(toView)}
        cancelled={roster.cancelled.map(toView)}
        classStarted={started}
        classCancelled={roster.classInstance.status === 'CANCELLED'}
        canForgive={can(user, 'forgiveStrike')}
      />

      <ClassAdminPanel
        classInstanceId={id}
        cancelled={roster.classInstance.status === 'CANCELLED'}
        addableMembers={members.filter((m) => !alreadyIn.has(m.id))}
      />
    </div>
  );
}
