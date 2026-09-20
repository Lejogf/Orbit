// Typed client for the Orbit API. Domain types come from the backend, so a shape
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
    throw new ApiRequestError('BAD_RESPONSE', 'Orbit returned something unexpected. Try again.');
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

export interface AlertItem extends Omit<Alert, 'kind'> {
  kind: string;
  needsDecision: boolean;
  /** How many times this happened while still unresolved. */
  occurrences: number;
  href: string | null;
  /** sent | failed | no_device | disabled — the inbox copy exists regardless. */
  pushStatus: string | null;
  deliveredAt: string | null;
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
  username: string | null;
  trustedContact: { name: string; phone: string | null } | null;
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
  alertEveryCharge: boolean;
  lowBalanceThresholdCents: number | null;
}

export interface SessionState {
  customer: Profile;
  hasBankingData: boolean;
  preferences: Preferences | null;
}

export const auth = {
  me: () => get<SessionState>('/auth/me'),
  /** `identifier` is a username or an email. */
  login: (identifier: string, password: string) =>
    post<{ customer: Profile; hasBankingData: boolean }>('/auth/login', { identifier, password }),
  demo: () => post<{ customer: Profile; hasBankingData: boolean }>('/auth/demo'),
  demoCredentials: () => get<{ email: string; username: string; password: string }>('/auth/demo-credentials'),
  register: (body: {
    firstName: string;
    lastName: string;
    email: string;
    username?: string;
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

// --- Ori ---

export type OriLang = 'en' | 'es';

export interface OriState {
  misses: number;
  lastIntent: string | null;
  lastMessage: string | null;
  lang: OriLang;
}

export type OriAction =
  | { type: 'lock_card'; accountId: string; locked: boolean }
  | { type: 'subscription'; subscriptionId: string; action: 'block' | 'guard' | 'unguard' }
  | { type: 'transfer'; fromAccountId: string; toAccountId: string; amountCents: number };

export interface OriReply {
  intent: string;
  text: string;
  facts: { label: string; value: string }[];
  links: { label: string; href: string }[];
  proposal: { action: OriAction; title: string; summary: string; confirmLabel: string; danger?: boolean } | null;
  effect: { type: 'text_scale'; scale: number } | { type: 'start_tour' } | { type: 'navigate'; href: string } | null;
  handoff: { topic: string; urgent: boolean; reason: string } | null;
  suggestions: string[];
  state: OriState;
}

// --- support ---

export type SupportChannel = 'chat' | 'callback' | 'call' | 'message';

export interface SupportCase {
  id: string;
  channel: SupportChannel;
  topic: string;
  status: 'queued' | 'active' | 'scheduled' | 'resolved';
  team: string;
  agentName: string | null;
  scheduledFor: string | null;
  callbackPhone: string | null;
  callCode: string | null;
  phone: string;
  needs: string[];
  waitingSeconds: number;
  agentTyping: boolean;
  messages: { id: string; author: 'customer' | 'agent' | 'system' | 'eno'; body: string; createdAt: string }[];
  createdAt: string;
}

export interface SupportCaseSummary {
  id: string;
  channel: SupportChannel;
  topic: string;
  status: string;
  agentName: string | null;
  scheduledFor: string | null;
  createdAt: string;
}

// --- spending ---

export interface SpendingReport {
  period: { start: string; end: string; label: string };
  totalCents: number;
  previousTotalCents: number;
  incomeCents: number;
  categories: { category: string; cents: number; share: number; count: number; previousCents: number; changeCents: number }[];
  merchants: { name: string; cents: number; count: number; category: string }[];
  byWeekday: { day: string; cents: number }[];
  trend: { month: string; label: string; cents: number }[];
  recurringCents: number;
  insights: { id: string; tone: 'good' | 'warn' | 'info'; title: string; body: string }[];
}

// --- travel ---

/** What cancelling a booking would cost, quoted before anything happens. */
export interface CancellationQuote {
  refundCents: number;
  feeCents: number;
  milesRefunded: number;
  reason: string;
  free: boolean;
  freeWindowHoursLeft: number;
}

export interface Airport { code: string; city: string }

export interface FlightOption {
  id: string; airline: string; flightNumber: string; from: string; to: string;
  departsAt: string; arrivesAt: string; durationMinutes: number; stops: number;
  cabin: string; priceCents: number; seatsLeft: number;
}

export interface HotelOption {
  id: string; name: string; city: string; rating: number; nightlyCents: number;
  nights: number; totalCents: number; perks: string[];
}

export interface PriceForecast {
  advice: 'book_now' | 'wait' | 'fair';
  confidence: number;
  expectedChange: number;
  headline: string;
  reason: string;
}

export interface Rewards {
  miles: number;
  valueCents: number;
  travelCreditCents: number;
  cardLast4: string | null;
  cardLocked: boolean;
  availableCreditCents: number | null;
}

export type PayWith = 'card' | 'miles' | 'mix' | 'card_then_erase';

export interface TripQuote {
  priceCents: number;
  title: string;
  merchant: string;
  departsAt: string;
  advice: {
    options: { id: PayWith; label: string; cardCents: number; milesUsed: number; milesEarned: number; effectiveCostCents: number; note: string }[];
    bestId: PayWith;
    headline: string;
    travelCreditAppliedCents: number;
  };
  forecast: PriceForecast;
  rewards: Rewards;
}

export interface Booking {
  id: string; kind: 'flight' | 'hotel'; title: string; details: Record<string, unknown>;
  priceCents: number; paidCardCents: number; paidMilesCents: number; milesEarned: number;
  currentPriceCents: number; refundedCents: number; status: string; departsAt: string;
  createdAt: string; inNessie: boolean; priceChecks: number;
}

export type TripRequest =
  | { kind: 'flight'; search: { from: string; to: string; date: string; travelers: number }; optionId: string }
  | { kind: 'hotel'; search: { city: string; checkIn: string; nights: number }; optionId: string };

export interface Offer {
  id: string; merchant: string; category: string; rate: number; maxCents: number;
  expiresInDays: number; headline: string; projectedCents: number; youShopHere: boolean; activated: boolean;
}

// --- bill splitting ---

export interface ReceiptItem { id: string; name: string; cents: number; quantity: number }

export interface ParsedReceipt {
  merchant: string | null;
  items: ReceiptItem[];
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  totalCents: number | null;
  reconciles: boolean;
}

export interface SplitPerson { id: string; name: string; contact?: string | null; isSelf?: boolean }

export interface SplitBody {
  title: string;
  mode: 'items' | 'even';
  people: SplitPerson[];
  items: ReceiptItem[];
  assignments: Record<string, string[]>;
  taxCents: number;
  tipCents: number;
  totalCents?: number;
  extrasMode: 'proportional' | 'even';
  transactionId?: string | null;
}

export interface PersonShare {
  personId: string; name: string; itemsCents: number; taxCents: number; tipCents: number;
  totalCents: number; items: { name: string; cents: number }[];
}

export interface SavedSplit {
  id: string; title: string; totalCents: number; createdAt: string;
  shares: { id: string; name: string; contact: string | null; amountCents: number; isSelf: boolean; status: string; paidAt: string | null }[];
}

// --- profile ---

export interface ChangeRequest {
  id: string;
  kind: 'address' | 'legal_name';
  status: 'pending_verification' | 'under_review' | 'approved' | 'rejected' | 'cancelled';
  payload: Record<string, unknown>;
  reason: string | null;
  documentName: string | null;
  documentType: string | null;
  reviewerNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AddressInput { line1: string; line2?: string | null; city: string; state: string; postalCode: string }

export interface AccessibilitySettings {
  theme: 'system' | 'light' | 'dark';
  textScale: number;
  contrast: 'standard' | 'high';
  font: 'default' | 'readable' | 'dyslexic';
  lineSpacing: 'normal' | 'relaxed';
  motion: 'system' | 'reduce';
  simpleMode: boolean;
  underlineLinks: boolean;
  largeTargets: boolean;
  colorSafe: boolean;
  focusRing: 'standard' | 'strong';
  language: 'en' | 'es';
  readAloudRate: number;
  confirmMoney: boolean;
  sessionMinutes: 15 | 30 | 60 | 120;
  oriVoice: boolean;
}

export const more = {
  ori: (message: string, page: string, state?: OriState) => post<OriReply>('/ori', { message, page, state }),

  support: () =>
    get<{ phone: string; needs: { id: string; label: string }[]; cases: SupportCaseSummary[] }>('/support'),
  createCase: (body: {
    channel: SupportChannel;
    topic: string;
    needs: string[];
    transcript?: { author: 'customer' | 'eno'; text: string }[];
    callbackAt?: string | null;
    phone?: string | null;
    message?: string;
  }) => post<SupportCase>('/support/cases', body),
  supportCase: (id: string) => get<SupportCase>(`/support/cases/${id}`),
  sendSupportMessage: (id: string, body: string) => post<SupportCase>(`/support/cases/${id}/messages`, { body }),
  closeCase: (id: string) => post<SupportCase>(`/support/cases/${id}/close`),

  vapidKey: () => get<{ publicKey: string }>('/notifications/vapid'),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    post<{ subscribed: boolean; devices: number }>('/notifications/subscribe', subscription),
  unsubscribePush: (endpoint: string) => post<{ subscribed: boolean }>('/notifications/unsubscribe', { endpoint }),
  pushStatus: () =>
    get<{ devices: number; lastDelivered: string | null; delivery: Record<string, number> }>('/notifications/status'),
  retryPush: () => post<{ retried: number; sent: number }>('/notifications/retry'),
  testCharge: () => post<{ declined: boolean; alert: AlertItem | null }>('/notifications/test-charge'),

  spending: (offset = 0) => get<SpendingReport>(`/spending?offset=${offset}`),

  travel: () => get<{ airports: Airport[]; rewards: Rewards; bookings: Booking[] }>('/travel'),
  flights: (q: { from: string; to: string; date: string; travelers: number }) =>
    get<{
      search: typeof q & { fromCity: string; toCity: string };
      forecast: PriceForecast;
      options: FlightOption[];
      /** 'live' means real Google Flights fares; 'generated' is our inventory. */
      source: 'live' | 'generated';
      provider: { provider: string; configured: boolean; searchesMade: number; lastError: string | null };
    }>(`/travel/flights?${new URLSearchParams({ ...q, travelers: String(q.travelers) })}`),
  hotels: (q: { city: string; checkIn: string; nights: number }) =>
    get<{ search: typeof q; forecast: PriceForecast; options: HotelOption[] }>(
      `/travel/hotels?${new URLSearchParams({ ...q, nights: String(q.nights) })}`,
    ),
  quoteTrip: (trip: TripRequest) => post<TripQuote>('/travel/quote', trip),
  bookTrip: (trip: TripRequest, payWith: PayWith) => post<Booking>('/travel/book', { trip, payWith }),
  checkPrice: (id: string, demo = false) =>
    post<{ booking: Booking; newPriceCents: number; refundCents: number }>(`/travel/bookings/${id}/check-price`, { demo }),
  cancellationQuote: (id: string) =>
    get<{ booking: Booking; quote: CancellationQuote }>(`/travel/bookings/${id}/cancellation`),
  cancelBooking: (id: string) =>
    post<{ booking: Booking; quote: CancellationQuote }>(`/travel/bookings/${id}/cancel`),
  offers: () => get<Offer[]>('/offers'),
  setOffer: (id: string, activated: boolean) => post<Offer[]>(`/offers/${id}`, { activated }),

  parseReceipt: (text: string) => post<ParsedReceipt>('/split/parse', { text }),
  previewSplit: (body: SplitBody) => post<PersonShare[]>('/split/preview', body),
  saveSplit: (body: SplitBody) => post<SavedSplit>('/split', body),
  splits: () => get<SavedSplit[]>('/split'),
  markSharePaid: (id: string) => post<unknown>(`/split/shares/${id}/paid`),

  changeRequests: () =>
    get<{ requests: ChangeRequest[]; reasons: { id: string; label: string; documents: string[] }[] }>('/profile/requests'),
  startAddressChange: (address: AddressInput) =>
    post<{ requestId: string; standardized: AddressInput; changed: boolean; sentTo: string; demoCode: string }>(
      '/profile/address',
      address,
    ),
  verifyAddressChange: (requestId: string, code: string) =>
    post<{ address: AddressInput; inNessie: boolean }>('/profile/address/verify', { requestId, code }),
  requestNameChange: (body: {
    firstName: string;
    lastName: string;
    middleName?: string | null;
    reason: string;
    document: { name: string; type: string; size: number };
  }) => post<ChangeRequest>('/profile/name', body),
  approveRequest: (id: string) => post<ChangeRequest>(`/profile/requests/${id}/approve`),
  cancelRequest: (id: string) => post<ChangeRequest[]>(`/profile/requests/${id}/cancel`),
  setTrustedContact: (name: string | null, phone: string | null) =>
    patch<{ name: string | null; phone: string | null }>('/profile/trusted-contact', { name, phone }),
  setUsername: (username: string) => patch<{ username: string }>('/profile/username', { username }),
  accessibility: () => get<AccessibilitySettings>('/profile/accessibility'),
  saveAccessibility: (settings: AccessibilitySettings) => request<AccessibilitySettings>('PUT', '/profile/accessibility', settings),
};

// --- cards ---

export interface CardArt {
  from: string;
  to: string;
  ink: 'light' | 'dark';
  texture: 'matte' | 'metal' | 'frost';
}

export interface EarnRule {
  category: string;
  rate: number;
  label: string;
}

/** Debit spends your own money; credit spends the bank's. */
export type CardFunding = 'debit' | 'credit';

export interface HeldCard {
  accountId: string;
  productId: string;
  name: string;
  tier: string;
  funding: CardFunding;
  kind: 'personal' | 'business';
  tagline: string;
  art: CardArt;
  earn: EarnRule[];
  perks: string[];
  annualFeeCents: number;
  nickname: string;
  last4: string;
  balanceCents: number;
  creditLimitCents: number | null;
  availableCents: number | null;
  isLocked: boolean;
  physicalOrderedAt: string | null;
  rewardsCents: number;
}

export interface CardCatalogueEntry {
  id: string;
  tier: string;
  name: string;
  tagline: string;
  kind: 'personal' | 'business';
  annualFeeCents: number;
  startingLimitCents: number;
  minScore: number;
  art: CardArt;
  earn: EarnRule[];
  perks: string[];
  redemptions: string[];
  held: boolean;
  eligibility: { eligible: boolean; confidence: number; reason: string } | null;
}

export interface CardsResponse {
  cards: HeldCard[];
  profile: { score: number; monthlyIncomeCents: number; monthlySpendCents: number; missedPayments: number };
  held: string[];
  recommendation: { productId: string; reason: string } | null;
  catalogue: CardCatalogueEntry[];
}

// --- rewards ---

export interface RedemptionRow {
  id: 'cash' | 'giftcard' | 'travel' | 'invest' | 'merch' | 'partner';
  label: string;
  multiplier: number;
  description: string;
  minimumPoints: number;
  available: boolean;
  valueCents: number;
  per1000Cents: number;
}

export interface RewardsResponse {
  points: number;
  valueCents: number;
  tier: string;
  earnedThisMonth: number;
  redemptions: RedemptionRow[];
  boosters: { id: string; label: string; category: string; bonusRate: number; endsInDays: number }[];
  tips: { title: string; body: string; extraPointsPerMonth: number }[];
  earnRates: { accountId: string; name: string; earn: EarnRule[] }[];
  history: { id: string; points: number; kind: string; reason: string; redemption: string | null; valueCents: number | null; createdAt: string }[];
}

/** Everyone but the owner, who is set when the household is created. */
export type HouseholdRole = 'partner' | 'teen' | 'child';

export interface HouseholdInvite {
  id: string;
  role: HouseholdRole | string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | string;
  note: string | null;
  createdAt: string;
  household: { id: string; name: string };
  to: { name: string; username: string | null };
  from: string;
}

export interface HouseholdInvites {
  received: HouseholdInvite[];
  sent: HouseholdInvite[];
}

// --- investing ---

/** Where a price came from. The UI labels it rather than implying live. */
export type PriceSource = 'live' | 'simulated';

export interface PricePoint {
  date: string;
  priceCents: number;
}

export interface Quote {
  symbol: string;
  name: string;
  kind: 'stock' | 'etf' | 'crypto';
  risk: 'lower' | 'medium' | 'higher';
  blurb: string;
  priceCents: number;
  changeCents: number;
  changePercent: number;
  source: PriceSource;
  /** When this price was true, ISO 8601. */
  asOf: string;
  /** Shown in the "most traded" rail. */
  featured: boolean;
}

export interface MarketDataStatus {
  provider: string;
  configured: boolean;
  callsToday: number;
  dailyBudget: number;
  warming: number;
  throttledUntil: string | null;
  budgetResetsAt: string;
}

export interface ValuedPosition {
  symbol: string;
  name: string;
  kind: string;
  risk: string;
  quantity: number;
  costBasisCents: number;
  priceCents: number;
  valueCents: number;
  gainCents: number;
  gainPercent: number;
  dayChangeCents: number;
}

export interface InvestResponse {
  portfolio: {
    positions: ValuedPosition[];
    valueCents: number;
    costBasisCents: number;
    gainCents: number;
    gainPercent: number;
    dayChangeCents: number;
    higherRiskShare: number;
  };
  riskNote: string | null;
  availableCents: number;
  points: number;
  pointsValueCents: number;
  market: Quote[];
  marketData: MarketDataStatus;
  trades: { id: string; symbol: string; side: string; quantity: number; priceCents: number; amountCents: number; fundedBy: string; createdAt: string }[];
}

// --- budget ---

export type BudgetMethod = 'rule5030' | 'rule70101010' | 'zero' | 'custom';
export type Bucket = 'needs' | 'wants' | 'savings' | 'debt';

export interface BudgetResponse {
  method: BudgetMethod;
  rules: Record<string, { label: string; description: string; split: Record<Bucket, number> }>;
  monthlyIncomeCents: number;
  incomeIsEstimated: boolean;
  averages: { monthlyIncomeCents: number; monthlySpendCents: number; monthsCounted: number; volatility: number };
  months: { month: string; incomeCents: number; spendCents: number }[];
  plan: { bucket: Bucket; label: string; plannedCents: number; actualCents: number; differenceCents: number }[];
  envelopes: { category: string; bucket: Bucket; plannedCents: number; spentCents: number; limitCents: number | null; remainingCents: number; used: number; status: 'ok' | 'close' | 'over' }[];
  unassignedCents: number;
  forecast: {
    safeDailyCents: number;
    monthlySurplusCents: number;
    runwayMonths: number;
    emergencyTargetCents: number;
    status: 'comfortable' | 'tight' | 'short';
    headline: string;
    advice: string;
  };
  household: { id: string; name: string; role: string; members: { customerId: string; firstName: string; role: string; sharesMoney: boolean }[] } | null;
  /** Outstanding invites addressed to this customer, so Budget can offer them. */
  invites?: HouseholdInvite[];
  emergencyTargetMonths: number;
  savingsCents: number;
}

// --- payments ---

export type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';

export interface PayeeRow {
  id: string;
  name: string;
  kind: string;
  handle: string;
  displayHandle: string;
  logoSlug: string | null;
  lastPaidAt: string | null;
}

export interface PaymentRow {
  id: string;
  amountCents: number;
  memo: string | null;
  direction: 'send' | 'request' | 'bill';
  dueDate: string;
  repeat: Repeat;
  status: string;
  sentAt: string | null;
  createdAt: string;
  payee: { name: string; handle: string; kind: string; logoSlug: string | null } | null;
}

export interface PayResponse {
  payees: PayeeRow[];
  accounts: { id: string; nickname: string; type: string; last4: string; balanceCents: number }[];
  upcoming: PaymentRow[];
  history: PaymentRow[];
  deposits: { id: string; amountCents: number; status: string; availableOn: string; createdAt: string }[];
}

export const money = {
  cards: () => get<CardsResponse>('/cards'),
  openCard: (productId: string) => post<HeldCard[]>('/cards/open', { productId }),
  orderPhysical: (accountId: string) => post<HeldCard[]>(`/cards/${accountId}/order-physical`),

  rewards: () => get<RewardsResponse>('/rewards'),
  redeem: (redemption: RedemptionRow['id'], points: number) =>
    post<{ valueCents: number; remainingPoints: number; redemption: string }>('/rewards/redeem', { redemption, points }),

  invest: () => get<InvestResponse>('/invest'),
  instrument: (symbol: string, range = 90) =>
    get<{ quote: Quote; history: PricePoint[]; historySource: PriceSource }>(`/invest/${symbol}?range=${range}`),
  buy: (symbol: string, amountCents: number, fundedBy: 'cash' | 'points' = 'cash') =>
    post<InvestResponse>('/invest/buy', { symbol, amountCents, fundedBy }),
  sell: (symbol: string, quantity: number) => post<InvestResponse>('/invest/sell', { symbol, quantity }),
  transferOut: (broker: string) => post<{ broker: string; positions: number; note: string }>('/invest/transfer-out', { broker }),

  budget: () => get<BudgetResponse>('/budget'),
  saveBudget: (body: { method?: BudgetMethod; monthlyIncomeCents?: number | null; emergencyTargetMonths?: number }) =>
    patch<BudgetResponse>('/budget', body),
  envelopeSuggestions: () =>
    get<{ envelopes: { category: string; bucket: Bucket; suggestedCents: number; averageCents: number }[]; unassignedCents: number }>('/budget/suggestions'),
  saveEnvelopes: (envelopes: { category: string; plannedCents: number; bucket?: Bucket; limitCents?: number | null }[]) =>
    request<BudgetResponse>('PUT', '/budget/envelopes', { envelopes }),
  createHousehold: (name: string) => post<{ household: { id: string; name: string }; joinCode: string }>('/budget/household', { name }),
  householdInvites: () => get<HouseholdInvites>('/budget/household/invites'),
  inviteToHousehold: (username: string, role: HouseholdRole, note?: string) =>
    post<HouseholdInvite>('/budget/household/invites', { username, role, note }),
  respondToInvite: (id: string, accept: boolean) =>
    post<BudgetResponse>(`/budget/household/invites/${id}/respond`, { accept }),
  cancelInvite: (id: string) => post<HouseholdInvites>(`/budget/household/invites/${id}/cancel`),
  joinHousehold: (code: string, role: 'partner' | 'teen' | 'child') => post<BudgetResponse>('/budget/household/join', { code, role }),
  leaveHousehold: () => post<BudgetResponse>('/budget/household/leave'),

  pay: () => get<PayResponse>('/pay'),
  addPayee: (body: { name: string; handle: string; kind?: 'person' | 'biller'; logoSlug?: string | null }) =>
    post<PayResponse>('/pay/payees', body),
  sendMoney: (body: {
    payeeId?: string | null;
    name?: string;
    handle?: string;
    accountId: string;
    amountCents: number;
    memo?: string | null;
    direction?: 'send' | 'request' | 'bill';
    dueDate?: string | null;
    repeat?: Repeat;
  }) => post<PayResponse>('/pay/send', body),
  cancelPayment: (id: string) => post<PayResponse>(`/pay/${id}/cancel`),
  markReceived: (id: string) => post<PayResponse>(`/pay/${id}/received`),
  depositCheck: (body: { accountId: string; amountCents: number; frontName?: string; backName?: string }) =>
    post<PayResponse>('/pay/deposit-check', body),
};
