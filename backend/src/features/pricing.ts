// Pay Over Time pricing, eligibility and affordability.
//
// All the tunable numbers live in PRICING at the top of this file, so rates and
// limits can be changed in one place without touching the maths.

import { addMonths, splitCents } from '../lib/utils.js';
import type { CreditBand } from '../domain/types.js';

export const TERMS = [3, 6, 12, 24] as const;
export type Term = (typeof TERMS)[number];

export const PRICING = {
  /** Purchases below this can't be split. */
  minPurchaseCents: 100_00,

  /** Credit score floor for each band. */
  bands: {
    excellent: 750,
    good: 700,
    fair: 650,
    poor: 0,
  } as const satisfies Record<CreditBand, number>,

  /**
   * Annual rate per band and term. The 3-month plan is a merchant-funded promo
   * at 0% for everyone; longer terms carry the risk-priced rate.
   */
  apr: {
    excellent: { 3: 0, 6: 9.99, 12: 12.99, 24: 15.99 },
    good: { 3: 0, 6: 12.99, 12: 15.99, 24: 18.99 },
    fair: { 3: 0, 6: 17.99, 12: 20.99, 24: 23.99 },
    poor: { 3: 0, 6: 22.99, 12: 25.99, 24: 28.99 },
  } as const satisfies Record<CreditBand, Record<Term, number>>,

  /** Longest term each band may take. Weaker credit can't stretch as far. */
  maxTerm: { excellent: 24, good: 24, fair: 12, poor: 6 } as const satisfies Record<CreditBand, Term>,

  /** Responsible-lending caps. */
  limits: {
    maxActivePlans: 4,
    maxTotalFinancedCents: 500_000,
  },

  /**
   * Share of monthly income that may go to committed obligations, housing
   * included. Set to the standard debt-to-income bands lenders actually use:
   * 43% is the qualified-mortgage threshold, and 50% is a hard stop. A lower
   * warn level would flag almost everyone, since rent alone is often 30%+.
   */
  obligationRatio: { warn: 0.43, max: 0.5 },

  /** A missed payment costs this much of the band's headroom. */
  latePaymentPenalty: { missedPaymentsBeforeDowngrade: 2 },
} as const;

export function bandForScore(score: number): CreditBand {
  if (score >= PRICING.bands.excellent) return 'excellent';
  if (score >= PRICING.bands.good) return 'good';
  if (score >= PRICING.bands.fair) return 'fair';
  return 'poor';
}

/**
 * A history of missed payments drops the borrower a band, so pricing reflects
 * behaviour and not just the bureau score.
 */
export function effectiveBand(score: number, missedPayments: number): CreditBand {
  const base = bandForScore(score);
  if (missedPayments < PRICING.latePaymentPenalty.missedPaymentsBeforeDowngrade) return base;

  const order: CreditBand[] = ['excellent', 'good', 'fair', 'poor'];
  const index = order.indexOf(base);
  return order[Math.min(index + 1, order.length - 1)]!;
}

export interface Quote {
  termMonths: Term;
  aprPercent: number;
  /** Equal instalments; the first may carry an extra cent so the total is exact. */
  monthlyPaymentCents: number;
  /** Every instalment, in order. Sums exactly to totalCostCents. */
  scheduleCents: number[];
  totalCostCents: number;
  totalInterestCents: number;
  /** Interest expressed as a flat monthly fee, for the "fee" framing in the UI. */
  monthlyFeeCents: number;
  payoffDate: Date;
  /** False when this term is beyond what the band allows. */
  available: boolean;
  unavailableReason: string | null;
}

/**
 * Simple interest, which is how fixed-fee instalment plans actually work: the
 * fee is computed once on the original principal rather than amortised down a
 * declining balance. It makes the cost easy to state up front, which is the
 * whole point of the product.
 */
export function quote(
  principalCents: number,
  termMonths: Term,
  band: CreditBand,
  startDate: Date = new Date(),
): Quote {
  const aprPercent = PRICING.apr[band][termMonths];
  const totalInterestCents = Math.round(
    principalCents * (aprPercent / 100) * (termMonths / 12),
  );
  const totalCostCents = principalCents + totalInterestCents;

  // Split so the instalments sum to the total exactly — no lost or invented cent.
  const scheduleCents = splitCents(totalCostCents, termMonths);

  const available = termMonths <= PRICING.maxTerm[band];

  return {
    termMonths,
    aprPercent,
    monthlyPaymentCents: scheduleCents[0]!,
    scheduleCents,
    totalCostCents,
    totalInterestCents,
    monthlyFeeCents: Math.round(totalInterestCents / termMonths),
    payoffDate: addMonths(startDate, termMonths),
    available,
    unavailableReason: available
      ? null
      : `${termMonths}-month plans need a stronger credit profile. Your longest available term is ${PRICING.maxTerm[band]} months.`,
  };
}

/** Every term, for the side-by-side comparison. */
export function quoteAll(
  principalCents: number,
  band: CreditBand,
  startDate: Date = new Date(),
): Quote[] {
  return TERMS.map((term) => quote(principalCents, term, band, startDate));
}

// --- eligibility -----------------------------------------------------------

