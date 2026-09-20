// Gathers real account data into credit-score inputs, and runs what-if scenarios.

import type { PrismaClient } from '@prisma/client';
import {
  estimateScore,
  simulate,
  simulateCombined,
  type CreditInputs,
  type ScenarioId,
} from '../features/creditScore.js';
import { INSTALLMENT_ELIGIBILITY_MIN_CENTS } from '../data/demoDataset.js';

/** Whole months between two dates. */
function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()),
  );
}

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export async function creditInputsFor(
  prisma: PrismaClient,
  customerId: string,
  now = new Date(),
): Promise<CreditInputs> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  const accounts = await prisma.account.findMany({ where: { customerId } });
  const accountIds = accounts.map((a) => a.id);

  const [payments, plans, oldestTransaction] = await Promise.all([
    prisma.installmentPayment.findMany({
      where: { plan: { accountId: { in: accountIds } } },
    }),
    prisma.installmentPlan.findMany({ where: { accountId: { in: accountIds } } }),
    prisma.transaction.findFirst({
      where: { accountId: { in: accountIds } },
      orderBy: { postedAt: 'asc' },
    }),
  ]);

  const cards = accounts.filter((a) => a.type === 'Credit Card');

  // History starts at whichever we know about first: a recorded credit history
  // date, the oldest transaction, or failing both, when they joined.
  const historyStart =
    customer?.creditHistoryStartedAt ??
    oldestTransaction?.postedAt ??
    customer?.createdAt ??
    now;

  return {
    onTimePayments: payments.filter((p) => p.status === 'paid').length,
    missedPayments: customer?.missedPayments ?? 0,
    cardBalanceCents: cards.reduce((sum, c) => sum + Math.max(0, c.balanceCents), 0),
    cardLimitCents: cards.reduce((sum, c) => sum + (c.creditLimitCents ?? 0), 0),
    historyMonths: monthsBetween(historyStart, now),
    accountTypes: new Set(accounts.map((a) => a.type)).size,
    activeLoans: plans.filter((p) => p.status === 'active').length,
    recentlyOpened: plans.filter(
      (p) => now.getTime() - p.createdAt.getTime() < TWELVE_MONTHS_MS,
    ).length,
  };
}

/** Context the what-if scenarios need: what could actually be paid off or split. */
async function scenarioContext(prisma: PrismaClient, customerId: string) {
  const [stoppable, biggestEligible] = await Promise.all([
    prisma.subscription.findMany({
      where: {
        account: { customerId },
        status: { in: ['active', 'guarded'] },
        OR: [{ looksUnused: true }, { isDuplicate: true }],
      },
    }),
    prisma.transaction.findFirst({
      where: {
        account: { customerId },
        source: 'purchase',
        amountCents: { lte: -INSTALLMENT_ELIGIBILITY_MIN_CENTS },
      },
      orderBy: { amountCents: 'asc' },
    }),
  ]);

  return {
    blockableSubscriptionCents: stoppable.reduce((sum, s) => sum + s.amountCents, 0),
    splittablePurchaseCents: Math.abs(biggestEligible?.amountCents ?? 0),
    stoppableCount: stoppable.length,
    splittableMerchant: biggestEligible?.description ?? null,
    splittableTransactionId: biggestEligible?.id ?? null,
  };
}

export async function getCreditReport(
  prisma: PrismaClient,
  customerId: string,
  now = new Date(),
) {
  const inputs = await creditInputsFor(prisma, customerId, now);
  const context = await scenarioContext(prisma, customerId);
  const estimate = estimateScore(inputs);

  return {
    ...estimate,
    inputs,
    scenarios: simulate(inputs, context, estimate.score),
    context: {
      stoppableCount: context.stoppableCount,
      blockableSubscriptionCents: context.blockableSubscriptionCents,
      splittablePurchaseCents: context.splittablePurchaseCents,
      splittableMerchant: context.splittableMerchant,
      splittableTransactionId: context.splittableTransactionId,
    },
  };
}

/** Score after applying a chosen combination of scenarios. */
export async function simulateScenarios(
  prisma: PrismaClient,
  customerId: string,
  ids: ScenarioId[],
  now = new Date(),
) {
  const inputs = await creditInputsFor(prisma, customerId, now);
  const context = await scenarioContext(prisma, customerId);
  const current = estimateScore(inputs);
  const projected = simulateCombined(inputs, context, ids);

  return {
    current: { score: current.score, band: current.band },
    projected: {
      score: projected.score,
      band: projected.band,
      factors: projected.factors,
      utilization: projected.utilization,
    },
    delta: projected.score - current.score,
    applied: ids,
  };
}

/**
 * The score Pay Over Time should price against.
 *
 * Uses the live estimate rather than the stored figure, so the two features
 * agree: block a subscription or pay down the card and the APR you are offered
 * actually reflects it.
 */
export async function scoreForPricing(
  prisma: PrismaClient,
  customerId: string,
  now = new Date(),
): Promise<number> {
  return estimateScore(await creditInputsFor(prisma, customerId, now)).score;
}
