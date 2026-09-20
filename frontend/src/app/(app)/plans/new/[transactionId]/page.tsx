'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { api, type PlanOptions, type PlanQuote } from '@/lib/api';
import { formatCents, formatLongDate, percent } from '@/lib/format';
import { BackLink, Chip, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function PlanPickerPage({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = use(params);
  const router = useRouter();

  const [options, setOptions] = useState<PlanOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    api
      .planOptions(transactionId)
      .then((data) => {
        setOptions(data);
        // Default to the first term this customer can actually take.
        setSelected(data.quotes.find((q) => q.available)?.termMonths ?? null);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [transactionId]);

  useEffect(load, [load]);

  const confirm = async () => {
    if (selected === null) return;
    setConfirming(true);
    setFailure(null);
    try {
      await api.createPlan(transactionId, selected);
      toast.show(`Plan created. ${selected} payments of ${formatCents(chosen.monthlyPaymentCents)}.`, 'success');
      router.push('/plans');
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not create the plan.');
      setConfirming(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!options || selected === null) return <Skeleton className="h-96 rounded-2xl" />;

  const chosen = options.quotes.find((q) => q.termMonths === selected)!;
  const { transaction } = options;

  return (
    <div className="space-y-5">
      <BackLink href="/accounts" />

      <section className="card p-6">
        <p className="label">Split this purchase</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-navy-900">
          {transaction.merchantName}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {formatCents(transaction.amountCents)} on {formatLongDate(transaction.postedAt)}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone="neutral">Credit band: {options.creditBand}</Chip>
          {options.creditScore && <Chip tone="neutral">Score {options.creditScore}</Chip>}
        </div>
      </section>

      {!options.eligibility.eligible && (
        <div className="card border-brand-200 bg-brand-50/60 p-5">
          <p className="text-sm font-semibold text-navy-900">This purchase can&rsquo;t be split</p>
          <ul className="mt-2 space-y-1 text-sm text-navy-600">
            {options.eligibility.reasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Term picker */}
      <section className="card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Choose your plan</h2>
        <p className="mt-1 text-xs text-navy-600">
          A shorter term costs less overall. A longer term lowers the monthly payment.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Plan term">
          {options.quotes.map((quote) => (
            <TermCard
              key={quote.termMonths}
              quote={quote}
              selected={quote.termMonths === selected}
              onSelect={() => quote.available && setSelected(quote.termMonths)}
            />
          ))}
        </div>
      </section>

      {/* The selected plan in detail */}
      <section className="card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-navy-900">
            {chosen.termMonths} monthly payments
          </h2>
          {chosen.aprPercent === 0 && <Chip tone="accent">0% promotional</Chip>}
        </div>

        <p className="mt-3 text-4xl font-semibold tracking-tight text-navy-900 tnum">
          {formatCents(chosen.monthlyPaymentCents)}
          <span className="ml-1.5 text-lg font-normal text-navy-400">/month</span>
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
          <div>
            <dt className="label">Total cost</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-900 tnum">
              {formatCents(chosen.totalCostCents)}
            </dd>
          </div>
          <div>
            <dt className="label">Interest &amp; fees</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-900 tnum">
              {chosen.totalInterestCents === 0 ? 'None' : formatCents(chosen.totalInterestCents)}
            </dd>
          </div>
          <div>
            <dt className="label">APR</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-900 tnum">
              {chosen.aprPercent.toFixed(2)}%
            </dd>
          </div>
          <div>
            <dt className="label">Paid off by</dt>
            <dd className="mt-1 text-sm font-semibold text-navy-900">
              {formatLongDate(chosen.payoffDate)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Responsible lending */}
      <section
        className={`card p-6 ${
          !chosen.affordability.affordable
            ? 'border-brand-200 bg-brand-50/60'
            : chosen.affordability.stretched
              ? 'border-amber-200 bg-amber-50/60'
              : ''
        }`}
      >
        <h2 className="text-sm font-semibold text-navy-900">Can you afford this?</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-600">{chosen.affordability.message}</p>

        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-navy-600">
            <span>Committed income</span>
            <span className="tnum">
              {percent(chosen.affordability.ratioBefore)} → {percent(chosen.affordability.obligationRatio)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                !chosen.affordability.affordable
                  ? 'bg-brand-500'
                  : chosen.affordability.stretched
                    ? 'bg-amber-500'
                    : 'bg-navy-500'
              }`}
              style={{ width: `${Math.min(100, chosen.affordability.obligationRatio * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-navy-600 tnum">
            {formatCents(chosen.affordability.disposableAfterCents)} left each month after
            everything committed.
          </p>
        </div>
      </section>

      {/* Credit impact */}
      <section className="card p-6">
        <h2 className="text-sm font-semibold text-navy-900">What it does to your credit</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-600">{chosen.creditImpact.summary}</p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="label">Card utilisation</dt>
            <dd className="mt-1.5 text-lg font-semibold text-navy-900 tnum">
              {percent(chosen.creditImpact.utilizationBefore, 1)}
              <span className="mx-2 text-navy-400" aria-label="changes to">→</span>
              <span className="text-navy-700">{percent(chosen.creditImpact.utilizationAfter, 1)}</span>
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="label">Monthly obligations</dt>
            <dd className="mt-1.5 text-lg font-semibold text-navy-900 tnum">
              {formatCents(chosen.creditImpact.monthlyObligationsBeforeCents)}
              <span className="mx-2 text-navy-400" aria-label="changes to">→</span>
              <span className="text-amber-700">
                {formatCents(chosen.creditImpact.monthlyObligationsAfterCents)}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {failure && (
        <p role="alert" className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
          {failure}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={confirm}
          disabled={confirming || !chosen.affordability.affordable || !options.eligibility.eligible}
          className="btn-primary flex-1 sm:flex-none"
        >
          {confirming
            ? 'Creating plan…'
            : `Confirm ${chosen.termMonths} payments of ${formatCents(chosen.monthlyPaymentCents)}`}
        </button>
        <Link href="/accounts" className="btn-ghost">
          Not now
        </Link>
      </div>
    </div>
  );
}

function TermCard({
  quote,
  selected,
  onSelect,
}: {
  quote: PlanQuote;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={!quote.available}
      role="radio"
      aria-checked={selected}
      title={quote.unavailableReason ?? undefined}
      className={`rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-navy-900 bg-navy-900 text-white shadow-lg'
          : quote.available
            ? 'border-slate-200 bg-white hover:border-navy-300'
            : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-50'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className={`text-lg font-semibold tnum ${selected ? 'text-white' : 'text-navy-900'}`}>
          {quote.termMonths}
        </span>
        <span className={`text-[11px] font-medium ${selected ? 'text-navy-200' : 'text-navy-600'}`}>
          months
        </span>
      </div>

      <p className={`mt-2 text-xl font-semibold tracking-tight tnum ${selected ? 'text-white' : 'text-navy-900'}`}>
        {formatCents(quote.monthlyPaymentCents)}
      </p>

      <p className={`mt-1 text-[11px] leading-snug ${selected ? 'text-navy-200' : 'text-navy-600'}`}>
        {quote.aprPercent === 0 ? (
          <span className={selected ? 'font-semibold text-navy-200' : 'font-semibold text-navy-600'}>
            0% — no interest
          </span>
        ) : (
          <>
            {quote.aprPercent.toFixed(2)}% APR
            <br />
            {formatCents(quote.totalInterestCents)} total interest
          </>
        )}
      </p>

      {!quote.available && (
        <p className="mt-2 text-[11px] font-medium text-navy-600">Not available</p>
      )}
    </button>
  );
}
