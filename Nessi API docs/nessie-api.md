# TASK — DONE

Audited, planned, approved and implemented.

## What changed

**Deeper Nessie integration**
- Subscriptions are now real Nessie **bills**. Guard maps to `pending`, block to
  `cancelled`, active to `recurring`, via `PUT /bills/{billId}`. Price changes
  push a new `payment_amount`. Cancelling deletes the bill.
- Pay Over Time plans are real Nessie **loans**, closed out with
  `PUT /loans/{id}` → `completed` on payoff.
- Client gained the full lifecycle: `getBill`, `updateBill`, `deleteBill`,
  `getLoan`, `updateLoan`, `deleteLoan`, `listCustomerBills`, plus the singular
  `getPurchase` / `getWithdrawal` paths and `updateAccountNickname`.
- The seed mirrors all ten subscriptions into Nessie as bills, and re-adopts
  existing bills by payee so re-running never duplicates them.

**Corrections to this reference** (verified live — see CLAUDE.md)
- POST does NOT return a bare message string; it returns `objectCreated` with the
  `_id`, so no list re-fetch is needed.
- IDs are 36-character UUIDs, not 24 characters.
- Purchases use `purchase_date`, not `transaction_date`.
- Bills additionally require `nickname` to be readable — omitting it poisons the
  whole account's bill collection, same as the other two fields.
- Deposits and transfers use PLURAL by-id paths; only purchases and withdrawals
  are singular.

**New: credit score simulator**
- `features/creditScore.ts` estimates a score from the five FICO factors using
  real account data, and runs what-if scenarios.
- Drives Pay Over Time pricing, so behaviour changes the APR offered.
- New `/credit` page. 26 unit tests.

**Gotchas handled**
- Amounts: mirror is authoritative; conversion only at the client boundary.
  Bills keep exact cents because `payment_amount` is a float.
- Balances: confirmed Nessie never moves them; we compute our own.
- Account PUT: nickname only, enforced by the client's method signature.
- Merchant category: normalised for both string and array.
- Seed remains idempotent.

**Unchanged:** mock fallback (verified both paths), the UI flow, card lock,
virtual cards and Guard rules — all still local.

---

# Nessie API Reference (condensed)

Condensed from the official Nessie docs. Only the sections this app needs.
Skipped: ATMs, Branches, Enterprise.

## General

- Base URL: `https://api.nessieisreal.com` (from `NESSIE_BASE_URL`)
- Auth: every request needs `?key=API_KEY` (from `NESSIE_API_KEY`)
- IDs are 24-character strings in the `_id` field.
- **POST returns a message string, not the created object** (e.g.
  `"Customer created"`). To get the new `_id`, GET the list afterward.
- **PUT returns a message string** (e.g. `"Accepted bill update"`), status 202.
- Errors: `{ "code": number, "message": string, "details": string }`.
  401 returns the string `"unauthorized"`.
- Dates are strings like `"2025-03-15"`.
- **Amount types:** integers for accounts, purchases, deposits, withdrawals,
  transfers, loans. **Floats only for bills** (`payment_amount`).

---

## Customers

Fields: `_id`, `first_name`, `last_name`,
`address { street_number, street_name, city, state, zip }` (all strings)

| Method | Path                      | Notes                                               |
| ------ | ------------------------- | --------------------------------------------------- |
| GET    | `/customers`              | All customers for this key                          |
| POST   | `/customers`              | Body: `first_name, last_name, address` → 201 string |
| GET    | `/customers/{id}`         | 404 if not found                                    |
| PUT    | `/customers/{id}`         | Body: any of `first_name, last_name, address` → 202 |
| GET    | `/accounts/{id}/customer` | Customer who owns an account                        |

---

## Accounts

Fields: `_id`, `type` (`"Credit Card"` \| `"Savings"` \| `"Checking"`),
`nickname`, `rewards` (int), `balance` (int), `account_number` (16-digit
string), `customer_id`

| Method | Path                       | Notes                                                     |
| ------ | -------------------------- | --------------------------------------------------------- |
| GET    | `/customers/{id}/accounts` | Accounts for a customer                                   |
| POST   | `/customers/{id}/accounts` | Body: `type, nickname, rewards, balance` → 201 string     |
| GET    | `/accounts`                | All accounts                                              |
| GET    | `/accounts/{id}`           | One account                                               |
| PUT    | `/accounts/{id}`           | Body: `nickname` ONLY. Balance cannot be updated directly |
| DELETE | `/accounts/{id}`           | 200                                                       |

---

## Purchases

Fields: `_id`, `medium`, `transaction_date`, `status`, `amount` (int),
`description`, `merchant_id`

| Method   | Path                       | Notes                                              |
| -------- | -------------------------- | -------------------------------------------------- |
| GET      | `/purchase/{purchase_id}`  | Note: singular "purchase"                          |
| PUT      | `/purchase/{purchase_id}`  | 202                                                |
| DELETE   | `/purchase/{purchase_id}`  | 200                                                |
| GET/POST | `/accounts/{id}/purchases` | **NOT shown in docs — verify with a test request** |

