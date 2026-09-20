// Booking trips on the card, with miles, or both — and watching the price after.
//
// Prices are never taken from the browser: the booking re-runs the search on the
// server and charges what it finds. The card must be unlocked and have the
// available credit, exactly as a real authorisation would require.

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { centsToDollars, daysBetween, formatCents } from '../lib/utils.js';
import { nessie } from '../nessie/client.js';
import {
  OFFERS,
  cityFor,
  forecastPrice,
  optimizePayment,
  priceDropRefund,
  rankOffers,
  repriceBooking,
  searchFlights,
  searchHotels,
  type FlightSearch,
  type PaymentOption,
} from '../features/travel.js';
import { notifyCharge, raiseAlert } from './notify.js';
import { earnOnPurchase } from './rewards.js';

/** Annual travel credit for in-app bookings. */
export const ANNUAL_TRAVEL_CREDIT_CENTS = 300_00;

async function cardFor(prisma: PrismaClient, customerId: string) {
  const card = await prisma.account.findFirst({ where: { customerId, type: 'Credit Card' } });
  if (!card) throw ApiError.badRequest('You need a Capital One card to book travel here.');
  return card;
}

export async function travelCreditRemaining(prisma: PrismaClient, customerId: string, now = new Date()) {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const bookings = await prisma.travelBooking.findMany({
    where: { customerId, createdAt: { gte: yearStart }, status: 'booked' },
    select: { details: true },
  });
  const used = bookings.reduce((sum, b) => {
    const details = JSON.parse(b.details) as { creditAppliedCents?: number };
    return sum + (details.creditAppliedCents ?? 0);
  }, 0);
  return Math.max(0, ANNUAL_TRAVEL_CREDIT_CENTS - used);
}

export async function rewardsSummary(prisma: PrismaClient, customerId: string) {
  const card = await prisma.account.findFirst({ where: { customerId, type: 'Credit Card' } });
  return {
    miles: card?.rewardsCents ?? 0,
    valueCents: card?.rewardsCents ?? 0,
    travelCreditCents: await travelCreditRemaining(prisma, customerId),
    cardLast4: card?.last4 ?? null,
    cardLocked: card?.isLocked ?? false,
    availableCreditCents: card && card.creditLimitCents !== null ? card.creditLimitCents - card.balanceCents : null,
  };
}

export type TripRequest =
  | { kind: 'flight'; search: FlightSearch; optionId: string }
  | { kind: 'hotel'; search: { city: string; checkIn: string; nights: number }; optionId: string };

/** Resolves the chosen option server-side, so the price can't be tampered with. */
function resolveTrip(trip: TripRequest, today: Date) {
  if (trip.kind === 'flight') {
    const option = searchFlights(trip.search, today).find((f) => f.id === trip.optionId);
    if (!option) throw ApiError.badRequest('That flight is no longer available. Search again.');
    return {
      priceCents: option.priceCents,
      title: `${cityFor(option.from)} → ${cityFor(option.to)}`,
      merchant: `${option.airline} Airlines`.replace('Airlines Airlines', 'Airlines'),
      departsAt: new Date(option.departsAt),
      details: { ...option, travelers: trip.search.travelers },
    };
  }
  const option = searchHotels(trip.search, today).find((h) => h.id === trip.optionId);
  if (!option) throw ApiError.badRequest('That hotel is no longer available. Search again.');
  return {
    priceCents: option.totalCents,
    title: `${option.name} · ${option.nights} night${option.nights === 1 ? '' : 's'}`,
    merchant: option.name,
    departsAt: new Date(`${trip.search.checkIn}T15:00:00.000Z`),
    details: { ...option, checkIn: trip.search.checkIn },
  };
}

export async function quoteTrip(prisma: PrismaClient, customerId: string, trip: TripRequest, today = new Date()) {
  const resolved = resolveTrip(trip, today);
  const rewards = await rewardsSummary(prisma, customerId);
  const advice = optimizePayment({
    priceCents: resolved.priceCents,
    kind: trip.kind,
    milesBalance: rewards.miles,
    travelCreditCents: rewards.travelCreditCents,
  });
  return {
    ...resolved,
    advice,
    forecast: forecastPrice(Math.max(0, daysBetween(today, resolved.departsAt))),
    rewards,
  };
}

/** Finds or creates the merchant locally, and in Nessie if it can. */
async function travelMerchant(prisma: PrismaClient, name: string) {
  const existing = await prisma.merchant.findFirst({ where: { name } });
  const merchant = existing ?? (await prisma.merchant.create({ data: { name, category: 'Travel' } }));
  if (merchant.nessieId) return merchant;

  try {
    const created = await nessie.createMerchant({
      name,
      category: ['Travel'],
      address: { street_number: '1', street_name: 'Travel Way', city: 'McLean', state: 'VA', zip: '22102' },
      geocode: { lat: 38.93, lng: -77.18 },
    });
    return prisma.merchant.update({ where: { id: merchant.id }, data: { nessieId: created._id } });
  } catch {
    return merchant;
  }
}

