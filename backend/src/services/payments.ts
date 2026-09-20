// Paying people and bills, now or later — plus depositing a cheque by photo.
//
// A scheduled payment is a promise, not a movement: nothing leaves the account
// until its date arrives. `runDuePayments` is called whenever the customer
// looks at their money, so due payments settle even without a background job.

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { addDays, formatCents } from '../lib/utils.js';
import { raiseAlert } from './notify.js';
import { earnOnPurchase } from './rewards.js';

export type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';

/** US phone or email — what a Zelle-style transfer needs to reach someone. */
export function validHandle(handle: string): boolean {
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(trimmed);
  return trimmed.replace(/\D/g, '').length === 10;
}

export function formatHandle(handle: string): string {
  const digits = handle.replace(/\D/g, '');
  if (handle.includes('@') || digits.length !== 10) return handle.trim();
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function nextDate(from: Date, repeat: Repeat): Date | null {
  if (repeat === 'none') return null;
  if (repeat === 'weekly') return addDays(from, 7);
  if (repeat === 'biweekly') return addDays(from, 14);
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function listPayees(prisma: PrismaClient, customerId: string) {
  const payees = await prisma.payee.findMany({ where: { customerId }, orderBy: [{ lastPaidAt: 'desc' }, { name: 'asc' }] });
  return payees.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    handle: p.handle,
    displayHandle: formatHandle(p.handle),
    logoSlug: p.logoSlug,
    lastPaidAt: p.lastPaidAt?.toISOString() ?? null,
  }));
}

export async function savePayee(
  prisma: PrismaClient,
  customerId: string,
  input: { name: string; handle: string; kind?: 'person' | 'biller'; logoSlug?: string | null },
) {
  const kind = input.kind ?? 'person';
  if (kind === 'person' && !validHandle(input.handle)) {
    throw new ApiError(400, 'INVALID_HANDLE', 'Enter a 10-digit mobile number or an email address so they can be reached.', { field: 'handle' });
  }
  const existing = await prisma.payee.findFirst({ where: { customerId, handle: input.handle.trim() } });
  if (existing) return existing;

  return prisma.payee.create({
    data: { customerId, name: input.name.trim().slice(0, 60), handle: input.handle.trim(), kind, logoSlug: input.logoSlug ?? null },
  });
}

export interface PaymentRequest {
  payeeId?: string | null;
  name?: string;
  handle?: string;
  accountId: string;
  amountCents: number;
  memo?: string | null;
  direction: 'send' | 'request' | 'bill';
  /** ISO date. Today or later. */
  dueDate?: string | null;
  repeat?: Repeat;
}

export async function schedulePayment(prisma: PrismaClient, customerId: string, input: PaymentRequest, now = new Date()) {
  const account = await prisma.account.findFirst({ where: { id: input.accountId, customerId } });
  if (!account) throw ApiError.notFound('Account');
  if (input.amountCents <= 0) throw ApiError.badRequest('Enter an amount.');

  let payeeId = input.payeeId ?? null;
  if (!payeeId && input.name && input.handle) {
    const payee = await savePayee(prisma, customerId, {
      name: input.name,
      handle: input.handle,
      kind: input.direction === 'bill' ? 'biller' : 'person',
    });
    payeeId = payee.id;
  }
  if (!payeeId) throw ApiError.badRequest('Choose who to pay.');

  const owned = await prisma.payee.findFirst({ where: { id: payeeId, customerId } });
  if (!owned) throw ApiError.notFound('Payee');

  const due = input.dueDate ? new Date(`${input.dueDate.slice(0, 10)}T12:00:00.000Z`) : now;
  if (Number.isNaN(due.getTime())) throw ApiError.badRequest('Choose a valid date.');
  if (due.getTime() < now.getTime() - 86_400_000) throw ApiError.badRequest('Choose today or a future date.');

  // Sending money you don't have fails now rather than silently later.
  if (input.direction !== 'request' && due <= now && account.type !== 'Credit Card' && input.amountCents > account.balanceCents) {
    throw ApiError.badRequest(`That's more than the ${formatCents(account.balanceCents)} in ${account.nickname}.`);
  }

  const payment = await prisma.scheduledPayment.create({
    data: {
      customerId,
      payeeId,
      accountId: account.id,
      amountCents: input.amountCents,
      memo: input.memo?.slice(0, 140) ?? null,
      direction: input.direction,
      dueDate: due,
      repeat: input.repeat ?? 'none',
      status: 'scheduled',
    },
  });

  // Due today? Settle it straight away, so "send" means sent.
  if (due <= now) await settlePayment(prisma, payment.id, now);

  return listPayments(prisma, customerId);
}

