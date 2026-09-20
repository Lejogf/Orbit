// Money, dates, and a seeded RNG.
// Money is integer cents everywhere. Floats only exist at the Nessie boundary.

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Splits a total into parts that sum to exactly the total (no lost cents). */
export function splitCents(totalCents: number, parts: number): number[] {
  if (parts <= 0) throw new Error('splitCents: parts must be positive');
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

// --- dates (UTC throughout, so seeded data is machine-independent) ---

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Clamps the day, so Jan 31 + 1 month is Feb 28 rather than Mar 3. */
export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const targetDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(targetDay, lastDay));
  return next;
}

export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

// --- seeded RNG ---
// The demo script depends on specific transactions existing, so generation has
// to be reproducible. Math.random() can't do that.

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  money(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    money: (min, max) => Math.round((next() * (max - min) + min) * 100) / 100,
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick: empty array');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}
