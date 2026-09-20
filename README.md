# Capital One Flow

A banking app for the money you've already spent.

Most budgeting tools show you what you spent last month. By then it's gone. Flow
works on the other side of the problem: the subscriptions and instalment payments
that are already committed, and what you can actually do about them.

Built on Capital One's [Nessie](http://api.nessieisreal.com/) sandbox API.

---

## Run it

```bash
npm install          # install dependencies
npm run db:push      # create the local SQLite database
npm run seed         # populate Nessie + local data
npm run dev          # backend :4000, frontend :3000
```

Open <http://localhost:3000>.

**Demo account:** `jordan.rivera@example.com` / `flow-demo-2026`, or press
**Explore the demo account**. Six months of history and ten subscriptions with
problems worth finding.

You can also register your own account. A new account starts empty and offers to
load its own copy of the sample data — accounts are fully isolated from each
other.

| Command | What it does |
|---|---|
| `npm run dev` | Runs backend and frontend together |
| `npm test` | 155 unit tests across both workspaces |
| `npm run seed` | Idempotent — re-running only adds what's missing |
| `npm run seed -- --reset` | Wipes subscriptions, plans and alerts for a clean demo |
| `npm run verify:nessie` | Probes every Nessie endpoint and reports what's really there |
| `npm run clean` | Clears build caches |

> **Stop `npm run dev` before running `npm run build`.** Both write to
> `frontend/.next`, and a production build on top of a running dev server
> corrupts it — the symptom is unstyled pages and `Cannot find module './397.js'`.
> `npm run clean` (or just deleting `frontend/.next`) fixes it.

### Environment

`.env` lives in the **project root**, not in `/backend`:

```
NESSIE_API_KEY=...
NESSIE_BASE_URL=https://api.nessieisreal.com
USE_MOCK_DATA=false
DATABASE_URL="file:./dev.db"
```

`USE_MOCK_DATA=true` forces local mock data. The app also falls back to mock data
automatically if Nessie is unreachable, so a demo can't be broken by the network.
`/api/health` always reports which source is live.

---

## What it does

### Subscription Manager + Guard

Recurring charges are detected from purchases on the Capital One card — same
merchant, similar amount, regular interval — and scored for confidence. A
subscription paid from a bank transfer or another bank's card wouldn't appear. On the demo data this finds 10
subscriptions and correctly ignores groceries, petrol and coffee.

It also flags:

- **Price increases** — Netflix went $12.99 → $15.49
- **Free trials converting** — Blue Apron, in 2 days, at $71.92
- **Overlapping services** — Netflix + Hulu, iCloud+ + Dropbox
- **Unused subscriptions** — Peloton, paid for 7 months, unopened for 5

Per subscription you can:

| Action | Effect |
|---|---|
| **Ask me first** | Charges are declined and you get an approve / keep-blocked alert. Approving lets through exactly one charge. |
| **Block permanently** | Card-level merchant block. Counts toward Money Saved. |
| **Virtual card** | A per-merchant number. Lock to pause, delete to cancel outright. |
| **Remind me** | 1, 3, 7 or any custom number of days before renewal, by app notification, email or text. |
| **Simulate renewal** | Demo mode: pushes a fake charge through the Guard rules live. Also available inline from the list as "Test charge". |

**Navigation keeps your place, briefly.** Each section remembers where you were,
the way a native tab bar keeps a stack per tab. Drill into a card, jump to
Subscriptions, come back to Accounts and you land on that card again rather than
the top of the list.

The memory expires **30 seconds** after you leave a section. A position held
indefinitely stops being helpful — returning much later and landing deep inside a
detail page is disorienting, because the context that put you there is gone. The
clock starts when you *leave*, so reading a page for a while doesn't count
against you. Tapping the section you're already in resets it to the top.

**Repeated alerts collapse.** A merchant retrying a declined charge six times
produces one alert marked ×6, not six identical rows to dismiss.

**Card lock does not stop subscriptions — and that is the point.** Locking a card
blocks new purchases, cash advances and balance transfers, but recurring charges
the cardholder already authorised still go through. That is how Capital One's lock
works, and how most issuers implement it. Subscription Guard exists to close
exactly that gap: it works at the merchant level, so it catches what a lock lets
through. The account screen explains this rather than leaving it to be discovered.