/** Best-effort: the booking stands whether or not Nessie accepts it. */
async function mirrorPurchase(
  accountNessieId: string | null,
  merchantNessieId: string | null,
  cents: number,
  medium: 'balance' | 'rewards',
  description: string,
): Promise<string | null> {
  if (!accountNessieId || !merchantNessieId || cents <= 0) return null;
  try {
    const purchase = await nessie.createPurchase(accountNessieId, {
      merchant_id: merchantNessieId,
      medium,
      purchase_date: new Date().toISOString().slice(0, 10),
      // Nessie keeps whole dollars only; the mirror holds the exact cents.
      amount: Math.max(1, Math.round(centsToDollars(cents))),
      status: 'completed',
      description,
    });
    return purchase._id;
  } catch (error) {
    console.warn('[travel] Nessie purchase mirror failed:', (error as Error).message);
    return null;
  }
}

export async function bookTrip(
  prisma: PrismaClient,
  customerId: string,
  trip: TripRequest,
  payWith: PaymentOption['id'],
  today = new Date(),
) {
  const card = await cardFor(prisma, customerId);
  if (card.isLocked) {
    throw new ApiError(409, 'CARD_LOCKED', `Your card ending ${card.last4} is locked. Unlock it to book, then lock it again after.`);
  }

  const quote = await quoteTrip(prisma, customerId, trip, today);
  const option = quote.advice.options.find((o) => o.id === payWith);
  if (!option) throw ApiError.badRequest('That payment option is not available for this trip.');

  // For "card then erase", the full fare is charged and the miles credit posts after.
  const chargedCents = payWith === 'card_then_erase' ? quote.priceCents - quote.advice.travelCreditAppliedCents : option.cardCents;
  const eraseCents = payWith === 'card_then_erase' ? option.milesUsed : 0;
  const available = card.creditLimitCents !== null ? card.creditLimitCents - card.balanceCents : Infinity;
  if (chargedCents > available) {
    throw new ApiError(409, 'INSUFFICIENT_CREDIT', `This needs ${formatCents(chargedCents)} of available credit and you have ${formatCents(available)}. Try paying partly with miles.`);
  }

  const merchant = await travelMerchant(prisma, quote.merchant);
  const now = new Date();
  const netCardCents = chargedCents - eraseCents;

  const transaction = chargedCents > 0
    ? await prisma.transaction.create({
        data: {
          accountId: card.id,
          merchantId: merchant.id,
          source: 'purchase',
          amountCents: -chargedCents,
          description: `${quote.merchant} — ${quote.title}`,
          postedAt: now,
          category: 'Travel',
        },
      })
    : null;

  if (eraseCents > 0) {
    await prisma.transaction.create({
      data: {
        accountId: card.id,
        source: 'deposit',
        amountCents: eraseCents,
        description: `Miles redemption — ${quote.title}`,
        postedAt: now,
        category: 'Rewards',
      },
    });
  }

  await prisma.account.update({
    where: { id: card.id },
    data: {
      balanceCents: { increment: netCardCents },
      rewardsCents: { increment: option.milesEarned - option.milesUsed },
    },
  });

  const [cardPurchaseId, milesPurchaseId] = await Promise.all([
    mirrorPurchase(card.nessieId, merchant.nessieId, chargedCents, 'balance', quote.title),
    // Miles spent up front are a genuine Nessie rewards purchase.
    payWith === 'miles' || payWith === 'mix'
      ? mirrorPurchase(card.nessieId, merchant.nessieId, option.milesUsed, 'rewards', `${quote.title} (miles)`)
      : Promise.resolve(null),
  ]);

  const booking = await prisma.travelBooking.create({
    data: {
      customerId,
      accountId: card.id,
      kind: trip.kind,
      title: quote.title,
      details: JSON.stringify({
        ...quote.details,
        payWith,
        creditAppliedCents: quote.advice.travelCreditAppliedCents,
        confirmation: `FL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      }),
      priceCents: quote.priceCents,
      paidCardCents: netCardCents,
      paidMilesCents: option.milesUsed,
      milesEarned: option.milesEarned,
      currentPriceCents: quote.priceCents,
      transactionId: transaction?.id ?? null,
      nessiePurchaseId: cardPurchaseId ?? milesPurchaseId,
      departsAt: quote.departsAt,
    },
  });

  if (chargedCents > 0) {
    await earnOnPurchase(prisma, {
      customerId,
      accountId: card.id,
      amountCents: chargedCents,
      category: 'Travel',
      transactionId: transaction?.id,
      merchant: quote.merchant,
    });
    await notifyCharge(prisma, {
      customerId,
      merchant: quote.merchant,
      amountCents: chargedCents,
      accountLabel: `${card.nickname} ••${card.last4}`,
      href: '/travel?tab=trips',
    });
  }
  await raiseAlert(prisma, {
    customerId,
    kind: 'trip_booked',
    title: `Booked: ${quote.title}`,
    body: `You earned ${option.milesEarned.toLocaleString('en-US')} miles. We'll watch the price and refund you if it drops.`,
    href: '/travel?tab=trips',
  });

  return serializeBooking(booking);
}

export function serializeBooking(b: {
  id: string; kind: string; title: string; details: string; priceCents: number; paidCardCents: number;
  paidMilesCents: number; milesEarned: number; currentPriceCents: number; refundedCents: number;
  status: string; departsAt: Date; createdAt: Date; nessiePurchaseId: string | null; priceChecks: number;
}) {
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    details: JSON.parse(b.details) as Record<string, unknown>,
    priceCents: b.priceCents,
    paidCardCents: b.paidCardCents,
    paidMilesCents: b.paidMilesCents,
    milesEarned: b.milesEarned,
    currentPriceCents: b.currentPriceCents,
    refundedCents: b.refundedCents,
    status: b.status,
    departsAt: b.departsAt.toISOString(),
    createdAt: b.createdAt.toISOString(),
    inNessie: b.nessiePurchaseId !== null,
    priceChecks: b.priceChecks,
  };
}

export async function listBookings(prisma: PrismaClient, customerId: string) {
  const rows = await prisma.travelBooking.findMany({ where: { customerId }, orderBy: { departsAt: 'asc' } });
  return rows.map(serializeBooking);
}

/**
 * Re-checks the fare. A drop is refunded to the card straight away — the
 * customer shouldn't have to notice, file a claim, or wait.
 * `untilDrop` keeps checking (up to a limit) so the demo can show a refund.
 */
export async function checkBookingPrice(prisma: PrismaClient, customerId: string, bookingId: string, untilDrop = false) {
  const booking = await prisma.travelBooking.findFirst({ where: { id: bookingId, customerId } });
  if (!booking) throw ApiError.notFound('Booking');
  if (booking.status !== 'booked') throw ApiError.badRequest('This booking is no longer active.');

  let checks = booking.priceChecks;
  let price = booking.currentPriceCents;
  let refund = 0;
  for (let i = 0; i < (untilDrop ? 25 : 1); i++) {
    checks += 1;
    price = repriceBooking(booking.priceCents, booking.id, checks);
    refund = priceDropRefund(booking.priceCents, booking.refundedCents, price);
    if (refund > 0) break;
  }

  await prisma.travelBooking.update({
    where: { id: booking.id },
    data: { priceChecks: checks, currentPriceCents: price, refundedCents: { increment: refund } },
  });

  if (refund > 0) {
    await prisma.$transaction([
      prisma.account.update({ where: { id: booking.accountId }, data: { balanceCents: { decrement: refund } } }),
      prisma.transaction.create({
        data: {
          accountId: booking.accountId,
          source: 'deposit',
          amountCents: refund,
          description: `Price drop refund — ${booking.title}`,
          postedAt: new Date(),
          category: 'Travel',
        },
      }),
    ]);
    await raiseAlert(prisma, {
      customerId,
      kind: 'price_drop',
      title: `Price dropped — ${formatCents(refund)} back`,
      body: `${booking.title} is now ${formatCents(price)}. We've credited the difference to your card. Nothing for you to do.`,
      amountCents: refund,
      href: '/travel?tab=trips',
    });
  }

  const updated = await prisma.travelBooking.findUniqueOrThrow({ where: { id: booking.id } });
  return { booking: serializeBooking(updated), newPriceCents: price, refundCents: refund };
}

// --- offers ---

export async function listOffers(prisma: PrismaClient, customerId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [spend, activations] = await Promise.all([
    prisma.transaction.findMany({
      where: { account: { customerId }, source: 'purchase', postedAt: { gte: since } },
      include: { merchant: { select: { name: true } } },
    }),
    prisma.offerActivation.findMany({ where: { customerId } }),
  ]);
  const byMerchant = new Map<string, number>();
  for (const tx of spend) {
    const name = tx.merchant?.name ?? tx.description;
    byMerchant.set(name, (byMerchant.get(name) ?? 0) + -tx.amountCents);
  }
  const active = new Set(activations.map((a) => a.offerId));
  return rankOffers(OFFERS, byMerchant).map((offer) => ({ ...offer, activated: active.has(offer.id) }));
}

export async function setOfferActivation(prisma: PrismaClient, customerId: string, offerId: string, on: boolean) {
  if (!OFFERS.some((o) => o.id === offerId)) throw ApiError.notFound('Offer');
  if (on) {
    await prisma.offerActivation.upsert({
      where: { customerId_offerId: { customerId, offerId } },
      update: {},
      create: { customerId, offerId },
    });
  } else {
    await prisma.offerActivation.deleteMany({ where: { customerId, offerId } });
  }
  return listOffers(prisma, customerId);
}
