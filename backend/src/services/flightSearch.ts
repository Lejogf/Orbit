// Live flight search, through SerpApi's `google_flights` engine.
//
// Same shape as the market data service, for the same reasons: cache hard, cap
// the spend, and never let an upstream problem break the page. SerpApi bills
// per search, so a repeated search inside the cache window costs nothing, and
// every result carries `source` so the UI can say whether these are real fares
// or the generated inventory.
//
// What is real and what is not:
//   * Prices, airlines, flight numbers, times, durations and stops come
//     straight from Google Flights when a key is configured.
//   * **Booking is still local.** There is no airline agreement behind this
//     app, so a booking records the itinerary, charges the card and issues a
//     reference — it does not reserve a seat. The UI says so.
//
// Without `SERPAPI_KEY` this module returns null for everything and
// `features/travel.ts` generates the inventory exactly as before.

import { config, readSerpApiKey } from '../config.js';
import type { FlightOption, FlightSearch } from '../features/travel.js';

interface CacheEntry {
  value: FlightOption[] | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<FlightOption[] | null>>();

/** Searches made this process. Shown in the UI so the cost is not invisible. */
let searchesMade = 0;
let lastError: string | null = null;

export function flightSearchStatus() {
  return {
    provider: 'SerpApi · Google Flights',
    configured: config.serpApi.hasKey,
    searchesMade,
    lastError,
  };
}

function cacheKey(search: FlightSearch): string {
  return [search.from, search.to, search.date, search.travelers].join('|').toUpperCase();
}

/** "PT7H35M"-ish minutes from SerpApi's plain integer, defensively. */
function minutes(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * SerpApi returns local times as "2026-10-15 08:30" with no zone. We have no
 * reliable zone for an arbitrary airport, so they are read as UTC and labelled
 * as local times in the UI — which is what a traveller wants to see anyway.
 */
function isoFrom(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.length < 10) return fallback;
  const parsed = new Date(`${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

interface SerpFlightLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  duration?: number;
  airline?: string;
  flight_number?: string;
  travel_class?: string;
}

interface SerpItinerary {
  flights?: SerpFlightLeg[];
  total_duration?: number;
  price?: number;
  booking_token?: string;
}

/**
 * One itinerary into Orbit's own shape. Returns null when the row is missing
 * the parts that make it bookable, rather than filling gaps with guesses.
 */
function toOption(itinerary: SerpItinerary, search: FlightSearch, index: number): FlightOption | null {
  const legs = itinerary.flights ?? [];
  const first = legs[0];
  const last = legs.at(-1);
  if (!first || !last || typeof itinerary.price !== 'number') return null;

  const dayStart = `${search.date}T08:00:00.000Z`;
  const departsAt = isoFrom(first.departure_airport?.time, dayStart);
  const duration = minutes(itinerary.total_duration) || legs.reduce((sum, leg) => sum + minutes(leg.duration), 0);
  const arrivesAt = isoFrom(
    last.arrival_airport?.time,
    new Date(new Date(departsAt).getTime() + duration * 60_000).toISOString(),
  );

  // SerpApi quotes the total for the party in whole currency units.
  const priceCents = Math.round(itinerary.price * 100);
  if (priceCents <= 0) return null;

  const airline = first.airline?.trim() || 'Airline';
  return {
    id: `L${(itinerary.booking_token ?? `${search.from}${search.to}${search.date}${index}`).slice(0, 18).replace(/[^A-Za-z0-9]/g, '')}`,
    airline,
    flightNumber: first.flight_number?.trim() || `${airline.slice(0, 2).toUpperCase()} —`,
    from: first.departure_airport?.id?.trim() || search.from,
    to: last.arrival_airport?.id?.trim() || search.to,
    departsAt,
    arrivesAt,
    durationMinutes: duration,
    // One leg is a non-stop; each extra leg is a stop.
    stops: Math.max(0, legs.length - 1),
    cabin: /premium|business|first/i.test(first.travel_class ?? '') ? 'premium' : 'economy',
    priceCents,
    // Google Flights does not publish seat counts. Rather than invent one, say
    // nothing: 0 means "unknown" and the UI omits the urgency line.
    seatsLeft: 0,
  };
}

/**
 * Live fares for one search, or null when there are none to be had — no key,
 * upstream failure, an unroutable pair, or a response we could not read.
 */
export async function liveFlights(search: FlightSearch): Promise<FlightOption[] | null> {
  if (!config.serpApi.hasKey) return null;

  const key = cacheKey(search);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const url = new URL(config.serpApi.baseUrl);
    url.searchParams.set('engine', 'google_flights');
    url.searchParams.set('departure_id', search.from.toUpperCase());
    url.searchParams.set('arrival_id', search.to.toUpperCase());
    url.searchParams.set('outbound_date', search.date);
    // type=2 is one-way. Orbit books legs separately, so a return trip is two
    // searches rather than one round-trip fare we would then have to split.
    url.searchParams.set('type', '2');
    url.searchParams.set('adults', String(Math.max(1, Math.min(9, search.travelers))));
    url.searchParams.set('currency', 'USD');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('api_key', readSerpApiKey());

    try {
      searchesMade += 1;
      const response = await fetch(url, { signal: AbortSignal.timeout(config.serpApi.timeoutMs) });
      const body = (await response.json()) as {
        error?: string;
        best_flights?: SerpItinerary[];
        other_flights?: SerpItinerary[];
      };

      if (!response.ok || body.error) {
        lastError = body.error ?? `HTTP ${response.status}`;
        return null;
      }

      // "best" first — that is Google's own ranking — then the rest, capped so
      // the page stays a decision rather than a list.
      const itineraries = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
      const options = itineraries
        .map((itinerary, i) => toOption(itinerary, search, i))
        .filter((option): option is FlightOption => option !== null)
        .sort((a, b) => a.priceCents - b.priceCents)
        .slice(0, 8);

      if (options.length === 0) {
        lastError = 'No fares returned for that route and date.';
        return null;
      }
      lastError = null;
      return options;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : 'Flight search failed.';
      return null;
    }
  })();

  inFlight.set(key, request);
  try {
    const value = await request;
    // A miss is cached briefly so a dead route is not re-searched on every
    // keystroke; a hit is cached for the full window because fares do not move
    // minute to minute and every search costs money.
    cache.set(key, { value, expiresAt: Date.now() + (value ? config.serpApi.cacheTtlMs : 60_000) });
    return value;
  } finally {
    inFlight.delete(key);
  }
}
