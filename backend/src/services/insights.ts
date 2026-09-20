// Spending report and Ori's context, both built from the customer's own data.
import type { PrismaClient } from '@prisma/client';
import { buildSpendingReport, type SpendTransaction } from '../features/spending.js';
import type { OriContext } from '../features/ori/respond.js';
import { INSTALLMENT_ELIGIBILITY_MIN_CENTS } from '../data/demoDataset.js';
import { getSafeToSpend, getTimeline, unreadAlertCount } from './dashboard.js';
import { getCreditReport } from './credit.js';

async function spendTransactions(prisma: PrismaClient, customerId: string, since: Date): Promise<SpendTransaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { account: { customerId }, postedAt: { gte: since } },
    include: { merchant: { select: { name: true } } },
    orderBy: { postedAt: 'desc' },
  });
  return rows.map((row) => ({
    amountCents: row.amountCents,
    category: row.category,
    merchantName: row.merchant?.name ?? null,
    description: row.description,
    postedAt: row.postedAt,
    source: row.source,
  }));
}

export async function getSpendingReport(prisma: PrismaClient, customerId: string, monthOffset = 0, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset - 6, 1));
  const [transactions, subscriptions] = await Promise.all([
    spendTransactions(prisma, customerId, since),
    prisma.subscription.findMany({ where: { account: { customerId } }, select: { merchantName: true } }),
  ]);
  return buildSpendingReport(transactions, {
    now,
    monthOffset,
    recurringCategories: new Set(subscriptions.map((s) => s.merchantName)),
  });
}

/** Everything Ori might need to answer, in one read. Kept small and flat. */
export async function buildOriContext(
  prisma: PrismaClient,
  customer: { id: string; firstName: string },
  page: string,
): Promise<OriContext> {
  const now = new Date();
  const [accounts, subscriptions, safe, timeline, recent, spending, credit, plans, eligible, unread] = await Promise.all([
    prisma.account.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' } }),
    prisma.subscription.findMany({ where: { account: { customerId: customer.id } }, include: { merchant: { select: { cancelUrl: true } } }, orderBy: { amountCents: 'desc' } }),
    getSafeToSpend(prisma, customer.id, now),
    getTimeline(prisma, customer.id, 21, now),
    prisma.transaction.findMany({ where: { account: { customerId: customer.id } }, orderBy: { postedAt: 'desc' }, take: 8 }),
    getSpendingReport(prisma, customer.id, 0, now),
    getCreditReport(prisma, customer.id, now).catch(() => null),
    prisma.installmentPlan.findMany({ where: { status: 'active', account: { customerId: customer.id } } }),
    prisma.transaction.findFirst({
      where: {
        account: { customerId: customer.id, type: 'Credit Card' },
        source: 'purchase',
        amountCents: { lte: -INSTALLMENT_ELIGIBILITY_MIN_CENTS },
      },
      include: { merchant: { select: { name: true } } },
      orderBy: { postedAt: 'desc' },
    }),
    unreadAlertCount(prisma, customer.id),
  ]);

  const factors = credit?.factors ?? [];
  const byScore = [...factors].sort((a, b) => a.score - b.score);

  return {
    firstName: customer.firstName,
    page,
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      nickname: a.nickname,
      last4: a.last4,
      balanceCents: a.balanceCents,
      creditLimitCents: a.creditLimitCents,
      isLocked: a.isLocked,
      rewardsCents: a.rewardsCents,
    })),
    safeToSpend: {
      cents: safe.safeToSpendCents,
      committedCents: safe.committedCents,
      nextPayday: safe.nextPayday,
      daysUntilPayday: safe.daysUntilPayday,
    },
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      merchantName: s.merchantName,
      amountCents: s.amountCents,
      frequency: s.frequency,
      status: s.status,
      nextChargeDate: s.nextChargeDate.toISOString(),
      isFreeTrial: s.isFreeTrial,
      hasPriceIncrease: s.hasPriceIncrease,
      isDuplicate: s.isDuplicate,
      looksUnused: s.looksUnused,
      cancelUrl: s.merchant.cancelUrl,
    })),
    upcoming: timeline.map((t) => ({ label: t.label, amountCents: t.amountCents, date: t.date, kind: t.kind })),
    recent: recent.map((t) => ({ description: t.description, amountCents: t.amountCents, postedAt: t.postedAt.toISOString(), category: t.category })),
    spending: {
      monthTotalCents: spending.totalCents,
      previousTotalCents: spending.previousTotalCents,
      top: spending.categories.slice(0, 3).map((c) => ({ category: c.category, cents: c.cents })),
    },
    credit: {
      score: credit?.score ?? 0,
      band: credit?.band ?? 'unknown',
      weakest: byScore[0] ? { label: byScore[0].label, detail: byScore[0].detail } : null,
      strongest: byScore.at(-1) ? { label: byScore.at(-1)!.label } : null,
    },
    plans: {
      activeCount: plans.length,
      monthlyTotalCents: plans.reduce((s, p) => s + p.monthlyPaymentCents, 0),
    },
    eligiblePurchase: eligible
      ? { id: eligible.id, merchant: eligible.merchant?.name ?? eligible.description, amountCents: -eligible.amountCents }
      : null,
    unreadAlerts: unread,
  };
}
