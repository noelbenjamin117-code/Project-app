# Ironside — gym management

Class booking, check-in, programming, results and a whiteboard for **one**
functional-fitness gym. Not a SaaS product: there is no tenant table, no
`gym_id` column and no org switcher anywhere. Gym settings live in
[`gym.config.ts`](./gym.config.ts).

Built for ~200 members and ~10 classes a day. Every design choice below prefers
the boring option at that scale.

## Stack

Next.js (App Router) · TypeScript · Postgres · Prisma · Tailwind · Luxon.
Deploys to Vercel with hosted Postgres.

## Deploying without a terminal

If you just want this running for your gym, follow **[DEPLOY.md](./DEPLOY.md)** —
Neon for the database, Vercel for hosting, all from a browser. The app creates
its own owner account through a first-run setup page, and people are added from
inside the app, so no command line is needed at any point.

## Getting started (with a terminal)

```bash
npm install
cp .env.example .env        # set DATABASE_URL, DIRECT_URL and SESSION_SECRET
npx prisma migrate deploy
npm run db:seed             # optional: a full demo gym
npm run dev
```

Skip `db:seed` and the app will offer its first-run setup page instead.

The seed prints its logins. Everyone's password is `password123`:

| Who | Email | What they show |
| --- | --- | --- |
| Owner | `owner@ironside.gym` | Everything, including lifting suspensions |
| Coach | `coach.sam@ironside.gym` | Rosters, programming, schedule, forgiveness |
| Member | `member1@example.com` | Three strikes — the pre-suspension warning banner |
| Member | `member2@example.com` | Currently suspended from booking |
| Member | `member3@example.com` | Has a forgiven strike, with the audit trail |
| Member | `member4`…`member40@example.com` | Ordinary members |

The seed creates 3 coaches, 40 members, four weeks of classes (two behind, two
ahead), 10 benchmark WODs with real scores on the board, and today's WOD already
programmed so the whiteboard has something on it.

## The three surfaces

| Route | Audience | Shape |
| --- | --- | --- |
| `/schedule`, `/today`, `/history`, `/account/strikes` | Members | Mobile-first, installable PWA |
| `/coach/*` | Coaches and owner | Desktop-first |
| `/whiteboard` | The gym TV | 1920×1080, no login, auto-refreshing |

## How the hard parts work

**Templates vs class instances.** `ClassTemplate` is the weekly pattern;
`ClassInstance` rows are materialised from it on a rolling 8-week horizon.
Instances are real rows because bookings need something to point at, coaches get
swapped on individual days, and a holiday cancellation is a fact about one class
rather than the pattern. Generation is idempotent via a `(templateId, date)`
unique constraint, so it can run as often as you like. Capacity and the
cancellation rule are **snapshotted** onto each instance: editing a template
does not silently change the terms for people who already booked, and pushing a
change onto existing classes is an explicit opt-in.

**DST.** Templates store a wall-clock string (`"06:00"`) and a weekday, never an
offset. Each date's UTC instant is derived by converting that local time on that
local date. A 6am class is 11:00Z in winter and 10:00Z in summer, and an
ABSOLUTE 21:00 deadline lands on 21:00 local on both sides of a transition.
Nonexistent times (spring forward) shift forward; ambiguous times (fall back)
take the first occurrence.

**Waitlist ordering.** Ordered by `(waitlistedAt, id)` — there is no position
column, because a position integer has to be renumbered on every join, leave and
promotion, and gets it wrong the moment two of those happen at once.

**Concurrent cancels.** Every mutation that can change who holds a spot takes a
`SELECT … FOR UPDATE` lock on the `ClassInstance` row first, making the class row
the mutex for that class. Two members cancelling at the same instant serialise
there, so two different people come off the waitlist and capacity is never
exceeded. There is a test for exactly this.

**One results schema.** `Result` has typed nullable columns —
`timeSeconds` / `rounds` + `reps` / `reps` / `loadKg` — and the WOD's `scoreType`
decides which are required. Time caps are first-class: every finisher outranks
every capped athlete, and capped athletes are ordered by reps completed
(`20:00 CAP + 12`). Ranking runs through one comparator in
`src/lib/domain/scoring.ts`, so the whiteboard, the class board and a member's
history can never disagree about who won.

