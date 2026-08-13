import { redirect } from 'next/navigation';
import { gymConfig } from '~/gym.config';
import { getSessionUser } from '@/lib/auth';
import { getStrikeState } from '@/lib/services/strikes';
import { formatDateTime, formatDayDate } from '@/lib/time';
import { ChangePasswordForm } from '@/components/change-password-form';

export const dynamic = 'force-dynamic';

const STRIKE_LABEL = {
  LATE_CANCEL: 'Late cancel',
  NO_SHOW: 'No-show',
} as const;

export default async function StrikesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const state = await getStrikeState(user.id);
  const { threshold, windowDays, suspensionDays } = gymConfig.strikes;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Your account</h2>

      {state.suspended && state.suspendedUntil ? (
        <section className="card border-bad/40 bg-bad/5 p-5">
          <h3 className="text-lg font-bold text-bad">Bookings paused</h3>
          <p className="mt-2 text-white/80">
            You reached {threshold} strikes in a {windowDays}-day period, so new bookings are
            paused for {suspensionDays} days. You can still attend any class you already booked.
          </p>
          <p className="mt-3 rounded-lg bg-ink px-3 py-2 text-sm">
            <span className="text-white/50">Booking opens again</span>{' '}
            <span className="font-semibold">{formatDateTime(state.suspendedUntil)}</span>
          </p>
        </section>
      ) : (
        <section className="card p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-bold">Strikes</h3>
            <p className="text-2xl font-bold">
              {state.currentWeight}
              <span className="text-base font-normal text-white/40"> / {threshold}</span>
            </p>
          </div>
          <p className="mt-2 text-sm text-white/60">
            Counted over a rolling {windowDays} days. A late cancel is{' '}
            {gymConfig.strikes.lateCancelWeight}, a no-show is {gymConfig.strikes.noShowWeight}.
            Reaching {threshold} pauses new bookings for {suspensionDays} days.
          </p>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${
                state.weightToSuspension <= 1 ? 'bg-warn' : 'bg-ok'
              }`}
              style={{ width: `${Math.min(100, (state.currentWeight / threshold) * 100)}%` }}
            />
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
          History
        </h3>

        {state.events.length === 0 ? (
          <p className="card p-5 text-center text-white/50">
            No late cancels or no-shows. Nice.
          </p>
        ) : (
          <ul className="space-y-2">
            {state.events.map((event) => (
              <li key={event.id} className="card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{STRIKE_LABEL[event.type]}</p>
                    <p className="text-sm text-white/50">{formatDateTime(event.occurredAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {event.forgivenAt ? (
                      <span className="pill bg-ok/15 text-ok">Forgiven</span>
                    ) : event.consumed ? (
                      <span className="pill bg-white/10 text-white/50">
                        {state.suspended ? 'Counted' : 'Served'}
                      </span>
                    ) : event.counting ? (
                      <span className="pill bg-warn/15 text-warn">
                        Counts {event.weight}
                      </span>
                    ) : (
                      <span className="pill bg-white/10 text-white/50">Expired</span>
                    )}
                  </div>
                </div>

                <p className="mt-1.5 text-xs text-white/40">
                  {event.forgivenAt
                    ? `Forgiven by a coach on ${formatDayDate(event.forgivenAt)}`
                    : event.consumed
                      ? state.suspended
                        ? 'Counted toward your current pause'
                        : 'Already counted toward a completed pause'
                      : event.counting
                        ? `Drops off ${formatDayDate(event.expiresAt)}`
                        : `Dropped off ${formatDayDate(event.expiresAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChangePasswordForm />

      <section className="card p-5 text-sm text-white/60">
        <h3 className="mb-2 font-semibold text-white">How cancelling works</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>Every class shows the exact time you can cancel free until.</li>
          <li>Cancelling late still frees your spot for the next person on the waitlist.</li>
          <li>If the gym cancels a class, nobody gets a strike.</li>
          <li>If you never come off the waitlist, that's not a strike either.</li>
          <li>
            Just booked by mistake? Cancelling within {gymConfig.grace.freshBookingMinutes} minutes
            never counts.
          </li>
        </ul>
      </section>
    </div>
  );
}
