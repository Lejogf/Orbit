// Ori's replies: understand the message, answer from the customer's own data,
// and never trap them.
//
// Three rules the old assistant broke and this one keeps:
//   1. Never "try again later". Every reply offers a next step that works now.
//   2. Two misunderstandings in a row, or any sign of frustration, and Ori
//      stops guessing and offers a person — who receives the conversation, so
//      nothing has to be repeated.
//   3. Anything that moves money or changes a card is proposed, not done: the
//      customer sees exactly what will happen and confirms it.

import { formatCents } from '../../lib/utils.js';
import {
  classify,
  extractAccounts,
  extractAmountCents,
  extractDestination,
  extractName,
  extractMerchant,
  extractPage,
  isFrustrated,
  looksSpanish,
  type IntentId,
} from './nlu.js';
import { guideFor } from './pages.js';

export type Lang = 'en' | 'es';

export interface OriAccount {
  id: string;
  type: 'Checking' | 'Savings' | 'Credit Card' | string;
  nickname: string;
  last4: string;
  balanceCents: number;
  creditLimitCents: number | null;
  isLocked: boolean;
  rewardsCents: number;
}

export interface OriSubscription {
  id: string;
  merchantName: string;
  amountCents: number;
  frequency: string;
  status: string;
  nextChargeDate: string;
  isFreeTrial: boolean;
  hasPriceIncrease: boolean;
  isDuplicate: boolean;
  looksUnused: boolean;
  cancelUrl: string | null;
}

export interface OriContext {
  firstName: string;
  page: string;
  accounts: OriAccount[];
  safeToSpend: { cents: number; committedCents: number; nextPayday: string | null; daysUntilPayday: number | null };
  subscriptions: OriSubscription[];
  upcoming: { label: string; amountCents: number; date: string; kind: string }[];
  recent: { description: string; amountCents: number; postedAt: string; category: string }[];
  spending: { monthTotalCents: number; previousTotalCents: number; top: { category: string; cents: number }[] };
  credit: { score: number; band: string; weakest: { label: string; detail: string } | null; strongest: { label: string } | null };
  plans: { activeCount: number; monthlyTotalCents: number };
  eligiblePurchase: { id: string; merchant: string; amountCents: number } | null;
  unreadAlerts: number;
}

export interface OriState {
  /** Consecutive turns Ori did not understand. */
  misses: number;
  lastIntent: IntentId | null;
  lastMessage: string | null;
  lang: Lang;
}

export const INITIAL_STATE: OriState = { misses: 0, lastIntent: null, lastMessage: null, lang: 'en' };

export type OriAction =
  | { type: 'lock_card'; accountId: string; locked: boolean }
  | { type: 'subscription'; subscriptionId: string; action: 'block' | 'guard' | 'unguard' }
  | { type: 'transfer'; fromAccountId: string; toAccountId: string; amountCents: number };

export interface ProposedAction {
  action: OriAction;
  title: string;
  /** Exactly what will happen, in plain words. */
  summary: string;
  confirmLabel: string;
  danger?: boolean;
}

export type OriEffect =
  | { type: 'text_scale'; scale: number }
  | { type: 'start_tour' }
  | { type: 'navigate'; href: string };

export interface OriReply {
  intent: IntentId;
  text: string;
  facts: { label: string; value: string }[];
  links: { label: string; href: string }[];
  proposal: ProposedAction | null;
  effect: OriEffect | null;
  /** Offer a human. `urgent` puts it first and says why. */
  handoff: { topic: string; urgent: boolean; reason: string } | null;
  suggestions: string[];
  state: OriState;
}

const L = (lang: Lang, en: string, es: string) => (lang === 'es' ? es : en);

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const checking = (c: OriContext) => c.accounts.find((a) => a.type === 'Checking');
const savings = (c: OriContext) => c.accounts.find((a) => a.type === 'Savings');
const card = (c: OriContext) => c.accounts.find((a) => a.type === 'Credit Card');

const accountFor = (c: OriContext, ref: 'checking' | 'savings' | 'card' | null) =>
  ref === 'checking' ? checking(c) : ref === 'savings' ? savings(c) : ref === 'card' ? card(c) : undefined;

const DEFAULT_SUGGESTIONS = {
  en: ['How much can I spend?', 'Show my subscriptions', 'Lock my card', 'Talk to a person'],
  es: ['¿Cuánto puedo gastar?', 'Mis suscripciones', 'Bloquear mi tarjeta', 'Hablar con una persona'],
};

function base(intent: IntentId, state: OriState, text: string): OriReply {
  return {
    intent,
    text,
    facts: [],
    links: [],
    proposal: null,
    effect: null,
    handoff: null,
    suggestions: DEFAULT_SUGGESTIONS[state.lang],
    state,
  };
}

/** Find the subscription the customer means, or the most relevant one. */
function pickSubscription(message: string, context: OriContext): OriSubscription | null {
  const name = extractMerchant(message, context.subscriptions.map((s) => s.merchantName));
  return context.subscriptions.find((s) => s.merchantName === name) ?? null;
}

