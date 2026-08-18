# Member migration — plan

Moving B42's existing members onto this app. Written down so it survives
between sessions. **Not built yet.**

The goal is a member spending under a minute: click a link, confirm it's them,
pay, done. Everything else can be collected later or never.

---

## Scope

1. **Bulk create accounts** from a CSV of name and email, so members claim an
   account that already exists rather than signing up from nothing.
2. **Claim flow** — one link, confirm identity, Stripe Checkout, finished. No
   profile form, no waiver, no photo.
3. **Migration dashboard** — who has claimed and paid, who has claimed but not
   paid, who hasn't claimed at all. Sortable and exportable so coaches can
   chase people by name.
4. **Send and resend invites**, individually or in bulk.
5. **Import historical PRs and benchmark scores** per member from CSV, so the
   leaderboard has something in it on day one.

---

## The dependency that isn't in the list

**The app cannot send email.** Notifications are in-app only, deliberately.
Items 2 and 4 both assume email exists.

Adding it means an email provider (Resend, Postmark, SES), verifying the
sending domain with DNS records, and accepting that a brand-new sending domain
mailing 200 people at once has a real chance of landing in spam. That is a
launch-day risk, not a technical footnote: if a third of the invites go to junk,
the migration stalls and the phone starts ringing.

### The way round it

The app **generates claim links** and exports them as a CSV. B42 sends them
through whatever already reaches members — the existing mailing tool, WodBoard
itself while it is still live, or WhatsApp.

- No email infrastructure, no domain warm-up, no deliverability risk.
- Uses a channel members already recognise, which gets opened more than mail
  from an unfamiliar domain.
- Resending is re-sending a link, not rebuilding a queue.

Costs: no automatic "3 members haven't opened their invite" nudges, and the
owner does the sending. At 200 members, once, that seems the better trade.

Worth doing properly later if the app ever needs to email members routinely —
waitlist promotions are the obvious candidate.

---

## Claim flow, in detail

The spec says "magic link", which usually means replacing password sign-in
entirely. For claiming, a **single-use claim token** is smaller and safer:

```
/claim/<token>
  → "You're Jamie Fitzgerald, jamie@example.com. Is that right?"
  → sets a password (one field) OR signs them straight in
  → Stripe Checkout
  → done, landing on this week's schedule
```

- Tokens are single-use and expire (30 days suits a 60-day window).
- A used or expired token explains itself and offers a fresh one, rather than
  showing an error.
- The token signs them in, so there is no chicken-and-egg with passwords.

**Open question:** do members set a password during claiming, or does B42 want
magic-link sign-in permanently? Permanent magic links mean email becomes
load-bearing for every future login, which argues for a password.

---

## Migration dashboard

One page, one table, four states:

| State | Meaning | What the gym does |
| --- | --- | --- |
| Not invited | Account exists, no link sent | Send invite |
| Invited | Link sent, not opened | Chase, resend |
| Claimed, not paid | Signed in, no subscription | Chase — the expensive one |
| Claimed and paid | Done | Nothing |

Sortable by state and name, exportable as CSV, with a count against each state
so progress is visible at a glance. "Claimed but not paid" is the group that
actually costs money, so it should be the default sort.

---

## Historical scores

Lowest value per unit of effort, and the one I would do last or not at all.

- Leaderboards refill within a fortnight of normal use; the whiteboard looks
  alive again almost immediately.
- Benchmark names have to map onto ours. Fran is Fran, but anything custom
  will not line up, and mis-mapped history is worse than none.
- PRs matter emotionally, which is the real argument for doing it.

**Do not build this until we have a real export file from WodBoard.** The
column layout decides the whole importer, and guessing it means writing it
twice.

---

## Order of work

| # | Piece | Effort | Blocked on |
| --- | --- | --- | --- |
| 1 | Bulk CSV account creation | Small | Nothing |
| 2 | Migration dashboard | Small | Nothing |
| 3 | Claim tokens + claim flow | Medium | Password vs magic link |
| 4 | Invite link export | Small | 3 |
| 5 | Historical score import | Medium | A real WodBoard export |

1 and 2 are needed whatever else is decided, so they can start immediately.

---

## Things to decide before building

- Password or permanent magic-link sign-in?
- Are members claiming and paying before or after WodBoard is switched off?
  Running both briefly is kinder but means two systems taking bookings.
- What does a WodBoard export actually contain? Needed for both the member
  list and any score import.

---

## During the migration, remember

Booking is gated on membership. From the day this goes live, anyone without an
active subscription cannot book. During a migration that is exactly the wrong
default, so use the **manual override** on the Members page — mark existing
members active with an expiry a few weeks out and a reason like "migrating from
WodBoard". They keep training while their subscription lands, and the override
expires on its own.

A bulk version of that override is worth adding alongside item 1.
