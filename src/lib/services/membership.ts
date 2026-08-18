import 'server-only';
import type Stripe from 'stripe';
import type { Membership, MembershipStatus, Prisma } from '@prisma/client';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import { getStripe, stripeConfigured, appUrl } from '@/lib/stripe';
import type { SessionUser } from '@/lib/auth';
import { assertCan, assertSelfOrStaff } from '@/lib/permissions';
import { AppError, notFound } from '@/lib/errors';
import {
  computeMembershipState,
  type MembershipState,
  type OverrideInput,
} from '@/lib/domain/membership';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Stripe's subscription statuses, mapped onto ours. `past_due` stays its own
 * thing rather than collapsing into cancelled, because the grace period keys
 * off it.
 */
const STATUS_MAP: Record<string, MembershipStatus> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  canceled: 'CANCELED',
  paused: 'PAUSED',
};

export function toMembershipStatus(stripeStatus: string): MembershipStatus {
  return STATUS_MAP[stripeStatus] ?? 'NONE';
}

export const MEMBERSHIP_LABEL: Record<MembershipStatus, string> = {
  NONE: 'No membership',
  ACTIVE: 'Active',
  TRIALING: 'Trial',
  PAST_DUE: 'Payment failed',
  INCOMPLETE: 'Not finished',
  CANCELED: 'Cancelled',
  PAUSED: 'Paused',
};

// ---------------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------------

async function overridesFor(memberId: string, db: Db = prisma): Promise<OverrideInput[]> {
  const rows = await db.membershipOverride.findMany({ where: { memberId } });
  return rows.map((o) => ({
    id: o.id,
    activeUntil: o.activeUntil,
    reason: o.reason,
    revokedAt: o.revokedAt,
  }));
}

