import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { stripeConfigured } from '@/lib/stripe';
import {
  MEMBERSHIP_LABEL,
  formatPrice,
  getMembership,
  isPaidUp,
  listPlans,
} from '@/lib/services/membership';
import { formatDayDate } from '@/lib/time';
import { MembershipActions } from '@/components/membership-actions';

export const dynamic = 'force-dynamic';

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { checkout } = await searchParams;
  const membership = await getMembership(user);
  const plans = stripeConfigured() ? await listPlans() : [];

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
          Thanks — your membership is set up. It can take a few seconds to show below.
        </p>
      )}
      {checkout === 'cancelled' && (
        <p className="rounded-lg bg-white/5 px-4 py-3 text-sm text-white/60">
          No payment was taken.
        </p>
      )}

      {!stripeConfigured() ? (
        <p className="card p-6 text-center text-white/50">
          Memberships aren't set up yet. Speak to the gym.
        </p>
      ) : isPaidUp(membership) ? (
        <section className="card border-ok/40 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-sm text-white/50">Your plan</p>
              <p className="text-xl font-bold">{membership?.planName ?? 'Membership'}</p>
            </div>
            <span
              className={`pill ${
                membership?.status === 'PAST_DUE' ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'
              }`}
            >
              {MEMBERSHIP_LABEL[membership!.status]}
            </span>
          </div>

          {membership?.status === 'PAST_DUE' && (
            <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
              Your last payment didn't go through. Update your card below and it'll retry — your
              bookings aren't affected.
            </p>
          )}

          {membership?.currentPeriodEnd && (
            <p className="mt-3 text-sm text-white/60">
              {membership.cancelAtPeriodEnd ? (
                <>
                  Ends on{' '}
                  <span className="font-semibold text-white">
                    {formatDayDate(membership.currentPeriodEnd)}
                  </span>
                </>
              ) : (
                <>
                  Renews on{' '}
                  <span className="font-semibold text-white">
                    {formatDayDate(membership.currentPeriodEnd)}
                  </span>
                </>
              )}
            </p>
          )}

          <MembershipActions hasMembership />
        </section>
      ) : (
        <>
          <p className="text-white/60">
            {membership?.status === 'CANCELED'
              ? 'Your membership has ended. Pick a plan to start again.'
              : 'Choose a membership to get started.'}
          </p>

          {plans.length === 0 ? (
            <p className="card p-6 text-center text-white/50">
              No plans are available yet. Speak to the gym.
            </p>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <div key={plan.priceId} className="card p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-lg font-bold">{plan.productName}</p>
                    <p className="font-semibold text-brand">{formatPrice(plan)}</p>
                  </div>
                  {plan.description && (
                    <p className="mt-1 text-sm text-white/60">{plan.description}</p>
                  )}
                  <MembershipActions priceId={plan.priceId} />
                </div>
              ))}
            </div>
          )}

          {membership?.stripeCustomerId && (
            <MembershipActions hasMembership portalOnly />
          )}
        </>
      )}

      <p className="text-center text-xs text-white/30">
        Payments are handled by Stripe. We never see your card details.
      </p>
    </div>
  );
}
