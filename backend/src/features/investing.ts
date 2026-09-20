// Investing, for people who have never invested.
//
// Prices are LIVE where a market symbol exists: `services/marketData.ts` quotes
// Alpha Vantage and caches the answer. The pure functions below stay the
// fallback — a deterministic walk from the symbol and the date, so the same day
// always shows the same price and history looks like a market rather than
// noise. That fallback carries the app when the key is missing, the daily quota
// is spent, or the venue is shut.
//
// Everything around the price — fractional orders, cost basis, profit and loss,
// what an order costs you today — is real arithmetic either way.
//
// The teaching bit matters as much as the trading bit: every instrument carries
// a plain-language description and a risk band, and orders state what you are
// about to own.

import { createRng } from '../lib/utils.js';

export type AssetKind = 'stock' | 'etf' | 'crypto';
export type RiskBand = 'lower' | 'medium' | 'higher';

export interface Instrument {
  symbol: string;
  name: string;
  kind: AssetKind;
  risk: RiskBand;
  /** Reference price in cents, before the daily movement. */
  basePriceCents: number;
  /** How much it typically moves in a day, as a fraction. */
  dailyVolatility: number;
  blurb: string;
  /**
   * The ticker to quote upstream. Omitted for ORBX, which has no listing: it is
   * Orbit's own fund, priced from the live constituents in ORBX_BASKET.
   */
  marketSymbol?: string;
  /** Shown in the "top companies" rail on the Invest page. */
  featured?: boolean;
}

/**
 * ORBX is Orbit's own total-market fund. It is not listed anywhere, so its
 * price is the live value of what it holds, rebased to the fund's unit price.
 * That keeps it honest: ORBX moves because its constituents moved today.
 */
export const ORBX_BASKET: { symbol: string; weight: number }[] = [
  { symbol: 'AAPL', weight: 0.14 },
  { symbol: 'MSFT', weight: 0.14 },
  { symbol: 'NVDA', weight: 0.13 },
  { symbol: 'GOOGL', weight: 0.11 },
  { symbol: 'AMZN', weight: 0.11 },
  { symbol: 'META', weight: 0.08 },
  { symbol: 'JPM', weight: 0.08 },
  { symbol: 'V', weight: 0.07 },
  { symbol: 'WMT', weight: 0.07 },
  { symbol: 'KO', weight: 0.07 },
];

