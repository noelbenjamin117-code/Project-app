import 'server-only';
import type Stripe from 'stripe';
import type { PassPack, Prisma } from '@prisma/client';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import { getStripe, stripeConfigured, appUrl } from '@/lib/stripe';
import type { SessionUser } from '@/lib/auth';
import { assertSelfOrStaff } from '@/lib/permissions';
import { AppError } from '@/lib/errors';
import { passesRemaining, type PassPackFacts } from '@/lib/domain/entitlement';

type Db = Prisma.TransactionClient | typeof prisma;

export function toFacts(pack: PassPack): PassPackFacts {
  return {
    id: pack.id,
    passesTotal: pack.passesTotal,
    passesUsed: pack.passesUsed,
    expiresAt: pack.expiresAt,
  };
}

export async function getPacks(memberId: string, db: Db = prisma): Promise<PassPack[]> {
  return db.passPack.findMany({
    where: { memberId },
    orderBy: { expiresAt: 'asc' },
  });
}

export interface PassBalance {
  remaining: number;
  /** The soonest expiry among packs with passes left on them. */
  nextExpiry: Date | null;
  low: boolean;
  packs: PassPack[];
}

export async function getBalance(
  memberId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<PassBalance> {
  const packs = await getPacks(memberId, db);
  const remaining = passesRemaining(packs.map(toFacts), now);

  const live = packs
    .filter((p) => p.expiresAt > now && p.passesUsed < p.passesTotal)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());

  return {
    remaining,
    nextExpiry: live[0]?.expiresAt ?? null,
    low: remaining > 0 && remaining <= gymConfig.membership.packs.lowBalanceAt,
    packs,
  };
}

/**
 * Spend a pass, inside the caller's transaction.
 *
 * The count lives on the pack rather than being derived from bookings, so a
 * booking row disappearing can never quietly hand somebody a free class. The
 * conditional update is what stops two simultaneous bookings spending the
 * same last pass.
 */
export async function spendPass(tx: Prisma.TransactionClient, packId: string): Promise<void> {
  const pack = await tx.passPack.findUnique({ where: { id: packId } });
  if (!pack) throw new AppError('That pass pack no longer exists.', 404, 'PACK_MISSING');

  const updated = await tx.passPack.updateMany({
    where: { id: packId, passesUsed: pack.passesUsed },
    data: { passesUsed: pack.passesUsed + 1 },
  });

  if (updated.count === 0) {
    throw new AppError('Please try that again.', 409, 'PASS_RACE');
  }
}

/** Hand a pass back — only ever called when a cancellation was in time. */
export async function refundPass(tx: Prisma.TransactionClient, packId: string): Promise<void> {
  await tx.passPack.updateMany({
    where: { id: packId, passesUsed: { gt: 0 } },
    data: { passesUsed: { decrement: 1 } },
  });
}

/**
 * Credit a purchased pack.
 *
 * Keyed on the Stripe checkout session, so a webhook delivered twice cannot
 * give the member two packs for one payment.
 */
export async function creditPack(input: {
  memberId: string;
  passes: number;
  expiryDays: number;
  stripeSessionId: string;
  label: string | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  const existing = await prisma.passPack.findUnique({
    where: { stripeSessionId: input.stripeSessionId },
  });
  if (existing) return;

  await prisma.passPack.create({
    data: {
      memberId: input.memberId,
      passesTotal: input.passes,
      expiresAt: new Date(now.getTime() + input.expiryDays * 86_400_000),
      stripeSessionId: input.stripeSessionId,
      label: input.label,
      purchasedAt: now,
    },
  });

  await prisma.notification.create({
    data: {
      userId: input.memberId,
      kind: 'STRIKE_RECORDED',
      title: `${input.passes} classes added`,
      body: `Your passes are ready to use and last ${input.expiryDays} days.`,
      href: '/account/membership',
    },
  });
}

/** Buy a pack. One-off payment on Stripe's hosted checkout. */
export async function createPackCheckout(
  user: SessionUser,
  priceId: string,
): Promise<string> {
  if (!stripeConfigured()) {
    throw new AppError(
      'Class passes aren’t available right now. Please speak to the gym.',
      503,
      'PASSES_UNAVAILABLE',
    );
  }

  const membership = await prisma.membership.findUnique({ where: { userId: user.id } });
  let customerId = membership?.stripeCustomerId ?? undefined;

  if (!customerId) {
    const stripe = getStripe();
    const found = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer =
      found.data[0] ??
      (await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { appUserId: user.id },
      }));
    customerId = customer.id;

    await prisma.membership.upsert({
      where: { userId: user.id },
      create: { userId: user.id, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: appUrl('/account/membership?passes=bought'),
    cancel_url: appUrl('/account/membership'),
    metadata: { appUserId: user.id, kind: 'pass_pack' },
  });

  if (!session.url) {
    throw new AppError('Could not start checkout.', 502, 'STRIPE_ERROR');
  }
  return session.url;
}

/** Called by the webhook once a pass-pack checkout completes. */
export async function handlePackCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'payment') return;

  const userId = session.metadata?.appUserId;
  if (!userId) return;

  const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, {
    limit: 10,
    expand: ['data.price.product'],
  });

  for (const item of lineItems.data) {
    const price = item.price;
    const passes = Number(price?.metadata?.b42_pack_passes);
    if (!Number.isFinite(passes) || passes <= 0) continue;

    const expiryDays =
      Number(price?.metadata?.b42_pack_days) || gymConfig.membership.packs.defaultExpiryDays;

    const product = price?.product;
    const label =
      product && typeof product !== 'string' && 'name' in product ? product.name : null;

    await creditPack({
      memberId: userId,
      // Somebody buying two packs at once gets both.
      passes: passes * (item.quantity ?? 1),
      expiryDays,
      stripeSessionId: session.id,
      label,
    });
  }
}

export async function getBalanceFor(
  actor: SessionUser,
  memberId: string,
  now: Date = new Date(),
): Promise<PassBalance> {
  assertSelfOrStaff(actor, memberId);
  return getBalance(memberId, now);
}
