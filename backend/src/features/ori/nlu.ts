// Ori's language understanding: no model, no network, no API key.
//
// Messages are normalised, tokenised and scored against a catalogue of intents.
// Matching tolerates the typos people actually make on a phone keyboard (one
// wrong letter in a word of five or more), understands common Spanish phrasing,
// and pulls out the things an answer needs: an amount, a merchant, an account,
// a page. It is deliberately explainable — every match can say which words
// triggered it, which is what makes it testable and safe for money movement.

export type IntentId =
  | 'greeting'
  | 'introduction'
  | 'thanks'
  | 'balance'
  | 'safe_to_spend'
  | 'recent_transactions'
  | 'spending'
  | 'unknown_charge'
  | 'scam'
  | 'subscriptions'
  | 'block_subscription'
  | 'guard_subscription'
  | 'cancel_subscription'
  | 'upcoming'
  | 'lock_card'
  | 'unlock_card'
  | 'lost_card'
  | 'transfer'
  | 'pay_card'
  | 'pay_over_time'
  | 'plans'
  | 'credit_score'
  | 'improve_credit'
  | 'rewards'
  | 'travel'
  | 'offers'
  | 'split_bill'
  | 'change_address'
  | 'change_name'
  | 'password'
  | 'accessibility'
  | 'bigger_text'
  | 'explain_page'
  | 'tour'
  | 'navigate'
  | 'human'
  | 'dispute'
  | 'alerts'
  | 'fallback';

interface IntentRule {
  id: IntentId;
  /** Words or phrases that suggest the intent, with how strongly. */
  cues: [string, number][];
  /** Phrases that rule it out ("don't lock" is not "lock"). */
  vetoes?: string[];
}

