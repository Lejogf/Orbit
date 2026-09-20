// Credit score estimation and what-if simulation.
//
// IMPORTANT: this is a directional ESTIMATE, not a FICO score. A real score
// needs bureau data — accounts at other lenders, hard inquiries, collections,
// public records — none of which this app can see. What it models is the
// behaviour Flow *can* observe, using the published FICO factor weights, so the
// direction and rough magnitude of a change are meaningful even though the
// absolute number is not authoritative.
//
// Every function is pure so the model can be tested against fixed inputs.

export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

/** Published FICO factor weights. They sum to 1. */
export const FACTOR_WEIGHTS = {
  paymentHistory: 0.35,
  utilization: 0.3,
  historyLength: 0.15,
  creditMix: 0.1,
  newCredit: 0.1,
} as const;

export type FactorKey = keyof typeof FACTOR_WEIGHTS;

export interface CreditInputs {
  /** Instalments paid on time across all plans. */
  onTimePayments: number;
  /** Payments missed. Weighs heavily and recovers slowly, as in reality. */
  missedPayments: number;
  /** Revolving balance owed on cards, in cents. */
  cardBalanceCents: number;
  /** Total revolving limit, in cents. */
  cardLimitCents: number;
  /** How long this person has had credit, in months. */
  historyMonths: number;
  /** Distinct account types held: checking, savings, credit card. */
  accountTypes: number;
  /** Active instalment loans — a different kind of credit from revolving. */
  activeLoans: number;
  /** Credit accounts opened in the last 12 months. */
  recentlyOpened: number;
}

export interface FactorResult {
  key: FactorKey;
  label: string;
  /** 0..1, before weighting. */
  score: number;
  weight: number;
  /** Points this factor contributes to the final score. */
  points: number;
  /** What drove it, in plain language. */
  detail: string;
  /** Best, ok, or needs work — drives the colour in the UI. */
  standing: 'strong' | 'fair' | 'weak';
}

export interface CreditEstimate {
  score: number;
  band: CreditBandLabel;
  factors: FactorResult[];
  /** Utilisation as a ratio, surfaced separately because it's the actionable one. */
  utilization: number;
}

export type CreditBandLabel = 'Exceptional' | 'Very good' | 'Good' | 'Fair' | 'Poor';

export function bandLabel(score: number): CreditBandLabel {
  if (score >= 800) return 'Exceptional';
  if (score >= 740) return 'Very good';
  if (score >= 670) return 'Good';
  if (score >= 580) return 'Fair';
  return 'Poor';
}

/** Linear interpolation between stops on a piecewise curve. */
function curve(value: number, stops: readonly [number, number][]): number {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];

  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i]!;
    const [x0, y0] = stops[i - 1]!;
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

function standing(score: number): FactorResult['standing'] {
  if (score >= 0.8) return 'strong';
  if (score >= 0.5) return 'fair';
  return 'weak';
}

/** Utilisation ratio, guarding against a missing or zero limit. */
export function utilizationOf(balanceCents: number, limitCents: number): number {
  if (limitCents <= 0) return 0;
  return Math.max(0, balanceCents) / limitCents;
}

function paymentHistoryFactor(input: CreditInputs): FactorResult {
  const total = input.onTimePayments + input.missedPayments;

  // A clean record still has to be deep enough to mean something: three on-time
  // payments is not the same evidence as thirty. Perfect-but-thin therefore
  // scores well without scoring full marks, which is why a brand-new borrower
  // does not start at the top of the range.
  const depth = curve(input.onTimePayments, [
    [0, 0.72],
    [6, 0.8],
    [12, 0.86],
    [24, 0.94],
    [36, 1],
  ]);

  // The first missed payment is by far the most damaging — scoring models treat
  // one lapse as a much bigger signal than the difference between three and
  // four. A flat per-miss penalty would understate that first drop and then
  // overstate everything after it.
  const penalty = curve(input.missedPayments, [
    [0, 0],
    [1, 0.35],
    [2, 0.52],
    [3, 0.63],
    [5, 0.78],
    [10, 0.92],
  ]);

  const score = total === 0 ? 0.72 : Math.max(0, depth - penalty);

  return {
    key: 'paymentHistory',
    label: 'Payment history',
    score,
    weight: FACTOR_WEIGHTS.paymentHistory,
    points: 0,
    detail:
      input.missedPayments === 0
        ? total === 0
          ? 'No payment history yet. Paying a plan on time builds this.'
          : `${input.onTimePayments} payments, all on time.`
        : `${input.missedPayments} missed payment${input.missedPayments === 1 ? '' : 's'}. This is the heaviest factor and recovers slowly.`,
    standing: standing(score),
  };
}

