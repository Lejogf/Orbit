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
 */
export function merchantColor(name: string): string {
  // Brand red is reserved for actions, so it's deliberately not in here.
  const palette = [
    'bg-navy-100 text-navy-700',
    'bg-amber-100 text-amber-800',
    'bg-emerald-100 text-emerald-800',
    'bg-sky-100 text-sky-800',
    'bg-violet-100 text-violet-800',
    'bg-teal-100 text-teal-800',
    'bg-orange-100 text-orange-800',
    'bg-indigo-100 text-indigo-800',
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
