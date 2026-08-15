import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { stripeConfigured } from '@/lib/stripe';
import { getMembershipState, getPlan } from '@/lib/services/membership';
import { formatDayDate, formatDateTime } from '@/lib/time';
import { MembershipActions } from '@/components/membership-actions';

export const dynamic = 'force-dynamic';

/**
 * Never a dead end: a member without a membership lands on the plan and a
 * button, not an error.
 */
export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { checkout } = await searchParams;
  const state = await getMembershipState(user.id);
  const plan = getPlan();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/account/strikes" className="text-sm text-white/40">
          ← Account
        </Link>
        <h2 className="mt-2 text-2xl font-bold">Membership</h2>
      </div>

      {checkout === 'done' && (
        <p className="rounded-lg bg-ok/10 px-4 py-3 text-sm text-ok">
          Thanks — you're all set. It can take a few seconds to show below.
        </p>
      )}
      {checkout === 'cancelled' && (
        <p className="rounded-lg bg-white/5 px-4 py-3 text-sm text-white/60">
          No payment was taken.
        </p>
      )}

      {state.source === 'OVERRIDE' && state.overrideUntil ? (
        <section className="card border-ok/40 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xl font-bold">Membership active</p>
            <span className="pill bg-ok/15 text-ok">Active</span>
          </div>
          <p className="mt-2 text-sm text-white/60">
            Set up by the gym, running until{' '}
            <span className="font-semibold text-white">
              {formatDayDate(state.overrideUntil)}
            </span>
            .
          </p>
        </section>
      ) : state.state === 'ACTIVE' ? (
        <section className="card border-ok/40 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-sm text-white/50">Your plan</p>
              <p className="text-xl font-bold">{plan?.name ?? 'Membership'}</p>
            </div>
            <span className="pill bg-ok/15 text-ok">Active</span>
          </div>

          {state.currentPeriodEnd && (
            <p className="mt-3 text-sm text-white/60">
              Renews on{' '}
              <span className="font-semibold text-white">
                {formatDayDate(state.currentPeriodEnd)}
              </span>
            </p>
          )}

          <MembershipActions mode="manage" />
        </section>
      ) : state.state === 'GRACE' ? (
        <section className="card border-warn/40 bg-warn/5 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xl font-bold text-warn">Payment failed</p>
            <span className="pill bg-warn/15 text-warn">Action needed</span>
          </div>
          <p className="mt-2 text-white/80">
            Your last payment didn't go through. Update your card by{' '}
            <span className="font-semibold text-white">
              {formatDateTime(state.graceEndsAt!)}
            </span>{' '}
            to keep booking classes.
          </p>
          <p className="mt-2 text-sm text-white/50">
            Classes you've already booked are unaffected.
          </p>

          <MembershipActions mode="manage" />
        </section>
      ) : (
        <section className="card p-5">
          <p className="text-white/70">
            {state.status === 'CANCELED'
              ? 'Your membership has ended. Start it again to book classes.'
              : state.status === 'PAST_DUE'
                ? "Your payment didn't go through, so booking is paused. Update your card and it'll come straight back."
                : 'You need a membership to book classes.'}
          </p>

          {!stripeConfigured() || !plan ? (
            <p className="mt-4 text-sm text-white/50">
              Memberships aren't available online yet — please speak to the gym.
            </p>
          ) : (
            <div className="mt-5 rounded-lg border border-edge bg-ink p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-lg font-bold">{plan.name}</p>
                <p className="font-semibold text-brand">{plan.priceLabel}</p>
              </div>
              <p className="mt-1 text-sm text-white/60">{plan.description}</p>

              <MembershipActions
                mode={state.status === 'PAST_DUE' ? 'manage' : 'subscribe'}
              />
            </div>
          )}
        </section>
      )}

      <p className="text-center text-xs text-white/30">
        Payments are handled by Stripe. We never see your card details.
      </p>
    </div>
  );
}
