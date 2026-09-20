'use client';

// Ori: the assistant button and panel.
//
// Placement follows the navigation: on phones the button sits above the tab
// bar at bottom-right, where a thumb rests; on desktop it sits bottom-right of
// the page, clear of the sidebar. The panel is a side sheet on desktop and a
// full-height sheet on phones.
//
// Nothing Ori proposes happens until the customer confirms it, and "Talk to a
// person" is in the header of every conversation — never buried.
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, more, ApiRequestError, type OriReply, type OriState } from '@/lib/api';
import { useAccessibility } from '@/lib/accessibility';
import { useT } from '@/lib/i18n';
import { useSession } from '@/components/AuthGuard';
import { useToast } from '@/components/Toast';
import { OriMessage, type ChatEntry } from './OriMessage';
import { useSpeechInput } from './useSpeechInput';
import { OriAvatar } from '@/components/brand';

const STORE_KEY = 'orbit.ori.v1';
const SEEN_KEY = 'orbit.ori.seen.v1';
export const HANDOFF_KEY = 'orbit.handoff.v1';

interface Stored {
  entries: ChatEntry[];
  state: OriState | null;
}

function load(): Stored {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return { entries: [], state: null };
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed.entries) ? parsed : { entries: [], state: null };
  } catch {
    return { entries: [], state: null };
  }
}

function save(value: Stored) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...value, entries: value.entries.slice(-40) }));
  } catch {
    // The conversation still works; it just won't survive a reload.
  }
}

/** Opens Ori from anywhere: window.dispatchEvent(new CustomEvent('orbit:ori', { detail: 'question' })) */
export function askOri(question?: string) {
  window.dispatchEvent(new CustomEvent('orbit:ori', { detail: question ?? null }));
}

