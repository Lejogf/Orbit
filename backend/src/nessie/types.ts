// Raw Nessie response shapes. Fields are optional where the live API hasn't been
// confirmed to always return them. `npm run verify:nessie` reports what it saw.

export interface NessieAddress {
  street_number?: string;
  street_name?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface NessieCustomer {
  _id: string;
  first_name: string;
  last_name: string;
  address?: NessieAddress;
}

export type NessieAccountType = 'Checking' | 'Savings' | 'Credit Card';

export interface NessieAccount {
  _id: string;
  type: NessieAccountType;
  nickname: string;
  rewards: number;
  balance: number;
  account_number?: string;
  customer_id: string;
}

export interface NessieMerchant {
  _id: string;
  name: string;
  category?: string | string[];
  address?: NessieAddress;
  geocode?: { lat: number; lng: number };
}

export type NessieTransactionStatus = 'pending' | 'cancelled' | 'completed' | 'executed';

export interface NessiePurchase {
  _id: string;
  merchant_id: string;
  medium: 'balance' | 'rewards';
  purchase_date: string;
  amount: number;
  status: NessieTransactionStatus;
  payer_id: string;
  description?: string;
}

export interface NessieDeposit {
  _id: string;
  type: 'deposit';
  transaction_date: string;
  status: NessieTransactionStatus;
  payee_id: string;
  medium: 'balance' | 'rewards';
  amount: number;
  description?: string;
}

// Unlike deposits, POST withdrawals rejects a `type` field.
export interface NessieWithdrawal {
  _id: string;
  type?: 'withdrawal';
  transaction_date: string;
  status: NessieTransactionStatus;
  payer_id: string;
  medium: 'balance' | 'rewards';
  amount: number;
  description?: string;
}

// POST transfers accepts ONLY { transaction_date, status, amount, description } —
// it rejects payee_id, medium and type. So Nessie can't record a transfer's
// destination; we write the matching inbound leg in our own mirror.
export interface NessieTransfer {
  // POST returns `_id` but GET returns `id`. Every other collection uses `_id`
  // both ways. Use transferId() rather than touching either directly.
  _id?: string;
  id?: string;
  type?: 'transfer';
  transaction_date: string;
  status: NessieTransactionStatus;
  medium?: 'balance' | 'rewards';
  payer_id?: string;
  payee_id?: string;
  amount: number;
  description?: string;
}

/** Reads a transfer's id across both spellings Nessie uses. */
export function transferId(transfer: NessieTransfer): string | null {
  return transfer._id ?? transfer.id ?? null;
}

/** The only body Nessie's TransferCreate accepts. `description` is required. */
export interface NessieTransferCreate {
  transaction_date: string;
  status: NessieTransactionStatus;
  amount: number;
  description: string;
}

/** Accepted body for creating a withdrawal — `type` must be omitted. */
export type NessieWithdrawalCreate = Omit<NessieWithdrawal, '_id' | 'payer_id' | 'type'>;

// Bills carry a recurring_date, which is how a detected subscription becomes a
// real recurring obligation in Nessie. Two quirks, both load-bearing:
//
//  1. upcoming_payment_date is read-only — Nessie computes it and rejects it on create.
//  2. The Bill READ model requires nickname, payment_date, recurring_date AND
//     upcoming_payment_date, but only populates the last itself. A bill missing
//     any of the first three is writable but NOT readable — and because it fails
//     while serialising the collection, ONE bad bill makes GET /bills return 400
//     for that whole account permanently. NessieBillCreate makes all three
//     mandatory so that cannot happen. Verified against the live API.
//
// PUT /bills/{id} accepts partial updates and never breaks readability, which is
// what makes the guard/block status flow safe.
export interface NessieBill {
  _id: string;
  status: 'pending' | 'cancelled' | 'completed' | 'recurring';
  payee: string;
  nickname?: string;
  creation_date?: string;
  payment_date?: string;
  recurring_date?: number;
  upcoming_payment_date?: string;
  payment_amount: number;
  account_id: string;
}

/** Server-computed fields omitted; the two required ones promoted to mandatory. */
export type NessieBillCreate = Omit<
  NessieBill,
  | '_id'
  | 'account_id'
  | 'upcoming_payment_date'
  | 'creation_date'
  | 'payment_date'
  | 'recurring_date'
  | 'nickname'
> & {
  /** Required for the bill to be readable afterwards. */
  nickname: string;
  /** Required. YYYY-MM-DD. */
  payment_date: string;
  /** Required. Day of month, 1-28 so every month has it. */
  recurring_date: number;
};

// Loans carry a credit_score (confirmed), which feeds Pay Over Time pricing.
// There is no term or number-of-payments field, so the schedule stays local.
export interface NessieLoan {
  _id: string;
  type?: string;
  creation_date?: string;
  status: 'pending' | 'approved' | 'declined' | 'completed';
  credit_score?: number;
  monthly_payment: number;
  amount: number;
  description?: string;
  account_id?: string;
}

/** Every field is required on create — omitting credit_score is a 400. */
export interface NessieLoanCreate {
  type: string;
  status: 'pending' | 'approved' | 'declined' | 'completed';
  credit_score: number;
  /** Whole dollars; Nessie truncates anything finer. */
  monthly_payment: number;
  amount: number;
  description: string;
}

/**
 * POST responses.
 *
 * The published docs say a POST returns only a message string. It does not — it
 * returns this envelope WITH the created object and its `_id`, so there is no
 * need to re-fetch the list to discover the new id.
 */
export interface NessieCreateResponse<T> {
  code: number;
  message: string;
  objectCreated: T;
}

/** PUT responses. 202, with the updated object attached. */
export interface NessieUpdateResponse<T> {
  code: number;
  message: string;
  objectUpdated: T;
}
