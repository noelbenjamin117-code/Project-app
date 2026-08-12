import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getClassCard } from '@/lib/services/classes';
import { getWodForClass } from '@/lib/services/programming';
import { getStrikeState } from '@/lib/services/strikes';
import { previewStrike } from '@/lib/domain/strikes';
import { SCALING_LABEL, WOD_TYPE_LABEL } from '@/lib/domain/scoring';
import { formatDateTime, formatDeadline, formatTime } from '@/lib/time';
import { ClassCardRow } from '@/components/class-card-row';

export const dynamic = 'force-dynamic';

/** Where a "you're off the waitlist" notification lands. */
export default async function MemberClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const now = new Date();
  const card = await getClassCard(user.id, id, now);
  const [wod, strikeState] = await Promise.all([
    getWodForClass(id, card.date),
    getStrikeState(user.id, now),
  ]);

  return (
    <div className="space-y-5">
      <Link href="/schedule" className="text-sm text-white/40">
        ← Back to schedule
      </Link>

      <div>
        <h2 className="text-2xl font-bold">{card.name}</h2>
        <p className="text-white/50">
          {formatDateTime(card.startsAt)}
          {card.coachName && ` · ${card.coachName}`}
        </p>
      </div>

      <ClassCardRow
        card={{
          id: card.id,
          name: card.name,
          timeLabel: formatTime(card.startsAt),
          coachName: card.coachName,
          capacity: card.capacity,
          bookedCount: card.bookedCount,
          waitlistCount: card.waitlistCount,
          spotsLeft: card.spotsLeft,
          cancelled: card.status === 'CANCELLED',
          cancelledReason: card.cancelledReason,
          started: card.startsAt <= now,
          myBooking: card.myBooking
            ? {
                id: card.myBooking.id,
                status: card.myBooking.status,
                checkedIn: card.myBooking.checkedInAt != null,
                waitlistPosition: card.myBooking.waitlistPosition,
                deadlineLabel: formatDeadline(card.myBooking.deadline, now),
                deadlinePassed: now > card.myBooking.deadline,
                deadlineReason: card.myBooking.deadlineReason,
              }
            : null,
        }}
        suspended={strikeState.suspended}
        suspendedUntilLabel={
          strikeState.suspendedUntil ? formatDeadline(strikeState.suspendedUntil, now) : null
        }
        lateCancelWarning={previewStrike(strikeState, 'LATE_CANCEL').message}
      />

      {wod && (
        <section className="card p-5">
          <span className="pill bg-brand/15 text-brand">
            {WOD_TYPE_LABEL[wod.wodDefinition.type]}
          </span>
          <h3 className="mt-2 text-lg font-bold">
            {wod.wodDefinition.name ?? 'Workout of the day'}
          </h3>
          <p className="mt-2 whitespace-pre-line text-white/80">
            {wod.wodDefinition.description}
          </p>

          {wod.wodDefinition.scalingOptions.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-edge pt-4 text-sm">
              {wod.wodDefinition.scalingOptions.map((option) => (
                <div key={option.id} className="flex gap-3">
                  <span className="w-16 shrink-0 font-semibold text-brand">
                    {SCALING_LABEL[option.level]}
                  </span>
                  <span className="text-white/70">{option.description}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
