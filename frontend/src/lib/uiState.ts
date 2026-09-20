'use client';

// Small shared UI state, kept outside React so the sidebar, the top bar and the
// tab bar agree without a context provider — and so the alert count is fetched
// once for all of them rather than once per component.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// --- the collapsible sidebar ---

const RAIL_KEY = 'flow.rail.v1';
let collapsed = false;
const railListeners = new Set<(value: boolean) => void>();

function applyRail(value: boolean) {
  collapsed = value;
  document.documentElement.dataset.rail = value ? 'collapsed' : 'open';
  railListeners.forEach((listener) => listener(value));
}

export function useRail(): { collapsed: boolean; toggle: () => void } {
  const [value, setValue] = useState(collapsed);

  useEffect(() => {
    railListeners.add(setValue);
    // First mount reads the stored preference; later mounts reuse it.
    if (document.documentElement.dataset.rail === undefined) {
      let stored = false;
      try {
        stored = window.localStorage.getItem(RAIL_KEY) === 'collapsed';
      } catch {
        stored = false;
      }
      applyRail(stored);
    } else {
      setValue(collapsed);
    }
    return () => {
      railListeners.delete(setValue);
    };
  }, []);

  return {
    collapsed: value,
    toggle: () => {
      const next = !collapsed;
      applyRail(next);
      try {
        window.localStorage.setItem(RAIL_KEY, next ? 'collapsed' : 'open');
      } catch {
        // Not remembered, but still applied for this visit.
      }
    },
  };
}

// --- unread alerts ---

let unread = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const unreadListeners = new Set<(value: number) => void>();

async function refreshUnread() {
  try {
    const { unread: count } = await api.alerts();
    if (count === unread) return;
    unread = count;
    unreadListeners.forEach((listener) => listener(count));
  } catch {
    // Offline for a moment; the next tick catches up.
  }
}

/** Live unread count, polled once for the whole app. */
export function useUnreadAlerts(): number {
  const [value, setValue] = useState(unread);

  useEffect(() => {
    unreadListeners.add(setValue);
    void refreshUnread();
    timer ??= setInterval(() => void refreshUnread(), 5000);

    return () => {
      unreadListeners.delete(setValue);
      if (unreadListeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return value;
}

/** Called after an action that changes alerts, so badges update immediately. */
export function refreshAlertBadge(): void {
  void refreshUnread();
}
