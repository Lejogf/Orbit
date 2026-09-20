'use client';

// Accessibility settings: applied the instant they change, remembered on this
// device (so even the sign-in screen honours them), and saved to the account so
// they follow the customer to any phone or computer.
//
// Everything is expressed as attributes on <html>, and globals.css does the
// rest. Text size scales the root font size, so every rem-based measurement —
// type, spacing, touch targets — grows together instead of text overflowing its
// boxes.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { more, type AccessibilitySettings } from '@/lib/api';

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  theme: 'system',
  textScale: 1,
  contrast: 'standard',
  font: 'default',
  lineSpacing: 'normal',
  motion: 'system',
  simpleMode: false,
  underlineLinks: false,
  largeTargets: false,
  colorSafe: false,
  focusRing: 'standard',
  language: 'en',
  readAloudRate: 1,
  confirmMoney: true,
  sessionMinutes: 30,
  oriVoice: false,
};

const STORAGE_KEY = 'flow.a11y.v1';
export const TEXT_SCALES = [1, 1.15, 1.3, 1.5, 1.75, 2] as const;

/** Keeps only known keys with the right types, so old or tampered storage can't break the app. */
export function sanitize(value: unknown): AccessibilitySettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const candidate = input[key];
    if (typeof candidate === typeof fallback) out[key] = candidate;
  }
  const settings = out as unknown as AccessibilitySettings;
  settings.textScale = Math.min(2, Math.max(1, settings.textScale));
  settings.readAloudRate = Math.min(1.5, Math.max(0.5, settings.readAloudRate));
  return settings;
}

function readStored(): AccessibilitySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStored(settings: AccessibilitySettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings still apply for this visit.
  }
}

/** 'system' follows the device; anything else is the customer's explicit choice. */
export function resolveTheme(theme: AccessibilitySettings['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyToDocument(settings: AccessibilitySettings): void {
  const root = document.documentElement;
  root.style.fontSize = `${settings.textScale * 100}%`;
  root.lang = settings.language;
  root.dataset.theme = resolveTheme(settings.theme);
  const attrs: Record<string, string> = {
    contrast: settings.contrast,
    font: settings.font,
    spacing: settings.lineSpacing,
    motion: settings.motion,
    simple: String(settings.simpleMode),
    underline: String(settings.underlineLinks),
    targets: settings.largeTargets ? 'large' : 'standard',
    colorsafe: String(settings.colorSafe),
    focus: settings.focusRing,
  };
  for (const [key, value] of Object.entries(attrs)) root.dataset[key] = value;
}

interface AccessibilityContextValue {
  settings: AccessibilitySettings;
  update: (patch: Partial<AccessibilitySettings>) => void;
  reset: () => void;
  /** Loads the account's saved settings. Called once signed in. */
  syncFromAccount: () => Promise<void>;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  speaking: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

export function useAccessibility(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext);
  if (!context) throw new Error('useAccessibility must be used inside <AccessibilityProvider>');
  return context;
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AccessibilitySettings>(DEFAULT_SETTINGS);
  const [speaking, setSpeaking] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Only push to the server once we know there is a signed-in account. */
  const signedIn = useRef(false);

  useEffect(() => {
    const stored = readStored();
    setSettings(stored);
    applyToDocument(stored);
  }, []);

  // Follow the device's light/dark switch while the choice is "system".
  useEffect(() => {
    if (settings.theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyToDocument(settings);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [settings]);

  const persist = useCallback((next: AccessibilitySettings) => {
    writeStored(next);
    if (!signedIn.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Debounced: dragging a slider shouldn't send a request per step.
    saveTimer.current = setTimeout(() => {
      more.saveAccessibility(next).catch(() => undefined);
    }, 600);
  }, []);

  const update = useCallback(
    (patch: Partial<AccessibilitySettings>) => {
      setSettings((current) => {
        const next = sanitize({ ...current, ...patch });
        applyToDocument(next);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    applyToDocument(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
    persist(DEFAULT_SETTINGS);
  }, [persist]);

  const syncFromAccount = useCallback(async () => {
    try {
      const remote = sanitize(await more.accessibility());
      signedIn.current = true;
      const local = readStored();
      // A device that has been customised but never saved (e.g. set up on the
      // sign-in screen) wins over untouched account defaults.
      const remoteIsDefault = JSON.stringify(remote) === JSON.stringify(DEFAULT_SETTINGS);
      const localIsDefault = JSON.stringify(local) === JSON.stringify(DEFAULT_SETTINGS);
      const chosen = remoteIsDefault && !localIsDefault ? local : remote;
      applyToDocument(chosen);
      setSettings(chosen);
      writeStored(chosen);
      if (chosen === local && !localIsDefault) more.saveAccessibility(local).catch(() => undefined);
    } catch {
      // Keep device settings.
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = settings.readAloudRate;
      utterance.lang = settings.language === 'es' ? 'es-US' : 'en-US';
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [settings.readAloudRate, settings.language],
  );

  const value = useMemo(
    () => ({ settings, update, reset, syncFromAccount, speak, stopSpeaking, speaking }),
    [settings, update, reset, syncFromAccount, speak, stopSpeaking, speaking],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

/** Text of the main content, for "read this page aloud". Skips hidden and aria-hidden bits. */
export function readableText(root: HTMLElement | null): string {
  if (!root) return '';
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"], script, style, svg, .sr-skip').forEach((el) => el.remove());
  return (clone.innerText || clone.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, 4000);
}