/** The computed state for one member. This is what the booking path asks. */
export async function getMembershipState(
  memberId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<MembershipState> {
  const [membership, overrides] = await Promise.all([
    db.membership.findUnique({ where: { userId: memberId } }),
    overridesFor(memberId, db),
  ]);

  return computeMembershipState(membership, overrides, now);
}

/** Bulk version, so a roster of thirty is two queries rather than sixty. */
export async function getMembershipStates(
  memberIds: string[],
  now: Date = new Date(),
): Promise<Map<string, MembershipState>> {
  if (memberIds.length === 0) return new Map();

  const [memberships, overrides] = await Promise.all([
    prisma.membership.findMany({ where: { userId: { in: memberIds } } }),
    prisma.membershipOverride.findMany({ where: { memberId: { in: memberIds } } }),
  ]);

  const byMember = new Map<string, MembershipState>();
  for (const memberId of memberIds) {
    byMember.set(
      memberId,
      computeMembershipState(
        memberships.find((m) => m.userId === memberId) ?? null,
        overrides
          .filter((o) => o.memberId === memberId)
          .map((o) => ({
            id: o.id,
            activeUntil: o.activeUntil,
            reason: o.reason,
            revokedAt: o.revokedAt,
          })),
        now,
      ),
    );
  }
  return byMember;
}

export async function getMembership(
  actor: SessionUser,
  userId: string = actor.id,
): Promise<Membership | null> {
  assertSelfOrStaff(actor, userId);
  return prisma.membership.findUnique({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Keeping the mirror current
// ---------------------------------------------------------------------------

/**
 * Write a Stripe subscription into the local mirror.
 *
 * `eventAt` is when Stripe created the event. Anything at or before what we
 * have already applied is dropped, because Stripe delivers out of order and a
 * late stale event must not undo a newer one.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
  eventAt: Date = new Date(),
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const existing = await prisma.membership.findFirst({
    where: { stripeCustomerId: customerId },
  });

  let userId = existing?.userId;
  if (!userId) {
    userId = (await userIdForCustomer(customerId)) ?? undefined;
    if (!userId) {
      console.warn(`Stripe subscription ${subscription.id} has no matching member; ignoring.`);
      return;
    }
  }

  if (existing?.lastStripeEventAt && existing.lastStripeEventAt >= eventAt) {
    return;
  }

  const status = toMembershipStatus(subscription.status);
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end ?? null;
  // Which plan they are on decides what they may book, so it comes across
  // with the status rather than being looked up later.
  const planKey = item?.price?.metadata?.b42_plan ?? null;

  // Stamp when they first went past due, and clear it the moment they recover,
  // since the grace window is measured from that instant.
  const pastDueSince =
    status === 'PAST_DUE' ? existing?.pastDueSince ?? eventAt : null;

  await prisma.membership.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status,
      planKey,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      pastDueSince,
      lastStripeEventAt: eventAt,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status,
      planKey,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      pastDueSince,
      lastStripeEventAt: eventAt,
    },
  });
}

async function userIdForCustomer(customerId: string): Promise<string | null> {
  try {
    const customer = await getStripe().customers.retrieve(customerId);
    if (customer.deleted) return null;

    const email = customer.email?.trim().toLowerCase();
    if (!email) return null;

    const user = await prisma.user.findUnique({ where: { email } });
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function recordPaymentFailure(customerId: string, at: Date): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: { stripeCustomerId: customerId },
  });
  if (!membership) return;

  await prisma.membership.update({
    where: { id: membership.id },
    data: {
      status: 'PAST_DUE',
      // Keep the original failure time so the grace window is not extended by
      // each retry that also fails.
      pastDueSince: membership.pastDueSince ?? at,
    },
  });
}

export async function recordPaymentSuccess(customerId: string): Promise<void> {
  await prisma.membership.updateMany({
    where: { stripeCustomerId: customerId },
    data: { pastDueSince: null },
  });
}

// ---------------------------------------------------------------------------
// Member-facing
// ---------------------------------------------------------------------------

export interface Plan {
  priceId: string;
  planKey: string;
  name: string;
  priceLabel: string;
  description: string;
  amount: number | null;
  currency: string;
}

/**
 * The gym's plans, read from its own Stripe prices.
 *
 * A price is a B42 plan if it carries `b42_plan` metadata naming one of the
 * keys in config. That keeps pricing in Stripe, where the money is, and the
 * booking rules in config, where they can be reasoned about.
 */
export async function listPlans(): Promise<Plan[]> {
  if (!stripeConfigured()) return [];

  const prices = await getStripe().prices.list({
    active: true,
    type: 'recurring',
    limit: 100,
  });

  const configured = gymConfig.membership.plans as Record<
    string,
    { name: string; priceLabel: string; description: string }
  >;

  return prices.data
    .flatMap((price) => {
      const planKey = price.metadata?.b42_plan;
      const rules = planKey ? configured[planKey] : undefined;
      if (!planKey || !rules) return [];
      return [
        {
          priceId: price.id,
          planKey,
          name: rules.name,
          priceLabel: rules.priceLabel,
          description: rules.description,
          amount: price.unit_amount,
          currency: price.currency,
        },
      ];
    })
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
}

/** One-off pass packs, also read from Stripe. */
export interface PackOffer {
  priceId: string;
  label: string;
  passes: number;
  expiryDays: number;
  amount: number | null;
  currency: string;
}

export async function listPackOffers(): Promise<PackOffer[]> {
  if (!stripeConfigured()) return [];

  const prices = await getStripe().prices.list({
    active: true,
    type: 'one_time',
    expand: ['data.product'],
    limit: 100,
  });

  return prices.data
    .flatMap((price) => {
      const passes = Number(price.metadata?.b42_pack_passes);
      if (!Number.isFinite(passes) || passes <= 0) return [];

      const product = price.product;
      const label =
        typeof product !== 'string' && 'name' in product ? product.name : `${passes} classes`;

      return [
        {
          priceId: price.id,
          label,
          passes,
          expiryDays:
            Number(price.metadata?.b42_pack_days) || gymConfig.membership.packs.defaultExpiryDays,
          amount: price.unit_amount,
          currency: price.currency,
        },
      ];
    })
    .sort((a, b) => a.passes - b.passes);
}

export function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

async function ensureCustomer(user: SessionUser): Promise<string> {
  const existing = await prisma.membership.findUnique({ where: { userId: user.id } });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const stripe = getStripe();
  const found = await stripe.customers.list({ email: user.email, limit: 1 });
  const customer =
    found.data[0] ??
    (await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { appUserId: user.id },
    }));

  await prisma.membership.upsert({
    where: { userId: user.id },
    create: { userId: user.id, stripeCustomerId: customer.id },
    update: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Stripe's hosted checkout. Card details are only ever entered on Stripe's
 * page — this app has no card form and should never grow one.
 */
export async function createCheckoutSession(
  user: SessionUser,
  priceId: string,
): Promise<string> {
  if (!stripeConfigured()) throw memberFacingError();
  const customerId = await ensureCustomer(user);

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: appUrl('/account/membership?checkout=done'),
    cancel_url: appUrl('/account/membership?checkout=cancelled'),
    allow_promotion_codes: true,
    subscription_data: { metadata: { appUserId: user.id } },
  });

  if (!session.url) throw memberFacingError();
  return session.url;
}

/** Stripe's hosted portal for cards, invoices and cancelling. */
export async function createPortalSession(user: SessionUser): Promise<string> {
  if (!stripeConfigured()) throw memberFacingError();

  const membership = await prisma.membership.findUnique({ where: { userId: user.id } });
  if (!membership?.stripeCustomerId) {
    throw new AppError('You do not have a membership to manage yet.', 404, 'NO_MEMBERSHIP');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: membership.stripeCustomerId,
    return_url: appUrl('/account/membership'),
  });
  return session.url;
}

/** Members never see a Stripe status or error code — only this. */
function memberFacingError(): AppError {
  return new AppError(
    'Memberships aren’t available right now. Please speak to the gym.',
    503,
    'MEMBERSHIP_UNAVAILABLE',
  );
}

// ---------------------------------------------------------------------------
// Owner controls
// ---------------------------------------------------------------------------

/**
 * Mark somebody active by hand — cash, staff comp, a family member. Logged
 * with who did it and why, and it beats whatever Stripe says.
 */
export async function grantOverride(
  actor: SessionUser,
  memberId: string,
  activeUntil: Date,
  reason: string,
): Promise<MembershipState> {
  assertCan(actor, 'manageUsers');

  if (!reason.trim()) {
    throw new AppError('Give a reason — it goes on the record.', 422, 'REASON_REQUIRED');
  }
  if (activeUntil.getTime() <= Date.now()) {
    throw new AppError('Pick a date in the future.', 422, 'INVALID_DATE');
  }

  await prisma.membershipOverride.create({
    data: { memberId, activeUntil, reason: reason.trim(), byUserId: actor.id },
  });

  return getMembershipState(memberId);
}

/** End an override early. The row stays as the audit trail. */
export async function revokeOverride(
  actor: SessionUser,
  overrideId: string,
): Promise<MembershipState> {
  assertCan(actor, 'manageUsers');

  const override = await prisma.membershipOverride.findUnique({ where: { id: overrideId } });
  if (!override) throw notFound('That override no longer exists.');

  await prisma.membershipOverride.update({
    where: { id: overrideId },
    data: { revokedAt: new Date(), revokedById: actor.id },
  });

  return getMembershipState(override.memberId);
}

export async function listOverrides(actor: SessionUser, memberId: string) {
  assertCan(actor, 'viewMemberStrikes');
  return prisma.membershipOverride.findMany({
    where: { memberId },
    orderBy: { createdAt: 'desc' },
    include: { by: { select: { name: true } } },
  });
}

/**
 * Re-read a member's subscription from Stripe, for when a webhook was missed
 * or an owner has just changed something in the dashboard.
 */
export async function refreshFromStripe(actor: SessionUser, userId: string): Promise<void> {
  assertCan(actor, 'manageUsers');
  if (!stripeConfigured()) throw memberFacingError();

  const membership = await prisma.membership.findUnique({ where: { userId } });
  if (!membership?.stripeCustomerId) throw notFound('No Stripe customer for that member.');

  const subscriptions = await getStripe().subscriptions.list({
    customer: membership.stripeCustomerId,
    status: 'all',
    limit: 10,
  });

  const live =
    subscriptions.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status)) ??
    subscriptions.data[0];

  if (!live) {
    await prisma.membership.update({ where: { userId }, data: { status: 'NONE' } });
    return;
  }

  // A manual refresh is always the freshest thing we have, so it overrides the
  // out-of-order guard rather than being dropped by it.
  await prisma.membership.update({
    where: { userId },
    data: { lastStripeEventAt: null },
  });
  await syncSubscription(live, new Date());
}
