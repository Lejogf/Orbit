import { describe, expect, test } from 'vitest';
import { CARD_PRODUCTS, cardById, earnRateFor, eligibilityFor, recommendCard } from '../features/cards.js';
import { POINTS_PER_DOLLAR, centsToPoints, earnMoreTips, pointsForPurchase, pointsToCents, redemptionsFor, valueTable } from '../features/rewards.js';

describe('points arithmetic', () => {
  test('100 points is exactly one dollar, both ways', () => {
    expect(POINTS_PER_DOLLAR).toBe(100);
    expect(pointsToCents(100)).toBe(100);
    expect(pointsToCents(12_500)).toBe(12_500);
    expect(centsToPoints(2_500)).toBe(2_500);
  });

  test('multipliers change the value, never the balance', () => {
    expect(pointsToCents(10_000, 1)).toBe(10_000); // $100 cash
    expect(pointsToCents(10_000, 1.25)).toBe(12_500); // $125 of travel
    expect(pointsToCents(10_000, 0.8)).toBe(8_000); // $80 at a partner
  });
});

describe('redemptions', () => {
  test('cash and gift cards are exactly 1:1', () => {
    for (const option of redemptionsFor('summit')) {
      if (option.id === 'cash' || option.id === 'giftcard') expect(option.multiplier).toBe(1);
    }
  });

  test('travel is worth more than cash, partners less', () => {
    const table = valueTable(10_000, 'summit');
    const value = (id: string) => table.find((t) => t.id === id)!.valueCents;
    expect(value('travel')).toBeGreaterThan(value('cash'));
    expect(value('partner')).toBeLessThan(value('cash'));
  });

  test('lower tiers get fewer ways to redeem, higher tiers get all of them', () => {
    const start = redemptionsFor('start').map((r) => r.id);
    const summit = redemptionsFor('summit').map((r) => r.id);
    expect(start).toEqual(['cash', 'giftcard']);
    expect(summit.length).toBeGreaterThan(start.length);
    expect(summit).toContain('travel');
  });

  test('a balance below the minimum is marked unavailable, not hidden', () => {
    const table = valueTable(600, 'summit');
    expect(table.find((t) => t.id === 'cash')!.available).toBe(true);
    expect(table.find((t) => t.id === 'travel')!.available).toBe(false);
  });
});

describe('earning', () => {
  test('uses the card rate for the category, and explains it', () => {
    const result = pointsForPurchase({ amountCents: 10_000, category: 'Dining', productId: 'orbit-rise', boosters: [] });
    expect(result.points).toBe(400); // $100 at 4x
    expect(result.explanation).toContain('4% on dining');
  });

  test('falls back to the base rate for other categories', () => {
    expect(pointsForPurchase({ amountCents: 5_000, category: 'Hardware', productId: 'orbit-move', boosters: [] }).points).toBe(75);
  });

  test('boosters stack on top of the card rate', () => {
    const boosted = pointsForPurchase({ amountCents: 10_000, category: 'Groceries', productId: 'orbit-rise' });
    expect(boosted.basePoints).toBe(400);
    expect(boosted.bonusPoints).toBe(100);
    expect(boosted.points).toBe(500);
  });

  test('a starter card still earns something on everything', () => {
    expect(pointsForPurchase({ amountCents: 4_000, category: 'Travel', productId: 'orbit-start', boosters: [] }).points).toBe(40);
  });

  test('no points on a refund or an unknown card', () => {
    expect(pointsForPurchase({ amountCents: -5_000, category: 'Dining', productId: 'orbit-rise' }).points).toBe(0);
    expect(pointsForPurchase({ amountCents: 5_000, category: 'Dining', productId: 'nope' }).points).toBe(0);
  });
});

describe('earnMoreTips', () => {
  test('suggests boosters the customer already spends in, biggest first', () => {
    const tips = earnMoreTips({
      card: cardById('orbit-move')!,
      monthlyByCategory: [
        { category: 'Groceries', cents: 60_000 },
        { category: 'Transport', cents: 10_000 },
      ],
    });
    expect(tips[0]!.title).toContain('Groceries');
    expect(tips[0]!.extraPointsPerMonth).toBe(600);
  });

  test('only suggests a better card when it beats its own fee', () => {
    const small = earnMoreTips({ card: cardById('orbit-move')!, monthlyByCategory: [{ category: 'Dining', cents: 5_000 }], allCards: CARD_PRODUCTS });
    expect(small.some((t) => t.title.includes('Summit'))).toBe(false);

    const large = earnMoreTips({ card: cardById('orbit-start')!, monthlyByCategory: [{ category: 'Dining', cents: 200_000 }], allCards: CARD_PRODUCTS });
    expect(large.some((t) => t.title.includes('Orbit'))).toBe(true);
  });
});

describe('card eligibility', () => {
  const spender = { score: 780, monthlyIncomeCents: 600_000, monthlySpendCents: 300_000, missedPayments: 0 };

  test('gates each tier on score', () => {
    const thin = eligibilityFor({ ...spender, score: 610 });
    expect(thin.find((e) => e.productId === 'orbit-start')!.eligible).toBe(true);
    expect(thin.find((e) => e.productId === 'orbit-summit')!.eligible).toBe(false);
    expect(thin.find((e) => e.productId === 'orbit-summit')!.reason).toContain('760');
  });

  test('warns rather than blocks when a fee would not pay for itself', () => {
    const light = eligibilityFor({ ...spender, monthlySpendCents: 20_000 }).find((e) => e.productId === 'orbit-rise')!;
    expect(light.eligible).toBe(true);
    expect(light.confidence).toBeLessThan(0.5);
    expect(light.reason).toContain('less than the $95 fee');
  });

  test('missed payments close the fee-bearing cards', () => {
    const shaky = eligibilityFor({ ...spender, missedPayments: 3 });
    expect(shaky.find((e) => e.productId === 'orbit-rise')!.eligible).toBe(false);
    expect(shaky.find((e) => e.productId === 'orbit-start')!.eligible).toBe(true);
  });

  test('recommends a card they do not already hold', () => {
    const held = ['orbit-move'];
    const suggestion = recommendCard(held, spender);
    expect(suggestion).not.toBeNull();
    expect(held).not.toContain(suggestion!.productId);
  });

  test('business filtering keeps consumer cards out', () => {
    const business = eligibilityFor({ ...spender, kind: 'business' });
    expect(business).toHaveLength(1);
    expect(business[0]!.productId).toBe('orbit-business');
  });
});

describe('earnRateFor', () => {
  test('is case-insensitive and always returns a rate', () => {
    expect(earnRateFor(cardById('orbit-rise')!, 'dining').rate).toBe(4);
    expect(earnRateFor(cardById('orbit-rise')!, 'Nonsense').rate).toBe(2);
  });
});
