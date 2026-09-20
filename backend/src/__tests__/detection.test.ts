import { describe, expect, test } from 'vitest';
import {
  classifyInterval,
  detectSubscriptions,
  flagDuplicates,
  projectNextCharge,
  toMonthlyCents,
  toYearlyCents,
  type ChargeInput,
  type DetectedSubscription,
} from '../features/detection.js';
import { generateDemoDataset } from '../data/demoDataset.js';
import { addDays } from '../lib/utils.js';

const TODAY = new Date(Date.UTC(2026, 8, 19));
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Builds a run of charges every `intervalDays`, ending `endsDaysAgo` before TODAY. */
function series(options: {
  merchantId?: string;
  name?: string;
  category?: string;
  amounts: number[];
  intervalDays?: number;
  endsDaysAgo?: number;
}): ChargeInput[] {
  const {
    merchantId = 'm1',
    name = 'Test Co',
    category = 'Streaming',
    amounts,
    intervalDays = 30,
    endsDaysAgo = 5,
  } = options;

  const end = addDays(TODAY, -endsDaysAgo);
  return amounts.map((amountCents, index) => ({
    id: `${merchantId}-${index}`,
    merchantId,
    merchantName: name,
    category,
    amountCents,
    postedAt: addDays(end, -(amounts.length - 1 - index) * intervalDays),
  }));
}

describe('classifyInterval', () => {
  test('recognises the three cadences', () => {
    expect(classifyInterval(7)).toBe('weekly');
    expect(classifyInterval(30)).toBe('monthly');
    expect(classifyInterval(365)).toBe('yearly');
  });

  test('tolerates real-world drift', () => {
    expect(classifyInterval(31)).toBe('monthly');
    expect(classifyInterval(28)).toBe('monthly');
    expect(classifyInterval(8)).toBe('weekly');
    expect(classifyInterval(350)).toBe('yearly');
  });

  test('rejects gaps that match nothing', () => {
    expect(classifyInterval(15)).toBeNull();
    expect(classifyInterval(90)).toBeNull();
    expect(classifyInterval(200)).toBeNull();
  });
});

describe('detectSubscriptions', () => {
  test('finds a steady monthly charge', () => {
    const found = detectSubscriptions(series({ amounts: [1549, 1549, 1549, 1549, 1549, 1549] }), TODAY);

    expect(found).toHaveLength(1);
    expect(found[0]!.frequency).toBe('monthly');
    expect(found[0]!.amountCents).toBe(1549);
    expect(found[0]!.confidence).toBeGreaterThan(0.8);
  });

  test('finds a weekly charge', () => {
    const found = detectSubscriptions(
      series({ amounts: [899, 899, 899, 899, 899, 899], intervalDays: 7 }),
      TODAY,
    );
    expect(found[0]!.frequency).toBe('weekly');
  });

  test('tolerates small amount wobble from tax', () => {
    const found = detectSubscriptions(series({ amounts: [2499, 2503, 2495, 2499, 2501, 2497] }), TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]!.frequency).toBe('monthly');
  });

  test('tolerates billing dates drifting by a day or two', () => {
    const charges = series({ amounts: [1199, 1199, 1199, 1199, 1199] });
    charges[1]!.postedAt = addDays(charges[1]!.postedAt, 2);
    charges[3]!.postedAt = addDays(charges[3]!.postedAt, -1);

    expect(detectSubscriptions(charges, TODAY)).toHaveLength(1);
  });

  test('ignores a single one-off purchase', () => {
    expect(detectSubscriptions(series({ amounts: [4299] }), TODAY)).toEqual([]);
  });

  test('ignores irregular spending at the same merchant', () => {
    // Groceries: same shop, wildly different amounts, no cadence.
    const charges: ChargeInput[] = [
      { id: 'a', merchantId: 'g', merchantName: 'Market', category: 'Groceries', amountCents: 2312, postedAt: utc(2026, 5, 3) },
      { id: 'b', merchantId: 'g', merchantName: 'Market', category: 'Groceries', amountCents: 8710, postedAt: utc(2026, 5, 11) },
      { id: 'c', merchantId: 'g', merchantName: 'Market', category: 'Groceries', amountCents: 4150, postedAt: utc(2026, 6, 2) },
      { id: 'd', merchantId: 'g', merchantName: 'Market', category: 'Groceries', amountCents: 11_940, postedAt: utc(2026, 6, 19) },
    ];
    expect(detectSubscriptions(charges, TODAY)).toEqual([]);
  });

  test('ignores a regular cadence with wildly varying amounts', () => {
    const found = detectSubscriptions(series({ amounts: [1000, 9000, 2500, 17_000, 400] }), TODAY);
    expect(found).toEqual([]);
  });

  test('separates different merchants', () => {
    const found = detectSubscriptions(
      [
        ...series({ merchantId: 'a', name: 'A', amounts: [1000, 1000, 1000, 1000] }),
        ...series({ merchantId: 'b', name: 'B', category: 'Music', amounts: [500, 500, 500, 500] }),
      ],
      TODAY,
    );
    expect(found.map((s) => s.merchantName).sort()).toEqual(['A', 'B']);
  });

  test('sorts the most expensive first', () => {
    const found = detectSubscriptions(
      [
        ...series({ merchantId: 'cheap', name: 'Cheap', category: 'Music', amounts: [299, 299, 299, 299] }),
        ...series({ merchantId: 'dear', name: 'Dear', category: 'Software', amounts: [5999, 5999, 5999, 5999] }),
      ],
      TODAY,
    );
    expect(found[0]!.merchantName).toBe('Dear');
  });
});

