'use client';

// Accessibility, in one place, in plain words. Every change applies instantly
// and is saved to the account, so it follows the customer to any device.
//
// Grouped by what people struggle with — seeing, reading, moving, hearing,
// understanding, and staying safe — rather than by technical feature.
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { Switch } from '@/components/QuickDisplay';
import { TEXT_SCALES, useAccessibility } from '@/lib/accessibility';
import type { AccessibilitySettings } from '@/lib/api';
import { askOri } from '@/components/ori/OriAssistant';

const PRESETS: { id: string; title: string; body: string; apply: Partial<AccessibilitySettings> }[] = [
  {
    id: 'vision',
    title: 'Easier to see',
    body: 'Bigger text, strong contrast, clearer font, visible focus.',
    apply: { textScale: 1.5, contrast: 'high', font: 'readable', focusRing: 'strong', underlineLinks: true },
  },
  {
    id: 'simple',
    title: 'Keep it simple',
    body: 'Fewer things on screen, bigger buttons, more time, extra checks before money moves.',
    apply: { simpleMode: true, largeTargets: true, textScale: 1.3, sessionMinutes: 60, confirmMoney: true, motion: 'reduce' },
  },
  {
    id: 'reading',
    title: 'Easier to read',
    body: 'Reading-friendly font, more space between lines and words.',
    apply: { font: 'dyslexic', lineSpacing: 'relaxed', textScale: 1.15 },
  },
  {
    id: 'motor',
    title: 'Easier to tap',
    body: 'Large touch targets, no animation, strong keyboard focus, more time.',
    apply: { largeTargets: true, motion: 'reduce', focusRing: 'strong', sessionMinutes: 120 },
  },
];

