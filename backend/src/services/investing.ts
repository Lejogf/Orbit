// Investing: buying and selling against the customer's real cash.
//
// Money for an order leaves checking the moment it fills, and proceeds land
// back there — so the investing screen and the banking screens never disagree.
//
// Prices come from `marketData` (Alpha Vantage, cached) and fall back to the
// deterministic walk. An order always fills at the price the customer was
// shown, and every quote carries `source` so the UI can say which it was.

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../lib/http.js';
import { formatCents } from '../lib/utils.js';
import {
  INSTRUMENTS,
  applyBuy,
  applySell,
  checkBuy,
  checkSell,
  quote,
  riskNote,
  valuePortfolio,
} from '../features/investing.js';
import { raiseAlert } from './notify.js';
import { pointsBalance, redeemPoints } from './rewards.js';
import { marketDataStatus, priceBookForAll, priceBookNow, series } from './marketData.js';

async function checkingFor(prisma: PrismaClient, customerId: string) {
  const account = await prisma.account.findFirst({ where: { customerId, type: 'Checking' } });
  if (!account) throw ApiError.badRequest('You need a checking account to invest.');
  return account;
}

export async function investingOverview(prisma: PrismaClient, customerId: string, now = new Date()) {
  const [holdings, checking, trades, points] = await Promise.all([
    prisma.holding.findMany({ where: { customerId } }),
    prisma.account.findFirst({ where: { customerId, type: 'Checking' } }),
    prisma.trade.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    pointsBalance(prisma, customerId),
  ]);

  // Non-blocking: whatever is already live, plus a background warm-up for the
  // rest. The customer's own holdings are queued first — those are their money.
  const prices = priceBookForAll(holdings.map((h) => h.symbol));

  const portfolio = valuePortfolio(
    holdings.map((h) => ({ symbol: h.symbol, quantity: h.quantity, costBasisCents: h.costBasisCents })),
    now,
    prices,
  );

  return {
    portfolio,
    riskNote: riskNote(portfolio),
    availableCents: checking?.balanceCents ?? 0,
    points,
    pointsValueCents: points,
    market: INSTRUMENTS.map((instrument) => quote(instrument.symbol, now, prices.get(instrument.symbol))!),
    marketData: marketDataStatus(),
    trades: trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      priceCents: t.priceCents,
      amountCents: t.amountCents,
      fundedBy: t.fundedBy,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function instrumentDetail(symbol: string, range: number, now = new Date()) {
  // The customer tapped this one, so it is worth waiting for a real number.
  const [prices, history] = await Promise.all([priceBookNow([symbol]), series(symbol, range)]);
  const current = quote(symbol, now, prices.get(symbol.toUpperCase()));
  if (!current) throw ApiError.notFound('Investment');
  return { quote: current, history: history.points, historySource: history.source };
}

/** The price an order fills at. Worth waiting for: this one moves real money. */
async function livePriceFor(symbol: string, now: Date) {
  const prices = await priceBookNow([symbol]);
  return quote(symbol, now, prices.get(symbol.toUpperCase()));
}

export async function buy(
  prisma: PrismaClient,
  customerId: string,
  input: { symbol: string; amountCents: number; fundedBy: 'cash' | 'points' },
  now = new Date(),
) {
  const current = await livePriceFor(input.symbol, now);
  if (!current) throw ApiError.notFound('Investment');

  const checking = await checkingFor(prisma, customerId);
  const available = input.fundedBy === 'points' ? await pointsBalance(prisma, customerId) : checking.balanceCents;

  const check = checkBuy({ amountCents: input.amountCents, priceCents: current.priceCents, availableCents: available });
  if (!check.ok) throw ApiError.badRequest(check.error ?? 'That order cannot be placed.');

  // Points route: redeem first (at the 1:1 investing rate), then buy with the cash.
  if (input.fundedBy === 'points') {
    await redeemPoints(prisma, customerId, { redemption: 'invest', points: input.amountCents });
  }

  const existing = await prisma.holding.findUnique({ where: { customerId_symbol: { customerId, symbol: current.symbol } } });
  const next = applyBuy(
    existing ?? { symbol: current.symbol, quantity: 0, costBasisCents: 0 },
    check.quantity,
    input.amountCents,
  );

  await prisma.$transaction([
    prisma.holding.upsert({
      where: { customerId_symbol: { customerId, symbol: current.symbol } },
      update: { quantity: next.quantity, costBasisCents: next.costBasisCents },
      create: { customerId, symbol: current.symbol, quantity: next.quantity, costBasisCents: next.costBasisCents },
    }),
    prisma.trade.create({
      data: {
        customerId,
        symbol: current.symbol,
        side: 'buy',
        quantity: check.quantity,
        priceCents: current.priceCents,
        amountCents: input.amountCents,
        fundedBy: input.fundedBy,
      },
    }),
    // The order is always funded from checking. A points order credited
    // checking a moment ago, so the two entries net to zero there.
    prisma.account.update({ where: { id: checking.id }, data: { balanceCents: { decrement: input.amountCents } } }),
    prisma.transaction.create({
      data: {
        accountId: checking.id,
        source: 'withdrawal',
        amountCents: -input.amountCents,
        description: input.fundedBy === 'points' ? `Bought ${current.symbol} with points` : `Bought ${current.symbol}`,
        postedAt: now,
        category: 'Investing',
      },
    }),
  ]);

  await raiseAlert(prisma, {
    customerId,
    kind: 'trade_filled',
    title: `Bought ${formatCents(input.amountCents)} of ${current.symbol}`,
    body: `${check.quantity} at ${formatCents(current.priceCents)} each.${input.fundedBy === 'points' ? ' Paid with points.' : ''}`,
    amountCents: input.amountCents,
    href: '/invest',
  });

  return investingOverview(prisma, customerId, now);
}

export async function sell(
  prisma: PrismaClient,
  customerId: string,
  input: { symbol: string; quantity: number },
  now = new Date(),
) {
  const current = await livePriceFor(input.symbol, now);
  if (!current) throw ApiError.notFound('Investment');

  const holding = await prisma.holding.findUnique({ where: { customerId_symbol: { customerId, symbol: current.symbol } } });
  if (!holding) throw ApiError.badRequest("You don't hold that.");

  const check = checkSell({ quantity: input.quantity, held: holding.quantity, priceCents: current.priceCents });
  if (!check.ok) throw ApiError.badRequest(check.error ?? 'That order cannot be placed.');

  const proceedsCents = Math.round(check.quantity * current.priceCents);
  const { position, costRemovedCents } = applySell(
    { symbol: holding.symbol, quantity: holding.quantity, costBasisCents: holding.costBasisCents },
    check.quantity,
  );
  const checking = await checkingFor(prisma, customerId);

  await prisma.$transaction([
    prisma.holding.update({
      where: { id: holding.id },
      data: { quantity: position.quantity, costBasisCents: position.costBasisCents },
    }),
    prisma.trade.create({
      data: {
        customerId,
        symbol: current.symbol,
        side: 'sell',
        quantity: check.quantity,
        priceCents: current.priceCents,
        amountCents: proceedsCents,
        fundedBy: 'cash',
      },
    }),
    prisma.account.update({ where: { id: checking.id }, data: { balanceCents: { increment: proceedsCents } } }),
    prisma.transaction.create({
      data: {
        accountId: checking.id,
        source: 'deposit',
        amountCents: proceedsCents,
        description: `Sold ${current.symbol}`,
        postedAt: now,
        category: 'Investing',
      },
    }),
  ]);

  const gainCents = proceedsCents - costRemovedCents;
  await raiseAlert(prisma, {
    customerId,
    kind: 'trade_filled',
    title: `Sold ${current.symbol} for ${formatCents(proceedsCents)}`,
    body: gainCents >= 0
      ? `A gain of ${formatCents(gainCents)}. The cash is in your checking account.`
      : `A loss of ${formatCents(-gainCents)}. The cash is in your checking account.`,
    amountCents: proceedsCents,
    href: '/invest',
  });

  return investingOverview(prisma, customerId, now);
}

/**
 * Moving holdings to an outside broker. Real transfers go through ACATS and
 * take days, so this records the request and tells the customer what happens.
 */
export async function requestTransferOut(prisma: PrismaClient, customerId: string, brokerName: string) {
  const holdings = await prisma.holding.findMany({ where: { customerId } });
  if (holdings.length === 0) throw ApiError.badRequest('There is nothing to transfer yet.');

  await raiseAlert(prisma, {
    customerId,
    kind: 'transfer_requested',
    title: `Transfer to ${brokerName} started`,
    body: 'Your shares move as they are — we do not sell them, so there is no tax event. Transfers usually settle in 5–7 business days, and a specialist will confirm the details with you.',
    href: '/invest',
  });

  return {
    broker: brokerName,
    positions: holdings.length,
    note: 'An in-kind transfer moves the shares themselves, so nothing is sold and no gains are realised.',
  };
}
