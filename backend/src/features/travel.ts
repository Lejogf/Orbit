// Travel booking, price prediction, price drop protection and the rewards
// optimizer.
//
// Nessie has no travel inventory, so fares are generated deterministically from
// the route and date: the same search always returns the same flights, which is
// what makes the demo repeatable and the logic testable. Everything that touches
// money — what you pay, what you earn, what miles are worth, what a price drop
// refunds — is real logic over those fares.

import { createRng, daysBetween, formatCents } from '../lib/utils.js';

export const AIRPORTS = [
  { code: 'IAD', city: 'Washington, DC' },
  { code: 'DCA', city: 'Washington, DC (Reagan)' },
  { code: 'RIC', city: 'Richmond' },
  { code: 'JFK', city: 'New York' },
  { code: 'BOS', city: 'Boston' },
  { code: 'ORD', city: 'Chicago' },
  { code: 'ATL', city: 'Atlanta' },
  { code: 'MIA', city: 'Miami' },
  { code: 'DFW', city: 'Dallas' },
  { code: 'DEN', city: 'Denver' },
  { code: 'LAX', city: 'Los Angeles' },
  { code: 'SFO', city: 'San Francisco' },
  { code: 'SEA', city: 'Seattle' },
  { code: 'LAS', city: 'Las Vegas' },
  { code: 'MCO', city: 'Orlando' },
  { code: 'HNL', city: 'Honolulu' },
  { code: 'CUN', city: 'Cancún' },
  { code: 'LHR', city: 'London' },
  { code: 'CDG', city: 'Paris' },
  { code: 'NRT', city: 'Tokyo' },
] as const;

const AIRLINES = ['Delta', 'United', 'American', 'JetBlue', 'Southwest', 'Alaska'];
const HOTEL_BRANDS = ['Harbor House', 'The Meridian', 'Parkline Suites', 'Casa Luz', 'Northstar Inn', 'The Aldrich'];

/** Miles earned per dollar. Travel booked in-app earns the premium rate. */
export const EARN_RATES = { flight: 5, hotel: 10, everyday: 2 } as const;
/** One mile is worth one cent when redeemed against travel. */
export const MILE_VALUE_CENTS = 1;
/** Price drop protection pays back the difference, up to this per booking. */
export const PRICE_DROP_CAP_CENTS = 5_000;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function cityFor(code: string): string {
  return AIRPORTS.find((a) => a.code === code)?.city ?? code;
}

const INTERNATIONAL = new Set(['LHR', 'CDG', 'NRT', 'CUN']);

/** A rough distance class from the codes, enough to price believably. */
function routeBaseCents(from: string, to: string): number {
  if (INTERNATIONAL.has(from) || INTERNATIONAL.has(to)) return to === 'CUN' || from === 'CUN' ? 38_000 : 72_000;
  if (to === 'HNL' || from === 'HNL') return 52_000;
  const west = new Set(['LAX', 'SFO', 'SEA', 'LAS', 'DEN']);
  const crossCountry = west.has(from) !== west.has(to);
  return crossCountry ? 31_000 : 17_000;
}

/**
 * How advance purchase moves a fare. Fares are cheapest roughly 3–8 weeks out,
 * climb steeply inside two weeks, and drift slightly higher far in advance.
 */
export function advanceMultiplier(daysOut: number): number {
  if (daysOut <= 3) return 1.75;
  if (daysOut <= 7) return 1.5;
  if (daysOut <= 14) return 1.28;
  if (daysOut <= 21) return 1.1;
  if (daysOut <= 60) return 1.0;
  // Beyond two months, fares ease down steadily toward the sweet spot.
  return Math.min(1.2, 1 + (daysOut - 60) * 0.005);
}

export interface FlightOption {
  id: string;
  airline: string;
  flightNumber: string;
  from: string;
  to: string;
  departsAt: string;
  arrivesAt: string;
  durationMinutes: number;
  stops: number;
  cabin: 'economy' | 'premium';
  priceCents: number;
  seatsLeft: number;
}

export interface FlightSearch {
  from: string;
  to: string;
  /** YYYY-MM-DD */
  date: string;
  travelers: number;
}

