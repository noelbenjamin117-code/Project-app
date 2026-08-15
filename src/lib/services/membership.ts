import 'server-only';
import type Stripe from 'stripe';
import type { Membership, MembershipStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getStripe, stripeConfigured, appUrl } from '@/lib/stripe';
import type { SessionUser } from '@/lib/auth';
import { assertCan, assertSelfOrStaff } from '@/lib/permissions';
import { AppError, notFound } from '@/lib/errors';

/**
 * Stripe's subscription statuses, mapped onto ours.
 *
 * `past_due` deliberately stays a membership rather than becoming a
 * cancellation: it is where a bounced payment lands while Stripe retries, and
 * the member has usually done nothing wrong yet.
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

/** Counts as a paying member for anything the gym cares about. */
export function isPaidUp(membership: Pick<Membership, 'status'> | null): boolean {
  if (!membership) return false;
  return (
    membership.status === 'ACTIVE' ||
    membership.status === 'TRIALING' ||
    membership.status === 'PAST_DUE'
  );
}

/** Needs the owner's attention: failing, lapsed or about to end. */
export function needsAttention(membership: Pick<Membership, 'status' | 'cancelAtPeriodEnd'> | null): boolean {
  if (!membership) return true;
  if (membership.status === 'PAST_DUE') return true;
  if (membership.status === 'CANCELED' || membership.status === 'NONE') return true;
  if (membership.status === 'INCOMPLETE') return true;
  return membership.cancelAtPeriodEnd;
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
// Plans, read from Stripe rather than hard-coded
// ---------------------------------------------------------------------------

export interface Plan {
  priceId: string;
  productName: string;
  description: string | null;
  /** Minor units, e.g. pence. */
  amount: number | null;
  currency: string;
  interval: string | null;
  intervalCount: number;
}

/**
 * The gym's membership tiers are whatever recurring prices exist in its own
 * Stripe account. That means adding or repricing a tier is done in Stripe,
 * where the money already lives, rather than by editing code and redeploying.
 */
export async function listPlans(): Promise<Plan[]> {
  if (!stripeConfigured()) return [];

  const stripe = getStripe();
  const prices = await stripe.prices.list({
    active: true,
    type: 'recurring',
    expand: ['data.product'],
    limit: 50,
  });

  return prices.data
    .filter((price) => {
      const product = price.product as Stripe.Product;
      return typeof product !== 'string' && !product.deleted && product.active;
    })
    .map((price) => {
      const product = price.product as Stripe.Product;
      return {
        priceId: price.id,
        productName: product.name,
        description: product.description,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? 1,
      };
    })
    .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
}

export function formatPrice(plan: Plan): string {
  if (plan.amount == null) return 'Price on request';

  const amount = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
    minimumFractionDigits: plan.amount % 100 === 0 ? 0 : 2,
  }).format(plan.amount / 100);

  if (!plan.interval) return amount;
  const every = plan.intervalCount > 1 ? `every ${plan.intervalCount} ${plan.interval}s` : `a ${plan.interval}`;
  return `${amount} ${every}`;
}

// ---------------------------------------------------------------------------
// Keeping the local mirror current
// ---------------------------------------------------------------------------

/**
 * Write a Stripe subscription into our local mirror.
 *
 * Everything the app reads comes from this row rather than from Stripe, so
 * rendering a roster of thirty people is one query rather than thirty API
 * calls.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const membership = await prisma.membership.findFirst({
    where: { stripeCustomerId: customerId },
  });

  // A subscription for a customer we have never seen — most likely created in
  // the Stripe dashboard by hand. Match on the customer's email if we can.
  let userId = membership?.userId;
  if (!userId) {
    userId = (await userIdForCustomer(customerId)) ?? undefined;
    if (!userId) {
      console.warn(`Stripe subscription ${subscription.id} has no matching member; ignoring.`);
      return;
    }
  }

  const item = subscription.items.data[0];
  const price = item?.price;
  const product = price?.product;

  const periodEnd = item?.current_period_end ?? null;

  await prisma.membership.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: price?.id ?? null,
      planName: await planNameFor(product),
      status: toMembershipStatus(subscription.status),
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: price?.id ?? null,
      planName: await planNameFor(product),
      status: toMembershipStatus(subscription.status),
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      // A successful renewal clears any previous failure.
      ...(subscription.status === 'active' ? { paymentFailedAt: null } : {}),
    },
  });
}

async function planNameFor(
  product: string | Stripe.Product | Stripe.DeletedProduct | undefined,
): Promise<string | null> {
  if (!product) return null;
  if (typeof product !== 'string') {
    return 'name' in product ? product.name : null;
  }
  try {
    const fetched = await getStripe().products.retrieve(product);
    return fetched.deleted ? null : fetched.name;
  } catch {
    return null;
  }
}

/** Find the member a Stripe customer belongs to, by email. */
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

