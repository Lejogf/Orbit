import { describe, expect, test } from 'vitest';
import {
  OFFERS,
  PRICE_DROP_CAP_CENTS,
  advanceMultiplier,
  forecastPrice,
  optimizePayment,
  priceDropRefund,
  rankOffers,
  repriceBooking,
  searchFlights,
  searchHotels,
} from '../features/travel.js';

const today = new Date(Date.UTC(2026, 8, 19));

describe('searchFlights', () => {
  const search = { from: 'IAD', to: 'MIA', date: '2026-11-02', travelers: 1 };

  test('is deterministic for the same search', () => {
    expect(searchFlights(search, today)).toEqual(searchFlights(search, today));
  });

  test('returns six options sorted by price, arriving after departure', () => {
    const flights = searchFlights(search, today);
    expect(flights).toHaveLength(6);
    for (let i = 1; i < flights.length; i++) expect(flights[i]!.priceCents).toBeGreaterThanOrEqual(flights[i - 1]!.priceCents);
    for (const f of flights) expect(new Date(f.arrivesAt).getTime()).toBeGreaterThan(new Date(f.departsAt).getTime());
  });

  test('prices scale with travellers', () => {
    const one = searchFlights(search, today)[0]!.priceCents;
    const two = searchFlights({ ...search, travelers: 2 }, today)[0]!.priceCents;
    expect(two).toBe(one * 2);
  });

  test('last-minute fares cost more than well-planned ones', () => {
    const soon = searchFlights({ ...search, date: '2026-09-21' }, today);
    const planned = searchFlights({ ...search, date: '2026-10-25' }, today);
    const avg = (list: { priceCents: number }[]) => list.reduce((s, f) => s + f.priceCents, 0) / list.length;
    expect(avg(soon)).toBeGreaterThan(avg(planned));
  });
});

describe('searchHotels', () => {
  test('totals are nightly rate times nights', () => {
    for (const hotel of searchHotels({ city: 'Miami', checkIn: '2026-11-02', nights: 3 }, today)) {
      expect(hotel.totalCents).toBe(hotel.nightlyCents * 3);
    }
  });
});

describe('forecastPrice', () => {
  test('says book now when the trip is about to enter the expensive window', () => {
    expect(forecastPrice(16).advice).toBe('book_now');
  });

  test('says wait when the trip is far out', () => {
    expect(forecastPrice(70).advice).toBe('wait');
  });

  test('calls a sweet-spot fare fair', () => {
    expect(forecastPrice(40).advice).toBe('fair');
  });

  test('the curve is cheapest three to eight weeks out', () => {
    expect(advanceMultiplier(40)).toBeLessThan(advanceMultiplier(10));
    expect(advanceMultiplier(40)).toBeLessThan(advanceMultiplier(150));
  });
});

describe('optimizePayment', () => {
  test('card-then-erase beats paying with miles up front', () => {
    const advice = optimizePayment({ priceCents: 40_000, kind: 'flight', milesBalance: 60_000 });
    const miles = advice.options.find((o) => o.id === 'miles')!;
    const erase = advice.options.find((o) => o.id === 'card_then_erase')!;
    expect(erase.milesEarned).toBe(2000); // $400 at 5x
    expect(erase.effectiveCostCents).toBeLessThan(miles.effectiveCostCents);
    expect(['card', 'card_then_erase']).toContain(advice.bestId);
  });

  test('offers a mix when miles cannot cover the fare', () => {
    const advice = optimizePayment({ priceCents: 40_000, kind: 'flight', milesBalance: 10_000 });
    const mix = advice.options.find((o) => o.id === 'mix')!;
    expect(mix.cardCents).toBe(30_000);
    expect(advice.options.some((o) => o.id === 'miles')).toBe(false);
  });

  test('a fully credited trip charges nothing, still earns, and does not spend miles', () => {
    const advice = optimizePayment({ priceCents: 15_399, kind: 'flight', milesBalance: 42_000, travelCreditCents: 30_000 });
    expect(advice.options).toHaveLength(1);
    expect(advice.options[0]).toEqual(expect.objectContaining({ cardCents: 0, milesUsed: 0, milesEarned: 769 }));
    expect(advice.headline).toContain('covers this trip in full');
  });

  test('miles are earned on the full fare, not the amount left after credit', () => {
    const advice = optimizePayment({ priceCents: 40_000, kind: 'flight', milesBalance: 0, travelCreditCents: 10_000 });
    expect(advice.options[0]).toEqual(expect.objectContaining({ cardCents: 30_000, milesEarned: 2000 }));
  });

  test('applies travel credit before anything else', () => {
    const advice = optimizePayment({ priceCents: 20_000, kind: 'hotel', milesBalance: 0, travelCreditCents: 30_000 });
    expect(advice.travelCreditAppliedCents).toBe(20_000);
    expect(advice.options[0]!.cardCents).toBe(0);
  });

  test('hotels earn 10x', () => {
    const advice = optimizePayment({ priceCents: 50_000, kind: 'hotel', milesBalance: 0 });
    expect(advice.options[0]!.milesEarned).toBe(5000);
  });
});

describe('price drop protection', () => {
  test('refunds the drop, capped per booking', () => {
    expect(priceDropRefund(40_000, 0, 37_000)).toBe(3000);
    expect(priceDropRefund(40_000, 0, 20_000)).toBe(PRICE_DROP_CAP_CENTS);
    expect(priceDropRefund(40_000, 3000, 36_000)).toBe(1000);
    expect(priceDropRefund(40_000, 0, 41_000)).toBe(0);
  });

  test('repricing is repeatable per check', () => {
    expect(repriceBooking(40_000, 'b1', 1)).toBe(repriceBooking(40_000, 'b1', 1));
  });
});

describe('rankOffers', () => {
  test('puts offers that would have paid the customer first', () => {
    const ranked = rankOffers(OFFERS, new Map([['Chipotle', 8000], ['Whole Foods Market', 30_000]]));
    expect(ranked[0]!.merchant).toBe('Whole Foods Market');
    expect(ranked[0]!.projectedCents).toBe(1500);
    expect(ranked[1]!.merchant).toBe('Chipotle');
    expect(ranked[1]!.projectedCents).toBe(800);
  });

  test('caps projected cash back at the offer maximum', () => {
    const ranked = rankOffers(OFFERS, new Map([['Chipotle', 1_000_000]]));
    expect(ranked.find((o) => o.merchant === 'Chipotle')!.projectedCents).toBe(1000);
  });
});
