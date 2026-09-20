// Live market data, from Alpha Vantage.
//
// The free tier is tight in two different ways, and both have to be respected
// or the API starts answering with prose instead of prices:
//
//   * **25 calls a day.** Counted here, and hard-stopped before the limit.
//   * **1 call a second.** Every upstream call goes through one paced queue,
//     so nothing this process does can ever burst.
//
// That budget also dictates WHICH endpoint to use. `TIME_SERIES_DAILY` returns
// a hundred daily closes in one call, and the last two of those are the price
// and the previous close — so one call buys both the chart and the quote.
// `GLOBAL_QUOTE` would buy only the quote, for the same price. So equities go
// through the daily series, and crypto (whose daily series is premium-only)
// goes through the free exchange-rate endpoint with a simulated history.
//
// Those limits also rule out fetching a board of 22 symbols while a request
// waits. So the read path never blocks on the network:
//
//   1. `priceBook` answers from cache immediately and **queues** cold symbols
//      to be warmed in the background. The first visit to Invest is simulated;
//      a few seconds later the board is live, and stays live for hours.
//   2. `priceBookNow` is the exception — it awaits, with a deadline, and is
//      used when the customer taps one specific investment and is owed a real
//      answer for it.
//
// Anything not live falls back to the deterministic walk in
// `features/investing.ts`, and the response carries `source` so the UI can say
// which it is rather than implying live.
//
// ORBX is Orbit's own fund and has no listing. It is priced from the live value
// of ORBX_BASKET, rebased to the fund's unit price, so it moves because its
// constituents moved — not because we made a number up.

import { config, readAlphaVantageKey } from '../config.js';
import {
  INSTRUMENTS,
  ORBX_BASKET,
  instrumentFor,
  priceHistory,
  priceOn,
  type LivePrice,
  type PricePoint,
  type PriceSource,
} from '../features/investing.js';

const DAY_MS = 86_400_000;

/** Alpha Vantage free tier is 25/day. Kept under, to leave room for a detail view. */
const DAILY_CALL_BUDGET = Number(process.env.ALPHA_VANTAGE_DAILY_BUDGET ?? 22);
/** Alpha Vantage free tier is 1/second. A little over, to be safe. */
const MIN_CALL_GAP_MS = Number(process.env.ALPHA_VANTAGE_MIN_GAP_MS ?? 1_300);

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const quoteCache = new Map<string, CacheEntry<LivePrice | null>>();
const seriesCache = new Map<string, CacheEntry<PricePoint[] | null>>();

/** Calls spent today, reset when the UTC date rolls over. */
let callsToday = 0;
let callBudgetDay = new Date().toISOString().slice(0, 10);
/** Set when upstream asks us to slow down. Nothing goes out until it passes. */
let pausedUntil = 0;

function budgetRemaining(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== callBudgetDay) {
    callBudgetDay = today;
    callsToday = 0;
  }
  return DAILY_CALL_BUDGET - callsToday;
}

export function marketDataStatus() {
  return {
    provider: 'Alpha Vantage',
    configured: config.alphaVantage.hasKey,
    callsToday,
    dailyBudget: DAILY_CALL_BUDGET,
    /** Cold symbols still queued to be warmed. */
    warming: queue.length + (running ? 1 : 0),
    throttledUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null,
    budgetResetsAt: `${callBudgetDay}T00:00:00Z`,
  };
}

// --- the paced queue ------------------------------------------------------

interface Job {
  /** Dedupes: one job per cache key at a time. */
  key: string;
  run: () => Promise<void>;
  settled: Promise<void>;
  resolve: () => void;
}

const queue: Job[] = [];
const pending = new Map<string, Job>();
let running = false;
let lastCallAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Queue a unit of work. Identical keys share one job, so ten viewers asking for
 * AAPL cost one call. Returns a promise that settles when that job has run.
 */
function enqueue(key: string, run: () => Promise<void>): Promise<void> {
  const existing = pending.get(key);
  if (existing) return existing.settled;

  let resolve!: () => void;
  const settled = new Promise<void>((r) => (resolve = r));
  const job: Job = { key, run, settled, resolve };
  pending.set(key, job);
  queue.push(job);
  void drain();
  return settled;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      const wait = Math.max(pausedUntil - Date.now(), lastCallAt + MIN_CALL_GAP_MS - Date.now());
      if (wait > 0) await sleep(wait);
      try {
        await job.run();
      } catch {
        // A failed warm-up is not an error anyone needs to see: the simulated
        // price already answered, and the next visit will try again.
      } finally {
        pending.delete(job.key);
        job.resolve();
      }
    }
  } finally {
    running = false;
  }
}