export interface EligibilityInput {
  purchaseCents: number;
  activePlanCount: number;
  totalFinancedCents: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];

  if (input.purchaseCents < PRICING.minPurchaseCents) {
    reasons.push(
      `Purchases must be at least $${PRICING.minPurchaseCents / 100} to split into payments.`,
    );
  }
  if (input.activePlanCount >= PRICING.limits.maxActivePlans) {
    reasons.push(
      `You already have ${input.activePlanCount} active plans. The limit is ${PRICING.limits.maxActivePlans}.`,
    );
  }
  if (input.totalFinancedCents + input.purchaseCents > PRICING.limits.maxTotalFinancedCents) {
    reasons.push(
      `This would take your total financed amount over the $${PRICING.limits.maxTotalFinancedCents / 100} limit.`,
    );
  }

  return { eligible: reasons.length === 0, reasons };
}

// --- affordability ---------------------------------------------------------

export interface AffordabilityInput {
  monthlyIncomeCents: number;
  /** Everything already committed each month: subscriptions, rent, existing plans. */
  existingObligationsCents: number;
  /** The payment being considered. */
  newPaymentCents: number;
}

export interface AffordabilityResult {
  /** False when the plan would push obligations past the hard cap. */
  affordable: boolean;
  /** True between the warn and max thresholds — allowed, but flagged. */
  stretched: boolean;
  obligationRatio: number;
  ratioBefore: number;
  disposableAfterCents: number;
  message: string;
}

export function checkAffordability(input: AffordabilityInput): AffordabilityResult {
  const { monthlyIncomeCents, existingObligationsCents, newPaymentCents } = input;

  // No income on record means we can't assess it; don't block, but don't reassure.
  if (monthlyIncomeCents <= 0) {
    return {
      affordable: true,
      stretched: true,
      obligationRatio: 0,
      ratioBefore: 0,
      disposableAfterCents: 0,
      message: "We couldn't verify your income, so review this plan carefully.",
    };
  }

  const before = existingObligationsCents / monthlyIncomeCents;
  const after = (existingObligationsCents + newPaymentCents) / monthlyIncomeCents;
  const disposableAfterCents =
    monthlyIncomeCents - existingObligationsCents - newPaymentCents;

  const round = (n: number): number => Math.round(n * 1000) / 1000;

  if (after > PRICING.obligationRatio.max) {
    return {
      affordable: false,
      stretched: true,
      obligationRatio: round(after),
      ratioBefore: round(before),
      disposableAfterCents,
      message: `This plan would commit ${Math.round(after * 100)}% of your monthly income. We cap plans at ${PRICING.obligationRatio.max * 100}%.`,
    };
  }

  if (after > PRICING.obligationRatio.warn) {
    return {
      affordable: true,
      stretched: true,
      obligationRatio: round(after),
      ratioBefore: round(before),
      disposableAfterCents,
      message: `This would commit ${Math.round(after * 100)}% of your monthly income. It fits, but it's tight — a shorter term costs less overall, a longer one lowers the monthly payment.`,
    };
  }

  return {
    affordable: true,
    stretched: false,
    obligationRatio: round(after),
    ratioBefore: round(before),
    disposableAfterCents,
    message: `Comfortable. This commits ${Math.round(after * 100)}% of your monthly income.`,
  };
}

// --- credit impact ---------------------------------------------------------

export interface CreditImpactInput {
  cardBalanceCents: number;
  cardLimitCents: number;
  /** The purchase moving off the revolving balance and into a plan. */
  principalCents: number;
  monthlyPaymentCents: number;
  existingObligationsCents: number;
}

export interface CreditImpact {
  utilizationBefore: number;
  utilizationAfter: number;
  monthlyObligationsBeforeCents: number;
  monthlyObligationsAfterCents: number;
  /** Plain-language read on the net effect. */
  summary: string;
}

/**
 * Splitting a purchase moves it off the revolving balance, so utilisation falls
 * while fixed monthly obligations rise. Showing both sides keeps the trade-off
 * honest rather than selling the plan.
 */
export function previewCreditImpact(input: CreditImpactInput): CreditImpact {
  const utilizationBefore =
    input.cardLimitCents > 0 ? input.cardBalanceCents / input.cardLimitCents : 0;

  const balanceAfter = Math.max(0, input.cardBalanceCents - input.principalCents);
  const utilizationAfter = input.cardLimitCents > 0 ? balanceAfter / input.cardLimitCents : 0;

  const monthlyObligationsAfterCents =
    input.existingObligationsCents + input.monthlyPaymentCents;

  const utilizationDrop = Math.round((utilizationBefore - utilizationAfter) * 100);
  const round = (n: number): number => Math.round(n * 1000) / 1000;

  return {
    utilizationBefore: round(utilizationBefore),
    utilizationAfter: round(utilizationAfter),
    monthlyObligationsBeforeCents: input.existingObligationsCents,
    monthlyObligationsAfterCents,
    summary:
      utilizationDrop > 0
        ? `Card utilisation drops ${utilizationDrop} points, which generally helps your score. In exchange you take on a fixed monthly payment.`
        : 'Your card utilisation is unchanged, and you take on a fixed monthly payment.',
  };
}

/** The dated instalment schedule written to the database when a plan is confirmed. */
export function buildSchedule(
  quoteResult: Quote,
  startDate: Date,
): { sequence: number; dueDate: Date; amountCents: number }[] {
  return quoteResult.scheduleCents.map((amountCents, index) => ({
    sequence: index + 1,
    // First payment one month after the plan starts.
    dueDate: addMonths(startDate, index + 1),
    amountCents,
  }));
}
