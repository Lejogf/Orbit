// Gemini, as Ori's voice — and only its voice.
//
// The safety rule from the start of this project has not changed: **anything
// that moves money or changes a card is proposed by the rule engine and
// confirmed by the customer.** A language model is very good at wording and
// very bad at being trusted with someone's account, so the split here is
// absolute:
//
//   * The rule engine (`features/ori/`) decides the intent, reads the
//     customer's real figures, and builds any proposal. Those are facts and
//     they are not sent back through the model to be "improved".
//   * Gemini is asked for two things and nothing else:
//       1. **Phrasing** — say the rule engine's answer more naturally, in the
//          customer's language, without changing a single number.
//       2. **Navigation** — when the rule engine did not understand, work out
//          which screen the customer wants, chosen from a fixed list of paths.
//
// Anything the model returns is validated before it is used: a navigation
// target must be one of the known pages, and a rephrase must still contain
// every figure the original did, or it is discarded and the original is sent.
// If Gemini is slow, unreachable, unconfigured or simply wrong, the rule-based
// reply goes out unchanged — so the assistant never gets worse than it was.

import { config, readGeminiKey } from '../config.js';
import { PAGE_PATHS, guideFor } from '../features/ori/pages.js';
import type { OriContext, OriReply } from '../features/ori/respond.js';

/** Ori is a chat assistant: a slow answer is a failed answer. */
const PHRASE_DEADLINE_MS = 8_000;

/**
 * Gemini 3 thinks before it answers, and those thinking tokens come out of
 * `maxOutputTokens`. A 400-token budget produced a *truncated* reply — "You've
 * got $4,130.84 available to spend", with the payday date silently gone. So the
 * budget is generous, thinking is turned down, and `finishReason` is checked:
 * a cut-off answer about someone's money is worse than no answer at all.
 */
const THINKING = { thinkingLevel: 'low' } as const;

export interface GeminiStatus {
  configured: boolean;
  model: string;
  enabled: boolean;
}

export function geminiStatus(): GeminiStatus {
  return { configured: config.gemini.hasKey, model: config.gemini.model, enabled: config.gemini.enabled };
}

interface GeminiPart {
  text?: string;
}

/**
 * One call to Gemini. Returns the text, or null for every failure mode there
 * is — the caller always has a working reply to fall back on.
 *
 * This key authenticates by header. Passing it as `?key=` returns 404.
 */
