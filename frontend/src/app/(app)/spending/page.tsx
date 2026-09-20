'use client';

// Where the money went, in plain words.
//
// The category chart uses the validated eight-hue categorical palette with a
// labelled legend; the trend and weekday charts are single-series, so they use
// one hue and need no legend. Every value is written out as well as drawn, there
// is a table view, and each insight states the number behind it.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { more, type SpendingReport } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { askOri } from '@/components/ori/OriAssistant';
import { CategoryDonut } from '@/components/CategoryDonut';

const TONE = {
  good: { ring: 'ring-money-100', dot: 'bg-accent-600', label: 'Good news' },
  warn: { ring: 'ring-warn-200', dot: 'bg-warn-500', label: 'Worth a look' },
  info: { ring: 'ring-ink-100', dot: 'bg-ink-500', label: 'Did you know' },
} as const;

export default function SpendingPage() {
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<SpendingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'chart' | 'bars' | 'table'>('chart');

  const load = useCallback(() => {
    setError(null);
    more.spending(offset).then(setReport).catch((e: Error) => setError(e.message));
  }, [offset]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const change = report ? report.totalCents - report.previousTotalCents : 0;
  const maxCategory = Math.max(1, ...(report?.categories.map((c) => c.cents) ?? [1]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Spending"
        title="Where your money went"
        subtitle="Every card purchase and withdrawal, grouped so you can see your habits. Transfers between your own accounts aren’t counted."
        action={
          <div className="flex items-center gap-1 rounded-full bg-surface p-1 ring-1 ring-line" role="group" aria-label="Choose month">
            <button onClick={() => setOffset((o) => Math.min(5, o + 1))} disabled={offset >= 5} className="h-9 w-9 rounded-full text-ink-700 hover:bg-navy-50 disabled:opacity-30" aria-label="Previous month">‹</button>
            <span className="min-w-[6.5rem] text-center text-sm font-semibold text-ink-900" aria-live="polite">{report?.period.label ?? '…'}</span>
            <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} className="h-9 w-9 rounded-full text-ink-700 hover:bg-navy-50 disabled:opacity-30" aria-label="Next month">›</button>
          </div>
        }
      />

      {!report ? (
        <SpendingSkeleton />
      ) : (
        <>
          {/* Headline numbers */}
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Summary">
            <div className="card p-5 sm:col-span-1">
              <p className="label">{offset === 0 ? 'Spent so far' : 'Spent'}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 tnum">{formatMoney(report.totalCents)}</p>
              <p className="mt-1 text-sm text-ink-700">
                {report.previousTotalCents > 0
                  ? `${change >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(change))} ${change >= 0 ? 'more' : 'less'} than last month${offset === 0 ? ' so far' : ''}`
                  : 'No spending recorded last month'}
              </p>
            </div>
            <div className="card p-5">
              <p className="label">Came in</p>
              <p className="mt-1 text-2xl font-semibold text-accent-700 tnum">{formatMoney(report.incomeCents)}</p>
              <p className="mt-1 text-sm text-ink-700">Paychecks and deposits</p>
            </div>
            <div className="card p-5">
              <p className="label">Already committed</p>
              <p className="mt-1 text-2xl font-semibold text-ink-900 tnum">{formatMoney(report.recurringCents)}</p>
              <p className="mt-1 text-sm text-ink-700">
                Subscriptions — <Link href="/subscriptions" className="font-semibold underline-offset-2 hover:underline">review</Link>
              </p>
            </div>
          </section>

          {/* Insights */}
          {report.insights.length > 0 && (
            <section aria-labelledby="insights-heading">
              <h2 id="insights-heading" className="label mb-2">What stands out</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {report.insights.map((insight) => (
                  <li key={insight.id} className={`card p-4 ring-1 ${TONE[insight.tone].ring}`}>
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-600">
                      <span className={`h-2 w-2 rounded-full ${TONE[insight.tone].dot}`} aria-hidden="true" />
                      {TONE[insight.tone].label}
                    </p>
                    <p className="mt-1.5 text-base font-semibold text-ink-900">{insight.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-700">{insight.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Categories */}
          <section className="card p-5" aria-labelledby="cat-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cat-heading" className="text-base font-semibold text-ink-900">By category</h2>
              <div className="flex gap-1 rounded-full bg-surface-sunken p-1" role="group" aria-label="How to show categories">
                {(
                  [
                    ['chart', 'Chart'],
                    ['bars', 'Bars'],
                    ['table', 'Table'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    aria-pressed={view === id}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${view === id ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {report.categories.length === 0 ? (
              <p className="mt-4 text-sm text-ink-600">No spending this month yet.</p>
            ) : view === 'chart' ? (
              <div className="mt-5">
                <CategoryDonut categories={report.categories} totalCents={report.totalCents} />
              </div>
            ) : view === 'table' ? (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink-600">
                    <th className="py-2 font-semibold">Category</th>
                    <th className="py-2 text-right font-semibold">This month</th>
                    <th className="py-2 text-right font-semibold">Last month</th>
                    <th className="py-2 text-right font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.categories.map((c) => (
                    <tr key={c.category}>
                      <th scope="row" className="py-2.5 text-left font-medium text-ink-900">{c.category}</th>
                      <td className="py-2.5 text-right tnum">{formatMoney(c.cents)}</td>
                      <td className="py-2.5 text-right tnum text-ink-700">{formatMoney(c.previousCents)}</td>
                      <td className="py-2.5 text-right tnum text-ink-700">{Math.round(c.share * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ul className="mt-4 space-y-3">
                {report.categories.map((c) => (
                  <li key={c.category} title={`${c.category}: ${formatMoney(c.cents)} across ${c.count} purchases, ${formatMoney(c.previousCents)} last month`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-ink-900">{c.category}</span>
                      <span className="tnum">
                        <span className="font-semibold text-ink-900">{formatMoney(c.cents)}</span>
                        {c.previousCents > 0 && Math.abs(c.changeCents) >= 100 && (
                          <span className="ml-2 text-xs text-ink-600">
                            {c.changeCents > 0 ? '▲' : '▼'} {formatMoney(Math.abs(c.changeCents))}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 rounded-full bg-surface-sunken" aria-hidden="true">
                      <div className="h-2.5 rounded-full bg-ink-600 transition-[width] duration-500" style={{ width: `${Math.max(1.5, (c.cents / maxCategory) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <MonthlyTrend report={report} />
            <WeekdayChart report={report} />
          </div>

          {/* Merchants */}
          <section className="card p-5" aria-labelledby="merchants-heading">
            <h2 id="merchants-heading" className="text-base font-semibold text-ink-900">Where you spend most</h2>
            <ol className="mt-3 divide-y divide-line">
              {report.merchants.map((m, i) => (
                <li key={m.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-bold text-ink-700" aria-hidden="true">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">{m.name}</span>
                      <span className="text-xs text-ink-600">{m.category} · {m.count} {m.count === 1 ? 'visit' : 'visits'}</span>
                    </span>
                  </span>
                  <span className="font-semibold text-ink-900 tnum">{formatMoney(m.cents)}</span>
                </li>
              ))}
            </ol>
          </section>

          <button onClick={() => askOri('Where does my money go?')} className="btn-ghost">
            Ask Ori about my spending
          </button>
        </>
      )}
    </div>
  );
}

function MonthlyTrend({ report }: { report: SpendingReport }) {
  const max = Math.max(1, ...report.trend.map((t) => t.cents));
  const current = report.trend.at(-1)?.month;
  return (
    <section className="card p-5" aria-labelledby="trend-heading">
      <h2 id="trend-heading" className="text-base font-semibold text-ink-900">Last six months</h2>
      <div className="mt-4 flex h-44 items-end gap-2 border-b border-line" role="list">
        {report.trend.map((t) => (
          <div key={t.month} role="listitem" className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${t.label}: ${formatMoney(t.cents)}`}>
            <span className={`text-[10px] font-semibold tnum ${t.month === current ? 'text-ink-900' : 'text-ink-600 opacity-0 group-hover:opacity-100'}`}>
              {formatMoney(t.cents, { compact: true })}
            </span>
            <div
              className={`w-full max-w-[2.5rem] rounded-t-[4px] transition-[height] duration-500 ${t.month === current ? 'bg-ink-600' : 'bg-ink-200 group-hover:bg-ink-300'}`}
              style={{ height: `${Math.max(2, (t.cents / max) * 100)}%` }}
            />
            <span className="sr-only">{`${t.label}: ${formatMoney(t.cents)}`}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2" aria-hidden="true">
        {report.trend.map((t) => (
          <span key={t.month} className="flex-1 text-center text-xs text-ink-600">{t.label}</span>
        ))}
      </div>
    </section>
  );
}

function WeekdayChart({ report }: { report: SpendingReport }) {
  const max = Math.max(1, ...report.byWeekday.map((d) => d.cents));
  return (
    <section className="card p-5" aria-labelledby="week-heading">
      <h2 id="week-heading" className="text-base font-semibold text-ink-900">A typical day of the week</h2>
      <p className="mt-0.5 text-xs text-ink-600">Average spent on each day this month</p>
      <ul className="mt-4 space-y-2">
        {report.byWeekday.map((d) => (
          <li key={d.day} className="flex items-center gap-3 text-sm" title={`${d.day}: ${formatMoney(d.cents)} on average`}>
            <span className="w-9 shrink-0 font-medium text-ink-800">{d.day}</span>
            <span className="h-2.5 flex-1 rounded-full bg-surface-sunken" aria-hidden="true">
              <span className="block h-2.5 rounded-full bg-ink-500" style={{ width: `${Math.max(1.5, (d.cents / max) * 100)}%` }} />
            </span>
            <span className="w-16 shrink-0 text-right text-ink-900 tnum">{formatMoney(d.cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpendingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-60" />
        <Skeleton className="h-60" />
      </div>
    </div>
  );
}
