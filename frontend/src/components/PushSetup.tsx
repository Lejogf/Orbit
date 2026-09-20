'use client';

// Turning on phone notifications, and being honest about whether they arrive.
//
// Web Push needs a service worker, permission, and — on iPhone — the app added
// to the home screen. Each of those can fail quietly, so this panel states
// which step you are on and what was actually delivered this week. The inbox
// copy of every alert exists regardless, which is the real fix for "I never
// got the notification".
import { useCallback, useEffect, useState } from 'react';
import { more } from '@/lib/api';
import { SectionCard } from '@/components/ui';
import { useToast } from '@/components/Toast';

type Support = 'checking' | 'unsupported' | 'needs-install' | 'ready';

/** The VAPID key travels as URL-safe base64; the browser wants raw bytes. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushSetup() {
  const toast = useToast();
  const [support, setSupport] = useState<Support>('checking');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [status, setStatus] = useState<{ devices: number; lastDelivered: string | null; delivery: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    more.pushStatus().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    // iOS only allows push once the app is installed to the home screen.
    const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);
    setSupport(!hasApis ? 'unsupported' : isIos && !installed ? 'needs-install' : 'ready');
    if (hasApis) setPermission(Notification.permission);
    refresh();
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast.show('Notifications are blocked in your browser settings. Your Alerts inbox still records everything.', 'warning');
        return;
      }
      const { publicKey } = await more.vapidKey();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(publicKey),
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await more.subscribePush({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } });
      toast.show('Phone alerts are on. Try a test charge below.', 'success');
      refresh();
    } catch (cause) {
      toast.show(`Couldn't turn on phone alerts: ${(cause as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const delivered = status?.delivery.sent ?? 0;
  const failed = (status?.delivery.failed ?? 0) + (status?.delivery.no_device ?? 0);

  return (
    <SectionCard title="Alerts on your phone">
      {support === 'unsupported' ? (
        <p className="text-sm text-ink-700">
          This browser can’t deliver push notifications. Every alert is still recorded here, and you can have them emailed in
          Settings.
        </p>
      ) : support === 'needs-install' ? (
        <p className="text-sm leading-relaxed text-ink-700">
          On iPhone, add Orbit to your home screen first (Share → Add to Home Screen), then come back and turn notifications on.
          That’s an Apple requirement, not ours.
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-ink-700">
            Get a notification the moment your card is charged — including small ones, which is how card testing usually starts.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void enable()} disabled={busy} className={status && status.devices > 0 ? 'btn-ghost' : 'btn-accent'}>
              {busy ? 'Working…' : status && status.devices > 0 ? 'Add this device too' : 'Turn on phone alerts'}
            </button>
            <button
              onClick={async () => {
                const result = await more.testCharge();
                toast.show(
                  result.declined ? 'Card is locked, so the charge was declined — and that alerted too' : 'Test charge sent',
                  result.declined ? 'warning' : 'success',
                );
                refresh();
                window.dispatchEvent(new Event('orbit:data-changed'));
              }}
              className="btn-ghost"
            >
              Send a test charge
            </button>
            {failed > 0 && (
              <button
                onClick={async () => {
                  const result = await more.retryPush();
                  toast.show(`Retried ${result.retried}, delivered ${result.sent}`, result.sent > 0 ? 'success' : 'info');
                  refresh();
                }}
                className="btn-ghost"
              >
                Retry undelivered
              </button>
            )}
          </div>

          {status && (
            <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-surface-sunken p-3.5 text-center">
              <div>
                <dt className="text-[0.6875rem] text-ink-500">Devices</dt>
                <dd className="font-display text-lg font-bold text-ink-900 tnum">{status.devices}</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-ink-500">Delivered (7d)</dt>
                <dd className="font-display text-lg font-bold text-accent-600 tnum">{delivered}</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-ink-500">Didn’t arrive</dt>
                <dd className="font-display text-lg font-bold text-ink-900 tnum">{failed}</dd>
              </div>
            </dl>
          )}

          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            {permission === 'denied'
              ? 'Notifications are blocked for this site in your browser settings. '
              : ''}
            Whatever happens to the notification, every alert is kept in this list permanently — it never disappears on its own.
          </p>
        </>
      )}
    </SectionCard>
  );
}
