import { describe, expect, test } from 'vitest';
import {
  INSTRUMENTS,
  MIN_ORDER_CENTS,
  applyBuy,
  applySell,
  checkBuy,
  checkSell,
  priceHistory,
  priceOn,
  quote,
  riskNote,
  sharesFor,
  valuePortfolio,
} from '../features/investing.js';

const today = new Date(Date.UTC(2026, 8, 19));

describe('prices', () => {
  test('the same day always gives the same price', () => {
    expect(priceOn('AAPL', today)).toBe(priceOn('AAPL', today));
  });

  test('different instruments move independently', () => {
    expect(priceOn('AAPL', today)).not.toBe(priceOn('MSFT', today));
  });

  test('history runs to today and is the right length', () => {
    const history = priceHistory('ORBX', 30, today);
    expect(history).toHaveLength(30);
    expect(history.at(-1)!.date).toBe('2026-09-19');
    expect(history.at(-1)!.priceCents).toBe(priceOn('ORBX', today));
  });

  test('prices stay positive over a long horizon', () => {
    for (const instrument of INSTRUMENTS) {
      expect(priceOn(instrument.symbol, new Date(Date.UTC(2027, 11, 31)))).toBeGreaterThan(0);
    }
  });

  test('a quote reports the day’s change', () => {
    const result = quote('BTC', today)!;
    const yesterday = priceOn('BTC', new Date(today.getTime() - 86_400_000));
    expect(result.changeCents).toBe(result.priceCents - yesterday);
    expect(result.risk).toBe('higher');
  });

  test('unknown symbols are handled', () => {
    expect(quote('NOPE', today)).toBeNull();
    expect(priceOn('NOPE', today)).toBe(0);
  });
});

describe('orders', () => {
  test('fractional shares let small amounts buy expensive assets', () => {
    // $10 of a $64,200 coin.
    expect(sharesFor(1_000, 6_420_000)).toBeCloseTo(0.000156, 6);
    expect(sharesFor(10_000, 10_000)).toBe(1);
  });

  test('rejects orders under a dollar and over the balance', () => {
    expect(checkBuy({ amountCents: 50, priceCents: 10_000, availableCents: 100_000 }).error).toContain('$1');
    expect(MIN_ORDER_CENTS).toBe(100);
    expect(checkBuy({ amountCents: 200_000, priceCents: 10_000, availableCents: 100_000 }).error).toContain('more than you have');
    expect(checkBuy({ amountCents: 5_000, priceCents: 10_000, availableCents: 100_000 }).ok).toBe(true);
  });

  test('cannot sell more than is held, and "sell all" works despite rounding', () => {
    expect(checkSell({ quantity: 2, held: 1, priceCents: 100 }).error).toContain("don't hold");
    expect(checkSell({ quantity: 1.0000000001, held: 1, priceCents: 100 })).toEqual({ ok: true, quantity: 1, priceCents: 100 });
  });
});

describe('cost basis', () => {
  test('buying more averages the cost', () => {
    const after = applyBuy({ symbol: 'AAPL', quantity: 1, costBasisCents: 20_000 }, 1, 30_000);
    expect(after).toEqual({ symbol: 'AAPL', quantity: 2, costBasisCents: 50_000 });
  });

  test('selling removes cost in proportion, leaving the average unchanged', () => {
    const { position, costRemovedCents } = applySell({ symbol: 'AAPL', quantity: 4, costBasisCents: 40_000 }, 1);
    expect(costRemovedCents).toBe(10_000);
    expect(position.quantity).toBe(3);
    expect(position.costBasisCents).toBe(30_000);
  });

  test('selling everything empties the position', () => {
    const { position } = applySell({ symbol: 'BTC', quantity: 0.5, costBasisCents: 100_000 }, 0.5);
    expect(position.quantity).toBe(0);
    expect(position.costBasisCents).toBe(0);
  });
});

describe('portfolio', () => {
  test('values holdings and totals profit', () => {
    const price = priceOn('ORBX', today);
    const portfolio = valuePortfolio([{ symbol: 'ORBX', quantity: 2, costBasisCents: 10_000 }], today);
    expect(portfolio.valueCents).toBe(Math.round(2 * price));
    expect(portfolio.gainCents).toBe(portfolio.valueCents - 10_000);
    expect(portfolio.positions[0]!.name).toBe('Orbit Total Market Fund');
  });

  test('drops emptied positions and sorts by size', () => {
    const portfolio = valuePortfolio(
      [
        { symbol: 'KO', quantity: 1, costBasisCents: 6_000 },
        { symbol: 'BTC', quantity: 0, costBasisCents: 0 },
        { symbol: 'NVDA', quantity: 5, costBasisCents: 400_000 },
      ],
      today,
    );
    expect(portfolio.positions.map((p) => p.symbol)).toEqual(['NVDA', 'KO']);
  });

  test('an empty portfolio is zero, not NaN', () => {
    const empty = valuePortfolio([], today);
    expect(empty).toEqual(expect.objectContaining({ valueCents: 0, gainPercent: 0, higherRiskShare: 0 }));
  });
});

describe('riskNote', () => {
  test('warns when most of the money is in volatile holdings', () => {
    const portfolio = valuePortfolio([{ symbol: 'BTC', quantity: 0.5, costBasisCents: 100_000 }], today);
    expect(riskNote(portfolio)).toContain('higher-risk');
  });

  test('nudges toward spreading a single holding', () => {
    const portfolio = valuePortfolio([{ symbol: 'KO', quantity: 10, costBasisCents: 60_000 }], today);
    expect(riskNote(portfolio)).toContain('one investment');
  });

  test('says nothing when a portfolio is sensibly spread', () => {
    const portfolio = valuePortfolio(
      [
        { symbol: 'ORBX', quantity: 40, costBasisCents: 400_000 },
        { symbol: 'KO', quantity: 10, costBasisCents: 60_000 },
      ],
      today,
    );
    expect(riskNote(portfolio)).toBeNull();
  });
});
