// Subscription service: runs detection against the mirror, persists results, and
// carries out the Guard, virtual-card and alert actions.

import { notifyCharge } from './notify.js';
import { earnOnPurchase } from './rewards.js';
import type { PrismaClient } from '@prisma/client';
import { nessie } from '../nessie/client.js';
import { centsToDollars, addDays, daysBetween, startOfDay, toIsoDate } from '../lib/utils.js';
import {
  detectSubscriptions,
  toMonthlyCents,
  toYearlyCents,
  type ChargeInput,
} from '../features/detection.js';
import { approvalExpiry, evaluateCharge, generateVirtualCard } from '../features/guard.js';
import type { Subscription, SubscriptionStatus } from '../domain/types.js';

/** No engagement for this long and a subscription is treated as unused. */
const UNUSED_AFTER_DAYS = 90;

/** How soon a trial conversion is worth alerting about. */
const TRIAL_WARNING_DAYS = 7;

/**
 * Re-runs detection and reconciles the Subscription table.
 *
 * User decisions are preserved: status, guard rules, virtual cards and reminders
 * all survive a refresh. Only the detected facts (amount, cadence, next date,
 * flags) are overwritten.
 */
export async function refreshSubscriptions(
  prisma: PrismaClient,
  customerId: string,
  today = new Date(),
) {
  const card = await prisma.account.findFirst({
    where: { type: 'Credit Card', customerId },
  });
  if (!card) return [];

  const purchases = await prisma.transaction.findMany({
    where: { accountId: card.id, source: 'purchase', merchantId: { not: null } },
    include: { merchant: true },
    orderBy: { postedAt: 'asc' },
  });

  const charges: ChargeInput[] = purchases.map((t) => ({
    id: t.id,
    merchantId: t.merchantId!,
    merchantName: t.merchant?.name ?? t.description,
    category: t.merchant?.category ?? t.category,
    amountCents: Math.abs(t.amountCents),
    postedAt: t.postedAt,
  }));

  const detected = detectSubscriptions(charges, today);
  const merchants = new Map((await prisma.merchant.findMany()).map((m) => [m.id, m]));

  for (const found of detected) {
    const merchant = merchants.get(found.merchantId);

    // Nessie gives us no usage data, so this comes from the seeded signal.
    const lastUsedAt = merchant?.lastUsedAt ?? null;
    const looksUnused =
      lastUsedAt !== null && daysBetween(lastUsedAt, startOfDay(today)) > UNUSED_AFTER_DAYS;

    // A $0 trial authorisation can't reveal what it will charge, so fall back to
    // the merchant's published price.
    const amountCents =
      found.isFreeTrial && found.amountCents === 0
        ? (merchant?.trialConvertsToCents ?? 0)
        : found.amountCents;

    const detectedFields = {
      merchantName: found.merchantName,
      category: found.category,
      amountCents,
      frequency: found.frequency,
      intervalDays: found.intervalDays,
      nextChargeDate: found.nextChargeDate,
      lastChargeDate: found.lastChargeDate,
      confidence: found.confidence,
      hasPriceIncrease: found.hasPriceIncrease,
      previousAmountCents: found.previousAmountCents,
      isFreeTrial: found.isFreeTrial,
      isDuplicate: found.isDuplicate,
      looksUnused,
      lastUsedAt,
    };

    const subscription = await prisma.subscription.upsert({
      where: { accountId_merchantId: { accountId: card.id, merchantId: found.merchantId } },
      // Status is deliberately absent here: a refresh must never undo a block.
      update: detectedFields,
      create: { accountId: card.id, merchantId: found.merchantId, ...detectedFields },
    });

    // Link the charges that make up this subscription, for the detail view.
    await prisma.transaction.updateMany({
      where: { id: { in: found.transactionIds } },
      data: { subscriptionId: subscription.id },
    });

    // Keep an existing bill's amount and next date current after re-detection.
    if (subscription.nessieBillId) void syncBillToNessie(prisma, subscription.id);
  }

  await syncDetectionAlerts(prisma, card.id, today);
  return listSubscriptions(prisma, customerId);
}

