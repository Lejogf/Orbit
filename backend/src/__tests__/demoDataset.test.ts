// These guard the demo itself: it depends on specific data existing (a trial
// converting in two days, overlapping services, a ~$600 purchase to split), so
// each planted scenario gets an assertion.
import { describe, expect, test } from 'vitest';
import {
  BIG_PURCHASES,
  INSTALLMENT_ELIGIBILITY_MIN_CENTS,
  RECURRING_MERCHANTS,
  generateDemoDataset,
} from '../data/demoDataset.js';
import { daysBetween, startOfDay } from '../lib/utils.js';

const TODAY = new Date(Date.UTC(2026, 8, 19)); // 2026-09-19

const dataset = generateDemoDataset(TODAY);

const chargesFor = (merchantKey: string) =>
  dataset.transactions
    .filter((t) => t.merchantKey === merchantKey)
    .sort((a, b) => a.date.localeCompare(b.date));

describe('determinism', () => {
  test('two runs with the same "today" produce identical data', () => {
    const again = generateDemoDataset(TODAY);
    expect(again.transactions).toEqual(dataset.transactions);
  });

  test('a different "today" still produces a valid dataset', () => {
    const other = generateDemoDataset(new Date(Date.UTC(2027, 0, 5)));
    expect(other.transactions.length).toBeGreaterThan(100);
  });
});

describe('accounts', () => {
  test('has exactly the three accounts the shell expects', () => {
    expect(dataset.accounts.map((a) => a.type)).toEqual(['Checking', 'Savings', 'Credit Card']);
  });

  test('only the credit card carries a limit', () => {
    const credit = dataset.accounts.find((a) => a.key === 'credit');
    expect(credit?.creditLimitCents).toBeGreaterThan(0);
    expect(dataset.accounts.find((a) => a.key === 'checking')?.creditLimitCents).toBeUndefined();
  });
});

describe('history', () => {
  test('spans roughly six months', () => {
    const dates = dataset.transactions.map((t) => t.date).sort();
    const span = daysBetween(new Date(`${dates[0]}T00:00:00Z`), startOfDay(TODAY));
    expect(span).toBeGreaterThanOrEqual(150);
    expect(span).toBeLessThanOrEqual(200);
  });

  test('contains no transactions dated in the future', () => {
    const todayIso = TODAY.toISOString().slice(0, 10);
    const future = dataset.transactions.filter((t) => t.date > todayIso);
    expect(future).toEqual([]);
  });

  test('includes regular paychecks', () => {
    const paychecks = dataset.transactions.filter((t) => t.category === 'Income');
    expect(paychecks.length).toBeGreaterThanOrEqual(11);
    // All the same amount, and all positive.
    expect(new Set(paychecks.map((p) => p.amountCents)).size).toBe(1);
    expect(paychecks.every((p) => p.amountCents > 0)).toBe(true);
  });

  test('money leaving an account is always negative, money arriving positive', () => {
    for (const t of dataset.transactions) {
      if (t.source === 'deposit') expect(t.amountCents).toBeGreaterThan(0);
      // The free-trial authorisation is a legitimate zero.
      if (t.source === 'withdrawal') expect(t.amountCents).toBeLessThan(0);
      if (t.source === 'purchase') expect(t.amountCents).toBeLessThanOrEqual(0);
    }
  });

  test('is sorted chronologically', () => {
    const dates = dataset.transactions.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
  });

  test('every transaction key is unique', () => {
    const keys = dataset.transactions.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every merchant reference resolves', () => {
    const known = new Set(dataset.merchants.map((m) => m.key));
    for (const t of dataset.transactions) {
      if (t.merchantKey) expect(known).toContain(t.merchantKey);
    }
  });
});