export function OriAssistant() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useSession();
  const { settings, update, speak, stopSpeaking } = useAccessibility();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [state, setState] = useState<OriState | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [firstVisit, setFirstVisit] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  /** Plays one rotation of Ori's mark as the panel opens. */
  const [spinning, setSpinning] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  /** Latest `send`, so callbacks created earlier never use stale conversation state. */
  const sendRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const stored = load();
    setEntries(stored.entries);
    setState(stored.state);
    try {
      setFirstVisit(!window.localStorage.getItem(SEEN_KEY));
    } catch {
      setFirstVisit(false);
    }
  }, []);

  useEffect(() => setAutoSpeak(settings.oriVoice), [settings.oriVoice]);

  useEffect(() => save({ entries, state }), [entries, state]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: settings.motion === 'reduce' ? 'auto' : 'smooth' });
  }, [entries, busy, settings.motion]);

  const greet = useCallback(() => {
    const es = settings.language === 'es';
    return {
      id: `greet-${Date.now()}`,
      from: 'eno' as const,
      reply: {
        intent: 'greeting',
        text: es
          ? `Hola ${session.customer.firstName}, soy Ori. Pregúntame lo que quieras, o toca una opción. Si prefieres hablar con una persona, el botón está arriba.`
          : `Hi ${session.customer.firstName}, I'm Ori. Ask me anything about your money or this app — or tap an idea below. If you'd rather talk to a person, that button is always at the top.`,
        facts: [],
        links: [],
        proposal: null,
        effect: null,
        handoff: null,
        suggestions: es
          ? ['¿Qué es esta página?', '¿Cuánto puedo gastar?', 'Muéstrame la app', 'Letra más grande']
          : ['What is this page?', 'How much can I spend?', "I'm new — show me around", 'Make the text bigger'],
        state: { misses: 0, lastIntent: null, lastMessage: null, lang: settings.language },
      },
    };
  }, [session.customer.firstName, settings.language]);

  const openPanel = useCallback(
    (question?: string | null) => {
      setOpen(true);
      setFirstVisit(false);
      setSpinning(true);
      setTimeout(() => setSpinning(false), 950);
      try {
        window.localStorage.setItem(SEEN_KEY, '1');
      } catch {
        // fine
      }
      setEntries((current) => (current.length === 0 ? [greet()] : current));
      if (question) setTimeout(() => void sendRef.current(question), 50);
      else setTimeout(() => input.current?.focus(), 60);
    },
    [greet],
  );

  const close = useCallback(() => {
    setOpen(false);
    stopSpeaking();
    setTimeout(() => launcher.current?.focus(), 30);
  }, [stopSpeaking]);

  useEffect(() => {
    const onAsk = (e: Event) => openPanel((e as CustomEvent<string | null>).detail);
    window.addEventListener('orbit:ori', onAsk);
    return () => window.removeEventListener('orbit:ori', onAsk);
  }, [openPanel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Clicking the page closes the panel on desktop. The conversation is kept,
    // so an accidental click never loses what was said.
    const onDown = (e: MouseEvent) => {
      if (!panel.current || panel.current.contains(e.target as Node)) return;
      if (launcher.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  /** Starts a fresh conversation. The panel stays open. */
  const newConversation = useCallback(() => {
    stopSpeaking();
    setState(null);
    setEntries([greet()]);
    setTimeout(() => input.current?.focus(), 30);
  }, [greet, stopSpeaking]);

  const applyEffect = useCallback(
    (reply: OriReply) => {
      const effect = reply.effect;
      if (!effect) return;
      if (effect.type === 'text_scale') update({ textScale: Math.max(settings.textScale, effect.scale) });
      if (effect.type === 'start_tour') {
        close();
        setTimeout(() => window.dispatchEvent(new Event('orbit:tour')), 200);
      }
      if (effect.type === 'navigate' && effect.href !== pathname) {
        router.push(effect.href);
        // On a phone the panel covers the page; get out of the way.
        if (window.matchMedia('(max-width: 1023px)').matches) setTimeout(close, 350);
      }
    },
    [close, pathname, router, settings.textScale, update],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setDraft('');
      setEntries((current) => [...current, { id: `u-${Date.now()}`, from: 'user', text: message }]);
      setBusy(true);
      try {
        const reply = await more.ori(message, pathname, state ?? undefined);
        setState(reply.state);
        setEntries((current) => [...current, { id: `e-${Date.now()}`, from: 'eno', reply }]);
        if (autoSpeak) speak(reply.text);
        applyEffect(reply);
      } catch (cause) {
        // Never "try again later": say what happened and offer a person now.
        const offline = cause instanceof ApiRequestError && cause.code === 'NETWORK';
        setEntries((current) => [
          ...current,
          {
            id: `x-${Date.now()}`,
            from: 'eno',
            reply: {
              intent: 'fallback',
              text: offline
                ? "I can't reach Orbit right now — your connection may have dropped. You can still call us: it's free, 24/7, and we'll verify you with a code instead of questions."
                : "Something went wrong on my side, and that's on me. A person can help you right now — they'll see what you asked.",
              facts: [],
              links: [],
              proposal: null,
              effect: null,
              handoff: { topic: 'General help', urgent: true, reason: 'error' },
              suggestions: [],
              state: state ?? { misses: 0, lastIntent: null, lastMessage: null, lang: 'en' },
            },
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [applyEffect, autoSpeak, busy, pathname, speak, state],
  );

  sendRef.current = send;

  const speech = useSpeechInput(settings.language, (heard) => void send(heard));

  const markDone = (id: string, outcome: 'done' | 'cancelled', note?: string) =>
    setEntries((current) =>
      current.map((e) => (e.id === id ? { ...e, outcome } : e)).concat(
        note ? [{ id: `n-${Date.now()}`, from: 'note', text: note }] : [],
      ),
    );

  const confirm = async (entry: ChatEntry) => {
    const proposal = entry.from === 'eno' ? entry.reply.proposal : null;
    if (!proposal) return;
    const action = proposal.action;
    try {
      if (action.type === 'lock_card') {
        await api.lockCard(action.accountId, action.locked);
        markDone(entry.id, 'done', action.locked ? 'Card locked. New purchases will be declined until you unlock it.' : 'Card unlocked.');
      } else if (action.type === 'subscription') {
        await api.subscriptionAction(action.subscriptionId, action.action);
        markDone(entry.id, 'done', action.action === 'block' ? 'Blocked. Your Safe to Spend has been updated.' : '"Ask me first" is on. We’ll check with you before the next charge.');
      } else if (action.type === 'transfer') {
        await api.transfer({ fromAccountId: action.fromAccountId, toAccountId: action.toAccountId, amountCents: action.amountCents });
        markDone(entry.id, 'done', 'Sent. The money is there now.');
      }
      window.dispatchEvent(new Event('orbit:data-changed'));
      toast.show('Done', 'success');
    } catch (cause) {
      markDone(entry.id, 'cancelled', cause instanceof Error ? `That didn't go through: ${cause.message}` : "That didn't go through.");
    }
  };

  const handoff = (channel: 'chat' | 'call' | 'callback', topic: string) => {
    const transcript = entries
      .filter((e) => e.from === 'user' || e.from === 'eno')
      .slice(-16)
      .map((e) => (e.from === 'user' ? { author: 'customer' as const, text: e.text } : { author: 'eno' as const, text: e.from === 'eno' ? e.reply.text : '' }))
      .filter((m) => m.text);
    try {
      window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ channel, topic, transcript }));
    } catch {
      // The support page still works without the transcript.
    }
    close();
    router.push(`/support?start=${channel}`);
  };

  return (
    <>
      {!open && (
        <div className="ori-launcher z-40 flex flex-col items-end gap-2">
          {firstVisit && (
            <button
              onClick={() => openPanel()}
              className="animate-rise max-w-[15rem] rounded-2xl rounded-br-md border border-line bg-surface px-4 py-3 text-left text-sm text-ink-800 shadow-float"
            >
              <strong className="block font-semibold">New here?</strong>
              Ask me anything, or say “show me around”.
            </button>
          )}
          <button
            ref={launcher}
            onClick={() => openPanel()}
            aria-label={t('ori.open')}
            data-tour="ori"
            className={`flex items-center gap-2.5 rounded-full bg-ink-900 pl-1.5 pr-1.5 text-canvas shadow-float transition-all duration-200 ease-spring hover:scale-[1.03] active:scale-95 lg:pr-5 ${
              firstVisit ? 'animate-pulse-ring' : ''
            } h-14`}
          >
            <OriAvatar size={44} spinning={spinning} />
            <span className="hidden text-sm font-semibold lg:inline">{t('ori.open')}</span>
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 lg:inset-auto lg:bottom-6 lg:right-6" role="dialog" aria-modal="false" aria-labelledby="ori-title">
          <button className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px] lg:hidden" aria-label={t('ori.close')} onClick={close} tabIndex={-1} />
          <section ref={panel} className="animate-rise absolute inset-x-0 bottom-0 top-8 flex flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-float lg:static lg:h-[min(44rem,calc(100vh-3rem))] lg:w-[26rem] lg:rounded-3xl lg:ring-1 lg:ring-line">
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <OriAvatar size={38} spinning={spinning} />
              <div className="min-w-0 flex-1">
                <h2 id="ori-title" className="font-display text-base font-bold text-ink-900">{t('ori.title')}</h2>
                <p className="text-[0.6875rem] text-ink-500">{t('ori.subtitle')}</p>
              </div>
              <button
                onClick={newConversation}
                title={t('ori.new')}
                aria-label={t('ori.new')}
                className="grid h-10 w-10 place-items-center rounded-full text-ink-500 transition hover:bg-surface-sunken"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                role="switch"
                aria-checked={autoSpeak}
                onClick={() => {
                  if (autoSpeak) stopSpeaking();
                  setAutoSpeak(!autoSpeak);
                  update({ oriVoice: !autoSpeak });
                }}
                title={t('ori.readAloud')}
                aria-label={t('ori.readAloud')}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition ${autoSpeak ? 'bg-ink-900 text-canvas' : 'text-ink-500 hover:bg-surface-sunken'}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                </svg>
              </button>
              <button onClick={close} aria-label={t('ori.close')} className="grid h-10 w-10 place-items-center rounded-full text-ink-500 hover:bg-surface-sunken">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </header>

            <button
              onClick={() => handoff('chat', 'General help')}
              className="flex items-center justify-center gap-2 border-b border-line bg-accent-50 px-4 py-2.5 text-sm font-semibold text-accent-800 transition hover:bg-accent-100"
            >
              <span className="h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" />
              {t('ori.human')} · 24/7
            </button>

            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-relevant="additions">
              {entries.map((entry) => (
                <OriMessage
                  key={entry.id}
                  entry={entry}
                  confirmTwice={settings.confirmMoney}
                  onSuggestion={(s) => void send(s)}
                  onConfirm={() => confirm(entry)}
                  onCancel={() => markDone(entry.id, 'cancelled', 'No problem — nothing was changed.')}
                  onHandoff={handoff}
                  onLink={(href) => {
                    if (href === '#explain') return void send('What is this page?');
                    if (/^https?:/.test(href)) return window.open(href, '_blank', 'noopener,noreferrer');
                    router.push(href);
                    if (window.matchMedia('(max-width: 1023px)').matches) close();
                  }}
                  onSpeak={(text) => speak(text)}
                />
              ))}
              {busy && (
                <div className="flex gap-1 px-2 py-3" aria-label="Ori is typing">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="typing-dot h-2 w-2 rounded-full bg-ink-400" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              )}
            </div>

            <form
              className="border-t border-line p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/25">
                <label htmlFor="ori-input" className="sr-only">{t('ori.placeholder')}</label>
                <textarea
                  id="ori-input"
                  ref={input}
                  rows={1}
                  value={draft}
                  maxLength={500}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  placeholder={speech.listening ? t('ori.listening') : t('ori.placeholder')}
                  className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400"
                />
                {speech.supported && (
                  <button
                    type="button"
                    onClick={speech.listening ? speech.stop : speech.start}
                    aria-label={t('ori.listen')}
                    aria-pressed={speech.listening}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                      speech.listening ? 'animate-pulse bg-danger-500 text-white' : 'text-ink-500 hover:bg-surface-sunken'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                  </button>
                )}
                <button type="submit" disabled={!draft.trim() || busy} aria-label={t('ori.send')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500 text-white transition hover:bg-accent-600 disabled:opacity-40">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
              {speech.error && <p className="mt-1.5 px-1 text-xs text-danger-600" role="alert">{speech.error}</p>}
            </form>
          </section>
        </div>
      )}
    </>
  );
}

