// Typed client for the Flow API. Domain types come from the backend, so a shape
// change there breaks the build here rather than at runtime.
import type {
  Account,
  Alert,
  ApiResponse,
  InstallmentPlan,
  Subscription,
  Transaction,
} from '@shared/types';

export type { Account, Alert, InstallmentPlan, Subscription, Transaction };

// A relative URL is fine in the browser. Server components run in Node, which has
// no origin to resolve against, so they need the absolute one.
const SERVER_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

function url(path: string): string {
  return typeof window === 'undefined' ? `${SERVER_ORIGIN}/api${path}` : `/api${path}`;
}

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Field-level detail, when the server attached any. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** The form field this error belongs against, if the server named one. */
  get field(): string | null {
    const detail = this.details as { field?: string } | undefined;
    return detail?.field ?? null;
  }

  /** Reasons an account can't be closed, when that's what failed. */
  get blockers(): string[] {
    const detail = this.details as { blockers?: string[] } | undefined;
    return detail?.blockers ?? [];
  }

  get isAuthError(): boolean {
    return this.code === 'NOT_SIGNED_IN';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url(path), {
      method,
      cache: 'no-store',
      // The session lives in an httpOnly cookie, so it has to be sent along.
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(
      'NETWORK',
      "We couldn't reach Flow. Check your connection and try again.",
    );
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiRequestError('BAD_RESPONSE', 'Flow returned something unexpected. Try again.');
  }

  if (!payload.success) {
    throw new ApiRequestError(payload.error.code, payload.error.message, payload.error.details);
  }
  return payload.data;
}

const get = <T,>(path: string) => request<T>('GET', path);
const post = <T,>(path: string, body?: unknown) => request<T>('POST', path, body);
const patch = <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body);

// --- response shapes that only exist on the wire ---

export interface SafeToSpend {
  safeToSpendCents: number;
  checkingBalanceCents: number;
  committedCents: number;
  nextPayday: string | null;
  daysUntilPayday: number | null;
  avoidedCents: number;
  upcoming: TimelineItem[];
}

export interface TimelineItem {
  id: string;
  kind: 'subscription' | 'installment' | 'income';
  label: string;
  amountCents: number;
  date: string;
  category: string;
  isFreeTrialConversion?: boolean;
}

export interface AccountSummary extends Account {
  isLocked: boolean;
}

export interface SubscriptionSummary {
  total: number;
  activeCount: number;
  guardedCount: number;
  blockedCount: number;
  monthlyTotalCents: number;
  yearlyTotalCents: number;
  savedYearlyCents: number;
  needsAttention: {
    priceIncreases: number;
    trials: number;
    duplicates: number;
    unused: number;
  };
}

export interface AlertItem extends Alert {
  needsDecision: boolean;
  /** How many times this happened while still unresolved. */
  occurrences: number;
}

export interface Dashboard {
  safeToSpend: SafeToSpend;
  accounts: AccountSummary[];
  subscriptions: SubscriptionSummary;
  alerts: AlertItem[];
  activePlans: { count: number; monthlyTotalCents: number; remainingCents: number };
  timeline: TimelineItem[];
}

export interface Affordability {
  affordable: boolean;
  stretched: boolean;
  obligationRatio: number;
  ratioBefore: number;
  disposableAfterCents: number;
  message: string;
}

export interface CreditImpact {
  utilizationBefore: number;
  utilizationAfter: number;
  monthlyObligationsBeforeCents: number;
  monthlyObligationsAfterCents: number;
  summary: string;
}

export interface PlanQuote {
  termMonths: 3 | 6 | 12 | 24;
  aprPercent: number;
  monthlyPaymentCents: number;
  totalCostCents: number;
  totalInterestCents: number;
  monthlyFeeCents: number;
  payoffDate: string;
  available: boolean;
  unavailableReason: string | null;
  affordability: Affordability;
  creditImpact: CreditImpact;
}

export interface PlanOptions {
  transaction: {
    id: string;
    merchantName: string;
    description: string;
    amountCents: number;
    postedAt: string;
  };
  creditBand: 'excellent' | 'good' | 'fair' | 'poor';
  creditScore: number | null;
  eligibility: { eligible: boolean; reasons: string[] };
  monthlyIncomeCents: number;
  existingObligationsCents: number;
  quotes: PlanQuote[];
}

export interface SubscriptionDetail extends Subscription {
  cancelUrl: string | null;
  guardRule: { mode: string; declinedCount: number; approvedCount: number } | null;
  virtualCard: {
    number: string;
    last4: string;
    expMonth: number;
    expYear: number;
    cvv: string;
    status: string;
  } | null;
  reminders: { daysBefore: number; channel: string }[];
  /** Total actually charged by this merchant so far. */
  paidToDateCents: number;
  chargeCount: number;
  firstChargeDate: string | null;
  lastUsedAt: string | null;
}

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  email: string;
  phone: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  dateOfBirth: string | null;
  ssnLast4: string | null;
  creditScore: number;
  isDemoUser: boolean;
  memberSince: string;
}

export interface Preferences {
  alertsPush: boolean;
  alertsEmail: boolean;
  alertsSms: boolean;
  marketingEmail: boolean;
  paperless: boolean;
  lowBalanceThresholdCents: number | null;
}

export interface SessionState {
  customer: Profile;
  hasBankingData: boolean;
  preferences: Preferences | null;
}

