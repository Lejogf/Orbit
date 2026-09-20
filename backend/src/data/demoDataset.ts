// The demo dataset. One definition, two consumers: seed.ts pushes it to Nessie,
// the mock provider serves it directly, so a fallback looks identical.
//
// Deterministic, so the scripted demo can rely on specific transactions existing.
// Entities reference each other by stable KEYS; the seeder maps those to Nessie ids.
import { addDays, addMonths, createRng, daysBetween, startOfDay, toIsoDate } from '../lib/utils.js';
import type { AccountType } from '../domain/types.js';

const SEED = 20_260_919;

/** How much history to generate. */
const HISTORY_MONTHS = 6;

/** Purchases at or above this are eligible for Pay Over Time. */
export const INSTALLMENT_ELIGIBILITY_MIN_CENTS = 100_00;

export interface AccountBlueprint {
  key: 'checking' | 'savings' | 'credit';
  type: AccountType;
  nickname: string;
  last4: string;
  /** For the credit card this is the amount owed. */
  balanceCents: number;
  creditLimitCents?: number;
  rewardsCents?: number;
}

export const ACCOUNT_BLUEPRINTS: readonly AccountBlueprint[] = [
  {
    key: 'checking',
    type: 'Checking',
    nickname: '360 Checking',
    last4: '4417',
    balanceCents: 428_300,
  },
  {
    key: 'savings',
    type: 'Savings',
    nickname: '360 Performance Savings',
    last4: '8802',
    balanceCents: 1_250_000,
  },
  {
    key: 'credit',
    type: 'Credit Card',
    nickname: 'Quicksilver',
    last4: '3391',
    balanceCents: 134_215,
    creditLimitCents: 800_000,
    rewardsCents: 18_742,
  },
] as const;

// Planted for the demo. Detection must find each of these from the transaction
// history alone; these annotations just let the seed build that history.
export type PlantedScenario =
  | { kind: 'price_increase'; previousAmountCents: number; increasedMonthsAgo: number }
  | { kind: 'free_trial'; convertsInDays: number }
  | { kind: 'unused'; lastUsedMonthsAgo: number }
  | { kind: 'normal' };

export interface RecurringMerchantBlueprint {
  key: string;
  name: string;
  category: string;
  cancelUrl: string;
  amountCents: number;
  /** Day of month the charge lands on. Kept <= 28 so every month has the day. */
  dayOfMonth: number;
  /** Charge dates wobble, as real billing does. */
  dayJitter: number;
  /** Exercises detection's amount tolerance. */
  amountJitterCents: number;
  scenario: PlantedScenario;
}

