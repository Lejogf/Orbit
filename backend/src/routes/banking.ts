// Dashboard, card controls and internal transfers.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireCustomer } from '../middleware/session.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import { getDashboard, getSafeToSpend, getTimeline } from '../services/dashboard.js';
import { refreshSubscriptions } from '../services/subscriptions.js';
import { nessie } from '../nessie/client.js';
import { centsToDollars, toIsoDate } from '../lib/utils.js';

export const bankingRouter = Router();

bankingRouter.get(
  '/dashboard',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    // Make sure detection has run at least once before the dashboard reads totals.
    const seen = await prisma.subscription.count({ where: { account: { customerId: customer.id } } });
    if (seen === 0) await refreshSubscriptions(prisma, customer.id);
    sendOk(res, await getDashboard(prisma, customer.id));
  }),
);

bankingRouter.get(
  '/safe-to-spend',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, await getSafeToSpend(prisma, customer.id));
  }),
);

bankingRouter.get(
  '/timeline',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(180).default(45) }).parse(
      req.query,
    );
    sendOk(res, await getTimeline(prisma, customer.id, days));
  }),
);

// --- card controls ---

bankingRouter.post(
  '/accounts/:id/lock',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const id = param(req, 'id');

    const account = await prisma.account.findFirst({ where: { id, customerId: customer.id } });
    if (!account) throw ApiError.notFound('Account');
    if (account.type !== 'Credit Card') {
      throw ApiError.badRequest('Only cards can be locked.');
    }

    const updated = await prisma.account.update({ where: { id }, data: { isLocked: locked } });
    sendOk(res, { id: updated.id, isLocked: updated.isLocked });
  }),
);

/**
 * Returns the full card number. Real banking apps gate this behind re-auth; this
 * demo has mocked login, so it is simply a separate endpoint the UI calls when
 * the user taps "show" — the number is never included in the account list.
 */
bankingRouter.get(
  '/accounts/:id/card-number',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const account = await prisma.account.findFirst({
      where: { id: param(req, 'id'), customerId: customer.id },
    });
    if (!account) throw ApiError.notFound('Account');
    if (account.type !== 'Credit Card') throw ApiError.badRequest('Not a card.');

    // Deterministic mock PAN built from the stored last4.
    const number = `4747 8821 ${String(9000 + (parseInt(account.last4, 10) % 1000)).padStart(4, '0')} ${account.last4}`;

    sendOk(res, {
      number,
      expiry: '08/29',
      cvv: String(100 + (parseInt(account.last4, 10) % 900)),
    });
  }),
);

// --- transfers ---

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountCents: z.number().int().positive().max(100_000_00),
  description: z.string().trim().max(120).optional(),
});

bankingRouter.post(
  '/transfers',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const body = transferSchema.parse(req.body);

    if (body.fromAccountId === body.toAccountId) {
      throw ApiError.badRequest('Choose two different accounts.');
    }

    // Both sides must belong to the signed-in customer.
    const [from, to] = await Promise.all([
      prisma.account.findFirst({ where: { id: body.fromAccountId, customerId: customer.id } }),
      prisma.account.findFirst({ where: { id: body.toAccountId, customerId: customer.id } }),
    ]);

    if (!from || !to) throw ApiError.notFound('Account');
    if (from.type === 'Credit Card') {
      throw ApiError.badRequest('You cannot transfer out of a credit card.');
    }
    if (from.balanceCents < body.amountCents) {
      throw ApiError.badRequest('Not enough available balance for this transfer.');
    }

    const description = body.description?.trim() || `Transfer to ${to.nickname}`;
    const now = new Date();

    // Nessie can't link the two sides of a transfer, so both legs are written
    // here and only the outbound one is mirrored upstream.
    await prisma.$transaction([
      prisma.account.update({
        where: { id: from.id },
        data: { balanceCents: { decrement: body.amountCents } },
      }),
      prisma.account.update({
        where: { id: to.id },
        data: {
          // Paying a card reduces what is owed rather than adding to a balance.
          balanceCents:
            to.type === 'Credit Card'
              ? { decrement: body.amountCents }
              : { increment: body.amountCents },
        },
      }),
      prisma.transaction.create({
        data: {
          accountId: from.id,
          source: 'transfer',
          amountCents: -body.amountCents,
          description,
          postedAt: now,
          category: 'Transfer',
        },
      }),
      prisma.transaction.create({
        data: {
          accountId: to.id,
          source: 'transfer',
          amountCents: body.amountCents,
          description: `Transfer from ${from.nickname}`,
          postedAt: now,
          category: 'Transfer',
        },
      }),
    ]);

    if (from.nessieId) {
      try {
        await nessie.createTransfer(from.nessieId, {
          transaction_date: toIsoDate(now),
          status: 'completed',
          amount: centsToDollars(body.amountCents),
          description,
        });
      } catch {
        // Upstream mirroring is best-effort; the transfer already happened locally.
      }
    }

    sendOk(res, {
      from: { id: from.id, balanceCents: from.balanceCents - body.amountCents },
      to: {
        id: to.id,
        balanceCents:
          to.type === 'Credit Card'
            ? to.balanceCents - body.amountCents
            : to.balanceCents + body.amountCents,
      },
      amountCents: body.amountCents,
      description,
    });
  }),
);
