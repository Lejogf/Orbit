# Orbit — Project Instructions

**Orbit** is a banking app built for a hackathon on top of Capital One's Nessie
API. It began as "Capital One Flow" (a subscription manager) and grew into a
full banking product with its own brand: Orbit, whose assistant is **Ori**.

The thesis has not changed: **most of your money is spoken for before you wake
up**. Orbit's job is to show what is genuinely yours to spend, and then help you
keep more of it — through subscriptions you can stop, rewards that are honestly
priced, a budget that answers "will I be OK?", and investing that starts at $1.

This file is the source of truth. Re-read it at the start of every session and
check PROGRESS to see what is built.

---

## How to work

- Before a large piece of work, show a short plan. Afterwards: summarise what
  was built, say exactly how to run it, and update PROGRESS in this file.
- If something here is impossible, wrong, or unclear, say so instead of
  guessing.
- Never read aloud, print, log, or hardcode the contents of `.env`.
- Pure logic goes in `features/` with unit tests. Database work goes in
  `services/`. Routes stay thin and validate their input with zod.
- Never hardcode a colour in the frontend. `bg-white` does not follow the theme;
  `bg-surface` does. See "The design system" below.
- Do not ship other companies' logos or trademarks. Merchant marks are generated
  locally from brand colours and initials (`MerchantMark` in `components/ui.tsx`).

---

## What Orbit does

### 1. See what's really yours

- **Home** opens with a greeting by time of day, then **available balance**,
  what is already committed before payday, and what is free to spend.
- Quick actions — send, request, deposit, move — then your cards, what is coming
  up, and anything that needs a decision pulled to the top.
- **Spending** groups every purchase by category with a colour-blind-safe donut,
  a six-month trend, weekday habits, and insights that always state the number
  behind the claim.

### 2. Subscriptions and Guard (the original hero feature)

- Recurring charges are detected from transaction history: same merchant,
  similar amount, regular interval, each with a confidence score. Flags price
  increases, trials about to convert, overlapping services and unused ones.
- **Ask me first (Guard)** declines the next charge and raises an alert you can
  approve once. **Block** stops it permanently. **Virtual cards** give each
  merchant its own number. **Reminders** warn you 1–90 days ahead.
- "Simulate renewal" pushes a real charge through the Guard rules so the
  approve/decline flow can be demonstrated live.

### 3. Cards

Five products, each stating only what people compare — what it earns and what it
costs:

| Card           | Fee  | Earns                                             |
| -------------- | ---- | ------------------------------------------------- |
| Orbit Start    | none | 1x everything — building credit from zero         |
| Orbit Move     | none | 1.5x everything, 3x dining                        |
| Orbit Rise     | $95  | 2x everything, 4x groceries and dining, 5x travel |
| Orbit Summit   | $395 | 2x everything, 10x hotels, 5x dining, metal card  |
| Orbit Business | none | 2x everything, 5x software and ads                |

Eligibility is real: gated on the estimated score, blocked by recent missed
payments, and a fee-bearing card that would not pay for itself says so rather
than being recommended anyway. Cards render as physical objects (chip,
contactless mark, material per tier) and can be locked, revealed, or ordered in
plastic.

### 4. Rewards — 100 points = $1

One rule, stated everywhere. Cash and gift cards are exactly 1:1; travel is
1.25x because partners fund it; retail partners are 0.8–0.9x **and the app says
so on the option itself**. Every point earned or spent is a ledger row, so
"where did these come from?" always has an answer. Boosters and "earn more" tips
come from the customer's own spending.

### 5. Pay and get paid

Send, request, pay a bill, or deposit a cheque by photo. Payments can be
scheduled or set to repeat weekly, fortnightly or monthly; a scheduled payment
moves no money until its date. Cheques are held two business days, as at a
branch. A name **and** a reachable contact (10-digit mobile or email) are
required before a Zelle-style request can be sent.

### 6. Pay Over Time

Card purchases of $100+ split into 3, 6, 12 or 24 payments. 3 payments are 0%;
longer terms are priced by credit band. Includes an affordability check against
income and existing obligations, a cap on active plans, a credit-impact preview,
and early payoff that waives interest on months never used.

### 7. Budget — "will I be OK?"

