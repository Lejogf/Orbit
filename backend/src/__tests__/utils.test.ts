import { describe, expect, test } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  centsToDollars,
  daysBetween,
  dollarsToCents,
  formatCents,
  splitCents,
  toIsoDate,
} from '../lib/utils.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('dollarsToCents', () => {
  test('converts whole and fractional dollars', () => {
    expect(dollarsToCents(15.49)).toBe(1549);
    expect(dollarsToCents(100)).toBe(10_000);
  });

  test('rounds away float representation error', () => {
    // 0.1 + 0.2 is 0.30000000000000004, which would otherwise poison the integer math.
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);

    // 1.005 is stored as 1.00499999999999989, so the nearest cent really is 100.
    expect(dollarsToCents(1.005)).toBe(100);
  });

  test('round-trips through centsToDollars', () => {
    for (const cents of [0, 1, 999, 1549, 124_900]) {
      expect(dollarsToCents(centsToDollars(cents))).toBe(cents);
    }
  });
});

describe('formatCents', () => {
  test('formats with separators and two decimals', () => {
    expect(formatCents(1549)).toBe('$15.49');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(124_900)).toBe('$1,249.00');
  });

  test('puts the minus before the currency symbol', () => {
    expect(formatCents(-1549)).toBe('-$15.49');
  });
});

describe('splitCents', () => {
  test('splits evenly when it divides exactly', () => {
    expect(splitCents(60_000, 6)).toEqual([10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
  });

  test('spreads the remainder across the earliest parts', () => {
    expect(splitCents(10_000, 3)).toEqual([3334, 3333, 3333]);
  });

  test('never loses a cent, for any total and term we support', () => {
    for (const total of [1, 99, 59_999, 124_900, 1_000_001]) {
      for (const term of [3, 6, 12, 24]) {
        const parts = splitCents(total, term);
        expect(parts).toHaveLength(term);
        expect(parts.reduce((a: number, b: number) => a + b, 0)).toBe(total);
      }
    }
  });

  test('rejects a non-positive number of parts', () => {
    expect(() => splitCents(100, 0)).toThrow(/positive/);
  });
});

describe('addMonths', () => {
  test('adds whole months', () => {
    expect(toIsoDate(addMonths(utc(2026, 1, 15), 1))).toBe('2026-02-15');
  });

  test('clamps to the last day when the target month is shorter', () => {
    expect(toIsoDate(addMonths(utc(2026, 1, 31), 1))).toBe('2026-02-28');
    expect(toIsoDate(addMonths(utc(2024, 1, 31), 1))).toBe('2024-02-29');
  });

  test('goes backwards across a year boundary', () => {
    expect(toIsoDate(addMonths(utc(2026, 2, 10), -6))).toBe('2025-08-10');
  });
});

describe('addDays', () => {
  test('crosses month and year boundaries', () => {
    expect(toIsoDate(addDays(utc(2026, 12, 30), 3))).toBe('2027-01-02');
    expect(toIsoDate(addDays(utc(2026, 3, 1), -1))).toBe('2026-02-28');
  });
});

describe('addYears', () => {
  test('clamps Feb 29 into a non-leap year', () => {
    expect(toIsoDate(addYears(utc(2024, 2, 29), 1))).toBe('2025-02-28');
  });
});

describe('daysBetween', () => {
  test('counts whole days in both directions', () => {
    expect(daysBetween(utc(2026, 1, 1), utc(2026, 1, 31))).toBe(30);
    expect(daysBetween(utc(2026, 1, 31), utc(2026, 1, 1))).toBe(-30);
  });
});
