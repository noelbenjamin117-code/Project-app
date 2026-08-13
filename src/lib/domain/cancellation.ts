import { DateTime } from 'luxon';
import { gymConfig, type GraceConfig } from '~/gym.config';
import { GYM_TZ, addLocalDays, localToUtc, type LocalDate, type LocalTime } from '@/lib/time';

export type CancelPolicyType = 'ABSOLUTE' | 'RELATIVE' | 'NONE';

export interface CancellationPolicy {
  type: CancelPolicyType;
  /** ABSOLUTE: wall-clock time on the PREVIOUS calendar day, "HH:mm". */
  absoluteTimeLocal?: string | null;
  /** RELATIVE: hours before class start. */
  relativeHours?: number | null;
}

/**
 * The free-cancel deadline for a class, from its policy alone.
 *
 * ABSOLUTE deadlines are computed in gym-local time on the previous calendar
 * day, so a 21:00 rule lands on 21:00 local whichever side of a DST boundary
 * it falls — the UTC instant moves, the wall clock does not.
 */
export function classCancelDeadline(
  classLocalDate: LocalDate,
  startsAt: Date,
  policy: CancellationPolicy,
): Date {
  switch (policy.type) {
    case 'ABSOLUTE': {
      const time = policy.absoluteTimeLocal;
      if (!time) throw new Error('ABSOLUTE cancellation policy requires absoluteTimeLocal');
      return localToUtc(addLocalDays(classLocalDate, -1), time as LocalTime);
    }
    case 'RELATIVE': {
      const hours = policy.relativeHours;
      if (hours == null) throw new Error('RELATIVE cancellation policy requires relativeHours');
      return DateTime.fromJSDate(startsAt).minus({ hours }).toJSDate();
    }
    case 'NONE':
      // Free right up to the moment the class starts.
      return startsAt;
  }
}

export type DeadlineReason =
  /** The class template's own rule. */
  | 'POLICY'
  /** Booked moments ago — fat-finger insurance. */
  | 'FRESH_BOOKING'
  /** Promoted off the waitlist inside the window; they didn't pick the timing. */
  | 'WAITLIST_PROMOTION';

export interface BookingTiming {
  bookedAt: Date;
  promotedAt?: Date | null;
}

export interface EffectiveDeadline {
  deadline: Date;
  reason: DeadlineReason;
}

/**
 * The deadline that actually applies to one booking: the class policy, pushed
 * later by whichever grace window is more generous.
 *
 * Both the enforcement path and the "cancel free until 9:00pm tonight" string
 * call this, so what the member is told and what the server enforces cannot
 * drift apart.
 */
export function effectiveCancelDeadline(
  classDeadline: Date,
  booking: BookingTiming,
  grace: GraceConfig = gymConfig.grace,
): EffectiveDeadline {
  let deadline = classDeadline;
  let reason: DeadlineReason = 'POLICY';

  const fresh = new Date(booking.bookedAt.getTime() + grace.freshBookingMinutes * 60_000);
  if (fresh > deadline) {
    deadline = fresh;
    reason = 'FRESH_BOOKING';
  }

  if (booking.promotedAt) {
    const promoted = new Date(
      booking.promotedAt.getTime() + grace.waitlistPromotionMinutes * 60_000,
    );
    if (promoted > deadline) {
      deadline = promoted;
      reason = 'WAITLIST_PROMOTION';
    }
  }

  return { deadline, reason };
}

export type BookingStatus = 'BOOKED' | 'WAITLISTED' | 'CANCELLED';
export type ClassStatus = 'SCHEDULED' | 'CANCELLED';

export interface CancellationContext {
  now: Date;
  classStatus: ClassStatus;
  bookingStatus: BookingStatus;
  classDeadline: Date;
  booking: BookingTiming;
  grace?: GraceConfig;
}

export interface CancellationOutcome {
  deadline: Date;
  reason: DeadlineReason;
  /** True when the cancel lands after the deadline and earns a strike. */
  isLate: boolean;
  /** Why no strike was recorded, for the UI to explain itself. */
  exemption: 'GYM_CANCELLED' | 'WAITLISTED' | 'WITHIN_DEADLINE' | null;
}

/**
 * Decide whether cancelling right now counts as a late cancel.
 *
 * Cancelling late still frees the spot and still promotes the waitlist — the
 * only consequence is the strike. The exemptions are the cases where the
 * member didn't really choose the outcome.
 */
export function evaluateCancellation(ctx: CancellationContext): CancellationOutcome {
  const { deadline, reason } = effectiveCancelDeadline(
    ctx.classDeadline,
    ctx.booking,
    ctx.grace ?? gymConfig.grace,
  );

  // The gym pulled the class — nobody is penalised for that.
  if (ctx.classStatus === 'CANCELLED') {
    return { deadline, reason, isLate: false, exemption: 'GYM_CANCELLED' };
  }

  // Never promoted off the waitlist, so they never held a spot to give up.
  if (ctx.bookingStatus === 'WAITLISTED') {
    return { deadline, reason, isLate: false, exemption: 'WAITLISTED' };
  }

  if (ctx.now <= deadline) {
    return { deadline, reason, isLate: false, exemption: 'WITHIN_DEADLINE' };
  }

  return { deadline, reason, isLate: true, exemption: null };
}

/**
 * Human explanation of the rule itself, for the coach-facing template editor.
 * Members are shown a real timestamp instead (see formatDeadline).
 */
export function describePolicy(policy: CancellationPolicy): string {
  switch (policy.type) {
    case 'ABSOLUTE':
      return `Free until ${formatPolicyTime(policy.absoluteTimeLocal ?? '')} the day before`;
    case 'RELATIVE':
      return `Free until ${policy.relativeHours}h before start`;
    case 'NONE':
      return 'Free until class starts';
  }
}

function formatPolicyTime(hhmm: string): string {
  const dt = DateTime.fromFormat(hhmm, 'HH:mm', { zone: GYM_TZ });
  return dt.isValid ? dt.toFormat('h:mma').toLowerCase() : hhmm;
}