export function searchFlights(search: FlightSearch, today: Date): FlightOption[] {
  const rng = createRng(hash(`${search.from}-${search.to}-${search.date}`));
  const departDay = new Date(`${search.date}T00:00:00.000Z`);
  const daysOut = Math.max(0, daysBetween(today, departDay));
  const base = routeBaseCents(search.from, search.to) * advanceMultiplier(daysOut);
  const baseMinutes = Math.round(base / 100) + 60;

  return Array.from({ length: 6 }, (_, i) => {
    const stops = rng.next() < 0.35 ? 1 : 0;
    const hour = 6 + Math.floor(rng.next() * 15);
    const minute = [0, 15, 30, 45][Math.floor(rng.next() * 4)]!;
    const duration = baseMinutes + stops * (55 + Math.floor(rng.next() * 60));
    const departs = new Date(departDay.getTime() + (hour * 60 + minute) * 60_000);
    const arrives = new Date(departs.getTime() + duration * 60_000);
    // Non-stops cost more; a small spread keeps the list realistic.
    const spread = 0.82 + rng.next() * 0.4 + (stops === 0 ? 0.08 : -0.06);
    const perPerson = Math.round((base * spread) / 100) * 100 - 1;
    const airline = AIRLINES[Math.floor(rng.next() * AIRLINES.length)]!;

    return {
      id: `F${hash(`${search.from}${search.to}${search.date}${i}`).toString(36).toUpperCase()}`,
      airline,
      flightNumber: `${airline.slice(0, 2).toUpperCase()} ${100 + Math.floor(rng.next() * 2800)}`,
      from: search.from,
      to: search.to,
      departsAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      durationMinutes: duration,
      stops,
      cabin: 'economy' as const,
      priceCents: perPerson * search.travelers,
      seatsLeft: 1 + Math.floor(rng.next() * 9),
    };
  }).sort((a, b) => a.priceCents - b.priceCents);
}

export interface HotelOption {
  id: string;
  name: string;
  city: string;
  rating: number;
  nightlyCents: number;
  nights: number;
  totalCents: number;
  perks: string[];
}

export function searchHotels(
  search: { city: string; checkIn: string; nights: number },
  today: Date,
): HotelOption[] {
  const rng = createRng(hash(`${search.city}-${search.checkIn}`));
  const daysOut = Math.max(0, daysBetween(today, new Date(`${search.checkIn}T00:00:00.000Z`)));
  const demand = daysOut <= 7 ? 1.25 : 1;

  return HOTEL_BRANDS.map((brand, i) => {
    const rating = Math.round((3.6 + rng.next() * 1.3) * 10) / 10;
    const nightly = Math.round((110 + rating * 40 + rng.next() * 140) * demand) * 100 - 1;
    const perks = ['Free cancellation', 'Breakfast included', '$100 experience credit', 'Late checkout']
      .filter(() => rng.next() > 0.5);
    return {
      id: `H${hash(`${search.city}${search.checkIn}${i}`).toString(36).toUpperCase()}`,
      name: `${brand} ${search.city.split(',')[0]}`,
      city: search.city,
      rating,
      nightlyCents: nightly,
      nights: search.nights,
      totalCents: nightly * search.nights,
      perks,
    };
  }).sort((a, b) => a.totalCents - b.totalCents);
}

// --- price prediction ---

export interface PriceForecast {
  advice: 'book_now' | 'wait' | 'fair';
  /** 0..1 */
  confidence: number;
  /** Expected change over the next week, as a fraction. */
  expectedChange: number;
  headline: string;
  reason: string;
}

/**
 * Advice from where the trip sits on the advance-purchase curve: compare what the
 * fare multiplier will be a week from now with what it is today.
 */
export function forecastPrice(daysOut: number): PriceForecast {
  const now = advanceMultiplier(daysOut);
  const nextWeek = advanceMultiplier(Math.max(0, daysOut - 7));
  const change = nextWeek / now - 1;

  if (change > 0.04) {
    return {
      advice: 'book_now',
      confidence: Math.min(0.95, 0.6 + change),
      expectedChange: change,
      headline: 'Book now — prices are likely to rise',
      reason: `Fares on trips ${daysOut} days out usually climb about ${Math.round(change * 100)}% within a week.`,
    };
  }
  if (change < -0.03) {
    return {
      advice: 'wait',
      confidence: Math.min(0.9, 0.55 + -change * 2),
      expectedChange: change,
      headline: 'Consider waiting — prices may dip',
      reason: `Trips this far out tend to get about ${Math.round(-change * 100)}% cheaper as they move into the 3–8 week window. We can watch it for you.`,
    };
  }
  return {
    advice: 'fair',
    confidence: 0.7,
    expectedChange: change,
    headline: 'This is a fair price',
    reason: 'You are in the window where fares are usually lowest. Prices are unlikely to move much this week.',
  };
}

