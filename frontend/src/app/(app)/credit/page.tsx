'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CreditReport, type ScenarioId } from '@/lib/api';
import { formatCents, percent } from '@/lib/format';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function CreditPage() {
  const t = useT();
  const [report, setReport] = useState<CreditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<ScenarioId>>(new Set());
  const [projected, setProjected] = useState<{ score: number; band: string; delta: number } | null>(
    null,
  );

  const load = useCallback(() => {
    setError(null);
    api
      .credit()
      .then(setReport)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  // Re-run the projection whenever the selection changes.
  useEffect(() => {
    if (!report) return;
    if (picked.size === 0) {
      setProjected(null);
      return;
    }

    let cancelled = false;
    api
      .simulateCredit([...picked])
      .then((result) => {
        if (!cancelled) {
          setProjected({ ...result.projected, delta: result.delta });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [picked, report]);

  const toggle = (id: ScenarioId) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const shown = projected ?? (report ? { score: report.score, band: report.band, delta: 0 } : null);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report || !shown) return <CreditSkeleton />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('nav.credit')}
        title={t('page.credit.heading')}
        subtitle="A FICO-model estimate from the accounts Orbit can see — same five factors, same weights — and what would move it."
      />

      <ScoreDial
        score={shown.score}
        band={shown.band}
        delta={shown.delta}
        baseline={report.score}
        range={report.range}
        simulating={picked.size > 0}
        onReset={() => setPicked(new Set())}
      />

      {/* What-if picker */}
      <section className="card p-6">
        <h2 className="text-sm font-semibold text-ink-900">What would change it?</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-600">
          Pick any combination. The dial above updates as you go.
        </p>

        <ul className="mt-4 space-y-2">
          {report.scenarios.map((scenario) => {
            const selected = picked.has(scenario.id);
            const positive = scenario.delta > 0;

            return (
              <li key={scenario.id}>
                <button
                  onClick={() => toggle(scenario.id)}
                  aria-pressed={selected}
                  className={`flex w-full items-start gap-4 rounded-xl border p-4 text-left transition ${
                    selected
                      ? 'border-ink-500 bg-navy-50'
                      : 'border-line bg-surface hover:border-ink-300'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                      selected
                        ? 'border-ink-600 bg-ink-600 text-white'
                        : 'border-slate-300 text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      {scenario.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">
                      {scenario.description}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tnum ${
                      positive ? 'bg-accent-100 text-accent-700' : 'bg-accent-100 text-accent-700'
                    }`}
                  >
                    {positive ? '+' : ''}
                    {scenario.delta}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {report.context.splittableTransactionId && (
          <Link
            href={`/plans/new/${report.context.splittableTransactionId}?from=credit`}
            className="btn-ghost mt-4 w-full"
          >
            Split the {formatCents(report.context.splittablePurchaseCents)}{' '}
            {report.context.splittableMerchant} purchase →
          </Link>
        )}
      </section>

      {/* Factor breakdown */}
      <section className="card p-6">
        <h2 className="text-sm font-semibold text-ink-900">What makes up your score</h2>
        <p className="mt-1 text-xs text-ink-600">
          The five factors scoring models publish, weighted as they weight them.
        </p>

        <ul className="mt-4 space-y-4">
          {report.factors.map((factor) => (
            <li key={factor.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-ink-900">
                  {factor.label}
                  <span className="ml-2 text-xs font-normal text-ink-500 tnum">
                    {percent(factor.weight)} of your score
                  </span>
                </p>
                <p className="shrink-0 text-xs font-semibold text-ink-700 tnum">
                  {factor.points} pts
                </p>
              </div>

              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    factor.standing === 'strong'
                      ? 'bg-accent-600'
                      : factor.standing === 'fair'
                        ? 'bg-warn-500'
                        : 'bg-accent-500'
                  }`}
                  style={{ width: `${Math.max(3, factor.score * 100)}%` }}
                />
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{factor.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="rounded-xl bg-surface-sunken px-4 py-3 text-xs leading-relaxed text-ink-600">
        <strong className="font-semibold text-ink-800">This is an estimate, not a FICO® score.</strong>{' '}
        {report.disclaimer} A FICO® score is sold by the credit bureaus; when you connect yours, we’ll show it beside this
        estimate instead of replacing it.
      </p>
    </div>
  );
}

const BANDS = [
  { label: 'Poor', from: 300 },
  { label: 'Fair', from: 580 },
  { label: 'Good', from: 670 },
  { label: 'Very good', from: 740 },
  { label: 'Exceptional', from: 800 },
];

function ScoreDial({
  score,
  band,
  delta,
  baseline,
  range,
  simulating,
  onReset,
}: {
  score: number;
  band: string;
  delta: number;
  baseline: number;
  range: { min: number; max: number };
  simulating: boolean;
  onReset: () => void;
}) {
  const span = range.max - range.min;
  const position = useMemo(
    () => Math.min(100, Math.max(0, ((score - range.min) / span) * 100)),
    [score, range.min, span],
  );
  const baselinePosition = ((baseline - range.min) / span) * 100;

  return (
    <section className="card overflow-hidden bg-ink-800 p-6 text-white sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-200">
            {simulating ? 'Projected score' : 'Estimated score'}
          </p>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="text-6xl font-semibold tracking-tight tnum">{score}</span>
            {delta !== 0 && (
              <span
                className={`rounded-full px-2.5 py-1 text-sm font-bold tnum ${
                  delta > 0 ? 'bg-accent-600 text-white' : 'bg-accent-500 text-white'
                }`}
              >
                {delta > 0 ? '+' : ''}
                {delta}
              </span>
            )}
          </p>
          <p className="mt-1.5 text-sm text-ink-200">
            {band}
            {simulating && <span className="text-ink-300"> · was {baseline}</span>}
          </p>
        </div>

        {simulating && (
          <button
            onClick={onReset}
            className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Reset
          </button>
        )}
      </div>

      {/* Band scale */}
      <div className="mt-7">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 via-amber-400 to-money-600 transition-all duration-500"
            style={{ width: `${position}%` }}
          />
          {simulating && (
            <div
              className="absolute top-0 h-full w-0.5 bg-white/70"
              style={{ left: `${baselinePosition}%` }}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="mt-2 flex justify-between text-[10px] text-ink-300">
          {BANDS.map((b) => (
            <span key={b.label} className="tnum">
              {b.from}
            </span>
          ))}
          <span className="tnum">{range.max}</span>
        </div>
      </div>
    </section>
  );
}

function CreditSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="mb-6 h-9 w-56" />
      <Skeleton className="h-48 rounded-2xl" />
      <Skeleton className="h-80 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
