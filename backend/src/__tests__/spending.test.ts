import { describe, expect, test } from 'vitest';
import {
  buildInsights,
  buildSpendingReport,
  categoryTotals,
  isSpending,
  merchantTotals,
  monthWindow,
  weekdayAverages,
  type SpendTransaction,
} from '../features/spending.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

function tx(partial: Partial<SpendTransaction> & { amountCents: number; postedAt: Date }): SpendTransaction {
  return {
    category: 'Dining',
    merchantName: 'Chipotle',
    description: 'Chipotle',
    source: 'purchase',
    ...partial,
  };
}

describe('isSpending', () => {
  test('counts purchases and withdrawals, not income or transfers', () => {
    expect(isSpending(tx({ amountCents: -1200, postedAt: utc(2026, 9, 1) }))).toBe(true);
    expect(isSpending(tx({ amountCents: 250_000, category: 'Income', source: 'deposit', postedAt: utc(2026, 9, 1) }))).toBe(false);
    expect(isSpending(tx({ amountCents: -50_000, category: 'Transfer', source: 'transfer', postedAt: utc(2026, 9, 1) }))).toBe(false);
  });
});

describe('monthWindow', () => {
  test('returns calendar months, crossing year boundaries', () => {
    const { start, end } = monthWindow(utc(2026, 1, 15), 1);
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('categoryTotals', () => {
  test('sorts by size and computes change against last month', () => {
    const current = [
      tx({ amountCents: -3000, postedAt: utc(2026, 9, 2) }),
      tx({ amountCents: -9000, category: 'Groceries', merchantName: 'Whole Foods', postedAt: utc(2026, 9, 3) }),
    ];
    const previous = [tx({ amountCents: -1000, postedAt: utc(2026, 8, 2) })];
    const totals = categoryTotals(current, previous);
    expect(totals[0]!.category).toBe('Groceries');
    expect(totals[0]!.share).toBeCloseTo(0.75);
    const dining = totals.find((t) => t.category === 'Dining')!;
    expect(dining.changeCents).toBe(2000);
  });

  test('keeps categories that dropped to zero this month', () => {
    const totals = categoryTotals([], [tx({ amountCents: -1000, category: 'Gas', postedAt: utc(2026, 8, 2) })]);
    expect(totals).toEqual([expect.objectContaining({ category: 'Gas', cents: 0, changeCents: -1000 })]);
  });
});

describe('merchantTotals', () => {
  test('groups by merchant and falls back to description', () => {
    const totals = merchantTotals([
      tx({ amountCents: -500, postedAt: utc(2026, 9, 1) }),
      tx({ amountCents: -700, postedAt: utc(2026, 9, 2) }),
      tx({ amountCents: -300, merchantName: null, description: 'ATM', postedAt: utc(2026, 9, 2) }),
    ]);
    expect(totals[0]).toEqual(expect.objectContaining({ name: 'Chipotle', cents: 1200, count: 2 }));
    expect(totals[1]!.name).toBe('ATM');
  });
});

describe('weekdayAverages', () => {
  test('averages by how many of each weekday the period contains', () => {
    // Sept 2026: Sep 5 and 12 are Saturdays.
    const list = [tx({ amountCents: -1000, postedAt: utc(2026, 9, 5) }), tx({ amountCents: -3000, postedAt: utc(2026, 9, 12) })];
    const result = weekdayAverages(list, new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 15)));
    expect(result.find((d) => d.day === 'Sat')!.cents).toBe(2000);
    expect(result.find((d) => d.day === 'Mon')!.cents).toBe(0);
  });
});

describe('buildInsights', () => {
  const baseInput = {
    categories: [],
    totalCents: 0,
    previousTotalCents: 0,
    incomeCents: 0,
    byWeekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, cents: 0 })),
    recurringCents: 0,
    merchants: [],
    monthProgress: 1,
  };

  test('projects a half month forward before comparing pace', () => {
    const insights = buildInsights({ ...baseInput, totalCents: 60_000, previousTotalCents: 100_000, monthProgress: 0.5 });
    expect(insights.find((i) => i.id === 'pace')).toEqual(expect.objectContaining({ tone: 'warn' }));
    expect(insights.find((i) => i.id === 'pace')!.title).toContain('20% more');
  });

  test('flags a weekend habit only when it is meaningful', () => {
    const byWeekday = baseInput.byWeekday.map((d) => ({ ...d, cents: ['Sat', 'Sun'].includes(d.day) ? 5000 : 2000 }));
    expect(buildInsights({ ...baseInput, byWeekday }).some((i) => i.id === 'weekend')).toBe(true);
    const flat = baseInput.byWeekday.map((d) => ({ ...d, cents: 2000 }));
    expect(buildInsights({ ...baseInput, byWeekday: flat }).some((i) => i.id === 'weekend')).toBe(false);
  });

  test('reports overspending against income plainly', () => {
    const insights = buildInsights({ ...baseInput, totalCents: 120_000, incomeCents: 100_000 });
    expect(insights.find((i) => i.id === 'savings-rate')).toEqual(
      expect.objectContaining({ tone: 'warn', title: 'You spent $200.00 more than came in' }),
    );
  });

  test('ignores small category movements', () => {
    const categories = [{ category: 'Dining', cents: 5000, share: 1, count: 3, previousCents: 4000, changeCents: 1000 }];
    expect(buildInsights({ ...baseInput, categories }).some((i) => i.id.startsWith('mover'))).toBe(false);
  });
});

describe('buildSpendingReport', () => {
  test('produces a six-month trend and counts recurring merchants', () => {
    const now = utc(2026, 9, 20);
    const list = [
      tx({ amountCents: -1549, merchantName: 'Netflix', category: 'Streaming', postedAt: utc(2026, 9, 3) }),
      tx({ amountCents: -4000, postedAt: utc(2026, 9, 10) }),
      tx({ amountCents: -2000, postedAt: utc(2026, 7, 10) }),
      tx({ amountCents: 300_000, category: 'Income', source: 'deposit', merchantName: null, postedAt: utc(2026, 9, 1) }),
    ];
    const report = buildSpendingReport(list, { now, recurringCategories: new Set(['Netflix']) });
    expect(report.totalCents).toBe(5549);
    expect(report.incomeCents).toBe(300_000);
    expect(report.recurringCents).toBe(1549);
    expect(report.trend).toHaveLength(6);
    expect(report.trend.at(-1)!.cents).toBe(5549);
    expect(report.trend.at(-3)!.cents).toBe(2000);
    expect(report.period.label).toBe('Sep 2026');
  });
});
