// Cards, rewards, investing, budgeting and payments.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncRoute, param, sendOk } from '../lib/http.js';
import { budgetHistory, budgetTrend } from '../services/documents.js';
import { mongoStatus } from '../services/mongo.js';
import { requireCustomer } from '../middleware/session.js';
import { cardOffers, listCards, openCard, orderPhysicalCard } from '../services/cards.js';
import { redeemPoints, rewardsOverview } from '../services/rewards.js';
import { buy, instrumentDetail, investingOverview, requestTransferOut, sell } from '../services/investing.js';
import {
  budgetOverview,
  cancelInvite,
  createHousehold,
  householdInvites,
  inviteToHousehold,
  envelopeSuggestions,
  joinHousehold,
  leaveHousehold,
  respondToInvite,
  saveBudget,
  saveEnvelopes,
} from '../services/budget.js';
import { cancelPayment, depositCheck, listPayments, markRequestPaid, releaseHeldChecks, savePayee, schedulePayment } from '../services/payments.js';

export const moneyRouter = Router();

const cents = z.number().int().min(0).max(100_000_000);

// --- cards ---

moneyRouter.get(
  '/cards',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, { cards: await listCards(prisma, customer.id), ...(await cardOffers(prisma, customer.id)) });
  }),
);

moneyRouter.post(
  '/cards/open',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { productId } = z.object({ productId: z.string().min(1).max(40) }).parse(req.body);
    sendOk(res, await openCard(prisma, customer.id, productId), 201);
  }),
);

moneyRouter.post(
  '/cards/:id/order-physical',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await orderPhysicalCard(prisma, customer.id, param(req, 'id')));
  }),
);

// --- rewards ---

moneyRouter.get(
  '/rewards',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await rewardsOverview(prisma, customer.id));
  }),
);

moneyRouter.post(
  '/rewards/redeem',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        redemption: z.enum(['cash', 'giftcard', 'travel', 'invest', 'merch', 'partner']),
        points: z.number().int().min(1).max(10_000_000),
      })
      .parse(req.body);
    sendOk(res, await redeemPoints(prisma, customer.id, body));
  }),
);

// --- investing ---

moneyRouter.get(
  '/invest',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await investingOverview(prisma, customer.id));
  }),
);

moneyRouter.get(
  '/invest/:symbol',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    const { range } = z.object({ range: z.coerce.number().int().min(7).max(365).default(90) }).parse(req.query);
    sendOk(res, await instrumentDetail(param(req, 'symbol'), range));
  }),
);

moneyRouter.post(
  '/invest/buy',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        symbol: z.string().min(1).max(10),
        amountCents: cents,
        fundedBy: z.enum(['cash', 'points']).default('cash'),
      })
      .parse(req.body);
    sendOk(res, await buy(prisma, customer.id, body));
  }),
);

moneyRouter.post(
  '/invest/sell',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z.object({ symbol: z.string().min(1).max(10), quantity: z.number().positive().max(1_000_000) }).parse(req.body);
    sendOk(res, await sell(prisma, customer.id, body));
  }),
);

moneyRouter.post(
  '/invest/transfer-out',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { broker } = z.object({ broker: z.string().trim().min(1).max(60) }).parse(req.body);
    sendOk(res, await requestTransferOut(prisma, customer.id, broker));
  }),
);

// --- budget ---

moneyRouter.get(
  '/budget',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await budgetOverview(prisma, customer.id));
  }),
);

moneyRouter.patch(
  '/budget',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        method: z.enum(['rule5030', 'rule70101010', 'zero', 'custom']).optional(),
        monthlyIncomeCents: cents.nullable().optional(),
        emergencyTargetMonths: z.number().int().min(1).max(12).optional(),
      })
      .parse(req.body);
    await saveBudget(prisma, customer.id, body);
    sendOk(res, await budgetOverview(prisma, customer.id));
  }),
);

moneyRouter.get(
  '/budget/suggestions',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await envelopeSuggestions(prisma, customer.id));
  }),
);

moneyRouter.put(
  '/budget/envelopes',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        envelopes: z
          .array(
            z.object({
              category: z.string().trim().min(1).max(50),
              plannedCents: cents,
              bucket: z.enum(['needs', 'wants', 'savings', 'debt']).optional(),
              limitCents: cents.nullable().optional(),
            }),
          )
          .max(60),
      })
      .parse(req.body);
    sendOk(res, await saveEnvelopes(prisma, customer.id, body.envelopes));
  }),
);

