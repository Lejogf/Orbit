// Orbit's card line-up.
//
// Four consumer tiers you climb as your credit grows, plus a business card.
// Each one states the two things people actually compare — what it pays back
// and what it costs — and nothing else. Rewards get richer as the tier rises,
// which is the honest reason to move up.

export type CardTier = 'start' | 'move' | 'rise' | 'summit' | 'business';

export interface EarnRule {
  /** Transaction category this rate applies to. 'everything' is the base rate. */
  category: string;
  /** Points per dollar. 100 points = $1, so 1x = 1% back. */
  rate: number;
  label: string;
}

export interface CardProductSpec {
  id: string;
  tier: CardTier;
  name: string;
  tagline: string;
  kind: 'personal' | 'business';
  annualFeeCents: number;
  /** Typical opening limit, in cents. */
  startingLimitCents: number;
  /** Lowest estimated score this is offered at. */
  minScore: number;
  /** Gradient stops for the physical card artwork. */
  art: { from: string; to: string; ink: 'light' | 'dark'; texture: 'matte' | 'metal' | 'frost' };
  earn: EarnRule[];
  /** Two or three headline perks. Kept short on purpose. */
  perks: string[];
  /** Redemptions this tier can use. Lower tiers are deliberately simpler. */
  redemptions: string[];
}

export const CARD_PRODUCTS: CardProductSpec[] = [
  {
    id: 'orbit-start',
    tier: 'start',
    name: 'Orbit Start',
    tagline: 'Build credit from zero, with no fee.',
    kind: 'personal',
    annualFeeCents: 0,
    startingLimitCents: 50_000,
    minScore: 0,
    art: { from: '#3f4b44', to: '#161f1a', ink: 'light', texture: 'matte' },
    earn: [{ category: 'everything', rate: 1, label: '1% back on everything' }],
    perks: ['No annual fee, no foreign transaction fee', 'Credit limit review after 6 on-time payments', 'Free credit score and alerts'],
    redemptions: ['cash', 'giftcard'],
  },
  {
    id: 'orbit-move',
    tier: 'move',
    name: 'Orbit Move',
    tagline: 'Flat rewards on everyday spending.',
    kind: 'personal',
    annualFeeCents: 0,
    startingLimitCents: 200_000,
    minScore: 660,
    art: { from: '#1f7a5a', to: '#0c3a2b', ink: 'light', texture: 'matte' },
    earn: [
      { category: 'everything', rate: 1.5, label: '1.5% back on everything' },
      { category: 'Dining', rate: 3, label: '3% back on dining' },
    ],
    perks: ['No annual fee', 'Pay Over Time on purchases over $100', 'Price drop protection on travel booked in app'],
    redemptions: ['cash', 'giftcard', 'invest'],
  },
  {
    id: 'orbit-rise',
    tier: 'rise',
    name: 'Orbit Rise',
    tagline: 'For the categories you actually spend in.',
    kind: 'personal',
    annualFeeCents: 9_500,
    startingLimitCents: 800_000,
    minScore: 700,
    art: { from: '#34d399', to: '#046c4e', ink: 'dark', texture: 'frost' },
    earn: [
      { category: 'everything', rate: 2, label: '2% back on everything' },
      { category: 'Groceries', rate: 4, label: '4% on groceries' },
      { category: 'Dining', rate: 4, label: '4% on dining' },
      { category: 'Travel', rate: 5, label: '5% on travel booked in Orbit' },
    ],
    perks: ['$95 a year, offset after ~$4,800 of spending', '$100 annual travel credit', 'Cell phone protection'],
    redemptions: ['cash', 'giftcard', 'invest', 'travel', 'merch'],
  },
  {
    id: 'orbit-summit',
    tier: 'summit',
    name: 'Orbit Summit',
    tagline: 'Metal card, lounge access, best redemption value.',
    kind: 'personal',
    annualFeeCents: 39_500,
    startingLimitCents: 2_000_000,
    minScore: 760,
    art: { from: '#e8ecec', to: '#9aa7a2', ink: 'dark', texture: 'metal' },
    earn: [
      { category: 'everything', rate: 2, label: '2% back on everything' },
      { category: 'Travel', rate: 10, label: '10% on hotels booked in Orbit' },
      { category: 'Dining', rate: 5, label: '5% on dining' },
    ],
    perks: ['$395 a year · $300 travel credit + $100 dining credit', 'Airport lounge access for you and a guest', 'Points worth 25% more on travel'],
    redemptions: ['cash', 'giftcard', 'invest', 'travel', 'merch', 'partner'],
  },
  {
    id: 'orbit-business',
    tier: 'business',
    name: 'Orbit Business',
    tagline: 'Separate your business spending, keep the receipts straight.',
    kind: 'business',
    annualFeeCents: 0,
    startingLimitCents: 1_500_000,
    minScore: 680,
    art: { from: '#0b1f3a', to: '#050d18', ink: 'light', texture: 'matte' },
    earn: [
      { category: 'everything', rate: 2, label: '2% back on everything' },
      { category: 'Software', rate: 5, label: '5% on software and ads' },
    ],
    perks: ['No annual fee · free employee cards', 'Receipt capture and category rules', 'Quarterly tax summaries'],
    redemptions: ['cash', 'giftcard', 'invest', 'travel'],
  },
];

