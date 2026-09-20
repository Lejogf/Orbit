// Ori, live support, and alert delivery.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import { requireCustomer } from '../middleware/session.js';
import { respond, INITIAL_STATE } from '../features/ori/respond.js';
import { ACCESS_NEEDS, SUPPORT_PHONE } from '../features/support.js';
import { buildOriContext } from '../services/insights.js';
import { closeCase, createCase, getCase, listCases, postMessage } from '../services/support.js';
import { notifyCharge, raiseAlert, retryUndelivered, vapidKeys } from '../services/notify.js';
import { earnOnPurchase } from '../services/rewards.js';
import { geminiStatus, navigate, phrase } from '../services/gemini.js';
import { formatCents } from '../lib/utils.js';

export const assistRouter = Router();

// --- Ori ---

const intentIds = z.string().max(40).nullable();

const enoSchema = z.object({
  message: z.string().trim().min(1, 'Type a question.').max(500),
  page: z.string().max(200).regex(/^\//).default('/dashboard'),
  // Conversation state lives on the client; it is small, and validated here.
  state: z
    .object({
      misses: z.number().int().min(0).max(20),
      lastIntent: intentIds,
      lastMessage: z.string().max(500).nullable(),
      lang: z.enum(['en', 'es']),
    })
    .optional(),
});

assistRouter.post(
  '/ori',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = enoSchema.parse(req.body);
    const context = await buildOriContext(prisma, customer, body.page);
    const state = body.state ? { ...INITIAL_STATE, ...body.state, lastIntent: body.state.lastIntent as typeof INITIAL_STATE.lastIntent } : INITIAL_STATE;

    // The rule engine answers first, always. It owns the intent, the customer's
    // real figures, and any proposal. Gemini is only ever asked to improve the
    // wording, or — when the engine did not understand — to work out which
    // screen was wanted. It is never allowed to invent an action.
    const reply = respond(body.message, context, state);

    if (reply.intent === 'fallback') {
      const routed = await navigate(body.message, context);
      if (routed) {
        sendOk(res, {
          ...reply,
          // Understood after all, so the miss counter goes back to zero and the
          // "two misses and you get a person" rule is not triggered unfairly.
          intent: routed.href ? 'navigate' : reply.intent,
          state: { ...reply.state, misses: routed.href ? 0 : reply.state.misses },
          text: routed.text,
          links: routed.href ? [{ label: 'Take me there', href: routed.href }] : reply.links,
          effect: routed.href ? { type: 'navigate' as const, href: routed.href } : reply.effect,
          suggestions: routed.suggestions.length > 0 ? routed.suggestions : reply.suggestions,
          // A successful route is not a miss, so the "I didn't understand, here
          // is a person" offer is withdrawn — unless the topic itself needs one.
          handoff: routed.needsHuman
            ? { topic: 'General help', urgent: true, reason: 'sensitive' }
            : routed.href
              ? null
              : reply.handoff,
        });
        return;
      }
    }

    sendOk(res, await phrase(reply, body.message, context.firstName));
  }),
);

/** What is actually wired up behind Ori. Shown in Settings, not guessed at. */
assistRouter.get(
  '/ori/status',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    sendOk(res, {
      ...geminiStatus(),
      engine: 'rule-based, with Gemini for phrasing and navigation',
      note: 'Every action is decided by Orbit and confirmed by you. The model never moves money.',
    });
  }),
);

// --- support ---

assistRouter.get(
  '/support',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, { phone: SUPPORT_PHONE, needs: ACCESS_NEEDS, cases: await listCases(prisma, customer.id) });
  }),
);

const caseSchema = z.object({
  channel: z.enum(['chat', 'callback', 'call', 'message']),
  topic: z.string().trim().min(1).max(120).default('General help'),
  needs: z.array(z.enum(ACCESS_NEEDS.map((n) => n.id) as [string, ...string[]])).max(9).default([]),
  transcript: z.array(z.object({ author: z.enum(['customer', 'eno']), text: z.string().max(2000) })).max(40).default([]),
  callbackAt: z.string().datetime().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  message: z.string().trim().max(2000).optional(),
});

assistRouter.post(
  '/support/cases',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = caseSchema.parse(req.body);
    const created = await createCase(prisma, customer, {
      ...body,
      needs: body.needs as Parameters<typeof createCase>[2]['needs'],
      transcript: body.message ? [...body.transcript, { author: 'customer', text: body.message }] : body.transcript,
    });
    sendOk(res, created, 201);
  }),
);

