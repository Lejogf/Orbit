// Subscriptions, Guard, virtual cards, reminders and alerts.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireCustomer } from '../middleware/session.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import * as subs from '../services/subscriptions.js';
import { listAlerts, markAlertRead, unreadAlertCount } from '../services/dashboard.js';

export const subscriptionsRouter = Router();

/** Re-runs detection. Cheap enough to call on page load. */
subscriptionsRouter.post(
  '/subscriptions/refresh',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await subs.refreshSubscriptions(prisma, customer.id));
  }),
);

subscriptionsRouter.get(
  '/subscriptions',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const query = z
      .object({
        status: z.enum(['active', 'guarded', 'blocked', 'canceled']).optional(),
        category: z.string().trim().min(1).max(50).optional(),
      })
      .parse(req.query);

    // Detection runs on read so the list is never stale after a data change.
    let all = await subs.listSubscriptions(prisma, customer.id);
    if (all.length === 0) all = await subs.refreshSubscriptions(prisma, customer.id);

    const filtered = all.filter(
      (s) =>
        (!query.status || s.status === query.status) &&
        (!query.category || s.category === query.category),
    );

    sendOk(res, {
      subscriptions: filtered,
      summary: await subs.subscriptionSummary(prisma, customer.id),
      categories: [...new Set(all.map((s) => s.category))].sort(),
    });
  }),
);

subscriptionsRouter.get(
  '/subscriptions/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const subscription = await subs.getSubscription(prisma, param(req, 'id'), customer.id);
    if (!subscription) throw ApiError.notFound('Subscription');
    sendOk(res, subscription);
  }),
);

const actionSchema = z.object({
  action: z.enum([
    'guard',
    'block',
    'unguard',
    'create_virtual_card',
    'remove_virtual_card',
    'simulate_renewal',
  ]),
});

subscriptionsRouter.post(
  '/subscriptions/:id/actions',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { action } = actionSchema.parse(req.body);
    const id = param(req, 'id');

    const exists = await prisma.subscription.findFirst({
      where: { id, account: { customerId: customer.id } },
    });
    if (!exists) throw ApiError.notFound('Subscription');

    switch (action) {
      case 'guard': {
        const result = await subs.guardSubscription(prisma, id);
        // Mirror the obligation into Nessie once the user commits to managing it.
        void subs.mirrorBillToNessie(prisma, id);
        return sendOk(res, result);
      }
      case 'block':
        return sendOk(res, await subs.blockSubscription(prisma, id));
      case 'unguard':
        return sendOk(res, await subs.unguardSubscription(prisma, id));
      case 'create_virtual_card':
        return sendOk(res, await subs.createVirtualCard(prisma, id));
      case 'remove_virtual_card':
        return sendOk(res, await subs.removeVirtualCard(prisma, id));
      case 'simulate_renewal':
        return sendOk(res, await subs.simulateRenewal(prisma, id));
    }
  }),
);

subscriptionsRouter.post(
  '/subscriptions/:id/virtual-card',
  asyncRoute(async (req, res) => {
    const body = z
      .discriminatedUnion('status', [
        z.object({ status: z.literal('active') }),
        z.object({ status: z.literal('locked') }),
        z.object({
          status: z.literal('deleted'),
          // Deleting the number says nothing about the subscription, so the
          // caller has to decide what happens to it.
          then: z.enum(['cancel', 'move_to_real_card']),
        }),
      ])
      .parse(req.body);

    const id = param(req, 'id');

    if (body.status === 'deleted') {
      const result = await subs.deleteVirtualCard(prisma, id, body.then);
      if (!result) throw ApiError.notFound('Subscription');
      return sendOk(res, result);
    }

    sendOk(res, await subs.setVirtualCardStatus(prisma, id, body.status));
  }),
);

subscriptionsRouter.post(
  '/subscriptions/:id/reminders',
  asyncRoute(async (req, res) => {
    const { daysBefore, channel } = z
      .object({
        daysBefore: z.number().int().min(1).max(90),
        channel: z.enum(['push', 'email', 'sms']).default('push'),
      })
      .parse(req.body);

    const result = await subs.setReminder(prisma, param(req, 'id'), daysBefore, channel);
    if (!result) throw ApiError.notFound('Subscription');
    sendOk(res, result);
  }),
);

subscriptionsRouter.delete(
  '/subscriptions/:id/reminders/:daysBefore',
  asyncRoute(async (req, res) => {
    const daysBefore = Number(param(req, 'daysBefore'));
    if (!Number.isFinite(daysBefore)) throw ApiError.badRequest('Invalid reminder');
    sendOk(res, await subs.clearReminder(prisma, param(req, 'id'), daysBefore));
  }),
);

// --- alerts ---

subscriptionsRouter.get(
  '/alerts',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, {
      alerts: await listAlerts(prisma, customer.id),
      unread: await unreadAlertCount(prisma, customer.id),
    });
  }),
);

subscriptionsRouter.post(
  '/alerts/:id/read',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await markAlertRead(prisma, customer.id, param(req, 'id')));
  }),
);

subscriptionsRouter.post(
  '/alerts/:id/decision',
  asyncRoute(async (req, res) => {
    const { decision } = z.object({ decision: z.enum(['approve', 'keep_blocked']) }).parse(req.body);

    const result =
      decision === 'approve'
        ? await subs.approvePendingCharge(prisma, param(req, 'id'))
        : await subs.keepBlocked(prisma, param(req, 'id'));

    if (!result) throw ApiError.notFound('Alert');
    sendOk(res, result);
  }),
);