---

## Merchants

Fields: `_id`, `name`, `category` (**string OR array — handle both**),
`address` (Address), `geocode { lat, lng }`

| Method | Path              | Notes                                                 |
| ------ | ----------------- | ----------------------------------------------------- |
| GET    | `/merchants`      | All merchants                                         |
| POST   | `/merchants`      | Body: `name, category, address, geocode` → 201 string |
| GET    | `/merchants/{id}` | One merchant                                          |
| PUT    | `/merchants/{id}` | 202                                                   |

---

## Deposits

Fields: `_id`, `medium`, `transaction_date`, `status`, `amount` (int),
`description`

| Method | Path                      | Notes                                                               |
| ------ | ------------------------- | ------------------------------------------------------------------- |
| GET    | `/accounts/{id}/deposits` | Deposits for an account                                             |
| POST   | `/accounts/{id}/deposits` | Body: `medium, transaction_date, status, amount, description` → 201 |
| GET    | `/deposits`               | All deposits                                                        |
| GET    | `/deposits/{id}`          | One deposit                                                         |
| PUT    | `/deposits/{id}`          | 202                                                                 |
| DELETE | `/deposits/{id}`          | 200                                                                 |

---

## Withdrawals

Fields (per example): `_id`, `medium`, `transaction_date`, `status`,
`amount` (int), `description`. **Schema is empty in the docs — verify.**

| Method | Path                          | Notes                       |
| ------ | ----------------------------- | --------------------------- |
| GET    | `/accounts/{id}/withdrawals`  | Withdrawals for an account  |
| POST   | `/accounts/{id}/withdrawals`  | 201                         |
| GET    | `/withdrawal/{withdrawal_id}` | Note: singular "withdrawal" |
| PUT    | `/withdrawal/{withdrawal_id}` | 202                         |
| DELETE | `/withdrawal/{withdrawal_id}` | 200                         |

---

## Transfers

Fields (per example): `_id`, `medium`, `transaction_date`, `status`,
`amount` (int), `description`. **Schema is empty in the docs — verify
(e.g. whether a payee/destination account field exists).**

| Method   | Path                       | Notes                                              |
| -------- | -------------------------- | -------------------------------------------------- |
| GET      | `/transfers/{transfer_id}` | One transfer                                       |
| PUT      | `/transfers/{transfer_id}` | 202                                                |
| DELETE   | `/transfers/{transfer_id}` | 200                                                |
| GET/POST | `/accounts/{id}/transfers` | **NOT shown in docs — verify with a test request** |

---

## Bills (use for subscriptions)

Fields: `_id`, `status` (`"pending"` \| `"cancelled"` \| `"completed"` \|
`"recurring"`), `payee`, `nickname`, `creation_date`, `payment_date`,
`recurring_date` (int, day of month 1–31), `upcoming_payment_date`,
`payment_amount` (float), `account_id`

| Method | Path                    | Notes                                                                                                                        |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/customers/{id}/bills` | All bills for a customer                                                                                                     |
| GET    | `/accounts/{id}/bills`  | Bills for an account                                                                                                         |
| POST   | `/accounts/{id}/bills`  | Body: `status, payee, nickname, payment_date, recurring_date, payment_amount` (status, payee, payment_amount required) → 201 |
| GET    | `/bills/{billId}`       | One bill                                                                                                                     |
| PUT    | `/bills/{billId}`       | Body: any bill fields → 202                                                                                                  |
| DELETE | `/bills/{billId}`       | 200 `"Bill deleted"`                                                                                                         |

Example:

```json
{
  "status": "recurring",
  "payee": "Electric Company",
  "nickname": "Electric bill",
  "recurring_date": 1,
  "upcoming_payment_date": "2025-04-01",
  "payment_amount": 120.5
}
```

---

## Loans (use for Pay Over Time)

Fields: `_id`, `type`, `creation_date`, `status`, `credit_score` (int),
`monthly_payment` (int), `amount` (int), `description`.
**No term / number-of-payments field** — store that locally.

| Method | Path                   | Notes                                                                                         |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/accounts/{id}/loans` | Loans for an account                                                                          |
| POST   | `/accounts/{id}/loans` | Body: `type, status, credit_score, monthly_payment, amount, description` (all required) → 201 |
| GET    | `/loans/{id}`          | One loan                                                                                      |
| PUT    | `/loans/{id}`          | Body: any loan fields → 202                                                                   |
| DELETE | `/loans/{id}`          | 200                                                                                           |

Example:

```json
{
  "type": "home",
  "status": "approved",
  "credit_score": 750,
  "monthly_payment": 1200,
  "amount": 250000,
  "description": "Home mortgage"
}
```