async function generate(
  system: string,
  user: string,
  options: { json?: boolean; maxOutputTokens?: number; deadlineMs?: number } = {},
): Promise<string | null> {
  if (!config.gemini.enabled) return null;

  const url = `${config.gemini.baseUrl}/models/${config.gemini.model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 2_000,
      thinkingConfig: THINKING,
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const timeout = AbortSignal.timeout(options.deadlineMs ?? config.gemini.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': readGeminiKey() },
      body: JSON.stringify(body),
      signal: timeout,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    };
    const candidate = payload.candidates?.[0];
    // MAX_TOKENS means the answer was cut off mid-sentence; SAFETY and the rest
    // mean there is no answer. Only a clean stop is usable.
    if (!candidate || candidate.finishReason !== 'STOP') return null;

    const text = candidate.content?.parts?.map((p) => p.text ?? '').join('').trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// --- 1. phrasing ----------------------------------------------------------

/**
 * Every figure a customer could act on: amounts, percentages, large numbers and
 * short dates. Dates are in here because "free until payday on Oct 1" losing
 * its date is exactly as misleading as losing its amount.
 */
export function figuresIn(text: string): string[] {
  const pattern =
    /\$[\d,]+(?:\.\d{2})?|\b\d+(?:\.\d+)?%|\b\d{3,}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/gi;
  return (text.match(pattern) ?? []).map((f) => f.replace(/[,.]/g, '').replace(/\s+/g, ' ').toLowerCase());
}

/**
 * A rephrase is only accepted if every figure in the original survives it. A
 * model that drops "$4,130.84" or rounds it to "about $4,000" has changed what
 * the customer believes about their own money, which is worse than stiff
 * wording.
 */
export function preservesFigures(original: string, rewritten: string): boolean {
  const wanted = figuresIn(original);
  const got = new Set(figuresIn(rewritten));
  return wanted.every((figure) => got.has(figure));
}

const PHRASING_SYSTEM = `You are Ori, the assistant inside Orbit, a banking app.

You will be given a reply that Orbit's own engine has already written from the
customer's real account data, plus the facts behind it. Your only job is to say
the same thing in a warmer, more natural voice.

Rules you must not break:
- Never change, round, add or remove a number, a date, a merchant name or an amount.
- Never add a fact that is not in what you were given. If you are unsure, keep the original wording.
- Never promise to do something. Orbit's engine performs actions, not you.
- Never ask the customer for a password, PIN, card number or one-time code.
- Keep it short: at most three sentences, unless the original is longer.
- Match the customer's language. If their message is in Spanish, reply in Spanish.
- Plain words. No jargon, no financial advice, no emoji.

Reply with the rewritten message only. No preamble, no quotes, no markdown headings.`;

/**
 * Ori's answer, said better. Falls back to the engine's own wording whenever
 * Gemini is unavailable, slow, or returns something that fails validation.
 */
export async function phrase(reply: OriReply, customerMessage: string, firstName: string): Promise<OriReply> {
  if (!config.gemini.enabled || !reply.text.trim()) return reply;
  // A handoff is a carefully worded apology and an offer of a person. It is the
  // one moment the customer is already unhappy — do not let it be rewritten.
  if (reply.handoff) return reply;

  const facts = reply.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n');
  const user = [
    `Customer's first name: ${firstName}`,
    `Customer said: ${customerMessage}`,
    '',
    'Orbit engine reply:',
    reply.text,
    facts ? `\nFacts already shown beside the reply (do not repeat them verbatim, but never contradict them):\n${facts}` : '',
    reply.proposal
      ? `\nA confirmation card is shown below your message: "${reply.proposal.title}" — ${reply.proposal.summary}. Do not describe it in detail; the customer can read it.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rewritten = await generate(PHRASING_SYSTEM, user, { maxOutputTokens: 2_000, deadlineMs: PHRASE_DEADLINE_MS });
  if (!rewritten || !preservesFigures(reply.text, rewritten)) return reply;

  return { ...reply, text: rewritten.slice(0, 1200) };
}

// --- 2. navigation --------------------------------------------------------

export interface Navigation {
  /** A path from PAGE_PATHS, or null when no screen answers this. */
  href: string | null;
  /** What to say while taking them there. */
  text: string;
  /** Three things they might ask next. */
  suggestions: string[];
  /** True when this needs a person rather than a screen. */
  needsHuman: boolean;
}

function navigationSystem(): string {
  const pages = PAGE_PATHS.map((path) => {
    const guide = guideFor(path)!;
    return `${path} — ${guide.title}: ${guide.what} You can: ${guide.canDo.join('; ')}.`;
  }).join('\n');

  return `You are Ori, the assistant inside Orbit, a banking app. Orbit's own engine
did not understand the customer's message, so you are answering instead.

These are every screen in Orbit:
${pages}

Decide which screen answers the customer, and say so in one or two plain
sentences. Rules:
- "href" must be exactly one of the paths listed above, or null if none fits.
- Never state a balance, an amount, a date or any other figure. You do not have
  the customer's data. Say where to look, not what it says.
- Never promise to do something for them, and never say you have done anything.
- If this is about fraud, a lost or stolen card, a charge they do not recognise,
  a scam, a dispute, a death or bereavement, or anything urgent or distressing,
  set "needsHuman" to true. A person handles those, not a screen.
- Never ask for a password, PIN, card number or one-time code.
- Match the customer's language. Spanish in, Spanish out.
- "suggestions" are three short things the customer could say next, under six
  words each, in the customer's language.

Answer as JSON only:
{"href": string|null, "text": string, "suggestions": [string, string, string], "needsHuman": boolean}`;
}

/**
 * Where does this customer want to go? Only ever consulted when the rule engine
 * has already failed, so a null answer costs nothing.
 */
export async function navigate(message: string, context: OriContext): Promise<Navigation | null> {
  if (!config.gemini.enabled) return null;

  const user = [
    `Customer said: ${message}`,
    `They are currently on: ${context.page}`,
    // Shape, never figures: enough for the model to route, nothing it could quote.
    `They have ${context.accounts.length} accounts, ${context.subscriptions.length} detected subscriptions, ` +
      `${context.plans.activeCount} active Pay Over Time plans and ${context.unreadAlerts} unread alerts.`,
  ].join('\n');

  const raw = await generate(navigationSystem(), user, { json: true, maxOutputTokens: 3_000 });
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Navigation>;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) return null;

    // The model may only send the customer to a page that exists. Anything else
    // — a hallucinated path, an external URL — becomes "no destination".
    const href = typeof parsed.href === 'string' && (PAGE_PATHS as readonly string[]).includes(parsed.href)
      ? parsed.href
      : null;

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 3)
      : [];

    return { href, text: text.slice(0, 600), suggestions, needsHuman: parsed.needsHuman === true };
  } catch {
    return null;
  }
}