// --- rewards optimizer ---

export interface PaymentOption {
  id: 'card' | 'miles' | 'mix' | 'card_then_erase';
  label: string;
  cardCents: number;
  milesUsed: number;
  milesEarned: number;
  /** What the trip really costs once earned miles are valued. */
  effectiveCostCents: number;
  note: string;
}

export interface RewardsAdvice {
  options: PaymentOption[];
  bestId: PaymentOption['id'];
  headline: string;
  travelCreditAppliedCents: number;
}

export function optimizePayment(input: {
  priceCents: number;
  kind: 'flight' | 'hotel';
  milesBalance: number;
  /** Annual travel credit still unused, applied first to in-app bookings. */
  travelCreditCents?: number;
}): RewardsAdvice {
  const rate = EARN_RATES[input.kind];
  const credit = Math.min(input.travelCreditCents ?? 0, input.priceCents);
  const due = input.priceCents - credit;
  const earn = (cents: number) => Math.floor((cents / 100) * rate);

  // The travel credit is a statement credit: it reduces what is owed, but miles
  // are still earned on the full fare.
  const cardEarned = earn(input.priceCents);
  const card: PaymentOption = {
    id: 'card',
    label: 'Pay with card',
    cardCents: due,
    milesUsed: 0,
    milesEarned: cardEarned,
    effectiveCostCents: due - cardEarned * MILE_VALUE_CENTS,
    note: `Earn ${cardEarned.toLocaleString('en-US')} miles (${rate}x on ${input.kind}s booked here).`,
  };

  const milesNeeded = Math.ceil(due / MILE_VALUE_CENTS);
  const canCoverAll = input.milesBalance >= milesNeeded;
  const options: PaymentOption[] = [card];

  // Nothing left to pay: spending miles on it would simply waste them.
  if (due === 0) {
    return {
      options,
      bestId: 'card',
      headline: `Your travel credit covers this trip in full — you pay nothing and still earn ${cardEarned.toLocaleString('en-US')} miles.`,
      travelCreditAppliedCents: credit,
    };
  }

  if (canCoverAll) {
    options.push({
      id: 'miles',
      label: 'Pay entirely with miles',
      cardCents: 0,
      milesUsed: milesNeeded,
      milesEarned: 0,
      effectiveCostCents: milesNeeded * MILE_VALUE_CENTS,
      note: `Uses ${milesNeeded.toLocaleString('en-US')} of your ${input.milesBalance.toLocaleString('en-US')} miles. You earn nothing on a miles booking.`,
    });
  } else if (input.milesBalance > 0) {
    const cardPart = due - input.milesBalance * MILE_VALUE_CENTS;
    const earned = earn(cardPart);
    options.push({
      id: 'mix',
      label: 'Miles + card',
      cardCents: cardPart,
      milesUsed: input.milesBalance,
      milesEarned: earned,
      effectiveCostCents: input.milesBalance * MILE_VALUE_CENTS + cardPart - earned * MILE_VALUE_CENTS,
      note: `All ${input.milesBalance.toLocaleString('en-US')} miles, and ${formatCents(cardPart)} on the card.`,
    });
  }

  // Paying on the card and then erasing it with miles earns on the full price and
  // still spends the miles — strictly better than paying with miles up front.
  if (input.milesBalance > 0) {
    const erase = Math.min(input.milesBalance, milesNeeded);
    options.push({
      id: 'card_then_erase',
      label: 'Card now, erase with miles later',
      cardCents: due - erase * MILE_VALUE_CENTS,
      milesUsed: erase,
      milesEarned: cardEarned,
      effectiveCostCents: due - cardEarned * MILE_VALUE_CENTS,
      note: `Earn ${cardEarned.toLocaleString('en-US')} miles on the full fare, then use ${erase.toLocaleString('en-US')} miles to erase ${formatCents(erase * MILE_VALUE_CENTS)} of it.`,
    });
  }

  const best = [...options].sort(
    (a, b) => a.effectiveCostCents - b.effectiveCostCents || b.milesEarned - a.milesEarned,
  )[0]!;

  const saved = due - best.effectiveCostCents;
  const creditNote = credit > 0 ? ` Your ${formatCents(credit)} travel credit is already applied.` : '';
  return {
    options,
    bestId: best.id,
    headline:
      saved > 0
        ? `${best.label} — worth ${formatCents(saved)} back to you.${creditNote}`
        : `${best.label}.${creditNote}`,
    travelCreditAppliedCents: credit,
  };
}

