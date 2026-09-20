// Spending insights, travel and rewards, offers, and bill splitting.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { splitSummary } from '../services/split.js';
import { mongoStatus } from '../services/mongo.js';
import { asyncRoute, param, sendOk } from '../lib/http.js';
import { requireCustomer } from '../middleware/session.js';
import { getSpendingReport } from '../services/insights.js';
import {
  bookTrip,
  checkBookingPrice,
  listBookings,
  listOffers,
  cancelBooking,
  flightOptions,
  quoteCancelBooking,
  quoteTrip,
  rewardsSummary,
  setOfferActivation,
  type TripRequest,
} from '../services/travel.js';
import { AIRPORTS, cityFor, forecastPrice, searchHotels } from '../features/travel.js';
import { daysBetween } from '../lib/utils.js';
import { parseReceiptText } from '../features/receipt.js';
import { computeShares, listSplits, markSharePaid, saveSplit } from '../services/split.js';

export const lifestyleRouter = Router();

// --- spending ---

lifestyleRouter.get(
  '/spending',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).max(5).default(0) }).parse(req.query);
    sendOk(res, await getSpendingReport(prisma, customer.id, offset));
  }),
);

// --- travel ---

const airport = z.string().trim().toUpperCase().refine((code) => AIRPORTS.some((a) => a.code === code), 'Choose an airport from the list.');
const futureDate = z
  .string()
  .date()
  .refine((d) => new Date(`${d}T23:59:59Z`) >= new Date(), 'Choose a date in the future.');

const flightSearch = z.object({
  from: airport,
  to: airport,
  date: futureDate,
  travelers: z.coerce.number().int().min(1).max(6).default(1),
}).refine((s) => s.from !== s.to, { message: 'Choose two different airports.', path: ['to'] });

const hotelSearch = z.object({
  city: z.string().trim().min(2).max(60),
  checkIn: futureDate,
  nights: z.coerce.number().int().min(1).max(21).default(2),
});

lifestyleRouter.get(
  '/travel',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, {
      airports: AIRPORTS,
      rewards: await rewardsSummary(prisma, customer.id),
      bookings: await listBookings(prisma, customer.id),
    });
  }),
);

lifestyleRouter.get(
  '/travel/flights',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    const search = flightSearch.parse(req.query);
    const today = new Date();
    sendOk(res, {
      search: { ...search, fromCity: cityFor(search.from), toCity: cityFor(search.to) },
      forecast: forecastPrice(Math.max(0, daysBetween(today, new Date(`${search.date}T00:00:00Z`)))),
      ...(await flightOptions(search, today)),
    });
  }),
);

lifestyleRouter.get(
  '/travel/hotels',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    const search = hotelSearch.parse(req.query);
    const today = new Date();
    sendOk(res, {
      search,
      forecast: forecastPrice(Math.max(0, daysBetween(today, new Date(`${search.checkIn}T00:00:00Z`)))),
      options: searchHotels(search, today),
    });
  }),
);

const tripSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flight'), search: flightSearch, optionId: z.string().min(1).max(40) }),
  z.object({ kind: z.literal('hotel'), search: hotelSearch, optionId: z.string().min(1).max(40) }),
]);

lifestyleRouter.post(
  '/travel/quote',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await quoteTrip(prisma, customer.id, tripSchema.parse(req.body) as TripRequest));
  }),
);

lifestyleRouter.post(
  '/travel/book',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({ trip: tripSchema, payWith: z.enum(['card', 'miles', 'mix', 'card_then_erase']) })
      .parse(req.body);
    sendOk(res, await bookTrip(prisma, customer.id, body.trip as TripRequest, body.payWith), 201);
  }),
);

lifestyleRouter.post(
  '/travel/bookings/:id/check-price',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { demo } = z.object({ demo: z.boolean().default(false) }).parse(req.body ?? {});
    sendOk(res, await checkBookingPrice(prisma, customer.id, param(req, 'id'), demo));
  }),
);

// The fee is quoted before anything is cancelled: nobody should discover what
// a cancellation costs by cancelling.
lifestyleRouter.get(
  '/travel/bookings/:id/cancellation',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await quoteCancelBooking(prisma, customer.id, param(req, 'id')));
  }),
);

lifestyleRouter.post(
  '/travel/bookings/:id/cancel',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await cancelBooking(prisma, customer.id, param(req, 'id')));
  }),
);

// --- offers ---

lifestyleRouter.get(
  '/offers',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await listOffers(prisma, customer.id));
  }),
);

lifestyleRouter.post(
  '/offers/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { activated } = z.object({ activated: z.boolean() }).parse(req.body);
    sendOk(res, await setOfferActivation(prisma, customer.id, param(req, 'id'), activated));
  }),
);

// --- bill splitting ---

lifestyleRouter.post(
  '/split/parse',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    const { text } = z.object({ text: z.string().max(20_000) }).parse(req.body);
    sendOk(res, parseReceiptText(text));
  }),
);

const cents = z.number().int().min(0).max(10_000_000);

const splitSchema = z.object({
  title: z.string().trim().max(120).default('Shared bill'),
  mode: z.enum(['items', 'even']),
  people: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().trim().min(1, 'Every person needs a name.').max(60),
        contact: z.string().trim().max(120).nullable().optional(),
        isSelf: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
  items: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(80), cents, quantity: z.number().int().min(1).max(99) })).max(100),
  assignments: z.record(z.array(z.string().max(40)).max(20)).default({}),
  taxCents: cents.default(0),
  tipCents: cents.default(0),
  totalCents: cents.optional(),
  extrasMode: z.enum(['proportional', 'even']).default('proportional'),
  transactionId: z.string().max(40).nullable().optional(),
});

lifestyleRouter.post(
  '/split/preview',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    sendOk(res, computeShares(splitSchema.parse(req.body)));
  }),
);

lifestyleRouter.get(
  '/split',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await listSplits(prisma, customer.id));
  }),
);

lifestyleRouter.post(
  '/split',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await saveSplit(prisma, customer.id, splitSchema.parse(req.body)), 201);
  }),
);

lifestyleRouter.post(
  '/split/shares/:id/paid',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await markSharePaid(prisma, customer.id, param(req, 'id')));
  }),
);

/**
 * Who you split bills with most and what is still outstanding with each —
 * an Atlas aggregation over the nested people in every split document.
 */
lifestyleRouter.get(
  '/split/summary',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, { ...(await splitSummary(customer.id)), store: mongoStatus() });
  }),
);
