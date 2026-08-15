import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  isPaidUp,
  needsAttention,
  syncSubscription,
  toMembershipStatus,
  recordPaymentFailure,
  recordPaymentSuccess,
} from '@/lib/services/membership';
import { createUser, prisma, resetDb } from './helpers';

beforeEach(async () => {
  await prisma.stripeEvent.deleteMany();
  await prisma.membership.deleteMany();
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A Stripe subscription, trimmed to the fields the sync actually reads. */
function subscription(overrides: {
  customer: string;
  status: Stripe.Subscription.Status;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  priceId?: string;
  productName?: string;
}): Stripe.Subscription {
  return {
    id: `sub_${overrides.customer}`,
    customer: overrides.customer,
    status: overrides.status,
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    items: {
      data: [
        {
          current_period_end: overrides.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86_400,
          price: {
            id: overrides.priceId ?? 'price_unlimited',
            product: { name: overrides.productName ?? 'Unlimited', object: 'product' },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

async function memberWithCustomer(customerId: string) {
  const user = await createUser('MEMBER');
  await prisma.membership.create({
    data: { userId: user.id, stripeCustomerId: customerId },
  });
  return user;
}

describe('mapping Stripe status onto membership status', () => {
  it.each([
    ['active', 'ACTIVE'],
    ['trialing', 'TRIALING'],
    ['past_due', 'PAST_DUE'],
    ['unpaid', 'PAST_DUE'],
    ['canceled', 'CANCELED'],
    ['incomplete', 'INCOMPLETE'],
    ['incomplete_expired', 'CANCELED'],
    ['paused', 'PAUSED'],
  ])('maps %s to %s', (stripeStatus, expected) => {
    expect(toMembershipStatus(stripeStatus)).toBe(expected);
  });

  it('falls back to NONE for anything unrecognised', () => {
    expect(toMembershipStatus('something_new')).toBe('NONE');
  });
});

describe('who counts as a paying member', () => {
  it('counts active, trialing and past-due', () => {
    expect(isPaidUp({ status: 'ACTIVE' })).toBe(true);
    expect(isPaidUp({ status: 'TRIALING' })).toBe(true);
    // A bounced payment that Stripe is still retrying — they have not lapsed.
    expect(isPaidUp({ status: 'PAST_DUE' })).toBe(true);
  });

  it('does not count cancelled, incomplete, paused or absent', () => {
    expect(isPaidUp({ status: 'CANCELED' })).toBe(false);
    expect(isPaidUp({ status: 'INCOMPLETE' })).toBe(false);
    expect(isPaidUp({ status: 'PAUSED' })).toBe(false);
    expect(isPaidUp({ status: 'NONE' })).toBe(false);
    expect(isPaidUp(null)).toBe(false);
  });

  it('flags for attention anyone failing, lapsed or leaving', () => {
    expect(needsAttention({ status: 'PAST_DUE', cancelAtPeriodEnd: false })).toBe(true);
    expect(needsAttention({ status: 'CANCELED', cancelAtPeriodEnd: false })).toBe(true);
    expect(needsAttention({ status: 'NONE', cancelAtPeriodEnd: false })).toBe(true);
    expect(needsAttention(null)).toBe(true);
    // Still paying, but has asked to stop at the end of the period.
    expect(needsAttention({ status: 'ACTIVE', cancelAtPeriodEnd: true })).toBe(true);
    expect(needsAttention({ status: 'ACTIVE', cancelAtPeriodEnd: false })).toBe(false);
  });
});

describe('mirroring a subscription locally', () => {
  it('records the plan, status and renewal date', async () => {
    const user = await memberWithCustomer('cus_alpha');
    const periodEnd = Math.floor(Date.now() / 1000) + 14 * 86_400;

    await syncSubscription(
      subscription({
        customer: 'cus_alpha',
        status: 'active',
        periodEnd,
        productName: 'Unlimited',
        priceId: 'price_unlimited',
      }),
    );

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(membership.status).toBe('ACTIVE');
    expect(membership.planName).toBe('Unlimited');
    expect(membership.stripePriceId).toBe('price_unlimited');
    expect(membership.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
    expect(membership.cancelAtPeriodEnd).toBe(false);
  });

  it('is safe to apply the same event twice', async () => {
    const user = await memberWithCustomer('cus_beta');
    const sub = subscription({ customer: 'cus_beta', status: 'active' });

    await syncSubscription(sub);
    await syncSubscription(sub);

    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
  });

  it('moves a member to cancelled when the subscription ends', async () => {
    const user = await memberWithCustomer('cus_gamma');

    await syncSubscription(subscription({ customer: 'cus_gamma', status: 'active' }));
    await syncSubscription(subscription({ customer: 'cus_gamma', status: 'canceled' }));

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('CANCELED');
    expect(isPaidUp(membership)).toBe(false);
  });

  it('records a pending cancellation without ending the membership', async () => {
    const user = await memberWithCustomer('cus_delta');

    await syncSubscription(
      subscription({ customer: 'cus_delta', status: 'active', cancelAtPeriodEnd: true }),
    );

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('ACTIVE');
    expect(membership.cancelAtPeriodEnd).toBe(true);
    // Still training until the period runs out, but the owner should know.
    expect(isPaidUp(membership)).toBe(true);
    expect(needsAttention(membership)).toBe(true);
  });

  it('ignores a subscription for a customer nobody here matches', async () => {
    await syncSubscription(subscription({ customer: 'cus_stranger', status: 'active' }));
    expect(await prisma.membership.count({ where: { stripeCustomerId: 'cus_stranger' } })).toBe(0);
  });
});

describe('failed and recovered payments', () => {
  it('marks a member past due when a payment fails, and clears it when one succeeds', async () => {
    const user = await memberWithCustomer('cus_epsilon');
    await syncSubscription(subscription({ customer: 'cus_epsilon', status: 'active' }));

    await recordPaymentFailure('cus_epsilon');
    let membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('PAST_DUE');
    expect(membership.paymentFailedAt).not.toBeNull();
    // They can still book — a failed card is not a reason to lock someone out.
    expect(isPaidUp(membership)).toBe(true);

    await recordPaymentSuccess('cus_epsilon');
    membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.paymentFailedAt).toBeNull();
  });

  it('clears the failure flag when the subscription goes active again', async () => {
    const user = await memberWithCustomer('cus_zeta');
    await syncSubscription(subscription({ customer: 'cus_zeta', status: 'past_due' }));
    await recordPaymentFailure('cus_zeta');

    await syncSubscription(subscription({ customer: 'cus_zeta', status: 'active' }));

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('ACTIVE');
    expect(membership.paymentFailedAt).toBeNull();
  });
});

describe('webhook replay protection', () => {
  it('only lets an event id be claimed once', async () => {
    await prisma.stripeEvent.create({ data: { id: 'evt_1', type: 'invoice.paid' } });

    // The webhook route relies on this insert failing the second time.
    await expect(
      prisma.stripeEvent.create({ data: { id: 'evt_1', type: 'invoice.paid' } }),
    ).rejects.toThrow();

    expect(await prisma.stripeEvent.count({ where: { id: 'evt_1' } })).toBe(1);
  });
});

describe('membership never blocks booking', () => {
  it('leaves a lapsed member able to book, by design', async () => {
    const { bookClass } = await import('@/lib/services/booking');
    const { createClass } = await import('./helpers');

    const user = await memberWithCustomer('cus_lapsed');
    await syncSubscription(subscription({ customer: 'cus_lapsed', status: 'canceled' }));

    const cls = await createClass({ capacity: 5 });
    const result = await bookClass(user, { classInstanceId: cls.id });

    // The gym chose to chase lapsed members rather than lock them out.
    expect(result.booking.status).toBe('BOOKED');
  });
});
