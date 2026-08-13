import { gymConfig, type StrikeConfig } from '~/gym.config';

export type StrikeType = 'LATE_CANCEL' | 'NO_SHOW';

export interface StrikeInput {
  id: string;
  type: StrikeType;
  /** Snapshotted at creation, so config changes never rewrite history. */
  weight: number;
  occurredAt: Date;
  forgivenAt?: Date | null;
}

export interface SuspensionOverrideInput {
  id: string;
  liftedAt: Date;
}

export interface ComputedSuspension {
  startedAt: Date;
  endsAt: Date;
  /** The strike that pushed the member over the threshold. */
  triggeredByStrikeId: string;
  /** All strikes that counted toward this suspension. */
  countedStrikeIds: string[];
  liftedByOverrideId: string | null;
}

export interface StrikeStateEvent extends StrikeInput {
  /** When this strike drops out of the rolling window. */
  expiresAt: Date;
  /** Currently counting toward the running total. */
  counting: boolean;
  /** Already spent on a suspension the member has served. */
  consumed: boolean;
}

export interface StrikeState {
  suspended: boolean;
  suspendedSince: Date | null;
  suspendedUntil: Date | null;
  /** Weighted total inside the rolling window right now. */
  currentWeight: number;
  threshold: number;
  /** How much more weight before booking is paused. */
  weightToSuspension: number;
  /** Drives the persistent "one more and you're paused" banner. */
  oneMoreLateCancelSuspends: boolean;
  oneMoreNoShowSuspends: boolean;
  events: StrikeStateEvent[];
  suspensions: ComputedSuspension[];
}

const DAY_MS = 86_400_000;

/**
 * Derive everything strike-related from the stored events.
 *
 * Suspension is never a stored flag. It is recomputed from history on every
 * read, which is what makes it expire on its own, respond instantly to a
 * forgiveness, and stay correct no matter how long the app sat idle.
 *
 * The walk is chronological because the rolling window has to be evaluated as
 * it looked at the moment of each strike, not just as it looks now — otherwise
 * a suspension earned three weeks ago would vanish from history as soon as the
 * strikes behind it aged out.
 *
 * Strikes are *consumed* by the suspension they trigger: once a member has
 * served a pause, the strikes that caused it stop counting toward the next
 * one. Without this, a member returning from a suspension with 4 strikes still
 * in their window would be re-suspended by their very next late cancel, and
 * again by the one after that.
 */
export function computeStrikeState(
  events: StrikeInput[],
  overrides: SuspensionOverrideInput[] = [],
  now: Date = new Date(),
  config: StrikeConfig = gymConfig.strikes,
): StrikeState {
  const windowMs = config.windowDays * DAY_MS;
  const suspensionMs = config.suspensionDays * DAY_MS;

  // Forgiven strikes are excluded from every calculation but stay in history.
  const live = events
    .filter((e) => !e.forgivenAt)
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const suspensions: ComputedSuspension[] = [];
  const consumedIds = new Set<string>();
  let consumedThrough = -1;

  for (let i = 0; i < live.length; i++) {
    const at = live[i].occurredAt.getTime();
    const windowStart = at - windowMs;

    const counted: StrikeInput[] = [];
    let weight = 0;
    for (let j = consumedThrough + 1; j <= i; j++) {
      if (live[j].occurredAt.getTime() > windowStart) {
        counted.push(live[j]);
        weight += live[j].weight;
      }
    }

    if (weight >= config.threshold) {
      const startedAt = live[i].occurredAt;
      suspensions.push({
        startedAt,
        endsAt: new Date(startedAt.getTime() + suspensionMs),
        triggeredByStrikeId: live[i].id,
        countedStrikeIds: counted.map((c) => c.id),
        liftedByOverrideId: null,
      });
      counted.forEach((c) => consumedIds.add(c.id));
      consumedThrough = i;
    }
  }

  // An owner lifting a suspension writes an override rather than mutating
  // state, so the suspension stays derived and the action stays auditable.
  for (const suspension of suspensions) {
    const override = overrides.find(
      (o) =>
        o.liftedAt.getTime() >= suspension.startedAt.getTime() &&
        o.liftedAt.getTime() < suspension.endsAt.getTime(),
    );
    if (override) suspension.liftedByOverrideId = override.id;
  }

  const active = suspensions.filter(
    (s) =>
      !s.liftedByOverrideId &&
      s.startedAt.getTime() <= now.getTime() &&
      now.getTime() < s.endsAt.getTime(),
  );
  const suspendedUntil = active.length
    ? new Date(Math.max(...active.map((s) => s.endsAt.getTime())))
    : null;
  const suspendedSince = active.length
    ? new Date(Math.min(...active.map((s) => s.startedAt.getTime())))
    : null;

  // Running total as of now: unforgiven, unconsumed, still inside the window.
  const nowWindowStart = now.getTime() - windowMs;
  let currentWeight = 0;
  const stateEvents: StrikeStateEvent[] = events
    .slice()
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((e) => {
      const consumed = consumedIds.has(e.id);
      const counting =
        !e.forgivenAt && !consumed && e.occurredAt.getTime() > nowWindowStart;
      if (counting) currentWeight += e.weight;
      return {
        ...e,
        expiresAt: new Date(e.occurredAt.getTime() + windowMs),
        counting,
        consumed,
      };
    });

  const weightToSuspension = Math.max(0, config.threshold - currentWeight);

  return {
    suspended: active.length > 0,
    suspendedSince,
    suspendedUntil,
    currentWeight,
    threshold: config.threshold,
    weightToSuspension,
    // Only warn when they are not already suspended — a suspended member gets
    // the full explanation instead.
    oneMoreLateCancelSuspends:
      active.length === 0 && weightToSuspension > 0 && config.lateCancelWeight >= weightToSuspension,
    oneMoreNoShowSuspends:
      active.length === 0 && weightToSuspension > 0 && config.noShowWeight >= weightToSuspension,
    events: stateEvents,
    suspensions,
  };
}

/**
 * What the confirm dialog says at the moment of a late cancel. The member is
 * always told the strike is coming and where it leaves them — no silent
 * strikes, ever.
 */
export function previewStrike(
  state: StrikeState,
  type: StrikeType,
  config: StrikeConfig = gymConfig.strikes,
): { newWeight: number; willSuspend: boolean; message: string } {
  const weight = type === 'LATE_CANCEL' ? config.lateCancelWeight : config.noShowWeight;
  const newWeight = state.currentWeight + weight;
  const willSuspend = newWeight >= config.threshold;
  const label = type === 'LATE_CANCEL' ? 'late cancel' : 'no-show';

  const message = willSuspend
    ? `This counts as a ${label}. That puts you at ${newWeight} of ${config.threshold} strikes and pauses your bookings for ${config.suspensionDays} days.`
    : `This counts as a ${label}. You'll be at ${newWeight} of ${config.threshold} strikes in the last ${config.windowDays} days.`;

  return { newWeight, willSuspend, message };
}
