// Dashboard: Safe to Spend, the timeline, and the alert inbox.

import type { PrismaClient } from '@prisma/client';
import { buildTimeline, calculateSafeToSpend } from '../features/safeToSpend.js';
import { paydayHistory, upcomingInstallments } from './money.js';
import { subscriptionSummary } from './subscriptions.js';

async function safeToSpendInput(prisma: PrismaClient, customerId: string, today: Date) {
  const [checking, subscriptions, installments, paydays] = await Promise.all([
    prisma.account.findFirst({ where: { type: 'Checking', customerId } }),
    prisma.subscription.findMany({ where: { account: { customerId } } }),
    upcomingInstallments(prisma, customerId),
    paydayHistory(prisma, customerId),
  ]);

  const lastPaycheck = await prisma.transaction.findFirst({
    where: { source: 'deposit', category: 'Income', account: { customerId } },
    orderBy: { postedAt: 'desc' },
  });

  return {
    checkingBalanceCents: checking?.balanceCents ?? 0,
    paydayHistory: paydays,
    paycheckAmountCents: lastPaycheck?.amountCents ?? 0,
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      merchantName: s.merchantName,
      category: s.category,
      amountCents: s.amountCents,
      nextChargeDate: s.nextChargeDate,
      status: s.status,
      isFreeTrial: s.isFreeTrial,
    })),
    installments,
    today,
  };
}

export async function getSafeToSpend(
  prisma: PrismaClient,
  customerId: string,
  today = new Date(),
) {
  const result = calculateSafeToSpend(await safeToSpendInput(prisma, customerId, today));

  return {
    ...result,
    nextPayday: result.nextPayday?.toISOString() ?? null,
    upcoming: result.upcoming.map((item) => ({ ...item, date: item.date.toISOString() })),
  };
}

export async function getTimeline(
  prisma: PrismaClient,
  customerId: string,
  daysAhead = 45,
  today = new Date(),
) {
  const items = buildTimeline({ ...(await safeToSpendInput(prisma, customerId, today)), daysAhead });
  return items.map((item) => ({ ...item, date: item.date.toISOString() }));
}

/**
 * Alerts the user must act on come first, then time-sensitive ones. Without this
 * the dashboard's three-alert preview fills up with overlap notices and buries a
 * trial that converts in two days.
 */
const ALERT_PRIORITY: Record<string, number> = {
  charge_pending: 0,
  trial_converting: 1,
  price_increase: 2,
  renewal_reminder: 3,
  plan_payment_due: 4,
  duplicate_detected: 5,
  charge_declined: 6,
  charge_approved: 7,
};

function byPriority(a: { kind: string; createdAt: Date }, b: { kind: string; createdAt: Date }): number {
  const rank = (ALERT_PRIORITY[a.kind] ?? 9) - (ALERT_PRIORITY[b.kind] ?? 9);
  return rank !== 0 ? rank : b.createdAt.getTime() - a.createdAt.getTime();
}

export async function getDashboard(
  prisma: PrismaClient,
  customerId: string,
  today = new Date(),
) {
  const [safeToSpend, accounts, summary, alerts, plans, timeline] = await Promise.all([
    getSafeToSpend(prisma, customerId, today),
    prisma.account.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } }),
    subscriptionSummary(prisma, customerId),
    prisma.alert.findMany({
      where: { status: 'pending', subscription: { account: { customerId } } },
    }),
    prisma.installmentPlan.findMany({ where: { status: 'active', account: { customerId } } }),
    getTimeline(prisma, customerId, 45, today),
  ]);

  return {
    safeToSpend,
    accounts: accounts.map((a) => ({
      id: a.id,
      type: a.type,
      nickname: a.nickname,
      last4: a.last4,
      balanceCents: a.balanceCents,
      creditLimitCents: a.creditLimitCents,
      availableCreditCents:
        a.type === 'Credit Card' && a.creditLimitCents !== null
          ? a.creditLimitCents - a.balanceCents
          : null,
      rewardsCents: a.rewardsCents,
      isLocked: a.isLocked,
    })),
    subscriptions: summary,
    alerts: [...alerts].sort(byPriority).slice(0, 5).map(serializeAlert),
    activePlans: {
      count: plans.length,
      monthlyTotalCents: plans.reduce((sum, p) => sum + p.monthlyPaymentCents, 0),
      remainingCents: plans.reduce((sum, p) => sum + p.totalCostCents, 0),
    },
    timeline,
  };
}

export function serializeAlert(alert: {
  id: string;
  subscriptionId: string | null;
  kind: string;
  title: string;
  body: string;
  amountCents: number | null;
  status: string;
  occurrences: number;
  readAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: alert.id,
    subscriptionId: alert.subscriptionId,
    kind: alert.kind,
    title: alert.title,
    body: alert.body,
    amountCents: alert.amountCents,
    status: alert.status,
    occurrences: alert.occurrences,
    readAt: alert.readAt?.toISOString() ?? null,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
    /** A pending charge is the one alert type that needs a decision. */
    needsDecision: alert.status === 'pending' && alert.kind === 'charge_pending',
  };
}

export async function listAlerts(prisma: PrismaClient, customerId: string) {
  const alerts = await prisma.alert.findMany({
    where: { subscription: { account: { customerId } } },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });
  return [...alerts].sort(byPriority).map(serializeAlert);
}

export async function markAlertRead(prisma: PrismaClient, customerId: string, id: string) {
  await prisma.alert.updateMany({
    where: { id, subscription: { account: { customerId } } },
    data: { readAt: new Date() },
  });
  return listAlerts(prisma, customerId);
}

export async function unreadAlertCount(prisma: PrismaClient, customerId: string): Promise<number> {
  return prisma.alert.count({
    where: { readAt: null, subscription: { account: { customerId } } },
  });
}