**Virtual card states**, which are deliberately distinct:

| | Effect |
|---|---|
| **Lock** | Pauses charges. Same number, reversible at any time. |
| **Use my real card** | Stops using a virtual number. The subscription carries on unaffected. |
| **Delete** | Destroys the number permanently, then asks what the subscription should do. |

Deleting a number and cancelling a subscription are **separate decisions**. Burning
a card so a free trial can't convert, while keeping the option to subscribe
properly later, is a normal thing to want — so deleting asks whether to cancel the
subscription or move it to your real card, rather than assuming.

### Accounts and settings

Registration, sign-in and sign-out are real: passwords are hashed with scrypt and
a per-user salt, sessions are opaque random tokens in an httpOnly cookie, and every
API route is scoped to the signed-in customer. Settings separates what you can
change (email, phone, address, notification channels, password) from what you
can't (legal name, date of birth, SSN) — those are what the account was
identity-checked against, so they're shown locked with the reason rather than
hidden. Closing an account checks for outstanding balances, active plans and live
subscriptions first, requires your password and a typed confirmation, and retains
the record because financial history has to outlive the relationship.

**Reminder channels.** App notification is the default, and deliberately so: a bank's
own authenticated channel costs nothing to send and can deep-link to the Guard
controls, whereas SMS reproduces exactly the pattern phishing relies on — banks
train customers that they will never be sent a link by text.

**Cost over time.** Each subscription shows what it has *already* taken (from real
transaction history), what the next 12 months cost, and the 5-year figure at
today's price. What has already happened is more persuasive than a projection.

### Pay Over Time

Card purchases of $100+ can be split into 3, 6, 12 or 24 payments. The 3-month
plan is a 0% merchant-funded promo; longer terms are priced by credit band.

Before confirming you see the monthly payment, total cost, total interest, payoff
date, all four terms side by side, an affordability check against real income and
obligations, and a credit-impact preview (utilisation falls, fixed obligations
rise).

Responsible lending is enforced server-side: a plan that would push committed
income past 50% is refused outright, and plans are capped at 4 active / $5,000.

### Safe to Spend

The dashboard's headline number: checking balance minus everything committed
before the next payday. Payday is inferred from actual deposit cadence rather
than assumed. Block a subscription and the number moves immediately.

---

## Architecture

```
┌──────────┐     ┌──────────────┐     ┌────────┐     ┌─────┐     ┌──────────┐
│  Nessie  │────▶│ DataProvider │────▶│  sync  │────▶│ DB  │────▶│   API    │
└──────────┘     └──────────────┘     └────────┘     └─────┘     └──────────┘
                        ▲                                              │
┌──────────┐            │                                              ▼
│   Mock   │────────────┘                                        ┌──────────┐
└──────────┘   (automatic fallback)                              │ Next.js  │
                                                                 └──────────┘
```

The API only ever reads the local SQLite mirror. Two reasons: Nessie has no
single "transactions" endpoint (a statement means merging four collections), and
detection needs fast, fixed data to run against.

```
backend/src/
├── features/        pure logic, no database — where the tests point
│   ├── detection.ts     recurring-charge detection
│   ├── pricing.ts       Pay Over Time rates, eligibility, affordability
│   ├── guard.ts         charge decisions, virtual cards
│   └── safeToSpend.ts   Safe to Spend + timeline
├── services/        those features, joined to the database
├── data/            Nessie/mock providers, the demo dataset, sync
├── nessie/          API client (the only place the key touches the wire)
└── routes/          Express endpoints
```

Business logic is deliberately separated from persistence. `features/` are pure
functions over plain data, which is why 139 tests run in under a second with no
database.

**Money is integer cents everywhere.** Floats exist only at the Nessie boundary.

---

## Nessie findings

Everything below was verified against the live API with `npm run verify:nessie`
(19/19 probes pass). Several of these shaped the architecture.

### The big one: Nessie truncates money to whole dollars

```
sent 15.49  → stored 15
sent  0.99  → stored 0
sent 599.99 → stored 599
```

Cents are destroyed on write and unrecoverable on read. That's fatal here — a
$12.99 → $15.49 price rise reads back as $12 → $15, and every displayed amount is
wrong.