export const INSTRUMENTS: Instrument[] = [
  // Orbit's own fund, priced from the live basket above. Deliberately first.
  { symbol: 'ORBX', name: 'Orbit Total Market Fund', kind: 'etf', risk: 'lower', basePriceCents: 12_450, dailyVolatility: 0.006, featured: true, blurb: 'One fund holding a slice of thousands of companies. The usual first investment, because a single company failing barely moves it. Priced live from what it holds.' },

  // --- funds ---
  { symbol: 'SPY5', name: 'Large Company Index', kind: 'etf', risk: 'lower', basePriceCents: 48_900, dailyVolatility: 0.007, marketSymbol: 'SPY', featured: true, blurb: 'Tracks the 500 biggest US companies. Boring on purpose.' },
  { symbol: 'QQQ', name: 'Tech 100 Index', kind: 'etf', risk: 'medium', basePriceCents: 42_100, dailyVolatility: 0.011, marketSymbol: 'QQQ', featured: true, blurb: 'The 100 largest non-financial companies on the Nasdaq. More technology, so it swings more than a total-market fund.' },
  { symbol: 'VTI', name: 'Total US Market', kind: 'etf', risk: 'lower', basePriceCents: 27_400, dailyVolatility: 0.007, marketSymbol: 'VTI', blurb: 'Almost every public US company in one holding.' },
  { symbol: 'BNDX', name: 'Bond Fund', kind: 'etf', risk: 'lower', basePriceCents: 7_320, dailyVolatility: 0.003, marketSymbol: 'BND', blurb: 'Lends money to governments and companies. Moves less than shares, and pays interest.' },

  // --- the companies most people recognise ---
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', risk: 'medium', basePriceCents: 22_680, dailyVolatility: 0.014, marketSymbol: 'AAPL', featured: true, blurb: 'One company. If Apple has a bad year, your money has a bad year.' },
  { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', risk: 'medium', basePriceCents: 41_530, dailyVolatility: 0.013, marketSymbol: 'MSFT', featured: true, blurb: 'Software, cloud and games.' },
  { symbol: 'NVDA', name: 'Nvidia', kind: 'stock', risk: 'higher', basePriceCents: 87_400, dailyVolatility: 0.028, marketSymbol: 'NVDA', featured: true, blurb: 'Chips for AI. Has moved a long way, fast, in both directions.' },
  { symbol: 'GOOGL', name: 'Alphabet', kind: 'stock', risk: 'medium', basePriceCents: 19_850, dailyVolatility: 0.016, marketSymbol: 'GOOGL', featured: true, blurb: 'Google search, YouTube, Android and cloud.' },
  { symbol: 'AMZN', name: 'Amazon', kind: 'stock', risk: 'medium', basePriceCents: 21_320, dailyVolatility: 0.017, marketSymbol: 'AMZN', featured: true, blurb: 'Online retail plus AWS, which is where most of the profit comes from.' },
  { symbol: 'META', name: 'Meta', kind: 'stock', risk: 'higher', basePriceCents: 58_700, dailyVolatility: 0.021, marketSymbol: 'META', featured: true, blurb: 'Facebook, Instagram and WhatsApp. Advertising pays for all of it.' },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', risk: 'higher', basePriceCents: 24_150, dailyVolatility: 0.031, marketSymbol: 'TSLA', featured: true, blurb: 'Cars and energy. Famously bumpy.' },
  { symbol: 'NFLX', name: 'Netflix', kind: 'stock', risk: 'higher', basePriceCents: 71_200, dailyVolatility: 0.022, marketSymbol: 'NFLX', blurb: 'Streaming. You may already be paying them every month.' },
  { symbol: 'AMD', name: 'AMD', kind: 'stock', risk: 'higher', basePriceCents: 16_400, dailyVolatility: 0.029, marketSymbol: 'AMD', blurb: 'The other big chip designer. Moves with the same news as Nvidia.' },
  { symbol: 'JPM', name: 'JPMorgan Chase', kind: 'stock', risk: 'medium', basePriceCents: 24_600, dailyVolatility: 0.012, marketSymbol: 'JPM', blurb: 'The largest US bank. Tracks interest rates and the economy.' },
  { symbol: 'V', name: 'Visa', kind: 'stock', risk: 'lower', basePriceCents: 31_800, dailyVolatility: 0.010, marketSymbol: 'V', blurb: 'Takes a small cut of an enormous number of card payments.' },
  { symbol: 'WMT', name: 'Walmart', kind: 'stock', risk: 'lower', basePriceCents: 9_840, dailyVolatility: 0.009, marketSymbol: 'WMT', blurb: 'Groceries and general retail. Holds up when money is tight.' },
  { symbol: 'DIS', name: 'Disney', kind: 'stock', risk: 'medium', basePriceCents: 11_200, dailyVolatility: 0.016, marketSymbol: 'DIS', blurb: 'Films, parks and streaming.' },
  { symbol: 'KO', name: 'Coca-Cola', kind: 'stock', risk: 'lower', basePriceCents: 6_240, dailyVolatility: 0.008, marketSymbol: 'KO', blurb: 'Sells drinks everywhere, pays a dividend.' },

  // --- crypto ---
  { symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', risk: 'higher', basePriceCents: 6_420_000, dailyVolatility: 0.035, marketSymbol: 'BTC', featured: true, blurb: 'Not backed by a company or a government. Can fall by half and has done, more than once. Only invest what you can afford to lose.' },
  { symbol: 'ETH', name: 'Ethereum', kind: 'crypto', risk: 'higher', basePriceCents: 341_000, dailyVolatility: 0.04, marketSymbol: 'ETH', blurb: 'A second major crypto network. Same warning as Bitcoin.' },
];

export function instrumentFor(symbol: string): Instrument | null {
  return INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase()) ?? null;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAY_MS = 86_400_000;

/**
 * A random walk anchored to the instrument's base price: today's price depends
 * on every day before it, so the chart trends instead of jittering, and the
 * same date always produces the same number.
 */
export function priceOn(symbol: string, date: Date): number {
  const instrument = instrumentFor(symbol);
  if (!instrument) return 0;

  const dayIndex = Math.floor(date.getTime() / DAY_MS);
  const rng = createRng(hash(symbol));
  // Walk forward from a fixed epoch so history is stable across calls.
  const epoch = Math.floor(Date.UTC(2025, 0, 1) / DAY_MS);
  let price = instrument.basePriceCents;
  // A gentle upward drift, because markets have historically risen over time.
  const drift = instrument.kind === 'crypto' ? 0.0004 : 0.00025;

  for (let day = epoch; day <= dayIndex; day++) {
    const shock = (rng.next() - 0.5) * 2 * instrument.dailyVolatility;
    price = price * (1 + drift + shock);
  }
  return Math.max(1, Math.round(price));
}

export interface PricePoint {
  date: string;
  priceCents: number;
}

export function priceHistory(symbol: string, days: number, today = new Date()): PricePoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today.getTime() - (days - 1 - i) * DAY_MS);
    return { date: date.toISOString().slice(0, 10), priceCents: priceOn(symbol, date) };
  });
}