/** One request. Returns null rather than throwing, for any reason at all. */
async function fetchJson(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  if (!config.alphaVantage.hasKey) return null;
  if (budgetRemaining() <= 0) return null;

  const url = new URL(config.alphaVantage.baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('apikey', readAlphaVantageKey());

  callsToday += 1;
  lastCallAt = Date.now();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(config.alphaVantage.timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;

    // Alpha Vantage answers 200 with prose when it wants us to slow down, when
    // the daily limit is gone, or when the endpoint is premium-only. They are
    // not the same thing, and treating a one-second burst warning as "quota
    // exhausted" would blank the board for the rest of the day.
    const note = String(body['Note'] ?? body['Information'] ?? '');
    if (note) {
      if (/per day|daily/i.test(note) && !/per second/i.test(note)) {
        callsToday = DAILY_CALL_BUDGET; // genuinely out for today
      } else {
        pausedUntil = Date.now() + 15_000; // burst limit, or a premium endpoint
      }
      return null;
    }
    if (body['Error Message']) return null;
    return body;
  } catch {
    return null;
  }
}

/** Dollars-as-string ("336.1300") to integer cents, or null if unparseable. */
function toCents(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

// --- quotes ---------------------------------------------------------------

/** The last two closes of a daily series are a quote. */
export function quoteFromSeries(points: PricePoint[]): LivePrice | null {
  const last = points.at(-1);
  if (!last) return null;
  return {
    priceCents: last.priceCents,
    previousCloseCents: points.at(-2)?.priceCents ?? last.priceCents,
    asOf: new Date(`${last.date}T21:00:00Z`).toISOString(),
  };
}

async function fetchCryptoQuote(marketSymbol: string): Promise<LivePrice | null> {
  const body = await fetchJson({
    function: 'CURRENCY_EXCHANGE_RATE',
    from_currency: marketSymbol,
    to_currency: 'USD',
  });
  const row = body?.['Realtime Currency Exchange Rate'] as Record<string, string> | undefined;
  if (!row) return null;

  const priceCents = toCents(row['5. Exchange Rate']);
  if (priceCents === null) return null;

  // Crypto trades continuously, so there is no "previous close" upstream. The
  // simulated walk supplies yesterday, which keeps the day-change honest in
  // direction even though its exact size is an estimate.
  return {
    priceCents,
    previousCloseCents: priceOn(marketSymbol, new Date(Date.now() - DAY_MS)),
    asOf: row['6. Last Refreshed']
      ? new Date(`${row['6. Last Refreshed'].replace(' ', 'T')}Z`).toISOString()
      : new Date().toISOString(),
  };
}

function cachedQuote(marketSymbol: string): LivePrice | null | undefined {
  const entry = quoteCache.get(`q:${marketSymbol}`);
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

/**
 * Queue a warm-up for one symbol, and resolve when that job has run.
 *
 * For an equity this fetches the daily series, which yields the chart and the
 * quote from a single call. For crypto it fetches the exchange rate, because
 * the crypto daily series is premium-only.
 */
function warmQuote(symbol: string): Promise<void> {
  const instrument = instrumentFor(symbol);
  if (!instrument?.marketSymbol) return Promise.resolve();
  const marketSymbol = instrument.marketSymbol;

  if (instrument.kind !== 'crypto') return warmSeries(symbol);

  return enqueue(`q:${marketSymbol}`, async () => {
    if (cachedQuote(marketSymbol) !== undefined) return; // warmed while queued
    const value = await fetchCryptoQuote(marketSymbol);
    // Misses are cached briefly too, so a bad symbol is not retried forever.
    quoteCache.set(`q:${marketSymbol}`, {
      value,
      expiresAt: Date.now() + (value ? config.alphaVantage.quoteTtlMs : 60_000),
    });
  });
}

/** The cached live price for one symbol, without going upstream. */
function cachedPriceFor(symbol: string): LivePrice | null {
  if (symbol === 'ORBX') return cachedOrbxPrice();
  const instrument = instrumentFor(symbol);
  if (!instrument?.marketSymbol) return null;

  // Equities: the quote lives in the series we already paid for.
  if (instrument.kind !== 'crypto') {
    const points = cachedSeries(instrument.marketSymbol);
    return points && points.length > 0 ? quoteFromSeries(points) : null;
  }
  return cachedQuote(instrument.marketSymbol) ?? null;
}

/**
 * ORBX: the live value of the basket, rebased so a unit costs roughly what the
 * fund has always cost. Every constituent must be live — a blend of live and
 * invented numbers would be worse than being plainly simulated.
 */
function cachedOrbxPrice(): LivePrice | null {
  const parts = ORBX_BASKET.map(({ symbol, weight }) => ({ weight, live: cachedPriceFor(symbol) }));
  if (parts.some((p) => !p.live)) return null;

  const baseline = ORBX_BASKET.reduce(
    (sum, { symbol, weight }) => sum + weight * (instrumentFor(symbol)?.basePriceCents ?? 0),
    0,
  );
  if (baseline <= 0) return null;
  const rebase = instrumentFor('ORBX')!.basePriceCents / baseline;

  return {
    priceCents: Math.max(1, Math.round(parts.reduce((s, p) => s + p.weight * p.live!.priceCents, 0) * rebase)),
    previousCloseCents: Math.max(
      1,
      Math.round(parts.reduce((s, p) => s + p.weight * p.live!.previousCloseCents, 0) * rebase),
    ),
    asOf: parts.reduce((latest, p) => (p.live!.asOf > latest ? p.live!.asOf : latest), parts[0]!.live!.asOf),
  };
}

/** The upstream symbols a given Orbit symbol depends on. */
function dependencies(symbol: string): string[] {
  return symbol === 'ORBX' ? ORBX_BASKET.map((b) => b.symbol) : [symbol];
}

/**
 * Prices that are already cached, plus a background warm-up for the ones that
 * are not. Never blocks: the caller gets whatever is live right now, and the
 * board fills in over the next few seconds.
 */
export function priceBook(symbols: string[]): Map<string, LivePrice> {
  const book = new Map<string, LivePrice>();
  if (!config.alphaVantage.hasKey) return book;

  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
  for (const symbol of wanted) {
    const live = cachedPriceFor(symbol);
    if (live) book.set(symbol, live);
    else for (const dep of dependencies(symbol)) void warmQuote(dep);
  }
  return book;
}

/**
 * The Invest page's book: the customer's own holdings first (those numbers are
 * their money), then the featured names, then the rest. Warm-up runs in that
 * order, so what matters most goes live first.
 */
export function priceBookForAll(held: string[] = []): Map<string, LivePrice> {
  const holdings = held.map((s) => s.toUpperCase());
  const featured = INSTRUMENTS.filter((i) => i.featured).map((i) => i.symbol);
  return priceBook([...holdings, ...featured, ...INSTRUMENTS.map((i) => i.symbol)]);
}

/**
 * Awaits a live price, up to `deadlineMs`. Used when the customer has tapped
 * one investment and is owed a real number for it — and when an order is about
 * to fill, where the price must be the best one we can actually get.
 */
export async function priceBookNow(symbols: string[], deadlineMs = 6_000): Promise<Map<string, LivePrice>> {
  if (!config.alphaVantage.hasKey) return new Map();

  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const warms = wanted
    .filter((symbol) => !cachedPriceFor(symbol))
    .flatMap((symbol) => dependencies(symbol).map((dep) => warmQuote(dep)));

  // A deadline, not a guarantee: a slow upstream must not hold up the page.
  await Promise.race([Promise.all(warms), sleep(deadlineMs)]);
  return priceBook(wanted);
}

// --- history --------------------------------------------------------------

export interface Series {
  symbol: string;
  points: PricePoint[];
  source: PriceSource;
}

async function fetchDailySeries(marketSymbol: string, kind: string): Promise<PricePoint[] | null> {
  // DIGITAL_CURRENCY_DAILY is premium-only on the free tier, so crypto history
  // stays simulated rather than spending a call to be told no.
  if (kind === 'crypto') return null;

  const body = await fetchJson({ function: 'TIME_SERIES_DAILY', symbol: marketSymbol, outputsize: 'compact' });
  const seriesKey = Object.keys(body ?? {}).find((k) => k.toLowerCase().includes('time series'));
  if (!body || !seriesKey) return null;

  const rows = body[seriesKey] as Record<string, Record<string, string>>;
  const points: PricePoint[] = [];
  for (const [date, values] of Object.entries(rows)) {
    const closeKey = Object.keys(values).find((k) => k.includes('close')) ?? '4. close';
    const cents = toCents(values[closeKey]);
    if (cents !== null) points.push({ date, priceCents: cents });
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function cachedSeries(marketSymbol: string): PricePoint[] | null | undefined {
  const entry = seriesCache.get(`s:${marketSymbol}`);
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

function warmSeries(symbol: string): Promise<void> {
  const instrument = instrumentFor(symbol);
  if (!instrument?.marketSymbol) return Promise.resolve();
  const marketSymbol = instrument.marketSymbol;

  return enqueue(`s:${marketSymbol}`, async () => {
    if (cachedSeries(marketSymbol) !== undefined) return;
    const fetched = await fetchDailySeries(marketSymbol, instrument.kind);
    seriesCache.set(`s:${marketSymbol}`, {
      value: fetched,
      expiresAt: Date.now() + (fetched ? config.alphaVantage.seriesTtlMs : 5 * 60_000),
    });
  });
}

/**
 * A daily price series for the chart. Live when we have it or can get it inside
 * the deadline, simulated otherwise, and always exactly `days` points ending
 * today so the chart never has a gap.
 */
export async function series(symbol: string, days: number, deadlineMs = 6_000): Promise<Series> {
  const upper = symbol.toUpperCase();
  const instrument = instrumentFor(upper);
  const simulated: Series = { symbol: upper, points: priceHistory(upper, days), source: 'simulated' };
  if (!instrument) return simulated;

  if (upper === 'ORBX') return orbxSeries(days, deadlineMs);
  if (!instrument.marketSymbol || !config.alphaVantage.hasKey) return simulated;
  // Crypto's daily series is premium-only, so its chart stays simulated even
  // though its price is live. The response says so.
  if (instrument.kind === 'crypto') return simulated;

  if (cachedSeries(instrument.marketSymbol) === undefined) {
    await Promise.race([warmSeries(upper), sleep(deadlineMs)]);
  }
  const points = cachedSeries(instrument.marketSymbol);
  if (!points || points.length === 0) return simulated;
  return { symbol: upper, points: points.slice(-days), source: 'live' };
}

/** ORBX's history: the basket's history, weighted and rebased the same way. */
async function orbxSeries(days: number, deadlineMs: number): Promise<Series> {
  const simulated: Series = { symbol: 'ORBX', points: priceHistory('ORBX', days), source: 'simulated' };
  if (!config.alphaVantage.hasKey) return simulated;

  // The board's warm-up already fetches each constituent's daily series (that
  // is where their quotes come from), so by the time ORBX is live its chart is
  // free: no extra calls, just the same ten series weighted and rebased.
  const parts = ORBX_BASKET.map(({ symbol, weight }) => ({
    weight,
    points: cachedSeries(instrumentFor(symbol)?.marketSymbol ?? '') ?? null,
  }));
  if (parts.some((p) => !p.points || p.points.length === 0)) {
    void deadlineMs; // nothing to wait for: we never queue ten series at once
    return simulated;
  }

  const baseline = ORBX_BASKET.reduce(
    (sum, { symbol, weight }) => sum + weight * (instrumentFor(symbol)?.basePriceCents ?? 0),
    0,
  );
  if (baseline <= 0) return simulated;
  const rebase = instrumentFor('ORBX')!.basePriceCents / baseline;

  // Align on the dates every constituent actually traded, so a half-holiday in
  // one name cannot drop the index.
  const dates = parts
    .map((p) => new Set(p.points!.map((pt) => pt.date)))
    .reduce((shared, next) => new Set([...shared].filter((d) => next.has(d))));

  const points = [...dates].sort().map((date) => ({
    date,
    priceCents: Math.max(
      1,
      Math.round(
        parts.reduce((sum, p) => sum + p.weight * (p.points!.find((pt) => pt.date === date)?.priceCents ?? 0), 0) *
          rebase,
      ),
    ),
  }));

  if (points.length === 0) return simulated;
  return { symbol: 'ORBX', points: points.slice(-days), source: 'live' };
}
