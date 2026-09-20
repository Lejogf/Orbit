// Spending insights: where the money went, how that compares with last month,
// and the habits worth knowing about.
//
// Pure functions over plain transactions, so every number on the Spending page
// can be tested without a database. Insights are written in plain language and
// always carry the figure behind them — "Dining is up" is useless without "$84".

import { formatCents } from '../lib/utils.js';

export interface SpendTransaction {
  /** Signed cents. Negative = money out. */
  amountCents: number;
  category: string;
  merchantName: string | null;
  description: string;
  postedAt: Date;
  source: string;
}

/** Categories that move money around rather than spend it. */
const NOT_SPENDING = new Set(['Transfer', 'Income', 'Payment']);

export function isSpending(tx: SpendTransaction): boolean {
  if (tx.amountCents >= 0) return false;
  if (tx.source === 'transfer' || tx.source === 'deposit') return false;
  return !NOT_SPENDING.has(tx.category);
}

export interface CategoryTotal {
  category: string;
  cents: number;
  share: number;
  count: number;
  previousCents: number;
  /** Change vs the previous period, in cents. Positive = spent more. */
  changeCents: number;
}

export interface MerchantTotal {
  name: string;
  cents: number;
  count: number;
  category: string;
}

export interface Insight {
  id: string;
  tone: 'good' | 'warn' | 'info';
  title: string;
  body: string;
}

export interface SpendingReport {
  period: { start: string; end: string; label: string };
  totalCents: number;
  previousTotalCents: number;
  incomeCents: number;
  categories: CategoryTotal[];
  merchants: MerchantTotal[];
  /** Mon..Sun average spend per day of week in the period. */
  byWeekday: { day: string; cents: number }[];
  /** Month-by-month totals for the trend chart, oldest first. */
  trend: { month: string; label: string; cents: number }[];
  /** Committed (recurring) spend vs everything else, the thesis of the app. */
  recurringCents: number;
  insights: Insight[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

/** [start, end) of the calendar month `offset` months before the one containing `now`. */
export function monthWindow(now: Date, offset = 0): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - offset;
  return { start: monthStart(y, m), end: monthStart(y, m + 1) };
}

function within(tx: SpendTransaction, start: Date, end: Date): boolean {
  return tx.postedAt >= start && tx.postedAt < end;
}

/** Monday = 0. */
function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function sumOut(list: SpendTransaction[]): number {
  return list.reduce((sum, tx) => sum + -tx.amountCents, 0);
}

export function categoryTotals(
  current: SpendTransaction[],
  previous: SpendTransaction[],
): CategoryTotal[] {
  const total = sumOut(current);
  const byCat = new Map<string, { cents: number; count: number }>();
  for (const tx of current) {
    const row = byCat.get(tx.category) ?? { cents: 0, count: 0 };
    byCat.set(tx.category, { cents: row.cents + -tx.amountCents, count: row.count + 1 });
  }

  const prevByCat = new Map<string, number>();
  for (const tx of previous) {
    prevByCat.set(tx.category, (prevByCat.get(tx.category) ?? 0) + -tx.amountCents);
  }

  // Categories that vanished this month still matter: "you spent nothing on X".
  for (const category of prevByCat.keys()) {
    if (!byCat.has(category)) byCat.set(category, { cents: 0, count: 0 });
  }

  return [...byCat.entries()]
    .map(([category, row]) => {
      const previousCents = prevByCat.get(category) ?? 0;
      return {
        category,
        cents: row.cents,
        count: row.count,
        share: total > 0 ? row.cents / total : 0,
        previousCents,
        changeCents: row.cents - previousCents,
      };
    })
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
}

export function merchantTotals(list: SpendTransaction[], limit = 8): MerchantTotal[] {
  const byName = new Map<string, MerchantTotal>();
  for (const tx of list) {
    const name = tx.merchantName ?? tx.description;
    const row = byName.get(name) ?? { name, cents: 0, count: 0, category: tx.category };
    byName.set(name, { ...row, cents: row.cents + -tx.amountCents, count: row.count + 1 });
  }
  return [...byName.values()].sort((a, b) => b.cents - a.cents).slice(0, limit);
}

/** Average spend on each day of the week, so a month with five Saturdays isn't skewed. */
export function weekdayAverages(list: SpendTransaction[], start: Date, end: Date) {
  const occurrences = new Array<number>(7).fill(0);
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    occurrences[weekdayIndex(d)]! += 1;
  }
  const totals = new Array<number>(7).fill(0);
  for (const tx of list) totals[weekdayIndex(tx.postedAt)]! += -tx.amountCents;

  return WEEKDAYS.map((day, i) => ({
    day,
    cents: occurrences[i]! > 0 ? Math.round(totals[i]! / occurrences[i]!) : 0,
  }));
}

export interface InsightInput {
  categories: CategoryTotal[];
  totalCents: number;
  previousTotalCents: number;
  incomeCents: number;
  byWeekday: { day: string; cents: number }[];
  recurringCents: number;
  merchants: MerchantTotal[];
  /** Fraction of the month elapsed, so a half-month isn't compared to a full one. */
  monthProgress: number;
}

/** Only changes bigger than this are worth a sentence. */
const MEANINGFUL_CHANGE_CENTS = 2_500;

