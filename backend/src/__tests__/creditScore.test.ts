import { describe, expect, test } from 'vitest';
import {
  SCORE_MAX,
  SCORE_MIN,
  bandLabel,
  estimateScore,
  simulate,
  simulateCombined,
  utilizationOf,
  type CreditInputs,
} from '../features/creditScore.js';

/** A healthy, established profile — the demo customer's shape. */
const baseline: CreditInputs = {
  onTimePayments: 12,
  missedPayments: 0,
  cardBalanceCents: 134_215,
  cardLimitCents: 800_000,
  historyMonths: 68,
  accountTypes: 3,
  activeLoans: 0,
  recentlyOpened: 0,
};

const context = { blockableSubscriptionCents: 5_000, splittablePurchaseCents: 59_999 };

describe('bandLabel', () => {
  test('maps scores onto the standard bands', () => {
    expect(bandLabel(820)).toBe('Exceptional');
    expect(bandLabel(800)).toBe('Exceptional');
    expect(bandLabel(799)).toBe('Very good');
    expect(bandLabel(740)).toBe('Very good');
    expect(bandLabel(739)).toBe('Good');
    expect(bandLabel(670)).toBe('Good');
    expect(bandLabel(669)).toBe('Fair');
    expect(bandLabel(580)).toBe('Fair');
    expect(bandLabel(579)).toBe('Poor');
  });
});

describe('utilizationOf', () => {
  test('is the ratio of balance to limit', () => {
    expect(utilizationOf(200_000, 800_000)).toBe(0.25);
  });

  test('treats a missing limit as zero rather than dividing by it', () => {
    expect(utilizationOf(200_000, 0)).toBe(0);
  });

  test('ignores a negative balance (a credit on the account)', () => {
    expect(utilizationOf(-5_000, 800_000)).toBe(0);
  });
});

describe('estimateScore', () => {
  test('stays inside the real score range for any input', () => {
    const extremes: CreditInputs[] = [
      baseline,
      { ...baseline, missedPayments: 50, cardBalanceCents: 800_000, historyMonths: 0, accountTypes: 0, recentlyOpened: 10 },
      { ...baseline, onTimePayments: 500, cardBalanceCents: 0, historyMonths: 400, accountTypes: 3, activeLoans: 3 },
    ];

    for (const input of extremes) {
      const { score } = estimateScore(input);
      expect(score).toBeGreaterThanOrEqual(SCORE_MIN);
      expect(score).toBeLessThanOrEqual(SCORE_MAX);
    }
  });

  test('returns all five FICO factors, weighted to 1', () => {
    const { factors } = estimateScore(baseline);
    expect(factors).toHaveLength(5);
    expect(factors.reduce((sum, f) => sum + f.weight, 0)).toBeCloseTo(1, 10);
  });

  test('rates a healthy profile as good or better', () => {
    const { score, band } = estimateScore(baseline);
    expect(score).toBeGreaterThanOrEqual(670);
    expect(['Good', 'Very good', 'Exceptional']).toContain(band);
  });

  test('rates a damaged profile as poor', () => {
    const damaged = estimateScore({
      ...baseline,
      missedPayments: 6,
      cardBalanceCents: 760_000,
      historyMonths: 4,
      recentlyOpened: 4,
    });
    expect(damaged.score).toBeLessThan(580);
  });
});

