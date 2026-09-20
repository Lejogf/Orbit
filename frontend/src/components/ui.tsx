'use client';

// The shared pieces every screen is built from.
import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Where a detail page can be reached from, for labelling the back control. */
const ORIGINS: Record<string, { href: string; label: string }> = {
  alerts: { href: '/alerts', label: 'Alerts' },
  dashboard: { href: '/dashboard', label: 'Home' },
  accounts: { href: '/accounts', label: 'Accounts' },
  cards: { href: '/cards', label: 'Cards' },
  subscriptions: { href: '/subscriptions', label: 'Subscriptions' },
  plans: { href: '/plans', label: 'Pay Over Time' },
  credit: { href: '/credit', label: 'Credit' },
  rewards: { href: '/rewards', label: 'Rewards' },
  invest: { href: '/invest', label: 'Invest' },
  budget: { href: '/budget', label: 'Budget' },
  pay: { href: '/pay', label: 'Pay' },
};

function BackLinkInner({ href, label = 'Back' }: { href: string; label?: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const origin = ORIGINS[params.get('from') ?? ''];
  const target = origin?.href ?? href;
  const text = origin?.label ?? label;

  const goBack = () => {
    if (origin) router.push(origin.href);
    else if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(target);
  };

  return (
    <button
      onClick={goBack}
      className="mb-4 inline-flex items-center gap-1.5 rounded-full py-1 text-sm font-semibold text-ink-600 transition hover:text-ink-900"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {text}
    </button>
  );
}

/** useSearchParams needs a Suspense boundary to prerender. */
export function BackLink(props: { href: string; label?: string }) {
  return (
    <Suspense fallback={<div className="mb-4 h-5" />}>
      <BackLinkInner {...props} />
    </Suspense>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  back,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: { href: string; label?: string };
}) {
  return (
    <>
      {back && <BackLink href={back.href} label={back.label} />}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="label mb-1.5">{eyebrow}</p>}
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-[-0.025em] text-ink-900 sm:text-[2.125rem]">{title}</h1>
          {subtitle && <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-600">{subtitle}</p>}
        </div>
        {action}
      </header>
    </>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-sunken text-ink-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-6 w-6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12h6" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-ink-600">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-50 text-danger-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6" aria-hidden="true">
          <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-ink-900">That didn’t load</h2>
      <p className="max-w-sm text-sm text-ink-600">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-1">
          Try again
        </button>
      )}
    </div>
  );
}

const CHIP_TONES = {
  neutral: 'bg-surface-sunken text-ink-700',
  accent: 'bg-accent-100 text-accent-800',
  money: 'bg-accent-100 text-accent-800',
  warn: 'bg-warn-100 text-warn-800',
  danger: 'bg-danger-100 text-danger-700',
  info: 'bg-info-100 text-info-800',
  ink: 'bg-ink-900 text-canvas',
} as const;

export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof CHIP_TONES; children: React.ReactNode }) {
  return <span className={`chip ${CHIP_TONES[tone]}`}>{children}</span>;
}

/** A headline figure with its label — the unit most screens open with. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  action,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'ink' | 'accent';
  action?: React.ReactNode;
  className?: string;
}) {
  const skin =
    tone === 'ink'
      ? 'bg-ink-sheen text-canvas border-transparent'
      : tone === 'accent'
        ? 'bg-accent-sheen text-on-accent border-transparent'
        : 'bg-surface text-ink-900 border-line';

  return (
    <section className={`rounded-2xl border p-5 shadow-card ${skin} ${className}`}>
      <p className={`text-[0.6875rem] font-semibold uppercase tracking-[0.12em] ${tone === 'default' ? 'text-ink-500' : 'opacity-70'}`}>{label}</p>
      <p className="mt-1.5 font-display text-[1.75rem] font-bold leading-none tracking-[-0.02em] tnum">{value}</p>
      {hint && <p className={`mt-2 text-sm leading-snug ${tone === 'default' ? 'text-ink-600' : 'opacity-80'}`}>{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A pill of choices. Used for tabs, ranges and modes throughout. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-surface-sunken p-1" role="tablist" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`rounded-full font-semibold transition-all duration-200 ease-spring ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} ${
            value === id ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label mb-1.5 block">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}

/** A bottom sheet on phones, a centred dialog on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className="animate-rise relative w-full max-w-lg overflow-hidden rounded-t-3xl border border-line bg-surface shadow-float sm:rounded-3xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-ink-500 hover:bg-surface-sunken">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * A merchant mark: the brand's colour with its initials.
 *
 * Deliberately not the real logo — this app doesn't ship other companies'
 * trademarks — but recognisable at a glance, and it never fails to load.
 */
const BRAND_COLORS: Record<string, string> = {
  netflix: '#E50914', spotify: '#1DB954', hulu: '#1CE783', amazon: '#FF9900', apple: '#555555',
  uber: '#0c0c0c', target: '#CC0000', starbucks: '#00704A', shell: '#FBCE07', chipotle: '#A81612',
  delta: '#003366', wholefoods: '#00674B', cvs: '#CC0000', walmart: '#0071CE', paypal: '#003087',
  disney: '#113CCF', youtube: '#FF0000', google: '#4285F4', microsoft: '#00A4EF', nvidia: '#76B900',
  tesla: '#CC0000', coca: '#F40009', peloton: '#DF2B2B', adobe: '#FF0000', dropbox: '#0061FF',
  nytimes: '#1a1a1a', audible: '#F8991C', planet: '#E4002B', equinox: '#1a1a1a', icloud: '#3B82F6',
};

function brandColor(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const [brand, color] of Object.entries(BRAND_COLORS)) {
    if (key.startsWith(brand) || key.includes(brand)) return color;
  }
  // Otherwise a stable colour from the name, so the same merchant always matches.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const palette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#0e7490', '#b45309'];
  return palette[hash % palette.length]!;
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function MerchantMark({ name, size = 40, className = '' }: { name: string; size?: number; className?: string }) {
  const color = brandColor(name);
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${color} 0%, ${color}cc 100%)`,
        fontSize: size * 0.36,
        letterSpacing: '-0.02em',
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Money, coloured by direction, with the sign always explicit. */
export function Money({
  cents,
  signed = false,
  className = '',
  tone,
}: {
  cents: number;
  signed?: boolean;
  className?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const resolved = tone ?? (cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'neutral');
  const color = !signed ? '' : resolved === 'positive' ? 'text-accent-600' : resolved === 'negative' ? 'text-ink-900' : 'text-ink-600';
  const abs = Math.abs(cents);
  const text = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return (
    <span className={`tnum ${color} ${className}`}>
      {signed && (cents > 0 ? '+' : cents < 0 ? '−' : '')}
      {text}
    </span>
  );
}

export function Progress({ value, tone = 'accent', className = '' }: { value: number; tone?: 'accent' | 'warn' | 'danger' | 'ink'; className?: string }) {
  const colors = { accent: 'bg-accent-500', warn: 'bg-warn-500', danger: 'bg-danger-500', ink: 'bg-ink-800' };
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-surface-sunken ${className}`} role="presentation">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-spring ${colors[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">{children}</div>;
}

export { Link };