// Phrases are matched against the normalised message; single words are matched
// against tokens, with typo tolerance. Weights are tuned so one strong cue
// (≥ 2) is enough, while generic words (≤ 1) need company.
const RULES: IntentRule[] = [
  { id: 'greeting', cues: [['hi', 1.5], ['hello', 2], ['hey', 1.5], ['good morning', 2], ['hola', 2], ['buenos dias', 2]] },
  {
    id: 'introduction',
    cues: [['my name is', 3.4], ['i am called', 3.4], ['call me', 2.6], ['nice to meet', 3], ['me llamo', 3.4], ['soy', 1.4], ['this is my first time', 2.6]],
  },
  { id: 'thanks', cues: [['thanks', 2.5], ['thank you', 2.5], ['thx', 2], ['gracias', 2.5], ['perfect', 1], ['great', 0.8]] },
  {
    id: 'balance',
    cues: [['balance', 2.5], ['how much money', 2.5], ['how much do i have', 2.5], ['in my account', 1.2], ['checking', 1], ['savings', 1], ['saldo', 2.5], ['cuanto dinero', 2.5], ['money', 0.6]],
  },
  {
    id: 'safe_to_spend',
    cues: [['safe to spend', 3], ['can i afford', 3], ['afford', 2.2], ['can i spend', 2.8], ['how much can i', 2.4], ['spend this week', 2.5], ['until payday', 2.5], ['till payday', 2.5], ['left to spend', 2.8], ['puedo gastar', 3]],
  },
  {
    id: 'recent_transactions',
    cues: [['recent', 1.6], ['transactions', 2.2], ['transaction', 2], ['last purchase', 2.5], ['what did i buy', 2.8], ['purchases', 1.8], ['history', 1.4], ['statement', 1.6], ['movimientos', 2.5], ['compras', 2]],
  },
  {
    id: 'spending',
    cues: [['spending', 2.4], ['spent', 2], ['spend on', 2], ['where does my money go', 3], ['where my money', 2.5], ['habits', 2], ['budget', 1.8], ['categories', 1.5], ['how much did i spend', 3], ['gastos', 2.5], ['gaste', 2.2]],
  },
  {
    id: 'unknown_charge',
    cues: [['dont recognize', 3], ['do not recognize', 3], ['didnt make', 3], ['did not make', 3], ['what is this charge', 3], ['strange charge', 3], ['weird charge', 3], ['unknown charge', 3], ['suspicious', 2.5], ['fraud', 3], ['unauthorized', 3], ['not mine', 2.5], ['no reconozco', 3]],
  },
  {
    id: 'scam',
    cues: [['scam', 3], ['someone called', 2.8], ['asked for my code', 3], ['asked for my password', 3], ['gift card', 2.2], ['is this real', 2], ['phishing', 3], ['text message from', 1.8], ['they said they were', 2.5], ['grandson', 1.8], ['irs', 2], ['estafa', 3], ['fraude', 2.5]],
  },
  {
    id: 'subscriptions',
    cues: [['subscriptions', 2.6], ['subscription', 2.2], ['subscribed', 2.4], ['recurring', 2], ['memberships', 2], ['what am i paying for', 2.8], ['suscripciones', 2.6]],
  },
  { id: 'block_subscription', cues: [['block', 2.6], ['stop charging', 3], ['stop paying', 2.6], ['stop', 1.2], ['bloquear', 2.6]], vetoes: ['unblock', 'dont block', 'do not block'] },
  { id: 'guard_subscription', cues: [['ask me first', 3], ['ask first', 3], ['guard', 2.6], ['approve before', 2.8], ['ask before', 2.6], ['warn me before', 2.4]] },
  { id: 'cancel_subscription', cues: [['cancel', 2.6], ['unsubscribe', 3], ['get rid of', 2.2], ['cancelar', 2.6]], vetoes: ['dont cancel', 'do not cancel'] },
  {
    id: 'upcoming',
    cues: [['upcoming', 2.5], ['due', 1.8], ['coming up', 2.5], ['next payment', 2.5], ['bills', 2], ['what do i owe', 2.5], ['this week', 0.8], ['renew', 1.8], ['renewal', 1.8], ['proximos pagos', 2.5]],
  },
  { id: 'lock_card', cues: [['lock my card', 3.2], ['lock card', 3.2], ['freeze', 2.8], ['lock', 2], ['bloquear tarjeta', 3.2], ['congelar', 2.8]], vetoes: ['unlock', 'unfreeze'] },
  { id: 'unlock_card', cues: [['unlock', 3.2], ['unfreeze', 3.2], ['desbloquear', 3.2]] },
  { id: 'lost_card', cues: [['lost', 2.6], ['stolen', 3], ['cant find my card', 3], ['missing card', 3], ['perdi', 2.6], ['robaron', 3], ['new card', 1.5], ['replace', 1.6], ['replacement', 1.8]] },
  { id: 'transfer', cues: [['transfer', 2.6], ['move money', 3], ['move', 1], ['send', 1.2], ['to savings', 1.6], ['to checking', 1.6], ['transferir', 2.6]] },
  { id: 'pay_card', cues: [['pay my card', 3], ['pay card', 2.8], ['pay my bill', 2.6], ['pay the balance', 2.6], ['credit card payment', 2.8], ['make a payment', 2.8], ['pagar tarjeta', 3]] },
  { id: 'pay_over_time', cues: [['pay over time', 3], ['split this purchase', 3], ['installment', 2.8], ['instalment', 2.8], ['monthly payments', 2.4], ['finance', 1.6], ['split into', 2.2], ['a plazos', 3]] },
  { id: 'plans', cues: [['my plans', 2.8], ['payment plans', 2.8], ['active plans', 2.8], ['plans', 1.4], ['pay off', 1.6]] },
  { id: 'credit_score', cues: [['credit score', 3], ['my score', 2.6], ['fico', 3], ['credit', 1.4], ['puntaje', 2.8], ['credito', 1.6]] },
  { id: 'improve_credit', cues: [['improve my credit', 3.2], ['raise my score', 3.2], ['improve', 1.6], ['raise', 1.2], ['better score', 3], ['boost', 1.6], ['mejorar', 1.8]] },
  { id: 'rewards', cues: [['rewards', 2.6], ['miles', 2.4], ['points', 2], ['cash back', 2.4], ['cashback', 2.4], ['redeem', 2.4], ['recompensas', 2.6], ['millas', 2.4]] },
  { id: 'travel', cues: [['flight', 2.8], ['flights', 2.8], ['book a trip', 3], ['trip', 2], ['hotel', 2.6], ['travel', 2.4], ['fly to', 3], ['vacation', 2.4], ['vuelo', 2.8], ['viaje', 2.6]] },
  { id: 'offers', cues: [['offers', 2.8], ['deals', 2.6], ['discount', 2.2], ['coupons', 2.4], ['ofertas', 2.8]] },
  { id: 'split_bill', cues: [['split the bill', 3.2], ['split a bill', 3.2], ['split the check', 3.2], ['split', 1.4], ['receipt', 2.8], ['owe me', 2.4], ['share the cost', 2.8], ['dividir', 2.8], ['recibo', 2.6]] },
  { id: 'change_address', cues: [['change my address', 3.2], ['new address', 3], ['address', 2.2], ['i moved', 3], ['moving', 2.2], ['direccion', 2.6], ['me mude', 3]] },
  { id: 'change_name', cues: [['change my name', 3.2], ['legal name', 3], ['name change', 3.2], ['got married', 3], ['married', 2.2], ['divorce', 2.6], ['maiden name', 3], ['my name', 1.2], ['cambiar mi nombre', 3.2]] },
  { id: 'password', cues: [['password', 2.8], ['forgot', 1.6], ['reset', 1.6], ['sign in', 1.2], ['log in', 1.2], ['username', 2.4], ['contrasena', 2.8]] },
  { id: 'accessibility', cues: [['accessibility', 3], ['screen reader', 3], ['high contrast', 3], ['dyslexia', 3], ['colorblind', 3], ['color blind', 3], ['read aloud', 3], ['read it to me', 3], ['voice', 1.6], ['simple mode', 3], ['easier', 1.8], ['accesibilidad', 3]] },
  { id: 'bigger_text', cues: [['bigger text', 3.4], ['larger text', 3.4], ['text bigger', 3.4], ['hard to read', 3], ['cant see', 3], ['can not see', 3], ['too small', 3], ['font size', 3], ['zoom', 2.2], ['letra grande', 3.4], ['mas grande', 2.6]] },
  { id: 'explain_page', cues: [['what is this page', 3.2], ['what am i looking at', 3.2], ['explain this', 3], ['what does this mean', 2.8], ['what is this', 1.8], ['help me here', 2.4], ['what can i do here', 3], ['que es esto', 3]] },
  { id: 'tour', cues: [['show me around', 3.2], ['im new', 3], ['i am new', 3], ['first time', 3], ['how does this work', 3], ['how do i use', 2.8], ['tour', 2.8], ['getting started', 3], ['walk me through', 3], ['soy nuevo', 3]] },
  { id: 'navigate', cues: [['go to', 2], ['take me to', 2.6], ['open', 1.4], ['show me', 1.2], ['where is', 1.8], ['where do i', 1.8], ['find', 1], ['ir a', 2], ['llevame', 2.6]] },
  {
    id: 'human',
    cues: [['real person', 3.4], ['human', 3], ['agent', 2.8], ['representative', 3], ['someone to talk to', 3], ['talk to someone', 3.2], ['speak to someone', 3.2], ['customer service', 3], ['customer support', 3], ['call me', 3], ['phone number', 2.6], ['operator', 3], ['live chat', 3], ['persona real', 3.4], ['agente', 2.8], ['hablar con alguien', 3.2]],
  },
  { id: 'dispute', cues: [['dispute', 3], ['refund', 2.4], ['charged twice', 3], ['double charged', 3], ['wrong amount', 2.8], ['overcharged', 3], ['reclamo', 3]] },
  { id: 'alerts', cues: [['alerts', 2.6], ['notifications', 2.6], ['notify me', 2.6], ['text me', 2], ['alert me', 2.6], ['alertas', 2.6], ['notificaciones', 2.6]] },
];