/** Where a price came from. The UI says which, rather than implying live. */
export type PriceSource = 'live' | 'simulated';

/** A price fetched upstream, ready to overlay on the simulated one. */
export interface LivePrice {
  priceCents: number;
  previousCloseCents: number;
  /** The market's own timestamp, not ours. */
  asOf: string;
}

export interface Quote {
  symbol: string;
  name: string;
  kind: AssetKind;
  risk: RiskBand;
  blurb: string;
  priceCents: number;
  /** Change since yesterday, in cents and as a fraction. */
  changeCents: number;
  changePercent: number;
  source: PriceSource;
  /** When this price was true. ISO 8601. */
  asOf: string;
  featured: boolean;
}

/**
 * `live` wins when it is there. When it is not, the deterministic walk answers,
 * and `source` says so — the UI never claims a simulated price is live.
 */
export function quote(symbol: string, today = new Date(), live?: LivePrice | null): Quote | null {
  const instrument = instrumentFor(symbol);
  if (!instrument) return null;

  const priceCents = live?.priceCents ?? priceOn(symbol, today);
  const previous = live?.previousCloseCents ?? priceOn(symbol, new Date(today.getTime() - DAY_MS));

  return {
    symbol: instrument.symbol,
    name: instrument.name,
    kind: instrument.kind,
    risk: instrument.risk,
    blurb: instrument.blurb,
    priceCents,
    changeCents: priceCents - previous,
    changePercent: previous > 0 ? (priceCents - previous) / previous : 0,
    source: live ? 'live' : 'simulated',
    asOf: live?.asOf ?? today.toISOString(),
    featured: instrument.featured ?? false,
  };
}

// --- orders ---

/** Fractional shares, to six places: $5 of a $640 share is a real order. */
export function sharesFor(amountCents: number, priceCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.round((amountCents / priceCents) * 1e6) / 1e6;
}

export const MIN_ORDER_CENTS = 100;

export interface OrderCheck {
  ok: boolean;
  error?: string;
  quantity: number;
  priceCents: number;
}

export function checkBuy(input: { amountCents: number; priceCents: number; availableCents: number }): OrderCheck {
  const quantity = sharesFor(input.amountCents, input.priceCents);
  if (input.amountCents < MIN_ORDER_CENTS) {
    return { ok: false, error: 'The smallest order is $1.', quantity, priceCents: input.priceCents };
  }
  if (input.amountCents > input.availableCents) {
    return { ok: false, error: "That's more than you have available to invest.", quantity, priceCents: input.priceCents };
  }
  return { ok: true, quantity, priceCents: input.priceCents };
}

export function checkSell(input: { quantity: number; held: number; priceCents: number }): OrderCheck {
  if (input.quantity <= 0) return { ok: false, error: 'Choose how much to sell.', quantity: 0, priceCents: input.priceCents };
  // Floating point: allow a hair over, so "sell all" always works.
  if (input.quantity > input.held + 1e-9) {
    return { ok: false, error: "You don't hold that much.", quantity: input.quantity, priceCents: input.priceCents };
  }
  return { ok: true, quantity: Math.min(input.quantity, input.held), priceCents: input.priceCents };
}

