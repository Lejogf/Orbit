import { describe, expect, test } from 'vitest';
import {
  classify,
  editDistance,
  extractAccounts,
  extractAmountCents,
  extractMerchant,
  extractPage,
  isFrustrated,
  looksSpanish,
} from '../features/ori/nlu.js';
import { INITIAL_STATE, respond, type OriContext } from '../features/ori/respond.js';
import { guideFor } from '../features/ori/pages.js';

const context: OriContext = {
  firstName: 'Jordan',
  page: '/dashboard',
  accounts: [
    { id: 'chk', type: 'Checking', nickname: 'Checking', last4: '1234', balanceCents: 250_000, creditLimitCents: null, isLocked: false, rewardsCents: 0 },
    { id: 'sav', type: 'Savings', nickname: 'Savings', last4: '5678', balanceCents: 800_000, creditLimitCents: null, isLocked: false, rewardsCents: 0 },
    { id: 'card', type: 'Credit Card', nickname: 'Venture', last4: '9012', balanceCents: 120_000, creditLimitCents: 800_000, isLocked: false, rewardsCents: 42_000 },
  ],
  safeToSpend: { cents: 150_000, committedCents: 100_000, nextPayday: '2026-10-01T00:00:00.000Z', daysUntilPayday: 12 },
  subscriptions: [
    { id: 's1', merchantName: 'Netflix', amountCents: 1549, frequency: 'monthly', status: 'active', nextChargeDate: '2026-09-25T00:00:00.000Z', isFreeTrial: false, hasPriceIncrease: true, isDuplicate: true, looksUnused: false, cancelUrl: 'https://netflix.com/cancel' },
    { id: 's2', merchantName: 'Spotify Premium', amountCents: 1199, frequency: 'monthly', status: 'active', nextChargeDate: '2026-09-28T00:00:00.000Z', isFreeTrial: false, hasPriceIncrease: false, isDuplicate: false, looksUnused: false, cancelUrl: null },
    { id: 's3', merchantName: 'Hulu', amountCents: 1799, frequency: 'monthly', status: 'blocked', nextChargeDate: '2026-09-30T00:00:00.000Z', isFreeTrial: false, hasPriceIncrease: false, isDuplicate: true, looksUnused: false, cancelUrl: null },
  ],
  upcoming: [{ label: 'Netflix', amountCents: -1549, date: '2026-09-25T00:00:00.000Z', kind: 'subscription' }],
  recent: [{ description: 'Chipotle', amountCents: -1450, postedAt: '2026-09-18T00:00:00.000Z', category: 'Dining' }],
  spending: { monthTotalCents: 180_000, previousTotalCents: 210_000, top: [{ category: 'Groceries', cents: 60_000 }] },
  credit: { score: 742, band: 'good', weakest: { label: 'Utilization', detail: 'Your card is 15% used.' }, strongest: { label: 'Payment history' } },
  plans: { activeCount: 1, monthlyTotalCents: 10_000 },
  eligiblePurchase: { id: 'tx1', merchant: 'Best Buy', amountCents: 59_999 },
  unreadAlerts: 2,
};

describe('classify', () => {
  test.each([
    ['what is my balance', 'balance'],
    ['how much can i spend this week', 'safe_to_spend'],
    ['can I afford $200 shoes', 'safe_to_spend'],
    ['lock my card', 'lock_card'],
    ['unlock my card please', 'unlock_card'],
    ['i lost my wallet and card', 'lost_card'],
    ['block netflix', 'block_subscription'],
    ['cancel hulu', 'cancel_subscription'],
    ['ask me first before spotify charges', 'guard_subscription'],
    ['move $200 to savings', 'transfer'],
    ['I want to talk to a real person', 'human'],
    ['someone called and asked for my code', 'scam'],
    ['I dont recognize this charge', 'unknown_charge'],
    ['book a flight to miami', 'travel'],
    ['split the bill with friends', 'split_bill'],
    ['I got married and need to change my name', 'change_name'],
    ['i moved, new address', 'change_address'],
    ['the text is too small', 'bigger_text'],
    ['what is this page', 'explain_page'],
    ['im new, show me around', 'tour'],
    ['where does my money go', 'spending'],
    ['whats my credit score', 'credit_score'],
  ])('"%s" -> %s', (message, intent) => {
    expect(classify(message).intent).toBe(intent);
  });

  test('recognises someone introducing themselves', () => {
    expect(classify('hi, my name is Dana').intent).toBe('introduction');
    expect(classify('me llamo Ana').intent).toBe('introduction');
  });

  test('tolerates a typo in a keyword', () => {
    expect(classify('show my subscriptons').intent).toBe('subscriptions');
    expect(classify('whats my balanse').intent).toBe('balance');
  });

  test('understands Spanish', () => {
    expect(classify('quiero bloquear tarjeta').intent).toBe('lock_card');
    expect(classify('cuanto dinero tengo').intent).toBe('balance');
  });

  test('vetoes flip meaning: "unlock" is not "lock"', () => {
    expect(classify('unlock').intent).toBe('unlock_card');
  });

  test('prefers a specific intent over generic navigation', () => {
    expect(classify('take me to my subscriptions').intent).toBe('subscriptions');
  });

  test('falls back on gibberish', () => {
    expect(classify('purple elephant dance').intent).toBe('fallback');
  });
});

