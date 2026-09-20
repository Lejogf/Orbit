'use client';

// Keeps signed-out visitors out of the app, and gives the rest of the tree the
// current session without every page re-fetching it.
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiRequestError, auth, type SessionState } from '@/lib/api';
import { ErrorState } from '@/components/ui';

interface SessionContextValue {
  session: SessionState;
  /** Re-reads the session, after a profile or preference change. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <AuthGuard>');
  return context;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await auth.me());
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.isAuthError) {
        router.replace('/');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not load your account.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  // Nothing renders until the session resolves, so a page never briefly shows
  // another account's shape before redirecting.
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-navy-600" />
        <span className="sr-only">Loading your account</span>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ session, refresh: load }}>{children}</SessionContext.Provider>
  );
}
