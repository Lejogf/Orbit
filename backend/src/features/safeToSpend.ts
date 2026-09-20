// Safe to Spend and the upcoming-payments timeline.
//
// Safe to Spend answers one question: of the money sitting in checking, how much
// is genuinely free once everything already committed before the next payday is
// accounted for? Blocked and cancelled subscriptions are excluded, which is what
// makes the number move the moment the user takes action.

import { addDays, daysBetween, startOfDay } from '../lib/utils.js';

export type TimelineKind = 'subscription' | 'installment' | 'income';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  label: string;
  /** Signed cents: negative is money out. */
  amountCents: number;
  date: Date;
  category: string;
  /** Subscriptions only — surfaces a trial about to convert. */
  isFreeTrialConversion?: boolean;
}

export interface UpcomingSubscription {
  id: string;
  merchantName: string;
  category: string;
  amountCents: number;
  nextChargeDate: Date;
  status: string;
  isFreeTrial: boolean;
}

export interface UpcomingInstallment {
  id: string;
  label: string;
  amountCents: number;
  dueDate: Date;
}

export interface SafeToSpendInput {
  checkingBalanceCents: number;
  /** Dates of recent paycheck deposits, used to infer the next one. */
  paydayHistory: Date[];
  /** Typical paycheck, shown as incoming money on the timeline. */
  paycheckAmountCents?: number;
  subscriptions: UpcomingSubscription[];
  installments: UpcomingInstallment[];
  today?: Date;
}

export interface SafeToSpendResult {
  safeToSpendCents: number;
  checkingBalanceCents: number;
  committedCents: number;
  nextPayday: Date | null;
  daysUntilPayday: number | null;
  /** What's counted against the balance, most imminent first. */
  upcoming: TimelineItem[];
  /** Committed money that no longer counts, because it was blocked or cancelled. */
  avoidedCents: number;
}

/** A subscription only counts against the balance while it can still charge. */
const COUNTS_AGAINST_BALANCE = new Set(['active', 'guarded']);

/**
 * Infers the paycheck cadence from recent deposits and projects the next one.
 * Returns null when there isn't enough history to be confident.
 */
export function predictNextPayday(paydayHistory: Date[], today: Date): Date | null {
  if (paydayHistory.length < 2) return null;

  const sorted = [...paydayHistory].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(sorted[i - 1]!, sorted[i]!));
  }

  // Median gap, so one irregular deposit doesn't distort the cadence.
  const ordered = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const cadence =
    ordered.length % 2 === 0 ? Math.round((ordered[mid - 1]! + ordered[mid]!) / 2) : ordered[mid]!;

  if (cadence <= 0) return null;

  let next = sorted[sorted.length - 1]!;
  const limit = startOfDay(today);
  for (let i = 0; i < 400 && next <= limit; i++) {
    next = addDays(next, cadence);
  }
  return next;
}

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const today = startOfDay(input.today ?? new Date());
  const nextPayday = predictNextPayday(input.paydayHistory, today);

  // With no payday on record, look a fortnight ahead rather than returning nothing.
  const horizon = nextPayday ?? addDays(today, 14);

  const upcoming: TimelineItem[] = [];
  let committedCents = 0;
  let avoidedCents = 0;

  for (const subscription of input.subscriptions) {
    const due = startOfDay(subscription.nextChargeDate);
    if (due < today || due > horizon) continue;

    if (!COUNTS_AGAINST_BALANCE.has(subscription.status)) {
      // Blocked or cancelled: it would have been charged, but it won't be.
      avoidedCents += subscription.amountCents;
      continue;
    }

    committedCents += subscription.amountCents;
    upcoming.push({
      id: subscription.id,
      kind: 'subscription',
      label: subscription.merchantName,
      amountCents: -subscription.amountCents,
      date: due,
      category: subscription.category,
      isFreeTrialConversion: subscription.isFreeTrial,
    });
  }

  for (const installment of input.installments) {
    const due = startOfDay(installment.dueDate);
    if (due < today || due > horizon) continue;

    committedCents += installment.amountCents;
    upcoming.push({
      id: installment.id,
      kind: 'installment',
      label: installment.label,
      amountCents: -installment.amountCents,
      date: due,
      category: 'Pay Over Time',
    });
  }

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    safeToSpendCents: input.checkingBalanceCents - committedCents,
    checkingBalanceCents: input.checkingBalanceCents,
    committedCents,
    nextPayday,
    daysUntilPayday: nextPayday ? daysBetween(today, nextPayday) : null,
    upcoming,
    avoidedCents,
  };
}

/**
 * The full timeline, which looks further ahead than Safe to Spend and includes
 * incoming pay so the user can see money arriving as well as leaving.
 */
export function buildTimeline(
  input: SafeToSpendInput & { daysAhead?: number },
): TimelineItem[] {
  const today = startOfDay(input.today ?? new Date());
  const horizon = addDays(today, input.daysAhead ?? 45);
  const items: TimelineItem[] = [];

  for (const subscription of input.subscriptions) {
    if (!COUNTS_AGAINST_BALANCE.has(subscription.status)) continue;

    // Project repeats across the window, not just the next one.
    let due = startOfDay(subscription.nextChargeDate);
    let guard = 0;
    while (due <= horizon && guard++ < 12) {
      if (due >= today) {
        items.push({
          id: `${subscription.id}-${due.toISOString().slice(0, 10)}`,
          kind: 'subscription',
          label: subscription.merchantName,
          amountCents: -subscription.amountCents,
          date: due,
          category: subscription.category,
          isFreeTrialConversion: subscription.isFreeTrial,
        });
      }
      due = addDays(due, 30);
    }
  }

  for (const installment of input.installments) {
    const due = startOfDay(installment.dueDate);
    if (due >= today && due <= horizon) {
      items.push({
        id: installment.id,
        kind: 'installment',
        label: installment.label,
        amountCents: -installment.amountCents,
        date: due,
        category: 'Pay Over Time',
      });
    }
  }

  // Incoming pay, projected on the inferred cadence.
  const nextPayday = predictNextPayday(input.paydayHistory, today);
  if (nextPayday && input.paydayHistory.length >= 2) {
    const sorted = [...input.paydayHistory].sort((a, b) => a.getTime() - b.getTime());
    const cadence = daysBetween(sorted[sorted.length - 2]!, sorted[sorted.length - 1]!);
    const amount = input.paycheckAmountCents ?? 0;

    let payday = nextPayday;
    let guard = 0;
    while (payday <= horizon && guard++ < 12 && cadence > 0) {
      items.push({
        id: `payday-${payday.toISOString().slice(0, 10)}`,
        kind: 'income',
        label: 'Paycheck',
        amountCents: amount,
        date: payday,
        category: 'Income',
      });
      payday = addDays(payday, cadence);
    }
  }

  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}
