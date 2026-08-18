import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  getMembershipState,
  grantOverride,
  recordPaymentFailure,
  recordPaymentSuccess,
  revokeOverride,
  syncSubscription,
  toMembershipStatus,
} from '@/lib/services/membership';
import { bookClass, cancelBooking } from '@/lib/services/booking';
import { authenticate } from '@/lib/auth';
import { createUser as makeUser, createClass, prisma, resetDb } from './helpers';
import { hashPassword } from '@/lib/password';

beforeEach(async () => {
  await prisma.membershipOverride.deleteMany();
  await prisma.stripeEvent.deleteMany();
  await prisma.membership.deleteMany();
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 86_400_000;

function subscription(over: {
  customer: string;
  status: Stripe.Subscription.Status;
  periodEnd?: number;
}): Stripe.Subscription {
  return {
    id: `sub_${over.customer}`,
    customer: over.customer,
    status: over.status,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          current_period_end: over.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86_400,
          price: { id: 'price_unlimited', product: { name: 'Unlimited', object: 'product' } },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

async function memberWithCustomer(customerId: string) {
  const user = await makeUser('MEMBER', undefined, { paying: false });
  await prisma.membership.create({ data: { userId: user.id, stripeCustomerId: customerId } });
  return user;
}

describe('mapping Stripe status', () => {
  it.each([
    ['active', 'ACTIVE'],
    ['trialing', 'TRIALING'],
    ['past_due', 'PAST_DUE'],
    ['unpaid', 'PAST_DUE'],
    ['canceled', 'CANCELED'],
    ['incomplete_expired', 'CANCELED'],
  ])('maps %s to %s', (from, to) => {
    expect(toMembershipStatus(from)).toBe(to);
  });
});

describe('webhook idempotency and ordering', () => {
  it('only lets an event id be claimed once', async () => {
    await prisma.stripeEvent.create({ data: { id: 'evt_1', type: 'invoice.paid' } });
    await expect(
      prisma.stripeEvent.create({ data: { id: 'evt_1', type: 'invoice.paid' } }),
    ).rejects.toThrow();
  });

  it('applying the same subscription twice changes nothing', async () => {
    const user = await memberWithCustomer('cus_a');
    const sub = subscription({ customer: 'cus_a', status: 'active' });
    const at = new Date();

    await syncSubscription(sub, at);
    await syncSubscription(sub, at);

    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
    expect((await getMembershipState(user.id)).canBook).toBe(true);
  });

  it('ignores an event that arrives late but was created earlier', async () => {
    const user = await memberWithCustomer('cus_b');
    const newer = new Date();
    const older = new Date(newer.getTime() - 60_000);

    // The cancellation happened first but arrives second.
    await syncSubscription(subscription({ customer: 'cus_b', status: 'active' }), newer);
    await syncSubscription(subscription({ customer: 'cus_b', status: 'canceled' }), older);

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('ACTIVE');
    expect((await getMembershipState(user.id)).canBook).toBe(true);
  });

  it('applies an event that is genuinely newer', async () => {
    const user = await memberWithCustomer('cus_c');
    const first = new Date(Date.now() - 60_000);

    await syncSubscription(subscription({ customer: 'cus_c', status: 'active' }), first);
    await syncSubscription(subscription({ customer: 'cus_c', status: 'canceled' }), new Date());

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.status).toBe('CANCELED');
  });

  it('ignores a subscription for a customer nobody here matches', async () => {
    await syncSubscription(subscription({ customer: 'cus_nobody', status: 'active' }), new Date());
    expect(await prisma.membership.count({ where: { stripeCustomerId: 'cus_nobody' } })).toBe(0);
  });
});

describe('booking is gated on membership', () => {
  it('blocks a member with no membership', async () => {
    const user = await makeUser('MEMBER', undefined, { paying: false });
    const cls = await createClass({ capacity: 10 });

    await expect(bookClass(user, { classInstanceId: cls.id })).rejects.toThrow(
      /need a membership/i,
    );
  });

  it('blocks a member whose subscription was cancelled', async () => {
    const user = await memberWithCustomer('cus_lapsed');
    await syncSubscription(subscription({ customer: 'cus_lapsed', status: 'canceled' }), new Date());

    const cls = await createClass({ capacity: 10 });
    await expect(bookClass(user, { classInstanceId: cls.id })).rejects.toThrow(/ended/i);
  });

  it('allows a member with an active subscription', async () => {
    const user = await memberWithCustomer('cus_active');
    await syncSubscription(subscription({ customer: 'cus_active', status: 'active' }), new Date());

    const cls = await createClass({ capacity: 10 });
    const result = await bookClass(user, { classInstanceId: cls.id });
    expect(result.booking.status).toBe('BOOKED');
  });

  it('allows a member inside the failed-payment grace period', async () => {
    const user = await memberWithCustomer('cus_grace');
    await syncSubscription(subscription({ customer: 'cus_grace', status: 'past_due' }), new Date());
    await recordPaymentFailure('cus_grace', new Date(Date.now() - DAY));

    const state = await getMembershipState(user.id);
    expect(state.state).toBe('GRACE');

    const cls = await createClass({ capacity: 10 });
    const result = await bookClass(user, { classInstanceId: cls.id });
    expect(result.booking.status).toBe('BOOKED');
  });

  it('blocks a member once the grace period has run out', async () => {
    const user = await memberWithCustomer('cus_expired');
    await syncSubscription(
      subscription({ customer: 'cus_expired', status: 'past_due' }),
      new Date(),
    );
    // Failed four days ago, grace is three.
    await prisma.membership.update({
      where: { userId: user.id },
      data: { pastDueSince: new Date(Date.now() - 4 * DAY) },
    });

    const cls = await createClass({ capacity: 10 });
    await expect(bookClass(user, { classInstanceId: cls.id })).rejects.toThrow(/payment/i);
  });

  it('still lets a coach add a lapsed member by hand', async () => {
    const coach = await makeUser('COACH');
    const user = await memberWithCustomer('cus_coach_added');
    await syncSubscription(
      subscription({ customer: 'cus_coach_added', status: 'canceled' }),
      new Date(),
    );

    const cls = await createClass({ capacity: 10 });
    const result = await bookClass(coach, { classInstanceId: cls.id, memberId: user.id });
    expect(result.booking.status).toBe('BOOKED');
  });
});

describe('a lapse does not disturb existing bookings', () => {
  it('leaves classes already booked in place', async () => {
    const user = await memberWithCustomer('cus_keeps');
    await syncSubscription(subscription({ customer: 'cus_keeps', status: 'active' }), new Date());

    const cls = await createClass({ capacity: 10 });
    const booked = await bookClass(user, { classInstanceId: cls.id });

    // Their card fails and the grace runs out.
    await syncSubscription(
      subscription({ customer: 'cus_keeps', status: 'canceled' }),
      new Date(Date.now() + 1000),
    );
    expect((await getMembershipState(user.id)).canBook).toBe(false);

    const still = await prisma.booking.findUniqueOrThrow({ where: { id: booked.booking.id } });
    expect(still.status).toBe('BOOKED');

    // And they cannot book anything new.
    const other = await createClass({ capacity: 10, startTimeLocal: '18:30' });
    await expect(bookClass(user, { classInstanceId: other.id })).rejects.toThrow();
  });

  it('still lets them cancel a booking they already hold', async () => {
    const user = await memberWithCustomer('cus_cancels');
    await syncSubscription(subscription({ customer: 'cus_cancels', status: 'active' }), new Date());

    const cls = await createClass({ capacity: 10 });
    const booked = await bookClass(user, { classInstanceId: cls.id });

    await syncSubscription(
      subscription({ customer: 'cus_cancels', status: 'canceled' }),
      new Date(Date.now() + 1000),
    );

    const result = await cancelBooking(user, booked.booking.id);
    expect(result.booking.status).toBe('CANCELLED');
  });
});

describe('signing in is never gated', () => {
  it('lets a member with a failed payment log in to fix their card', async () => {
    const email = `pastdue-${Date.now()}@test.local`;
    const user = await prisma.user.create({
      data: { email, name: 'Past Due', role: 'MEMBER', passwordHash: await hashPassword('password123') },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        stripeCustomerId: 'cus_login',
        status: 'PAST_DUE',
        pastDueSince: new Date(Date.now() - 30 * DAY),
      },
    });

    // Well past the grace period, so they definitely cannot book…
    expect((await getMembershipState(user.id)).canBook).toBe(false);

    // …but they can still sign in, which is the only way to pay us.
    const session = await authenticate(email, 'password123');
    expect(session?.id).toBe(user.id);
  });

  it('lets a member with no membership at all log in', async () => {
    const email = `nomembership-${Date.now()}@test.local`;
    await prisma.user.create({
      data: { email, name: 'No Membership', role: 'MEMBER', passwordHash: await hashPassword('password123') },
    });

    expect(await authenticate(email, 'password123')).not.toBeNull();
  });
});

describe('manual overrides', () => {
  it('lets an owner mark a lapsed member active, and they can book', async () => {
    const owner = await makeUser('OWNER', undefined, { paying: false });
    const user = await memberWithCustomer('cus_cash');
    await syncSubscription(subscription({ customer: 'cus_cash', status: 'canceled' }), new Date());

    const cls = await createClass({ capacity: 10 });
    await expect(bookClass(user, { classInstanceId: cls.id })).rejects.toThrow();

    await grantOverride(owner, user.id, new Date(Date.now() + 30 * DAY), 'Paid cash for August');

    const state = await getMembershipState(user.id);
    expect(state.canBook).toBe(true);
    expect(state.source).toBe('OVERRIDE');

    const result = await bookClass(user, { classInstanceId: cls.id });
    expect(result.booking.status).toBe('BOOKED');
  });

  it('keeps who granted it and why', async () => {
    const owner = await makeUser('OWNER', undefined, { paying: false });
    const user = await makeUser('MEMBER', undefined, { paying: false });

    await grantOverride(owner, user.id, new Date(Date.now() + 10 * DAY), 'Staff comp');

    const [row] = await prisma.membershipOverride.findMany({ where: { memberId: user.id } });
    expect(row.reason).toBe('Staff comp');
    expect(row.byUserId).toBe(owner.id);
  });

  it('refuses an override with no reason or a date in the past', async () => {
    const owner = await makeUser('OWNER', undefined, { paying: false });
    const user = await makeUser('MEMBER', undefined, { paying: false });

    await expect(
      grantOverride(owner, user.id, new Date(Date.now() + DAY), '   '),
    ).rejects.toThrow(/reason/i);

    await expect(
      grantOverride(owner, user.id, new Date(Date.now() - DAY), 'Backdated'),
    ).rejects.toThrow(/future/i);
  });

  it('does not let a coach grant one', async () => {
    const coach = await makeUser('COACH', undefined, { paying: false });
    const user = await makeUser('MEMBER', undefined, { paying: false });

    await expect(
      grantOverride(coach, user.id, new Date(Date.now() + DAY), 'Trying it on'),
    ).rejects.toThrow(/permission/i);
  });

  it('stops applying once revoked, but stays on the record', async () => {
    const owner = await makeUser('OWNER', undefined, { paying: false });
    const user = await makeUser('MEMBER', undefined, { paying: false });

    await grantOverride(owner, user.id, new Date(Date.now() + 30 * DAY), 'Paid cash');
    const [row] = await prisma.membershipOverride.findMany({ where: { memberId: user.id } });

    await revokeOverride(owner, row.id);

    expect((await getMembershipState(user.id)).canBook).toBe(false);
    // Audit trail survives.
    expect(await prisma.membershipOverride.count({ where: { memberId: user.id } })).toBe(1);
  });
});

describe('failed and recovered payments', () => {
  it('records when the failure started and does not extend it on each retry', async () => {
    const user = await memberWithCustomer('cus_retry');
    // Starts healthy, so the first failure is what stamps the clock.
    await syncSubscription(subscription({ customer: 'cus_retry', status: 'active' }), new Date());

    const first = new Date(Date.now() - 2 * DAY);
    await recordPaymentFailure('cus_retry', first);
    // Stripe retries two days later and fails again.
    await recordPaymentFailure('cus_retry', new Date());

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    // Still measured from the first failure, so retries cannot buy extra grace.
    expect(membership.pastDueSince?.getTime()).toBe(first.getTime());
  });

  it('clears the failure when a payment succeeds', async () => {
    const user = await memberWithCustomer('cus_recovers');
    await syncSubscription(
      subscription({ customer: 'cus_recovers', status: 'past_due' }),
      new Date(),
    );
    await recordPaymentFailure('cus_recovers', new Date());

    await recordPaymentSuccess('cus_recovers');

    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    expect(membership.pastDueSince).toBeNull();
  });
});
