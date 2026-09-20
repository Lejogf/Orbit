// Pay Over Time service: quoting, affordability, creating plans and paying early.

import type { PrismaClient } from '@prisma/client';
import { nessie } from '../nessie/client.js';
import { centsToDollars } from '../lib/utils.js';
import {
  PRICING,
  buildSchedule,
  checkAffordability,
  checkEligibility,
  effectiveBand,
  previewCreditImpact,
  quote,
  quoteAll,
  type Term,
} from '../features/pricing.js';
import { monthlyObligations, monthlyIncome } from './money.js';
import { scoreForPricing } from './credit.js';
import type { InstallmentPlan } from '../domain/types.js';

/** Everything the plan picker needs for one purchase, in a single call. */
export async function quoteForTransaction(
  prisma: PrismaClient,
  customerId: string,
  transactionId: string,
) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, account: { customerId } },
    include: { merchant: true },
  });
  if (!transaction) return null;

  const [customer, account, activePlans] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.account.findUnique({ where: { id: transaction.accountId } }),
    prisma.installmentPlan.findMany({ where: { status: 'active', account: { customerId } } }),
  ]);

  const principalCents = Math.abs(transaction.amountCents);

  // Priced against the LIVE estimate rather than a stored number, so paying down
  // the card or stopping subscriptions actually changes the rate offered.
  const creditScore = await scoreForPricing(prisma, customerId);
  const band = effectiveBand(creditScore, customer?.missedPayments ?? 0);

  const totalFinancedCents = activePlans.reduce((sum, p) => sum + p.principalCents, 0);
  const eligibility = checkEligibility({
    purchaseCents: principalCents,
    activePlanCount: activePlans.length,
    totalFinancedCents,
  });

  const [incomeCents, obligationsCents] = await Promise.all([
    monthlyIncome(prisma, customerId),
    monthlyObligations(prisma, customerId),
  ]);

  const quotes = quoteAll(principalCents, band).map((q) => ({
    ...q,
    payoffDate: q.payoffDate.toISOString(),
    affordability: checkAffordability({
      monthlyIncomeCents: incomeCents,
      existingObligationsCents: obligationsCents,
      newPaymentCents: q.monthlyPaymentCents,
    }),
    creditImpact: previewCreditImpact({
      cardBalanceCents: account?.balanceCents ?? 0,
      cardLimitCents: account?.creditLimitCents ?? 0,
      principalCents,
      monthlyPaymentCents: q.monthlyPaymentCents,
      existingObligationsCents: obligationsCents,
    }),
  }));

  return {
    transaction: {
      id: transaction.id,
      merchantName: transaction.merchant?.name ?? transaction.description,
      description: transaction.description,
      amountCents: principalCents,
      postedAt: transaction.postedAt.toISOString(),
    },
    creditBand: band,
    creditScore,
    eligibility,
    monthlyIncomeCents: incomeCents,
    existingObligationsCents: obligationsCents,
    quotes,
  };
}

