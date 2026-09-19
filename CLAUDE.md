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

- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
- [ ] Phase 6

Nessie findings: _(fill in after Phase 1)_