// --- price drop protection ---

/**
 * Re-prices a booked fare as the departure approaches. Deterministic by booking
 * id and check number so the demo can show a drop on request.
 */
export function repriceBooking(bookedCents: number, bookingId: string, check: number): number {
  const rng = createRng(hash(`${bookingId}:${check}`));
  // Most checks move a little; roughly one in three finds a real drop.
  const drop = rng.next() < 0.35 ? 0.06 + rng.next() * 0.14 : -0.03 + rng.next() * 0.06;
  return Math.max(100, Math.round(bookedCents * (1 - drop)));
}

export function priceDropRefund(bookedCents: number, alreadyRefunded: number, newPriceCents: number): number {
  const drop = bookedCents - newPriceCents - alreadyRefunded;
  if (drop <= 0) return 0;
  return Math.min(drop, PRICE_DROP_CAP_CENTS - alreadyRefunded);
}

// --- offers ---

export interface Offer {
  id: string;
  merchant: string;
  category: string;
  /** Cash back as a fraction, e.g. 0.1 = 10%. */
  rate: number;
  maxCents: number;
  expiresInDays: number;
  headline: string;
}

export const OFFERS: Offer[] = [
  { id: 'ofr-hotels', merchant: 'Harbor House Hotels', category: 'Travel', rate: 0.15, maxCents: 7_500, expiresInDays: 21, headline: '15% back on your next stay' },
  { id: 'ofr-wholefoods', merchant: 'Whole Foods Market', category: 'Groceries', rate: 0.05, maxCents: 2_000, expiresInDays: 30, headline: '5% back on groceries' },
  { id: 'ofr-uber', merchant: 'Uber', category: 'Transport', rate: 0.1, maxCents: 1_500, expiresInDays: 14, headline: '10% back on rides' },
  { id: 'ofr-bestbuy', merchant: 'Best Buy', category: 'Shopping', rate: 0.04, maxCents: 5_000, expiresInDays: 45, headline: '4% back on electronics' },
  { id: 'ofr-chipotle', merchant: 'Chipotle', category: 'Dining', rate: 0.1, maxCents: 1_000, expiresInDays: 10, headline: '10% back, up to $10' },
  { id: 'ofr-delta', merchant: 'Delta Air Lines', category: 'Travel', rate: 0.08, maxCents: 6_000, expiresInDays: 60, headline: '8% back on flights' },
  { id: 'ofr-cvs', merchant: 'CVS Pharmacy', category: 'Health', rate: 0.05, maxCents: 1_500, expiresInDays: 30, headline: '5% back on essentials' },
];

/**
 * Ranks offers by what they would have earned on the customer's own recent
 * spending, so the first offer shown is the one that actually pays them.
 */
export function rankOffers(
  offers: Offer[],
  monthlySpendByMerchant: Map<string, number>,
): (Offer & { projectedCents: number; youShopHere: boolean })[] {
  return offers
    .map((offer) => {
      const spend = monthlySpendByMerchant.get(offer.merchant) ?? 0;
      return {
        ...offer,
        youShopHere: spend > 0,
        projectedCents: Math.min(offer.maxCents, Math.round(spend * offer.rate)),
      };
    })
    .sort((a, b) => b.projectedCents - a.projectedCents || Number(b.youShopHere) - Number(a.youShopHere));
}