export async function recordPaymentFailure(customerId: string): Promise<void> {
  await prisma.membership.updateMany({
    where: { stripeCustomerId: customerId },
    data: { paymentFailedAt: new Date(), status: 'PAST_DUE' },
  });
}

export async function recordPaymentSuccess(customerId: string): Promise<void> {
  await prisma.membership.updateMany({
    where: { stripeCustomerId: customerId },
    data: { paymentFailedAt: null },
  });
}

// ---------------------------------------------------------------------------
// Member-facing actions
// ---------------------------------------------------------------------------

/** Get or create the member's Stripe customer, so their history stays in one place. */
async function ensureCustomer(user: SessionUser): Promise<string> {
  const existing = await prisma.membership.findUnique({ where: { userId: user.id } });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const stripe = getStripe();

  // Reuse a customer that already exists for this email — likely from a
  // previous system — rather than creating a duplicate.
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

/** Start a subscription. Card details are only ever entered on Stripe's page. */
export async function createCheckoutSession(
  user: SessionUser,
  priceId: string,
): Promise<string> {
  if (!stripeConfigured()) {
    throw new AppError('Memberships are not set up yet.', 503, 'STRIPE_NOT_CONFIGURED');
  }

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

  if (!session.url) throw new AppError('Could not start checkout.', 502, 'STRIPE_ERROR');
  return session.url;
}

/**
 * Stripe's own portal, where a member updates their card, sees invoices or
 * cancels. Cheaper and safer than rebuilding any of that here.
 */
export async function createPortalSession(user: SessionUser): Promise<string> {
  if (!stripeConfigured()) {
    throw new AppError('Memberships are not set up yet.', 503, 'STRIPE_NOT_CONFIGURED');
  }

  const membership = await prisma.membership.findUnique({ where: { userId: user.id } });
  if (!membership?.stripeCustomerId) {
    throw notFound('You do not have a membership to manage yet.');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: membership.stripeCustomerId,
    return_url: appUrl('/account/membership'),
  });
  return session.url;
}

export async function getMembership(
  actor: SessionUser,
  userId: string = actor.id,
): Promise<Membership | null> {
  assertSelfOrStaff(actor, userId);
  return prisma.membership.findUnique({ where: { userId } });
}

/** Everyone the owner might need to chase. */
export async function listMembershipsNeedingAttention(actor: SessionUser) {
  assertCan(actor, 'manageUsers');

  return prisma.membership.findMany({
    where: {
      OR: [
        { status: { in: ['PAST_DUE', 'CANCELED', 'INCOMPLETE', 'NONE'] } },
        { cancelAtPeriodEnd: true },
      ],
    },
    include: { user: { select: { id: true, name: true, email: true, active: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Pull a member's subscription straight from Stripe and re-mirror it. For when
 * a webhook was missed, or an owner has just changed something in the Stripe
 * dashboard and wants it reflected now.
 */
export async function refreshFromStripe(actor: SessionUser, userId: string): Promise<void> {
  assertCan(actor, 'manageUsers');
  if (!stripeConfigured()) {
    throw new AppError('Memberships are not set up yet.', 503, 'STRIPE_NOT_CONFIGURED');
  }

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

  await syncSubscription(live);
}