export default function AccessibilityPage() {
  const { settings, update, reset, speak, speaking, stopSpeaking } = useAccessibility();
  const [saved, setSaved] = useState<string | null>(null);

  const change = (patch: Partial<AccessibilitySettings>, note = 'Saved') => {
    update(patch);
    setSaved(note);
    setTimeout(() => setSaved(null), 1800);
  };

  const scaleIndex = Math.max(0, TEXT_SCALES.findIndex((s) => s >= settings.textScale - 0.001));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/settings', label: 'Settings' }}
        eyebrow="Settings"
        title="Accessibility"
        subtitle="Make Orbit easier to see, read, hear and use. Changes apply straight away and follow you to any device."
        action={
          <span className="text-sm font-medium text-accent-600" role="status" aria-live="polite">
            {saved ? `✓ ${saved}` : ''}
          </span>
        }
      />

      <section aria-labelledby="presets-heading">
        <h2 id="presets-heading" className="label mb-2">Quick start</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => change(preset.apply, `${preset.title} turned on`)}
              className="card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="block text-base font-semibold text-ink-900">{preset.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-700">{preset.body}</span>
            </button>
          ))}
        </div>
      </section>

      <Group title="Appearance" id="appearance">
        <Choice
          label="Theme"
          value={settings.theme}
          options={[
            ['system', 'Match my device'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={(theme) => change({ theme: theme as AccessibilitySettings['theme'] })}
          hint="Dark mode is easier on the eyes at night and for light sensitivity."
        />
      </Group>

      <Group title="Seeing" id="seeing">
        <div className="px-2 py-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="text-size" className="text-sm font-medium text-ink-900">Text size</label>
            <span className="text-sm font-semibold text-ink-800 tnum">{Math.round(settings.textScale * 100)}%</span>
          </div>
          <input
            id="text-size"
            type="range"
            min={0}
            max={TEXT_SCALES.length - 1}
            step={1}
            value={scaleIndex}
            aria-valuetext={`${Math.round(settings.textScale * 100)} percent`}
            onChange={(e) => change({ textScale: TEXT_SCALES[Number(e.target.value)]! })}
            className="mt-3 w-full accent-accent-500"
          />
          <p className="mt-2 text-ink-800" style={{ fontSize: `${settings.textScale}rem` }}>
            Available balance: $1,240.18
          </p>
        </div>
        <Switch label="High contrast" description="Darker text, white backgrounds, visible borders." on={settings.contrast === 'high'} onChange={(on) => change({ contrast: on ? 'high' : 'standard' })} />
        <Switch label="Colour-blind friendly" description="Never rely on red and green alone. Money in turns blue, warnings amber, always with a label." on={settings.colorSafe} onChange={(on) => change({ colorSafe: on })} />
        <Switch label="Strong focus outline" description="A thick outline shows exactly where you are when using a keyboard or switch." on={settings.focusRing === 'strong'} onChange={(on) => change({ focusRing: on ? 'strong' : 'standard' })} />
        <Switch label="Underline links" description="So links are recognisable without relying on colour." on={settings.underlineLinks} onChange={(on) => change({ underlineLinks: on })} />
      </Group>

      <Group title="Reading" id="reading">
        <Choice
          label="Font"
          value={settings.font}
          options={[
            ['default', 'Standard'],
            ['readable', 'Hyperlegible — for low vision'],
            ['dyslexic', 'Lexend — for dyslexia and reading fluency'],
          ]}
          onChange={(font) => change({ font: font as AccessibilitySettings['font'] })}
        />
        <Switch label="More space between lines" description="Makes long text easier to follow." on={settings.lineSpacing === 'relaxed'} onChange={(on) => change({ lineSpacing: on ? 'relaxed' : 'normal' })} />
        <Choice
          label="Language"
          value={settings.language}
          options={[
            ['en', 'English'],
            ['es', 'Español'],
          ]}
          onChange={(language) => change({ language: language as 'en' | 'es' })}
          hint="Menus, Ori and support switch language. Ori also replies in Spanish whenever you write to it in Spanish."
        />
      </Group>

      <Group title="Hearing and listening" id="hearing">
        <Switch label="Ori reads its answers aloud" description="Spoken replies, at the speed you choose below." on={settings.oriVoice} onChange={(on) => change({ oriVoice: on })} />
        <div className="px-2 py-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="rate" className="text-sm font-medium text-ink-900">Reading speed</label>
            <span className="text-sm font-semibold tnum text-ink-800">{settings.readAloudRate.toFixed(2)}×</span>
          </div>
          <input id="rate" type="range" min={0.5} max={1.5} step={0.05} value={settings.readAloudRate} onChange={(e) => change({ readAloudRate: Number(e.target.value) })} className="mt-3 w-full accent-accent-500" />
          <button onClick={() => (speaking ? stopSpeaking() : speak('This is how Orbit sounds at this speed. Your safe to spend is one thousand, two hundred and forty dollars.'))} className="btn-ghost mt-3">
            {speaking ? 'Stop' : 'Play a sample'}
          </button>
        </div>
        <p className="px-2 pb-2 text-sm text-ink-700">
          Deaf or hard of hearing? Every alert is written, never sound-only, and{' '}
          <Link href="/support" className="font-semibold text-ink-700 underline">support</Link> offers ASL video interpreters, TTY and text chat.
        </p>
      </Group>

      <Group title="Moving and tapping" id="motor">
        <Switch label="Larger buttons" description="Every button and link at least 44 pixels, easier for shaky hands." on={settings.largeTargets} onChange={(on) => change({ largeTargets: on })} />
        <Switch label="Reduce motion" description="Turns off animations and sliding panels." on={settings.motion === 'reduce'} onChange={(on) => change({ motion: on ? 'reduce' : 'system' })} />
        <p className="px-2 pb-2 text-sm text-ink-700">
          Voice control works everywhere: tap the microphone in Ori and say what you want, like “move one hundred dollars to savings”. Everything also works with a keyboard or switch — press Tab to move, Enter to choose.
        </p>
      </Group>

      <Group title="Understanding" id="cognitive">
        <Switch label="Simple mode" description="Shows only what matters most, in plain words, with bigger buttons." on={settings.simpleMode} onChange={(on) => change({ simpleMode: on, largeTargets: on || settings.largeTargets })} />
        <div className="flex flex-wrap gap-2 px-2 py-3">
          <button className="btn-ghost" onClick={() => window.dispatchEvent(new Event('orbit:tour'))}>Take the 1-minute tour</button>
          <button className="btn-ghost" onClick={() => askOri('What is this page?')}>Ask Ori to explain a page</button>
        </div>
      </Group>

      <Group title="Staying safe" id="safety">
        <Switch label="Double-check before money moves" description="Transfers ask you to confirm twice, so a slip of the finger can’t send money." on={settings.confirmMoney} onChange={(on) => change({ confirmMoney: on })} />
        <Choice
          label="Sign me out after"
          value={String(settings.sessionMinutes)}
          options={[
            ['15', '15 minutes of no activity'],
            ['30', '30 minutes'],
            ['60', '1 hour'],
            ['120', '2 hours'],
          ]}
          onChange={(v) => change({ sessionMinutes: Number(v) as AccessibilitySettings['sessionMinutes'] })}
          hint="We always warn you a minute before, and one tap keeps you signed in."
        />
        <p className="px-2 pb-2 text-sm text-ink-700">
          Add a <Link href="/settings#trusted" className="font-semibold underline">trusted contact</Link> — someone we can call if we see activity that looks like a scam. It gives them no access to your money.
        </p>
      </Group>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => { reset(); setSaved('Back to standard settings'); }} className="btn-danger">
          Reset to standard
        </button>
        <p className="text-xs text-ink-600">Designed to meet WCAG 2.2 AA. Pinch-to-zoom always works.</p>
      </div>
    </div>
  );
}

function Group({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="mb-1 px-2 text-base font-semibold text-ink-900">{title}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <fieldset className="px-2 py-3">
      <legend className="text-sm font-medium text-ink-900">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(([id, text]) => (
          <label
            key={id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 transition ${
              value === id ? 'bg-surface-sunken font-semibold text-ink-900 ring-accent-500' : 'text-ink-800 ring-line hover:bg-surface-sunken'
            }`}
          >
            <input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)} className="h-4 w-4 accent-accent-500" />
            {text}
          </label>
        ))}
      </div>
      {hint && <p className="mt-2 text-xs text-ink-600">{hint}</p>}
    </fieldset>
  );
}
