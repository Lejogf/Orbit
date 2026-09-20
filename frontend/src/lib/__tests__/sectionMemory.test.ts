/**
 * Section memory is time-based, and time-based logic is where bugs hide.
 * Every function takes `now` explicitly so these run without faking the clock.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import {
  MEMORY_TTL_MS,
  forget,
  markLeft,
  pruneExpired,
  recall,
  remember,
  sectionFor,
} from '../sectionMemory';

// Minimal sessionStorage, since these tests run in Node rather than a browser.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { sessionStorage: storage };

const T0 = 1_000_000;

beforeEach(() => storage.clear());

describe('sectionFor', () => {
  test('identifies the section from a path', () => {
    expect(sectionFor('/accounts')).toBe('accounts');
    expect(sectionFor('/accounts/abc123')).toBe('accounts');
    expect(sectionFor('/subscriptions/x?from=alerts')).toBe('subscriptions');
  });

  test('returns null for paths outside any section', () => {
    expect(sectionFor('/')).toBeNull();
    expect(sectionFor('/transfer')).toBeNull();
    expect(sectionFor('/plans/new/tx1')).toBe('plans');
  });
});

describe('recall', () => {
  test('falls back to the section root when nothing is remembered', () => {
    expect(recall('accounts', T0)).toBe('/accounts');
  });

  test('returns the remembered position while still inside the section', () => {
    remember('/accounts/abc', '?from=accounts');
    expect(recall('accounts', T0)).toBe('/accounts/abc?from=accounts');
  });

  test('restores the position when the user returns promptly', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);

    expect(recall('accounts', T0 + 1_000)).toBe('/accounts/abc');
    expect(recall('accounts', T0 + MEMORY_TTL_MS - 1)).toBe('/accounts/abc');
  });

  test('falls back to the root once the memory has aged out', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);

    expect(recall('accounts', T0 + MEMORY_TTL_MS + 1)).toBe('/accounts');
  });

  test('expires exactly at the boundary, not before', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);

    // At exactly the TTL the memory is still good; one ms later it is not.
    expect(recall('accounts', T0 + MEMORY_TTL_MS)).toBe('/accounts/abc');
    expect(recall('accounts', T0 + MEMORY_TTL_MS + 1)).toBe('/accounts');
  });

  test('sitting on a page does not age the memory — only leaving does', () => {
    remember('/accounts/abc', '');
    // Never left, so even a long time later the position stands.
    expect(recall('accounts', T0 + MEMORY_TTL_MS * 100)).toBe('/accounts/abc');
  });

  test('re-entering a section restarts the clock', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);

    // Returns in time, then leaves again later.
    remember('/accounts/abc', '');
    markLeft('accounts', T0 + 20_000);

    expect(recall('accounts', T0 + 40_000)).toBe('/accounts/abc');
  });

  test('tracks sections independently', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);
    remember('/subscriptions/xyz', '');
    markLeft('subscriptions', T0 + 25_000);

    const now = T0 + 40_000;
    expect(recall('accounts', now)).toBe('/accounts'); // expired
    expect(recall('subscriptions', now)).toBe('/subscriptions/xyz'); // still fresh
  });
});

describe('markLeft', () => {
  test('does not restart an already-running clock', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);
    // A second call must not extend the life of the memory.
    markLeft('accounts', T0 + 25_000);

    expect(recall('accounts', T0 + MEMORY_TTL_MS + 1)).toBe('/accounts');
  });

  test('does nothing for a section that was never visited', () => {
    markLeft('plans', T0);
    expect(recall('plans', T0)).toBe('/plans');
  });
});

describe('forget', () => {
  test('drops the position immediately', () => {
    remember('/accounts/abc', '');
    forget('accounts');
    expect(recall('accounts', T0)).toBe('/accounts');
  });
});

describe('pruneExpired', () => {
  test('clears aged entries and keeps fresh ones', () => {
    remember('/accounts/abc', '');
    markLeft('accounts', T0);
    remember('/plans/new/tx1', '');
    markLeft('plans', T0 + 29_000);

    pruneExpired(T0 + 40_000);

    expect(recall('accounts', T0 + 40_000)).toBe('/accounts');
    expect(recall('plans', T0 + 40_000)).toBe('/plans/new/tx1');
  });

  test('leaves a section the user is currently inside alone', () => {
    remember('/accounts/abc', '');
    pruneExpired(T0 + MEMORY_TTL_MS * 10);
    expect(recall('accounts', T0)).toBe('/accounts/abc');
  });
});

describe('malformed or outdated storage', () => {
  test('ignores entries left by an earlier storage format', () => {
    // A previous build wrote a bare path string. Reading `.path` off that gives
    // undefined, which would otherwise become the navigation target.
    storage.setItem(
      'flow:section-memory:v2',
      JSON.stringify({ accounts: '/accounts/abc', plans: { path: '/plans/x', leftAt: null } }),
    );

    expect(recall('accounts', T0)).toBe('/accounts');
    expect(recall('plans', T0)).toBe('/plans/x');
  });

  test('ignores entries that are not real paths', () => {
    storage.setItem(
      'flow:section-memory:v2',
      JSON.stringify({
        accounts: { path: 'https://evil.example.com', leftAt: null },
        alerts: { path: 42, leftAt: null },
      }),
    );

    expect(recall('accounts', T0)).toBe('/accounts');
    expect(recall('alerts', T0)).toBe('/alerts');
  });

  test('survives storage holding something that is not an object', () => {
    storage.setItem('flow:section-memory:v2', '"nonsense"');
    expect(recall('accounts', T0)).toBe('/accounts');
  });

  test('survives unparseable storage', () => {
    storage.setItem('flow:section-memory:v2', '{not json');
    expect(recall('accounts', T0)).toBe('/accounts');
  });
});

describe('storage failure', () => {
  test('degrades to section roots rather than throwing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (globalThis as any).window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {
      sessionStorage: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      },
    };

    expect(() => remember('/accounts/abc', '')).not.toThrow();
    expect(recall('accounts', T0)).toBe('/accounts');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = original;
  });
});