/**
 * How the plan has changed month to month, from the Atlas snapshots.
 *
 * The relational Budget row holds only the current plan, so this is the one
 * place the history lives. Without a cluster it returns an empty history and
 * the section is simply not shown.
 */
moneyRouter.get(
  '/budget/history',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const [history, trend] = await Promise.all([budgetHistory(customer.id, 12), budgetTrend(customer.id)]);
    sendOk(res, {
      months: history.map((snapshot) => ({
        month: snapshot.month,
        method: snapshot.method,
        monthlyIncomeCents: snapshot.monthlyIncomeCents,
        safeDailyCents: snapshot.safeDailyCents,
        surplusCents: snapshot.surplusCents,
        runwayMonths: snapshot.runwayMonths,
        envelopes: snapshot.envelopes ?? [],
      })),
      trend,
      store: mongoStatus(),
    });
  }),
);

moneyRouter.post(
  '/budget/household',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { name } = z.object({ name: z.string().trim().max(60).default('Our household') }).parse(req.body);
    sendOk(res, await createHousehold(prisma, customer.id, name), 201);
  }),
);

moneyRouter.post(
  '/budget/household/join',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({ code: z.string().trim().min(6).max(20), role: z.enum(['partner', 'teen', 'child']).default('partner') })
      .parse(req.body);
    sendOk(res, await joinHousehold(prisma, customer.id, body.code, body.role));
  }),
);

// Inviting someone by username. The invite is an offer: it does nothing to
// their money until they accept it.
moneyRouter.get(
  '/budget/household/invites',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await householdInvites(prisma, customer.id));
  }),
);

moneyRouter.post(
  '/budget/household/invites',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        username: z.string().trim().min(1, 'Type a username.').max(40),
        role: z.enum(['partner', 'teen', 'child']).default('partner'),
        note: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    sendOk(res, await inviteToHousehold(prisma, customer.id, body), 201);
  }),
);

moneyRouter.post(
  '/budget/household/invites/:id/respond',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    sendOk(res, await respondToInvite(prisma, customer.id, param(req, 'id'), accept));
  }),
);

moneyRouter.post(
  '/budget/household/invites/:id/cancel',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await cancelInvite(prisma, customer.id, param(req, 'id')));
  }),
);

moneyRouter.post(
  '/budget/household/leave',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await leaveHousehold(prisma, customer.id));
  }),
);

// --- payments ---

moneyRouter.get(
  '/pay',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    await releaseHeldChecks(prisma, customer.id);
    sendOk(res, await listPayments(prisma, customer.id));
  }),
);

moneyRouter.post(
  '/pay/payees',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        name: z.string().trim().min(1, 'Enter a name.').max(60),
        handle: z.string().trim().min(1, 'Enter a phone number or email.').max(120),
        kind: z.enum(['person', 'biller']).default('person'),
        logoSlug: z.string().max(60).nullable().optional(),
      })
      .parse(req.body);
    await savePayee(prisma, customer.id, body);
    sendOk(res, await listPayments(prisma, customer.id), 201);
  }),
);

moneyRouter.post(
  '/pay/send',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        payeeId: z.string().max(40).nullable().optional(),
        name: z.string().trim().max(60).optional(),
        handle: z.string().trim().max(120).optional(),
        accountId: z.string().min(1).max(40),
        amountCents: z.number().int().positive().max(10_000_000),
        memo: z.string().trim().max(140).nullable().optional(),
        direction: z.enum(['send', 'request', 'bill']).default('send'),
        dueDate: z.string().max(30).nullable().optional(),
        repeat: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
      })
      .parse(req.body);
    sendOk(res, await schedulePayment(prisma, customer.id, body), 201);
  }),
);

moneyRouter.post(
  '/pay/:id/cancel',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await cancelPayment(prisma, customer.id, param(req, 'id')));
  }),
);

moneyRouter.post(
  '/pay/:id/received',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await markRequestPaid(prisma, customer.id, param(req, 'id')));
  }),
);

moneyRouter.post(
  '/pay/deposit-check',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = z
      .object({
        accountId: z.string().min(1).max(40),
        amountCents: z.number().int().positive().max(10_000_000),
        frontName: z.string().max(200).optional(),
        backName: z.string().max(200).optional(),
      })
      .parse(req.body);
    await depositCheck(prisma, customer.id, body);
    sendOk(res, await listPayments(prisma, customer.id), 201);
  }),
);
