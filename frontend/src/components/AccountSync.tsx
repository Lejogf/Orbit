'use client';

// Runs once per signed-in visit: loads the account's accessibility settings, and
// shows a toast for any new alert, so a charge is visible in the open app even
// when phone notifications are blocked or delayed.
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useAccessibility } from '@/lib/accessibility';
import { useToast } from '@/components/Toast';

const SEEN_KEY = 'flow.alerts.seen.v1';

export function AccountSync() {
  const { syncFromAccount } = useAccessibility();
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    void syncFromAccount();
  }, [syncFromAccount]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const { alerts } = await api.alerts();
        if (cancelled) return;
        if (seen.current === null) {
          // First load: remember what's already there so we don't replay history.
          let stored: string[] = [];
          try {
            stored = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
          } catch {
            stored = [];
          }
          seen.current = new Set([...stored, ...alerts.map((a) => a.id)]);
        } else {
          const fresh = alerts.filter((a) => !seen.current!.has(a.id) && !a.readAt);
          for (const alert of fresh.slice(0, 3)) {
            toast.show(alert.title, alert.kind.includes('declined') || alert.kind === 'charge_pending' ? 'warning' : 'info');
            seen.current.add(alert.id);
          }
        }
        try {
          window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen.current].slice(-200)));
        } catch {
          // fine
        }
      } catch {
        // Offline for a moment: the next tick will catch up.
      }
    };

    void check();
    const timer = setInterval(check, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [toast]);

  return null;
}