function utilizationFactor(input: CreditInputs): FactorResult {
  const utilization = utilizationOf(input.cardBalanceCents, input.cardLimitCents);

  // Under 10% is ideal; past 50% it falls away sharply, which is how scoring
  // models actually treat revolving balances.
  const score = curve(utilization, [
    [0, 1],
    [0.1, 0.93],
    [0.3, 0.65],
    [0.5, 0.4],
    [0.75, 0.18],
    [1, 0.05],
  ]);

  return {
    key: 'utilization',
    label: 'Credit utilisation',
    score,
    weight: FACTOR_WEIGHTS.utilization,
    points: 0,
    detail: `Using ${Math.round(utilization * 100)}% of your limit. Under 30% is healthy; under 10% is ideal.`,
    standing: standing(score),
  };
}

function historyLengthFactor(input: CreditInputs): FactorResult {
  // Seven years of history is where this factor stops improving much.
  const score = curve(input.historyMonths, [
    [0, 0.15],
    [12, 0.4],
    [36, 0.65],
    [60, 0.82],
    [84, 0.95],
    [120, 1],
  ]);

  const years = Math.floor(input.historyMonths / 12);
  return {
    key: 'historyLength',
    label: 'Length of history',
    score,
    weight: FACTOR_WEIGHTS.historyLength,
    points: 0,
    detail:
      input.historyMonths < 12
        ? `${input.historyMonths} months of credit history. This one only improves with time.`
        : `${years} year${years === 1 ? '' : 's'} of credit history.`,
    standing: standing(score),
  };
}

function creditMixFactor(input: CreditInputs): FactorResult {
  // Lenders like seeing both revolving credit and instalment credit handled well.
  const typeScore = curve(input.accountTypes, [
    [0, 0.1],
    [1, 0.4],
    [2, 0.6],
    [3, 0.78],
  ]);
  const loanBonus = input.activeLoans > 0 ? 0.22 : 0;
  const score = Math.min(1, typeScore + loanBonus);

  return {
    key: 'creditMix',
    label: 'Credit mix',
    score,
    weight: FACTOR_WEIGHTS.creditMix,
    points: 0,
    detail:
      input.activeLoans > 0
        ? `${input.accountTypes} account types plus an instalment plan — a healthy mix.`
        : `${input.accountTypes} account types, all revolving or deposit. An instalment plan would add variety.`,
    standing: standing(score),
  };
}

function newCreditFactor(input: CreditInputs): FactorResult {
  // Opening several lines at once reads as distress, so each recent one costs.
  const score = curve(input.recentlyOpened, [
    [0, 1],
    [1, 0.85],
    [2, 0.65],
    [3, 0.45],
    [5, 0.2],
  ]);

  return {
    key: 'newCredit',
    label: 'New credit',
    score,
    weight: FACTOR_WEIGHTS.newCredit,
    points: 0,
    detail:
      input.recentlyOpened === 0
        ? 'Nothing opened recently.'
        : `${input.recentlyOpened} credit line${input.recentlyOpened === 1 ? '' : 's'} opened in the last year.`,
    standing: standing(score),
  };
}

export function estimateScore(input: CreditInputs): CreditEstimate {
  const factors = [
    paymentHistoryFactor(input),
    utilizationFactor(input),
    historyLengthFactor(input),
    creditMixFactor(input),
    newCreditFactor(input),
  ];

  const weighted = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const score = Math.round(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * weighted);

  // Attribute the final number back to each factor, so the UI can show where
  // the points came from rather than just a total.
  const span = SCORE_MAX - SCORE_MIN;
  const withPoints = factors.map((f) => ({
    ...f,
    points: Math.round(f.score * f.weight * span),
  }));

  return {
    score,
    band: bandLabel(score),
    factors: withPoints,
    utilization: utilizationOf(input.cardBalanceCents, input.cardLimitCents),
  };
}