- Averages complete months only, so a half-finished month cannot flatter the
  plan, and reports how volatile spending is.
- Produces a **safe daily number**, monthly surplus, savings **runway**, and an
  emergency target that scales with household size.
- Methods: **50/30/20**, **70/10/10/10**, or **zero-based** envelopes
  pre-filled from three months of real spending so setup takes a minute.
- **Households** share one plan through a passkey — a couple, or a parent and a
  working teenager. Only the hash is stored, so the code cannot be looked up.

### 8. Investing

Fractional stocks, funds and crypto from $1, with cost basis, profit and loss,
and a risk note shown without being asked. **Points can fund an order at the
same 1:1 rate as cash** — the gentlest possible first investment. In-kind
transfer to an outside broker is explained honestly (nothing is sold, so no tax
event). Prices are generated deterministically; the UI says so.

### 9. Travel and offers

Flights and hotels booked in-app: a price forecast that says book or wait, a
rewards optimizer comparing card, miles and mixed payment, automatic price-drop
refunds up to $50, and offers ranked by what they would have earned on last
month's spending.

### 10. Split a bill

Photograph a receipt; OCR runs **on the device** (Tesseract), so the photo never
leaves the phone — only the text is parsed. Items are editable, shared dishes
divide between whoever shared them, and tax and tip follow each person's share.
Rounding never loses or invents a cent. Requests go out Zelle-style, and a
repayment lands in checking as a real deposit.

### 11. Ori — the assistant

No API key, no model: a rule-based engine (`backend/src/features/ori/`).

- Tolerates typos, understands Spanish, handles 30+ intents, and extracts
  amounts, merchants, accounts and pages.
- **Proposes** anything that moves money or changes a card; nothing happens
  without confirmation (and twice, if the customer asked for that).
- **Never loops.** Two misunderstandings, a repeated question, or any sign of
  frustration, and it offers a human — who receives the conversation.
- Closing the panel keeps the conversation; "New chat" clears it deliberately.

### 12. Real people, 24/7

Live chat, a phone call with a **spoken verification code** (so the agent never
re-verifies you), a scheduled callback, or a secure message. Accessibility needs
(ASL, TTY, language, pace) are stated once and travel with the case.

### 13. Accessibility and identity

- Light / dark / system, text to 200%, high contrast, colour-blind-safe mode,
  reading-friendly fonts, Simple mode, read-aloud, 44px targets, strong focus,
  adjustable session timeouts, and a trusted contact. English and Spanish.
- **Address change** verified by one-time code and mirrored to Nessie. **Legal
  name change** with a document upload and a review — a bank cannot accept a new
  legal name on trust, but it should not send you to a branch either.
- Username or email sign-in; documents and a CSV export at tax time.

---

## Tech stack

- Monorepo with `/frontend` and `/backend`.
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind.
- **Backend:** Node.js + Express + TypeScript.
- **Database:** SQLite via Prisma.
- The frontend only talks to our backend. It never calls Nessie directly.
- `npm run dev` from the root runs both. `npm test` runs both suites.

### Environment variables

- `.env` lives in the project ROOT (not `/backend`); the backend loads it from
  there explicitly.
- Variables: `NESSIE_API_KEY`, `NESSIE_BASE_URL`, `USE_MOCK_DATA`.
- Keep `.env.example` to placeholders only. `.env` and `*.db` stay gitignored.
- **No AI API key is needed.** Ori and receipt OCR run without one by design.

### Seed script

Creates the demo customer (Jordan Rivera) in Nessie and locally: checking,
savings and an Orbit Move card, six months of transactions including paychecks,
~10 recurring merchants (one price increase, one trial converting in two days,
two overlapping streaming services, one unused), and several $100+ purchases
eligible for Pay Over Time. Safe to re-run.

Demo sign-in: username `jordan`, password `flow-demo-2026`.

---

## Design

- **Orbit is not Capital One.** Its own name, mark, palette and type. Never
  reintroduce Capital One branding, and never call the assistant Eno.
- Confident and modern, aimed at 18–50: neither childish nor stuffy. Ink-black
  primary actions, brand green reserved for money coming in, glass only on
  chrome that floats over content.
