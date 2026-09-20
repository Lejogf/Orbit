# Capital One Flow — Project Instructions

You are building a hackathon project called **Capital One Flow**: a redesigned
Capital One banking web app that helps users see and control money that's
already committed (subscriptions and installment payments).

This file is the source of truth for the project. Re-read it at the start of
every session and check the PROGRESS section at the bottom to see what's done.

---

## How to work

- Build in the phases listed under BUILD PHASES. Do one phase at a time.
- Before starting a phase, show me a short plan. After finishing a phase:
  stop, summarize what you built, tell me exactly how to run it, and wait for
  my go-ahead before continuing.
- After each phase, update the PROGRESS section at the bottom of this file.
- If something in this spec is impossible or unclear, tell me instead of
  guessing.
- Never read aloud, print, log, or hardcode the contents of `.env`.

---

## Priorities (in order)

1. **Subscription Manager + Subscription Guard** — the HERO feature. Most
   effort and polish go here.
2. **Pay Over Time** (card installment plans) — strong, working, polished,
   but secondary.
3. **Safe to Spend + upcoming payments timeline** — ties both features
   together.
4. **Core banking shell** — simple, clean, familiar. Don't over-build it.

---

## 1. Core banking shell (keep simple)

Should feel like the real Capital One app, with these screens only:

- Mocked login (one demo user, no real auth needed)
- Home dashboard
- Account list with balances
- Account detail with searchable/filterable transaction history
- Card details: lock/unlock card, show/hide card number, rewards balance
- Simple transfer between the user's own accounts

Match Capital One's real navigation patterns so it feels familiar.

---

## 2. HERO feature: Subscription Manager + Guard

**Detection (server-side, own module with unit tests):**

- Auto-detect recurring charges from transaction history: same merchant,
  similar amount (within a tolerance), regular interval (weekly, monthly,
  yearly). Give each a confidence score.
- Detect: price increases, free trials converting soon, duplicate or
  overlapping services in the same category, and subscriptions that look
  unused.

**Subscriptions page:**

- List of all subscriptions: logo/initial, amount, frequency, next charge
  date, category, status (Active / Guarded / Blocked).
- Totals: monthly and yearly cost.
- Filters by category and status.
- "Money saved" tracker: annual savings from blocked/canceled subscriptions.

**Actions per subscription:**

- **"Ask me first" (Subscription Guard):** future charges from this merchant
  are declined, and the user gets an in-app alert: "Netflix tried to charge
  $15.49 — Approve / Keep blocked." Approving allows the merchant's next
  attempt only.
- **"Block permanently":** card-level merchant block.
- **"Replace with virtual card":** generate a per-merchant virtual card
  number that can be locked or deleted (deleting it effectively cancels the
  subscription).
- **"Remind me before renewal"** (1, 3, or 7 days before).
- Link to the merchant's cancellation page.

**Demo mode:**

- A "Simulate renewal" button that sends a fake incoming charge through the
  Guard logic, so the approve/decline alert can be shown live.
- A notification center/inbox for all alerts.

---

## 3. Secondary feature: Pay Over Time

- Eligible card purchases of $100+ can be split into 3, 6, 12, or 24 monthly
  payments. Show a "Split this purchase" option on eligible transactions.
- **Pricing (server-side, configurable in one file, with unit tests):**
  - 3 payments: 0% (merchant-funded promo)
  - 6 / 12 / 24 payments: tiered fixed monthly fee or APR
  - Rate and eligibility depend on credit score band and on-time payment
    history
- **Plan picker UI:** buttons or slider for number of payments. Live display
  of monthly payment, total cost, total interest/fees, and payoff date.
  Compare plans side by side.
- **Responsible lending:**
  - Affordability check against income and existing obligations
  - Cap on total active plans / total financed amount
  - Clear warning if a plan would stretch the user's budget
- **Credit impact preview:** change in monthly obligations and utilization.
- **"My plans" page:** active plans, progress bars, next payment, pay off
  early.

