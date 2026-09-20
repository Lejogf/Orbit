// Remembers where you were inside each nav section, but only briefly.
//
// Tapping "Accounts" moments after drilling into a card should take you back to
// that card — the same way native tab bars keep a stack per tab. But a position
// remembered indefinitely stops being helpful: come back ten minutes later and
// landing deep inside a detail page is disorienting, because you've lost the
// context that put you there.
//
// So the memory expires. The clock starts when you LEAVE a section, not when you
// last touched it — sitting on a page reading it for a while shouldn't count
// against you.
//
// sessionStorage, because this is per-tab UI state: it should survive navigation
// and refreshes but not outlive the tab, and it must never reach another device.

export const SECTIONS = [
  'dashboard',
  'accounts',
  'subscriptions',
  'plans',
  'credit',
  'alerts',
  'spending',
  'travel',
  'split',
  'support',
] as const;
export type Section = (typeof SECTIONS)[number];

/** How long a remembered position stays valid after leaving a section. */
export const MEMORY_TTL_MS = 30_000;

// Versioned, so a shape change can never be read as the old one. An earlier
// build stored a bare path string here; reading `.path` off that yields
// undefined and produces broken navigation targets.
const KEY = 'flow:section-memory:v2';

interface Entry {
  path: string;
  /** When the user navigated away, or null while still inside the section. */
  leftAt: number | null;
}

type Memory = Partial<Record<Section, Entry>>;

/** Anything not matching the current shape is discarded rather than trusted. */
function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Entry>;
  return (
    typeof candidate.path === 'string' &&
    candidate.path.startsWith('/') &&
    (candidate.leftAt === null || typeof candidate.leftAt === 'number')
  );
}

/** The section a path belongs to, or null if it isn't inside one. */
export function sectionFor(pathname: string): Section | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return SECTIONS.find((s) => s === first) ?? null;
}

function read(): Memory {
  // Storage can throw in private mode, and is absent during server render.
  try {
    if (typeof window === 'undefined') return {};
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};

    // Keep only well-formed entries, so a bad write can't break navigation.
    const memory: Memory = {};
    for (const section of SECTIONS) {
      const entry = (raw as Record<string, unknown>)[section];
      if (isEntry(entry)) memory[section] = entry;
    }
    return memory;
  } catch {
    return {};
  }
}

function write(memory: Memory): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Not being able to remember is survivable; the nav falls back to roots.
  }
}

/** Records the current location as this section's position, and marks it live. */
export function remember(pathname: string, search: string): void {
  const section = sectionFor(pathname);
  if (!section) return;
  write({ ...read(), [section]: { path: `${pathname}${search}`, leftAt: null } });
}

/** Starts the expiry clock for a section the user has just navigated away from. */
export function markLeft(section: Section, now = Date.now()): void {
  const memory = read();
  const entry = memory[section];
  if (!entry || entry.leftAt !== null) return;
  write({ ...memory, [section]: { ...entry, leftAt: now } });
}

/**
 * Where tapping this section should go.
 *
 * Falls back to the section root when nothing is remembered, or when the memory
 * has gone stale.
 */
export function recall(section: Section, now = Date.now()): string {
  const root = `/${section}`;
  const entry = read()[section];
  if (!entry) return root;

  // Still inside the section (or never left) — the position is current.
  if (entry.leftAt === null) return entry.path;

  return now - entry.leftAt > MEMORY_TTL_MS ? root : entry.path;
}

/** Forgets a section, so the next tap lands on its root. */
export function forget(section: Section): void {
  const memory = read();
  delete memory[section];
  write(memory);
}

/** Drops every entry that has aged out. Keeps storage from accumulating. */
export function pruneExpired(now = Date.now()): void {
  const memory = read();
  let changed = false;

  for (const section of SECTIONS) {
    const entry = memory[section];
    if (entry && entry.leftAt !== null && now - entry.leftAt > MEMORY_TTL_MS) {
      delete memory[section];
      changed = true;
    }
  }

  if (changed) write(memory);
}
