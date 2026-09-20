'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type InstallmentPlan } from '@/lib/api';
import { formatCents, formatDate, formatLongDate } from '@/lib/format';
import { Chip, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useToast } from '@/components/Toast';

export default function PlansPage() {
  const t = useT();
  const [data, setData] = useState<{
    plans: InstallmentPlan[];
    summary: {
      activeCount: number;
      monthlyTotalCents: number;
      financedCents: number;
      remainingCents: number;
      maxPlans: number;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    api.plans().then(setData).catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  const pay = async (id: string, mode: 'next' | 'payoff') => {
    setBusy(id);
    try {
      const result = (await api.payPlan(id, mode)) as { interestSavedCents?: number };
      load();
      toast.show(
        mode === 'payoff'
          ? `Paid off in full${result.interestSavedCents ? `, saving ${formatCents(result.interestSavedCents)} in interest` : ''}.`
          : 'Payment made.',
        'success',
      );
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'Payment failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;

  const { plans, summary } = data;

  return (
    <div>
      <PageHeader
        eyebrow={t('nav.plans')}
        title={t('page.plans.heading')}
        subtitle={t('page.plans.subtitle')}
      />

      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="label">Monthly</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-900 tnum">
            {formatCents(summary.monthlyTotalCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">
            {summary.activeCount} of {summary.maxPlans} plans in use
          </p>
        </div>
        <div className="card p-5">
          <p className="label">Financed</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-900 tnum">
            {formatCents(summary.financedCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">original purchase value</p>
        </div>
        <div className="card p-5">
          <p className="label">Left to pay</p>
          <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink-900 tnum">
            {formatCents(summary.remainingCents)}
          </p>
          <p className="mt-1 text-xs text-ink-600">across all active plans</p>
        </div>
      </section>

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          body="Open any card purchase of $100 or more and you'll see the option to split it into 3, 6, 12 or 24 payments."
          action={
            <Link href="/accounts" className="btn-primary">
              Find a purchase to split
            </Link>
          }
        />
      ) : (
        <ul className="space-y-4">
          {plans.map((plan) => {
            const paid = plan.payments.filter((p) => p.status === 'paid').length;
            const progress = paid / plan.termMonths;
            const next = plan.payments.find((p) => p.status === 'scheduled');

            return (
              <li key={plan.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-ink-900">{plan.merchantName}</p>
                      {plan.status === 'paid_off' && <Chip tone="accent">Paid off</Chip>}
                      {plan.aprPercent === 0 && plan.status === 'active' && <Chip tone="accent">0%</Chip>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {formatCents(plan.principalCents)} over {plan.termMonths} months ·{' '}
                      {plan.aprPercent.toFixed(2)}% APR
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-semibold text-ink-900 tnum">
                      {formatCents(plan.monthlyPaymentCents)}
                    </p>
                    <p className="text-xs text-ink-600">per month</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-ink-600">
                    <span className="tnum">
                      {paid} of {plan.termMonths} paid
                    </span>
                    <span>
                      {next ? `Next ${formatDate(next.dueDate)}` : `Finished ${formatLongDate(plan.payoffDate)}`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-ink-500 transition-all duration-500"
                      style={{ width: `${Math.max(2, progress * 100)}%` }}
                    />
                  </div>
                </div>

                {plan.status === 'active' && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => pay(plan.id, 'next')} disabled={busy === plan.id} className="btn-ghost">
                      {busy === plan.id ? '…' : `Pay ${formatCents(plan.monthlyPaymentCents)} now`}
                    </button>
                    <button onClick={() => pay(plan.id, 'payoff')} disabled={busy === plan.id} className="btn-accent">
                      Pay off early
                    </button>
                  </div>
                )}

                <p className="mt-3 text-[11px] text-ink-600">
                  Paying off early waives the interest on the months you don&rsquo;t use.
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
