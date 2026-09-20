'use client';

// Transient notifications. They announce themselves, hold for a few seconds,
// then fade out on their own — a message that stays on screen forever stops
// reading as feedback and starts reading as page furniture.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** How long it stays up, in ms. */
  duration: number;
  /** Repeats of the same message collapse into one and bump this. */
  count: number;
  /** Set while the exit animation plays, before removal. */
  leaving?: boolean;
}

/** Never show more than this many at once, however fast they arrive. */
const MAX_VISIBLE = 3;

interface ToastContextValue {
  show: (message: string, tone?: ToastTone, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

/** Longer for warnings and errors, which carry more to read. */
const DURATION: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: 8000,
};

const EXIT_MS = 350;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** Cancel functions for each toast's pending auto-dismiss. */
  const timers = useRef(new Map<number, () => void>());

  const dismiss = useCallback((id: number) => {
    timers.current.get(id)?.();
    timers.current.delete(id);
    // Mark as leaving so the exit animation can run, then remove.
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const scheduleDismiss = useCallback(
    (id: number, ms: number) => {
      const handle = setTimeout(() => dismiss(id), ms);
      return () => clearTimeout(handle);
    },
    [dismiss],
  );

  const show = useCallback(
    (message: string, tone: ToastTone = 'success', duration?: number) => {
      const ms = duration ?? DURATION[tone];

      setToasts((current) => {
        // Same message already on screen: collapse into it and restart its timer
        // rather than stacking a duplicate. Pressing "Test charge" ten times
        // should read "×10", not bury the page.
        const existing = current.find((t) => t.message === message && !t.leaving);
        if (existing) {
          timers.current.get(existing.id)?.();
          const reset = scheduleDismiss(existing.id, ms);
          timers.current.set(existing.id, reset);
          return current.map((t) =>
            t.id === existing.id ? { ...t, count: t.count + 1, tone } : t,
          );
        }

        const id = Date.now() + Math.random();
        timers.current.set(id, scheduleDismiss(id, ms));

        // Oldest falls off the top once the cap is reached.
        const next = [...current, { id, tone, message, duration: ms, count: 1 }];
        const overflow = next.length - MAX_VISIBLE;
        if (overflow > 0) {
          for (const stale of next.slice(0, overflow)) dismiss(stale.id);
        }
        return next;
      });
    },
    [dismiss, scheduleDismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Fixed above the mobile tab bar so a toast never covers navigation.
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES: Record<ToastTone, { wrap: string; bar: string; icon: string }> = {
  success: { wrap: 'bg-navy-800 text-white', bar: 'bg-money-600', icon: '✓' },
  info: { wrap: 'bg-navy-800 text-white', bar: 'bg-navy-300', icon: 'i' },
  warning: { wrap: 'bg-white text-navy-900 border border-amber-300', bar: 'bg-amber-500', icon: '!' },
  error: { wrap: 'bg-white text-navy-900 border border-brand-200', bar: 'bg-brand-500', icon: '!' },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TONES[toast.tone];
  const [paused, setPaused] = useState(false);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl shadow-lg ${tone.wrap} ${
        toast.leaving ? 'animate-toast-out' : 'animate-toast-in'
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            toast.tone === 'success' || toast.tone === 'info'
              ? 'bg-white/15 text-white'
              : 'bg-slate-100 text-navy-700'
          }`}
          aria-hidden="true"
        >
          {tone.icon}
        </span>

        <p className="flex-1 text-sm leading-relaxed">
          {toast.message}
          {toast.count > 1 && (
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold tnum ${
                toast.tone === 'success' || toast.tone === 'info'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 text-navy-700'
              }`}
            >
              ×{toast.count}
            </span>
          )}
        </p>

        <button
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className={`-mr-1 shrink-0 rounded p-1 text-lg leading-none opacity-60 transition hover:opacity-100 ${
            toast.tone === 'success' || toast.tone === 'info' ? 'text-white' : 'text-navy-600'
          }`}
        >
          ×
        </button>
      </div>

      {/* Drains to show how long is left. Pauses on hover so it can be read. */}
      <div
        // Keyed on count so a repeat restarts the drain from full.
        key={toast.count}
        className={`h-0.5 ${tone.bar} animate-drain`}
        style={{
          animationDuration: `${toast.duration}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  );
}