export function respond(message: string, context: OriContext, previous: OriState = INITIAL_STATE): OriReply {
  const trimmed = message.trim().slice(0, 500);
  const lang: Lang = looksSpanish(trimmed) ? 'es' : previous.lang;
  const { intent, alternative } = classify(trimmed);
  const frustrated = isFrustrated(trimmed);
  const repeated = previous.lastMessage !== null && previous.lastMessage.toLowerCase() === trimmed.toLowerCase();

  const understood = intent !== 'fallback';
  const state: OriState = {
    misses: understood ? 0 : previous.misses + 1,
    lastIntent: intent,
    lastMessage: trimmed,
    lang,
  };

  // Frustration or a repeated question means the last answer failed. Don't try
  // a third variation of it — offer a person straight away, and say why.
  if ((frustrated || repeated) && intent !== 'human' && intent !== 'thanks') {
    const reply = understood ? answer(intent, trimmed, context, state, alternative) : base(intent, state, '');
    return {
      ...reply,
      text: L(
        lang,
        `I'm sorry — I don't think I'm helping enough. A person can sort this out with you right now, and they'll see everything we've said so you don't have to repeat it.${reply.text ? `\n\nIn the meantime: ${reply.text}` : ''}`,
        `Lo siento, creo que no te estoy ayudando lo suficiente. Una persona puede ayudarte ahora mismo y verá toda nuestra conversación.${reply.text ? `\n\nMientras tanto: ${reply.text}` : ''}`,
      ),
      handoff: { topic: topicFor(state.lastIntent), urgent: true, reason: frustrated ? 'frustrated' : 'repeated' },
    };
  }

  if (!understood) return fallback(trimmed, context, state, alternative);
  return answer(intent, trimmed, context, state, alternative);
}

function topicFor(intent: IntentId | null): string {
  const topics: Partial<Record<IntentId, string>> = {
    unknown_charge: 'A charge I don’t recognise',
    scam: 'Possible scam',
    lost_card: 'Lost or stolen card',
    dispute: 'Dispute a charge',
    change_name: 'Legal name change',
    change_address: 'Address change',
    password: 'Signing in',
    transfer: 'Moving money',
    pay_card: 'Paying my card',
    subscriptions: 'Subscriptions',
    cancel_subscription: 'Cancelling a subscription',
    credit_score: 'Credit score',
    travel: 'Travel booking',
  };
  return (intent && topics[intent]) ?? 'General help';
}

function fallback(message: string, context: OriContext, state: OriState, alternative: IntentId | null): OriReply {
  const lang = state.lang;
  const page = extractPage(message);

  // Didn't understand, but they named a page: take them there rather than fail.
  if (page) {
    return {
      ...base('navigate', state, L(lang, `Here's ${page.label}.`, `Aquí está ${page.label}.`)),
      links: [{ label: page.label, href: page.href }],
      effect: { type: 'navigate', href: page.href },
      state: { ...state, misses: 0 },
    };
  }

  const guide = guideFor(context.page);
  const reply = base(
    'fallback',
    state,
    state.misses >= 2
      ? L(
          lang,
          "I'm not understanding this one, and I don't want to keep you going in circles. Let me connect you with a person — they're available 24/7 and will see this conversation.",
          'No estoy entendiendo y no quiero hacerte dar vueltas. Te conecto con una persona, disponible 24/7, que verá esta conversación.',
        )
      : L(
          lang,
          `I didn't quite catch that. You can ask me things like "how much can I spend", "lock my card", or "cancel Netflix". Or pick one below.`,
          'No entendí bien. Puedes preguntarme "¿cuánto puedo gastar?", "bloquear mi tarjeta" o "cancelar Netflix".',
        ),
  );

  const suggestions = alternative ? [suggestionFor(alternative, lang), ...reply.suggestions].slice(0, 4) : reply.suggestions;

  return {
    ...reply,
    suggestions,
    links: guide ? [{ label: L(lang, `What can I do on ${guide.title}?`, `¿Qué puedo hacer en ${guide.es.title}?`), href: '#explain' }] : [],
    // Offered from the first miss, made prominent from the second.
    handoff: { topic: topicFor(state.lastIntent), urgent: state.misses >= 2, reason: 'not_understood' },
  };
}

function suggestionFor(intent: IntentId, lang: Lang): string {
  const map: Partial<Record<IntentId, [string, string]>> = {
    balance: ['What’s my balance?', '¿Cuál es mi saldo?'],
    safe_to_spend: ['How much can I spend?', '¿Cuánto puedo gastar?'],
    subscriptions: ['Show my subscriptions', 'Mis suscripciones'],
    lock_card: ['Lock my card', 'Bloquear mi tarjeta'],
    spending: ['Where did my money go?', '¿En qué gasté?'],
    upcoming: ['What’s coming up?', 'Próximos pagos'],
    credit_score: ['What’s my credit score?', '¿Mi puntaje de crédito?'],
    travel: ['Book a flight', 'Reservar un vuelo'],
    human: ['Talk to a person', 'Hablar con una persona'],
  };
  const pair = map[intent];
  return pair ? L(lang, pair[0], pair[1]) : L(lang, 'Talk to a person', 'Hablar con una persona');
}