**Response:** the local mirror is authoritative for amounts. The seed still pushes
everything to Nessie and records the ids it returns, so records stay genuinely
linked (subscriptions become real Nessie bills, plans become real Nessie loans),
but the mirror is built from exact data and never read back for amounts. Seed
idempotency compares whole dollars for the same reason.

### Other quirks

1. **One malformed bill breaks the whole collection.** Nessie's Bill *read* model
   requires `payment_date`, `recurring_date` and `upcoming_payment_date`, but only
   ever populates the third. A bill created without the first two is writable but
   unreadable — and since it fails while serialising the list, `GET /bills` then
   returns 400 for that account *permanently*. `NessieBillCreate` makes both
   fields mandatory so it can't happen.

2. **Transfers can't record a destination.** `POST /transfers` accepts only
   `{transaction_date, status, amount, description}` and rejects `payee_id`,
   `medium` and `type`. Both legs of an internal transfer are written locally.

3. **Transfers return `id` on GET but `_id` on POST.** Every other collection uses
   `_id` both ways.

4. **`POST /withdrawals` rejects `type`**, though `POST /deposits` requires it.

5. **Empty collections 404 instead of returning `[]`.** The client treats a 404 on
   a list endpoint as an empty list.

6. **No DELETE for purchases** (403 — no such route). Transfers *can* be deleted.

7. **`/merchants` is global**, shared across every API key, so the provider narrows
   it to merchants this customer actually transacted with.

8. **There is no transactions endpoint.** Statements are built by merging
   purchases, deposits, withdrawals and transfers per account.

### What does work

`bills.recurring_date` and `loans.credit_score` both exist, so subscriptions
become real recurring Nessie bills and Pay Over Time plans become real Nessie
loans with the credit score attached.

---

## Demo script

1. **Dashboard.** Safe to Spend, and an alert: *Blue Apron free trial converts in
   2 days at $71.92*.
2. **Open Netflix → turn on "Ask me first" → Simulate renewal.** The charge is
   declined. The alert badge increments.
3. **Alerts → Approve $15.49.** It goes through. Simulate again — declined, because
   an approval covers exactly one charge.
4. **Subscriptions.** Spot Netflix + Hulu overlapping. Block Hulu → Money Saved
   jumps to $215.88/yr and the monthly total drops.
5. **Block Peloton** (*"looks unused"* — paid 7 months, unopened for 5). Its charge
   falls before the next payday, so **Safe to Spend rises by exactly $12.99** the
   moment you block it. That's the cross-feature link worth pointing at.
6. **Accounts → Quicksilver → "Splittable only" → the $599.99 Best Buy purchase.**
   Compare 3 / 6 / 12 / 24 months, check affordability and credit impact, confirm.
7. **Back to the dashboard.** Money Saved, the plan, and the timeline have all moved.

Safe to Spend only counts charges falling **before the next payday**, so blocking
something due after it (Hulu, Oct 5) correctly changes Money Saved without moving
Safe to Spend. Blocking Peloton (Sep 21) moves both.

---

## Testing

```bash
npm test
```

155 tests — 139 on backend business logic, 16 on frontend navigation state:

| Area | What's covered |
|---|---|
| Detection (33) | Cadence classification, amount tolerance, price-increase change-point detection, trials, duplicates — plus a suite asserting it finds all 10 planted scenarios in the real seed data and ignores everyday spending |
| Pricing (30) | Rates per band, instalments summing exactly to the total, term limits, eligibility, affordability thresholds, credit impact |
| Guard (15) | Charge decisions, one-time approval semantics, virtual card precedence |
| Safe to Spend (20) | Payday inference, commitment windows, blocking freeing money immediately |
| Utilities (41) | Money conversion, date arithmetic, the demo dataset's guarantees |
| Section memory (20) | TTL boundaries, per-section independence, and rejecting malformed or outdated stored state |

The detection and pricing suites are the ones worth reading — they encode the
actual product rules.

---

## Notes

- The interface follows Capital One's own palette: navy for structure, red for
  primary actions, green reserved strictly for positive money outcomes.
- Sign-in is mocked. One demo user, no real auth, per the brief.
- Card numbers, CVVs and virtual cards are generated locally and are not real.
- "Looks unused" comes from a seeded engagement signal, because Nessie exposes no
  usage data. In production this would come from merchant or card-present activity.
- No Capital One logos or trademarks are used — "Flow" is a plain text wordmark.
