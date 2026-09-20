// Live support: routing, honest wait times, and the demo agent.
//
// The handoff is what fixes the "bot loop": when Ori can't help, the customer is
// routed to a person who already has the conversation, their accessibility
// needs and a verified identity — so they never start again from zero.
//
// There is no real contact centre behind this build, so the agent's replies are
// scripted per topic. Everything around them (routing, verification, needs,
// transcript carry-over, callbacks) is the real design.

export type SupportChannel = 'chat' | 'callback' | 'call' | 'message';

export const ACCESS_NEEDS = [
  { id: 'spanish', label: 'Spanish-speaking agent' },
  { id: 'interpreter', label: 'Interpreter for another language' },
  { id: 'asl', label: 'ASL video interpreter' },
  { id: 'tty', label: 'TTY / relay service' },
  { id: 'slow', label: 'Please speak slowly and clearly' },
  { id: 'hearing', label: 'I am hard of hearing' },
  { id: 'vision', label: 'I use a screen reader' },
  { id: 'cognitive', label: 'Please explain step by step' },
  { id: 'trusted_contact', label: 'My trusted contact is with me' },
] as const;

export type AccessNeed = (typeof ACCESS_NEEDS)[number]['id'];

/** Specialist teams. Fraud and scams jump the general queue. */
export function teamFor(topic: string): { team: string; priority: boolean } {
  const t = topic.toLowerCase();
  if (/scam|fraud|recogni|stolen|lost|dispute/.test(t)) return { team: 'Fraud & Security', priority: true };
  if (/name|address|sign/.test(t)) return { team: 'Account Services', priority: false };
  if (/travel|trip|flight|hotel/.test(t)) return { team: 'Travel Concierge', priority: false };
  if (/credit|plan|pay over/.test(t)) return { team: 'Lending', priority: false };
  return { team: 'Customer Care', priority: false };
}

/**
 * An honest estimate, in minutes. Nights are quieter; priority topics and
 * callbacks skip the line; interpreters take a moment to join.
 */
export function estimateWaitMinutes(input: {
  channel: SupportChannel;
  hourUtc: number;
  queueDepth: number;
  priority: boolean;
  needs: AccessNeed[];
}): number {
  if (input.channel === 'message') return 60 * 4;
  const busy = input.hourUtc >= 13 && input.hourUtc <= 23 ? 1.6 : 0.6;
  let minutes = Math.max(0.5, input.queueDepth * 0.8 * busy);
  if (input.priority) minutes = Math.min(minutes, 1);
  if (input.needs.includes('asl') || input.needs.includes('interpreter')) minutes += 2;
  return Math.round(minutes * 10) / 10;
}

const AGENTS = ['Maya', 'Andre', 'Priya', 'Luis', 'Grace', 'Omar', 'Sofia', 'Daniel'];

export function agentFor(caseId: string, needs: AccessNeed[]): string {
  // Spanish requests go to a bilingual agent.
  if (needs.includes('spanish')) return caseId.length % 2 === 0 ? 'Sofia' : 'Luis';
  let h = 0;
  for (const ch of caseId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENTS[h % AGENTS.length]!;
}

/** A spoken code: read it to the agent and you're verified, no security questions. */
export function callCode(seed: number): string {
  const n = (seed * 7919 + 104_729) % 1_000_000;
  const s = String(n).padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

export const SUPPORT_PHONE = '1-800-555-0199';

/**
 * The scripted agent. `turn` counts the agent's own messages in this case, so
 * the conversation moves forward instead of repeating itself.
 */
export function agentReply(input: {
  agent: string;
  firstName: string;
  topic: string;
  turn: number;
  needs: AccessNeed[];
  hadOriTranscript: boolean;
  customerMessage: string;
}): string {
  const { agent, firstName, topic, turn } = input;
  const spanish = input.needs.includes('spanish');
  const { team } = teamFor(topic);

  if (turn === 0) {
    const context = input.hadOriTranscript
      ? spanish ? 'Ya leí tu conversación con Ori, así que no tienes que repetir nada.' : "I've read your conversation with Ori, so you don't need to repeat anything."
      : '';
    const needsNote = input.needs.length > 0
      ? spanish ? 'También vi tus preferencias de accesibilidad.' : "I've also noted your accessibility preferences and I'll go at your pace."
      : '';
    return spanish
      ? `Hola ${firstName}, soy ${agent} del equipo de ${team}. ${context} ${needsNote} Ya verifiqué tu identidad por la app. ¿Cómo te ayudo con "${topic}"?`.replace(/\s+/g, ' ')
      : `Hi ${firstName}, I'm ${agent} from ${team}. ${context} ${needsNote} You're already verified through the app. How can I help with "${topic}"?`.replace(/\s+/g, ' ');
  }

  const msg = input.customerMessage.toLowerCase();
  if (/thank|gracias|that.?s all|bye/.test(msg)) {
    return spanish
      ? `¡Con gusto, ${firstName}! Te envié un resumen a tu bandeja de alertas. Estamos aquí 24/7.`
      : `You're very welcome, ${firstName}. I've sent a summary of what we did to your Alerts inbox. We're here 24/7 if you need anything else.`;
  }

  const t = topic.toLowerCase();
  const scripts: [RegExp, string[]][] = [
    [/scam|fraud|recogni|dispute/, [
      "Thanks. I've placed a temporary hold on the charge and opened dispute case #D-48213. You won't be charged for it while we investigate, and most cases close within 10 business days.",
      "I'm also sending you a new card number. Your subscriptions can move over automatically — would you like that?",
      'Done. The new card arrives in 2–3 business days, and your digital card works in the app right now.',
    ]],
    [/lost|stolen/, [
      "Your card is locked, so no one can use it. I've ordered a replacement to the address on file — it'll arrive in 2–3 business days. Need it sooner? I can overnight it for free.",
      "It's on its way overnight. Your virtual card number is active in the app today, and I'll move your subscriptions to the new card so nothing fails.",
    ]],
    [/name/, [
      "I can see your name change request. If you upload the document in Settings, I'll review it while we're talking.",
      "I've reviewed it and everything matches. Your new name is approved — new cards will be printed with it and mailed within 5 business days.",
    ]],
    [/address/, [
      "I can update that for you, or you can do it yourself in Settings in about a minute with a text code. Which would you prefer?",
      "All set. Your statements and new cards will go to the new address.",
    ]],
    [/travel|trip|flight|hotel/, [
      'Happy to help with your trip. I can change dates, add a traveller, or rebook if a flight is cancelled — what do you need?',
      "Done — I've updated the booking. Your price drop protection carries over to the new itinerary.",
    ]],
  ];

  const script = scripts.find(([pattern]) => pattern.test(t))?.[1] ?? [
    'Got it. Let me look into that for you — one moment.',
    "I've taken care of that. Is there anything else I can help with today?",
  ];

  const line = script[Math.min(turn - 1, script.length - 1)]!;
  return spanish ? `${line} (Te lo explico en español si prefieres.)` : line;
}
