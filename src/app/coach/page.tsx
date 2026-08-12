import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getSchedule } from '@/lib/services/classes';
import { ensureHorizon } from '@/lib/services/schedule';
import { getScheduledWodsForDate } from '@/lib/services/programming';
import { addLocalDays, formatTime, todayLocal } from '@/lib/time';
import { WOD_TYPE_LABEL } from '@/lib/domain/scoring';

export const dynamic = 'force-dynamic';

export default async function CoachTodayPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  await ensureHorizon();

  const now = new Date();
  const today = todayLocal(now);
  const tomorrow = addLocalDays(today, 1);

  const [schedule, todaysWods] = await Promise.all([
    getSchedule(null, { from: today, days: 2 }, now),
    getScheduledWodsForDate(today),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-bold">Today</h2>
        <Link href="/coach/program" className="btn-secondary text-xs">
          Programme a WOD
        </Link>
      </div>

      <section className="card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
          Today's programming
        </h3>
        {todaysWods.length === 0 ? (
          <p className="text-white/50">
            Nothing programmed for today.{' '}
            <Link href="/coach/program" className="text-brand underline">
              Add a WOD
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4">
            {todaysWods.map((item) => (
              <div key={item.id}>
                <p className="font-bold">
                  {item.wodDefinition.name ?? 'WOD'}{' '}
                  <span className="pill ml-1 bg-brand/15 text-brand">
                    {WOD_TYPE_LABEL[item.wodDefinition.type]}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-white/70">
                  {item.wodDefinition.description}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {item.classes.length === 0
                    ? 'All classes today'
                    : item.classes.map((c) => c.classInstance.name).join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {[
        { date: today, label: 'Today' },
        { date: tomorrow, label: 'Tomorrow' },
      ].map(({ date, label }) => (
        <section key={date}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
            {label}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(schedule.get(date) ?? []).map((card) => (
              <Link
                key={card.id}
                href={`/coach/classes/${card.id}`}
                className={`card p-4 transition-colors hover:border-white/30 ${
                  card.status === 'CANCELLED' ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-xl font-bold">{formatTime(card.startsAt)}</p>
                  {card.status === 'CANCELLED' ? (
                    <span className="pill bg-bad/15 text-bad">Cancelled</span>
                  ) : (
                    <span className="text-sm text-white/50">
                      {card.bookedCount}/{card.capacity}
                      {card.waitlistCount > 0 && (
                        <span className="text-warn"> +{card.waitlistCount} waiting</span>
                      )}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-white/50">
                  {card.name}
                  {card.coachName && ` · ${card.coachName}`}
                </p>
              </Link>
            ))}
            {(schedule.get(date) ?? []).length === 0 && (
              <p className="text-white/40">No classes.</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