/** Signs the customer is losing patience, which should end the bot loop. */
const FRUSTRATION = [
  'useless', 'not helping', 'doesnt help', 'you dont understand', 'not what i asked',
  'stupid', 'frustrated', 'annoying', 'waste of time', 'ridiculous', 'this is not working',
  'still not', 'again', 'no no', 'wrong', 'terrible', 'hate this', 'inutil', 'no sirve',
];

export const PAGES: { href: string; words: string[]; label: string }[] = [
  { href: '/dashboard', words: ['home', 'dashboard', 'main', 'inicio'], label: 'Home' },
  { href: '/accounts', words: ['accounts', 'account', 'checking', 'savings', 'cuentas'], label: 'Accounts' },
  { href: '/spending', words: ['spending', 'insights', 'budget', 'gastos'], label: 'Spending' },
  { href: '/subscriptions', words: ['subscriptions', 'subscription', 'suscripciones'], label: 'Subscriptions' },
  { href: '/plans', words: ['plans', 'installments', 'planes'], label: 'Pay Over Time' },
  { href: '/credit', words: ['credit', 'score', 'credito'], label: 'Credit' },
  { href: '/travel', words: ['travel', 'trips', 'flights', 'hotels', 'rewards', 'offers', 'viajes'], label: 'Travel & Rewards' },
  { href: '/split', words: ['split', 'receipt', 'dividir'], label: 'Split a bill' },
  { href: '/alerts', words: ['alerts', 'notifications', 'inbox', 'alertas'], label: 'Alerts' },
  { href: '/transfer', words: ['transfer', 'transfers', 'transferir'], label: 'Transfer' },
  { href: '/settings', words: ['settings', 'profile', 'preferences', 'ajustes'], label: 'Settings' },
  { href: '/settings/accessibility', words: ['accessibility', 'accesibilidad'], label: 'Accessibility' },
  { href: '/support', words: ['support', 'help', 'ayuda', 'soporte'], label: 'Help & Support' },
];

