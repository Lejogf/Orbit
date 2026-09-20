// Subscription detection.
//
// Finds recurring charges in transaction history: same merchant, similar amount,
// regular interval. Pure functions over plain data so it can be unit tested
// without a database.

import { addDays, daysBetween, startOfDay } from '../lib/utils.js';
import type { SubscriptionFrequency } from '../domain/types.js';

export interface ChargeInput {
  id: string;
  merchantId: string;
  merchantName: string;
  category: string;
  /** Positive cents. Callers pass the absolute value of an outgoing charge. */
  amountCents: number;
  postedAt: Date;
}

export interface DetectedSubscription {
  merchantId: string;
  merchantName: string;
  category: string;
  /** The amount we expect next: the most recent charge. */
  amountCents: number;
  frequency: SubscriptionFrequency;
  intervalDays: number;
  lastChargeDate: Date;
  nextChargeDate: Date;
  /** 0..1 */
  confidence: number;
  transactionIds: string[];

  hasPriceIncrease: boolean;
  previousAmountCents: number | null;
  isFreeTrial: boolean;
  /** Set later by `flagDuplicates`, which needs to see the whole set. */
  isDuplicate: boolean;
}

// Tuning. Grouped here so the behaviour is adjustable in one place.
const RULES = {
  /** Below this, a repeated charge isn't enough evidence of a subscription. */
  minCharges: 2,
  /** Confidence at or above this is treated as a real subscription. */
  confidenceThreshold: 0.5,
  /** Amounts count as "the same" within this fraction of the median... */
  amountTolerancePercent: 0.2,
  /** ...or this many cents, whichever is more forgiving. Covers tax wobble. */
  amountToleranceCents: 150,
  /** Fraction of charges that must sit near the median to count as recurring. */
  minConsistentFraction: 0.7,
  /** A price rise must exceed both of these to be worth flagging. */
  priceIncreaseMinPercent: 0.05,
  priceIncreaseMinCents: 50,
  /** How far a gap may drift from the ideal and still match a cadence. */
  intervalTolerance: { weekly: 2, monthly: 6, yearly: 20 },
  idealDays: { weekly: 7, monthly: 30, yearly: 365 },
} as const;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

/** Nearest cadence to an observed gap, or null if it matches none. */
export function classifyInterval(days: number): SubscriptionFrequency | null {
  for (const frequency of ['weekly', 'monthly', 'yearly'] as const) {
    if (Math.abs(days - RULES.idealDays[frequency]) <= RULES.intervalTolerance[frequency]) {
      return frequency;
    }
  }
  return null;
}

/**
 * Most charges must sit near the median — but not all of them. A subscription
 * often picks up a one-off extra (an add-on, a partial month), and a single
 * outlier shouldn't hide an otherwise obvious recurring charge.
 */
function amountsAreConsistent(amounts: number[]): boolean {
  const mid = median(amounts);
  const tolerance = Math.max(mid * RULES.amountTolerancePercent, RULES.amountToleranceCents);
  const withinTolerance = amounts.filter((a) => Math.abs(a - mid) <= tolerance).length;
  return withinTolerance / amounts.length >= RULES.minConsistentFraction;
}

/**
 * Detects a price increase by locating the CHANGE POINT — the charge where the
 * price stepped up — then comparing the median before it to the median after.
 *
 * Comparing the latest charge against the median of everything earlier does not
 * work: once the new price has been billed more times than the old one, the old
 * price stops being the median and the rise becomes invisible. Netflix in the
 * demo data is exactly that case (two charges at $12.99, four at $15.49).
 */
function detectPriceIncrease(amounts: number[]): { increased: boolean; previous: number | null } {
  if (amounts.length < 3) return { increased: false, previous: null };

  // The most recent upward step large enough to be a real price change.
  let changePoint = -1;
  for (let i = 1; i < amounts.length; i++) {
    const step = amounts[i]! - amounts[i - 1]!;
    if (step > RULES.priceIncreaseMinCents && step / amounts[i - 1]! > RULES.priceIncreaseMinPercent) {
      changePoint = i;
    }
  }
  if (changePoint <= 0) return { increased: false, previous: null };

  const before = amounts.slice(0, changePoint);
  const after = amounts.slice(changePoint);
  const oldPrice = median(before);
  const newPrice = median(after);

  const rise = newPrice - oldPrice;
  if (rise <= RULES.priceIncreaseMinCents || rise / oldPrice <= RULES.priceIncreaseMinPercent) {
    return { increased: false, previous: null };
  }

  // The step has to hold. A spike that falls back is not a price increase.
  const tolerance = RULES.amountToleranceCents;
  const held = after.every((a) => a >= newPrice - tolerance);
  const wasStable = before.every((a) => a <= oldPrice + tolerance);
  if (!held || !wasStable) return { increased: false, previous: null };

  return { increased: true, previous: Math.round(oldPrice) };
}

/**
 * Confidence blends three signals: how many charges we've seen, how regular the
 * gaps are, and how stable the amount is. Each contributes independently, so a
 * subscription that's regular but drifts in price still scores reasonably.
 */
