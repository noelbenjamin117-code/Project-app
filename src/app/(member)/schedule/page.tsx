import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getSessionUser } from '@/lib/auth';
import { getSchedule, type ClassCard } from '@/lib/services/classes';
import { ensureHorizon } from '@/lib/services/schedule';
import { getStrikeState } from '@/lib/services/strikes';
import { getAllowance } from '@/lib/services/entitlement';
import { GYM_TZ, formatDeadline, formatRelative, formatTime, todayLocal } from '@/lib/time';
import { previewStrike } from '@/lib/domain/strikes';
import { prisma } from '@/lib/db';
import { ClassCardRow, type ClassCardView } from '@/components/class-card-row';
import { NotificationList } from '@/components/notification-list';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Keeps the booking horizon topped up without a separate cron in dev.
  await ensureHorizon();

  const now = new Date();
  const today = todayLocal(now);
  const schedule = await getSchedule(user.id, { from: today, days: 14 }, now);
  const strikeState = await getStrikeState(user.id, now);
  const allowance = await getAllowance(user.id, now);

  const lateCancelPreview = previewStrike(strikeState, 'LATE_CANCEL');

  const days = [...schedule.entries()].filter(([, classes]) => classes.length > 0);

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id, readAt: null },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return (
    <div className="space-y-6">
      <NotificationList
        notifications={notifications.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          href: n.href,
          agoLabel: formatRelative(n.createdAt, now),
        }))}
      />

      <h2 className="text-2xl font-bold">Book a class</h2>

      {/* Said before they run out, not at the moment they're refused. */}
      {(allowance.remaining !== null || allowance.passes > 0) && (
        <p className="rounded-lg bg-white/5 px-4 py-3 text-sm text-white/60">
          {allowance.remaining !== null && (
            <span className={allowance.remaining === 0 ? 'text-warn' : undefined}>
              {allowance.remaining === 0
                ? `You've used all ${allowance.weeklyLimit} of this week's classes on ${allowance.planName}. Your week starts again on Monday.`
                : `${allowance.remaining} of ${allowance.weeklyLimit} classes left this week on ${allowance.planName}.`}
            </span>
          )}
          {allowance.passes > 0 && (
            <span className={allowance.remaining !== null ? 'ml-1' : undefined}>
              {allowance.passes} class {allowance.passes === 1 ? 'pass' : 'passes'} in hand.
            </span>
          )}
        </p>
      )}

      {days.length === 0 && (
        <p className="card p-6 text-center text-white/50">
          No classes scheduled in the next two weeks.
        </p>
      )}

      {days.map(([date, classes]) => (
        <section key={date}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
            {dayHeading(date, today)}
          </h3>
          <div className="space-y-2">
            {classes.map((card) => (
              <ClassCardRow
                key={card.id}
                card={toView(card, now)}
                suspended={strikeState.suspended}
                suspendedUntilLabel={
                  strikeState.suspendedUntil
                    ? formatDeadline(strikeState.suspendedUntil, now)
                    : null
                }
                lateCancelWarning={lateCancelPreview.message}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function dayHeading(date: string, today: string): string {
  const dt = DateTime.fromISO(date, { zone: GYM_TZ });
  if (date === today) return `Today · ${dt.toFormat('ccc d LLL')}`;
  return dt.toFormat('cccc d LLL');
}

/**
 * Dates are formatted on the server, in gym time, and handed to the client as
 * strings. The client never sees a Date — which means no hydration mismatch
 * and no chance of a member's phone timezone renaming the 6am class.
 */
function toView(card: ClassCard, now: Date): ClassCardView {
  return {
    id: card.id,
    name: card.name,
    notes: card.notes,
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
  };
}
