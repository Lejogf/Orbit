// Small shared pieces: states, chips, and the section header.

'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Where a detail page can be reached from, for labelling the back control. */
const ORIGINS: Record<string, { href: string; label: string }> = {
  alerts: { href: '/alerts', label: 'Alerts' },
  dashboard: { href: '/dashboard', label: 'Dashboard' },
  accounts: { href: '/accounts', label: 'Accounts' },
  subscriptions: { href: '/subscriptions', label: 'Subscriptions' },
  plans: { href: '/plans', label: 'Plans' },
  credit: { href: '/credit', label: 'Credit' },
};

/**
 * Back navigation for detail pages.
 *
 * The label follows where the user actually came from, read from a `?from=`
 * hint on the link. Opening a subscription from Alerts should offer "Alerts",
 * not "All subscriptions" — otherwise the back control quietly moves you
 * somewhere you were not.
 */
function BackLinkInner({ href, label = 'Back' }: { href: string; label?: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const origin = ORIGINS[params.get('from') ?? ''];
  const target = origin?.href ?? href;
  const text = origin?.label ?? label;

  const goBack = () => {
    // With a declared origin, go there explicitly — history may hold unrelated
    // steps if the user navigated around before coming back.
    if (origin) router.push(origin.href);
    else if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(target);
  };

  return (
    <button
      onClick={goBack}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-600 transition hover:text-navy-800"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  /** Shows a back control above the title. */
  back?: { href: string; label?: string };
}) {
  return (
    <>
      {back && <BackLink href={back.href} label={back.label} />}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="label mb-1">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-prose text-sm text-navy-600">{subtitle}</p>}
        </div>
        {action}
      </header>
    </>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-6 w-6">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12h6" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-navy-900">{title}</h2>
      <p className="max-w-sm text-sm text-navy-600">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
          <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-navy-900">Something went wrong</h2>
      <p className="max-w-sm text-sm text-navy-600">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-1">
          Try again
        </button>
      )}
    </div>
  );
}

const CHIP_TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  accent: 'bg-navy-100 text-navy-700',
  money: 'bg-money-100 text-money-700',
  warn: 'bg-amber-50 text-amber-800',
  danger: 'bg-brand-100 text-brand-700',
  info: 'bg-navy-50 text-navy-600',
} as const;

export function Chip({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  children: React.ReactNode;
}) {
  return <span className={`chip ${CHIP_TONES[tone]}`}>{children}</span>;
}