// Ten recurring merchants covering every case in the spec: a price increase
// (Netflix), a trial converting in 2 days (Blue Apron), overlapping streaming
// (Netflix + Hulu) and cloud storage (iCloud + Dropbox), an unused one (Peloton),
// plus ordinary gym/music/news/software.
export const RECURRING_MERCHANTS: readonly RecurringMerchantBlueprint[] = [
  {
    key: 'netflix',
    name: 'Netflix',
    category: 'Streaming',
    cancelUrl: 'https://www.netflix.com/cancelplan',
    amountCents: 1549,
    dayOfMonth: 12,
    dayJitter: 0,
    amountJitterCents: 0,
    // Went up from $12.99 three months ago — the increase is recent enough to flag.
    scenario: { kind: 'price_increase', previousAmountCents: 1299, increasedMonthsAgo: 3 },
  },
  {
    key: 'hulu',
    name: 'Hulu',
    category: 'Streaming',
    cancelUrl: 'https://secure.hulu.com/account/cancel',
    amountCents: 1799,
    dayOfMonth: 4,
    dayJitter: 0,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'spotify',
    name: 'Spotify',
    category: 'Music',
    cancelUrl: 'https://www.spotify.com/account/subscription/',
    amountCents: 1199,
    dayOfMonth: 8,
    dayJitter: 1,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'peloton',
    name: 'Peloton App',
    category: 'Fitness',
    cancelUrl: 'https://members.onepeloton.com/preferences/subscriptions',
    amountCents: 1299,
    dayOfMonth: 21,
    dayJitter: 0,
    amountJitterCents: 0,
    // Paid for seven months, not opened in five.
    scenario: { kind: 'unused', lastUsedMonthsAgo: 5 },
  },
  {
    key: 'icloud',
    name: 'iCloud+',
    category: 'Cloud Storage',
    cancelUrl: 'https://support.apple.com/en-us/HT207594',
    amountCents: 299,
    dayOfMonth: 2,
    dayJitter: 0,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'dropbox',
    name: 'Dropbox Plus',
    category: 'Cloud Storage',
    cancelUrl: 'https://www.dropbox.com/account/plan',
    amountCents: 1199,
    dayOfMonth: 19,
    dayJitter: 0,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'nyt',
    name: 'The New York Times',
    category: 'News',
    cancelUrl: 'https://www.nytimes.com/subscription/cancel',
    amountCents: 425,
    dayOfMonth: 26,
    dayJitter: 0,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'adobe',
    name: 'Adobe Creative Cloud',
    category: 'Software',
    cancelUrl: 'https://account.adobe.com/plans',
    amountCents: 5999,
    dayOfMonth: 15,
    dayJitter: 2,
    amountJitterCents: 0,
    scenario: { kind: 'normal' },
  },
  {
    key: 'planetfitness',
    name: 'Planet Fitness',
    category: 'Fitness',
    cancelUrl: 'https://www.planetfitness.com/account',
    amountCents: 2499,
    dayOfMonth: 17,
    dayJitter: 0,
    // Tiny wobble from local tax rounding — detection must tolerate this.
    amountJitterCents: 7,
    scenario: { kind: 'normal' },
  },
  {
    key: 'blueapron',
    name: 'Blue Apron',
    category: 'Food',
    cancelUrl: 'https://www.blueapron.com/account',
    amountCents: 7192,
    dayOfMonth: 0, // unused for trials; the trial start date drives the schedule
    dayJitter: 0,
    amountJitterCents: 0,
    // The demo opens on this: converts to paid in 2 days.
    scenario: { kind: 'free_trial', convertsInDays: 2 },
  },
] as const;

export const ONE_OFF_MERCHANTS: readonly { key: string; name: string; category: string }[] = [
  { key: 'wholefoods', name: 'Whole Foods Market', category: 'Groceries' },
  { key: 'traderjoes', name: "Trader Joe's", category: 'Groceries' },
  { key: 'shell', name: 'Shell', category: 'Gas' },
  { key: 'chipotle', name: 'Chipotle', category: 'Dining' },
  { key: 'starbucks', name: 'Starbucks', category: 'Dining' },
  { key: 'uber', name: 'Uber', category: 'Transport' },
  { key: 'cvs', name: 'CVS Pharmacy', category: 'Health' },
  { key: 'target', name: 'Target', category: 'Shopping' },
] as const;

// Fixed offsets so the demo can always find them. Best Buy is the one it splits.
export const BIG_PURCHASES: readonly {
  key: string;
  name: string;
  category: string;
  amountCents: number;
  daysAgo: number;
}[] = [
  { key: 'bestbuy', name: 'Best Buy', category: 'Shopping', amountCents: 59_999, daysAgo: 9 },
  { key: 'wayfair', name: 'Wayfair', category: 'Home', amountCents: 124_900, daysAgo: 38 },
  { key: 'apple', name: 'Apple Store', category: 'Shopping', amountCents: 32_900, daysAgo: 67 },
  { key: 'delta', name: 'Delta Air Lines', category: 'Travel', amountCents: 41_250, daysAgo: 102 },
] as const;

const PAYCHECK_CENTS = 245_000;
const PAYCHECK_INTERVAL_DAYS = 14;

