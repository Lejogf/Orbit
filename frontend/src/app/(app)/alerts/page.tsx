'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type AlertItem } from '@/lib/api';
import { formatCents, relativeDays } from '@/lib/format';
import { Chip, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { PushSetup } from '@/components/PushSetup';

const KIND_LABEL: Record<string, { label: string; tone: 'warn' | 'danger' | 'info' | 'accent' | 'neutral' }> = {
  charge_pending: { label: 'Needs a decision', tone: 'warn' },
  charge_posted: { label: 'Charge', tone: 'neutral' },
  payment_sent: { label: 'Sent', tone: 'neutral' },
  payment_received: { label: 'Received', tone: 'accent' },
  payment_failed: { label: 'Failed', tone: 'danger' },
  payment_requested: { label: 'Requested', tone: 'info' },
  points_redeemed: { label: 'Points', tone: 'accent' },
  trade_filled: { label: 'Investing', tone: 'info' },
  card_opened: { label: 'New card', tone: 'accent' },
  check_deposited: { label: 'Cheque', tone: 'info' },
  price_drop: { label: 'Refund', tone: 'accent' },
  trip_booked: { label: 'Trip', tone: 'info' },
  profile_changed: { label: 'Account', tone: 'info' },
  split_requested: { label: 'Split', tone: 'info' },
  split_paid: { label: 'Paid you', tone: 'accent' },
  support_summary: { label: 'Support', tone: 'neutral' },
  charge_declined: { label: 'Declined', tone: 'danger' },
  charge_approved: { label: 'Approved', tone: 'accent' },
  trial_converting: { label: 'Trial ending', tone: 'warn' },
  price_increase: { label: 'Price rise', tone: 'danger' },
  duplicate_detected: { label: 'Overlap', tone: 'info' },
  renewal_reminder: { label: 'Reminder', tone: 'neutral' },
  plan_payment_due: { label: 'Payment due', tone: 'info' },
};

export default function AlertsPage() {
  const t = useT();
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .alerts()
      .then((data) => setAlerts(data.alerts))
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  const decide = async (id: string, decision: 'approve' | 'keep_blocked') => {
    setBusy(id);
    try {
      await api.alertDecision(id, decision);
      load();
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!alerts)
    return (
      <div className="space-y-3">
        <Skeleton className="mb-6 h-9 w-48" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );

  const pending = alerts.filter((a) => a.needsDecision);
  const rest = alerts.filter((a) => !a.needsDecision);

  return (
    <div>
      <PageHeader
        eyebrow={t('nav.alerts')}
        title={t('page.alerts.heading')}
        subtitle={t('page.alerts.subtitle')}
      />

      <div className="mb-6">
        <PushSetup />
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="All clear"
          body="Nothing needs your attention. Turn on Subscription Guard for a merchant and simulate a renewal to see this in action."
          action={
            <Link href="/subscriptions" className="btn-primary">
              Go to subscriptions
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="label mb-3">Waiting on you</h2>
              <ul className="space-y-3">
                {pending.map((alert) => (
                  <li key={alert.id} className="card border-warn-300 bg-warn-50 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-900">
                        {alert.title}
                        {alert.occurrences > 1 && (
                          <span className="ml-2 rounded-full bg-warn-200 px-1.5 py-0.5 text-[0.6875rem] font-bold text-warn-900 tnum">
                            ×{alert.occurrences}
                          </span>
                        )}
                      </p>
                      <Chip tone="warn">{KIND_LABEL[alert.kind]?.label ?? alert.kind}</Chip>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{alert.body}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => decide(alert.id, 'approve')}
                        disabled={busy === alert.id}
                        className="btn-accent"
                      >
                        {busy === alert.id ? '…' : `Approve ${alert.amountCents ? formatCents(alert.amountCents) : ''}`}
                      </button>
                      <button
                        onClick={() => decide(alert.id, 'keep_blocked')}
                        disabled={busy === alert.id}
                        className="btn-ghost"
                      >
                        Keep blocked
                      </button>
                    </div>

                    <p className="mt-2.5 text-xs text-ink-600">
                      Approving lets this one charge through. The next attempt asks you again.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <h2 className="label mb-3">Everything else</h2>
              <ul className="space-y-3">
                {rest.map((alert) => {
                  const kind = KIND_LABEL[alert.kind];
                  return (
                    <li key={alert.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-ink-900">{alert.title}</p>
                        <Chip tone={kind?.tone ?? 'neutral'}>{kind?.label ?? alert.kind}</Chip>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">{alert.body}</p>

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-ink-500">
                          {relativeDays(alert.createdAt)}
                          {alert.pushStatus === 'sent' && ' · sent to your phone'}
                          {alert.pushStatus === 'no_device' && ' · inbox only'}
                          {alert.pushStatus === 'failed' && ' · phone alert failed'}
                        </span>
                        {alert.subscriptionId && (
                          <Link
                            href={`/subscriptions/${alert.subscriptionId}?from=alerts`}
                            className="text-xs font-semibold text-ink-600 hover:text-ink-700"
                          >
                            Manage →
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