export const auth = {
  me: () => get<SessionState>('/auth/me'),
  login: (email: string, password: string) =>
    post<{ customer: Profile; hasBankingData: boolean }>('/auth/login', { email, password }),
  demo: () => post<{ customer: Profile; hasBankingData: boolean }>('/auth/demo'),
  demoCredentials: () => get<{ email: string; password: string }>('/auth/demo-credentials'),
  register: (body: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    dateOfBirth?: string;
  }) => post<{ customer: Profile; hasBankingData: boolean }>('/auth/register', body),
  logout: () => post<{ signedOut: boolean }>('/auth/logout'),
  updateProfile: (body: Record<string, string | null>) => patch<Profile>('/auth/profile', body),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ changed: boolean }>('/auth/password', { currentPassword, newPassword }),
  updatePreferences: (body: Partial<Preferences>) => patch<Preferences>('/auth/preferences', body),
  signOutEverywhere: () => post<{ signedOutSessions: number }>('/auth/sign-out-everywhere'),
  closureCheck: () => get<{ canClose: boolean; blockers: string[] }>('/auth/closure-check'),
  closeAccount: (password: string, confirmation: string) =>
    post<{ closed: boolean }>('/auth/close-account', { password, confirmation }),
  loadSampleData: () => post<{ loaded: boolean }>('/auth/load-sample-data'),
};

export type ScenarioId =
  | 'pay_off_card'
  | 'pay_half_card'
  | 'split_purchase'
  | 'miss_payment'
  | 'block_subscriptions'
  | 'open_new_card'
  | 'wait_a_year';

export interface CreditFactor {
  key: string;
  label: string;
  score: number;
  weight: number;
  points: number;
  detail: string;
  standing: 'strong' | 'fair' | 'weak';
}

export interface CreditScenario {
  id: ScenarioId;
  label: string;
  description: string;
  score: number;
  band: string;
  delta: number;
}

export interface CreditReport {
  score: number;
  band: string;
  utilization: number;
  factors: CreditFactor[];
  scenarios: CreditScenario[];
  range: { min: number; max: number };
  disclaimer: string;
  context: {
    stoppableCount: number;
    blockableSubscriptionCents: number;
    splittablePurchaseCents: number;
    splittableMerchant: string | null;
    splittableTransactionId: string | null;
  };
}

export interface CreditSimulation {
  current: { score: number; band: string };
  projected: { score: number; band: string; factors: CreditFactor[]; utilization: number };
  delta: number;
}

export const api = {
  credit: () => get<CreditReport>('/credit'),
  simulateCredit: (scenarios: ScenarioId[]) =>
    post<CreditSimulation>('/credit/simulate', { scenarios }),
  me: () => get<{ id: string; firstName: string; lastName: string; initials: string }>('/me'),
  dashboard: () => get<Dashboard>('/dashboard'),
  safeToSpend: () => get<SafeToSpend>('/safe-to-spend'),
  timeline: (days = 45) => get<TimelineItem[]>(`/timeline?days=${days}`),

  accounts: () => get<AccountSummary[]>('/accounts'),
  account: (id: string) => get<AccountSummary>(`/accounts/${id}`),
  transactions: (id: string, query = '') => get<Transaction[]>(`/accounts/${id}/transactions${query}`),
  transaction: (id: string) => get<Transaction>(`/transactions/${id}`),
  lockCard: (id: string, locked: boolean) =>
    post<{ id: string; isLocked: boolean }>(`/accounts/${id}/lock`, { locked }),
  cardNumber: (id: string) =>
    get<{ number: string; expiry: string; cvv: string }>(`/accounts/${id}/card-number`),
  transfer: (body: {
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
    description?: string;
  }) => post<{ amountCents: number; description: string }>('/transfers', body),

  subscriptions: (query = '') =>
    get<{ subscriptions: Subscription[]; summary: SubscriptionSummary; categories: string[] }>(
      `/subscriptions${query}`,
    ),
  subscription: (id: string) => get<SubscriptionDetail>(`/subscriptions/${id}`),
  subscriptionAction: (id: string, action: string) =>
    post<unknown>(`/subscriptions/${id}/actions`, { action }),
  setVirtualCardLock: (id: string, locked: boolean) =>
    post<unknown>(`/subscriptions/${id}/virtual-card`, {
      status: locked ? 'locked' : 'active',
    }),
  /** Destroying the number says nothing about the subscription, so say what happens next. */
  deleteVirtualCard: (id: string, then: 'cancel' | 'move_to_real_card') =>
    post<unknown>(`/subscriptions/${id}/virtual-card`, { status: 'deleted', then }),
  setReminder: (id: string, daysBefore: number, channel: 'push' | 'email' | 'sms' = 'push') =>
    post<unknown>(`/subscriptions/${id}/reminders`, { daysBefore, channel }),
  clearReminder: (id: string, daysBefore: number) =>
    request<unknown>('DELETE', `/subscriptions/${id}/reminders/${daysBefore}`),

  alerts: () => get<{ alerts: AlertItem[]; unread: number }>('/alerts'),
  alertDecision: (id: string, decision: 'approve' | 'keep_blocked') =>
    post<unknown>(`/alerts/${id}/decision`, { decision }),
  markAlertRead: (id: string) => post<AlertItem[]>(`/alerts/${id}/read`),

  planOptions: (transactionId: string) =>
    get<PlanOptions>(`/transactions/${transactionId}/plan-options`),
  createPlan: (transactionId: string, termMonths: number) =>
    post<InstallmentPlan>('/plans', { transactionId, termMonths }),
  plans: () =>
    get<{
      plans: InstallmentPlan[];
      summary: {
        activeCount: number;
        monthlyTotalCents: number;
        financedCents: number;
        remainingCents: number;
        maxPlans: number;
      };
    }>('/plans'),
  payPlan: (id: string, mode: 'next' | 'payoff') => post<unknown>(`/plans/${id}/pay`, { mode }),
};
