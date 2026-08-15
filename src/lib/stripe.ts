import 'server-only';
import Stripe from 'stripe';

/**
 * Stripe is optional. The gym can run its booking, programming and whiteboard
 * without it, so nothing here throws at import time — the app only complains
 * when someone actually tries to use a membership feature.
 */
let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      'Stripe is not configured. Add STRIPE_SECRET_KEY in your hosting settings.',
    );
  }
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pinning the version means a Stripe-side upgrade cannot change the
      // shape of what the webhook handler receives without us choosing it.
      apiVersion: '2026-07-29.dahlia',
      appInfo: { name: 'B42 gym app' },
    });
  }
  return cached;
}

/** The public base URL, used for Stripe redirects back into the app. */
export function appUrl(path = ''): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}${path}`;
}