// --- portfolio ---

export interface Position {
  symbol: string;
  quantity: number;
  costBasisCents: number;
}

export interface ValuedPosition extends Position {
  name: string;
  kind: AssetKind;
  risk: RiskBand;
  priceCents: number;
  valueCents: number;
  gainCents: number;
  gainPercent: number;
  dayChangeCents: number;
}

export interface Portfolio {
  positions: ValuedPosition[];
  valueCents: number;
  costBasisCents: number;
  gainCents: number;
  gainPercent: number;
  dayChangeCents: number;
  /** Share of the portfolio in higher-risk holdings, 0..1. */
  higherRiskShare: number;
}

/**
 * Live prices by symbol, when the caller has them. Missing symbols fall back to
 * the deterministic walk, so a partial quota never blanks the portfolio.
 */
export type PriceBook = ReadonlyMap<string, LivePrice>;

export function valuePortfolio(positions: Position[], today = new Date(), prices?: PriceBook): Portfolio {
  const valued = positions
    .filter((p) => p.quantity > 0)
    .map((position) => {
      const instrument = instrumentFor(position.symbol);
      const live = prices?.get(position.symbol) ?? null;
      const priceCents = live?.priceCents ?? priceOn(position.symbol, today);
      const yesterday = live?.previousCloseCents ?? priceOn(position.symbol, new Date(today.getTime() - DAY_MS));
      const valueCents = Math.round(position.quantity * priceCents);
      return {
        ...position,
        name: instrument?.name ?? position.symbol,
        kind: instrument?.kind ?? 'stock',
        risk: instrument?.risk ?? 'medium',
        priceCents,
        valueCents,
        gainCents: valueCents - position.costBasisCents,
        gainPercent: position.costBasisCents > 0 ? (valueCents - position.costBasisCents) / position.costBasisCents : 0,
        dayChangeCents: Math.round(position.quantity * (priceCents - yesterday)),
      } satisfies ValuedPosition;
    })
    .sort((a, b) => b.valueCents - a.valueCents);

  const valueCents = valued.reduce((s, p) => s + p.valueCents, 0);
  const costBasisCents = valued.reduce((s, p) => s + p.costBasisCents, 0);
  const higherRisk = valued.filter((p) => p.risk === 'higher').reduce((s, p) => s + p.valueCents, 0);

  return {
    positions: valued,
    valueCents,
    costBasisCents,
    gainCents: valueCents - costBasisCents,
    gainPercent: costBasisCents > 0 ? (valueCents - costBasisCents) / costBasisCents : 0,
    dayChangeCents: valued.reduce((s, p) => s + p.dayChangeCents, 0),
    higherRiskShare: valueCents > 0 ? higherRisk / valueCents : 0,
  };
}

/** Average cost after buying more — the number that decides future profit. */
export function applyBuy(position: Position, quantity: number, amountCents: number): Position {
  return {
    symbol: position.symbol,
    quantity: Math.round((position.quantity + quantity) * 1e6) / 1e6,
    costBasisCents: position.costBasisCents + amountCents,
  };
}

/** Selling removes cost basis in proportion, so the remaining average is unchanged. */
export function applySell(position: Position, quantity: number): { position: Position; costRemovedCents: number } {
  const share = position.quantity > 0 ? Math.min(1, quantity / position.quantity) : 0;
  const costRemovedCents = Math.round(position.costBasisCents * share);
  return {
    position: {
      symbol: position.symbol,
      quantity: Math.max(0, Math.round((position.quantity - quantity) * 1e6) / 1e6),
      costBasisCents: position.costBasisCents - costRemovedCents,
    },
    costRemovedCents,
  };
}

/** A plain warning when a portfolio is concentrated in volatile things. */
export function riskNote(portfolio: Portfolio): string | null {
  if (portfolio.valueCents === 0) return null;
  if (portfolio.higherRiskShare >= 0.6) {
    return `${Math.round(portfolio.higherRiskShare * 100)}% of your portfolio is in higher-risk holdings. That can swing hard both ways — spreading some into a broad fund would steady it.`;
  }
  if (portfolio.positions.length === 1) {
    return 'Everything you hold is in one investment. A broad fund spreads the same money across hundreds of companies.';
  }
  return null;
}
