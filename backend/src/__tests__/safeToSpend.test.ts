import { describe, expect, test } from 'vitest';
import {
  buildTimeline,
  calculateSafeToSpend,
  predictNextPayday,
  type UpcomingSubscription,
} from '../features/safeToSpend.js';
import { addDays, toIsoDate } from '../lib/utils.js';

const TODAY = new Date(Date.UTC(2026, 8, 19));

const paydays = [addDays(TODAY, -28), addDays(TODAY, -14)];

const sub = (overrides: Partial<UpcomingSubscription> = {}): UpcomingSubscription => ({
  id: 's1',
  merchantName: 'Netflix',
  category: 'Streaming',
  amountCents: 1549,
  nextChargeDate: addDays(TODAY, 3),
  status: 'active',
  isFreeTrial: false,
  ...overrides,
});

describe('predictNextPayday', () => {
  test('infers a biweekly cadence', () => {
    expect(toIsoDate(predictNextPayday(paydays, TODAY)!)).toBe('2026-10-03');
  });

  test('infers a monthly cadence', () => {
    const monthly = [addDays(TODAY, -60), addDays(TODAY, -30)];
    expect(toIsoDate(predictNextPayday(monthly, TODAY)!)).toBe('2026-10-19');
  });

  test('ignores one irregular deposit', () => {
    const noisy = [addDays(TODAY, -42), addDays(TODAY, -28), addDays(TODAY, -27), addDays(TODAY, -14)];
    const next = predictNextPayday(noisy, TODAY)!;
    expect(next.getTime()).toBeGreaterThan(TODAY.getTime());
  });

  test('returns null without enough history', () => {
    expect(predictNextPayday([], TODAY)).toBeNull();
    expect(predictNextPayday([TODAY], TODAY)).toBeNull();
  });

  test('always lands in the future', () => {
    const stale = [addDays(TODAY, -200), addDays(TODAY, -186)];
    expect(predictNextPayday(stale, TODAY)!.getTime()).toBeGreaterThan(TODAY.getTime());
  });
});

describe('calculateSafeToSpend', () => {
  test('subtracts what is committed before the next payday', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub({ amountCents: 1549 }), sub({ id: 's2', amountCents: 1799 })],
      installments: [{ id: 'p1', label: 'Best Buy', amountCents: 10_000, dueDate: addDays(TODAY, 5) }],
      today: TODAY,
    });

    expect(result.committedCents).toBe(1549 + 1799 + 10_000);
    expect(result.safeToSpendCents).toBe(100_000 - 13_348);
  });

  test('ignores charges falling after the next payday', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      // Payday is 14 days out; this lands 20 days out.
      subscriptions: [sub({ nextChargeDate: addDays(TODAY, 20) })],
      installments: [],
      today: TODAY,
    });

    expect(result.committedCents).toBe(0);
    expect(result.safeToSpendCents).toBe(100_000);
  });

  test('blocking a subscription frees the money immediately', () => {
    const base = {
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      installments: [],
      today: TODAY,
    };

    const before = calculateSafeToSpend({ ...base, subscriptions: [sub()] });
    const after = calculateSafeToSpend({ ...base, subscriptions: [sub({ status: 'blocked' })] });

    expect(after.safeToSpendCents).toBe(before.safeToSpendCents + 1549);
    expect(after.avoidedCents).toBe(1549);
  });

  test('a guarded subscription still counts, because it can still be approved', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub({ status: 'guarded' })],
      installments: [],
      today: TODAY,
    });
    expect(result.committedCents).toBe(1549);
  });

  test('a cancelled subscription is treated as avoided', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub({ status: 'canceled' })],
      installments: [],
      today: TODAY,
    });
    expect(result.committedCents).toBe(0);
    expect(result.avoidedCents).toBe(1549);
  });

  test('ignores charges already in the past', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub({ nextChargeDate: addDays(TODAY, -2) })],
      installments: [],
      today: TODAY,
    });
    expect(result.committedCents).toBe(0);
  });

  test('lists upcoming items soonest first', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [
        sub({ id: 'late', merchantName: 'Later', nextChargeDate: addDays(TODAY, 10) }),
        sub({ id: 'soon', merchantName: 'Sooner', nextChargeDate: addDays(TODAY, 1) }),
      ],
      installments: [],
      today: TODAY,
    });

    expect(result.upcoming.map((i) => i.label)).toEqual(['Sooner', 'Later']);
  });

  test('money leaving is recorded as negative', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub()],
      installments: [],
      today: TODAY,
    });
    expect(result.upcoming[0]!.amountCents).toBe(-1549);
  });

  test('can go negative when commitments exceed the balance', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 5000,
      paydayHistory: paydays,
      subscriptions: [],
      installments: [{ id: 'p', label: 'Plan', amountCents: 20_000, dueDate: addDays(TODAY, 2) }],
      today: TODAY,
    });
    expect(result.safeToSpendCents).toBe(-15_000);
  });

  test('falls back to a two-week horizon when payday is unknown', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: [],
      subscriptions: [sub({ nextChargeDate: addDays(TODAY, 10) })],
      installments: [],
      today: TODAY,
    });

    expect(result.nextPayday).toBeNull();
    expect(result.committedCents).toBe(1549);
  });

  test('marks a trial conversion so the UI can highlight it', () => {
    const result = calculateSafeToSpend({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      subscriptions: [sub({ isFreeTrial: true, nextChargeDate: addDays(TODAY, 2) })],
      installments: [],
      today: TODAY,
    });
    expect(result.upcoming[0]!.isFreeTrialConversion).toBe(true);
  });
});

describe('buildTimeline', () => {
  test('projects repeating charges across the window', () => {
    const items = buildTimeline({
      checkingBalanceCents: 100_000,
      paydayHistory: [],
      subscriptions: [sub({ nextChargeDate: addDays(TODAY, 2) })],
      installments: [],
      today: TODAY,
      daysAhead: 70,
    });

    // Two charges within 70 days at a monthly cadence.
    expect(items.filter((i) => i.kind === 'subscription')).toHaveLength(3);
  });

  test('leaves blocked subscriptions off entirely', () => {
    const items = buildTimeline({
      checkingBalanceCents: 100_000,
      paydayHistory: [],
      subscriptions: [sub({ status: 'blocked' })],
      installments: [],
      today: TODAY,
    });
    expect(items).toEqual([]);
  });

  test('includes incoming pay with its amount', () => {
    const items = buildTimeline({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      paycheckAmountCents: 245_000,
      subscriptions: [],
      installments: [],
      today: TODAY,
      daysAhead: 30,
    });

    const income = items.filter((i) => i.kind === 'income');
    expect(income.length).toBeGreaterThan(0);
    expect(income[0]!.amountCents).toBe(245_000);
  });

  test('is ordered by date', () => {
    const items = buildTimeline({
      checkingBalanceCents: 100_000,
      paydayHistory: paydays,
      paycheckAmountCents: 245_000,
      subscriptions: [sub({ nextChargeDate: addDays(TODAY, 9) }), sub({ id: 's2', nextChargeDate: addDays(TODAY, 1) })],
      installments: [{ id: 'p', label: 'Plan', amountCents: 10_000, dueDate: addDays(TODAY, 5) }],
      today: TODAY,
      daysAhead: 40,
    });

    const times = items.map((i) => i.date.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