describe('price increase detection', () => {
  test('flags a step up that holds, and reports the old price', () => {
    const found = detectSubscriptions(
      series({ amounts: [1299, 1299, 1299, 1549, 1549, 1549] }),
      TODAY,
    );

    expect(found[0]!.hasPriceIncrease).toBe(true);
    expect(found[0]!.previousAmountCents).toBe(1299);
    expect(found[0]!.amountCents).toBe(1549);
  });

  test('does not flag a steady price', () => {
    const found = detectSubscriptions(series({ amounts: [1549, 1549, 1549, 1549, 1549] }), TODAY);
    expect(found[0]!.hasPriceIncrease).toBe(false);
  });

  test('does not flag a rise too small to matter', () => {
    const found = detectSubscriptions(series({ amounts: [1000, 1000, 1000, 1010] }), TODAY);
    expect(found[0]!.hasPriceIncrease).toBe(false);
  });

  test('does not flag a one-off spike that falls back', () => {
    const found = detectSubscriptions(series({ amounts: [1000, 1000, 1400, 1000, 1000] }), TODAY);
    expect(found[0]!.hasPriceIncrease).toBe(false);
  });
});

describe('free trials', () => {
  test('treats a lone zero-amount authorisation as a trial', () => {
    const found = detectSubscriptions(
      [
        {
          id: 't1',
          merchantId: 'trial',
          merchantName: 'Blue Apron',
          category: 'Food',
          amountCents: 0,
          postedAt: addDays(TODAY, -28),
        },
      ],
      TODAY,
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.isFreeTrial).toBe(true);
    // 28 days in, converting 30 days after signup -> 2 days away.
    expect(found[0]!.nextChargeDate.getTime()).toBe(addDays(TODAY, 2).getTime());
  });

  test('a zero charge followed by paid charges is a normal subscription', () => {
    const charges = series({ amounts: [0, 1599, 1599, 1599, 1599] });
    const found = detectSubscriptions(charges, TODAY);

    expect(found[0]!.isFreeTrial).toBe(false);
    expect(found[0]!.amountCents).toBe(1599);
  });
});

describe('flagDuplicates', () => {
  const make = (name: string, category: string): DetectedSubscription =>
    ({ merchantName: name, category }) as DetectedSubscription;

  test('flags both services sharing a category', () => {
    const flagged = flagDuplicates([
      make('Netflix', 'Streaming'),
      make('Hulu', 'Streaming'),
      make('Spotify', 'Music'),
    ]);

    expect(flagged.filter((s) => s.isDuplicate).map((s) => s.merchantName).sort()).toEqual([
      'Hulu',
      'Netflix',
    ]);
  });

  test('leaves a lone service in its category alone', () => {
    expect(flagDuplicates([make('Spotify', 'Music')])[0]!.isDuplicate).toBe(false);
  });
});