- Mobile-first and genuinely responsive: 4–6 bottom tabs depending on the
  handset's width, a draggable More sheet, and a sidebar that collapses to an
  icon rail without losing a single destination.
- Friendly empty states, loading skeletons, and error states that say what went
  wrong and what to do next — never "try again later".

---

## Demo flow (optimise the app for this)

1. **Sign in** → Home greets you by name with available balance, free-to-spend,
   and an alert: a free trial converts in two days.
2. **Ask Ori** "how much can I spend?", then "block Netflix" — it proposes,
   you confirm, and the numbers move.
3. **Subscriptions** → spot the two overlapping streaming services, block one →
   Money Saved updates.
4. **Cards** → see the line-up, and why Rise is or isn't worth its fee for you.
5. **Rewards** → 100 points = $1, and the partner option that is honestly worse.
6. **Budget** → "will I be OK?" answered in one sentence, then zero-based
   envelopes filled from real history in one tap.
7. **Invest** → put points into a fund, at the same rate as cash.
8. **Tell Ori "this is useless"** → it stops guessing and hands you to a human
   who already has the transcript.
9. **Accessibility** → dark mode, 150% text, Simple mode, Español — the whole
   app follows.

---

## Build phases (history)

Phases 1–6 built the original Flow: setup and Nessie integration, the banking
shell, subscriptions and Guard, Pay Over Time, Safe to Spend, then polish.
Phases 7–12 became Orbit: rebrand and design system, Ori, live support and
accessibility, identity and payments, cards/rewards/investing/budgeting, and
travel/split/spending. See PROGRESS for detail.

---

## PROGRESS

_Update this after every phase: what's done, what's left, known issues._

- [x] **Phase 1** — setup, schema, Nessie client + mock fallback, endpoint
      verification, seed script.
- [x] **Phase 2** — core banking shell: mocked login, dashboard, accounts,
      account detail with searchable/filterable transactions, card lock/unlock
      and show/hide number, transfers. Responsive sidebar/bottom-tab layout.
- [x] **Phase 3** — subscription detection, Subscriptions page with totals and
      filters, Guard (ask-first / block), virtual cards, reminders, alert inbox,
      Simulate renewal demo mode, Money Saved tracker.
- [x] **Phase 4** — Pay Over Time: pricing module, plan picker with side-by-side
      comparison, affordability check, credit impact preview, My Plans with
      progress and early payoff.
- [x] **Phase 5** — Safe to Spend, upcoming-payments timeline, cross-feature
      updates (blocking a subscription moves Safe to Spend immediately).
- [x] **Phase 6** — polish: animations, loading skeletons, empty and error
      states, mobile verified at 375px, README with architecture and demo script.
- [x] **Phase 7 — Orbit rebrand and design system.** No longer skinned as
      Capital One: this is **Orbit**, with its own name, mark, palette and type.
      Every colour is a CSS variable, so light, dark and high contrast swap
      tokens rather than markup. The assistant is **Ori** (Eno is Capital One's
      trademark), using the supplied star mark with one rotation on open.
- [x] **Phase 8 — Ori.** A rule-based assistant: no API key, no model. Handles
      typos, Spanish, 30+ intents, extracts amounts and merchants, proposes money
      actions but never performs them unasked, and hands off to a human after two
      misses or any sign of frustration.
- [x] **Phase 9 — live support, accessibility, alerts.** 24/7 chat, a call with
      a spoken verification code, scheduled callbacks, secure messages. Full
      accessibility panel (WCAG 2.2 AA target) and English/Spanish throughout.
      Charge alerts write to the inbox first, then attempt Web Push, recording
      whether delivery succeeded.
- [x] **Phase 10 — identity and money movement.** Verified address change
      (one-time code, mirrored to Nessie), legal name change with a document and
      review, username sign-in, trusted contact. Pay: send, request, bills,
      scheduling, recurring payments, and cheque deposit by photo.
- [x] **Phase 11 — cards, rewards, investing, budgeting.** Five card products
      with real eligibility rules; a points ledger where 100 points = $1, with
      honest redemption multipliers; fractional investing in stocks, funds and
      crypto (points can fund an order); budgeting with 50/30/20, 70/10/10/10 and
      pre-filled zero-based envelopes; household sharing by passkey; and a
      forecast that answers "will I be OK?".