describe('recurring merchants', () => {
  test('plants ten of them', () => {
    expect(RECURRING_MERCHANTS).toHaveLength(10);
    expect(dataset.merchants.filter((m) => m.isRecurring)).toHaveLength(10);
  });

  test('each non-trial merchant bills at a near-monthly interval', () => {
    for (const merchant of RECURRING_MERCHANTS) {
      if (merchant.scenario.kind === 'free_trial') continue;

      const charges = chargesFor(merchant.key);
      expect(charges.length, `${merchant.name} should have several charges`).toBeGreaterThanOrEqual(5);

      for (let i = 1; i < charges.length; i++) {
        const gap = daysBetween(
          new Date(`${charges[i - 1]!.date}T00:00:00Z`),
          new Date(`${charges[i]!.date}T00:00:00Z`),
        );
        // Monthly, allowing for short months and the planted day jitter.
        expect(gap, `${merchant.name} gap`).toBeGreaterThanOrEqual(26);
        expect(gap, `${merchant.name} gap`).toBeLessThanOrEqual(35);
      }
    }
  });

  test('all subscription charges land on the credit card', () => {
    for (const merchant of RECURRING_MERCHANTS) {
      for (const charge of chargesFor(merchant.key)) {
        expect(charge.accountKey).toBe('credit');
      }
    }
  });

  test('every recurring merchant has a cancellation link', () => {
    for (const m of dataset.merchants.filter((m) => m.isRecurring)) {
      expect(m.cancelUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('planted scenario: price increase', () => {
  const netflix = RECURRING_MERCHANTS.find((m) => m.key === 'netflix')!;

  test('Netflix is the merchant carrying the increase', () => {
    expect(netflix.scenario.kind).toBe('price_increase');
  });

  test('older charges are at the old price and recent ones at the new price', () => {
    const charges = chargesFor('netflix');
    const amounts = charges.map((c) => Math.abs(c.amountCents));
    const distinct = [...new Set(amounts)];

    expect(distinct).toHaveLength(2);
    expect(distinct).toContain(1299); // old
    expect(distinct).toContain(1549); // new

    // The increase happens once and never reverses.
    const firstNewIndex = amounts.indexOf(1549);
    expect(amounts.slice(firstNewIndex).every((a) => a === 1549)).toBe(true);
  });
});

describe('planted scenario: free trial', () => {
  test('Blue Apron converts in exactly two days', () => {
    const blueApron = RECURRING_MERCHANTS.find((m) => m.key === 'blueapron')!;
    expect(blueApron.scenario).toEqual({ kind: 'free_trial', convertsInDays: 2 });
  });

  test('shows a single zero-amount authorisation and no paid charge yet', () => {
    const charges = chargesFor('blueapron');
    expect(charges).toHaveLength(1);
    expect(charges[0]!.amountCents).toBe(0);
  });
});

describe('planted scenario: overlapping services', () => {
  test('two streaming services are active at once', () => {
    const streaming = dataset.merchants.filter((m) => m.isRecurring && m.category === 'Streaming');
    expect(streaming.map((m) => m.name).sort()).toEqual(['Hulu', 'Netflix']);
  });

  test('two cloud storage services overlap as well', () => {
    const cloud = dataset.merchants.filter((m) => m.isRecurring && m.category === 'Cloud Storage');
    expect(cloud).toHaveLength(2);
  });

  test('both members of each overlapping pair are still being charged', () => {
    for (const key of ['netflix', 'hulu', 'icloud', 'dropbox']) {
      expect(chargesFor(key).length, key).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('planted scenario: unused subscription', () => {
  test('Peloton is marked unused but still billing', () => {
    const peloton = RECURRING_MERCHANTS.find((m) => m.key === 'peloton')!;
    expect(peloton.scenario.kind).toBe('unused');
    expect(chargesFor('peloton').length).toBeGreaterThanOrEqual(5);
  });
});

describe('Pay Over Time eligibility', () => {
  test('includes a purchase near $600 for the scripted demo', () => {
    const bestBuy = BIG_PURCHASES.find((p) => p.key === 'bestbuy')!;
    expect(bestBuy.amountCents).toBe(59_999);

    const charge = chargesFor('bestbuy')[0];
    expect(charge).toBeDefined();
    expect(Math.abs(charge!.amountCents)).toBe(59_999);
  });

  test('every big purchase clears the $100 eligibility floor', () => {
    for (const purchase of BIG_PURCHASES) {
      expect(purchase.amountCents).toBeGreaterThanOrEqual(INSTALLMENT_ELIGIBILITY_MIN_CENTS);
    }
  });

  test('provides at least four eligible purchases to choose from', () => {
    const eligible = dataset.transactions.filter(
      (t) => t.source === 'purchase' && Math.abs(t.amountCents) >= INSTALLMENT_ELIGIBILITY_MIN_CENTS,
    );
    expect(eligible.length).toBeGreaterThanOrEqual(4);
  });
});
