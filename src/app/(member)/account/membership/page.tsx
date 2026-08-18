import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { stripeConfigured } from '@/lib/stripe';
import {
  getMembershipState,
  listPlans,
  listPackOffers,
  formatMoney,
} from '@/lib/services/membership';
import { getBalance } from '@/lib/services/passes';
import { getAllowance } from '@/lib/services/entitlement';
import { getPlanRules } from '@/lib/domain/entitlement';
import { prisma } from '@/lib/db';
import { formatDayDate, formatDateTime } from '@/lib/time';
import { MembershipActions, BuyPassesButton } from '@/components/membership-actions';

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
  const [state, membershipRow, balance, allowance] = await Promise.all([
    getMembershipState(user.id),
    prisma.membership.findUnique({ where: { userId: user.id } }),
    getBalance(user.id),
    getAllowance(user.id),
  ]);
  const plans = stripeConfigured() ? await listPlans() : [];
  const packs = stripeConfigured() ? await listPackOffers() : [];
  const rules = getPlanRules(membershipRow?.planKey);
  const plan = rules ? { name: rules.name } : null;

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

          {allowance.remaining !== null && (
            <p className="mt-3 text-sm text-white/60">
              <span className="font-semibold text-white">
                {allowance.remaining} of {allowance.weeklyLimit}
              </span>{' '}
              classes left this week. Your week runs Monday to Sunday.
            </p>
          )}

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

          {!stripeConfigured() || plans.length === 0 ? (
            <p className="mt-4 text-sm text-white/50">
              Memberships aren't available online yet — please speak to the gym.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {plans.map((option) => (
                <div key={option.priceId} className="rounded-lg border border-edge bg-ink p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-lg font-bold">{option.name}</p>
                    <p className="font-semibold text-brand">
                      {formatMoney(option.amount, option.currency) || option.priceLabel}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-white/60">{option.description}</p>
                  <MembershipActions mode="subscribe" priceId={option.priceId} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {(balance.remaining > 0 || packs.length > 0) && (
        <section className="card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold">Class passes</h3>
            <p className="text-2xl font-bold">
              {balance.remaining}
              <span className="ml-1 text-sm font-normal text-white/40">left</span>
            </p>
          </div>

          {balance.remaining > 0 && balance.nextExpiry && (
            <p className="mt-1 text-sm text-white/50">
              {balance.low ? (
                <span className="text-warn">
                  Last one — top up to keep booking.
                </span>
              ) : (
                <>Use them by {formatDayDate(balance.nextExpiry)}</>
              )}
            </p>
          )}

          <p className="mt-2 text-sm text-white/50">
            Passes cover any class except the Sunday session, which is always pay-as-you-go.
          </p>

          {packs.length > 0 && (
            <div className="mt-4 space-y-2">
              {packs.map((pack) => (
                <div
                  key={pack.priceId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink p-3"
                >
                  <div>
                    <p className="font-semibold">{pack.label}</p>
                    <p className="text-xs text-white/40">
                      {pack.passes} classes · lasts {pack.expiryDays} days
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-brand">
                      {formatMoney(pack.amount, pack.currency)}
                    </p>
                    <BuyPassesButton priceId={pack.priceId} />
                  </div>
                </div>
              ))}
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
