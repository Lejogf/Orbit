// The cards a customer holds, and the one we'd suggest next.
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { CARD_PRODUCTS, cardById, eligibilityFor, recommendCard } from '../features/cards.js';
import { scoreForPricing } from './credit.js';
import { monthlyIncome } from './money.js';
import { raiseAlert } from './notify.js';

/** Last four digits that look like a card and are stable per account. */
function last4(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(1000 + (h % 9000));
}

export async function listCards(prisma: PrismaClient, customerId: string) {
  const [accounts, products] = await Promise.all([
    prisma.account.findMany({ where: { customerId, type: 'Credit Card' }, orderBy: { createdAt: 'asc' } }),
    prisma.cardProduct.findMany({ where: { customerId } }),
  ]);

  return accounts.map((account) => {
    const link = products.find((p) => p.accountId === account.id);
    // Accounts that pre-date the catalogue are treated as the mid tier.
    const spec = cardById(link?.productId ?? '') ?? cardById('orbit-move')!;
    return {
      accountId: account.id,
      productId: spec.id,
      name: spec.name,
      tier: spec.tier,
      kind: (link?.kind ?? spec.kind) as 'personal' | 'business',
      tagline: spec.tagline,
      art: spec.art,
      earn: spec.earn,
      perks: spec.perks,
      annualFeeCents: spec.annualFeeCents,
      nickname: account.nickname,
      last4: account.last4,
      balanceCents: account.balanceCents,
      creditLimitCents: account.creditLimitCents,
      availableCents: account.creditLimitCents !== null ? account.creditLimitCents - account.balanceCents : null,
      isLocked: account.isLocked,
      physicalOrderedAt: link?.orderedAt?.toISOString() ?? null,
      rewardsCents: account.rewardsCents,
    };
  });
}

async function profileForOffers(prisma: PrismaClient, customerId: string) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 3);

  const [score, income, spend, customer] = await Promise.all([
    scoreForPricing(prisma, customerId),
    monthlyIncome(prisma, customerId),
    prisma.transaction.aggregate({
      where: { account: { customerId }, source: 'purchase', postedAt: { gte: since } },
      _sum: { amountCents: true },
    }),
    prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
  ]);

  return {
    score,
    monthlyIncomeCents: income,
    monthlySpendCents: Math.round(Math.abs(spend._sum.amountCents ?? 0) / 3),
    missedPayments: customer.missedPayments,
  };
}

export async function cardOffers(prisma: PrismaClient, customerId: string) {
  const held = (await listCards(prisma, customerId)).map((c) => c.productId);
  const profile = await profileForOffers(prisma, customerId);
  const eligibility = eligibilityFor(profile);

  return {
    profile,
    held,
    recommendation: recommendCard(held, profile),
    catalogue: CARD_PRODUCTS.map((card) => ({
      ...card,
      held: held.includes(card.id),
      eligibility: eligibility.find((e) => e.productId === card.id) ?? null,
    })),
  };
}

/** Opens a new card. In a real bank this is an application; here it is instant. */
export async function openCard(prisma: PrismaClient, customerId: string, productId: string) {
  const spec = cardById(productId);
  if (!spec) throw ApiError.notFound('Card');

  const existing = await prisma.cardProduct.findFirst({ where: { customerId, productId } });
  if (existing) throw new ApiError(409, 'ALREADY_HELD', `You already have the ${spec.name}.`);

  const profile = await profileForOffers(prisma, customerId);
  const eligibility = eligibilityFor(profile).find((e) => e.productId === productId);
  if (eligibility && !eligibility.eligible) {
    throw new ApiError(409, 'NOT_ELIGIBLE', eligibility.reason);
  }

  const account = await prisma.account.create({
    data: {
      customerId,
      type: 'Credit Card',
      nickname: spec.name,
      last4: last4(`${customerId}${productId}`),
      balanceCents: 0,
      creditLimitCents: spec.startingLimitCents,
    },
  });

  await prisma.cardProduct.create({
    data: { customerId, accountId: account.id, productId: spec.id, kind: spec.kind, art: spec.art.texture },
  });

  await raiseAlert(prisma, {
    customerId,
    kind: 'card_opened',
    title: `${spec.name} approved`,
    body: `Your digital card works right now, with a ${(spec.startingLimitCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} limit. The physical card arrives in 5–7 days.`,
    href: '/cards',
  });

  return listCards(prisma, customerId);
}

export async function orderPhysicalCard(prisma: PrismaClient, customerId: string, accountId: string) {
  const link = await prisma.cardProduct.findFirst({ where: { customerId, accountId } });
  if (!link) throw ApiError.notFound('Card');
  await prisma.cardProduct.update({ where: { id: link.id }, data: { orderedAt: new Date() } });
  return listCards(prisma, customerId);
}

/** The product a purchase earned on, so points use the right rate. */
export async function productForAccount(prisma: PrismaClient, accountId: string): Promise<string> {
  const link = await prisma.cardProduct.findFirst({ where: { accountId } });
  return link?.productId ?? 'orbit-move';
}
