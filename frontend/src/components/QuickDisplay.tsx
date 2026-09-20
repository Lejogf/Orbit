'use client';

// The "Aa" control: the settings people most often need, one tap from any
// screen, without hunting through menus. Text size, contrast, simple mode and
// read-aloud — plus a link to everything else.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TEXT_SCALES, readableText, useAccessibility } from '@/lib/accessibility';
import { Segmented } from '@/components/ui';
import { useT } from '@/lib/i18n';

export function QuickDisplay({ compact = false }: { compact?: boolean }) {
  const { settings, update, speak, stopSpeaking, speaking } = useAccessibility();
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const index = TEXT_SCALES.findIndex((s) => s >= settings.textScale - 0.001);
  const step = (dir: 1 | -1) => {
    const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, (index === -1 ? 0 : index) + dir))]!;
    update({ textScale: next });
  };

  const readPage = () => {
    if (speaking) return stopSpeaking();
    speak(readableText(document.getElementById('main')));
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('a11y.quick')}
        title={t('a11y.quick')}
        className={`flex items-center justify-center rounded-full font-semibold text-ink-800 transition hover:bg-surface-sunken ${
          compact ? 'h-10 w-10 text-sm' : 'h-10 gap-2 border border-line bg-surface px-3.5 text-sm shadow-card'
        }`}
      >
        <span aria-hidden="true" className="text-base leading-none">
          A<span className="text-xs">a</span>
        </span>
        {!compact && <span className="hidden xl:inline">{t('a11y.quick')}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('a11y.quick')}
          className="animate-rise glass absolute right-0 top-12 z-50 w-72 rounded-2xl p-4"
        >
          <p className="label mb-2">{t('a11y.theme')}</p>
          <Segmented
            label={t('a11y.theme')}
            size="sm"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              ['light', t('a11y.light')],
              ['dark', t('a11y.dark')],
              ['system', t('a11y.system')],
            ] as const}
          />

          <p className="label mb-2 mt-4">{t('a11y.textSize')}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} disabled={index <= 0} className="btn-ghost h-11 w-11 !p-0 text-sm" aria-label="Smaller text">
              A−
            </button>
            <div className="flex-1 text-center text-sm font-semibold text-ink-900 tnum" aria-live="polite">
              {Math.round(settings.textScale * 100)}%
            </div>
            <button onClick={() => step(1)} disabled={index >= TEXT_SCALES.length - 1} className="btn-ghost h-11 w-11 !p-0 text-lg" aria-label="Bigger text">
              A+
            </button>
          </div>

          <div className="mt-4 space-y-1">
            <Switch label={t('a11y.contrast')} on={settings.contrast === 'high'} onChange={(on) => update({ contrast: on ? 'high' : 'standard' })} />
            <Switch label={t('a11y.simple')} on={settings.simpleMode} onChange={(on) => update({ simpleMode: on, largeTargets: on || settings.largeTargets })} />
            <Switch label="Español" on={settings.language === 'es'} onChange={(on) => update({ language: on ? 'es' : 'en' })} />
          </div>

          <button onClick={readPage} className="btn-accent mt-4 w-full">
            {speaking ? t('a11y.stop') : t('a11y.readPage')}
          </button>
          <Link href="/settings/accessibility" onClick={() => setOpen(false)} className="mt-3 block text-center text-sm font-semibold text-ink-600 underline-offset-2 hover:underline">
            {t('a11y.all')}
          </Link>
        </div>
      )}
    </div>
  );
}

export function Switch({ label, on, onChange, description }: { label: string; on: boolean; onChange: (on: boolean) => void; description?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-sunken"
    >
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-accent-500' : 'bg-ink-300'}`}
      >
        <span className={`absolute h-5 w-5 rounded-full bg-surface shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        <span className="sr-only">{on ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}
