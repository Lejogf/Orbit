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
import { raiseAlert } from './notify.js';
import { budgetHistory, budgetTrend, recordActivity, saveBudgetSnapshot } from './documents.js';
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

  const projection = forecast({
    availableCents: safe.checkingBalanceCents,
    committedCents: safe.committedCents,
    daysUntilPayday: safe.daysUntilPayday,
    monthlyIncomeCents,
    monthlySpendCents: averages.monthlySpendCents,
    savingsCents,
    householdSize: scope.size,
  });

  // Mirror this month's plan into Atlas, so the plan has a history rather than
  // just a current state. Fire and forget: the page does not wait on it, and a
  // cluster that is down costs the history, not the screen.
  void saveBudgetSnapshot({
    customerId,
    month: now.toISOString().slice(0, 7),
    method,
    monthlyIncomeCents,
    safeDailyCents: projection.safeDailyCents,
    surplusCents: projection.monthlySurplusCents,
    runwayMonths: projection.runwayMonths,
    // `custom` and `zero` have no fixed rule, which is exactly why this is a
    // document: the shape genuinely differs per method.
    plan: { rules: method in RULES ? RULES[method as keyof typeof RULES] : null, buckets: plan },
    envelopes: envelopes.map((e) => ({ name: e.category, plannedCents: e.plannedCents, spentCents: e.spentCents })),
    householdSize: scope.size,
  });

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
    forecast: projection,
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

// --- invites by username -------------------------------------------------
//
// The passkey works when you are in the same room as the other person. It does
// not work for a partner at work, or a parent adding a teenager who has their
// own phone — and reading a nine-character code down the phone is exactly the
// kind of thing a scammer can talk someone into.
//
// So a household can also be joined by name: the owner invites a username, and
// that person sees the invite next time they open Orbit and accepts or declines
// it. Sharing a budget means sharing what you earn and what you spend, so it is
// always offered, never done to someone.

/** The roles an invite may carry. `owner` is not one of them. */
export type InviteRole = 'partner' | 'teen' | 'child';

function inviteSummary(invite: {
  id: string;
  role: string;
  status: string;
  note: string | null;
  createdAt: Date;
  household: { id: string; name: string };
  customer: { firstName: string; lastName: string; username: string | null };
  invitedBy: { firstName: string; lastName: string };
}) {
  return {
    id: invite.id,
    role: invite.role,
    status: invite.status,
    note: invite.note,
    createdAt: invite.createdAt.toISOString(),
    household: invite.household,
    /** Who it is for, as the sender should see them. */
    to: {
      name: `${invite.customer.firstName} ${invite.customer.lastName}`,
      username: invite.customer.username,
    },
    from: `${invite.invitedBy.firstName} ${invite.invitedBy.lastName}`,
  };
}

const INVITE_INCLUDE = {
  household: { select: { id: true, name: true } },
  customer: { select: { firstName: true, lastName: true, username: true } },
  invitedBy: { select: { firstName: true, lastName: true } },
} as const;

/**
 * Invite someone to this household by their Orbit username.
 *
 * A note on the error messages: "no such username" tells an attacker which
 * usernames exist. The alternative — always saying "if they exist, they'll see
 * it" — makes a typo indistinguishable from success, and someone waiting for a
 * partner who never got an invite has no way to find out why. Every consumer
 * payments network resolves this the same way we do: confirm the name so the
 * sender can check it is the right person. The exposure is a username and a
 * display name, which is what a username is for.
 */