// --- cancellations -------------------------------------------------------
//
// Plans change, and a trip you cannot get out of is a trip you regret booking.
// So Orbit cancels in-app, and the fee is stated before anything is cancelled
// rather than discovered afterwards.
//
// The fee is a real one, priced the way airlines and hotels actually price it:
// it falls to nothing inside a cooling-off window, and rises as departure gets
// closer, because that is when the seat or room stops being resellable.
//
// Three things it never does:
//   * charge more than was paid — a cancellation cannot leave you owing money;
//   * keep the miles you spent — those come back in full, always, because
//     points are ours to return and it costs the customer nothing to wait;
//   * silently keep a price-drop refund already paid out.

/** Cancel within this long of booking and it is free, whatever the date. */
export const FREE_CANCELLATION_HOURS = 24;

/** Never more than this share of what was paid, however late. */
export const MAX_CANCELLATION_SHARE = 0.5;

export interface CancellationQuote {
  /** What can still be given back, in cents. */
  refundCents: number;
  /** What Orbit keeps, in cents. */
  feeCents: number;
  /** Miles returned. Always all of them. */
  milesRefunded: number;
  /** Why the fee is what it is, in plain words. */
  reason: string;
  /** True while the free window is still open. */
  free: boolean;
  /** Hours left of the free window, or 0 once it has closed. */
  freeWindowHoursLeft: number;
}

/**
 * What cancelling this booking would cost.
 *
 * `paidCardCents` is what actually hit the card, so a booking paid entirely in
 * miles or covered by the travel credit has nothing to take a fee from — and
 * correctly quotes a fee of zero rather than inventing a debt.
 */
export function quoteCancellation(input: {
  kind: string;
  paidCardCents: number;
  paidMilesCents: number;
  refundedCents: number;
  bookedAt: Date;
  departsAt: Date;
  now: Date;
}): CancellationQuote {
  // A price-drop refund has already been paid out, so it is not refundable
  // twice. What is left on the card is the most that can come back.
  const refundable = Math.max(0, input.paidCardCents - input.refundedCents);
  const milesRefunded = input.paidMilesCents;

  const hoursSinceBooking = (input.now.getTime() - input.bookedAt.getTime()) / 3_600_000;
  const freeWindowHoursLeft = Math.max(0, FREE_CANCELLATION_HOURS - hoursSinceBooking);

  if (freeWindowHoursLeft > 0) {
    return {
      refundCents: refundable,
      feeCents: 0,
      milesRefunded,
      free: true,
      freeWindowHoursLeft: Math.ceil(freeWindowHoursLeft),
      reason: `Free — you booked less than ${FREE_CANCELLATION_HOURS} hours ago. Everything comes back, including your miles.`,
    };
  }

  const daysOut = (input.departsAt.getTime() - input.now.getTime()) / 86_400_000;

  // A hotel room resells far more easily than a seat on a specific flight, so
  // its fee is gentler at every distance.
  const bands: { minDays: number; flight: number; hotel: number; label: string }[] = [
    { minDays: 30, flight: 0.05, hotel: 0, label: 'more than a month away' },
    { minDays: 14, flight: 0.1, hotel: 0.05, label: 'two weeks to a month away' },
    { minDays: 7, flight: 0.2, hotel: 0.1, label: 'one to two weeks away' },
    { minDays: 2, flight: 0.35, hotel: 0.2, label: 'within a week' },
    { minDays: -Infinity, flight: 0.5, hotel: 0.35, label: 'within 48 hours of departure' },
  ];
  const band = bands.find((b) => daysOut >= b.minDays)!;
  const rate = Math.min(MAX_CANCELLATION_SHARE, input.kind === 'hotel' ? band.hotel : band.flight);

  const feeCents = Math.min(refundable, Math.round(refundable * rate));
  const refundCents = refundable - feeCents;

  return {
    refundCents,
    feeCents,
    milesRefunded,
    free: false,
    freeWindowHoursLeft: 0,
    reason:
      feeCents === 0
        ? `No fee — this ${input.kind === 'hotel' ? 'stay' : 'trip'} is ${band.label}, and there is nothing left on the card to charge one against.`
        : `${Math.round(rate * 100)}% fee because the ${input.kind === 'hotel' ? 'stay' : 'flight'} is ${band.label}. Any miles you spent come back in full.`,
  };
}
