import Link from 'next/link';
import { gymConfig } from '~/gym.config';
import { formatDateTime } from '@/lib/time';
import type { StrikeState } from '@/lib/domain/strikes';
import type { MembershipState } from '@/lib/domain/membership';

/**
 * The warning has to arrive before the penalty does. A member sitting one
 * strike away sees this on every screen, so a suspension is never a surprise.
 */
export function StrikeBanner({ state }: { state: StrikeState }) {
  if (state.suspended && state.suspendedUntil) {
    return (
      <Link
        href="/account/strikes"
        className="mx-5 mb-4 block rounded-xl border border-bad/40 bg-bad/10 px-4 py-3"
      >
        <p className="text-sm font-semibold text-bad">Your bookings are paused</p>
        <p className="mt-1 text-sm text-white/70">
          You can still attend classes you already booked. New bookings open again on{' '}
          <span className="font-semibold text-white">
            {formatDateTime(state.suspendedUntil)}
          </span>
          .
        </p>
        <p className="mt-1.5 text-xs text-white/50 underline">See your strike history →</p>
      </Link>
    );
  }

  if (state.oneMoreLateCancelSuspends) {
    return (
      <Link
        href="/account/strikes"
        className="mx-5 mb-4 block rounded-xl border border-warn/40 bg-warn/10 px-4 py-3"
      >
        <p className="text-sm font-semibold text-warn">
          1 more late cancel in the next 30 days will pause your bookings for a week.
        </p>
        <p className="mt-1 text-xs text-white/50 underline">
          You're at {state.currentWeight} of {state.threshold} strikes — see the details →
        </p>
      </Link>
    );
  }

  // Not one strike away, but a no-show would still tip them over.
  if (state.oneMoreNoShowSuspends) {
    return (
      <Link
        href="/account/strikes"
        className="mx-5 mb-4 block rounded-xl border border-warn/30 bg-warn/5 px-4 py-3"
      >
        <p className="text-sm font-semibold text-warn">
          A no-show in the next {gymConfig.strikes.windowDays} days would pause your bookings.
        </p>
        <p className="mt-1 text-xs text-white/50 underline">
          You're at {state.currentWeight} of {state.threshold} strikes →
        </p>
      </Link>
    );
  }

  return null;
}

/**
 * Membership problems are shown above strike warnings — a member who cannot
 * book because their card failed needs to know that first.
 */
export function MembershipBanner({
  state,
  graceEndsLabel,
}: {
  state: MembershipState;
  graceEndsLabel: string | null;
}) {
  if (state.state === 'GRACE') {
    return (
      <Link
        href="/account/membership"
        className="mx-5 mb-4 block rounded-xl border border-warn/40 bg-warn/10 px-4 py-3"
      >
        <p className="text-sm font-semibold text-warn">
          Your payment failed — update your card{graceEndsLabel ? ` by ${graceEndsLabel}` : ''} to
          keep booking.
        </p>
        <p className="mt-1 text-xs text-white/50 underline">Update it now →</p>
      </Link>
    );
  }

  if (!state.canBook) {
    return (
      <Link
        href="/account/membership"
        className="mx-5 mb-4 block rounded-xl border border-bad/40 bg-bad/10 px-4 py-3"
      >
        <p className="text-sm font-semibold text-bad">
          {state.status === 'CANCELED'
            ? 'Your membership has ended'
            : 'You need a membership to book'}
        </p>
        <p className="mt-1 text-sm text-white/70">
          Classes you have already booked still stand.
        </p>
        <p className="mt-1 text-xs text-white/50 underline">Sort it out →</p>
      </Link>
    );
  }

  return null;
}