- [x] **Phase 12 — travel, split, spending.** In-app flights and hotels with a
      price forecast, rewards optimizer and automatic price-drop refunds; receipt
      splitting with on-device OCR and Zelle-style requests; spending insights
      with a validated colour-blind-safe category chart.

### Where things live

```
backend/src/features/        pure logic, unit tested, no database
  detection · guard · pricing · safeToSpend · creditScore
  cards · rewards · budget · investing · spending · receipt
  travel · profileChange · support
  ori/  nlu.ts (intents, typos, Spanish) · respond.ts · pages.ts
backend/src/services/        that logic joined to the database
  subscriptions · plans · dashboard · credit · money · insights
  cards · rewards · investing · budget · payments · travel
  split · profile · support · notify (alerts + Web Push) · auth
backend/src/data/            provider, demo dataset, Nessie sync
backend/src/routes/          index · auth · banking · subscriptions · plans
                             credit · assist (Ori, support, alerts)
                             lifestyle (spending, travel, split)
                             money (cards, rewards, invest, budget, pay)
                             profile (identity, accessibility)
frontend/src/app/(app)/      the signed-in screens
frontend/src/lib/            api client · accessibility · i18n · uiState
frontend/src/components/     ui kit · brand · PaymentCard · CategoryDonut
                             Nav · QuickDisplay · Tour · IdleGuard
                             PushSetup · ori/ · settings/
```

358 tests (338 backend, 20 frontend): `npm test`.

Key data models beyond the original set: `CardProduct`, `PointsEntry`,
`Holding`, `Trade`, `Budget`/`BudgetEnvelope`, `Household`/`HouseholdMember`,
`Payee`/`ScheduledPayment`, `CheckDeposit`, `TravelBooking`, `BillSplit`,
`ProfileChangeRequest`, `SupportCase`, `PushSubscription`.

### The design system

`frontend/tailwind.config.ts` maps every colour to a CSS variable defined in
`globals.css`. Light and dark are two sets of the same variable names, so a
component never needs a dark-mode variant, and high contrast sharpens whichever
theme is active. Type is Plus Jakarta Sans for display, Inter for text, JetBrains
Mono for card numbers. Never hardcode a colour — `bg-white` does not follow the
theme; `bg-surface` does.

### Brand

**Orbit** — money that moves with you. The assistant is **Ori**. The supplied
`AI Agent.png` is Ori's avatar (`frontend/public/ori.png`); the Orbit mark is
drawn in `components/brand.tsx` so it inherits theme colours.

### Points

100 points = $1, everywhere, with no exceptions worth hiding. Cash and gift cards
are exactly 1:1; travel is 1.25x because partners fund it; retail partners are
0.8–0.9x and the app says so on the card itself rather than burying it.

### Post-review fixes

- `GET /accounts` was dropping `isLocked` and `rewardsCents`, so card lock looked
  broken even though the endpoint worked. Mapper fixed; sync now persists rewards.
- Virtual card "Regenerate" returned the same number, because the generator was
  seeded on the subscription id alone. Seed now includes a timestamp.
- Deleting a virtual card left a dead row in the UI and the subscription stuck as
  cancelled. Delete now removes the row; issuing a new card revives the
  subscription.
- Added "Use my real card" to stop using a virtual number without cancelling.
- Notifications are now toasts that auto-dismiss (5s info/success, 8s
  warning/error) with a draining progress bar, pause on hover, and a close button.
- Back navigation on every screen, using real history with an href fallback.
- "Test charge" on each subscription row, so Simulate renewal is reachable
  without opening the detail page first.
- Custom reminder intervals (1–90 days) and delivery channels.
- "What this costs you": already paid, next 12 months, 5 years.
- Retinted to the Capital One navy/red palette (later replaced entirely by the
  Orbit palette in phase 7).

### Second round of fixes

- Toasts collapse duplicates into one with a count, and cap at 3 on screen.
- Charge alerts dedupe: a retrying merchant bumps `Alert.occurrences` instead of
  creating another identical row.
- Card lock now documented and modelled correctly — it does NOT stop recurring
  charges, which is real issuer behaviour and the reason Guard exists.
