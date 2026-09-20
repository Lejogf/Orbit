'use client';

// A one-minute guided tour for first-time customers. It spotlights the real
// controls rather than showing screenshots, reads each step aloud when the
// customer has voice turned on, and can be left at any time with Escape.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccessibility } from '@/lib/accessibility';

interface Step {
  /** data-tour value; phones use the "-m" variant when there is one. */
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { target: 'home', title: 'Home', body: 'Your “Safe to Spend” lives here: the money that’s really free once upcoming bills are set aside.' },
  { target: 'accounts', title: 'Accounts', body: 'Balances and every transaction. Search for any purchase, or lock your card in one tap.' },
  { target: 'subscriptions', title: 'Subscriptions', body: 'Every service that charges you again and again. Block one, or have us ask you before each charge.' },
  { target: 'alerts', title: 'Alerts', body: 'Every charge and notice is kept here, even if the pop-up disappears.' },
  { target: 'accessibility', title: 'Make it easier to use', body: 'Bigger text, stronger contrast, Simple mode and reading aloud — the “Aa” button at the top does the same.' },
  { target: 'eno', title: 'Ask Ori anything', body: 'Type or speak a question. Ori can take you anywhere, explain any screen, or put you through to a real person, 24/7.' },
];

function findTarget(step: Step): HTMLElement | null {
  const mobile = window.matchMedia('(max-width: 1023px)').matches;
  const candidates = [
    mobile ? document.querySelector<HTMLElement>(`[data-tour="${step.target}-m"]`) : null,
    document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`),
  ];
  return candidates.find((el) => el && el.offsetParent !== null) ?? null;
}

export function Tour() {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const { settings, speak, stopSpeaking } = useAccessibility();
  const card = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  const end = useCallback(() => {
    current.current?.classList.remove('tour-target');
    current.current = null;
    setIndex(null);
    stopSpeaking();
  }, [stopSpeaking]);

  useEffect(() => {
    const start = () => setIndex(0);
    window.addEventListener('orbit:tour', start);
    return () => window.removeEventListener('orbit:tour', start);
  }, []);

  useEffect(() => {
    if (index === null) return;
    const step = STEPS[index];
    if (!step) return end();

    current.current?.classList.remove('tour-target');
    const el = findTarget(step);
    current.current = el;
    if (el) {
      el.classList.add('tour-target');
      el.scrollIntoView({ block: 'nearest' });
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
    card.current?.focus();
    if (settings.oriVoice) speak(`${step.title}. ${step.body}`);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end();
      if (e.key === 'ArrowRight') setIndex((i) => (i === null ? i : i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => (i === null || i === 0 ? i : i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, end, settings.oriVoice, speak]);

  if (index === null) return null;
  const step = STEPS[index]!;

  // Place the card beside the target on desktop, or above the tab bar on phones.
  const style: React.CSSProperties = {};
  if (rect && window.innerWidth >= 1024) {
    style.left = Math.min(rect.right + 20, window.innerWidth - 340);
    style.top = Math.max(16, Math.min(rect.top - 8, window.innerHeight - 240));
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="absolute inset-0 bg-ink-900/55" onClick={end} aria-hidden="true" />
      <div
        ref={card}
        tabIndex={-1}
        style={style}
        className="animate-rise absolute inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-[62] rounded-2xl bg-surface p-5 shadow-2xl outline-none lg:inset-x-auto lg:bottom-auto lg:w-80"
      >
        <p className="label">
          Step {index + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold text-ink-900">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={end} className="text-sm font-semibold text-ink-500 hover:text-ink-800">
            Skip tour
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button onClick={() => setIndex(index - 1)} className="btn-ghost !py-2">
                Back
              </button>
            )}
            <button onClick={() => (index === STEPS.length - 1 ? end() : setIndex(index + 1))} className="btn-primary !py-2">
              {index === STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
