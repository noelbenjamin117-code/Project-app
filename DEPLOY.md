# Deploying — from a phone or Chromebook

No terminal needed. Everything here happens in a browser, and the app sets
itself up through its own web page at the end.

Budget about 20 minutes. Both services are free at this size.

---

## Step 1 — Create the database (Neon)

1. Go to **neon.com** and click **Sign up**. Choose **Continue with GitHub** —
   it's the fastest and you already have a GitHub account.
2. It asks you to create a project. Set:
   - **Project name**: `gym`
   - **Postgres version**: leave the default
   - **Region**: pick the one closest to your gym
3. Click **Create project**.
4. You land on a page with a **Connection string** box. You need **two**
   versions of this string, and the difference matters.
   - Above the string there's a **Connection pooling** toggle (on some layouts
     it's a dropdown labelled *Pooled connection*).
   - **Toggle it ON.** Copy the string. This is your **DATABASE_URL**. It has
     `-pooler` in the middle of the host name.
   - **Toggle it OFF.** Copy that string too. This is your **DIRECT_URL**. Same
     string, no `-pooler`.
5. Paste both somewhere you can get at them in a minute — an email draft to
   yourself, or a note. They contain your database password, so don't post them
   anywhere public.

> **Why two?** The app runs as lots of tiny short-lived serverless functions, so
> it connects through a pooler. Database migrations can't run through a pooler —
> they need a real session — so those use the direct one.

---

## Step 2 — Deploy the app (Vercel)

1. Go to **vercel.com** and click **Sign up** → **Continue with GitHub**.
2. On your dashboard click **Add New…** → **Project**.
3. You'll see a list of your GitHub repositories. Find **Project-app** and click
   **Import**.
   - If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel
     access to that repository, then come back.
4. **Before clicking Deploy**, expand **Environment Variables** and add these
   three. Add each one, then click **Add** before typing the next.

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the **pooled** string from Neon (the one with `-pooler`) |
   | `DIRECT_URL` | the **direct** string from Neon (no `-pooler`) |
   | `SESSION_SECRET` | a long random string — see below |

   For `SESSION_SECRET`, any 32+ random characters will do. If you don't have a
   way to generate one, mash the keyboard for a while — it only has to be long
   and unpredictable, and you never type it again.

5. Under **Branch**, make sure it says `claude/gym-management-mvp-nzyav7`.
   If Vercel defaults to `main`, change it — the app only exists on that branch
   until you merge it.
6. Click **Deploy**. It takes 2–4 minutes. The build also creates all the
   database tables for you, so there's nothing to run by hand.

If the build fails, open the log and look at the last red lines. The usual cause
is a connection string pasted with a missing character, or the pooled and direct
ones swapped.

---

## Step 3 — Set up your gym

1. When the deploy finishes, click **Continue to Dashboard**, then **Visit**.
   You'll get a URL like `project-app-xxxx.vercel.app`.
2. The app sees an empty database and takes you straight to a **Set up your
   gym** page.
3. Fill in your name, email and a password. Leave both checkboxes ticked so you
   get:
   - your weekly schedule — all 25 classes, with each one's cancellation rule
     already set: BLITZ42 on Monday, ATHELERIX42 plus Run Club on Tuesday,
     HYROX and CALIBRATE42 on Wednesday, BUILD42 on Thursday, HYROX on Friday,
     and the Sunday HYROX drop-in. No Saturday classes.
   - the ten benchmark WODs and the barbell lifts for PR tracking
4. Click **Create my gym**. You're signed in as the owner.

That page closes itself off permanently the moment your account exists, so
nobody else can use it.

---

## Step 4 — Set your gym's name and timezone

The app ships with a placeholder name and the `America/New_York` timezone. Fix
that now, before anyone books anything — **changing the timezone later would
reinterpret every class time already saved.**

1. On GitHub, open the repo and switch to the branch
   `claude/gym-management-mvp-nzyav7`.
2. Open **`gym.config.ts`** and click the **pencil** icon to edit it.
3. Change the first three lines:
   ```ts
   name: 'Your Gym Name',
   shortName: 'Yourgym',
   timezone: 'Europe/London',
   ```
   Use a timezone from the "TZ identifier" column of Wikipedia's
   *List of tz database time zones* — e.g. `Europe/London`,
   `America/Chicago`, `Australia/Sydney`.
4. Click **Commit changes**.

Vercel redeploys automatically in a couple of minutes.

---

## Step 5 — Add your people

In the app, go to **Members** → **Add someone**.

For each person, enter their name and email, pick a role, and the app suggests a
starting password like `thruster-4821`. Text or email that to them along with
the site link. They change it themselves under **Account** → **Change my
password**.

- **Member** — books classes, logs scores
- **Coach** — also runs rosters, programmes WODs, edits the schedule, forgives
  strikes
- **Owner** — also adds people and lifts suspensions

Add your coaches first, then work through your members. If someone forgets their
password, open them from Members and click **Reset password**.

---

## Step 6 — The gym TV

On whatever device drives the screen, open a browser to:

```
https://your-app.vercel.app/whiteboard
```

Put it full screen. There's no login and no interaction — it refreshes itself
every 30 seconds, reloads itself when the date rolls over, and is built to be
left running for weeks.

---

## Things worth knowing

**Your first day will look empty.** The board only fills in once a coach has
programmed a WOD (**Programming** → pick a date → **Put it on the board**) and
people have logged scores.

**Classes are generated automatically** eight weeks ahead, topped up every time
anyone opens the schedule and once a day by a scheduled job. You don't have to
do anything.

**Notifications are in-app only.** When someone comes off the waitlist they see
it next time they open the app — there's no email or text yet.

