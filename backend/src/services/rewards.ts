// The points ledger: every point earned or spent is a row, so the balance is
// always explainable — "where did these come from?" has an answer.
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { formatCents } from '../lib/utils.js';
import { BOOSTERS, centsToPoints, earnMoreTips, pointsForPurchase, pointsToCents, redemptionsFor, valueTable } from '../features/rewards.js';
import { CARD_PRODUCTS, cardById } from '../features/cards.js';
import { listCards, productForAccount } from './cards.js';
import { raiseAlert } from './notify.js';

export async function pointsBalance(prisma: PrismaClient, customerId: string): Promise<number> {
  const sum = await prisma.pointsEntry.aggregate({ where: { customerId }, _sum: { points: true } });
  return sum._sum.points ?? 0;
}

/**
 * Accounts created before points existed carry a rewards balance on the card.
 * Move it into the ledger once, so there is a single source of truth.
 */
export async function ensureOpeningBalance(prisma: PrismaClient, customerId: string) {
  const migrated = await prisma.pointsEntry.findFirst({ where: { customerId, kind: 'adjustment', reason: 'Opening balance' } });
  if (migrated) return;

  const cards = await prisma.account.findMany({ where: { customerId, type: 'Credit Card' } });
  const points = cards.reduce((sum, card) => sum + card.rewardsCents, 0);
  if (points <= 0) return;

  await prisma.pointsEntry.create({
    data: { customerId, points, kind: 'adjustment', reason: 'Opening balance' },
  });
}

/** Called when a purchase posts. Writes the points and says why they were earned. */
export async function earnOnPurchase(
  prisma: PrismaClient,
  input: { customerId: string; accountId: string; amountCents: number; category: string; transactionId?: string; merchant: string },
) {
  if (input.amountCents <= 0) return null;
  const productId = await productForAccount(prisma, input.accountId);
  const result = pointsForPurchase({ amountCents: input.amountCents, category: input.category, productId });
  if (result.points <= 0) return null;

  await prisma.pointsEntry.create({
    data: {
      customerId: input.customerId,
      points: result.points,
      kind: 'earn',
      reason: `${input.merchant} — ${result.explanation}`,
      transactionId: input.transactionId ?? null,
    },
  });

  // The card's own counter stays in step, since it drives travel redemptions.
  await prisma.account.update({ where: { id: input.accountId }, data: { rewardsCents: { increment: result.points } } });
  return result;
}

/** The tier that decides which redemptions are open: the best card held. */
async function bestTier(prisma: PrismaClient, customerId: string): Promise<string> {
  const cards = await listCards(prisma, customerId);
  const order = ['start', 'move', 'business', 'rise', 'summit'];
  return cards.map((c) => c.tier).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'start';
}

