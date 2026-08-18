/**
 * Single-gym configuration. This app serves exactly one gym — there is no
 * tenant table, no gym_id column, no org switcher. Everything that would be
 * "gym settings" in a SaaS product lives here and is deployed with the code.
 */
export const gymConfig = {
  name: 'B42',
  shortName: 'B42',

  /**
   * The gym's logo, served from the `public/` folder.
   *
   * Put your file at `public/logo.svg` and it appears in the app header, on
   * the login screen and on the gym TV. Using a different name or format?
   * Change this path to match — e.g. '/logo.png'. Set it to null to go back
   * to showing the gym's short name as text.
   */
  logo: '/logo.svg' as string | null,

  /**
   * The one timezone the gym operates in. Every timestamp is stored in UTC and
   * rendered through this zone. Changing it would reinterpret every existing
   * class time, so treat it as fixed after launch.
   */
  timezone: 'Europe/London',

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

  membership: {
    /**
     * How long a member keeps booking after Stripe reports a failed payment.
     * Stripe retries within this window, so most of these fix themselves —
     * the point is not to lock someone out over a card that expired.
     */
    pastDueGraceDays: 3,

    /**
     * What each plan lets a member book.
     *
     * The key is matched against the `b42_plan` metadata on the Stripe price,
     * so pricing lives in Stripe and the rules live here. Adding a plan means
     * adding a key in both places, and nothing else.
     *
     * `allows: 'ALL'` means every class the gym runs except pay-as-you-go
     * ones, which no membership ever covers.
     */
    plans: {
      UNLIMITED: {
        name: 'Unlimited',
        priceLabel: '£89.99 a month',
        description: 'Train whenever. Be part of everything.',
        weeklyLimit: null,
        allows: 'ALL',
      },
      TIER1: {
        name: 'B42 Tier 1',
        priceLabel: '£80.99 a month',
        description: 'Our most popular routine. Train up to 3x per week.',
        weeklyLimit: 3,
        allows: 'ALL',
      },
      TIER2: {
        name: 'B42 Tier 2',
        priceLabel: '£74.99 a month',
        description: 'Stay consistent. Train up to 2x per week.',
        weeklyLimit: 2,
        allows: 'ALL',
      },
      HYROX_WF: {
        name: 'HYROX Weds & Fri',
        priceLabel: '£54.99 a month',
        description: 'HYROX focused. Built for all who enjoy intensity.',
        weeklyLimit: null,
        // Only the HYROX sessions, and only on Wednesday and Friday.
        allows: [{ classNames: ['HYROX'], days: [3, 5] }],
      },
      OFF_PEAK: {
        name: 'Off Peak',
        priceLabel: '£50.99 a month',
        description: 'Train around the rush. 9:30am sessions and 4:30pm Thursdays.',
        weeklyLimit: null,
        // Any 9:30am class, plus the Thursday 4:30pm.
        allows: [{ times: ['09:30'] }, { days: [4], times: ['16:30'] }],
      },
    },

    /**
     * A member's week, for the plans that cap how often they train. Monday to
     * Sunday rather than a rolling seven days, because that is what can be
     * explained at the desk without anybody getting out a calendar.
     */
    weekStartsOn: 1,

    packs: {
      /**
       * Passes are sold as one-off Stripe prices carrying `b42_pack_passes`
       * metadata, so sizes and prices are set in Stripe rather than here.
       */
      defaultExpiryDays: 90,
      /** Warn the member when they are down to this many. */
      lowBalanceAt: 1,
    },
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
