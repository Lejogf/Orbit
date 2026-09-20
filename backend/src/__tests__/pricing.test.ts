import { describe, expect, test } from 'vitest';
import {
  PRICING,
  TERMS,
  bandForScore,
  buildSchedule,
  checkAffordability,
  checkEligibility,
  effectiveBand,
  previewCreditImpact,
  quote,
  quoteAll,
} from '../features/pricing.js';
import { toIsoDate } from '../lib/utils.js';

const START = new Date(Date.UTC(2026, 8, 19));

describe('bandForScore', () => {
  test('maps scores onto bands at the boundaries', () => {
    expect(bandForScore(800)).toBe('excellent');
    expect(bandForScore(750)).toBe('excellent');
    expect(bandForScore(749)).toBe('good');
    expect(bandForScore(700)).toBe('good');
    expect(bandForScore(699)).toBe('fair');
    expect(bandForScore(650)).toBe('fair');
    expect(bandForScore(649)).toBe('poor');
    expect(bandForScore(300)).toBe('poor');
  });
});

describe('effectiveBand', () => {
  test('leaves a clean payment history alone', () => {
    expect(effectiveBand(780, 0)).toBe('excellent');
    expect(effectiveBand(780, 1)).toBe('excellent');
  });

  test('drops a band after repeated missed payments', () => {
    expect(effectiveBand(780, 2)).toBe('good');
    expect(effectiveBand(710, 3)).toBe('fair');
  });

  test('cannot fall below the lowest band', () => {
    expect(effectiveBand(500, 10)).toBe('poor');
  });
});

describe('quote', () => {
  test('the 3-month promo is free for every band', () => {
    for (const band of ['excellent', 'good', 'fair', 'poor'] as const) {
      const q = quote(60_000, 3, band, START);
      expect(q.aprPercent, band).toBe(0);
      expect(q.totalInterestCents, band).toBe(0);
      expect(q.totalCostCents, band).toBe(60_000);
    }
  });

  test('splits the promo into exact equal payments', () => {
    const q = quote(60_000, 3, 'good', START);
    expect(q.scheduleCents).toEqual([20_000, 20_000, 20_000]);
    expect(q.monthlyPaymentCents).toBe(20_000);
  });

  test('charges interest on longer terms', () => {
    const q = quote(60_000, 12, 'good', START);
    // $600 at 15.99% for 12 months, simple interest.
    expect(q.aprPercent).toBe(15.99);
    expect(q.totalInterestCents).toBe(9594);
    expect(q.totalCostCents).toBe(69_594);
  });

  test('prices weaker credit higher for the same term', () => {
    const excellent = quote(60_000, 12, 'excellent', START);
    const poor = quote(60_000, 12, 'poor', START);
    expect(poor.totalCostCents).toBeGreaterThan(excellent.totalCostCents);
  });

  test('payments always sum to the exact total', () => {
    for (const principal of [10_000, 59_999, 100_001, 124_900]) {
      for (const term of TERMS) {
        for (const band of ['excellent', 'good', 'fair', 'poor'] as const) {
          const q = quote(principal, term, band, START);
          const summed = q.scheduleCents.reduce((a, b) => a + b, 0);
          expect(summed, `${principal}/${term}/${band}`).toBe(q.totalCostCents);
          expect(q.scheduleCents).toHaveLength(term);
        }
      }
    }
  });

  test('a longer term lowers the monthly payment but costs more overall', () => {
    const six = quote(120_000, 6, 'good', START);
    const twentyFour = quote(120_000, 24, 'good', START);

    expect(twentyFour.monthlyPaymentCents).toBeLessThan(six.monthlyPaymentCents);
    expect(twentyFour.totalCostCents).toBeGreaterThan(six.totalCostCents);
  });

  test('marks terms beyond the band as unavailable, with a reason', () => {
    const q = quote(60_000, 24, 'poor', START);
    expect(q.available).toBe(false);
    expect(q.unavailableReason).toMatch(/6 months/);

    expect(quote(60_000, 6, 'poor', START).available).toBe(true);
    expect(quote(60_000, 24, 'excellent', START).available).toBe(true);
  });

  test('payoff date lands the right number of months out', () => {
    expect(toIsoDate(quote(60_000, 6, 'good', START).payoffDate)).toBe('2027-03-19');
    expect(toIsoDate(quote(60_000, 24, 'good', START).payoffDate)).toBe('2028-09-19');
  });
});

describe('quoteAll', () => {
  test('returns every term, marking which are open to this band', () => {
    const quotes = quoteAll(60_000, 'fair', START);
    expect(quotes.map((q) => q.termMonths)).toEqual([3, 6, 12, 24]);
    expect(quotes.map((q) => q.available)).toEqual([true, true, true, false]);
  });
});