describe('entities', () => {
  test('amounts in several forms', () => {
    expect(extractAmountCents('move $1,250.50 to savings')).toBe(125_050);
    expect(extractAmountCents('send 40 dollars')).toBe(4000);
    expect(extractAmountCents('a hundred to savings')).toBe(10_000);
    expect(extractAmountCents('move money')).toBeNull();
  });

  test('merchants by partial name and with a typo', () => {
    const names = context.subscriptions.map((s) => s.merchantName);
    expect(extractMerchant('block spotify', names)).toBe('Spotify Premium');
    expect(extractMerchant('cancel netflx', names)).toBe('Netflix');
    expect(extractMerchant('block my gym', names)).toBeNull();
  });

  test('from and to accounts', () => {
    expect(extractAccounts('move 50 from savings to checking')).toEqual({ from: 'savings', to: 'checking' });
  });

  test('pages', () => {
    expect(extractPage('open accessibility')?.href).toBe('/settings/accessibility');
    expect(extractPage('go to travel')?.href).toBe('/travel');
  });

  test('edit distance', () => {
    expect(editDistance('balance', 'balanse')).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 2)).toBe(3);
  });
});

describe('isFrustrated / looksSpanish', () => {
  test('detects frustration and shouting', () => {
    expect(isFrustrated('this is useless')).toBe(true);
    expect(isFrustrated('WHY IS MY CARD NOT WORKING')).toBe(true);
    expect(isFrustrated('help!!!')).toBe(true);
    expect(isFrustrated('what is my balance')).toBe(false);
  });

  test('detects Spanish', () => {
    expect(looksSpanish('quiero ver mi saldo por favor')).toBe(true);
    expect(looksSpanish('what is my balance')).toBe(false);
  });
});

describe('respond', () => {
  test('greets someone by the name they gave, and offers help', () => {
    const reply = respond('hello, my name is Dana', context);
    expect(reply.text).toContain('Nice to meet you, Dana');
    expect(reply.text).toContain('What can I do for you?');
  });

  test('"I\'m new" is not read as a name', () => {
    expect(respond("hi I'm new here", context).text).not.toContain("Nice to meet you, New");
  });

  test('answers balance from real data', () => {
    const reply = respond('what is my balance', context);
    expect(reply.text).toContain('$2,500.00');
    expect(reply.facts).toHaveLength(3);
  });

  test('checks affordability against Safe to Spend', () => {
    expect(respond('can I afford $200', context).text).toMatch(/^Yep/);
    expect(respond('can I afford $2000', context).text).toContain('short for bills');
  });

  test('proposes, never performs, a card lock', () => {
    const reply = respond('lock my card', context);
    expect(reply.proposal?.action).toEqual({ type: 'lock_card', accountId: 'card', locked: true });
  });

  test('proposes a transfer with the right accounts and amount', () => {
    const reply = respond('move $200 from checking to savings', context);
    expect(reply.proposal?.action).toEqual({ type: 'transfer', fromAccountId: 'chk', toAccountId: 'sav', amountCents: 20_000 });
  });

  test('refuses a transfer larger than the balance, without failing', () => {
    const reply = respond('move $5000 from checking to savings', context);
    expect(reply.proposal).toBeNull();
    expect(reply.text).toContain("won't fit");
  });

  test('asks which subscription when none is named', () => {
    const reply = respond('block a subscription', context);
    expect(reply.proposal).toBeNull();
    expect(reply.suggestions.some((s) => s.includes('Netflix'))).toBe(true);
  });

  test('says an already blocked subscription is blocked', () => {
    expect(respond('block hulu', context).text).toContain('already blocked');
  });

  test('proposes blocking a named subscription with the yearly saving', () => {
    const reply = respond('block netflix', context);
    expect(reply.proposal?.action).toEqual({ type: 'subscription', subscriptionId: 's1', action: 'block' });
    expect(reply.text).toContain('$185.88');
  });

  test('scams always offer a person and a card lock', () => {
    const reply = respond('someone called asking for my code, is this a scam', context);
    expect(reply.handoff?.urgent).toBe(true);
    expect(reply.proposal?.action.type).toBe('lock_card');
  });

  test('two misses in a row escalate to a person instead of looping', () => {
    const first = respond('purple elephant', context);
    expect(first.handoff?.urgent).toBe(false);
    const second = respond('banana telescope', context, first.state);
    expect(second.handoff?.urgent).toBe(true);
    expect(second.text).toContain('person');
    expect(second.text).not.toMatch(/try again later/i);
  });

  test('frustration escalates immediately', () => {
    const reply = respond('this is useless, what is my balance', context);
    expect(reply.handoff?.urgent).toBe(true);
    expect(reply.text).toContain('$2,500.00'); // still answers
  });

  test('asking the same thing twice escalates', () => {
    const first = respond('what is my balance', context);
    const again = respond('what is my balance', context, first.state);
    expect(again.handoff?.urgent).toBe(true);
  });

  test('bigger text changes the display immediately', () => {
    expect(respond('the text is too small', context).effect).toEqual({ type: 'text_scale', scale: 1.25 });
  });

  test('explains the current page in plain words', () => {
    const reply = respond('what is this page', { ...context, page: '/subscriptions/abc' });
    expect(reply.text).toMatch(/^Subscriptions:/);
  });

  test('replies in Spanish when spoken to in Spanish', () => {
    const reply = respond('hola, cuanto dinero tengo por favor', context);
    expect(reply.state.lang).toBe('es');
    expect(reply.text).toContain('Tienes');
  });

  test('a page name alone still gets you there', () => {
    const reply = respond('spending', { ...context }, INITIAL_STATE);
    expect(reply.links[0]?.href).toBe('/spending');
  });
});

describe('guideFor', () => {
  test('longest prefix wins', () => {
    expect(guideFor('/settings/accessibility')?.title).toBe('Accessibility');
    expect(guideFor('/settings')?.title).toBe('Settings');
    expect(guideFor('/nowhere')).toBeNull();
  });
});