// --- what-if scenarios ---------------------------------------------------

export type ScenarioId =
  | 'pay_off_card'
  | 'pay_half_card'
  | 'split_purchase'
  | 'miss_payment'
  | 'block_subscriptions'
  | 'open_new_card'
  | 'wait_a_year';

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** What the user would actually do. */
  description: string;
  apply: (input: CreditInputs) => CreditInputs;
}

export interface ScenarioInput {
  /** Monthly subscription spend that could be stopped, in cents. */
  blockableSubscriptionCents: number;
  /** A purchase eligible to move off the revolving balance, in cents. */
  splittablePurchaseCents: number;
}

export function scenariosFor(context: ScenarioInput): Scenario[] {
  return [
    {
      id: 'pay_off_card',
      label: 'Pay off your card',
      description: 'Clear the full balance before the statement closes.',
      apply: (input) => ({ ...input, cardBalanceCents: 0 }),
    },
    {
      id: 'pay_half_card',
      label: 'Pay half your balance',
      description: 'A partial payment still moves utilisation.',
      apply: (input) => ({ ...input, cardBalanceCents: Math.round(input.cardBalanceCents / 2) }),
    },
    {
      id: 'split_purchase',
      label: 'Split a large purchase',
      description:
        'Moves the purchase off your revolving balance into a fixed instalment plan, which lowers utilisation and adds credit mix.',
      apply: (input) => ({
        ...input,
        cardBalanceCents: Math.max(0, input.cardBalanceCents - context.splittablePurchaseCents),
        activeLoans: input.activeLoans + 1,
        // A new plan is still a new credit line.
        recentlyOpened: input.recentlyOpened + 1,
      }),
    },
    {
      id: 'block_subscriptions',
      label: 'Stop unused subscriptions',
      description:
        'Less recurring spend means a lower balance each month, which shows up as lower utilisation.',
      apply: (input) => ({
        ...input,
        cardBalanceCents: Math.max(0, input.cardBalanceCents - context.blockableSubscriptionCents),
      }),
    },
    {
      id: 'miss_payment',
      label: 'Miss one payment',
      description: 'What a single missed instalment would cost you.',
      apply: (input) => ({ ...input, missedPayments: input.missedPayments + 1 }),
    },
    {
      id: 'open_new_card',
      label: 'Open another card',
      description: 'More total limit helps utilisation, but a new account costs you short term.',
      apply: (input) => ({
        ...input,
        cardLimitCents: input.cardLimitCents + 500_000,
        recentlyOpened: input.recentlyOpened + 1,
      }),
    },
    {
      id: 'wait_a_year',
      label: 'Change nothing for a year',
      description: 'History lengthens and recent activity ages off on its own.',
      apply: (input) => ({
        ...input,
        historyMonths: input.historyMonths + 12,
        recentlyOpened: Math.max(0, input.recentlyOpened - 1),
      }),
    },
  ];
}

export interface ScenarioResult {
  id: ScenarioId;
  label: string;
  description: string;
  score: number;
  band: CreditBandLabel;
  /** Signed change from the current score. */
  delta: number;
}

export function simulate(
  input: CreditInputs,
  context: ScenarioInput,
  baseline = estimateScore(input).score,
): ScenarioResult[] {
  return scenariosFor(context)
    .map((scenario) => {
      const result = estimateScore(scenario.apply(input));
      return {
        id: scenario.id,
        label: scenario.label,
        description: scenario.description,
        score: result.score,
        band: result.band,
        delta: result.score - baseline,
      };
    })
    // Biggest improvement first; the most damaging scenario lands last.
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Applies several scenarios at once, for the combined "what if I did all of
 * this" view.
 */
export function simulateCombined(
  input: CreditInputs,
  context: ScenarioInput,
  ids: ScenarioId[],
): CreditEstimate {
  const byId = new Map(scenariosFor(context).map((s) => [s.id, s]));
  const applied = ids.reduce((current, id) => byId.get(id)?.apply(current) ?? current, input);
  return estimateScore(applied);
}
