'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Subscription, type SubscriptionSummary } from '@/lib/api';
import { formatCents, formatDate, relativeDays, initial, merchantColor } from '@/lib/format';
import { Chip, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useToast } from '@/components/Toast';

type StatusFilter = 'all' | 'active' | 'guarded' | 'blocked';

export default function SubscriptionsPage() {
  const t = useT();
  const [data, setData] = useState<{
    subscriptions: Subscription[];
    summary: SubscriptionSummary;
    categories: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<string>('all');

  const load = useCallback(() => {
    setError(null);
    api
      .subscriptions()
      .then(setData)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.subscriptions.filter(
      (s) =>
        (status === 'all' || s.status === status) && (category === 'all' || s.category === category),
    );
  }, [data, status, category]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <ListSkeleton />;

  const { summary, categories } = data;
  const guardedCount = data.subscriptions.filter((s) => s.status === 'guarded').length;

  return (
    <div>
      <PageHeader
        eyebrow={t('nav.subscriptions')}
        title={t('page.subscriptions.heading')}
        subtitle={t('page.subscriptions.subtitle')}
      />

      {/* Totals */}
      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="label">Monthly</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-900 tnum">
            {formatCents(summary.monthlyTotalCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">{summary.activeCount} active subscriptions</p>
        </div>

        <div className="card p-5">
          <p className="label">Yearly</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-900 tnum">
            {formatCents(summary.yearlyTotalCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">committed over 12 months</p>
        </div>

        <div className={`card p-5 ${summary.savedYearlyCents > 0 ? 'border-money-100 bg-money-50' : ''}`}>
          <p className="label">Money saved</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-accent-600 tnum">
            {formatCents(summary.savedYearlyCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {summary.blockedCount === 0
              ? 'a year, once you block something'
              : `a year from ${summary.blockedCount} stopped`}
          </p>
        </div>
      </section>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Filter by status">
          {(['all', 'active', 'guarded', 'blocked'] as StatusFilter[]).map((option) => (
            <button
              key={option}
              onClick={() => setStatus(option)}
              aria-pressed={status === option}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                status === option ? 'bg-ink-600 text-white' : 'text-ink-600 hover:text-ink-800'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
          className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-800 outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20"
        >
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-ink-600 tnum">
          {visible.length} of {data.subscriptions.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body="No subscriptions match these filters. Try widening them."
          action={
            <button
              onClick={() => {
                setStatus('all');
                setCategory('all');
              }}
              className="btn-ghost"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((subscription) => (
            <li key={subscription.id}>
              <SubscriptionRow subscription={subscription} onChange={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubscriptionRow({
  subscription,
  onChange,
}: {
  subscription: Subscription;
  onChange: () => void;
}) {
  const isStopped = subscription.status === 'blocked' || subscription.status === 'canceled';
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  /** Demo mode, inline — no need to open the detail page first. */
  const simulate = async (event: React.MouseEvent) => {
    // The row is a link; don't navigate when the button inside it is used.
    event.preventDefault();
    event.stopPropagation();

    setBusy(true);
    try {
      const result = (await api.subscriptionAction(subscription.id, 'simulate_renewal')) as {
        decision: string;
        allowed: boolean;
        amountCents: number;
      };
      onChange();

      if (result.allowed) {
        toast.show(
          `${subscription.merchantName} charged ${formatCents(result.amountCents)}.`,
          'success',
        );
      } else if (result.decision === 'decline_pending_approval') {
        toast.show(
          `Declined. ${subscription.merchantName}'s ${formatCents(result.amountCents)} charge is waiting for your decision in Alerts.`,
          'warning',
        );
      } else {
        toast.show(
          `Declined. ${subscription.merchantName} is blocked from charging you.`,
          'warning',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Link
      href={`/subscriptions/${subscription.id}?from=subscriptions`}
      className={`card group flex items-center gap-4 p-4 transition hover:border-ink-300 ${
        isStopped ? 'opacity-60' : ''
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold ${merchantColor(
          subscription.merchantName,
        )}`}
        aria-hidden="true"
      >
        {initial(subscription.merchantName)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`text-sm font-semibold text-ink-900 ${isStopped ? 'line-through' : ''}`}>
            {subscription.merchantName}
          </p>
          <StatusChip status={subscription.status} />
        </div>

        <p className="mt-0.5 text-xs text-ink-600">
          {subscription.category} · {subscription.frequency} ·{' '}
          {subscription.isFreeTrial ? 'trial converts' : 'next'} {formatDate(subscription.nextChargeDate)}
        </p>

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {subscription.isFreeTrial && <Chip tone="warn">Trial ends {relativeDays(subscription.nextChargeDate)}</Chip>}
          {subscription.hasPriceIncrease && subscription.previousAmountCents && (
            <Chip tone="danger">
              Up from {formatCents(subscription.previousAmountCents)}
            </Chip>
          )}
          {subscription.isDuplicate && <Chip tone="info">Overlaps another {subscription.category}</Chip>}
          {subscription.looksUnused && <Chip tone="neutral">Looks unused</Chip>}
        </div>
      </div>

      <div className="text-right">
        <p className="text-base font-semibold text-ink-900 tnum">
          {formatCents(subscription.amountCents)}
        </p>
        <p className="text-xs text-ink-600 tnum">{formatCents(subscription.yearlyCostCents)}/yr</p>
      </div>

      <button
        onClick={simulate}
        disabled={busy}
        title={`Send a test charge from ${subscription.merchantName} through the Guard rules`}
        className="hidden shrink-0 rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-navy-50 disabled:opacity-50 sm:block"
      >
        {busy ? '…' : 'Test charge'}
      </button>

      <span
        className="hidden text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600 sm:block"
        aria-hidden="true"
      >
        →
      </span>
    </Link>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === 'guarded') return <Chip tone="accent">Guarded</Chip>;
  if (status === 'blocked') return <Chip tone="danger">Blocked</Chip>;
  if (status === 'canceled') return <Chip tone="neutral">Cancelled</Chip>;
  return null;
}

function ListSkeleton() {
  return (
    <div>
      <Skeleton className="mb-6 h-9 w-72" />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