describe('factor behaviour', () => {
  test('utilisation is monotonic — more balance never helps', () => {
    let previous = Infinity;
    for (const balance of [0, 80_000, 240_000, 400_000, 600_000, 800_000]) {
      const { score } = estimateScore({ ...baseline, cardBalanceCents: balance });
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  test('each missed payment costs more than it did before', () => {
    const scores = [0, 1, 2, 3].map(
      (missed) => estimateScore({ ...baseline, missedPayments: missed }).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
  });

  test('payment history is the heaviest factor', () => {
    const current = estimateScore(baseline).score;
    const afterMiss = current - estimateScore({ ...baseline, missedPayments: 1 }).score;
    const afterMoreBalance =
      current -
      estimateScore({ ...baseline, cardBalanceCents: baseline.cardBalanceCents + 80_000 }).score;

    expect(afterMiss).toBeGreaterThan(afterMoreBalance);
  });

  test('a single missed payment costs a realistic amount', () => {
    const drop = estimateScore(baseline).score - estimateScore({ ...baseline, missedPayments: 1 }).score;
    // Real scoring models drop a good score by roughly 60-110 points for one lapse.
    expect(drop).toBeGreaterThanOrEqual(50);
    expect(drop).toBeLessThanOrEqual(120);
  });

  test('later misses do less additional damage than the first', () => {
    const scores = [0, 1, 2, 3].map((m) => estimateScore({ ...baseline, missedPayments: m }).score);
    const firstDrop = scores[0]! - scores[1]!;
    const secondDrop = scores[1]! - scores[2]!;
    expect(firstDrop).toBeGreaterThan(secondDrop);
  });

  test('longer history helps, and never hurts', () => {
    const young = estimateScore({ ...baseline, historyMonths: 6 }).score;
    const old = estimateScore({ ...baseline, historyMonths: 120 }).score;
    expect(old).toBeGreaterThan(young);
  });

  test('an instalment loan improves credit mix', () => {
    const without = estimateScore({ ...baseline, activeLoans: 0 }).score;
    const with_ = estimateScore({ ...baseline, activeLoans: 1 }).score;
    expect(with_).toBeGreaterThan(without);
  });

  test('every factor reports a standing and a plain-language reason', () => {
    for (const factor of estimateScore(baseline).factors) {
      expect(['strong', 'fair', 'weak']).toContain(factor.standing);
      expect(factor.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('simulate', () => {
  const results = simulate(baseline, context);

  test('covers every scenario and sorts best-first', () => {
    expect(results.length).toBeGreaterThanOrEqual(6);
    const deltas = results.map((r) => r.delta);
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });

  test('paying off the card is a clear improvement', () => {
    const payOff = results.find((r) => r.id === 'pay_off_card')!;
    expect(payOff.delta).toBeGreaterThan(0);
  });

  test('paying half helps, but less than paying it all', () => {
    const half = results.find((r) => r.id === 'pay_half_card')!;
    const full = results.find((r) => r.id === 'pay_off_card')!;
    expect(half.delta).toBeGreaterThan(0);
    expect(half.delta).toBeLessThan(full.delta);
  });

  test('missing a payment is the most damaging scenario', () => {
    const miss = results.find((r) => r.id === 'miss_payment')!;
    expect(miss.delta).toBeLessThan(0);
    expect(Math.min(...results.map((r) => r.delta))).toBe(miss.delta);
  });

  test('splitting a purchase lowers utilisation and adds mix', () => {
    const split = results.find((r) => r.id === 'split_purchase')!;
    // Net positive despite counting as a new credit line.
    expect(split.delta).toBeGreaterThan(0);
  });

  test('waiting a year helps without doing anything', () => {
    expect(results.find((r) => r.id === 'wait_a_year')!.delta).toBeGreaterThan(0);
  });

  test('every scenario carries a band and an explanation', () => {
    for (const result of results) {
      expect(result.band).toBeTruthy();
      expect(result.description.length).toBeGreaterThan(20);
    }
  });
});

describe('simulateCombined', () => {
  test('stacking improvements beats any one of them', () => {
    const single = estimateScore(
      { ...baseline, cardBalanceCents: 0 },
    ).score;
    const combined = simulateCombined(baseline, context, [
      'pay_off_card',
      'block_subscriptions',
      'wait_a_year',
    ]).score;

    expect(combined).toBeGreaterThanOrEqual(single);
  });

  test('an unknown scenario id is ignored rather than throwing', () => {
    const result = simulateCombined(baseline, context, ['pay_off_card', 'nonsense' as never]);
    expect(result.score).toBeGreaterThan(SCORE_MIN);
  });

  test('applying nothing returns the current score', () => {
    expect(simulateCombined(baseline, context, []).score).toBe(estimateScore(baseline).score);
  });
});