describe('checkEligibility', () => {
  const base = { purchaseCents: 60_000, activePlanCount: 0, totalFinancedCents: 0 };

  test('accepts a normal purchase', () => {
    expect(checkEligibility(base).eligible).toBe(true);
  });

  test('rejects purchases under the minimum', () => {
    const result = checkEligibility({ ...base, purchaseCents: 9999 });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/at least \$100/);
  });

  test('accepts a purchase exactly at the minimum', () => {
    expect(checkEligibility({ ...base, purchaseCents: 100_00 }).eligible).toBe(true);
  });

  test('rejects once the active plan cap is reached', () => {
    const result = checkEligibility({ ...base, activePlanCount: PRICING.limits.maxActivePlans });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/active plans/);
  });

  test('rejects when it would breach the total financed cap', () => {
    const result = checkEligibility({ ...base, totalFinancedCents: 490_000 });
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/total financed/);
  });

  test('reports every failing reason at once', () => {
    const result = checkEligibility({
      purchaseCents: 5000,
      activePlanCount: 9,
      totalFinancedCents: 499_000,
    });
    expect(result.reasons).toHaveLength(3);
  });
});

describe('checkAffordability', () => {
  const income = 500_000; // $5,000/month

  test('is comfortable when obligations stay low', () => {
    const result = checkAffordability({
      monthlyIncomeCents: income,
      existingObligationsCents: 100_000,
      newPaymentCents: 10_000,
    });
    expect(result.affordable).toBe(true);
    expect(result.stretched).toBe(false);
    expect(result.obligationRatio).toBeCloseTo(0.22, 2);
  });

  test('rent-sized obligations alone do not trigger the warning', () => {
    // Housing is typically 30%+ of income; flagging that as a problem would make
    // the warning meaningless.
    const result = checkAffordability({
      monthlyIncomeCents: income,
      existingObligationsCents: 185_000,
      newPaymentCents: 10_000,
    });
    expect(result.stretched).toBe(false);
  });

  test('warns when the plan stretches the budget', () => {
    const result = checkAffordability({
      monthlyIncomeCents: income,
      // 44% of income once the new payment lands: past warn, under the cap.
      existingObligationsCents: 210_000,
      newPaymentCents: 10_000,
    });
    expect(result.affordable).toBe(true);
    expect(result.stretched).toBe(true);
    expect(result.message).toMatch(/tight/);
  });

  test('refuses a plan past the hard cap', () => {
    const result = checkAffordability({
      monthlyIncomeCents: income,
      existingObligationsCents: 240_000,
      newPaymentCents: 20_000,
    });
    expect(result.affordable).toBe(false);
    expect(result.message).toMatch(/cap plans at 50%/);
  });

  test('reports disposable income after the plan', () => {
    const result = checkAffordability({
      monthlyIncomeCents: income,
      existingObligationsCents: 100_000,
      newPaymentCents: 50_000,
    });
    expect(result.disposableAfterCents).toBe(350_000);
  });

  test('does not falsely reassure when income is unknown', () => {
    const result = checkAffordability({
      monthlyIncomeCents: 0,
      existingObligationsCents: 100_000,
      newPaymentCents: 10_000,
    });
    expect(result.stretched).toBe(true);
    expect(result.message).toMatch(/couldn't verify/);
  });
});

describe('previewCreditImpact', () => {
  test('utilisation falls when the purchase moves into a plan', () => {
    const impact = previewCreditImpact({
      cardBalanceCents: 200_000,
      cardLimitCents: 800_000,
      principalCents: 60_000,
      monthlyPaymentCents: 10_000,
      existingObligationsCents: 150_000,
    });

    expect(impact.utilizationBefore).toBeCloseTo(0.25, 3);
    expect(impact.utilizationAfter).toBeCloseTo(0.175, 3);
    expect(impact.summary).toMatch(/drops 8 points/);
  });

  test('monthly obligations rise by exactly the new payment', () => {
    const impact = previewCreditImpact({
      cardBalanceCents: 200_000,
      cardLimitCents: 800_000,
      principalCents: 60_000,
      monthlyPaymentCents: 10_000,
      existingObligationsCents: 150_000,
    });
    expect(impact.monthlyObligationsAfterCents - impact.monthlyObligationsBeforeCents).toBe(10_000);
  });

  test('handles a card with no limit on record without dividing by zero', () => {
    const impact = previewCreditImpact({
      cardBalanceCents: 200_000,
      cardLimitCents: 0,
      principalCents: 60_000,
      monthlyPaymentCents: 10_000,
      existingObligationsCents: 0,
    });
    expect(impact.utilizationBefore).toBe(0);
    expect(impact.utilizationAfter).toBe(0);
  });
});

describe('buildSchedule', () => {
  test('first payment is one month out, then monthly', () => {
    const schedule = buildSchedule(quote(60_000, 3, 'good', START), START);

    expect(schedule.map((p) => toIsoDate(p.dueDate))).toEqual([
      '2026-10-19',
      '2026-11-19',
      '2026-12-19',
    ]);
    expect(schedule.map((p) => p.sequence)).toEqual([1, 2, 3]);
  });

  test('schedule totals the plan cost exactly', () => {
    const q = quote(59_999, 12, 'fair', START);
    const total = buildSchedule(q, START).reduce((sum, p) => sum + p.amountCents, 0);
    expect(total).toBe(q.totalCostCents);
  });
});
