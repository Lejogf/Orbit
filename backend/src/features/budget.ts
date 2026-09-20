// Budgeting, and the question underneath it: "am I going to be OK?"
//
// The calculator answers that with the customer's own numbers — what actually
// came in, what actually went out, and what is already committed — rather than
// asking them to guess. It produces three things:
//
//   1. a plan (50/30/20, 70/10/10/10, or zero-based, whichever suits them)
//   2. a safe daily number for the rest of the month
//   3. a runway: how long the money lasts if income stopped today
//
// Nothing here scolds. It states the number and the one change that moves it.

export interface MonthTotals {
  /** YYYY-MM */
  month: string;
  incomeCents: number;
  spendCents: number;
}

export type BudgetMethod = 'rule5030' | 'rule70101010' | 'zero' | 'custom';
export type Bucket = 'needs' | 'wants' | 'savings' | 'debt';

/** Which bucket a category falls in by default. Customers can override. */
const DEFAULT_BUCKETS: Record<string, Bucket> = {
  Housing: 'needs',
  Groceries: 'needs',
  Gas: 'needs',
  Transport: 'needs',
  Health: 'needs',
  Utilities: 'needs',
  Insurance: 'needs',
  Childcare: 'needs',
  'Pay Over Time': 'debt',
  Dining: 'wants',
  Streaming: 'wants',
  Music: 'wants',
  Shopping: 'wants',
  Travel: 'wants',
  Fitness: 'wants',
  News: 'wants',
  Software: 'wants',
  'Cloud Storage': 'wants',
  Food: 'wants',
  Home: 'wants',
  Savings: 'savings',
};

export function bucketFor(category: string): Bucket {
  return DEFAULT_BUCKETS[category] ?? 'wants';
}

export const RULES: Record<Exclude<BudgetMethod, 'zero' | 'custom'>, { label: string; description: string; split: Record<Bucket, number> }> = {
  rule5030: {
    label: '50 / 30 / 20',
    description: 'Half for needs, a third for the things you enjoy, a fifth saved. The simplest place to start.',
    split: { needs: 0.5, wants: 0.3, savings: 0.2, debt: 0 },
  },
  rule70101010: {
    label: '70 / 10 / 10 / 10',
    description: 'Living costs at 70%, then equal tenths for saving, paying down debt, and giving or fun. Good when a family is covering a lot.',
    split: { needs: 0.7, savings: 0.1, debt: 0.1, wants: 0.1 },
  },
};

// --- income and spending, averaged honestly ---

export interface AverageResult {
  monthlyIncomeCents: number;
  monthlySpendCents: number;
  /** Months that actually had data behind the average. */
  monthsCounted: number;
  /** How much each month varies from the average, 0..1. High means "irregular". */
  volatility: number;
}

/**
 * Averages complete months only: including a half-finished month would drag the
 * average down and make the plan too optimistic.
 */
export function averageMonths(months: MonthTotals[], currentMonth: string): AverageResult {
  const complete = months.filter((m) => m.month !== currentMonth && (m.incomeCents > 0 || m.spendCents > 0));
  if (complete.length === 0) {
    return { monthlyIncomeCents: 0, monthlySpendCents: 0, monthsCounted: 0, volatility: 0 };
  }
  const income = Math.round(complete.reduce((s, m) => s + m.incomeCents, 0) / complete.length);
  const spend = Math.round(complete.reduce((s, m) => s + m.spendCents, 0) / complete.length);

  const spread = complete.map((m) => Math.abs(m.spendCents - spend));
  const meanSpread = spread.reduce((s, v) => s + v, 0) / complete.length;

  return {
    monthlyIncomeCents: income,
    monthlySpendCents: spend,
    monthsCounted: complete.length,
    volatility: spend > 0 ? Math.min(1, meanSpread / spend) : 0,
  };
}

export interface PlanSlice {
  bucket: Bucket;
  label: string;
  plannedCents: number;
  actualCents: number;
  /** Positive = under plan, negative = over. */
  differenceCents: number;
}

export function buildPlan(
  method: Exclude<BudgetMethod, 'zero' | 'custom'>,
  monthlyIncomeCents: number,
  actualByBucket: Record<Bucket, number>,
): PlanSlice[] {
  const rule = RULES[method];
  const labels: Record<Bucket, string> = { needs: 'Needs', wants: 'Wants', savings: 'Saving', debt: 'Debt payoff' };

  return (Object.keys(rule.split) as Bucket[])
    .filter((bucket) => rule.split[bucket] > 0)
    .map((bucket) => {
      const plannedCents = Math.round(monthlyIncomeCents * rule.split[bucket]);
      const actualCents = actualByBucket[bucket] ?? 0;
      return { bucket, label: labels[bucket], plannedCents, actualCents, differenceCents: plannedCents - actualCents };
    });
}

// --- the "will I be OK?" numbers ---