- Instalment payments post a real transaction and reduce the card balance.
- Back control removed from top-level sections; on detail pages it follows a
  `?from=` origin hint so it returns where you came from.
- `lib/sectionMemory.ts`: each nav section remembers its last position
  (sessionStorage), expiring 30s after you leave it. Tapping the active section
  resets it to the root. Storage key is versioned and every entry is shape-checked
  on read — an earlier build stored bare path strings, and reading `.path` off
  those produced undefined navigation targets.
- Frontend now has its own test suite (`npm run test -w frontend`), 20 tests
  covering the TTL boundaries and malformed storage.

### Accounts, settings and auth

- Real registration / sign-in / sign-out. scrypt password hashing with a per-user
  salt, opaque session tokens in an httpOnly cookie, constant-time comparison.
- Every API route is scoped to the signed-in customer; ids belonging to someone
  else read as 404 rather than confirming they exist.
- New accounts start empty and are offered their own copy of the sample data.
- Settings separates editable fields from identity fields that a bank cannot let
  you change self-service (legal name, DOB, SSN), shown locked with the reason.
- Account closure checks balances, active plans and live subscriptions, requires
  the password plus a typed confirmation, and retains the record.
- Virtual card deletion no longer cancels the subscription implicitly — it asks
  whether to cancel or move billing to the real card.

### What is simulated, and why

Everything that touches the customer's own money is real logic over real stored
data. These are the edges where no real service exists behind the demo — each is
stated in the UI rather than hidden:

- **Market prices** are generated deterministically per symbol and date, so a
  chart looks like a market and the same day always shows the same price.
- **Flights and hotels** are generated from the route and date; there is no
  travel inventory. Pricing, earning, credits and refunds are real arithmetic.
- **Live agents** are scripted per topic. Routing, wait estimates, verification
  codes, accessibility needs and transcript carry-over are the real design.
- **One-time codes** are returned by the API (and labelled as a demo) because
  there is no SMS gateway. A real deployment sends and never returns them.
- **Documents** (cheque photos, name-change files) are not retained — only the
  file name, type and size.
- **"Looks unused"** and **free-trial conversion prices** come from seeded
  merchant fields; Nessie exposes neither.

### Known issues

- Nessie holds more transactions than the mirror: early seed runs duplicated
  records before the idempotency signature was fixed, and Nessie has no DELETE
  for purchases. Harmless — the app reads the local mirror. For a clean Nessie
  account, change the demo customer name in
  `backend/src/data/nessieProvider.ts` and re-seed.
- The 21st.dev logo MCP returns no results for any query (the upstream svgl
  library appears to be down), so merchant marks are generated locally.
- Accounts, Subscriptions, Plans and Support follow the new theme correctly but
  have not had the full layout redesign that Home, Cards, Pay, Invest, Rewards
  and Budget received.
- There is no business-specific dashboard yet; the Business _card_ exists and
  Cards filters by personal/business.

---

## NESSIE FINDINGS

Verified against the live API, and against the official reference in
`Nessi API docs/nessie-api.md`. Re-runnable with `npm run verify:nessie`.

### Where the published docs are wrong

| Docs say                          | Actually                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| POST returns a **message string** | Returns `{code, message, objectCreated}` **including `_id`** — no list re-fetch needed |
| IDs are **24 characters**         | 36-character UUIDs                                                                     |
| Purchases use `transaction_date`  | Uses **`purchase_date`**; `transaction_date` is rejected                               |

### Confirmed correct

- **Amounts are integers** for accounts, purchases, deposits, withdrawals,
  transfers and loans. `15.49` stores as `15`, `0.99` as `0`. **Bills are the
  exception** — `payment_amount` is a float and keeps exact cents.
- **By-id paths are inconsistent:** `/purchase/{id}` and `/withdrawal/{id}` are
  SINGULAR; `/deposits/{id}` and `/transfers/{id}` are plural. The wrong spelling
  returns 403, not 404.
- **`PUT /accounts/{id}` only accepts `nickname`.** Anything else is a 400.
- **Balances never move on their own.** Posting purchases, deposits and
  withdrawals leaves `balance` untouched, so we compute balances ourselves.
- **`PUT /bills/{id}`** accepts partial updates, returns 202, and never breaks
  readability — which is what makes the Guard status flow safe.