// --- normalisation ---

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "dirección" -> "direccion"
    .replace(/[’']/g, '') // "don't" -> "dont"
    .replace(/[^a-z0-9$.,\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return normalise(text)
    .replace(/[.,]/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Levenshtein distance, bailing out early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** A token matches a cue word exactly, or with one typo when both are long enough. */
function wordMatches(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length >= 5 && token.length >= 4) return editDistance(token, word, 1) <= 1;
  // Plurals: "subscription" vs "subscriptions".
  return token === `${word}s` || word === `${token}s`;
}

function cueMatches(message: string, words: string[], cue: string): boolean {
  if (cue.includes(' ')) {
    if (message.includes(cue)) return true;
    // Phrases tolerate a typo in each word, in order.
    const parts = cue.split(' ');
    for (let start = 0; start <= words.length - parts.length; start++) {
      if (parts.every((part, k) => wordMatches(words[start + k]!, part))) return true;
    }
    return false;
  }
  return words.some((w) => wordMatches(w, cue));
}

export interface Classification {
  intent: IntentId;
  score: number;
  /** Runner-up, when it was close — lets Ori ask "did you mean". */
  alternative: IntentId | null;
  matched: string[];
}

const THRESHOLD = 2;

export function classify(message: string): Classification {
  const norm = normalise(message);
  const words = tokens(message);

  const scored = RULES.map((rule) => {
    if (rule.vetoes?.some((v) => norm.includes(v))) return { id: rule.id, score: 0, matched: [] as string[] };
    const matched = rule.cues.filter(([cue]) => cueMatches(norm, words, cue));
    // Diminishing returns, so a pile of weak cues can't beat one strong one.
    const sorted = matched.map(([, w]) => w).sort((a, b) => b - a);
    const score = sorted.reduce((sum, w, i) => sum + w / (i + 1), 0);
    return { id: rule.id, score, matched: matched.map(([c]) => c) };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  const second = scored[1]!;

  // "Navigate" is generic: if a more specific intent also fired, prefer it.
  if (top.id === 'navigate' && second.score >= THRESHOLD - 0.4) {
    return { intent: second.id, score: second.score, alternative: 'navigate', matched: second.matched };
  }

  if (top.score < THRESHOLD) {
    return { intent: 'fallback', score: top.score, alternative: top.score > 0.9 ? top.id : null, matched: top.matched };
  }

  return {
    intent: top.id,
    score: top.score,
    alternative: second.score >= top.score * 0.85 && second.score >= THRESHOLD ? second.id : null,
    matched: top.matched,
  };
}

export function isFrustrated(message: string): boolean {
  const norm = normalise(message);
  if (FRUSTRATION.some((f) => norm.includes(f))) return true;
  // Shouting: mostly capitals over a meaningful length, or a run of "!!!".
  const letters = message.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) return true;
  return /!{3,}|\?{3,}/.test(message);
}

// --- entities ---

/** "$250", "250 dollars", "250.50", "a hundred" (common spoken amounts). */
export function extractAmountCents(message: string): number | null {
  const norm = normalise(message);
  // A thousands group must actually be present before it is preferred, or
  // "$2000" would stop at "200" — a tenfold error in a money movement.
  const number = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  const match = norm.match(new RegExp(`\\$\\s?${number}`)) ??
    norm.match(new RegExp(`${number}\\s*(dollars|bucks|usd|dolares)`)) ??
    norm.match(/\b(\d+(?:\.\d{1,2})?)\b/);
  if (match) {
    const value = Number(match[1]!.replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100);
  }
  const words: Record<string, number> = { 'a hundred': 100, 'one hundred': 100, 'fifty': 50, 'twenty': 20, 'a thousand': 1000, 'five hundred': 500, 'two hundred': 200 };
  for (const [phrase, value] of Object.entries(words)) {
    if (norm.includes(phrase)) return value * 100;
  }
  return null;
}

/** Best merchant match from a known list, tolerant of case, spacing and a typo. */
export function extractMerchant(message: string, merchants: string[]): string | null {
  const norm = normalise(message);
  const words = tokens(message);
  let best: { name: string; score: number } | null = null;

  for (const name of merchants) {
    const nameNorm = normalise(name);
    const nameWords = nameNorm.split(' ').filter((w) => w.length >= 3 && !['the', 'and', 'plus', 'inc'].includes(w));
    let score = 0;
    if (norm.includes(nameNorm)) score = 10;
    else {
      const hits = nameWords.filter((nw) => words.some((w) => wordMatches(w, nw)));
      // The first word of a brand carries it: "spotify" for "Spotify Premium".
      if (hits.length > 0) score = hits.length + (hits.includes(nameWords[0] ?? '') ? 1 : 0);
    }
    if (score > 0 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name ?? null;
}

export type AccountRef = 'checking' | 'savings' | 'card';

export function extractAccounts(message: string): { from: AccountRef | null; to: AccountRef | null } {
  const norm = normalise(message);
  const find = (text: string): AccountRef | null => {
    if (/checking|cheques/.test(text)) return 'checking';
    if (/savings|ahorros/.test(text)) return 'savings';
    if (/card|tarjeta/.test(text)) return 'card';
    return null;
  };
  const to = norm.match(/\b(?:to|into|a)\s+(?:my\s+)?(\w+)/);
  const from = norm.match(/\bfrom\s+(?:my\s+)?(\w+)/);
  return { from: from ? find(from[1]!) : null, to: to ? find(to[1]!) : null };
}

export function extractPage(message: string): (typeof PAGES)[number] | null {
  const words = tokens(message);
  // Prefer the most specific (longest) page word that appears.
  let best: { page: (typeof PAGES)[number]; len: number } | null = null;
  for (const page of PAGES) {
    for (const word of page.words) {
      if (words.some((w) => wordMatches(w, word)) && (!best || word.length > best.len)) {
        best = { page, len: word.length };
      }
    }
  }
  return best?.page ?? null;
}

/** "fly to Miami", "trip to Tokyo" -> the destination city word(s). */
export function extractDestination(message: string): string | null {
  const match = normalise(message).match(/\b(?:to|a)\s+([a-z]+(?:\s[a-z]+)?)/);
  if (!match) return null;
  const ignore = new Set(['my', 'the', 'savings', 'checking', 'card', 'someone', 'a', 'go', 'book', 'see', 'fly']);
  const first = match[1]!.split(' ')[0]!;
  return ignore.has(first) ? null : match[1]!;
}

/**
 * The name from an introduction: "my name is Dana", "I'm Dana", "me llamo Dana".
 * Returns it capitalised, or null when the message isn't an introduction.
 */
export function extractName(message: string): string | null {
  const match = message.match(
    /\b(?:my name is|i am called|call me|me llamo|mi nombre es|i'?m|im|soy)\s+([\p{L}][\p{L}'’-]{1,20})/iu,
  );
  const candidate = match?.[1];
  if (!candidate) return null;
  // "I'm new", "I'm here" and friends are statements, not introductions.
  const notNames = new Set(['new', 'here', 'back', 'sorry', 'not', 'trying', 'looking', 'having', 'confused', 'lost', 'nuevo', 'aqui']);
  if (notNames.has(candidate.toLowerCase())) return null;
  return candidate[0]!.toUpperCase() + candidate.slice(1).toLowerCase();
}

/** Spanish detection from common function words, so Ori can answer in kind. */
export function looksSpanish(message: string): boolean {
  const words = tokens(message);
  const markers = ['que', 'como', 'mi', 'mis', 'quiero', 'puedo', 'cuanto', 'donde', 'por', 'favor', 'tarjeta', 'hola', 'necesito', 'ayuda', 'gracias', 'el', 'la', 'los', 'las', 'es', 'esto'];
  const hits = words.filter((w) => markers.includes(w)).length;
  return hits >= 2 || (words.length <= 2 && hits >= 1 && ['hola', 'gracias', 'ayuda'].some((m) => words.includes(m)));
}
