/**
 * Single-gym configuration. This app serves exactly one gym — there is no
 * tenant table, no gym_id column, no org switcher. Everything that would be
 * "gym settings" in a SaaS product lives here and is deployed with the code.
 */
export const gymConfig = {
  name: 'Ironside Strength & Conditioning',
  shortName: 'Ironside',

  /**
   * The one timezone the gym operates in. Every timestamp is stored in UTC and
   * rendered through this zone. Changing it would reinterpret every existing
   * class time, so treat it as fixed after launch.
   */
  timezone: 'America/New_York',

  /** Members log and read loads in kilograms. */
  weightUnit: 'kg' as const,

  /** How far ahead class instances are materialised from templates. */
  scheduleHorizonDays: 56,

  strikes: {
    /** A late cancel at least frees the spot for somebody else. */
    lateCancelWeight: 1,
    /** A no-show wastes the spot entirely, so it counts double. */
    noShowWeight: 2,
    /** Weighted total within the window that triggers a suspension. */
    threshold: 4,
    /** Rolling window, ending at "now" — not a calendar month. */
    windowDays: 30,
    /** How long booking is paused once the threshold is crossed. */
    suspensionDays: 7,
  },

  grace: {
    /** Cancelling a booking you just made never counts. Fat-finger insurance. */
    freshBookingMinutes: 15,
    /**
     * Promoted off the waitlist inside your own cancellation window? You get a
     * fresh free-cancel grace — you didn't choose to be given that spot.
     */
    waitlistPromotionMinutes: 30,
  },

  whiteboard: {
    /** How often the TV pulls fresh data. */
    pollSeconds: 30,
    /**
     * Belt-and-braces full page reload. The TV is left on for weeks; this
     * clears anything a long-lived tab accumulates and picks up new deploys.
     */
    hardReloadHours: 6,
    /** How many leaderboard rows fit on a 1080p panel at TV type sizes. */
    leaderboardRows: 10,
    /** How many upcoming classes to list. */
    upcomingClasses: 4,
  },
} as const;

export type GymConfig = typeof gymConfig;

/**
 * Declared explicitly rather than derived from the object above: `as const`
 * narrows the values to literal types (`threshold: 4`), which would stop
 * callers — tests especially — from passing their own numbers.
 */
export interface StrikeConfig {
  lateCancelWeight: number;
  noShowWeight: number;
  threshold: number;
  windowDays: number;
  suspensionDays: number;
}

export interface GraceConfig {
  freshBookingMinutes: number;
  waitlistPromotionMinutes: number;
}
