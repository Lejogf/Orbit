import { describe, expect, test } from 'vitest';
import { RULES, averageMonths, bucketFor, buildPlan, envelopeProgress, forecast, suggestEnvelopes } from '../features/budget.js';

describe('averageMonths', () => {
  const months = [
    { month: '2026-06', incomeCents: 400_000, spendCents: 300_000 },
    { month: '2026-07', incomeCents: 400_000, spendCents: 340_000 },
    { month: '2026-08', incomeCents: 400_000, spendCents: 260_000 },
    { month: '2026-09', incomeCents: 120_000, spendCents: 90_000 }, // half-done month
  ];

  test('ignores the current, incomplete month', () => {
    const result = averageMonths(months, '2026-09');
    expect(result.monthsCounted).toBe(3);
    expect(result.monthlyIncomeCents).toBe(400_000);
    expect(result.monthlySpendCents).toBe(300_000);
  });

  test('reports how irregular spending is', () => {
    expect(averageMonths(months, '2026-09').volatility).toBeCloseTo(0.089, 2);
    const steady = averageMonths(
      [
        { month: '2026-06', incomeCents: 100, spendCents: 100 },
        { month: '2026-07', incomeCents: 100, spendCents: 100 },
      ],
      '2026-09',
    );
    expect(steady.volatility).toBe(0);
  });

  test('handles a brand new account', () => {
    expect(averageMonths([], '2026-09')).toEqual({ monthlyIncomeCents: 0, monthlySpendCents: 0, monthsCounted: 0, volatility: 0 });
  });
});

describe('buildPlan', () => {
  test('50/30/20 splits take-home pay three ways', () => {
    const plan = buildPlan('rule5030', 500_000, { needs: 200_000, wants: 180_000, savings: 50_000, debt: 0 });
    expect(plan.map((p) => [p.bucket, p.plannedCents])).toEqual([
      ['needs', 250_000],
      ['wants', 150_000],
      ['savings', 100_000],
    ]);
    // Over on wants, under on needs.
    expect(plan.find((p) => p.bucket === 'wants')!.differenceCents).toBe(-30_000);
    expect(plan.find((p) => p.bucket === 'needs')!.differenceCents).toBe(50_000);
  });

  test('70/10/10/10 adds a debt slice', () => {
    const plan = buildPlan('rule70101010', 400_000, { needs: 0, wants: 0, savings: 0, debt: 0 });
    expect(plan.map((p) => p.bucket).sort()).toEqual(['debt', 'needs', 'savings', 'wants']);
    expect(plan.find((p) => p.bucket === 'debt')!.plannedCents).toBe(40_000);
  });

  test('every rule adds up to the whole paycheck', () => {
    for (const rule of Object.values(RULES)) {
      const total = Object.values(rule.split).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });
});

describe('bucketFor', () => {
  test('sorts essentials from extras, and defaults to wants', () => {
    expect(bucketFor('Groceries')).toBe('needs');
    expect(bucketFor('Streaming')).toBe('wants');
    expect(bucketFor('Pay Over Time')).toBe('debt');
    expect(bucketFor('Something New')).toBe('wants');
  });
});

describe('forecast', () => {
  const base = {
    availableCents: 200_000,
    committedCents: 50_000,
    daysUntilPayday: 15,
    monthlyIncomeCents: 500_000,
    monthlySpendCents: 400_000,
    savingsCents: 1_200_000,
    householdSize: 1,
  };

  test('safe daily spend is what is left, spread over the days left', () => {
    expect(forecast(base).safeDailyCents).toBe(10_000);
  });

  test('flags a month that does not close', () => {
    const result = forecast({ ...base, monthlySpendCents: 560_000 });
    expect(result.status).toBe('short');
    expect(result.headline).toContain('more than you earn');
    expect(result.advice).toContain('subscriptions');
  });

  test('flags being short before payday', () => {
    const result = forecast({ ...base, committedCents: 260_000 });
    expect(result.status).toBe('short');
    expect(result.headline).toContain('short of what');
    expect(result.safeDailyCents).toBe(0);
  });

  test('runway is savings divided by typical spending', () => {
    expect(forecast(base).runwayMonths).toBe(3);
  });

  test('a bigger household needs a bigger cushion', () => {
    expect(forecast({ ...base, householdSize: 4 }).emergencyTargetCents).toBe(400_000 * 6);
    expect(forecast(base).emergencyTargetCents).toBe(400_000 * 3);
  });

  test('praise is reserved for accounts that have actually got ahead', () => {
    const rich = forecast({ ...base, savingsCents: 3_000_000 });
    expect(rich.status).toBe('comfortable');
    expect(rich.advice).toContain('ahead');
  });
});

describe('suggestEnvelopes', () => {
  test('pre-fills from history, rounded to sensible numbers', () => {
    const { envelopes, unassignedCents } = suggestEnvelopes(
      [
        { category: 'Groceries', cents: 141_300, months: 3 },
        { category: 'Dining', cents: 30_100, months: 3 },
      ],
      200_000,
    );
    expect(envelopes[0]).toEqual({ category: 'Groceries', bucket: 'needs', suggestedCents: 47_000, averageCents: 47_100 });
    expect(envelopes[1]!.suggestedCents).toBe(10_000);
    // Zero-based budgeting: what's left still needs a job.
    expect(unassignedCents).toBe(200_000 - 57_000);
  });

  test('never suggests a zero envelope', () => {
    const { envelopes } = suggestEnvelopes([{ category: 'Tiny', cents: 120, months: 3 }], 100_000);
    expect(envelopes[0]!.suggestedCents).toBe(500);
  });
});

describe('envelopeProgress', () => {
  test('warns before the limit, not after', () => {
    const [ok, close, over] = envelopeProgress([
      { category: 'A', bucket: 'wants', plannedCents: 10_000, spentCents: 3_000, limitCents: null },
      { category: 'B', bucket: 'wants', plannedCents: 10_000, spentCents: 8_500, limitCents: null },
      { category: 'C', bucket: 'wants', plannedCents: 10_000, spentCents: 12_000, limitCents: null },
    ]);
    expect(ok!.status).toBe('ok');
    expect(close!.status).toBe('close');
    expect(over!.status).toBe('over');
    expect(over!.remainingCents).toBe(-2_000);
  });

  test('an explicit limit overrides the plan', () => {
    const [envelope] = envelopeProgress([{ category: 'A', bucket: 'wants', plannedCents: 50_000, spentCents: 9_000, limitCents: 10_000 }]);
    expect(envelope!.status).toBe('close');
  });
});
