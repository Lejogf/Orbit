// Shared bills: save a split, send the requests, and record repayments.
//
// A friend paying back lands in checking as a real deposit, so Safe to Spend
// rises the moment they pay — the split isn't a separate ledger, it's money.

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { formatCents } from '../lib/utils.js';
import { splitBill, splitEvenly, type ReceiptItem, type SplitPerson } from '../features/receipt.js';
import { raiseAlert } from './notify.js';

export interface SplitRequest {
  title: string;
  people: (SplitPerson & { contact?: string | null; isSelf?: boolean })[];
  mode: 'items' | 'even';
  items: ReceiptItem[];
  assignments: Record<string, string[]>;
  taxCents: number;
  tipCents: number;
  totalCents?: number;
  extrasMode?: 'proportional' | 'even';
  transactionId?: string | null;
}

export function computeShares(input: SplitRequest) {
  if (input.mode === 'even') {
    const total = input.totalCents ?? input.items.reduce((s, i) => s + i.cents, 0) + input.taxCents + input.tipCents;
    return splitEvenly(total, input.people);
  }
  return splitBill({
    items: input.items,
    people: input.people,
    assignments: input.assignments,
    taxCents: input.taxCents,
    tipCents: input.tipCents,
    extrasMode: input.extrasMode,
  });
}

export async function saveSplit(prisma: PrismaClient, customerId: string, input: SplitRequest) {
  if (input.people.length < 2) throw ApiError.badRequest('Add at least one other person to split with.');
  if (!input.people.some((p) => p.isSelf)) throw ApiError.badRequest('Include yourself in the split.');

  if (input.transactionId) {
    const owned = await prisma.transaction.findFirst({ where: { id: input.transactionId, account: { customerId } } });
    if (!owned) throw ApiError.notFound('Transaction');
  }

  const shares = computeShares(input);
  const total = shares.reduce((s, p) => s + p.totalCents, 0);
  const people = new Map(input.people.map((p) => [p.id, p]));

  const split = await prisma.billSplit.create({
    data: {
      customerId,
      title: input.title.slice(0, 120) || 'Shared bill',
      totalCents: total,
      transactionId: input.transactionId ?? null,
      details: JSON.stringify({ items: input.items, assignments: input.assignments, taxCents: input.taxCents, tipCents: input.tipCents, mode: input.mode }),
      shares: {
        create: shares.map((share) => {
          const person = people.get(share.personId);
          const isSelf = Boolean(person?.isSelf);
          return {
            name: share.name,
            contact: isSelf ? null : person?.contact ?? null,
            amountCents: share.totalCents,
            isSelf,
            status: isSelf ? 'self' : 'requested',
          };
        }),
      },
    },
    include: { shares: true },
  });

  const owed = split.shares.filter((s) => !s.isSelf);
  await raiseAlert(prisma, {
    customerId,
    kind: 'split_requested',
    title: `Requests sent for ${split.title}`,
    body: `${owed.map((s) => `${s.name} ${formatCents(s.amountCents)}`).join(', ')}. We'll tell you when each one pays.`,
    href: '/split',
  });

  return split;
}

export async function listSplits(prisma: PrismaClient, customerId: string) {
  return prisma.billSplit.findMany({
    where: { customerId },
    include: { shares: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

/** Records a repayment as a deposit into checking. */
export async function markSharePaid(prisma: PrismaClient, customerId: string, shareId: string) {
  const share = await prisma.splitShare.findFirst({
    where: { id: shareId, split: { customerId } },
    include: { split: true },
  });
  if (!share) throw ApiError.notFound('Request');
  if (share.status !== 'requested') return share;

  const checking = await prisma.account.findFirst({ where: { customerId, type: 'Checking' } });
  const now = new Date();

  await prisma.$transaction([
    prisma.splitShare.update({ where: { id: share.id }, data: { status: 'paid', paidAt: now } }),
    ...(checking
      ? [
          prisma.account.update({ where: { id: checking.id }, data: { balanceCents: { increment: share.amountCents } } }),
          prisma.transaction.create({
            data: {
              accountId: checking.id,
              source: 'deposit',
              amountCents: share.amountCents,
              description: `${share.name} paid you — ${share.split.title}`,
              postedAt: now,
              category: 'Transfer',
            },
          }),
        ]
      : []),
  ]);

  await raiseAlert(prisma, {
    customerId,
    kind: 'split_paid',
    title: `${share.name} paid you ${formatCents(share.amountCents)}`,
    body: `For ${share.split.title}. It's in your checking account now.`,
    amountCents: share.amountCents,
    href: '/split',
  });

  return prisma.splitShare.findUniqueOrThrow({ where: { id: share.id } });
}