export interface ForecastInput {
  availableCents: number;
  /** Everything already committed before the next payday. */
  committedCents: number;
  daysUntilPayday: number | null;
  monthlyIncomeCents: number;
  monthlySpendCents: number;
  /** Cash that isn't earmarked — savings balances. */
  savingsCents: number;
  /** People depending on this money, including the customer. */
  householdSize: number;
}

export interface Forecast {
  /** What can be spent per day until payday without going short. */
  safeDailyCents: number;
  /** Money left over in a typical month. Negative means the month doesn't close. */
  monthlySurplusCents: number;
  /** Months of typical spending covered by savings if income stopped. */
  runwayMonths: number;
  /** How much a household this size should hold for emergencies. */
  emergencyTargetCents: number;
  status: 'comfortable' | 'tight' | 'short';
  headline: string;
  advice: string;
}

export function forecast(input: ForecastInput): Forecast {
  const days = Math.max(1, input.daysUntilPayday ?? 30);
  const free = input.availableCents - input.committedCents;
  const safeDailyCents = Math.max(0, Math.floor(free / days));

  const monthlySurplusCents = input.monthlyIncomeCents - input.monthlySpendCents;
  const runwayMonths = input.monthlySpendCents > 0 ? Math.round((input.savingsCents / input.monthlySpendCents) * 10) / 10 : 0;
  // Three months for one person, rising with the number of people depending on it.
  const months = Math.min(6, 3 + Math.max(0, input.householdSize - 1));
  const emergencyTargetCents = input.monthlySpendCents * months;

  const status: Forecast['status'] = free < 0 || monthlySurplusCents < 0 ? 'short' : safeDailyCents < 2_000 ? 'tight' : 'comfortable';

  const money = (cents: number) => `$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`;

  const headline =
    status === 'short'
      ? free < 0
        ? `You're ${money(free)} short of what's already committed before payday.`
        : `You spend ${money(monthlySurplusCents)} more than you earn in a typical month.`
      : status === 'tight'
        ? `About ${money(safeDailyCents)} a day until payday — doable, but there isn't much slack.`
        : `You can spend about ${money(safeDailyCents)} a day until payday and still cover everything.`;

  const advice =
    status === 'short'
      ? 'Start with subscriptions: blocking what you no longer use frees money every month without changing how you live.'
      : status === 'tight'
        ? `Moving ${money(Math.max(2_500, monthlySurplusCents / 4))} to savings on payday, before anything else, is what turns a tight month into a calm one.`
        : runwayMonths < months
          ? `You're in good shape. Building savings to ${money(emergencyTargetCents)} would cover ${months} months if your income stopped — you're at ${runwayMonths} months.`
          : `You're ahead: ${runwayMonths} months of expenses saved. Money beyond that could be invested rather than sitting still.`;

  return { safeDailyCents, monthlySurplusCents, runwayMonths, emergencyTargetCents, status, headline, advice };
}

// --- zero-based budgeting, made quick ---

export interface EnvelopeSuggestion {
  category: string;
  bucket: Bucket;
  /** Suggested from what they actually spent. */
  suggestedCents: number;
  /** Average of the months we looked at, for the "why this number". */
  averageCents: number;
}

/**
 * Zero-based budgeting means every dollar gets a job — which is powerful but
 * slow to set up. This pre-fills it from real history, so the customer edits a
 * finished budget instead of building one from nothing.
 */
export function suggestEnvelopes(
  history: { category: string; cents: number; months: number }[],
  monthlyIncomeCents: number,
): { envelopes: EnvelopeSuggestion[]; unassignedCents: number } {
  const envelopes = history
    .filter((h) => h.cents > 0)
    .map((h) => {
      const averageCents = Math.round(h.cents / Math.max(1, h.months));
      // Round to the nearest $5 — a budget of $47.13 is noise, not a plan.
      const suggestedCents = Math.max(500, Math.round(averageCents / 500) * 500);
      return { category: h.category, bucket: bucketFor(h.category), suggestedCents, averageCents };
    })
    .sort((a, b) => b.suggestedCents - a.suggestedCents);

  const assigned = envelopes.reduce((s, e) => s + e.suggestedCents, 0);
  return { envelopes, unassignedCents: monthlyIncomeCents - assigned };
}

export interface EnvelopeState {
  category: string;
  bucket: Bucket;
  plannedCents: number;
  spentCents: number;
  limitCents: number | null;
}

export interface EnvelopeProgress extends EnvelopeState {
  remainingCents: number;
  /** 0..1+, where over 1 is overspent. */
  used: number;
  status: 'ok' | 'close' | 'over';
}

export function envelopeProgress(envelopes: EnvelopeState[]): EnvelopeProgress[] {
  return envelopes.map((envelope) => {
    const cap = envelope.limitCents ?? envelope.plannedCents;
    const used = cap > 0 ? envelope.spentCents / cap : 0;
    return {
      ...envelope,
      remainingCents: cap - envelope.spentCents,
      used,
      status: used >= 1 ? 'over' : used >= 0.8 ? 'close' : 'ok',
    };
  });
}
