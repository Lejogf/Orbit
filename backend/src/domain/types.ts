/**
 * Domain model for Capital One Flow.
 *
 * This is the vocabulary the whole app speaks. The frontend imports these same
 * types, so the API contract is checked by the compiler rather than by hope.
 *
 * MONEY IS ALWAYS INTEGER CENTS. Never floats — `0.1 + 0.2 !== 0.3` is not a bug
 * we want in a banking demo. Conversion to/from Nessie's float dollars happens
 * only at the Nessie boundary, in `lib/money.ts`.
 */

export type AccountType = 'Checking' | 'Savings' | 'Credit Card';

export interface Account {
  id: string;
  nessieId: string | null;
  type: AccountType;
  nickname: string;
  last4: string;
  balanceCents: number;
  /** Credit cards only. */
  creditLimitCents: number | null;
  /** Credit cards only: available credit, derived. */
  availableCreditCents: number | null;
  /** Credit cards only: rewards balance in cents. */
  rewardsCents: number | null;
}

/** Which Nessie collection a transaction was merged in from. */
export type TransactionSource = 'purchase' | 'deposit' | 'withdrawal' | 'transfer';

export interface Transaction {
  id: string;
  nessieId: string | null;
  accountId: string;
  merchantId: string | null;
  merchantName: string | null;
  source: TransactionSource;
  /** Signed: negative means money left the account. */
  amountCents: number;
  description: string;
  /** ISO 8601 timestamp. */
  postedAt: string;
  category: string;
  subscriptionId: string | null;
  /** True when this is a card purchase of $100+ that can be split into a plan. */
  isInstallmentEligible: boolean;
}

export interface Merchant {
  id: string;
  nessieId: string | null;
  name: string;
  category: string;
  cancelUrl: string | null;
}

export type SubscriptionFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * `guarded`  — Ask me first: charges decline until the user approves one.
 * `blocked`  — permanent merchant block.
 * `canceled` — user cancelled; counts toward Money Saved.
 */
export type SubscriptionStatus = 'active' | 'guarded' | 'blocked' | 'canceled';

export interface Subscription {
  id: string;
  accountId: string;
  merchantId: string;
  merchantName: string;
  category: string;
  amountCents: number;
  frequency: SubscriptionFrequency;
  intervalDays: number;
  /** ISO 8601. */
  nextChargeDate: string;
  lastChargeDate: string;
  /** 0..1. */
  confidence: number;
  status: SubscriptionStatus;

  hasPriceIncrease: boolean;
  previousAmountCents: number | null;
  isFreeTrial: boolean;
  isDuplicate: boolean;
  looksUnused: boolean;

  nessieBillId: string | null;

  /** Normalised to a monthly figure so totals across frequencies are comparable. */
  monthlyCostCents: number;
  yearlyCostCents: number;
}

export type CreditBand = 'excellent' | 'good' | 'fair' | 'poor';

export interface InstallmentPlan {
  id: string;
  accountId: string;
  transactionId: string | null;
  merchantName: string;
  description: string;
  principalCents: number;
  termMonths: number;
  monthlyFeeCents: number;
  aprPercent: number;
  monthlyPaymentCents: number;
  totalCostCents: number;
  totalInterestCents: number;
  creditBand: CreditBand;
  creditScoreAtOrigination: number | null;
  startDate: string;
  payoffDate: string;
  status: 'active' | 'paid_off' | 'canceled';
  nessieLoanId: string | null;
  payments: InstallmentPayment[];
}

export interface InstallmentPayment {
  id: string;
  sequence: number;
  dueDate: string;
  amountCents: number;
  status: 'scheduled' | 'paid';
  paidAt: string | null;
}

export type AlertKind =
  | 'charge_pending'
  | 'charge_declined'
  | 'charge_approved'
  | 'trial_converting'
  | 'price_increase'
  | 'duplicate_detected'
  | 'renewal_reminder'
  | 'plan_payment_due';

export interface Alert {
  id: string;
  subscriptionId: string | null;
  kind: AlertKind;
  title: string;
  body: string;
  amountCents: number | null;
  status: 'pending' | 'resolved';
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** Standard envelope for every API response. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level detail from schema validation, when relevant. */
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Reported at /api/health so the demo can show which data source is live. */
export interface DataSourceStatus {
  /** Where data is coming from right now. */
  mode: 'nessie' | 'mock';
  /** True when mock mode was forced by USE_MOCK_DATA rather than by a failure. */
  forced: boolean;
  /** Set when we fell back because Nessie failed. Safe to show in the UI. */
  fallbackReason: string | null;
}