export async function inviteToHousehold(
  prisma: PrismaClient,
  customerId: string,
  input: { username: string; role: InviteRole; note?: string },
) {
  const membership = await prisma.householdMember.findFirst({ where: { customerId } });
  if (!membership) {
    throw new ApiError(400, 'NO_HOUSEHOLD', 'Create a household first, then invite the people in it.');
  }
  if (membership.role !== 'owner') {
    throw new ApiError(403, 'NOT_OWNER', 'Only the person who set up the household can invite others.');
  }

  const username = input.username.trim().replace(/^@/, '').toLowerCase();
  if (!username) throw ApiError.badRequest('Type the username of the person you want to add.');

  const invitee = await prisma.customer.findFirst({ where: { username } });
  if (!invitee) {
    throw new ApiError(404, 'NO_SUCH_USER', `No Orbit account uses the username “${username}”. Check the spelling with them.`);
  }
  if (invitee.id === customerId) throw ApiError.badRequest('You are already in this household.');
  if (invitee.closedAt) throw new ApiError(400, 'ACCOUNT_CLOSED', 'That account has been closed.');

  const alreadyIn = await prisma.householdMember.findFirst({ where: { customerId: invitee.id } });
  if (alreadyIn) {
    throw new ApiError(
      409,
      'ALREADY_IN_HOUSEHOLD',
      alreadyIn.householdId === membership.householdId
        ? `${invitee.firstName} is already in your household.`
        : `${invitee.firstName} is already part of another household. They can leave it and then accept your invite.`,
    );
  }

  // Re-inviting reuses the row rather than stacking invitations, so declining
  // once does not leave a pile of duplicates behind.
  const invite = await prisma.householdInvite.upsert({
    where: { householdId_customerId: { householdId: membership.householdId, customerId: invitee.id } },
    update: { role: input.role, note: input.note?.slice(0, 200) ?? null, status: 'pending', respondedAt: null, createdAt: new Date() },
    create: {
      householdId: membership.householdId,
      customerId: invitee.id,
      invitedById: customerId,
      role: input.role,
      note: input.note?.slice(0, 200) ?? null,
    },
    include: INVITE_INCLUDE,
  });

  void recordActivity(customerId, 'household_invite_sent', `Invited @${username} to ${invite.household.name}`);
  const inviter = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  await raiseAlert(prisma, {
    customerId: invitee.id,
    kind: 'household_invite',
    title: `${inviter.firstName} invited you to share a budget`,
    body: `Joining “${invite.household.name}” means you both see the same plan, and the money you each have counts toward it. You can leave at any time.`,
    href: '/budget',
  });

  return inviteSummary(invite);
}

/** Invites addressed to me, and — if I own a household — the ones I have sent. */
export async function householdInvites(prisma: PrismaClient, customerId: string) {
  const [received, sent] = await Promise.all([
    prisma.householdInvite.findMany({
      where: { customerId, status: 'pending' },
      include: INVITE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.householdInvite.findMany({
      where: { invitedById: customerId },
      include: INVITE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  return { received: received.map(inviteSummary), sent: sent.map(inviteSummary) };
}

/** Accept or decline an invite addressed to me. */
export async function respondToInvite(
  prisma: PrismaClient,
  customerId: string,
  inviteId: string,
  accept: boolean,
) {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, customerId },
    include: INVITE_INCLUDE,
  });
  if (!invite) throw ApiError.notFound('Invitation');
  if (invite.status !== 'pending') throw ApiError.badRequest('You have already answered that invitation.');

  if (!accept) {
    await prisma.householdInvite.update({
      where: { id: inviteId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    await raiseAlert(prisma, {
      customerId: invite.invitedById,
      kind: 'household_invite',
      title: `${invite.customer.firstName} ${invite.customer.lastName} declined your household invite`,
      body: 'Nothing was shared. You can invite them again any time.',
      href: '/budget',
    });
    return budgetOverview(prisma, customerId);
  }

  const alreadyIn = await prisma.householdMember.findFirst({ where: { customerId } });
  if (alreadyIn) throw new ApiError(409, 'ALREADY_IN_HOUSEHOLD', 'You are already part of a household. Leave that one first.');

  const role = invite.role as InviteRole;
  await prisma.$transaction([
    prisma.householdMember.create({
      data: {
        householdId: invite.household.id,
        customerId,
        role,
        // A child's accounts are visible in the plan but do not fund it.
        sharesMoney: role !== 'child',
      },
    }),
    prisma.householdInvite.update({ where: { id: inviteId }, data: { status: 'accepted', respondedAt: new Date() } }),
  ]);

  void recordActivity(customerId, 'household_joined', `Joined ${invite.household.name} as ${role}`);
  await raiseAlert(prisma, {
    customerId: invite.invitedById,
    kind: 'household_invite',
    title: `${invite.customer.firstName} ${invite.customer.lastName} joined ${invite.household.name}`,
    body: 'Your budget now covers both of you. Either of you can leave at any time.',
    href: '/budget',
  });

  return budgetOverview(prisma, customerId);
}

/** Withdraw an invite I sent. */
export async function cancelInvite(prisma: PrismaClient, customerId: string, inviteId: string) {
  const invite = await prisma.householdInvite.findFirst({ where: { id: inviteId, invitedById: customerId } });
  if (!invite) throw ApiError.notFound('Invitation');
  await prisma.householdInvite.update({
    where: { id: inviteId },
    data: { status: 'cancelled', respondedAt: new Date() },
  });
  return householdInvites(prisma, customerId);
}