export interface SeedMerchant {
  key: string;
  name: string;
  category: string;
  cancelUrl: string | null;
  /** True for the ten planted recurring merchants. */
  isRecurring: boolean;
  /** YYYY-MM-DD, or null when there's no usage signal. */
  lastUsedAt: string | null;
  /** Set only for a merchant whose trial converts to a paid plan. */
  trialConvertsToCents: number | null;
}

export interface SeedTransaction {
  key: string;
  accountKey: AccountBlueprint['key'];
  merchantKey: string | null;
  source: 'purchase' | 'deposit' | 'withdrawal' | 'transfer';
  /** Signed cents — negative means money left the account. */
  amountCents: number;
  description: string;
  /** YYYY-MM-DD. */
  date: string;
  category: string;
}

export interface DemoDataset {
  customer: {
    firstName: string;
    lastName: string;
    address: { street_number: string; street_name: string; city: string; state: string; zip: string };
  };
  accounts: readonly AccountBlueprint[];
  merchants: SeedMerchant[];
  transactions: SeedTransaction[];
  scenarios: { merchantKey: string; scenario: PlantedScenario }[];
}

/** `now` is injected rather than read from the clock so tests stay stable. */
export function generateDemoDataset(now: Date = new Date()): DemoDataset {
  const rng = createRng(SEED);
  const today = startOfDay(now);
  const historyStart = addMonths(today, -HISTORY_MONTHS);

  const merchants: SeedMerchant[] = [
    ...RECURRING_MERCHANTS.map((m) => ({
      key: m.key,
      name: m.name,
      category: m.category,
      cancelUrl: m.cancelUrl,
      isRecurring: true,
      // An unused service was last opened months ago; everything else, recently.
      lastUsedAt: toIsoDate(
        m.scenario.kind === 'unused'
          ? addMonths(today, -m.scenario.lastUsedMonthsAgo)
          : addDays(today, -rng.int(0, 6)),
      ),
      trialConvertsToCents: m.scenario.kind === 'free_trial' ? m.amountCents : null,
    })),
    ...ONE_OFF_MERCHANTS.map((m) => ({
      key: m.key,
      name: m.name,
      category: m.category,
      cancelUrl: null,
      isRecurring: false,
      lastUsedAt: null,
      trialConvertsToCents: null,
    })),
    ...BIG_PURCHASES.map((m) => ({
      key: m.key,
      name: m.name,
      category: m.category,
      cancelUrl: null,
      isRecurring: false,
      lastUsedAt: null,
      trialConvertsToCents: null,
    })),
  ];

  const transactions: SeedTransaction[] = [];
  let sequence = 0;
  const nextKey = (prefix: string): string => `${prefix}-${String(++sequence).padStart(4, '0')}`;

  // Walk back from the most recent payday so the next one is predictable.
  const lastPayday = addDays(today, -((daysBetween(historyStart, today) % PAYCHECK_INTERVAL_DAYS) || 3));
  for (let date = lastPayday; date >= historyStart; date = addDays(date, -PAYCHECK_INTERVAL_DAYS)) {
    transactions.push({
      key: nextKey('pay'),
      accountKey: 'checking',
      merchantKey: null,
      source: 'deposit',
      amountCents: PAYCHECK_CENTS,
      description: 'NORTHWIND LABS PAYROLL',
      date: toIsoDate(date),
      category: 'Income',
    });
  }

  for (const merchant of RECURRING_MERCHANTS) {
    if (merchant.scenario.kind === 'free_trial') {
      // A trial is a $0 auth at signup; the first real charge is still ahead.
      const convertsOn = addDays(today, merchant.scenario.convertsInDays);
      const trialStarted = addDays(convertsOn, -30);
      transactions.push({
        key: nextKey('sub'),
        accountKey: 'credit',
        merchantKey: merchant.key,
        source: 'purchase',
        amountCents: 0,
        description: `${merchant.name} — free trial`,
        date: toIsoDate(trialStarted),
        category: merchant.category,
      });
      continue;
    }

    for (let monthsAgo = HISTORY_MONTHS; monthsAgo >= 0; monthsAgo--) {
      const anchor = addMonths(today, -monthsAgo);
      const charge = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), merchant.dayOfMonth),
      );
      const jittered = merchant.dayJitter
        ? addDays(charge, rng.int(-merchant.dayJitter, merchant.dayJitter))
        : charge;

      if (jittered > today || jittered < historyStart) continue;

      let amountCents = merchant.amountCents;

      if (merchant.scenario.kind === 'price_increase' && monthsAgo > merchant.scenario.increasedMonthsAgo) {
        amountCents = merchant.scenario.previousAmountCents;
      }
      if (merchant.amountJitterCents) {
        amountCents += rng.int(-merchant.amountJitterCents, merchant.amountJitterCents);
      }

      transactions.push({
        key: nextKey('sub'),
        accountKey: 'credit',
        merchantKey: merchant.key,
        source: 'purchase',
        amountCents: -amountCents,
        description: merchant.name,
        date: toIsoDate(jittered),
        category: merchant.category,
      });
    }
  }

  // everyday spend
  for (let date = historyStart; date <= today; date = addDays(date, 1)) {
    const purchasesToday = rng.chance(0.55) ? rng.int(1, 3) : 0;
    for (let i = 0; i < purchasesToday; i++) {
      const merchant = rng.pick(ONE_OFF_MERCHANTS);
      // Capped below the $100 Pay Over Time floor so only the planted
      // big-ticket purchases show up as eligible to split.
      const amountCents = Math.round(rng.money(6, 95) * 100);
      transactions.push({
        key: nextKey('buy'),
        accountKey: 'credit',
        merchantKey: merchant.key,
        source: 'purchase',
        amountCents: -amountCents,
        description: merchant.name,
        date: toIsoDate(date),
        category: merchant.category,
      });
    }
  }

  for (const purchase of BIG_PURCHASES) {
    transactions.push({
      key: nextKey('big'),
      accountKey: 'credit',
      merchantKey: purchase.key,
      source: 'purchase',
      amountCents: -purchase.amountCents,
      description: purchase.name,
      date: toIsoDate(addDays(today, -purchase.daysAgo)),
      category: purchase.category,
    });
  }

  // rent and a standing transfer to savings
  for (let monthsAgo = HISTORY_MONTHS; monthsAgo >= 0; monthsAgo--) {
    const anchor = addMonths(today, -monthsAgo);
    const rentDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    if (rentDate <= today && rentDate >= historyStart) {
      transactions.push({
        key: nextKey('rent'),
        accountKey: 'checking',
        merchantKey: null,
        source: 'withdrawal',
        amountCents: -185_000,
        description: 'RENT — ASHWOOD PROPERTIES',
        date: toIsoDate(rentDate),
        category: 'Housing',
      });
    }

    const savingsDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 5));
    if (savingsDate <= today && savingsDate >= historyStart) {
      transactions.push({
        key: nextKey('xfer'),
        accountKey: 'checking',
        merchantKey: null,
        source: 'transfer',
        amountCents: -40_000,
        description: 'Transfer to 360 Performance Savings',
        date: toIsoDate(savingsDate),
        category: 'Transfer',
      });
    }
  }

  // Stable tiebreak so the ordering is total.
  transactions.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));

  return {
    customer: {
      firstName: 'Jordan',
      lastName: 'Rivera',
      address: {
        street_number: '1680',
        street_name: 'Capital One Dr',
        city: 'McLean',
        state: 'VA',
        zip: '22102',
      },
    },
    accounts: ACCOUNT_BLUEPRINTS,
    merchants,
    transactions,
    scenarios: RECURRING_MERCHANTS.map((m) => ({ merchantKey: m.key, scenario: m.scenario })),
  };
}