**PR detection.** Benchmark PRs are keyed on `(wodDefinition, scalingLevel)` —
Scaled is never ranked against Rx. Lift PRs are keyed on `(movement, reps)`, so
a 3RM and a 1RM are separate records and a heavy triple never overwrites a
single. Flags are rebuilt by walking a member's history chronologically, which
means every effort that was a PR *at the time* stays flagged, and a backdated
entry correctly demotes whatever it should. Estimated 1RM is shown for context
but never counts as a PR.

**Strikes and suspension.** Only `StrikeEvent` rows are stored, with the weight
snapshotted at creation. Suspension is **computed** on every read by walking the
member's events chronologically and evaluating the rolling 30-day window as it
looked at each event. That is what makes it expire on its own, respond instantly
to a forgiveness, and never go stale. Forgiveness marks an event rather than
deleting it, so who forgave what and why survives. An owner lifting a suspension
writes a `SuspensionOverride` — the suspension stays derived.

Strikes are *consumed* by the suspension they trigger. Without that, a member
returning from a pause with four strikes still in their window would be
re-suspended by their very next late cancel, and again by the one after.

No strike is recorded when the gym cancels the class, when a waitlisted member
never got promoted, within 15 minutes of booking (fat-finger grace), or within
30 minutes of being promoted off the waitlist. Cancelling late still frees the
spot and still promotes the waitlist — the strike is the only consequence.

**Permissions.** Roles are hierarchical (`OWNER` ⊇ `COACH` ⊇ `MEMBER`) and every
capability resolves in `src/lib/permissions.ts`. The UI hides what a member
cannot do, but hiding is not enforcement: every server action re-reads the
session and re-checks the capability before touching the database. The role is
read from the database per request rather than trusted from the session token,
so revoking access takes effect immediately.

**Whiteboard.** One polling interval cleared on unmount, in-flight requests
aborted before the next starts, state replaced wholesale on each tick so nothing
accumulates, a full reload every 6 hours and immediately when the gym-local date
rolls over, and the last good board kept on screen if a poll fails. All
formatting happens server-side, because the panel is a browser left running for
weeks in an unknown locale.

## Commands

```bash
npm run dev               # development server
npm run build             # production build
npm test                  # 129 tests
npm run typecheck
npm run db:seed
npm run db:migrate
npm run classes:generate  # top up the booking horizon (safe to re-run)
```

## Tests

```
tests/domain/        pure logic — DST, cancellation windows, strikes, scoring
tests/integration/   against a real Postgres — booking, waitlist, strikes,
                     results, permission boundaries
```

Integration tests need a database. Point `TEST_DATABASE_URL` at a scratch one
and apply migrations to it first; they run serially and wipe between tests.

Covered: booking capacity and waitlist promotion (including two people
cancelling at the same instant), all three cancellation rule types at their
exact boundaries, strike accrual and expiry either side of the 30-day mark,
suspension auto-lifting, forgiveness recalculating state, the waitlist-promotion
grace, gym-cancelled classes producing no strikes, permission boundaries for
every role, and DST-boundary scheduling in both directions.

## Deploying

See **[DEPLOY.md](./DEPLOY.md)** for the click-by-click version. In short:

- `DATABASE_URL` is the **pooled** Postgres connection (serverless functions
  open many short-lived connections); `DIRECT_URL` is the **unpooled** one,
  used only for migrations, which need a real session.
- `SESSION_SECRET` is 32+ random characters. Rotating it signs everyone out.
- `npm run build` runs `prisma migrate deploy` before `next build`, so schema
  changes ship with the deploy and a failed migration fails the build.
- `vercel.json` registers a daily job at `/api/cron/generate-classes` to top up
  the booking horizon. Set `CRON_SECRET` and Vercel sends it as a bearer token.
- Set the gym's name and timezone in `gym.config.ts` **before launch** —
  changing the timezone later reinterprets every class time already stored.

First run: the app detects an empty database, redirects to `/setup`, and creates
the owner account plus (optionally) the weekly schedule and benchmark library.
That page disables itself as soon as any user exists.

## Not in v1

Recurring billing, multi-gym support, CRM/leads, waivers, contracts, reporting
beyond attendance counts, and native mobile apps. Notifications are in-app only.