/**
 * Creates the alerts that come from detection itself — a trial about to convert,
 * a price rise, overlapping services. Idempotent: an existing unresolved alert of
 * the same kind for the same subscription is left alone rather than duplicated.
 */
/** "September 21" — friendlier than an ISO date in alert copy. */
function humanDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function syncDetectionAlerts(
  prisma: PrismaClient,
  accountId: string,
  today: Date,
): Promise<void> {
  const subscriptions = await prisma.subscription.findMany({ where: { accountId } });

  for (const sub of subscriptions) {
    const daysAway = daysBetween(startOfDay(today), startOfDay(sub.nextChargeDate));

    if (sub.isFreeTrial && daysAway >= 0 && daysAway <= TRIAL_WARNING_DAYS) {
      await ensureAlert(prisma, sub.id, 'trial_converting', {
        title: `${sub.merchantName} free trial converts in ${daysAway} ${daysAway === 1 ? 'day' : 'days'}`,
        body:
          sub.amountCents > 0
            ? `It becomes a paid subscription at $${centsToDollars(sub.amountCents).toFixed(2)} on ${humanDate(sub.nextChargeDate)}. Turn on Subscription Guard to be asked before that first charge.`
            : `Your trial ends on ${humanDate(sub.nextChargeDate)}. Turn on Subscription Guard to be asked before the first charge.`,
        amountCents: sub.amountCents > 0 ? sub.amountCents : null,
      });
    }

    if (sub.hasPriceIncrease && sub.previousAmountCents) {
      const rise = sub.amountCents - sub.previousAmountCents;
      await ensureAlert(prisma, sub.id, 'price_increase', {
        title: `${sub.merchantName} raised its price`,
        body: `${sub.merchantName} went from $${centsToDollars(sub.previousAmountCents).toFixed(2)} to $${centsToDollars(sub.amountCents).toFixed(2)} — $${centsToDollars(rise * 12).toFixed(2)} more per year.`,
        amountCents: sub.amountCents,
      });
    }

  }

  await syncDuplicateAlerts(prisma, subscriptions);
}

/**
 * One alert per overlapping CATEGORY, not per subscription — otherwise a pair of
 * streaming services produces two identical "you have two streaming services"
 * entries in the inbox. The alert hangs off the priciest of the pair, since that
 * is the one worth cancelling.
 */