function answer(
  intent: IntentId,
  message: string,
  c: OriContext,
  state: OriState,
  alternative: IntentId | null,
): OriReply {
  const lang = state.lang;
  const r = (text: string) => base(intent, state, text);

  switch (intent) {
    case 'greeting': {
      const reply = r(
        L(
          lang,
          `Hey ${c.firstName} 👋 I'm Ori. I can check your balance, explain any screen, kill a subscription, lock your card, or get you a real human. What's up?`,
          `¡Hola ${c.firstName}! Soy Ori. Puedo revisar saldos, explicar cualquier pantalla, detener una suscripción, bloquear tu tarjeta o conectarte con una persona. ¿Qué necesitas?`,
        ),
      );
      return c.unreadAlerts > 0
        ? { ...reply, facts: [{ label: L(lang, 'Unread alerts', 'Alertas sin leer'), value: String(c.unreadAlerts) }], links: [{ label: L(lang, 'Open alerts', 'Ver alertas'), href: '/alerts' }] }
        : reply;
    }

    case 'introduction': {
      const name = extractName(message);
      const greetingName = name ?? c.firstName;
      return {
        ...r(
          L(
            lang,
            `Nice to meet you, ${greetingName}! I'm Ori. I can show you anything in the app, explain what a screen means, stop a subscription, or put you through to a real person. What can I do for you?`,
            `¡Mucho gusto, ${greetingName}! Soy Ori. Puedo mostrarte cualquier parte de la app, explicarte una pantalla, detener una suscripción o conectarte con una persona. ¿Qué necesitas?`,
          ),
        ),
        suggestions: [
          L(lang, 'Show me around', 'Muéstrame la app'),
          L(lang, 'How much can I spend?', '¿Cuánto puedo gastar?'),
          L(lang, 'What is this page?', '¿Qué es esta página?'),
        ],
      };
    }

    case 'thanks':
      return r(L(lang, "Anytime 🙌 I'm one tap away whenever you need me.", '¡Cuando quieras! Estoy a un toque.'));

    case 'balance': {
      const facts = c.accounts.map((a) => ({
        label: `${a.nickname} ••${a.last4}`,
        value:
          a.type === 'Credit Card'
            ? L(lang, `${formatCents(a.balanceCents)} owed`, `${formatCents(a.balanceCents)} adeudado`)
            : formatCents(a.balanceCents),
      }));
      const chk = checking(c);
      return {
        ...r(
          chk
            ? L(
                lang,
                `${formatCents(chk.balanceCents)} in checking — ${formatCents(c.safeToSpend.cents)} of it is genuinely free once upcoming bills are set aside.`,
                `Tienes ${formatCents(chk.balanceCents)} en cheques. De eso, ${formatCents(c.safeToSpend.cents)} es seguro gastar después de los pagos próximos.`,
              )
            : L(lang, 'Here are your balances.', 'Estos son tus saldos.'),
        ),
        facts,
        links: [{ label: L(lang, 'See accounts', 'Ver cuentas'), href: '/accounts' }],
        suggestions: [L(lang, 'How much can I spend?', '¿Cuánto puedo gastar?'), L(lang, 'Recent transactions', 'Movimientos recientes'), L(lang, 'Move money to savings', 'Pasar a ahorros')],
      };
    }

    case 'safe_to_spend': {
      const amount = extractAmountCents(message);
      const days = c.safeToSpend.daysUntilPayday;
      const payday = c.safeToSpend.nextPayday ? shortDate(c.safeToSpend.nextPayday) : null;
      let text = L(
        lang,
        `You've got ${formatCents(c.safeToSpend.cents)} free${payday ? ` until payday on ${payday}` : ''} — that's after I set aside ${formatCents(c.safeToSpend.committedCents)} for bills and subscriptions that hit first.`,
        `${formatCents(c.safeToSpend.cents)} es seguro gastar${payday ? ` hasta tu pago el ${payday}` : ''}, después de apartar ${formatCents(c.safeToSpend.committedCents)} para pagos próximos.`,
      );
      if (amount !== null) {
        const fits = amount <= c.safeToSpend.cents;
        text = fits
          ? L(lang, `Yep, ${formatCents(amount)} works. You'd still have ${formatCents(c.safeToSpend.cents - amount)} left${payday ? ` until ${payday}` : ''}.`, `Sí, ${formatCents(amount)} cabe. Te quedarían ${formatCents(c.safeToSpend.cents - amount)}.`)
          : L(lang, `I'd hold off — ${formatCents(amount)} leaves you ${formatCents(amount - c.safeToSpend.cents)} short for bills already due${payday ? ` before ${payday}` : ''}. If it's on the card and over $100, you could split it into monthly payments instead.`, `${formatCents(amount)} es más de lo seguro ahora; te faltarían ${formatCents(amount - c.safeToSpend.cents)} para tus pagos.`);
      }
      return {
        ...r(text),
        facts: [
          { label: L(lang, 'Safe to spend', 'Seguro para gastar'), value: formatCents(c.safeToSpend.cents) },
          ...(days !== null ? [{ label: L(lang, 'Days to payday', 'Días para el pago'), value: String(days) }] : []),
        ],
        links: [{ label: L(lang, 'See what’s coming up', 'Ver próximos pagos'), href: '/dashboard' }],
        suggestions: [L(lang, 'What’s coming up?', 'Próximos pagos'), L(lang, 'Where did my money go?', '¿En qué gasté?'), L(lang, 'Show my subscriptions', 'Mis suscripciones')],
      };
    }

    case 'recent_transactions': {
      const recent = c.recent.slice(0, 5);
      return {
        ...r(recent.length ? L(lang, 'Your latest transactions:', 'Tus últimos movimientos:') : L(lang, 'No transactions yet.', 'Aún no hay movimientos.')),
        facts: recent.map((t) => ({ label: `${shortDate(t.postedAt)} · ${t.description}`, value: `${t.amountCents < 0 ? '−' : '+'}${formatCents(Math.abs(t.amountCents))}` })),
        links: [{ label: L(lang, 'See all transactions', 'Ver todos'), href: '/accounts' }],
        suggestions: [L(lang, 'I don’t recognize a charge', 'No reconozco un cargo'), L(lang, 'Where did my money go?', '¿En qué gasté?')],
      };
    }

    case 'spending': {
      const s = c.spending;
      const top = s.top.slice(0, 3);
      return {
        ...r(
          L(
            lang,
            `You've spent ${formatCents(s.monthTotalCents)} so far this month${s.previousTotalCents ? ` — last month was ${formatCents(s.previousTotalCents)} in total` : ''}.${top[0] ? ` Your biggest category is ${top[0].category}.` : ''}`,
            `Llevas ${formatCents(s.monthTotalCents)} gastados este mes.${top[0] ? ` Tu mayor categoría es ${top[0].category}.` : ''}`,
          ),
        ),
        facts: top.map((t) => ({ label: t.category, value: formatCents(t.cents) })),
        links: [{ label: L(lang, 'Open Spending', 'Ver gastos'), href: '/spending' }],
        suggestions: [L(lang, 'Show my subscriptions', 'Mis suscripciones'), L(lang, 'How much can I spend?', '¿Cuánto puedo gastar?')],
      };
    }

    case 'unknown_charge':
    case 'dispute': {
      const cc = card(c);
      const reply = r(
        intent === 'dispute'
          ? L(lang, "I'm sorry about that. You won't be responsible for charges you didn't authorise. A specialist can open a dispute with you now — it usually takes about 5 minutes. If you think your card number was stolen, lock it first; it takes a second and you can unlock it any time.", 'Lo siento. No serás responsable de cargos que no autorizaste. Un especialista puede abrir una disputa contigo ahora.')
          : L(lang, "Let's figure it out. Merchant names on statements are often nothing like the shop's actual name. If it's still not yours: lock the card now (instant, reversible), then a specialist disputes it with you. You won't pay for fraud — that's the rule.", 'Revisémoslo juntos. Si no es tuyo, bloquea tu tarjeta ahora y un especialista te ayudará con la disputa. No pagarás por fraude.'),
      );
      return {
        ...reply,
        facts: c.recent.filter((t) => t.amountCents < 0).slice(0, 4).map((t) => ({ label: `${shortDate(t.postedAt)} · ${t.description}`, value: formatCents(-t.amountCents) })),
        proposal: cc && !cc.isLocked ? lockProposal(cc, true, lang) : null,
        handoff: { topic: topicFor(intent), urgent: true, reason: 'sensitive' },
        links: [{ label: L(lang, 'See all transactions', 'Ver movimientos'), href: '/accounts' }],
      };
    }

    case 'scam': {
      const cc = card(c);
      return {
        ...r(
          L(
            lang,
            "Please stop and don't share anything. Capital One will never call, text or email to ask for your password, a one-time code, your PIN, or payment in gift cards. Anyone who does is a scammer — even if the caller ID looks like us. Hang up and talk to us directly: a specialist can check your account right now. If you shared card details, lock your card first.",
            'Detente y no compartas nada. Capital One nunca te pedirá tu contraseña, código, PIN ni pagos con tarjetas de regalo. Cuelga y habla con nosotros directamente.',
          ),
        ),
        proposal: cc && !cc.isLocked ? lockProposal(cc, true, lang) : null,
        handoff: { topic: topicFor('scam'), urgent: true, reason: 'sensitive' },
      };
    }

    case 'subscriptions': {
      const live = c.subscriptions.filter((s) => s.status === 'active' || s.status === 'guarded');
      const monthly = live.reduce((sum, s) => sum + (s.frequency === 'yearly' ? Math.round(s.amountCents / 12) : s.frequency === 'weekly' ? Math.round((s.amountCents * 52) / 12) : s.amountCents), 0);
      const flagged = live.filter((s) => s.isFreeTrial || s.hasPriceIncrease || s.isDuplicate || s.looksUnused);
      const flagText = flagged.slice(0, 3).map((s) =>
        s.isFreeTrial ? L(lang, `${s.merchantName}'s free trial is about to convert`, `la prueba de ${s.merchantName} termina pronto`)
          : s.hasPriceIncrease ? L(lang, `${s.merchantName} raised its price`, `${s.merchantName} subió su precio`)
          : s.isDuplicate ? L(lang, `${s.merchantName} overlaps with another service`, `${s.merchantName} se repite con otro servicio`)
          : L(lang, `${s.merchantName} looks unused`, `${s.merchantName} parece sin uso`),
      );
      return {
        ...r(
          L(
            lang,
            `${live.length} subscriptions are live, about ${formatCents(monthly)} a month.${flagText.length ? ` Worth a look: ${flagText.join('; ')}.` : ''}`,
            `Tienes ${live.length} suscripciones activas, unos ${formatCents(monthly)} al mes.${flagText.length ? ` Revisa: ${flagText.join('; ')}.` : ''}`,
          ),
        ),
        facts: live.slice(0, 6).map((s) => ({ label: s.merchantName, value: `${formatCents(s.amountCents)}/${s.frequency === 'yearly' ? 'yr' : s.frequency === 'weekly' ? 'wk' : 'mo'}` })),
        links: [{ label: L(lang, 'Manage subscriptions', 'Administrar'), href: '/subscriptions' }],
        suggestions: flagged[0]
          ? [L(lang, `Block ${flagged[0].merchantName}`, `Bloquear ${flagged[0].merchantName}`), L(lang, `Ask me first for ${flagged[0].merchantName}`, `Preguntarme antes: ${flagged[0].merchantName}`), L(lang, 'What’s coming up?', 'Próximos pagos')]
          : [L(lang, 'What’s coming up?', 'Próximos pagos')],
      };
    }

    case 'block_subscription':
    case 'guard_subscription':
    case 'cancel_subscription': {
      const sub = pickSubscription(message, c);
      if (!sub) {
        return {
          ...r(L(lang, 'Which subscription? Tap one below or say its name, like "block Hulu".', '¿Cuál suscripción? Elige una o di su nombre.')),
          suggestions: c.subscriptions.filter((s) => s.status === 'active' || s.status === 'guarded').slice(0, 4).map((s) =>
            intent === 'guard_subscription' ? L(lang, `Ask me first for ${s.merchantName}`, `Preguntarme antes: ${s.merchantName}`) : L(lang, `Block ${s.merchantName}`, `Bloquear ${s.merchantName}`)),
          links: [{ label: L(lang, 'Open subscriptions', 'Ver suscripciones'), href: '/subscriptions' }],
        };
      }
      if (sub.status === 'blocked' || sub.status === 'canceled') {
        return {
          ...r(L(lang, `${sub.merchantName} is already blocked — no more charges will go through.`, `${sub.merchantName} ya está bloqueado.`)),
          links: [{ label: sub.merchantName, href: `/subscriptions/${sub.id}?from=dashboard` }],
        };
      }
      const yearly = sub.frequency === 'yearly' ? sub.amountCents : sub.frequency === 'weekly' ? sub.amountCents * 52 : sub.amountCents * 12;
      if (intent === 'guard_subscription') {
        return {
          ...r(L(lang, `With "Ask me first", ${sub.merchantName}'s next charge is paused until you approve it. You'll get an alert and can say yes or no.`, `Con "Preguntarme antes", el próximo cobro de ${sub.merchantName} espera tu aprobación.`)),
          proposal: {
            action: { type: 'subscription', subscriptionId: sub.id, action: 'guard' },
            title: L(lang, `Ask me first: ${sub.merchantName}`, `Preguntarme antes: ${sub.merchantName}`),
            summary: L(lang, `Future ${formatCents(sub.amountCents)} charges from ${sub.merchantName} will wait for your approval.`, `Los cobros de ${formatCents(sub.amountCents)} esperarán tu aprobación.`),
            confirmLabel: L(lang, 'Turn on', 'Activar'),
          },
        };
      }
      return {
        ...r(
          intent === 'cancel_subscription'
            ? L(lang, `Blocking ${sub.merchantName} on your card stops the charges right away and saves ${formatCents(yearly)} a year. To end the account with ${sub.merchantName} itself, use their cancellation page too.`, `Bloquear ${sub.merchantName} detiene los cobros y ahorra ${formatCents(yearly)} al año.`)
            : L(lang, `Say the word and ${sub.merchantName} stops hitting your card — that's ${formatCents(yearly)} a year back. Reversible whenever.`, `Esto detiene los cobros de ${sub.merchantName} y ahorra ${formatCents(yearly)} al año.`),
        ),
        proposal: {
          action: { type: 'subscription', subscriptionId: sub.id, action: 'block' },
          title: L(lang, `Block ${sub.merchantName}`, `Bloquear ${sub.merchantName}`),
          summary: L(lang, `${formatCents(sub.amountCents)} ${sub.frequency} charges will be declined. Saves ${formatCents(yearly)} a year.`, `Se rechazarán los cobros de ${formatCents(sub.amountCents)}.`),
          confirmLabel: L(lang, 'Block it', 'Bloquear'),
          danger: true,
        },
        links: sub.cancelUrl ? [{ label: L(lang, `${sub.merchantName} cancellation page`, `Cancelar en ${sub.merchantName}`), href: sub.cancelUrl }] : [],
      };
    }

    case 'upcoming': {
      const items = c.upcoming.slice(0, 6);
      const total = items.filter((i) => i.amountCents < 0).reduce((s, i) => s + -i.amountCents, 0);
      return {
        ...r(items.length ? L(lang, `Here's what's coming up — ${formatCents(total)} going out.`, `Esto es lo próximo: ${formatCents(total)} en pagos.`) : L(lang, 'Nothing is scheduled soon.', 'No hay pagos próximos.')),
        facts: items.map((i) => ({ label: `${shortDate(i.date)} · ${i.label}`, value: `${i.amountCents < 0 ? '−' : '+'}${formatCents(Math.abs(i.amountCents))}` })),
        links: [{ label: L(lang, 'See timeline', 'Ver calendario'), href: '/dashboard' }],
      };
    }

    case 'lock_card':
    case 'unlock_card': {
      const cc = card(c);
      if (!cc) return r(L(lang, "You don't have a card with us yet.", 'Aún no tienes una tarjeta.'));
      const lock = intent === 'lock_card';
      if (cc.isLocked === lock) {
        return r(lock ? L(lang, `Your card ending ${cc.last4} is already locked. New purchases are declined.`, 'Tu tarjeta ya está bloqueada.') : L(lang, `Your card ending ${cc.last4} is already unlocked.`, 'Tu tarjeta ya está desbloqueada.'));
      }
      return {
        ...r(
          lock
            ? L(lang, "Locking kills new purchases instantly. It doesn't cancel the card — unlock whenever. Heads up: subscriptions you already set up can still charge, that's what Subscription Guard is for.", 'Bloquear detiene compras nuevas al instante. Puedes desbloquearla cuando quieras.')
            : L(lang, 'Unlocking lets purchases go through again.', 'Desbloquear permite compras de nuevo.'),
        ),
        proposal: lockProposal(cc, lock, lang),
      };
    }

    case 'lost_card': {
      const cc = card(c);
      return {
        ...r(L(lang, "Let's protect your account. Lock the card now — it's instant and reversible if you find it. Then a specialist can send a replacement (usually 2–3 business days, or faster if you're travelling) and move your subscriptions to the new number.", 'Protejamos tu cuenta. Bloquea la tarjeta ahora; es instantáneo y reversible. Un especialista puede enviarte un reemplazo.')),
        proposal: cc && !cc.isLocked ? lockProposal(cc, true, lang) : null,
        handoff: { topic: topicFor('lost_card'), urgent: true, reason: 'sensitive' },
      };
    }

    case 'transfer':
    case 'pay_card': {
      const amount = extractAmountCents(message);
      const refs = extractAccounts(message);
      const to = intent === 'pay_card' ? card(c) : accountFor(c, refs.to) ?? savings(c);
      const from = accountFor(c, refs.from) ?? checking(c);
      if (!from || !to || from.id === to.id) {
        return { ...r(L(lang, 'Where should the money go? You can move it between checking, savings and your card.', '¿A dónde quieres mover el dinero?')), links: [{ label: L(lang, 'Open Transfer', 'Transferir'), href: '/transfer' }] };
      }
      if (amount === null) {
        const hint = intent === 'pay_card' && to.balanceCents > 0 ? L(lang, ` Your card balance is ${formatCents(to.balanceCents)}.`, ` Tu saldo es ${formatCents(to.balanceCents)}.`) : '';
        return {
          ...r(L(lang, `How much would you like to move from ${from.nickname} to ${to.nickname}?${hint}`, `¿Cuánto quieres mover de ${from.nickname} a ${to.nickname}?${hint}`)),
          suggestions: intent === 'pay_card' && to.balanceCents > 0
            ? [L(lang, `Pay ${formatCents(to.balanceCents)} to my card`, `Pagar ${formatCents(to.balanceCents)}`), L(lang, 'Pay $100 to my card', 'Pagar $100')]
            : [L(lang, 'Move $100 to savings', 'Pasar $100 a ahorros'), L(lang, 'Move $500 to savings', 'Pasar $500 a ahorros')],
        };
      }
      if (amount > from.balanceCents) {
        return {
          ...r(L(lang, `${from.nickname} has ${formatCents(from.balanceCents)}, so ${formatCents(amount)} won't fit. Want to try a smaller amount?`, `${from.nickname} tiene ${formatCents(from.balanceCents)}; no alcanza para ${formatCents(amount)}.`)),
          links: [{ label: L(lang, 'Open Transfer', 'Transferir'), href: '/transfer' }],
        };
      }
      const leavesSafe = from.type === 'Checking' ? c.safeToSpend.cents - amount : null;
      return {
        ...r(
          leavesSafe !== null && leavesSafe < 0
            ? L(lang, `Heads up: this would leave less than your upcoming bills need (${formatCents(-leavesSafe)} short before payday). You can still go ahead.`, `Atención: te faltarían ${formatCents(-leavesSafe)} para tus pagos próximos.`)
            : L(lang, 'Here’s the transfer. Check it and confirm.', 'Revisa la transferencia y confirma.'),
        ),
        proposal: {
          action: { type: 'transfer', fromAccountId: from.id, toAccountId: to.id, amountCents: amount },
          title: L(lang, `Move ${formatCents(amount)}`, `Mover ${formatCents(amount)}`),
          summary: L(lang, `From ${from.nickname} ••${from.last4} to ${to.nickname} ••${to.last4}. Arrives immediately.`, `De ${from.nickname} ••${from.last4} a ${to.nickname} ••${to.last4}.`),
          confirmLabel: L(lang, 'Send it', 'Enviar'),
        },
      };
    }

    case 'pay_over_time': {
      const p = c.eligiblePurchase;
      return {
        ...r(
          p
            ? L(lang, `Card purchases of $100 or more can be split into 3, 6, 12 or 24 monthly payments. Your ${p.merchant} purchase of ${formatCents(p.amountCents)} qualifies — 3 payments cost nothing extra.`, `Las compras de $100 o más se pueden dividir en pagos. Tu compra en ${p.merchant} de ${formatCents(p.amountCents)} califica.`)
            : L(lang, 'Card purchases of $100 or more can be split into 3, 6, 12 or 24 monthly payments. Open any eligible purchase and choose "Split this purchase".', 'Las compras de $100 o más se pueden dividir en pagos mensuales.'),
        ),
        links: p ? [{ label: L(lang, `Split ${p.merchant}`, `Dividir ${p.merchant}`), href: `/plans/new/${p.id}` }] : [{ label: L(lang, 'Open accounts', 'Ver cuentas'), href: '/accounts' }],
      };
    }

    case 'plans':
      return {
        ...r(c.plans.activeCount ? L(lang, `You have ${c.plans.activeCount} active plan${c.plans.activeCount === 1 ? '' : 's'}, ${formatCents(c.plans.monthlyTotalCents)} a month in total.`, `Tienes ${c.plans.activeCount} planes activos, ${formatCents(c.plans.monthlyTotalCents)} al mes.`) : L(lang, "You don't have any payment plans right now.", 'No tienes planes de pago.')),
        links: [{ label: L(lang, 'Open My Plans', 'Mis planes'), href: '/plans' }],
      };

    case 'credit_score':
    case 'improve_credit': {
      const cr = c.credit;
      const tip = cr.weakest ? L(lang, ` The factor holding it back most is ${cr.weakest.label.toLowerCase()}: ${cr.weakest.detail}`, ` Lo que más lo limita: ${cr.weakest.label}.`) : '';
      return {
        ...r(
          intent === 'credit_score'
            ? L(lang, `Your estimated score is ${cr.score} (${cr.band}). It uses the same five factors and weights as FICO, from the accounts we can see — your official score may differ.${tip}`, `Tu puntaje estimado es ${cr.score} (${cr.band}).${tip}`)
            : L(lang, `The fastest wins are paying your card below 30% of its limit and never missing a payment.${tip} Try the "what if" simulator to see how much each step would move it.`, `Lo más rápido: mantener tu tarjeta bajo el 30% del límite y no atrasarte.${tip}`),
        ),
        facts: [{ label: L(lang, 'Estimated score', 'Puntaje estimado'), value: String(cr.score) }],
        links: [{ label: L(lang, 'Open Credit', 'Ver crédito'), href: '/credit' }],
      };
    }

    case 'rewards': {
      const cc = card(c);
      const miles = cc?.rewardsCents ?? 0;
      return {
        ...r(L(lang, `You have ${miles.toLocaleString('en-US')} miles, worth ${formatCents(miles)} toward travel. Flights booked here earn 5x and hotels 10x — and I'll show you the best way to pay each time.`, `Tienes ${miles.toLocaleString('en-US')} millas, que valen ${formatCents(miles)} en viajes.`)),
        links: [{ label: L(lang, 'Travel & Rewards', 'Viajes y recompensas'), href: '/travel' }, { label: L(lang, 'See offers', 'Ver ofertas'), href: '/travel?tab=offers' }],
      };
    }

    case 'travel': {
      const dest = extractDestination(message);
      const href = dest ? `/travel?to=${encodeURIComponent(dest)}` : '/travel';
      return {
        ...r(L(lang, `${dest ? `Let's find flights to ${dest.replace(/\b\w/g, (ch) => ch.toUpperCase())}. ` : ''}You can book flights and hotels right here — I'll tell you whether prices are likely to rise, and you're covered if the price drops after you book.`, `Puedes reservar vuelos y hoteles aquí mismo.`)),
        links: [{ label: L(lang, 'Search trips', 'Buscar viajes'), href }],
        effect: { type: 'navigate', href },
      };
    }

    case 'offers':
      return { ...r(L(lang, 'Offers give you cash back at places you already shop. I sort them by what they would have earned you last month.', 'Las ofertas te dan reembolsos donde ya compras.')), links: [{ label: L(lang, 'See offers', 'Ver ofertas'), href: '/travel?tab=offers' }] };

    case 'split_bill':
      return {
        ...r(L(lang, "Take a photo of the receipt and I'll work out who owes what, tax and tip included. You can also split any card purchase evenly.", 'Toma una foto del recibo y calcularé cuánto debe cada quien.')),
        links: [{ label: L(lang, 'Split a bill', 'Dividir cuenta'), href: '/split' }],
        effect: { type: 'navigate', href: '/split' },
      };

    case 'change_address':
      return {
        ...r(L(lang, "Moving? You can update your address yourself. We'll text a code to the phone on file to confirm it's you, and it takes effect right away.", '¿Te mudaste? Puedes actualizar tu dirección. Te enviaremos un código para confirmar.')),
        links: [{ label: L(lang, 'Change address', 'Cambiar dirección'), href: '/settings?change=address' }],
      };

    case 'change_name':
      return {
        ...r(L(lang, "Congratulations if it's a happy change! You can request a legal name change in the app. Upload a photo of the document — a marriage certificate, divorce decree, court order or updated ID — and we'll review it, usually within one business day. You'll be updated here the moment it's approved.", 'Puedes solicitar un cambio de nombre legal en la app subiendo el documento. Lo revisamos en un día hábil.')),
        links: [{ label: L(lang, 'Request name change', 'Solicitar cambio'), href: '/settings?change=name' }],
      };

    case 'password':
      return {
        ...r(L(lang, 'You can change your password or username in Settings → Security. You can sign in with either your username or your email.', 'Puedes cambiar tu contraseña o usuario en Ajustes → Seguridad.')),
        links: [{ label: L(lang, 'Security settings', 'Seguridad'), href: '/settings#security' }],
      };

    case 'bigger_text':
      return {
        ...r(L(lang, "Done — text is bigger. Want it bigger still, more contrast, or Simple mode? It's all in Accessibility.", 'Listo, hice la letra más grande.')),
        effect: { type: 'text_scale', scale: 1.25 },
        links: [{ label: L(lang, 'More accessibility options', 'Más opciones'), href: '/settings/accessibility' }],
      };

    case 'accessibility':
      return {
        ...r(L(lang, 'You can make text bigger, raise contrast, use a font that is easier to read, turn on Simple mode with bigger buttons, have pages read aloud, or switch to Spanish.', 'Puedes agrandar la letra, aumentar el contraste, usar el modo simple o escuchar las páginas.')),
        links: [{ label: L(lang, 'Accessibility settings', 'Accesibilidad'), href: '/settings/accessibility' }],
      };

    case 'explain_page': {
      const guide = guideFor(c.page);
      if (!guide) return r(L(lang, 'This screen shows part of your account. Ask me about anything you see.', 'Esta pantalla muestra parte de tu cuenta.'));
      return {
        ...r(lang === 'es' ? `${guide.es.title}: ${guide.es.what}` : `${guide.title}: ${guide.what}`),
        facts: guide.canDo.map((d, i) => ({ label: `${i + 1}`, value: d })),
      };
    }

    case 'tour':
      return {
        ...r(L(lang, "Say less — quick tour, about a minute. Bail out whenever.", '¡Listo! Un tour rápido de un minuto. Puedes salir cuando quieras.')),
        effect: { type: 'start_tour' },
      };

    case 'navigate': {
      const page = extractPage(message);
      if (!page) return { ...r(L(lang, 'Where would you like to go?', '¿A dónde quieres ir?')), suggestions: ['Home', 'Subscriptions', 'Spending', 'Travel'] };
      return { ...r(L(lang, `Taking you to ${page.label}.`, `Te llevo a ${page.label}.`)), links: [{ label: page.label, href: page.href }], effect: { type: 'navigate', href: page.href } };
    }

    case 'alerts':
      return {
        ...r(L(lang, `You have ${c.unreadAlerts} unread alert${c.unreadAlerts === 1 ? '' : 's'}. Every card charge is recorded in your inbox, even if the phone notification doesn't arrive — and you can test phone alerts from the Alerts page.`, `Tienes ${c.unreadAlerts} alertas sin leer.`)),
        links: [{ label: L(lang, 'Open alerts', 'Ver alertas'), href: '/alerts' }],
      };

    case 'human':
      return {
        ...r(L(lang, "Got you. Real humans, 24/7. Chat now, call without re-verifying, or get a callback — whoever picks up already sees this conversation.", 'Claro. Hay personas disponibles 24/7. Chatea, llama o te llamamos.')),
        handoff: { topic: topicFor(state.lastIntent === 'human' ? null : state.lastIntent), urgent: true, reason: 'asked' },
        suggestions: [],
      };

    case 'fallback':
      return fallback(message, c, state, alternative);
  }
}

function lockProposal(cc: OriAccount, lock: boolean, lang: Lang): ProposedAction {
  return {
    action: { type: 'lock_card', accountId: cc.id, locked: lock },
    title: lock ? L(lang, `Lock card ••${cc.last4}`, `Bloquear tarjeta ••${cc.last4}`) : L(lang, `Unlock card ••${cc.last4}`, `Desbloquear ••${cc.last4}`),
    summary: lock
      ? L(lang, 'New purchases will be declined until you unlock it. Nothing is cancelled.', 'Se rechazarán compras nuevas hasta que la desbloquees.')
      : L(lang, 'Purchases will go through again.', 'Las compras funcionarán de nuevo.'),
    confirmLabel: lock ? L(lang, 'Lock card', 'Bloquear') : L(lang, 'Unlock card', 'Desbloquear'),
    danger: lock,
  };
}
