'use client';

// Signs out an idle session — but warns first and lets the customer stay, and
// lets them choose how long "idle" means in Accessibility settings. Timing that
// can't be adjusted is a barrier for anyone who reads or types slowly
// (WCAG 2.2.1).
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/api';
import { useAccessibility } from '@/lib/accessibility';
import { useT } from '@/lib/i18n';

const WARNING_SECONDS = 60;

export function IdleGuard() {
  const { settings } = useAccessibility();
  const t = useT();
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActive = useRef(Date.now());
  const stayButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const touch = () => {
      if (remaining === null) lastActive.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, touch));
  }, [remaining]);

  useEffect(() => {
    const limit = settings.sessionMinutes * 60_000;
    const timer = setInterval(() => {
      const idle = Date.now() - lastActive.current;
      if (idle < limit) return;
      const left = WARNING_SECONDS - Math.floor((idle - limit) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        void auth.logout().finally(() => router.replace('/?reason=timeout'));
        return;
      }
      setRemaining(left);
    }, 1000);
    return () => clearInterval(timer);
  }, [settings.sessionMinutes, router]);

  useEffect(() => {
    if (remaining !== null) stayButton.current?.focus();
  }, [remaining !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (remaining === null) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-900/50 px-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-body">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-2xl">
        <h2 id="idle-title" className="text-lg font-semibold text-ink-900">{t('idle.title')}</h2>
        <p id="idle-body" className="mt-2 text-sm text-ink-700">
          {t('idle.body')} <span className="font-semibold tnum">{remaining}s</span>
        </p>
        <button
          ref={stayButton}
          className="btn-primary mt-5 w-full"
          onClick={() => {
            lastActive.current = Date.now();
            setRemaining(null);
          }}
        >
          {t('idle.stay')}
        </button>
        <p className="mt-3 text-xs text-ink-500">You can give yourself more time in Accessibility settings.</p>
      </div>
    </div>
  );
}