function toDomain(
  row: {
    id: string;
    accountId: string;
    transactionId: string | null;
    merchantName: string;
    description: string;
    principalCents: number;
    termMonths: number;
    monthlyFeeCents: number;
    aprPercent: number;
    monthlyPaymentCents: number;
    totalCostCents: number;
    totalInterestCents: number;
    creditBand: string;
    creditScoreAtOrigination: number | null;
    startDate: Date;
    payoffDate: Date;
    status: string;
    nessieLoanId: string | null;
  },
  payments: { id: string; sequence: number; dueDate: Date; amountCents: number; status: string; paidAt: Date | null }[],
): InstallmentPlan {
  return {
    id: row.id,
    accountId: row.accountId,
    transactionId: row.transactionId,
    merchantName: row.merchantName,
    description: row.description,
    principalCents: row.principalCents,
    termMonths: row.termMonths,
    monthlyFeeCents: row.monthlyFeeCents,
    aprPercent: row.aprPercent,
    monthlyPaymentCents: row.monthlyPaymentCents,
    totalCostCents: row.totalCostCents,
    totalInterestCents: row.totalInterestCents,
    creditBand: row.creditBand as InstallmentPlan['creditBand'],
    creditScoreAtOrigination: row.creditScoreAtOrigination,
    startDate: row.startDate.toISOString(),
    payoffDate: row.payoffDate.toISOString(),
    status: row.status as InstallmentPlan['status'],
    nessieLoanId: row.nessieLoanId,
    payments: payments
      .sort((a, b) => a.sequence - b.sequence)
      .map((p) => ({
        id: p.id,
        sequence: p.sequence,
        dueDate: p.dueDate.toISOString(),
        amountCents: p.amountCents,
        status: p.status as 'scheduled' | 'paid',
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
  };
}

export async function createPlan(
  prisma: PrismaClient,
  customerId: string,
  transactionId: string,
  termMonths: Term,
  now = new Date(),
): Promise<{ plan: InstallmentPlan } | { error: string }> {
  const context = await quoteForTransaction(prisma, customerId, transactionId);
  if (!context) return { error: 'Transaction not found.' };

  if (!context.eligibility.eligible) {
    return { error: context.eligibility.reasons.join(' ') };
  }

  const chosen = context.quotes.find((q) => q.termMonths === termMonths);
  if (!chosen) return { error: 'That term is not offered.' };
  if (!chosen.available) return { error: chosen.unavailableReason ?? 'That term is unavailable.' };
  if (!chosen.affordability.affordable) return { error: chosen.affordability.message };

  const existing = await prisma.installmentPlan.findFirst({
    where: { transactionId, status: 'active' },
  });
  if (existing) return { error: 'This purchase is already split into a plan.' };

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) return { error: 'Transaction not found.' };

  const priced = quote(context.transaction.amountCents, termMonths, context.creditBand, now);
  const schedule = buildSchedule(priced, now);

  const plan = await prisma.installmentPlan.create({
    data: {
      accountId: transaction.accountId,
      transactionId,
      merchantName: context.transaction.merchantName,
      description: context.transaction.description,
      principalCents: context.transaction.amountCents,
      termMonths,
      monthlyFeeCents: priced.monthlyFeeCents,
      aprPercent: priced.aprPercent,
      monthlyPaymentCents: priced.monthlyPaymentCents,
      totalCostCents: priced.totalCostCents,
      totalInterestCents: priced.totalInterestCents,
      creditBand: context.creditBand,
      creditScoreAtOrigination: context.creditScore,
      startDate: now,
      payoffDate: priced.payoffDate,
      status: 'active',
      payments: { create: schedule },
    },
    include: { payments: true },
  });

  // The purchase moves off the revolving balance into the plan.
  await prisma.account.update({
    where: { id: transaction.accountId },
    data: { balanceCents: { decrement: context.transaction.amountCents } },
  });

  await mirrorLoanToNessie(prisma, plan.id);

  const saved = await prisma.installmentPlan.findUnique({
    where: { id: plan.id },
    include: { payments: true },
  });

  return { plan: toDomain(saved!, saved!.payments) };
}

export async function listPlans(
  prisma: PrismaClient,
  customerId: string,
): Promise<InstallmentPlan[]> {
  const rows = await prisma.installmentPlan.findMany({
    where: { account: { customerId } },
    include: { payments: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => toDomain(row, row.payments));
}

export async function getPlan(
  prisma: PrismaClient,
  id: string,
  customerId?: string,
): Promise<InstallmentPlan | null> {
  const row = await prisma.installmentPlan.findFirst({
    where: { id, ...(customerId ? { account: { customerId } } : {}) },
    include: { payments: true },
  });
  return row ? toDomain(row, row.payments) : null;
}

/** Pays the next scheduled instalment. */
export async function payInstallment(prisma: PrismaClient, planId: string, now = new Date()) {
  const next = await prisma.installmentPayment.findFirst({
    where: { planId, status: 'scheduled' },
    orderBy: { sequence: 'asc' },
  });
  if (!next) return getPlan(prisma, planId);

  await prisma.installmentPayment.update({
    where: { id: next.id },
    data: { status: 'paid', paidAt: now },
  });

  // Money actually left the account, so record it and reduce what is owed.
  const plan = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  if (plan) {
    await prisma.transaction.create({
      data: {
        accountId: plan.accountId,
        source: 'withdrawal',
        amountCents: -next.amountCents,
        description: `${plan.merchantName} — payment ${next.sequence} of ${plan.termMonths}`,
        postedAt: now,
        category: 'Pay Over Time',
      },
    });
  }

  const remaining = await prisma.installmentPayment.count({
    where: { planId, status: 'scheduled' },
  });
  if (remaining === 0) {
    await prisma.installmentPlan.update({ where: { id: planId }, data: { status: 'paid_off' } });
    void markLoanPaidOffInNessie(prisma, planId);
  }

  return getPlan(prisma, planId);
}

/**
 * Pays everything outstanding at once. Only the principal still owed is due —
 * interest on months never used is waived, which is what "pay off early" should
 * mean.
 */
export async function payOffEarly(prisma: PrismaClient, planId: string, now = new Date()) {
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: planId },
    include: { payments: true },
  });
  if (!plan) return null;

  const outstanding = plan.payments.filter((p) => p.status === 'scheduled');
  const principalPerPayment = Math.round(plan.principalCents / plan.termMonths);
  const principalRemainingCents = principalPerPayment * outstanding.length;

  await prisma.installmentPayment.updateMany({
    where: { planId, status: 'scheduled' },
    data: { status: 'paid', paidAt: now },
  });

  await prisma.transaction.create({
    data: {
      accountId: plan.accountId,
      source: 'withdrawal',
      amountCents: -principalRemainingCents,
      description: `${plan.merchantName} — paid off early`,
      postedAt: now,
      category: 'Pay Over Time',
    },
  });

  await prisma.installmentPlan.update({ where: { id: planId }, data: { status: 'paid_off' } });
  void markLoanPaidOffInNessie(prisma, planId);

  return {
    plan: await getPlan(prisma, planId),
    paidCents: principalRemainingCents,
    interestSavedCents: outstanding.reduce((sum, p) => sum + p.amountCents, 0) - principalRemainingCents,
  };
}

/** Best-effort mirror of a plan into Nessie as a real loan. */
export async function mirrorLoanToNessie(prisma: PrismaClient, planId: string): Promise<boolean> {
  const plan = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  const account = plan ? await prisma.account.findUnique({ where: { id: plan.accountId } }) : null;
  if (!plan || !account?.nessieId || plan.nessieLoanId) return false;

  try {
    // Every field is required, and Nessie truncates money to whole dollars.
    const loan = await nessie.createLoan(account.nessieId, {
      type: 'installment',
      status: 'approved',
      credit_score: plan.creditScoreAtOrigination ?? 700,
      monthly_payment: centsToDollars(plan.monthlyPaymentCents),
      amount: centsToDollars(plan.principalCents),
      description: `Pay Over Time — ${plan.merchantName} (${plan.termMonths} months)`,
    });

    await prisma.installmentPlan.update({ where: { id: planId }, data: { nessieLoanId: loan._id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks the Nessie loan completed once a plan is paid off. Best-effort: a
 * failure upstream must never block the user's payment.
 */
export async function markLoanPaidOffInNessie(
  prisma: PrismaClient,
  planId: string,
): Promise<boolean> {
  const plan = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  if (!plan?.nessieLoanId) return false;

  try {
    await nessie.updateLoan(plan.nessieLoanId, { status: 'completed' });
    return true;
  } catch {
    return false;
  }
}

export { PRICING };