---

## 4. Tying it together

- Dashboard hero number: **Safe to Spend** = available balance minus
  upcoming subscription charges and installment payments before the next
  payday.
- Upcoming payments timeline combining subscriptions and installments.
- When a user blocks a subscription or creates a plan, Safe to Spend updates
  immediately.

---

## Tech stack

- Monorepo with `/frontend` and `/backend` folders.
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS.
- **Backend:** Node.js + Express + TypeScript.
- **Database:** SQLite via Prisma (easy local setup).
- The frontend only talks to our backend. It never calls Nessie directly.

### Environment variables

- A `.env` file already exists in the project ROOT (not inside /backend). The
  backend must load it from the root (e.g. dotenv with an explicit path).
- Variables: `NESSIE_API_KEY`, `NESSIE_BASE_URL`, `USE_MOCK_DATA`.
- Keep `.env.example` updated with placeholder values only.
- Make sure `.env` and `*.db` stay in `.gitignore`.

### Capital One Nessie API

- Base URL: `https://api.nessieisreal.com` (read from `NESSIE_BASE_URL`).
- Auth: API key passed as the `key` query parameter, read from
  `NESSIE_API_KEY`. Never hardcode it, log it, or send it to the frontend.
- Endpoints starting with `/enterprise` are read-only analyst endpoints. Use
  the customer endpoints (no `/enterprise` prefix) for our demo customer.

**Endpoints:** The API likely follows the classic Nessie structure below.
Verify each one with a real test request before relying on it, and report to
me what actually exists and its exact field names:

```
GET/POST  /customers
GET/POST  /customers/{id}/accounts
GET/PUT   /accounts/{id}
GET/POST  /accounts/{id}/purchases      (card purchases, with merchant_id)
GET/POST  /merchants
GET/POST  /accounts/{id}/deposits
GET/POST  /accounts/{id}/withdrawals
GET/POST  /accounts/{id}/transfers
GET/POST  /accounts/{id}/bills          (possibly has a recurring_date field)
GET/POST  /accounts/{id}/loans          (possibly has a credit_score field)
```

There may be no single "transactions" endpoint. Build transaction history by
merging purchases, deposits, withdrawals, and transfers.

**How to use Nessie for our features:**

- Transaction history = merged purchases + deposits + withdrawals +
  transfers, joined with merchant data.
- Subscriptions: detect them from recurring purchases. When a subscription is
  confirmed, also create a matching Nessie bill (recurring, with amount and
  next date) so the obligation lives in Nessie. Guard rules, virtual cards,
  and alerts stay in our own database.
- Pay Over Time: when the user confirms a plan, create a Nessie loan (amount,
  monthly payment, description). If loans have a credit score field, use it
  for pricing and eligibility. Our database stores the payment schedule and
  progress.
- Safe to Spend = account balance minus upcoming Nessie bills and loan
  payments before the next payday.
- If bills or loans don't exist or don't work as expected, fall back to
  storing them only in our database, and tell me.

**Our own database stores:** Subscription, SubscriptionGuardRule,
VirtualCard, InstallmentPlan, Alert, Reminder — linked to Nessie IDs.

**Fallback:** if Nessie is unreachable, the backend must switch to local
mock data automatically so the demo never breaks. `USE_MOCK_DATA=true` forces
mock mode.

### Seed script

- Creates a demo customer in Nessie (and matching local mock data) with a
  checking account, a savings account, a credit card, and ~6 months of
  realistic transactions, including regular paychecks.
- Include ~10 recurring merchants: one with a recent price increase, one free
  trial converting in 2 days, two overlapping streaming services, one unused
  subscription, plus normal ones (gym, cloud storage, music, etc.).