describe('projectNextCharge', () => {
  test('rolls a past date forward past today', () => {
    const next = projectNextCharge(addDays(TODAY, -65), 30, TODAY);
    expect(next.getTime()).toBeGreaterThan(TODAY.getTime());
  });

  test('leaves a future date alone', () => {
    const future = addDays(TODAY, 10);
    expect(projectNextCharge(future, 30, TODAY).getTime()).toBe(future.getTime());
  });

  test('terminates even on a nonsense interval', () => {
    expect(() => projectNextCharge(addDays(TODAY, -500), 0, TODAY)).not.toThrow();
  });
});

describe('cost normalisation', () => {
  test('converts to a monthly equivalent', () => {
    expect(toMonthlyCents(1549, 'monthly')).toBe(1549);
    expect(toMonthlyCents(12_000, 'yearly')).toBe(1000);
    expect(toMonthlyCents(500, 'weekly')).toBe(2167);
  });

  test('converts to a yearly equivalent', () => {
    expect(toYearlyCents(1549, 'monthly')).toBe(18_588);
    expect(toYearlyCents(12_000, 'yearly')).toBe(12_000);
    expect(toYearlyCents(500, 'weekly')).toBe(26_000);
  });
});

// The real test: run detection over the actual seeded history and check it finds
// exactly the scenarios the demo depends on.
describe('against the seeded demo data', () => {
  const dataset = generateDemoDataset(TODAY);
  const merchantsByKey = new Map(dataset.merchants.map((m) => [m.key, m]));

  const charges: ChargeInput[] = dataset.transactions
    .filter((t) => t.source === 'purchase' && t.merchantKey)
    .map((t) => {
      const merchant = merchantsByKey.get(t.merchantKey!)!;
      return {
        id: t.key,
        merchantId: t.merchantKey!,
        merchantName: merchant.name,
        category: merchant.category,
        amountCents: Math.abs(t.amountCents),
        postedAt: new Date(`${t.date}T00:00:00.000Z`),
      };
    });

  const found = detectSubscriptions(charges, TODAY);
  const byName = new Map(found.map((s) => [s.merchantName, s]));

  test('finds all ten planted subscriptions', () => {
    expect(found).toHaveLength(10);
  });

  test('does not mistake everyday spending for a subscription', () => {
    for (const name of ['Whole Foods Market', 'Shell', 'Starbucks', 'Target']) {
      expect(byName.has(name), `${name} should not be detected`).toBe(false);
    }
  });

  test('catches the Netflix price increase with the exact old price', () => {
    const netflix = byName.get('Netflix')!;
    expect(netflix.hasPriceIncrease).toBe(true);
    expect(netflix.previousAmountCents).toBe(1299);
    expect(netflix.amountCents).toBe(1549);
  });

  test('catches the Blue Apron trial converting in two days', () => {
    const trial = byName.get('Blue Apron')!;
    expect(trial.isFreeTrial).toBe(true);
    expect(Math.round((trial.nextChargeDate.getTime() - TODAY.getTime()) / 86_400_000)).toBe(2);
  });

  test('flags both overlapping pairs', () => {
    expect(byName.get('Netflix')!.isDuplicate).toBe(true);
    expect(byName.get('Hulu')!.isDuplicate).toBe(true);
    expect(byName.get('iCloud+')!.isDuplicate).toBe(true);
    expect(byName.get('Dropbox Plus')!.isDuplicate).toBe(true);
  });

  test('does not flag a service alone in its category', () => {
    expect(byName.get('Spotify')!.isDuplicate).toBe(false);
    expect(byName.get('Adobe Creative Cloud')!.isDuplicate).toBe(false);
  });

  test('every next charge date is in the future', () => {
    for (const sub of found) {
      expect(sub.nextChargeDate.getTime(), sub.merchantName).toBeGreaterThan(TODAY.getTime());
    }
  });

  test('is confident about the steady ones', () => {
    for (const name of ['Netflix', 'Hulu', 'Spotify', 'Adobe Creative Cloud']) {
      expect(byName.get(name)!.confidence, name).toBeGreaterThan(0.7);
    }
  });
});