/** Moves the money for one payment and schedules the next if it repeats. */
async function settlePayment(prisma: PrismaClient, paymentId: string, now: Date) {
  const payment = await prisma.scheduledPayment.findUnique({ where: { id: paymentId }, include: { payee: true } });
  if (!payment || payment.status !== 'scheduled') return;

  const account = await prisma.account.findUnique({ where: { id: payment.accountId } });
  if (!account) return;

  // A request is an ask, not a movement: it waits for the other person.
  if (payment.direction === 'request') {
    await prisma.scheduledPayment.update({ where: { id: payment.id }, data: { status: 'sent', sentAt: now } });
    await raiseAlert(prisma, {
      customerId: payment.customerId,
      kind: 'payment_requested',
      title: `Requested ${formatCents(payment.amountCents)} from ${payment.payee?.name ?? 'someone'}`,
      body: payment.memo ? `“${payment.memo}” — we'll tell you when they pay.` : "We'll tell you when they pay.",
      amountCents: payment.amountCents,
      href: '/pay',
    });
    return;
  }

  if (account.type !== 'Credit Card' && payment.amountCents > account.balanceCents) {
    await prisma.scheduledPayment.update({ where: { id: payment.id }, data: { status: 'failed' } });
    await raiseAlert(prisma, {
      customerId: payment.customerId,
      kind: 'payment_failed',
      title: `Payment to ${payment.payee?.name ?? 'payee'} didn't go through`,
      body: `${formatCents(payment.amountCents)} needed more than the ${formatCents(account.balanceCents)} in ${account.nickname}. Nothing was sent — you can retry any time.`,
      amountCents: payment.amountCents,
      href: '/pay',
    });
    return;
  }

  const description = payment.direction === 'bill' ? `${payment.payee?.name ?? 'Bill'} — bill payment` : `Sent to ${payment.payee?.name ?? 'payee'}`;

  const transaction = await prisma.transaction.create({
    data: {
      accountId: account.id,
      source: payment.direction === 'bill' ? 'purchase' : 'withdrawal',
      amountCents: -payment.amountCents,
      description,
      postedAt: now,
      category: payment.direction === 'bill' ? 'Utilities' : 'Transfer',
    },
  });

  await prisma.$transaction([
    prisma.account.update({
      where: { id: account.id },
      data: {
        balanceCents: account.type === 'Credit Card' ? { increment: payment.amountCents } : { decrement: payment.amountCents },
      },
    }),
    prisma.scheduledPayment.update({
      where: { id: payment.id },
      data: { status: 'sent', sentAt: now, transactionId: transaction.id },
    }),
    ...(payment.payeeId ? [prisma.payee.update({ where: { id: payment.payeeId }, data: { lastPaidAt: now } })] : []),
  ]);

  // Bills paid on a card earn points like any other purchase.
  if (payment.direction === 'bill' && account.type === 'Credit Card') {
    await earnOnPurchase(prisma, {
      customerId: payment.customerId,
      accountId: account.id,
      amountCents: payment.amountCents,
      category: 'Utilities',
      transactionId: transaction.id,
      merchant: payment.payee?.name ?? 'Bill',
    });
  }

  await raiseAlert(prisma, {
    customerId: payment.customerId,
    kind: 'payment_sent',
    title: `${formatCents(payment.amountCents)} sent to ${payment.payee?.name ?? 'payee'}`,
    body: payment.memo ? `“${payment.memo}”` : `From ${account.nickname} ••${account.last4}.`,
    amountCents: payment.amountCents,
    href: '/pay',
  });

  const next = nextDate(payment.dueDate, payment.repeat as Repeat);
  if (next) {
    await prisma.scheduledPayment.create({
      data: {
        customerId: payment.customerId,
        payeeId: payment.payeeId,
        accountId: payment.accountId,
        amountCents: payment.amountCents,
        memo: payment.memo,
        direction: payment.direction,
        dueDate: next,
        repeat: payment.repeat,
        status: 'scheduled',
      },
    });
  }
}

/** Settles anything that has come due. Cheap, and safe to call often. */
export async function runDuePayments(prisma: PrismaClient, customerId: string, now = new Date()) {
  const due = await prisma.scheduledPayment.findMany({
    where: { customerId, status: 'scheduled', dueDate: { lte: now } },
    orderBy: { dueDate: 'asc' },
    take: 25,
  });
  for (const payment of due) await settlePayment(prisma, payment.id, now);
  return due.length;
}

