import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import {
  recordPaymentFailure,
  recordPaymentSuccess,
  syncSubscription,
} from '@/lib/services/membership';

// Stripe's SDK needs Node, and the signature check needs the raw body — so no
// edge runtime and no body parsing before we get to it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. This is what keeps membership current without anybody
 * typing a renewal date.
 *
 * Three things matter here and are easy to get wrong:
 *
 *  - The payload is verified against the signing secret before it is trusted.
 *    Without that, anyone who finds this URL could mark themselves paid up.
 *  - Events are recorded by id and skipped if seen before. Stripe retries on
 *    any non-2xx and can deliver the same event more than once.
 *  - Unrecognised events still return 200. Returning an error would make
 *    Stripe retry something we are never going to handle.
 */
export async function POST(request: Request) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error('Stripe signature verification failed', error);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  // Claim the event id first. If this insert conflicts we have already handled
  // it, and doing the work twice could double-apply a change.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (error) {
    // Let the row go so Stripe's retry gets a real second attempt.
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => {});
    console.error(`Failed handling Stripe event ${event.type}`, error);
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.subscription) break;

      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      await syncSubscription(subscription);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (customerId) await recordPaymentFailure(customerId);
      break;
    }

    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (customerId) await recordPaymentSuccess(customerId);
      break;
    }

    default:
      // Everything else is acknowledged and ignored on purpose.
      break;
  }
}
