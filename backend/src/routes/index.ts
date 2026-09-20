// All API routes. Mounted under /api.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncRoute, param, sendOk } from '../lib/http.js';
import { config } from '../config.js';
import { currentCustomer, requireCustomer } from '../middleware/session.js';
import { getDataSourceStatus } from '../data/provider.js';
import { INSTALLMENT_ELIGIBILITY_MIN_CENTS } from '../data/demoDataset.js';
import type { Account, AccountType, Transaction, TransactionSource } from '../domain/types.js';

import { subscriptionsRouter } from './subscriptions.js';
import { plansRouter } from './plans.js';
import { bankingRouter } from './banking.js';
import { authRouter } from './auth.js';
import { creditRouter } from './credit.js';

export const apiRouter = Router();

apiRouter.use(authRouter);
apiRouter.use(creditRouter);
apiRouter.use(subscriptionsRouter);
apiRouter.use(plansRouter);
apiRouter.use(bankingRouter);

// --- health ---
// Reports which data source is live, so a mid-demo fallback is visible.

apiRouter.get(
  '/health',
  asyncRoute(async (req, res) => {
    // Scoped to the signed-in customer where there is one. A global count made
    // this misreport once a second customer loaded their own sample data.
    const customer = await currentCustomer(req);
    const scope = customer ? { customerId: customer.id } : undefined;

    const [accounts, transactions, merchants] = await Promise.all([
      prisma.account.count({ where: scope }),
      prisma.transaction.count({ where: scope ? { account: scope } : undefined }),
      prisma.merchant.count(),
    ]);

    sendOk(res, {
      status: 'ok',
      nessieConfigured: config.nessie.hasKey, // never the key itself
      dataSource: getDataSourceStatus(),
      scope: customer ? 'customer' : 'global',
      mirror: { accounts, transactions, merchants },
      seeded: accounts > 0 && transactions > 0,
    });
  }),
);

// --- the demo user (login is mocked; there is exactly one) ---

apiRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    sendOk(res, {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      initials: `${customer.firstName[0] ?? ''}${customer.lastName[0] ?? ''}`,
    });
  }),
);

// --- accounts and transactions ---

function toAccount(row: {
  id: string;
  nessieId: string | null;
  type: string;
  nickname: string;
  last4: string;
  balanceCents: number;
  creditLimitCents: number | null;
  rewardsCents: number;
  isLocked: boolean;
}): Account & { isLocked: boolean } {
  const isCard = row.type === 'Credit Card';
  return {
    id: row.id,
    nessieId: row.nessieId,
    type: row.type as AccountType,
    nickname: row.nickname,
    last4: row.last4,
    balanceCents: row.balanceCents,
    creditLimitCents: row.creditLimitCents,
    // On a card, balanceCents is what's owed.
    availableCreditCents:
      isCard && row.creditLimitCents !== null ? row.creditLimitCents - row.balanceCents : null,
    rewardsCents: isCard ? row.rewardsCents : null,
    isLocked: row.isLocked,
  };
}

function toTransaction(row: {
  id: string;
  nessieId: string | null;
  accountId: string;
  merchantId: string | null;
  source: string;
  amountCents: number;
  description: string;
  postedAt: Date;
  category: string;
  subscriptionId: string | null;
  merchant?: { name: string } | null;
}): Transaction {
  return {
    id: row.id,
    nessieId: row.nessieId,
    accountId: row.accountId,
    merchantId: row.merchantId,
    merchantName: row.merchant?.name ?? null,
    source: row.source as TransactionSource,
    amountCents: row.amountCents,
    description: row.description,
    postedAt: row.postedAt.toISOString(),
    category: row.category,
    subscriptionId: row.subscriptionId,
    isInstallmentEligible:
      row.source === 'purchase' && Math.abs(row.amountCents) >= INSTALLMENT_ELIGIBILITY_MIN_CENTS,
  };
}

apiRouter.get(
  '/accounts',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const rows = await prisma.account.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'asc' },
    });
    sendOk(res, rows.map(toAccount));
  }),
);

apiRouter.get(
  '/accounts/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    // Scoped by customer, so an id belonging to someone else reads as not found
    // rather than confirming it exists.
    const row = await prisma.account.findFirst({
      where: { id: param(req, 'id'), customerId: customer.id },
    });
    if (!row) throw ApiError.notFound('Account');
    sendOk(res, toAccount(row));
  }),
);

const transactionQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  source: z.enum(['purchase', 'deposit', 'withdrawal', 'transfer']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  eligibleOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

apiRouter.get(
  '/accounts/:id/transactions',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const account = await prisma.account.findFirst({
      where: { id: param(req, 'id'), customerId: customer.id },
    });
    if (!account) throw ApiError.notFound('Account');

    const query = transactionQuery.parse(req.query);

    const rows = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        ...(query.source ? { source: query.source } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.from || query.to
          ? {
              postedAt: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                // `to` is inclusive.
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { description: { contains: query.search } },
                { merchant: { name: { contains: query.search } } },
              ],
            }
          : {}),
        ...(query.eligibleOnly === 'true'
          ? { source: 'purchase', amountCents: { lte: -INSTALLMENT_ELIGIBILITY_MIN_CENTS } }
          : {}),
      },
      include: { merchant: { select: { name: true } } },
      orderBy: { postedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    });

    sendOk(res, rows.map(toTransaction));
  }),
);

apiRouter.get(
  '/transactions/:id',
  asyncRoute(async (req, res) => {
    const customer = await requireCustomer(req);
    const row = await prisma.transaction.findFirst({
      where: { id: param(req, 'id'), account: { customerId: customer.id } },
      include: { merchant: { select: { name: true } } },
    });
    if (!row) throw ApiError.notFound('Transaction');
    sendOk(res, toTransaction(row));
  }),
);
