// The guards around the two live data sources.
//
// Neither Alpha Vantage nor Gemini is reachable from a test run, and neither
// should be: what is worth testing is the code that decides whether to TRUST
// what they say. A quote derived from the wrong end of a series, or a model
// rewrite that quietly drops a dollar amount, are both ways a customer ends up
// believing something false about their own money.

import { describe, expect, it } from 'vitest';
import { quoteFromSeries } from '../services/marketData.js';
import { figuresIn, preservesFigures } from '../services/gemini.js';

describe('quoteFromSeries', () => {
  const series = [
    { date: '2026-09-16', priceCents: 33_500 },
    { date: '2026-09-17', priceCents: 33_700 },
    { date: '2026-09-18', priceCents: 33_613 },
  ];

  it('takes the price from the last close and the comparison from the one before', () => {
    const quote = quoteFromSeries(series)!;
    expect(quote.priceCents).toBe(33_613);
    expect(quote.previousCloseCents).toBe(33_700);
  });

  it('dates the quote to the close it came from, not to now', () => {
    expect(quoteFromSeries(series)!.asOf).toBe('2026-09-18T21:00:00.000Z');
  });

  it('reports no change when there is only one close, rather than inventing one', () => {
    const quote = quoteFromSeries([{ date: '2026-09-18', priceCents: 33_613 }])!;
    expect(quote.priceCents).toBe(33_613);
    expect(quote.previousCloseCents).toBe(33_613);
  });

  it('returns null for an empty series', () => {
    expect(quoteFromSeries([])).toBeNull();
  });
});

describe('preservesFigures', () => {
  const original = "You've got $4,130.84 free until payday on Oct 1 — that's after I set aside $89.16 for bills.";

  it('accepts a rewrite that keeps every amount and date', () => {
    const rewritten =
      'Hi Jordan, you have $4,130.84 available until your payday on Oct 1. That is after setting aside $89.16 for bills.';
    expect(preservesFigures(original, rewritten)).toBe(true);
  });

  it('rejects a rewrite that rounds an amount', () => {
    expect(preservesFigures(original, 'You have about $4,000 free until payday on Oct 1, after $89.16 of bills.')).toBe(false);
  });

  it('rejects a rewrite that drops an amount entirely', () => {
    expect(preservesFigures(original, 'You have $4,130.84 free until payday on Oct 1.')).toBe(false);
  });

  it('rejects a rewrite that loses the date', () => {
    // This is the exact failure a small token budget produced: a truncated
    // reply that kept the amount and silently lost when it runs out.
    expect(preservesFigures(original, "You've got $4,130.84 available to spend, after $89.16 of bills.")).toBe(false);
  });

  it('ignores thousands separators, so $4,130.84 and $4130.84 are the same figure', () => {
    expect(preservesFigures('You have $4,130.84.', 'You have $4130.84.')).toBe(true);
  });

  it('accepts a rewrite that adds no figures of its own', () => {
    expect(preservesFigures('Your card is locked.', 'I have locked your card for you.')).toBe(true);
  });

  it('reads amounts, percentages and short dates as figures, in source order', () => {
    expect(figuresIn('Up 12.5% to $1,204.00 on Nov 3')).toEqual(['125%', '$120400', 'nov 3']);
  });
});
