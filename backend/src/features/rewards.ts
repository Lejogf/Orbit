// Orbit points.
//
// One rule to remember: **100 points = $1**. Cash and gift cards are exactly
// that — no better, no worse — so nobody has to do mental arithmetic to know
// what their points are worth. Travel pays a little more because our partners
// fund it; shopping partners pay a little less because they take a cut. Every
// rate is shown in the app rather than buried in terms.

import { cardById, earnRateFor, type CardProductSpec } from './cards.js';

/** Points needed for one dollar. */
export const POINTS_PER_DOLLAR = 100;

export function pointsToCents(points: number, multiplier = 1): number {
  return Math.round((points / POINTS_PER_DOLLAR) * 100 * multiplier);
}

export function centsToPoints(cents: number): number {
  return Math.round((cents / 100) * POINTS_PER_DOLLAR);
}

export interface RedemptionOption {
  id: 'cash' | 'giftcard' | 'travel' | 'invest' | 'merch' | 'partner';
  label: string;
  /** Value multiplier against the 1:1 baseline. */
  multiplier: number;
  description: string;
  /** Points you need before this can be used. */
  minimumPoints: number;
  /** Tiers that can use it. */
  tiers: string[];
}

export const REDEMPTIONS: RedemptionOption[] = [
  { id: 'cash', label: 'Cash to your account', multiplier: 1, description: 'Straight to checking. 100 points = $1, always.', minimumPoints: 500, tiers: ['start', 'move', 'rise', 'summit', 'business'] },
  { id: 'giftcard', label: 'Gift cards', multiplier: 1, description: 'Same value as cash — pick a brand you already use.', minimumPoints: 1_000, tiers: ['start', 'move', 'rise', 'summit', 'business'] },
  { id: 'invest', label: 'Invest it', multiplier: 1, description: 'Buys fractional shares or crypto in your Orbit portfolio. Same value as cash, but it can grow.', minimumPoints: 500, tiers: ['move', 'rise', 'summit', 'business'] },
  { id: 'travel', label: 'Travel booked in Orbit', multiplier: 1.25, description: 'Your points stretch 25% further on flights and hotels booked here.', minimumPoints: 2_000, tiers: ['rise', 'summit', 'business'] },
  { id: 'merch', label: 'Partner stores', multiplier: 0.9, description: 'Shop with our retail partners. Slightly less than cash, because they set the price.', minimumPoints: 2_000, tiers: ['rise', 'summit'] },
  { id: 'partner', label: 'Checkout with partners', multiplier: 0.8, description: 'Pay at Amazon or PayPal with points. Convenient, but the worst value — take cash instead if you can wait.', minimumPoints: 1_000, tiers: ['summit'] },
];

export function redemptionsFor(tier: string): RedemptionOption[] {
  return REDEMPTIONS.filter((r) => r.tiers.includes(tier));
}

/** What a points balance is worth under each redemption, for the redeem screen. */
export function valueTable(points: number, tier: string) {
  return redemptionsFor(tier).map((option) => ({
    ...option,
    available: points >= option.minimumPoints,
    valueCents: pointsToCents(points, option.multiplier),
    /** Cents per 1,000 points, so options compare at a glance. */
    per1000Cents: pointsToCents(1000, option.multiplier),
  }));
}

/** Seasonal and partner boosters, on top of the card's own rate. */
export interface Booster {
  id: string;
  label: string;
  category: string;
  /** Extra points per dollar. */
  bonusRate: number;
  endsInDays: number;
}

export const BOOSTERS: Booster[] = [
  { id: 'boost-travel', label: 'Travel booked in Orbit', category: 'Travel', bonusRate: 2, endsInDays: 60 },
  { id: 'boost-groceries', label: 'Groceries this month', category: 'Groceries', bonusRate: 1, endsInDays: 21 },
  { id: 'boost-transit', label: 'Transit and rideshare', category: 'Transport', bonusRate: 1, endsInDays: 30 },
];

export interface EarnResult {
  points: number;
  basePoints: number;
  bonusPoints: number;
  explanation: string;
}

/** What a purchase earns, and why — the "why" is what builds trust in points. */
export function pointsForPurchase(input: { amountCents: number; category: string; productId: string; boosters?: Booster[] }): EarnResult {
  const card = cardById(input.productId);
  if (!card || input.amountCents <= 0) {
    return { points: 0, basePoints: 0, bonusPoints: 0, explanation: 'No points on this purchase.' };
  }
  const dollars = input.amountCents / 100;
  const rule = earnRateFor(card, input.category);
  const basePoints = Math.floor(dollars * rule.rate);

  const booster = (input.boosters ?? BOOSTERS).find((b) => b.category.toLowerCase() === input.category.toLowerCase());
  const bonusPoints = booster ? Math.floor(dollars * booster.bonusRate) : 0;

  return {
    points: basePoints + bonusPoints,
    basePoints,
    bonusPoints,
    explanation: booster
      ? `${rule.label} (${basePoints} pts) plus the ${booster.label} booster (${bonusPoints} pts).`
      : `${rule.label} — ${basePoints} points.`,
  };
}

/** Concrete, personal advice on earning more, from where the money already goes. */
export function earnMoreTips(input: {
  card: CardProductSpec;
  monthlyByCategory: { category: string; cents: number }[];
  allCards?: CardProductSpec[];
}): { title: string; body: string; extraPointsPerMonth: number }[] {
  const tips: { title: string; body: string; extraPointsPerMonth: number }[] = [];

  for (const booster of BOOSTERS) {
    const spend = input.monthlyByCategory.find((c) => c.category.toLowerCase() === booster.category.toLowerCase());
    if (!spend || spend.cents < 2_000) continue;
    const extra = Math.floor((spend.cents / 100) * booster.bonusRate);
    tips.push({
      title: `${booster.label}: +${extra.toLocaleString('en-US')} points a month`,
      body: `You spend about $${Math.round(spend.cents / 100)} a month here, and the booster runs for another ${booster.endsInDays} days.`,
      extraPointsPerMonth: extra,
    });
  }

  // Would a different card earn meaningfully more on this spending?
  const monthlyTotal = input.monthlyByCategory.reduce((s, c) => s + c.cents, 0);
  const earnWith = (card: CardProductSpec) =>
    input.monthlyByCategory.reduce((sum, c) => sum + Math.floor((c.cents / 100) * earnRateFor(card, c.category).rate), 0);
  const current = earnWith(input.card);

  for (const candidate of input.allCards ?? []) {
    if (candidate.id === input.card.id) continue;
    const gain = earnWith(candidate) - current;
    const feeInPoints = centsToPoints(candidate.annualFeeCents) / 12;
    const net = Math.round(gain - feeInPoints);
    if (net > 200) {
      tips.push({
        // The headline is what they keep after the fee, so ranking and wording agree.
        title: `${candidate.name} would earn ~${net.toLocaleString('en-US')} more points a month`,
        body: candidate.annualFeeCents > 0
          ? `${Math.round(gain).toLocaleString('en-US')} more points on your $${Math.round(monthlyTotal / 100)} a month, after covering its $${Math.round(candidate.annualFeeCents / 100)} annual fee.`
          : 'And it has no annual fee.',
        extraPointsPerMonth: net,
      });
    }
  }

  return tips.sort((a, b) => b.extraPointsPerMonth - a.extraPointsPerMonth).slice(0, 4);
}