**Free tier limits.** Neon's free database sleeps after inactivity, so the very
first page load after a quiet night can take a few seconds. Vercel's free plan
runs one scheduled job a day, which is all this needs. Neither will cost you
anything at 200 members.

**A custom domain** (like `app.yourgym.com`) is free to add: Vercel → your
project → **Settings** → **Domains**.

---

## If something goes wrong

- **"Set up your gym" won't load, or you see a database error** — your
  connection strings are probably wrong. Vercel → **Settings** → **Environment
  Variables**, fix them, then **Deployments** → the top one → **⋯** →
  **Redeploy**.
- **You're locked out entirely** — in Neon, open the **SQL Editor** and run
  `DELETE FROM "User";` then reload the app. It will offer setup again. This
  wipes everyone, so it's only sensible on day one.
- **You want the demo gym back** (40 fake members, a full leaderboard) — that
  needs a terminal, so it's a job for someone with a laptop.

---

# Memberships with Stripe

Optional — the app runs fine without it, and membership features stay hidden
until it's configured. When it is set up, Stripe is the source of truth: the
app mirrors what Stripe says and never asks you to type a renewal date.

**Booking is gated on membership; logging in never is.** A member whose
payment fails keeps their account, keeps the classes they already booked, and
gets three days' grace to fix their card before new bookings pause. You can
also mark anybody active by hand — cash at the desk, a comped month — with a
reason that's kept on the record.

## 1. Your own Stripe account

Before anything else, check the Stripe account is genuinely yours: log in at
**stripe.com** directly, not through another gym platform. If your customers
and subscriptions are there, they can move with you. If your old platform owns
the account, your members will have to subscribe again — that's a churn event
worth planning, not a technical detail.

## 2. Create your membership tiers in Stripe

Stripe → **Product catalogue** → **Add product**. One product per tier, each
with a **recurring** price (monthly or whatever you sell).

The app reads your live prices straight from Stripe, so there's nothing to
redeploy. Add a tier, change a price, archive an old one — the app follows.

**One thing to set on each price.** A tier that only buys *some* classes needs
to say which. On the price, open **Additional options → Metadata** and add:

| Key | Value | Meaning |
| --- | --- | --- |
| `b42_plan` | `UNLIMITED` | Train whenever |
| `b42_plan` | `TIER1` | 3 classes a week |
| `b42_plan` | `TIER2` | 2 classes a week |
| `b42_plan` | `HYROX_WF` | HYROX on Wednesday and Friday only |
| `b42_plan` | `OFF_PEAK` | 9:30am Mon, Tue, Thu, Fri, plus Thursday 4:30pm |

What each of those actually allows lives in `gym.config.ts` under
`membership.plans` — change the weekly number or the times there, not in
Stripe.

If you forget the metadata, or type a value that isn't in the list, that
member is treated as **unlimited**. That's deliberate: a missing tag is our
mistake, and locking a paying member out of the gym is a worse outcome than
not enforcing a limit.

## 2b. Class passes (blocks of classes)

Same place: **Add product**, but give it a **one-off** price rather than a
recurring one. Then set the metadata:

| Key | Value |
| --- | --- |
| `b42_pack_passes` | how many classes the block is worth, e.g. `10` |
| `b42_pack_days` | how long it lasts, e.g. `90` (optional — defaults to 90) |

Sell as many sizes as you like; they all appear on the member's Membership
page. The rules, once bought:

- A pass covers any class **except Sunday**, which is pay-as-you-go for
  everyone.
- Membership is always spent first, so nobody burns a bought pass on a class
  their plan already covers.
- Cancel in time and the pass comes back. Cancel late, or don't turn up, and
  it's gone — the spot was held for them.
- Waitlisting costs nothing; the pass is only spent when they get a spot.

## 2c. The Sunday session

Sunday HYROX is marked **pay-as-you-go** in the schedule, which means: anyone
can book it, member or not; it doesn't touch a weekly limit; it never spends a
pass; and the roster gains a **paid / not paid** tick so whoever runs the class
can see who's settled up on the door.

Any class can be made pay-as-you-go — **Schedule → Edit** on the class, then
tick *Pay-as-you-go*.

## 3. Add the keys to Vercel

Stripe → **Developers** → **API keys**. Copy the **secret key**.

Vercel → Settings → Environment Variables:

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` while you're testing, `sk_live_…` when real |

Tick Production, Preview and Development.

## 4. Point Stripe at the webhook

This is what keeps memberships current without you touching anything.

Stripe → **Developers** → **Webhooks** → **Add endpoint**.

- **Endpoint URL**: `https://your-app.vercel.app/api/stripe/webhook`
- **Events**: `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `checkout.session.completed`,
  `invoice.paid`, `invoice.payment_failed`

Stripe then shows a **signing secret** starting `whsec_…`. Add it to Vercel as
`STRIPE_WEBHOOK_SECRET`, then redeploy.

Without that secret the endpoint refuses every request — which is the point.
It's the only thing stopping someone who finds the URL from marking themselves
paid up.

## 5. Test it before going live

Use your test keys and Stripe's card `4242 4242 4242 4242`, any future expiry,
any CVC. Sign in as a member, go to **Account → Membership**, choose a plan,
and pay. Within a second or two the same page should show the plan as active,
and the member should appear as active on your Members page.

Then swap the test keys for live ones and add a second webhook endpoint in
live mode.

## What members and you each see

**Members** get Account → Membership: their plan, what they pay, when it
renews, and a button into Stripe's own portal to change a card, download
invoices or cancel. Card details never touch this app.

**You** get a status against every name on the Members page, and a membership
panel on each member with their plan and renewal date. Changes are made in
Stripe and appear here on their own; there's a **Re-check with Stripe** button
if you've just changed something and don't want to wait.