- Merchant `category` may be a string or an array; the provider normalises both.

### The bill serialization trap

A bill needs **`nickname` + `payment_date` + `recurring_date`** to be readable.
Omit any one and `GET /accounts/{id}/bills` returns **400 for that entire account,
permanently** — one malformed bill poisons the whole collection.
`upcoming_payment_date` is rejected on create but computed server-side.

`NessieBillCreate` makes all three mandatory so this cannot happen.

### Transfers can't record a destination

`POST /accounts/{id}/transfers` accepts only
`{transaction_date, status, amount, description}` — it rejects `payee_id`,
`medium` and `type`. Both legs of an internal transfer are therefore written
locally. GET returns `id` while POST returns `_id`; read it via `transferId()`.

### Other notes

- Empty collections return 404 rather than `[]`; the client treats a 404 on a
  list as empty.
- `DELETE` works for bills, loans, purchases and accounts. Not for customers.
- `/merchants` is global and shared across every API key, so the provider narrows
  it to merchants this customer actually transacted with.
- There is no transactions endpoint — statements merge purchases, deposits,
  withdrawals and transfers per account.
- Loans have **no term field**, so the schedule stays in our database.
  `credit_score` is required on create.

## HOW NESSIE IS USED

**Subscriptions are real Nessie bills.** Each detected subscription is mirrored
via `POST /accounts/{id}/bills`, and its status tracks the Guard state:

| Flow                          | Nessie bill status                                           |
| ----------------------------- | ------------------------------------------------------------ |
| Active                        | `recurring`                                                  |
| Guarded ("ask me first")      | `pending` — the obligation exists but isn't scheduled to pay |
| Blocked / cancelled           | `cancelled`                                                  |
| Virtual card deleted + cancel | `DELETE /bills/{id}`                                         |

Price changes push a new `payment_amount`. Because bills are floats, exact cents
survive the round trip.

**Pay Over Time plans are real Nessie loans.** `POST /accounts/{id}/loans` with
`credit_score`, `monthly_payment` and `amount`; `PUT /loans/{id}` marks it
`completed` on payoff. Term and schedule stay local.

**Travel bookings are real Nessie purchases.** `POST /accounts/{id}/purchases`
against the card, with the airline or hotel created as a Nessie merchant if it
does not exist yet. A booking paid with miles posts a **second purchase with
`medium: 'rewards'`** — the one place Nessie models rewards spending directly,
and a good fit for how points actually work here.

**A verified address change is mirrored to the customer.** `PUT /customers/{id}`
accepts `address` (and names), so a confirmed move — and an approved legal name
change — updates the Nessie record, not just ours.

**Amounts:** the mirror is authoritative because Nessie truncates to whole
dollars everywhere except bills. This is documented API behaviour, not a bug.
Conversion happens only in the Nessie client layer.

**Every upstream write is best-effort.** A Nessie failure logs and continues; it
never blocks a user action. `USE_MOCK_DATA=true` or an unreachable API falls back
to local mock data, verified after every change.

## CREDIT SCORE

`features/creditScore.ts` estimates a score from the five published FICO factors
using data the app actually holds: payment history from instalment records,
utilisation from card balance and limit, history length, account mix and recently
opened lines. Pure functions, 26 unit tests.

It is an **estimate, not a FICO® score** — real scores include accounts at other
lenders, credit checks and public records we cannot see. The UI says exactly
that ("a FICO-model estimate"), and offers to show a connected bureau score
beside it rather than replacing it. Never label this as a FICO score: that name
is licensed through the bureaus, and claiming it would be both wrong and a
trademark problem.

The estimate drives Pay Over Time pricing through `bandForScore()`, so paying
down the card or stopping subscriptions actually changes the APR offered. The
`/credit` page lets the user stack what-if scenarios and watch the score move.

### Nessie housekeeping

- `ZZ_AUDIT` and `ZZ_FLOW_PROBE` records upstream are left over from endpoint
  verification, and are ignored by the app.
- Bills accumulated across seeds before re-adoption was added;
  `mirrorBillToNessie` now adopts an existing bill by payee rather than creating
  a duplicate.

(General known issues are listed under PROGRESS, above.)