export async function listPayments(prisma: PrismaClient, customerId: string, now = new Date()) {
  await runDuePayments(prisma, customerId, now);
  const [payments, payees, accounts, deposits] = await Promise.all([
    prisma.scheduledPayment.findMany({
      where: { customerId },
      include: { payee: true },
      orderBy: [{ dueDate: 'desc' }],
      take: 40,
    }),
    listPayees(prisma, customerId),
    prisma.account.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } }),
    prisma.checkDeposit.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);

  return {
    payees,
    accounts: accounts.map((a) => ({ id: a.id, nickname: a.nickname, type: a.type, last4: a.last4, balanceCents: a.balanceCents })),
    upcoming: payments
      .filter((p) => p.status === 'scheduled')
      .map(serializePayment)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    history: payments.filter((p) => p.status !== 'scheduled').map(serializePayment),
    deposits: deposits.map((d) => ({
      id: d.id,
      amountCents: d.amountCents,
      status: d.status,
      availableOn: d.availableOn.toISOString(),
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

function serializePayment(payment: {
  id: string; amountCents: number; memo: string | null; direction: string; dueDate: Date; repeat: string;
  status: string; sentAt: Date | null; createdAt: Date; payee: { name: string; handle: string; kind: string; logoSlug: string | null } | null;
}) {
  return {
    id: payment.id,
    amountCents: payment.amountCents,
    memo: payment.memo,
    direction: payment.direction,
    dueDate: payment.dueDate.toISOString(),
    repeat: payment.repeat,
    status: payment.status,
    sentAt: payment.sentAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    payee: payment.payee ? { name: payment.payee.name, handle: formatHandle(payment.payee.handle), kind: payment.payee.kind, logoSlug: payment.payee.logoSlug } : null,
  };
}

export async function cancelPayment(prisma: PrismaClient, customerId: string, paymentId: string) {
  const result = await prisma.scheduledPayment.updateMany({
    where: { id: paymentId, customerId, status: 'scheduled' },
    data: { status: 'cancelled' },
  });
  if (result.count === 0) throw ApiError.notFound('Payment');
  return listPayments(prisma, customerId);
}

/** Marks a money request as received: the other person paid. */
export async function markRequestPaid(prisma: PrismaClient, customerId: string, paymentId: string, now = new Date()) {
  const payment = await prisma.scheduledPayment.findFirst({
    where: { id: paymentId, customerId, direction: 'request' },
    include: { payee: true },
  });
  if (!payment) throw ApiError.notFound('Request');
  if (payment.status === 'received') return listPayments(prisma, customerId);

  const account = await prisma.account.findFirst({ where: { customerId, type: 'Checking' } });
  if (account) {
    await prisma.$transaction([
      prisma.account.update({ where: { id: account.id }, data: { balanceCents: { increment: payment.amountCents } } }),
      prisma.transaction.create({
        data: {
          accountId: account.id,
          source: 'deposit',
          amountCents: payment.amountCents,
          description: `${payment.payee?.name ?? 'Someone'} paid you`,
          postedAt: now,
          category: 'Transfer',
        },
      }),
    ]);
  }

  await prisma.scheduledPayment.update({ where: { id: payment.id }, data: { status: 'received' } });
  await raiseAlert(prisma, {
    customerId,
    kind: 'payment_received',
    title: `${payment.payee?.name ?? 'Someone'} paid you ${formatCents(payment.amountCents)}`,
    body: 'It is in your checking account now.',
    amountCents: payment.amountCents,
    href: '/pay',
  });

  return listPayments(prisma, customerId);
}

// --- cheque deposit ---

/** Banks hold part of a cheque; this mirrors that rather than pretending. */
export const CHECK_HOLD_DAYS = 2;
export const CHECK_LIMIT_CENTS = 500_000;

export async function depositCheck(
  prisma: PrismaClient,
  customerId: string,
  input: { accountId: string; amountCents: number; frontName?: string; backName?: string },
  now = new Date(),
) {
  const account = await prisma.account.findFirst({ where: { id: input.accountId, customerId } });
  if (!account) throw ApiError.notFound('Account');
  if (account.type === 'Credit Card') throw ApiError.badRequest('Cheques go into checking or savings.');
  if (input.amountCents <= 0) throw ApiError.badRequest('Enter the amount written on the cheque.');
  if (input.amountCents > CHECK_LIMIT_CENTS) {
    throw ApiError.badRequest(`Mobile deposits are capped at ${formatCents(CHECK_LIMIT_CENTS)}. A specialist can help with larger cheques.`);
  }
  if (!input.frontName || !input.backName) {
    throw ApiError.badRequest('We need a photo of both the front and the back, signed.');
  }

  const availableOn = addDays(now, CHECK_HOLD_DAYS);
  const deposit = await prisma.checkDeposit.create({
    data: {
      customerId,
      accountId: account.id,
      amountCents: input.amountCents,
      availableOn,
      frontName: input.frontName.slice(0, 120),
      backName: input.backName.slice(0, 120),
    },
  });

  await raiseAlert(prisma, {
    customerId,
    kind: 'check_deposited',
    title: `Cheque for ${formatCents(input.amountCents)} received`,
    body: `It will be in ${account.nickname} by ${availableOn.toLocaleDateString('en-US', { weekday: 'long' })}. Keep the paper cheque until then.`,
    amountCents: input.amountCents,
    href: '/pay',
  });

  return deposit;
}

/** Releases cheques whose hold has passed. Called alongside due payments. */
export async function releaseHeldChecks(prisma: PrismaClient, customerId: string, now = new Date()) {
  const ready = await prisma.checkDeposit.findMany({ where: { customerId, status: 'pending', availableOn: { lte: now } } });
  for (const deposit of ready) {
    await prisma.$transaction([
      prisma.account.update({ where: { id: deposit.accountId }, data: { balanceCents: { increment: deposit.amountCents } } }),
      prisma.transaction.create({
        data: {
          accountId: deposit.accountId,
          source: 'deposit',
          amountCents: deposit.amountCents,
          description: 'Cheque deposit',
          postedAt: now,
          category: 'Income',
        },
      }),
      prisma.checkDeposit.update({ where: { id: deposit.id }, data: { status: 'available' } }),
    ]);
  }
  return ready.length;
}