function scoreConfidence(gaps: number[], amounts: number[], intervalDays: number): number {
  // More history is better, saturating at 6 charges.
  const countScore = Math.min(amounts.length / 6, 1);

  // Regularity: penalise gap variance relative to the interval itself.
  const regularity = gaps.length > 0 ? Math.max(0, 1 - stdDev(gaps) / (intervalDays * 0.5)) : 0;

  // Amount stability, on the same idea.
  const mid = median(amounts);
  const stability = mid > 0 ? Math.max(0, 1 - stdDev(amounts) / (mid * 0.5)) : 0;

  const score = countScore * 0.3 + regularity * 0.4 + stability * 0.3;
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

/**
 * A free trial: one charge of zero, with no paid charge yet. There's no interval
 * to measure, so it's assumed monthly and dated 30 days from the authorisation —
 * which is what makes it worth warning about before it converts.
 */
function asFreeTrial(charges: ChargeInput[]): DetectedSubscription | null {
  if (charges.length !== 1) return null;
  const charge = charges[0]!;
  if (charge.amountCents !== 0) return null;

  return {
    merchantId: charge.merchantId,
    merchantName: charge.merchantName,
    category: charge.category,
    amountCents: 0,
    frequency: 'monthly',
    intervalDays: 30,
    lastChargeDate: charge.postedAt,
    nextChargeDate: addDays(charge.postedAt, 30),
    confidence: 0.6,
    transactionIds: [charge.id],
    hasPriceIncrease: false,
    previousAmountCents: null,
    isFreeTrial: true,
    isDuplicate: false,
  };
}

/** Detects subscriptions among one merchant's charges. */
function detectForMerchant(charges: ChargeInput[]): DetectedSubscription | null {
  const sorted = [...charges].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

  const trial = asFreeTrial(sorted);
  if (trial) return trial;

  // Zero-amount authorisations aren't evidence of a recurring price.
  const paid = sorted.filter((c) => c.amountCents > 0);
  if (paid.length < RULES.minCharges) return null;

  const gaps: number[] = [];
  for (let i = 1; i < paid.length; i++) {
    gaps.push(daysBetween(paid[i - 1]!.postedAt, paid[i]!.postedAt));
  }

  // The median gap resists one odd billing date skewing the cadence.
  const intervalDays = Math.round(median(gaps));
  const frequency = classifyInterval(intervalDays);
  if (!frequency) return null;

  const amounts = paid.map((c) => c.amountCents);
  if (!amountsAreConsistent(amounts)) return null;

  const confidence = scoreConfidence(gaps, amounts, intervalDays);
  if (confidence < RULES.confidenceThreshold) return null;

  const last = paid[paid.length - 1]!;
  const { increased, previous } = detectPriceIncrease(amounts);

  return {
    merchantId: last.merchantId,
    merchantName: last.merchantName,
    category: last.category,
    amountCents: last.amountCents,
    frequency,
    intervalDays,
    lastChargeDate: last.postedAt,
    nextChargeDate: addDays(last.postedAt, intervalDays),
    confidence,
    transactionIds: paid.map((c) => c.id),
    hasPriceIncrease: increased,
    previousAmountCents: previous,
    isFreeTrial: false,
    isDuplicate: false,
  };
}

/** Marks every subscription that shares a category with another. */
export function flagDuplicates(subscriptions: DetectedSubscription[]): DetectedSubscription[] {
  const countByCategory = new Map<string, number>();
  for (const sub of subscriptions) {
    countByCategory.set(sub.category, (countByCategory.get(sub.category) ?? 0) + 1);
  }

  return subscriptions.map((sub) => ({
    ...sub,
    isDuplicate: (countByCategory.get(sub.category) ?? 0) > 1,
  }));
}

/**
 * Rolls a next-charge date forward until it's in the future. A subscription
 * detected from history may have its next date already in the past.
 */
export function projectNextCharge(from: Date, intervalDays: number, today: Date): Date {
  let next = from;
  const limit = startOfDay(today);
  // Bounded so a zero/negative interval can't spin forever.
  for (let i = 0; i < 400 && next <= limit; i++) {
    next = addDays(next, Math.max(1, intervalDays));
  }
  return next;
}

export function detectSubscriptions(
  charges: ChargeInput[],
  today: Date = new Date(),
): DetectedSubscription[] {
  const byMerchant = new Map<string, ChargeInput[]>();
  for (const charge of charges) {
    const existing = byMerchant.get(charge.merchantId);
    if (existing) existing.push(charge);
    else byMerchant.set(charge.merchantId, [charge]);
  }

  const detected: DetectedSubscription[] = [];
  for (const group of byMerchant.values()) {
    const subscription = detectForMerchant(group);
    if (subscription) detected.push(subscription);
  }

  const projected = detected.map((sub) => ({
    ...sub,
    nextChargeDate: sub.isFreeTrial
      ? sub.nextChargeDate
      : projectNextCharge(sub.lastChargeDate, sub.intervalDays, today),
  }));

  return flagDuplicates(projected).sort((a, b) => b.amountCents - a.amountCents);
}

/** Monthly-equivalent cost, so totals across frequencies are comparable. */
export function toMonthlyCents(amountCents: number, frequency: SubscriptionFrequency): number {
  if (frequency === 'weekly') return Math.round((amountCents * 52) / 12);
  if (frequency === 'yearly') return Math.round(amountCents / 12);
  return amountCents;
}

export function toYearlyCents(amountCents: number, frequency: SubscriptionFrequency): number {
  if (frequency === 'weekly') return amountCents * 52;
  if (frequency === 'monthly') return amountCents * 12;
  return amountCents;
}