export function buildInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  // Pace: project the month to date forward before comparing it.
  if (input.previousTotalCents > 0 && input.monthProgress > 0.15) {
    const projected = Math.round(input.totalCents / Math.min(1, input.monthProgress));
    const diff = projected - input.previousTotalCents;
    const pct = Math.round((Math.abs(diff) / input.previousTotalCents) * 100);
    if (pct >= 10) {
      insights.push({
        id: 'pace',
        tone: diff > 0 ? 'warn' : 'good',
        title:
          diff > 0
            ? `On pace to spend ${pct}% more than last month`
            : `On pace to spend ${pct}% less than last month`,
        body: `At this rate you'll spend about ${formatCents(projected)} this month, against ${formatCents(input.previousTotalCents)} last month.`,
      });
    }
  }

  // The biggest mover, up or down.
  const movers = input.categories
    .filter((c) => Math.abs(c.changeCents) >= MEANINGFUL_CHANGE_CENTS && c.previousCents > 0)
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents));
  const mover = movers[0];
  if (mover) {
    const up = mover.changeCents > 0;
    insights.push({
      id: `mover-${mover.category}`,
      tone: up ? 'warn' : 'good',
      title: `${mover.category} is ${up ? 'up' : 'down'} ${formatCents(Math.abs(mover.changeCents))}`,
      body: `${formatCents(mover.cents)} so far this month, compared with ${formatCents(mover.previousCents)} last month.`,
    });
  }

  // Weekend vs weekday habit.
  const weekday = input.byWeekday.slice(0, 5).reduce((s, d) => s + d.cents, 0) / 5;
  const weekend = input.byWeekday.slice(5).reduce((s, d) => s + d.cents, 0) / 2;
  if (weekday > 0 && weekend > weekday * 1.25) {
    const pct = Math.round(((weekend - weekday) / weekday) * 100);
    insights.push({
      id: 'weekend',
      tone: 'info',
      title: `You spend ${pct}% more on weekends`,
      body: `About ${formatCents(Math.round(weekend))} a day on Saturdays and Sundays, versus ${formatCents(Math.round(weekday))} on weekdays.`,
    });
  }

  // Committed money: the number this app exists to surface.
  if (input.totalCents > 0 && input.recurringCents > 0) {
    const pct = Math.round((input.recurringCents / input.totalCents) * 100);
    insights.push({
      id: 'recurring',
      tone: pct >= 25 ? 'warn' : 'info',
      title: `${pct}% of your spending was decided before the month began`,
      body: `${formatCents(input.recurringCents)} went to subscriptions and other recurring charges. Review them on the Subscriptions page.`,
    });
  }

  // Savings rate against income.
  if (input.incomeCents > 0) {
    const left = input.incomeCents - input.totalCents;
    const pct = Math.round((left / input.incomeCents) * 100);
    insights.push({
      id: 'savings-rate',
      tone: pct >= 20 ? 'good' : pct >= 0 ? 'info' : 'warn',
      title:
        left >= 0
          ? `You kept ${pct}% of what came in`
          : `You spent ${formatCents(-left)} more than came in`,
      body: `${formatCents(input.incomeCents)} in, ${formatCents(input.totalCents)} out this month.`,
    });
  }

  // One merchant taking an outsized share.
  const top = input.merchants[0];
  if (top && input.totalCents > 0 && top.cents / input.totalCents >= 0.2 && top.count >= 3) {
    insights.push({
      id: 'top-merchant',
      tone: 'info',
      title: `${top.name} is your biggest merchant`,
      body: `${top.count} visits, ${formatCents(top.cents)} in total — ${Math.round((top.cents / input.totalCents) * 100)}% of your spending.`,
    });
  }

  return insights;
}

export function buildSpendingReport(
  transactions: SpendTransaction[],
  options: { now: Date; monthOffset?: number; recurringCategories?: Set<string>; months?: number },
): SpendingReport {
  const offset = options.monthOffset ?? 0;
  const { start, end } = monthWindow(options.now, offset);
  const prev = monthWindow(options.now, offset + 1);

  const spending = transactions.filter(isSpending);
  const current = spending.filter((tx) => within(tx, start, end));
  const previous = spending.filter((tx) => within(tx, prev.start, prev.end));

  const income = transactions
    .filter((tx) => tx.amountCents > 0 && tx.category === 'Income' && within(tx, start, end))
    .reduce((s, tx) => s + tx.amountCents, 0);

  const totalCents = sumOut(current);
  const previousTotalCents = sumOut(previous);
  const categories = categoryTotals(current, previous);
  const merchants = merchantTotals(current);

  // For the current month, weekday averages only count the days that have happened.
  const effectiveEnd = offset === 0 && options.now < end ? options.now : end;
  const byWeekday = weekdayAverages(current, start, effectiveEnd);

  const recurring = options.recurringCategories ?? new Set<string>();
  const recurringCents = current
    .filter((tx) => recurring.has(tx.merchantName ?? ''))
    .reduce((s, tx) => s + -tx.amountCents, 0);

  const monthLength = end.getTime() - start.getTime();
  const monthProgress =
    offset === 0 ? Math.max(0, Math.min(1, (options.now.getTime() - start.getTime()) / monthLength)) : 1;

  const months = options.months ?? 6;
  const trend = Array.from({ length: months }, (_, i) => {
    const w = monthWindow(options.now, offset + months - 1 - i);
    return {
      month: w.start.toISOString().slice(0, 7),
      label: MONTHS[w.start.getUTCMonth()]!,
      cents: sumOut(spending.filter((tx) => within(tx, w.start, w.end))),
    };
  });

  return {
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    },
    totalCents,
    previousTotalCents,
    incomeCents: income,
    categories,
    merchants,
    byWeekday,
    trend,
    recurringCents,
    insights: buildInsights({
      categories,
      totalCents,
      previousTotalCents,
      incomeCents: income,
      byWeekday,
      recurringCents,
      merchants,
      monthProgress,
    }),
  };
}
