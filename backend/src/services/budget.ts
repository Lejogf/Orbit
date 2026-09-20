// Budgets, the "will I be OK?" forecast, and households.
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import {
  averageMonths,
  bucketFor,
  buildPlan,
  envelopeProgress,
  forecast,
  RULES,
  suggestEnvelopes,
  type Bucket,
  type BudgetMethod,
} from '../features/budget.js';
import { hashCode } from '../features/profileChange.js';
import { isSpending, monthWindow, type SpendTransaction } from '../features/spending.js';
import { getSafeToSpend } from './dashboard.js';

const MONTHS_OF_HISTORY = 6;

async function transactionsFor(prisma: PrismaClient, customerIds: string[], since: Date): Promise<SpendTransaction[]> {
  const rows = await prisma.transaction.findMany({
    where: { account: { customerId: { in: customerIds } }, postedAt: { gte: since } },
    include: { merchant: { select: { name: true } } },
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

/** Everyone whose money counts toward this budget: just me, or my household. */
export async function budgetScope(prisma: PrismaClient, customerId: string) {
  const membership = await prisma.householdMember.findFirst({
    where: { customerId },
    include: { household: { include: { members: { include: { customer: { select: { id: true, firstName: true } } } } } } },
  });
  if (!membership) return { customerIds: [customerId], household: null, size: 1 };

  const sharing = membership.household.members.filter((m) => m.sharesMoney);
  return {
    customerIds: sharing.map((m) => m.customerId),
    household: {
      id: membership.household.id,
      name: membership.household.name,
      role: membership.role,
      members: membership.household.members.map((m) => ({
        customerId: m.customerId,
        firstName: m.customer.firstName,
        role: m.role,
        sharesMoney: m.sharesMoney,
      })),
    },
    size: membership.household.members.length,
  };
}

export async function budgetOverview(prisma: PrismaClient, customerId: string, now = new Date()) {
  const scope = await budgetScope(prisma, customerId);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_OF_HISTORY, 1));

  const [record, transactions, safe, accounts] = await Promise.all([
    prisma.budget.findUnique({ where: { customerId }, include: { envelopes: true } }),
    transactionsFor(prisma, scope.customerIds, since),
    getSafeToSpend(prisma, customerId, now),
    prisma.account.findMany({ where: { customerId: { in: scope.customerIds } } }),
  ]);

  // Month-by-month income and spending, for the averages and the chart.
  const months = Array.from({ length: MONTHS_OF_HISTORY + 1 }, (_, i) => {
    const window = monthWindow(now, MONTHS_OF_HISTORY - i);
    const inWindow = transactions.filter((t) => t.postedAt >= window.start && t.postedAt < window.end);
    return {
      month: window.start.toISOString().slice(0, 7),
      incomeCents: inWindow.filter((t) => t.amountCents > 0 && t.category === 'Income').reduce((s, t) => s + t.amountCents, 0),
      spendCents: inWindow.filter(isSpending).reduce((s, t) => s + -t.amountCents, 0),
    };
  });

  const currentMonth = months.at(-1)!.month;
  const averages = averageMonths(months, currentMonth);
  const monthlyIncomeCents = record?.monthlyIncomeCents ?? averages.monthlyIncomeCents;

  // This month's spending, by bucket and by category.
  const thisMonth = transactions.filter(isSpending).filter((t) => t.postedAt.toISOString().slice(0, 7) === currentMonth);
  const actualByBucket = { needs: 0, wants: 0, savings: 0, debt: 0 } as Record<Bucket, number>;
  const spentByCategory = new Map<string, number>();
  for (const tx of thisMonth) {
    actualByBucket[bucketFor(tx.category)] += -tx.amountCents;
    spentByCategory.set(tx.category, (spentByCategory.get(tx.category) ?? 0) + -tx.amountCents);
  }

  const method = (record?.method ?? 'rule5030') as BudgetMethod;
  const plan = method === 'zero' || method === 'custom' ? [] : buildPlan(method, monthlyIncomeCents, actualByBucket);

  const envelopes = envelopeProgress(
    (record?.envelopes ?? []).map((envelope) => ({
      category: envelope.category,
      bucket: envelope.bucket as Bucket,
      plannedCents: envelope.plannedCents,
      spentCents: spentByCategory.get(envelope.category) ?? 0,
      limitCents: envelope.limitCents,
    })),
  );

  const savingsCents = accounts.filter((a) => a.type === 'Savings').reduce((s, a) => s + a.balanceCents, 0);

  return {
    method,
    rules: RULES,
    monthlyIncomeCents,
    incomeIsEstimated: record?.monthlyIncomeCents == null,
    averages,
    months,
    plan,
    envelopes,
    unassignedCents: monthlyIncomeCents - envelopes.reduce((s, e) => s + e.plannedCents, 0),
    forecast: forecast({
      availableCents: safe.checkingBalanceCents,
      committedCents: safe.committedCents,
      daysUntilPayday: safe.daysUntilPayday,
      monthlyIncomeCents,
      monthlySpendCents: averages.monthlySpendCents,
      savingsCents,
      householdSize: scope.size,
    }),
    household: scope.household,
    emergencyTargetMonths: record?.emergencyTargetMonths ?? 3,
    savingsCents,
  };
}

export async function saveBudget(
  prisma: PrismaClient,
  customerId: string,
  input: { method?: BudgetMethod; monthlyIncomeCents?: number | null; emergencyTargetMonths?: number },
) {
  const budget = await prisma.budget.upsert({
    where: { customerId },
    update: {
      ...(input.method ? { method: input.method } : {}),
      ...(input.monthlyIncomeCents !== undefined ? { monthlyIncomeCents: input.monthlyIncomeCents } : {}),
      ...(input.emergencyTargetMonths ? { emergencyTargetMonths: input.emergencyTargetMonths } : {}),
    },
    create: {
      customerId,
      method: input.method ?? 'rule5030',
      monthlyIncomeCents: input.monthlyIncomeCents ?? null,
      emergencyTargetMonths: input.emergencyTargetMonths ?? 3,
    },
  });
  return budget;
}

/** Pre-fills zero-based envelopes from what the customer actually spends. */
export async function envelopeSuggestions(prisma: PrismaClient, customerId: string, now = new Date()) {
  const scope = await budgetScope(prisma, customerId);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const transactions = (await transactionsFor(prisma, scope.customerIds, since)).filter(isSpending);

  const byCategory = new Map<string, number>();
  for (const tx of transactions) byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + -tx.amountCents);

  const overview = await budgetOverview(prisma, customerId, now);
  return suggestEnvelopes(
    [...byCategory.entries()].map(([category, cents]) => ({ category, cents, months: 3 })),
    overview.monthlyIncomeCents,
  );
}