assistRouter.get(
  '/support/cases/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await getCase(prisma, customer, param(req, 'id')));
  }),
);

assistRouter.post(
  '/support/cases/:id/messages',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { body } = z.object({ body: z.string().trim().min(1, 'Type a message.').max(2000) }).parse(req.body);
    sendOk(res, await postMessage(prisma, customer, param(req, 'id'), body));
  }),
);

assistRouter.post(
  '/support/cases/:id/close',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await closeCase(prisma, customer, param(req, 'id')));
  }),
);

// --- alert delivery ---

assistRouter.get(
  '/notifications/vapid',
  asyncRoute(async (req, res) => {
    await requireCustomer(req);
    sendOk(res, { publicKey: (await vapidKeys(prisma)).publicKey });
  }),
);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

assistRouter.post(
  '/notifications/subscribe',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = subscriptionSchema.parse(req.body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { customerId: customer.id, p256dh: body.keys.p256dh, auth: body.keys.auth, failures: 0 },
      create: { customerId: customer.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    const devices = await prisma.pushSubscription.count({ where: { customerId: customer.id } });
    sendOk(res, { subscribed: true, devices });
  }),
);

assistRouter.post(
  '/notifications/unsubscribe',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, customerId: customer.id } });
    sendOk(res, { subscribed: false });
  }),
);

assistRouter.get(
  '/notifications/status',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const [devices, lastWeek] = await Promise.all([
      prisma.pushSubscription.findMany({ where: { customerId: customer.id }, select: { createdAt: true, lastSuccessAt: true, failures: true } }),
      prisma.alert.groupBy({
        by: ['pushStatus'],
        where: { customerId: customer.id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        _count: true,
      }),
    ]);
    sendOk(res, {
      devices: devices.length,
      lastDelivered: devices.map((d) => d.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null,
      delivery: Object.fromEntries(lastWeek.map((g) => [g.pushStatus ?? 'inbox_only', g._count])),
    });
  }),
);

assistRouter.post(
  '/notifications/retry',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await retryUndelivered(prisma, customer.id));
  }),
);

const TEST_MERCHANTS = [
  { name: 'Starbucks', category: 'Dining', cents: 575 },
  { name: 'Shell', category: 'Gas', cents: 4_210 },
  { name: 'Target', category: 'Shopping', cents: 2_389 },
  { name: 'Uber', category: 'Transport', cents: 1_644 },
];

/**
 * A real card purchase, end to end: it posts to the card, raises the charge
 * alert and pushes it. A locked card declines it — and that alerts too.
 */
assistRouter.post(
  '/notifications/test-charge',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const card = await prisma.account.findFirst({ where: { customerId: customer.id, type: 'Credit Card' } });
    if (!card) throw ApiError.badRequest('You need a card to test charge alerts.');

    const pick = TEST_MERCHANTS[Math.floor(Math.random() * TEST_MERCHANTS.length)]!;

    if (card.isLocked) {
      const alert = await raiseAlert(prisma, {
        customerId: customer.id,
        kind: 'charge_declined',
        title: `Declined: ${formatCents(pick.cents)} at ${pick.name}`,
        body: `Your card ••${card.last4} is locked, so this was declined. If it was you, unlock the card and try again.`,
        amountCents: pick.cents,
        href: '/accounts',
      });
      return sendOk(res, { declined: true, alert });
    }

    const merchant = (await prisma.merchant.findFirst({ where: { name: pick.name } })) ?? (await prisma.merchant.create({ data: { name: pick.name, category: pick.category } }));
    await prisma.$transaction([
      prisma.transaction.create({
        data: { accountId: card.id, merchantId: merchant.id, source: 'purchase', amountCents: -pick.cents, description: pick.name, postedAt: new Date(), category: pick.category },
      }),
      prisma.account.update({ where: { id: card.id }, data: { balanceCents: { increment: pick.cents } } }),
    ]);
    await earnOnPurchase(prisma, {
      customerId: customer.id,
      accountId: card.id,
      amountCents: pick.cents,
      category: pick.category,
      merchant: pick.name,
    });
    const alert = await notifyCharge(prisma, {
      customerId: customer.id,
      merchant: pick.name,
      amountCents: pick.cents,
      accountLabel: `${card.nickname} ••${card.last4}`,
      href: `/accounts/${card.id}?from=alerts`,
    });
    sendOk(res, { declined: false, alert });
  }),
);
