// Shared money queries used by both the plan and dashboard services.

import type { PrismaClient } from '@prisma/client';
import { addDays, daysBetween } from '../lib/utils.js';

/** Recent paycheck deposits, newest last. */
export async function paydayHistory(
  prisma: PrismaClient,
  customerId: string,
  limit = 6,
): Promise<Date[]> {
  const deposits = await prisma.transaction.findMany({
    where: { source: 'deposit', category: 'Income', account: { customerId } },
    orderBy: { postedAt: 'desc' },
    take: limit,
  });
  return deposits.map((d) => d.postedAt).reverse();
}

/**
 * Monthly income inferred from paycheck cadence, rather than assuming a schedule.
 * Biweekly pay is 26 cheques a year, not 24, and that difference matters when
 * affordability is a percentage of income.
 */
export async function monthlyIncome(prisma: PrismaClient, customerId: string): Promise<number> {
  const deposits = await prisma.transaction.findMany({
    where: { source: 'deposit', category: 'Income', account: { customerId } },
    orderBy: { postedAt: 'desc' },
    take: 6,
  });
  if (deposits.length === 0) return 0;

  const average = Math.round(
    deposits.reduce((sum, d) => sum + d.amountCents, 0) / deposits.length,
  );
  if (deposits.length < 2) return average;

  const span = daysBetween(deposits[deposits.length - 1]!.postedAt, deposits[0]!.postedAt);
  const cadence = span / (deposits.length - 1);
  if (cadence <= 0) return average;

  return Math.round((average * 365) / 12 / cadence);
}

/** Everything committed each month: live subscriptions plus active plan payments. */
export async function monthlyObligations(
  prisma: PrismaClient,
  customerId: string,
): Promise<number> {
  const [subscriptions, plans] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: { in: ['active', 'guarded'] }, account: { customerId } },
    }),
    prisma.installmentPlan.findMany({ where: { status: 'active', account: { customerId } } }),
  ]);

  const subscriptionCents = subscriptions.reduce((sum, s) => {
    if (s.frequency === 'weekly') return sum + Math.round((s.amountCents * 52) / 12);
    if (s.frequency === 'yearly') return sum + Math.round(s.amountCents / 12);
    return sum + s.amountCents;
  }, 0);

  const planCents = plans.reduce((sum, p) => sum + p.monthlyPaymentCents, 0);

  // Recurring non-card commitments (rent) show up as withdrawals, not subscriptions.
  const rent = await prisma.transaction.findFirst({
    where: { source: 'withdrawal', category: 'Housing', account: { customerId } },
    orderBy: { postedAt: 'desc' },
  });

  return subscriptionCents + planCents + Math.abs(rent?.amountCents ?? 0);
}

/** Upcoming instalments across all active plans, for the timeline. */
export async function upcomingInstallments(
  prisma: PrismaClient,
  customerId: string,
  daysAhead = 60,
) {
  const payments = await prisma.installmentPayment.findMany({
    where: {
      status: 'scheduled',
      dueDate: { lte: addDays(new Date(), daysAhead) },
      plan: { account: { customerId } },
    },
    include: { plan: true },
    orderBy: { dueDate: 'asc' },
  });

  return payments
    .filter((p) => p.plan.status === 'active')
    .map((p) => ({
      id: p.id,
      label: `${p.plan.merchantName} — payment ${p.sequence} of ${p.plan.termMonths}`,
      amountCents: p.amountCents,
      dueDate: p.dueDate,
    }));
}