export async function saveEnvelopes(
  prisma: PrismaClient,
  customerId: string,
  envelopes: { category: string; plannedCents: number; bucket?: Bucket; limitCents?: number | null }[],
) {
  const budget = await prisma.budget.upsert({
    where: { customerId },
    update: {},
    create: { customerId },
  });

  await prisma.$transaction([
    prisma.budgetEnvelope.deleteMany({ where: { budgetId: budget.id } }),
    prisma.budgetEnvelope.createMany({
      data: envelopes.map((envelope) => ({
        budgetId: budget.id,
        category: envelope.category,
        plannedCents: envelope.plannedCents,
        bucket: envelope.bucket ?? bucketFor(envelope.category),
        limitCents: envelope.limitCents ?? null,
      })),
    }),
  ]);

  return budgetOverview(prisma, customerId);
}

// --- households ---

/** A passkey that is easy to read aloud and hard to guess. */
function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(9);
  const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 9)}`;
}

export async function createHousehold(prisma: PrismaClient, customerId: string, name: string) {
  const existing = await prisma.householdMember.findFirst({ where: { customerId } });
  if (existing) throw new ApiError(409, 'ALREADY_IN_HOUSEHOLD', 'You are already part of a household.');

  const code = generateJoinCode();
  const salt = randomBytes(8).toString('hex');
  const household = await prisma.household.create({
    data: {
      name: name.slice(0, 60) || 'Our household',
      joinCodeHash: hashCode(code, salt),
      joinCodeSalt: salt,
      members: { create: { customerId, role: 'owner' } },
    },
  });

  // Shown once. We store only the hash, so it cannot be looked up later.
  return { household: { id: household.id, name: household.name }, joinCode: code };
}

export async function joinHousehold(prisma: PrismaClient, customerId: string, code: string, role: 'partner' | 'teen' | 'child') {
  const existing = await prisma.householdMember.findFirst({ where: { customerId } });
  if (existing) throw new ApiError(409, 'ALREADY_IN_HOUSEHOLD', 'You are already part of a household.');

  const normalised = code.trim().toUpperCase();
  const households = await prisma.household.findMany({ take: 200, orderBy: { createdAt: 'desc' } });
  const match = households.find((h) => hashCode(normalised, h.joinCodeSalt) === h.joinCodeHash);
  if (!match) throw new ApiError(404, 'BAD_CODE', "That code doesn't match a household. Check it with whoever shared it.");

  await prisma.householdMember.create({
    data: { householdId: match.id, customerId, role, sharesMoney: role !== 'child' },
  });
  return budgetOverview(prisma, customerId);
}

export async function leaveHousehold(prisma: PrismaClient, customerId: string) {
  const membership = await prisma.householdMember.findFirst({ where: { customerId } });
  if (!membership) throw ApiError.notFound('Household');
  await prisma.householdMember.delete({ where: { id: membership.id } });
  return budgetOverview(prisma, customerId);
}