export async function rewardsOverview(prisma: PrismaClient, customerId: string) {
  await ensureOpeningBalance(prisma, customerId);

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 1);

  const [points, tier, cards, entries, recentSpend] = await Promise.all([
    pointsBalance(prisma, customerId),
    bestTier(prisma, customerId),
    listCards(prisma, customerId),
    prisma.pointsEntry.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.transaction.findMany({
      where: { account: { customerId }, source: 'purchase', postedAt: { gte: since } },
      select: { amountCents: true, category: true },
    }),
  ]);

  const byCategory = new Map<string, number>();
  for (const tx of recentSpend) byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + Math.abs(tx.amountCents));
  const monthlyByCategory = [...byCategory.entries()].map(([category, cents]) => ({ category, cents }));

  const earnedThisMonth = entries.filter((e) => e.kind === 'earn' && e.createdAt >= since).reduce((s, e) => s + e.points, 0);
  const primary = cardById(cards[0]?.productId ?? 'orbit-move')!;

  return {
    points,
    valueCents: pointsToCents(points),
    tier,
    earnedThisMonth,
    redemptions: valueTable(points, tier),
    boosters: BOOSTERS,
    tips: earnMoreTips({ card: primary, monthlyByCategory, allCards: CARD_PRODUCTS }),
    /** What each card earns, so the customer knows which to reach for. */
    earnRates: cards.map((card) => ({ accountId: card.accountId, name: card.name, earn: card.earn })),
    history: entries.map((entry) => ({
      id: entry.id,
      points: entry.points,
      kind: entry.kind,
      reason: entry.reason,
      redemption: entry.redemption,
      valueCents: entry.valueCents,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

export type RedemptionId = 'cash' | 'giftcard' | 'travel' | 'invest' | 'merch' | 'partner';

/**
 * Redeems points. Cash lands in checking, investing buys the broad market fund,
 * everything else posts as a statement credit — in every case the customer sees
 * the money move rather than just a number going down.
 */
export async function redeemPoints(
  prisma: PrismaClient,
  customerId: string,
  input: { redemption: RedemptionId; points: number },
) {
  const tier = await bestTier(prisma, customerId);
  const option = redemptionsFor(tier).find((r) => r.id === input.redemption);
  if (!option) throw new ApiError(409, 'NOT_AVAILABLE', 'That redemption is not available on your card yet.');

  const balance = await pointsBalance(prisma, customerId);
  if (input.points > balance) throw ApiError.badRequest(`You have ${balance.toLocaleString('en-US')} points.`);
  if (input.points < option.minimumPoints) {
    throw ApiError.badRequest(`${option.label} starts at ${option.minimumPoints.toLocaleString('en-US')} points.`);
  }

  const valueCents = pointsToCents(input.points, option.multiplier);
  const now = new Date();

  const [checking, card] = await Promise.all([
    prisma.account.findFirst({ where: { customerId, type: 'Checking' } }),
    prisma.account.findFirst({ where: { customerId, type: 'Credit Card' } }),
  ]);

  // Cash and investing land in checking (investing then funds the order from
  // there); everything else posts as a credit against the card.
  if ((input.redemption === 'cash' || input.redemption === 'invest') && checking) {
    await prisma.$transaction([
      prisma.account.update({ where: { id: checking.id }, data: { balanceCents: { increment: valueCents } } }),
      prisma.transaction.create({
        data: {
          accountId: checking.id,
          source: 'deposit',
          amountCents: valueCents,
          description: input.redemption === 'invest' ? 'Points redeemed to invest' : 'Points redeemed for cash',
          postedAt: now,
          category: 'Rewards',
        },
      }),
    ]);
  } else if (card) {
    // Statement credit against the card.
    await prisma.$transaction([
      prisma.account.update({ where: { id: card.id }, data: { balanceCents: { decrement: valueCents } } }),
      prisma.transaction.create({
        data: { accountId: card.id, source: 'deposit', amountCents: valueCents, description: `Points redeemed — ${option.label}`, postedAt: now, category: 'Rewards' },
      }),
    ]);
  }

  await prisma.pointsEntry.create({
    data: {
      customerId,
      points: -input.points,
      kind: 'redeem',
      reason: option.label,
      redemption: input.redemption,
      valueCents,
    },
  });

  if (card) {
    await prisma.account.update({
      where: { id: card.id },
      data: { rewardsCents: { decrement: Math.min(card.rewardsCents, input.points) } },
    });
  }

  await raiseAlert(prisma, {
    customerId,
    kind: 'points_redeemed',
    title: `${input.points.toLocaleString('en-US')} points redeemed`,
    body: `${option.label} — worth ${formatCents(valueCents)}.`,
    amountCents: valueCents,
    href: '/rewards',
  });

  return { valueCents, remainingPoints: balance - input.points, redemption: option.id };
}

/** Points needed to cover an amount at a given redemption's rate. */
export function pointsNeededFor(cents: number, multiplier: number): number {
  return Math.ceil(centsToPoints(cents) / multiplier);
}