async function syncDuplicateAlerts(
  prisma: PrismaClient,
  subscriptions: { id: string; category: string; merchantName: string; amountCents: number; isDuplicate: boolean; status: string }[],
): Promise<void> {
  const byCategory = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    // A blocked or cancelled service no longer overlaps with anything.
    if (!sub.isDuplicate || (sub.status !== 'active' && sub.status !== 'guarded')) continue;
    const group = byCategory.get(sub.category) ?? [];
    group.push(sub);
    byCategory.set(sub.category, group);
  }

  const representatives = new Set<string>();

  for (const [category, group] of byCategory) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => b.amountCents - a.amountCents);
    const representative = sorted[0]!;
    representatives.add(representative.id);

    const names = sorted.map((s) => s.merchantName);
    const combined = sorted.reduce((sum, s) => sum + s.amountCents, 0);

    await ensureAlert(prisma, representative.id, 'duplicate_detected', {
      title: `You're paying for ${group.length} ${category} services`,
      body: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} together cost $${centsToDollars(combined).toFixed(2)} a month. Cancelling one could save you $${centsToDollars(sorted[sorted.length - 1]!.amountCents * 12).toFixed(2)} a year.`,
      amountCents: combined,
    });
  }

  // Clear overlap alerts that no longer apply — the user blocked one, or the
  // representative changed. Scoped to this customer's subscriptions.
  await prisma.alert.deleteMany({
    where: {
      kind: 'duplicate_detected',
      subscriptionId:
        representatives.size > 0
          ? { notIn: [...representatives], in: subscriptions.map((s) => s.id) }
          : { in: subscriptions.map((s) => s.id) },
    },
  });
}

async function ensureAlert(
  prisma: PrismaClient,
  subscriptionId: string,
  kind: string,
  content: { title: string; body: string; amountCents: number | null },
): Promise<void> {
  const existing = await prisma.alert.findFirst({ where: { subscriptionId, kind } });
  if (existing) {
    // Keep the wording current (the days-until count changes) without
    // resurrecting an alert the user already dealt with.
    await prisma.alert.update({ where: { id: existing.id }, data: content });
    return;
  }
  await prisma.alert.create({ data: { subscriptionId, kind, ...content, status: 'pending' } });
}

function toDomain(row: {
  id: string;
  accountId: string;
  merchantId: string;
  merchantName: string;
  category: string;
  amountCents: number;
  frequency: string;
  intervalDays: number;
  nextChargeDate: Date;
  lastChargeDate: Date;
  confidence: number;
  status: string;
  hasPriceIncrease: boolean;
  previousAmountCents: number | null;
  isFreeTrial: boolean;
  isDuplicate: boolean;
  looksUnused: boolean;
  nessieBillId: string | null;
}): Subscription {
  const frequency = row.frequency as Subscription['frequency'];
  return {
    id: row.id,
    accountId: row.accountId,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    category: row.category,
    amountCents: row.amountCents,
    frequency,
    intervalDays: row.intervalDays,
    nextChargeDate: row.nextChargeDate.toISOString(),
    lastChargeDate: row.lastChargeDate.toISOString(),
    confidence: row.confidence,
    status: row.status as SubscriptionStatus,
    hasPriceIncrease: row.hasPriceIncrease,
    previousAmountCents: row.previousAmountCents,
    isFreeTrial: row.isFreeTrial,
    isDuplicate: row.isDuplicate,
    looksUnused: row.looksUnused,
    nessieBillId: row.nessieBillId,
    monthlyCostCents: toMonthlyCents(row.amountCents, frequency),
    yearlyCostCents: toYearlyCents(row.amountCents, frequency),
  };
}

export async function listSubscriptions(
  prisma: PrismaClient,
  customerId: string,
): Promise<Subscription[]> {
  const rows = await prisma.subscription.findMany({
    where: { account: { customerId } },
    orderBy: { amountCents: 'desc' },
  });
  return rows.map(toDomain);
}

export async function getSubscription(prisma: PrismaClient, id: string, customerId?: string) {
  const row = await prisma.subscription.findFirst({
    where: { id, ...(customerId ? { account: { customerId } } : {}) },
    include: { merchant: true, guardRule: true, virtualCard: true, reminders: true },
  });
  if (!row) return null;

  // What this merchant has actually taken so far. Far more persuasive than a
  // projection, because it already happened.
  const charges = await prisma.transaction.findMany({
    where: { accountId: row.accountId, merchantId: row.merchantId, source: 'purchase' },
    orderBy: { postedAt: 'asc' },
  });

  const paidToDateCents = charges.reduce((sum, c) => sum + Math.abs(c.amountCents), 0);

  return {
    ...toDomain(row),
    cancelUrl: row.merchant.cancelUrl,
    guardRule: row.guardRule,
    virtualCard: row.virtualCard,
    reminders: row.reminders,
    paidToDateCents,
    chargeCount: charges.length,
    firstChargeDate: charges[0]?.postedAt.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** Totals and the money-saved tracker for the subscriptions page header. */
export async function subscriptionSummary(prisma: PrismaClient, customerId: string) {
  const subscriptions = await listSubscriptions(prisma, customerId);

  const counted = subscriptions.filter((s) => s.status === 'active' || s.status === 'guarded');
  const stopped = subscriptions.filter((s) => s.status === 'blocked' || s.status === 'canceled');

  return {
    total: subscriptions.length,
    activeCount: counted.length,
    guardedCount: subscriptions.filter((s) => s.status === 'guarded').length,
    blockedCount: subscriptions.filter((s) => s.status === 'blocked').length,
    monthlyTotalCents: counted.reduce((sum, s) => sum + s.monthlyCostCents, 0),
    yearlyTotalCents: counted.reduce((sum, s) => sum + s.yearlyCostCents, 0),
    /** Annualised saving from everything blocked or cancelled. */
    savedYearlyCents: stopped.reduce((sum, s) => sum + s.yearlyCostCents, 0),
    needsAttention: {
      priceIncreases: subscriptions.filter((s) => s.hasPriceIncrease).length,
      trials: subscriptions.filter((s) => s.isFreeTrial).length,
      duplicates: subscriptions.filter((s) => s.isDuplicate).length,
      unused: subscriptions.filter((s) => s.looksUnused).length,
    },
  };
}

// --- actions ---------------------------------------------------------------

/** Turns on "Ask me first". */
export async function guardSubscription(prisma: PrismaClient, id: string) {
  await prisma.subscription.update({ where: { id }, data: { status: 'guarded' } });
  await prisma.subscriptionGuardRule.upsert({
    where: { subscriptionId: id },
    update: { mode: 'ask_first', oneTimeApprovalUntil: null },
    create: { subscriptionId: id, mode: 'ask_first' },
  });

  // The obligation exists upstream but is no longer scheduled to pay.
  void mirrorBillToNessie(prisma, id);
  return getSubscription(prisma, id);
}

export async function blockSubscription(prisma: PrismaClient, id: string) {
  await prisma.subscription.update({
    where: { id },
    data: { status: 'blocked', savedFromDate: new Date() },
  });
  await prisma.subscriptionGuardRule.upsert({
    where: { subscriptionId: id },
    update: { mode: 'blocked', oneTimeApprovalUntil: null },
    create: { subscriptionId: id, mode: 'blocked' },
  });

  void mirrorBillToNessie(prisma, id);
  return getSubscription(prisma, id);
}

/** Back to normal: charges go through without asking. */
export async function unguardSubscription(prisma: PrismaClient, id: string) {
  await prisma.subscription.update({
    where: { id },
    data: { status: 'active', savedFromDate: null },
  });
  await prisma.subscriptionGuardRule.deleteMany({ where: { subscriptionId: id } });

  void mirrorBillToNessie(prisma, id);
  return getSubscription(prisma, id);
}

/**
 * Issues a virtual card, or replaces the existing one with a fresh number.
 *
 * The seed includes the current time so regenerating actually produces a new
 * number. Seeding on the subscription id alone returned the same card every
 * time, which made "Regenerate" look broken.
 */
export async function createVirtualCard(prisma: PrismaClient, id: string) {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  if (!subscription) return null;

  const card = generateVirtualCard(`${id}-${Date.now()}`);

  await prisma.virtualCard.upsert({
    where: { subscriptionId: id },
    update: { ...card, status: 'active' },
    create: {
      accountId: subscription.accountId,
      merchantId: subscription.merchantId,
      subscriptionId: id,
      ...card,
      status: 'active',
    },
  });

  // Issuing a card on a subscription that was cancelled by deleting its previous
  // card revives it — the user is explicitly opting back in.
  if (subscription.status === 'canceled') {
    await prisma.subscription.update({
      where: { id },
      data: { status: 'active', savedFromDate: null },
    });
  }

  return getSubscription(prisma, id);
}

/**
 * Stops using a virtual card for this merchant and goes back to the real card.
 * The subscription itself is untouched — this is not a cancellation.
 */
export async function removeVirtualCard(prisma: PrismaClient, id: string) {
  await prisma.virtualCard.deleteMany({ where: { subscriptionId: id } });
  return getSubscription(prisma, id);
}

/**
 * Locking pauses the card; deleting it cancels the subscription outright, since
 * there is no longer a number for the merchant to charge.
 */
export async function setVirtualCardStatus(
  prisma: PrismaClient,
  id: string,
  status: 'active' | 'locked',
) {
  await prisma.virtualCard.updateMany({ where: { subscriptionId: id }, data: { status } });
  return getSubscription(prisma, id);
}

/** What should happen to the subscription once its virtual card is destroyed. */
export type AfterCardDeleted = 'cancel' | 'move_to_real_card';

/**
 * Destroys a virtual card number.
 *
 * Deleting the number and cancelling the subscription are deliberately separate
 * decisions. Burning a card so a free trial can't convert, while keeping the
 * option to subscribe properly later, is a normal thing to want — so the caller
 * says what the subscription should do next rather than having it assumed.
 */
export async function deleteVirtualCard(
  prisma: PrismaClient,
  id: string,
  then: AfterCardDeleted,
) {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  if (!subscription) return null;

  // The row goes too; a dead card lingering in the UI blocks issuing a new one.
  await prisma.virtualCard.deleteMany({ where: { subscriptionId: id } });

  if (then === 'cancel') {
    await prisma.subscription.update({
      where: { id },
      data: { status: 'canceled', savedFromDate: new Date() },
    });
    // No merchant, no obligation — drop the bill rather than leaving it cancelled.
    void removeBillFromNessie(prisma, id);
  } else if (subscription.status === 'canceled') {
    // Moving back to the real card revives a subscription cancelled earlier.
    await prisma.subscription.update({
      where: { id },
      data: { status: 'active', savedFromDate: null },
    });
  }

  return getSubscription(prisma, id);
}

export type ReminderChannel = 'push' | 'email' | 'sms';

export async function setReminder(
  prisma: PrismaClient,
  id: string,
  daysBefore: number,
  channel: ReminderChannel = 'push',
) {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  if (!subscription) return null;

  const fireAt = addDays(subscription.nextChargeDate, -daysBefore);

  await prisma.reminder.upsert({
    where: { subscriptionId_daysBefore: { subscriptionId: id, daysBefore } },
    update: { fireAt, firedAt: null, channel },
    create: { subscriptionId: id, daysBefore, fireAt, channel },
  });

  return getSubscription(prisma, id);
}

export async function clearReminder(prisma: PrismaClient, id: string, daysBefore: number) {
  await prisma.reminder.deleteMany({ where: { subscriptionId: id, daysBefore } });
  return getSubscription(prisma, id);
}

// --- the demo's centrepiece ------------------------------------------------

/**
 * Pushes a pretend incoming charge through the Guard rules, so the approve/decline
 * flow can be shown live. Declines raise a pending alert; approvals post a real
 * transaction so the effect is visible on the account.
 */
export async function simulateRenewal(prisma: PrismaClient, id: string, now = new Date()) {
  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: { guardRule: true, virtualCard: true },
  });
  if (!subscription) return null;

  const amountCents = subscription.amountCents;

  const account = await prisma.account.findUnique({ where: { id: subscription.accountId } });

  const result = evaluateCharge(
    {
      status: subscription.status,
      oneTimeApprovalUntil: subscription.guardRule?.oneTimeApprovalUntil ?? null,
      virtualCardStatus: subscription.virtualCard?.status ?? null,
      cardLocked: account?.isLocked ?? false,
    },
    now,
  );

  if (result.allowed) {
    await prisma.transaction.create({
      data: {
        accountId: subscription.accountId,
        merchantId: subscription.merchantId,
        source: 'purchase',
        amountCents: -amountCents,
        description: subscription.merchantName,
        postedAt: now,
        category: subscription.category,
        subscriptionId: subscription.id,
      },
    });

    await prisma.account.update({
      where: { id: subscription.accountId },
      data: { balanceCents: { increment: amountCents } },
    });

    // The approval is spent; the next attempt is asked about again.
    if (result.consumedApproval) {
      await prisma.subscriptionGuardRule.updateMany({
        where: { subscriptionId: id },
        data: { oneTimeApprovalUntil: null, approvedCount: { increment: 1 } },
      });
    }

    await prisma.subscription.update({
      where: { id },
      data: { lastChargeDate: now, nextChargeDate: addDays(now, subscription.intervalDays) },
    });

    if (account) {
      await earnOnPurchase(prisma, {
        customerId: account.customerId,
        accountId: account.id,
        amountCents,
        category: subscription.category,
        merchant: subscription.merchantName,
      });
      await notifyCharge(prisma, {
        customerId: account.customerId,
        merchant: subscription.merchantName,
        amountCents,
        accountLabel: subscription.virtualCard?.status === 'active'
          ? `virtual card ••${subscription.virtualCard.last4}`
          : `${account.nickname} ••${account.last4}`,
        href: `/subscriptions/${id}?from=alerts`,
      });
    }
  } else {
    await prisma.subscriptionGuardRule.updateMany({
      where: { subscriptionId: id },
      data: { declinedCount: { increment: 1 } },
    });

    const kind =
      result.decision === 'decline_pending_approval' ? 'charge_pending' : 'charge_declined';

    // One alert per merchant per unresolved issue. A merchant that retries ten
    // times should show as one alert that has happened ten times, not ten
    // identical alerts the user has to dismiss one by one.
    const open = await prisma.alert.findFirst({
      where: { subscriptionId: id, kind, status: 'pending' },
    });

    if (open) {
      await prisma.alert.update({
        where: { id: open.id },
        data: {
          occurrences: { increment: 1 },
          amountCents,
          // Unread again, since something new happened.
          readAt: null,
          title: `${subscription.merchantName} tried to charge $${centsToDollars(amountCents).toFixed(2)}`,
          body: `${result.reason} This merchant has tried ${open.occurrences + 1} times.`,
        },
      });
    } else {
      await prisma.alert.create({
        data: {
          subscriptionId: id,
          kind,
          title: `${subscription.merchantName} tried to charge $${centsToDollars(amountCents).toFixed(2)}`,
          body: result.reason,
          amountCents,
          // A permanent block needs no decision; a guarded charge does.
          status: kind === 'charge_pending' ? 'pending' : 'resolved',
        },
      });
    }
  }

  return {
    decision: result.decision,
    allowed: result.allowed,
    reason: result.reason,
    amountCents,
    subscription: await getSubscription(prisma, id),
  };
}

/** Approves a pending charge. The merchant's NEXT attempt is let through, once. */
export async function approvePendingCharge(prisma: PrismaClient, alertId: string, now = new Date()) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert?.subscriptionId) return null;

  await prisma.subscriptionGuardRule.upsert({
    where: { subscriptionId: alert.subscriptionId },
    update: { oneTimeApprovalUntil: approvalExpiry(now) },
    create: {
      subscriptionId: alert.subscriptionId,
      mode: 'ask_first',
      oneTimeApprovalUntil: approvalExpiry(now),
    },
  });

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: 'resolved', resolvedAt: now, readAt: now },
  });

  // Put the approved charge through immediately, which is what the user expects.
  return simulateRenewal(prisma, alert.subscriptionId, now);
}

/** Keeps a pending charge blocked. */
export async function keepBlocked(prisma: PrismaClient, alertId: string, now = new Date()) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert?.subscriptionId) return null;

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: 'resolved', resolvedAt: now, readAt: now },
  });

  return getSubscription(prisma, alert.subscriptionId);
}

/**
 * Mirrors a subscription into Nessie as a recurring bill, so the obligation
 * genuinely lives there. Best-effort: a Nessie failure must not break the app.
 */
/**
 * Mirrors a subscription into Nessie as a recurring bill.
 *
 * Bills are the one place Nessie keeps exact cents — `payment_amount` is a float
 * while every other amount is truncated to whole dollars — so a subscription
 * survives the round trip intact.
 *
 * All of nickname, payment_date and recurring_date are mandatory: a bill missing
 * any of them is writable but unreadable, and one such bill makes GET /bills
 * return 400 for the entire account permanently.
 *
 * Best-effort throughout. A Nessie failure must never block a user action.
 */
export async function mirrorBillToNessie(prisma: PrismaClient, id: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  const account = subscription
    ? await prisma.account.findUnique({ where: { id: subscription.accountId } })
    : null;

  if (!subscription || !account?.nessieId) return false;

  // Already mirrored: push the current amount and status instead of duplicating.
  if (subscription.nessieBillId) {
    return syncBillToNessie(prisma, id);
  }

  try {
    // Re-adopt a bill left behind by an earlier seed. `--reset` clears our local
    // rows but Nessie keeps its own, so without this every re-seed would stack
    // another bill for the same merchant.
    const existing = (await nessie.listBills(account.nessieId)).find(
      (bill) => bill.payee === subscription.merchantName,
    );

    if (existing?._id) {
      await prisma.subscription.update({ where: { id }, data: { nessieBillId: existing._id } });
      return syncBillToNessie(prisma, id);
    }
  } catch {
    // Listing failed; fall through and create a new one.
  }

  try {
    const bill = await nessie.createBill(account.nessieId, {
      status: billStatusFor(subscription.status),
      payee: subscription.merchantName,
      nickname: `${subscription.merchantName} subscription`,
      payment_amount: centsToDollars(subscription.amountCents),
      payment_date: toIsoDate(subscription.nextChargeDate),
      // Clamped to 28 so every month has the day.
      recurring_date: Math.min(28, subscription.nextChargeDate.getUTCDate()),
    });

    await prisma.subscription.update({ where: { id }, data: { nessieBillId: bill._id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps our subscription status onto Nessie's bill statuses.
 *
 * `guarded` becomes `pending`: the obligation still exists, but money is not
 * scheduled to move until the user approves it, which is exactly what pending
 * means. Blocked and cancelled both become `cancelled`.
 */
export function billStatusFor(status: string): 'recurring' | 'pending' | 'cancelled' {
  if (status === 'guarded') return 'pending';
  if (status === 'blocked' || status === 'canceled') return 'cancelled';
  return 'recurring';
}

/** Pushes the current status, amount and next date onto an existing bill. */
export async function syncBillToNessie(prisma: PrismaClient, id: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  if (!subscription?.nessieBillId) return false;

  try {
    await nessie.updateBill(subscription.nessieBillId, {
      status: billStatusFor(subscription.status),
      payment_amount: centsToDollars(subscription.amountCents),
      payment_date: toIsoDate(subscription.nextChargeDate),
      recurring_date: Math.min(28, subscription.nextChargeDate.getUTCDate()),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes bills for a payee beyond the one we're linked to.
 *
 * Earlier seeds created a fresh bill on every run, before re-adoption existed.
 * This clears what they left behind so the Nessie account reflects reality
 * rather than its own history.
 */
export async function pruneDuplicateBills(
  prisma: PrismaClient,
  accountId: string,
): Promise<number> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.nessieId) return 0;

  const subscriptions = await prisma.subscription.findMany({ where: { accountId } });
  const keep = new Set(subscriptions.map((s) => s.nessieBillId).filter(Boolean));

  let removed = 0;
  try {
    const bills = await nessie.listBills(account.nessieId);
    const seen = new Set<string>();

    for (const bill of bills) {
      // Keep the bill a subscription points at, plus the first of any orphans.
      if (keep.has(bill._id)) {
        seen.add(bill.payee);
        continue;
      }
      if (!seen.has(bill.payee) && !subscriptions.some((s) => s.merchantName === bill.payee)) {
        seen.add(bill.payee);
        continue;
      }

      try {
        await nessie.deleteBill(bill._id);
        removed++;
      } catch {
        // A bill we cannot delete is not worth failing the seed over.
      }
    }
  } catch {
    return removed;
  }

  return removed;
}

/** Removes the bill entirely, for a subscription cancelled outright. */
export async function removeBillFromNessie(prisma: PrismaClient, id: string): Promise<boolean> {
  const subscription = await prisma.subscription.findUnique({ where: { id } });
  if (!subscription?.nessieBillId) return false;

  try {
    await nessie.deleteBill(subscription.nessieBillId);
    await prisma.subscription.update({ where: { id }, data: { nessieBillId: null } });
    return true;
  } catch {
    return false;
  }
}