export function cardById(id: string): CardProductSpec | null {
  return CARD_PRODUCTS.find((c) => c.id === id) ?? null;
}

/** Points per dollar for a purchase on this card, by category. */
export function earnRateFor(card: CardProductSpec, category: string): EarnRule {
  return (
    card.earn.find((rule) => rule.category.toLowerCase() === category.toLowerCase()) ??
    card.earn.find((rule) => rule.category === 'everything') ?? { category: 'everything', rate: 1, label: '1% back' }
  );
}

export interface Eligibility {
  productId: string;
  eligible: boolean;
  /** 0..1 — how comfortably they clear the bar, for ordering recommendations. */
  confidence: number;
  reason: string;
}

/**
 * Who we'd offer what. Score is the main gate; income is a sanity check on the
 * fee-bearing tiers, so nobody is nudged into a card that costs more than it
 * returns for them.
 */
export function eligibilityFor(
  input: { score: number; monthlyIncomeCents: number; monthlySpendCents: number; missedPayments: number; kind?: 'personal' | 'business' },
): Eligibility[] {
  return CARD_PRODUCTS.filter((card) => (input.kind ? card.kind === input.kind : true)).map((card) => {
    if (input.score < card.minScore) {
      return {
        productId: card.id,
        eligible: false,
        confidence: 0,
        reason: `Usually needs a score around ${card.minScore}. You're at ${input.score}.`,
      };
    }
    if (input.missedPayments > 1 && card.annualFeeCents > 0) {
      return { productId: card.id, eligible: false, confidence: 0, reason: 'A few missed payments on record. Keep six months clean and this opens up.' };
    }
    // A fee only makes sense if the extra earning covers it.
    if (card.annualFeeCents > 0) {
      const base = CARD_PRODUCTS.find((c) => c.id === 'orbit-move')!;
      const extraRate = (card.earn[0]?.rate ?? 1) - (base.earn[0]?.rate ?? 1);
      const yearlyExtraCents = Math.round((input.monthlySpendCents * 12 * extraRate) / 100);
      if (yearlyExtraCents < card.annualFeeCents) {
        return {
          productId: card.id,
          eligible: true,
          confidence: 0.25,
          reason: `You'd earn about $${Math.round(yearlyExtraCents / 100)} extra a year — less than the $${Math.round(card.annualFeeCents / 100)} fee. Only worth it if your spending grows.`,
        };
      }
      return {
        productId: card.id,
        eligible: true,
        confidence: 0.9,
        reason: `At your spending you'd earn about $${Math.round(yearlyExtraCents / 100)} extra a year, beating the $${Math.round(card.annualFeeCents / 100)} fee.`,
      };
    }
    return { productId: card.id, eligible: true, confidence: 0.7, reason: 'No annual fee, so it costs nothing to hold.' };
  });
}

/** The single card we'd suggest next, if any. */
export function recommendCard(
  held: string[],
  input: Parameters<typeof eligibilityFor>[0],
): { productId: string; reason: string } | null {
  const best = eligibilityFor(input)
    .filter((e) => e.eligible && !held.includes(e.productId))
    .sort((a, b) => b.confidence - a.confidence)[0];
  return best ? { productId: best.productId, reason: best.reason } : null;
}
