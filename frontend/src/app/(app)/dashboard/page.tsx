'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Dashboard } from '@/lib/api';
import { formatCents, formatCentsShort, formatDate, relativeDays, initial, merchantColor } from '@/lib/format';
import { Chip, ErrorState, Skeleton } from '@/components/ui';

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .dashboard()
      .then(setData)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <DashboardSkeleton />;

  const { safeToSpend, accounts, subscriptions, alerts, activePlans, timeline } = data;
  const pending = alerts.filter((a) => a.needsDecision);
  const informational = alerts.filter((a) => !a.needsDecision);

  return (
    <div className="space-y-6">
      {/* Hero: Safe to Spend */}
      <section className="card animate-rise overflow-hidden bg-navy-900 p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-navy-200">
              Safe to spend
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight tnum sm:text-6xl">
              {formatCentsShort(safeToSpend.safeToSpendCents)}
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-navy-200">
              {formatCents(safeToSpend.checkingBalanceCents)} in checking, minus{' '}
              {formatCents(safeToSpend.committedCents)} already committed
              {safeToSpend.nextPayday
                ? ` before payday on ${formatDate(safeToSpend.nextPayday)}.`
                : ' over the next two weeks.'}
            </p>
          </div>

          {safeToSpend.daysUntilPayday !== null && (
            <div className="rounded-2xl bg-white/10 px-5 py-4 text-center backdrop-blur">
              <p className="text-3xl font-semibold tnum">{safeToSpend.daysUntilPayday}</p>
              <p className="mt-0.5 text-xs text-navy-200">days to payday</p>
            </div>
          )}
        </div>

        {safeToSpend.avoidedCents > 0 && (
          <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-navy-500/15 px-3 py-1.5 text-xs font-medium text-navy-200">
            <span aria-hidden="true">✓</span>
            {formatCents(safeToSpend.avoidedCents)} freed up by subscriptions you stopped
          </p>
        )}
      </section>

      {/* Charges awaiting a decision come first — they're time-sensitive. */}
      {pending.length > 0 && (
        <section className="space-y-3">
          {pending.map((alert) => (
            <PendingChargeCard key={alert.id} alert={alert} onDone={load} />
          ))}
        </section>
      )}

      {informational.length > 0 && (
        <section className="card animate-rise p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-navy-900">Needs your attention</h2>
            <Link href="/alerts" className="text-xs font-medium text-navy-600 hover:text-navy-700">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {informational.slice(0, 3).map((alert) => (
              <li key={alert.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    alert.kind === 'trial_converting' ? 'bg-amber-500' : 'bg-sky-500'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-900">{alert.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-navy-600">{alert.body}</p>
                  {alert.subscriptionId && (
                    <Link
                      href={`/subscriptions/${alert.subscriptionId}?from=dashboard`}
                      className="mt-1.5 inline-block text-xs font-semibold text-navy-600 hover:text-navy-700"
                    >
                      Manage →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Committed money at a glance */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link href="/subscriptions" className="card animate-rise group p-5 transition hover:border-navy-300">
          <div className="flex items-start justify-between">
            <div>
              <p className="label">Subscriptions</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 tnum">
                {formatCents(subscriptions.monthlyTotalCents)}
                <span className="ml-1 text-base font-normal text-navy-400">/mo</span>
              </p>
              <p className="mt-1 text-sm text-navy-600">
                {subscriptions.activeCount} active · {formatCents(subscriptions.yearlyTotalCents)} a year
              </p>
            </div>
            <span className="text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-navy-600" aria-hidden="true">→</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {subscriptions.needsAttention.trials > 0 && (
              <Chip tone="warn">{subscriptions.needsAttention.trials} trial ending</Chip>
            )}
            {subscriptions.needsAttention.priceIncreases > 0 && (
              <Chip tone="danger">{subscriptions.needsAttention.priceIncreases} price rise</Chip>
            )}
            {subscriptions.needsAttention.duplicates > 0 && (
              <Chip tone="info">{subscriptions.needsAttention.duplicates} overlapping</Chip>
            )}
            {subscriptions.needsAttention.unused > 0 && (
              <Chip tone="neutral">{subscriptions.needsAttention.unused} unused</Chip>
            )}
          </div>

          {subscriptions.savedYearlyCents > 0 && (
            <p className="mt-4 rounded-lg bg-navy-50 px-3 py-2 text-xs font-semibold text-navy-700">
              Saving {formatCents(subscriptions.savedYearlyCents)} a year
            </p>
          )}
        </Link>

        <Link href="/plans" className="card animate-rise group p-5 transition hover:border-navy-300">
          <div className="flex items-start justify-between">
            <div>
              <p className="label">Pay Over Time</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-navy-900 tnum">
                {formatCents(activePlans.monthlyTotalCents)}
                <span className="ml-1 text-base font-normal text-navy-400">/mo</span>
              </p>
              <p className="mt-1 text-sm text-navy-600">
                {activePlans.count === 0
                  ? 'No active plans'
                  : `${activePlans.count} active · ${formatCents(activePlans.remainingCents)} remaining`}
              </p>
            </div>
            <span className="text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-navy-600" aria-hidden="true">→</span>
          </div>

          {activePlans.count === 0 && (
            <p className="mt-4 text-xs leading-relaxed text-navy-600">
              Split a purchase of $100 or more into 3, 6, 12 or 24 payments. Open any eligible
              purchase to see the options.
            </p>
          )}
        </Link>
      </section>

      {/* Credit */}
      <CreditTile />

      {/* Accounts */}
      <section className="card animate-rise p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-900">Accounts</h2>
          <Link href="/accounts" className="text-xs font-medium text-navy-600 hover:text-navy-700">
            View all
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <li key={account.id}>
              <Link
                href={`/accounts/${account.id}?from=dashboard`}
                className="-mx-2 flex items-center justify-between rounded-lg px-2 py-3 transition hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium text-navy-900">
                    {account.nickname}
                    {account.isLocked && (
                      <span className="ml-2 align-middle">
                        <Chip tone="danger">Locked</Chip>
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-navy-600">
                    {account.type} ···· {account.last4}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-navy-900 tnum">
                    {formatCents(account.balanceCents)}
                  </p>
                  {account.availableCreditCents !== null && (
                    <p className="text-xs text-navy-600 tnum">
                      {formatCents(account.availableCreditCents)} available
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Upcoming payments */}
      <section className="card animate-rise p-5">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">What&rsquo;s coming up</h2>
        <p className="mb-4 text-xs text-navy-600">Subscriptions and plan payments over the next 45 days.</p>

        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-navy-600">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-1">
            {timeline.slice(0, 10).map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    item.kind === 'income' ? 'bg-navy-50 text-navy-700' : merchantColor(item.label)
                  }`}
                  aria-hidden="true"
                >
                  {item.kind === 'income' ? '↓' : initial(item.label)}
                </span>

                <div className="min-w-0 flex-1">
                  {/* The chip sits outside the truncating element, or it gets clipped. */}
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-navy-900">{item.label}</p>
                    {item.isFreeTrialConversion && (
                      <span className="shrink-0">
                        <Chip tone="warn">Trial</Chip>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-navy-600">
                    {formatDate(item.date)} · {relativeDays(item.date)}
                  </p>
                </div>

                <p
                  className={`text-sm font-semibold tnum ${
                    item.amountCents > 0 ? 'text-navy-700' : 'text-navy-900'
                  }`}
                >
                  {formatCents(item.amountCents, { showSign: item.amountCents > 0 })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The approve / keep-blocked card raised when Guard declines a charge. */
function PendingChargeCard({
  alert,
  onDone,
}: {
  alert: Dashboard['alerts'][number];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'keep_blocked' | null>(null);

  const decide = async (decision: 'approve' | 'keep_blocked') => {
    setBusy(decision);
    try {
      await api.alertDecision(alert.id, decision);
      onDone();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card animate-rise border-amber-200 bg-amber-50/60 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
            <path d="M12 9v4M12 16.5v.5" strokeLinecap="round" />
            <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-navy-900">
            {alert.title}
            {alert.occurrences > 1 && (
              <span className="ml-2 rounded-full bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 tnum">
                ×{alert.occurrences}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-navy-600">{alert.body}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => decide('approve')} disabled={busy !== null} className="btn-accent">
              {busy === 'approve' ? 'Approving…' : 'Approve this charge'}
            </button>
            <button onClick={() => decide('keep_blocked')} disabled={busy !== null} className="btn-ghost">
              {busy === 'keep_blocked' ? 'Saving…' : 'Keep blocked'}
            </button>
          </div>

          <p className="mt-2.5 text-xs text-navy-600">
            Approving lets this one charge through. The next attempt asks you again.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Small credit summary, loaded separately so it never delays the dashboard. */
function CreditTile() {
  const [credit, setCredit] = useState<{ score: number; band: string; best: string | null } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    api
      .credit()
      .then((report) => {
        if (cancelled) return;
        const best = [...report.scenarios].sort((a, b) => b.delta - a.delta)[0];
        setCredit({
          score: report.score,
          band: report.band,
          best: best && best.delta > 0 ? `${best.label} for +${best.delta}` : null,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!credit) return <Skeleton className="h-28 rounded-2xl" />;

  return (
    <Link href="/credit" className="card animate-rise group flex items-center gap-5 p-5 transition hover:border-navy-300">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 border-navy-100 bg-white">
        <span className="text-xl font-semibold text-navy-900 tnum">{credit.score}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="label">Credit score</p>
        <p className="mt-0.5 text-sm font-semibold text-navy-900">{credit.band}</p>
        {credit.best && (
          <p className="mt-0.5 truncate text-xs text-navy-600">{credit.best}</p>
        )}
      </div>

      <span
        className="text-navy-300 transition group-hover:translate-x-0.5 group-hover:text-navy-600"
        aria-hidden="true"
      >
        →
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}
