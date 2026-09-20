// Display formatting.

export function formatCents(cents: number, options: { showSign?: boolean } = {}): string {
  const sign = cents < 0 ? '-' : options.showSign ? '+' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Drops the cents when they're .00 — cleaner for large headline numbers. */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? `$${Math.floor(Math.abs(cents) / 100).toLocaleString('en-US')}`
    : formatCents(cents);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "in 2 days", "today", "3 days ago" — relative to now, in whole days. */
export function relativeDays(iso: string): string {
  const days = Math.round(
    (new Date(iso).setUTCHours(0, 0, 0, 0) - new Date().setUTCHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function percent(ratio: number, decimals = 0): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/** Initial-based avatar letter for a merchant with no logo. */
export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/**
 * A stable colour per merchant, so the same service always looks the same.
 * Hashing the name avoids storing a colour for every merchant.
 *
 * These are the themed `cat-*` token pairs, not Tailwind's own palette. That
 * matters: Tailwind's `bg-emerald-100` is a fixed pale green that does not
 * change with the theme, so in dark mode every merchant mark became a pale
 * blob — which is the "everything green turns white in dark mode" bug. Each
 * pair below is defined twice in globals.css, once per theme.
 */
export function merchantColor(name: string): string {
  const palette = [
    'bg-cat-1-surface text-cat-1-ink',
    'bg-cat-2-surface text-cat-2-ink',
    'bg-cat-3-surface text-cat-3-ink',
    'bg-cat-4-surface text-cat-4-ink',
    'bg-cat-5-surface text-cat-5-ink',
    'bg-cat-6-surface text-cat-6-ink',
    'bg-cat-7-surface text-cat-7-ink',
    'bg-cat-8-surface text-cat-8-ink',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length]!;
}

/** Money with an optional compact form ("$1.2k") for tight chart labels. */
export function formatMoney(cents: number, options: { compact?: boolean } = {}): string {
  if (options.compact && Math.abs(cents) >= 100_000) {
    return `$${(Math.abs(cents) / 100_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return formatCents(cents);
}