- Include a few $100+ purchases eligible for Pay Over Time.
- Must be safe to re-run (don't create duplicates endlessly).

### Code quality

- Detection logic and pricing logic live in their own modules with unit
  tests.
- Clear API routes, input validation, consistent error handling.
- Readable code with brief comments on non-obvious logic.
- One command to run everything locally if possible (e.g. `npm run dev` from
  root).

---

## Design

- Clean, minimal, trustworthy. Lots of white space, deep navy plus one accent
  color, clear typography, accessible contrast, subtle animations.
- Mobile-first and fully responsive (375px phones to large desktops). Bottom
  tab bar on mobile, sidebar on desktop. Layouts must adapt to the user's
  screen size.
- Friendly empty states, loading skeletons, and error states.
- Do not copy Capital One's logo or trademarks. Use a simple text wordmark
  for "Flow."

---

## Demo flow (optimize the app for this)

1. Log in → dashboard shows Safe to Spend and an alert: "Free trial converts
   in 2 days."
2. Tap alert → turn on Subscription Guard → Simulate renewal → charge is
   declined → approve/decline alert appears.
3. Subscriptions page: spot the duplicate streaming services, block one →
   Money Saved updates.
4. Open a $600 purchase → Split into 6 payments → compare plans → see
   affordability + credit impact → confirm.
5. Back to dashboard → Safe to Spend and timeline updated.

---

## Build phases

- **Phase 1:** Project setup, database schema, Nessie client + mock
  fallback, verify Nessie endpoints and report findings, seed script.
- **Phase 2:** Core banking shell (all screens, responsive layout).
- **Phase 3:** Subscription detection, Subscriptions page, Guard, virtual
  cards, alerts, demo mode.
- **Phase 4:** Pay Over Time (pricing, plan picker, affordability, My Plans).
- **Phase 5:** Safe to Spend, timeline, cross-feature updates.
- **Phase 6:** Polish: animations, empty/loading/error states, mobile
  testing, README (setup steps, env vars, architecture diagram, demo script).

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

### Where things live

```
backend/src/features/   pure business logic, fully unit tested
backend/src/services/   that logic joined to the database
backend/src/data/       providers, demo dataset, sync
backend/src/routes/     Express endpoints
frontend/src/app/(app)/ the signed-in screens
```

139 tests: `npm test`. See README.md for architecture and the demo script.

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
- Retinted to Capital One's navy/red palette; green is reserved for money saved
  and income.

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

### Known issues / notes

- Nessie holds more transactions than the 300 in the mirror: early seed runs
  duplicated records before the idempotency signature was fixed, and Nessie has
  no DELETE for purchases. Harmless — the app reads the local mirror. For a clean
  Nessie account, change the demo customer name in `backend/src/data/nessieProvider.ts`
  and re-seed.
- "Looks unused" comes from a seeded engagement signal; Nessie exposes no usage
  data, so this stands in for merchant telemetry a real bank would receive.
- Free-trial conversion prices come from a seeded merchant field, since a $0
  trial authorisation cannot reveal what it will charge.

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

It is an **estimate, not a FICO score** — real scores include accounts at other
lenders, credit checks and public records we cannot see. The UI says so plainly.

The estimate drives Pay Over Time pricing through `bandForScore()`, so paying
down the card or stopping subscriptions actually changes the APR offered. The
`/credit` page lets the user stack what-if scenarios and watch the score move.

### Known issues / notes

- Nessie holds more transactions than the mirror: early seed runs duplicated
  records before the idempotency signature was fixed, and Nessie has no DELETE
  for purchases. Harmless — the app reads the mirror. `ZZ_AUDIT` and
  `ZZ_FLOW_PROBE` records are left over from endpoint verification.
- Bills accumulated across seeds before re-adoption was added; `mirrorBillToNessie`
  now adopts an existing bill by payee rather than creating a duplicate.
- "Looks unused" comes from a seeded engagement signal; Nessie exposes no usage
  data, so it stands in for merchant telemetry a real bank would receive.
- Free-trial conversion prices come from a seeded merchant field, since a $0
  trial authorisation cannot reveal what it will charge.
