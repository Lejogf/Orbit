'use client';

// The plan — and the question underneath it: am I going to be OK?
//
// The forecast answers first, in one sentence, using the customer's own
// numbers. The rules and envelopes are below for people who want to shape it.
// Households share one plan through a passkey, so a couple (or a parent and a
// working teenager) can see the same picture.
import { useCallback, useEffect, useState } from 'react';
import { money, type BudgetMethod, type BudgetResponse } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Chip, ErrorState, Field, PageHeader, Progress, SectionCard, Segmented, Sheet, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';
import { askOri } from '@/components/ori/OriAssistant';

const STATUS_SKIN = {
  comfortable: 'bg-accent-sheen text-white',
  tight: 'bg-warn-500 text-white',
  short: 'bg-danger-500 text-white',
} as const;

export default function BudgetPage() {
  const t = useT();
  const toast = useToast();
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingIncome, setEditingIncome] = useState(false);
  const [household, setHousehold] = useState<{ code: string; name: string } | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    setError(null);
    money.budget().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const setMethod = async (method: BudgetMethod) => {
    setData(await money.saveBudget({ method }));
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.budget')} title={t('page.budget.title')} subtitle={t('page.budget.subtitle')} />

      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* The answer */}
          <section className={`rounded-2xl p-6 shadow-raised ${STATUS_SKIN[data.forecast.status]}`}>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] opacity-80">
              {data.forecast.status === 'short' ? 'Needs attention' : data.forecast.status === 'tight' ? 'It’s tight' : 'You’re on track'}
            </p>
            <h2 className="mt-2 font-display text-[1.375rem] font-bold leading-snug sm:text-2xl">{data.forecast.headline}</h2>
            <p className="mt-2 max-w-prose text-sm leading-relaxed opacity-90">{data.forecast.advice}</p>

            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-white/25 pt-4 sm:grid-cols-4">
              {[
                ['Safe per day', formatCents(data.forecast.safeDailyCents)],
                ['Left over monthly', formatCents(data.forecast.monthlySurplusCents)],
                ['Savings runway', `${data.forecast.runwayMonths} mo`],
                ['Emergency target', formatCents(data.forecast.emergencyTargetCents)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[0.6875rem] uppercase tracking-wide opacity-75">{label}</dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tnum">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Income vs spending */}
          <SectionCard
            title="In and out"
            action={
              <button onClick={() => setEditingIncome(true)} className="text-sm font-semibold text-accent-600 hover:underline">
                {data.incomeIsEstimated ? 'Set your income' : 'Edit income'}
              </button>
            }
          >
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <p className="text-sm text-ink-600">
                Coming in{' '}
                <strong className="font-display text-xl font-bold text-ink-900 tnum">{formatCents(data.monthlyIncomeCents)}</strong>
                <span className="ml-1 text-xs">{data.incomeIsEstimated ? '(estimated from deposits)' : '(you set this)'}</span>
              </p>
              <p className="text-sm text-ink-600">
                Going out{' '}
                <strong className="font-display text-xl font-bold text-ink-900 tnum">{formatCents(data.averages.monthlySpendCents)}</strong>
                <span className="ml-1 text-xs">(average of {data.averages.monthsCounted} months)</span>
              </p>
            </div>

            {data.averages.volatility > 0.25 && (
              <p className="mt-3 rounded-xl bg-warn-50 px-3.5 py-2.5 text-xs leading-relaxed text-warn-800">
                Your spending swings about {Math.round(data.averages.volatility * 100)}% month to month, so treat the averages as a
                guide rather than a promise. A slightly bigger cushion is worth it.
              </p>
            )}

            {/* Six-month bars: income against spending. */}
            <ul className="mt-5 flex h-36 items-end gap-2 border-b border-line">
              {data.months.map((month) => {
                const max = Math.max(...data.months.map((m) => Math.max(m.incomeCents, m.spendCents)), 1);
                return (
                  <li key={month.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${month.month}: ${formatCents(month.incomeCents)} in, ${formatCents(month.spendCents)} out`}>
                    <div className="flex h-full w-full items-end justify-center gap-0.5">
                      <span className="w-1/2 rounded-t bg-accent-400" style={{ height: `${(month.incomeCents / max) * 100}%` }} />
                      <span className="w-1/2 rounded-t bg-ink-700" style={{ height: `${(month.spendCents / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1.5 flex gap-2">
              {data.months.map((month) => (
                <span key={month.month} className="flex-1 text-center text-[0.625rem] text-ink-500">
                  {new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
                </span>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-4 text-xs text-ink-600">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-400" /> In</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ink-700" /> Out</span>
            </p>
          </SectionCard>

          {/* Method */}
          <SectionCard
            title="How you want to budget"
            action={
              <Segmented
                label="Budgeting method"
                size="sm"
                value={data.method}
                onChange={(method) => void setMethod(method)}
                options={[
                  ['rule5030', '50/30/20'],
                  ['rule70101010', '70/10/10/10'],
                  ['zero', 'Zero-based'],
                ] as const}
              />
            }
          >
            {data.method === 'zero' ? (
              <ZeroBased data={data} onSaved={setData} />
            ) : (
              <>
                <p className="mb-4 text-sm leading-relaxed text-ink-700">
                  {data.rules[data.method]?.description}
                </p>
                <ul className="space-y-4">
                  {data.plan.map((slice) => {
                    const used = slice.plannedCents > 0 ? slice.actualCents / slice.plannedCents : 0;
                    return (
                      <li key={slice.bucket}>
                        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="font-semibold text-ink-900">{slice.label}</span>
                          <span className="text-ink-700 tnum">
                            {formatCents(slice.actualCents)} of {formatCents(slice.plannedCents)}
                            <span className={`ml-2 font-semibold ${slice.differenceCents >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>
                              {slice.differenceCents >= 0 ? `${formatCents(slice.differenceCents)} left` : `${formatCents(-slice.differenceCents)} over`}
                            </span>
                          </span>
                        </div>
                        <Progress value={used} tone={used > 1 ? 'danger' : used > 0.85 ? 'warn' : 'accent'} />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </SectionCard>

          {/* Household */}
          <SectionCard title="Share this plan">
            {data.household ? (
              <>
                <p className="text-sm text-ink-700">
                  <strong className="font-semibold">{data.household.name}</strong> — {data.household.members.length} member
                  {data.household.members.length === 1 ? '' : 's'}. Everyone sharing sees the same plan, and the totals include all
                  of their accounts.
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {data.household.members.map((member) => (
                    <li key={member.customerId}>
                      <Chip tone={member.role === 'owner' ? 'ink' : 'neutral'}>
                        {member.firstName} · {member.role}
                        {!member.sharesMoney && ' (own money)'}
                      </Chip>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={async () => {
                    setData(await money.leaveHousehold());
                    toast.show('You’ve left the household', 'info');
                  }}
                  className="btn-danger mt-4"
                >
                  Leave household
                </button>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-ink-700">
                  Budget together with a partner, or with a teenager who has started working. You share one passkey — no email
                  invitations, nothing posted publicly — and anyone can leave at any time.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      const name = window.prompt('What should we call your household?', 'Our household');
                      if (!name) return;
                      const result = await money.createHousehold(name);
                      setHousehold({ code: result.joinCode, name: result.household.name });
                      load();
                    }}
                    className="btn-accent"
                  >
                    Start a household
                  </button>
                  <button onClick={() => setJoining(true)} className="btn-ghost">
                    Join with a passkey
                  </button>
                </div>
              </>
            )}
          </SectionCard>

          <button onClick={() => askOri('How much can I spend this week?')} className="btn-ghost">
            Ask Ori about this
          </button>
        </>
      )}

      {/* Income editor */}
      <Sheet open={editingIncome} onClose={() => setEditingIncome(false)} title="Your monthly income">
        <IncomeForm
          current={data?.monthlyIncomeCents ?? 0}
          estimated={data?.averages.monthlyIncomeCents ?? 0}
          onSaved={(next) => {
            setData(next);
            setEditingIncome(false);
            toast.show('Income updated', 'success');
          }}
        />
      </Sheet>

      {/* Passkey, shown once */}
      <Sheet open={household !== null} onClose={() => setHousehold(null)} title="Share this passkey">
        {household && (
          <div className="text-center">
            <p className="text-sm text-ink-700">Give this to the person joining {household.name}. It is shown once.</p>
            <p className="my-5 font-mono text-3xl font-bold tracking-[0.15em] text-accent-600">{household.code}</p>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(household.code);
                toast.show('Passkey copied', 'success');
              }}
              className="btn-primary w-full"
            >
              Copy passkey
            </button>
            <p className="mt-3 text-xs text-ink-500">
              We only store a scrambled version, so nobody — including us — can look it up later. Lost it? Start a new household.
            </p>
          </div>
        )}
      </Sheet>

      {/* Join */}
      <Sheet open={joining} onClose={() => setJoining(false)} title="Join a household">
        <JoinForm
          onJoined={(next) => {
            setData(next);
            setJoining(false);
            toast.show('You’re in — the plan is now shared', 'success');
          }}
        />
      </Sheet>
    </div>
  );
}

function IncomeForm({ current, estimated, onSaved }: { current: number; estimated: number; onSaved: (data: BudgetResponse) => void }) {
  const [value, setValue] = useState((current / 100).toFixed(0));
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-700">
        Take-home pay — what actually lands in your account each month. We estimated {formatCents(estimated)} from your deposits;
        set it yourself if your income is irregular or comes from elsewhere.
      </p>
      <Field label="Monthly take-home" htmlFor="income">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-ink-400">$</span>
          <input id="income" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="field py-4 pl-10 font-display text-2xl font-bold tnum" />
        </div>
      </Field>
      <div className="flex gap-2">
        <button
          onClick={async () => {
            setBusy(true);
            const cents = Math.round((Number.parseFloat(value.replace(/[^0-9.]/g, '')) || 0) * 100);
            onSaved(await money.saveBudget({ monthlyIncomeCents: cents }));
            setBusy(false);
          }}
          disabled={busy}
          className="btn-primary flex-1"
        >
          Save
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            onSaved(await money.saveBudget({ monthlyIncomeCents: null }));
            setBusy(false);
          }}
          className="btn-ghost"
        >
          Use the estimate
        </button>
      </div>
    </div>
  );
}

function JoinForm({ onJoined }: { onJoined: (data: BudgetResponse) => void }) {
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'partner' | 'teen' | 'child'>('partner');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <Field label="Passkey" htmlFor="join-code" error={error} hint="Nine characters, like ABC-DEF-GHJ.">
        <input id="join-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="field font-mono text-lg tracking-[0.12em]" placeholder="ABC-DEF-GHJ" />
      </Field>
      <Field label="You are the" htmlFor="join-role">
        <select id="join-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="field">
          <option value="partner">Partner — we budget together</option>
          <option value="teen">Working teenager — I can chip in</option>
          <option value="child">Child — my money stays mine</option>
        </select>
      </Field>
      <button
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onJoined(await money.joinHousehold(code, role));
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy || code.length < 6}
        className="btn-primary w-full"
      >
        {busy ? 'Joining…' : 'Join'}
      </button>
      <p className="text-xs leading-relaxed text-ink-500">
        Joining shares your balances and spending totals with the household — not your passwords, and not your ability to move
        their money. A child account keeps its own money separate.
      </p>
    </div>
  );
}

/** Zero-based budgeting, pre-filled from real spending so it takes a minute, not an evening. */
function ZeroBased({ data, onSaved }: { data: BudgetResponse; onSaved: (data: BudgetResponse) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState(data.envelopes.map((e) => ({ category: e.category, plannedCents: e.plannedCents, bucket: e.bucket, spentCents: e.spentCents })));
  const [busy, setBusy] = useState(false);

  const assigned = rows.reduce((s, r) => s + r.plannedCents, 0);
  const unassigned = data.monthlyIncomeCents - assigned;

  const autofill = async () => {
    setBusy(true);
    try {
      const suggestions = await money.envelopeSuggestions();
      setRows(suggestions.envelopes.map((e) => ({ category: e.category, plannedCents: e.suggestedCents, bucket: e.bucket, spentCents: 0 })));
      toast.show('Filled in from your last three months — adjust anything that looks off', 'success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-3 text-sm leading-relaxed text-ink-700">
        Zero-based means every dollar gets a job before the month starts. Rather than building it from nothing, we can fill it in
        from what you actually spent.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button onClick={() => void autofill()} disabled={busy} className="btn-accent">
          {busy ? 'Working…' : 'Fill from my history'}
        </button>
        <p className={`text-sm font-semibold tnum ${unassigned === 0 ? 'text-accent-600' : unassigned < 0 ? 'text-danger-600' : 'text-warn-700'}`}>
          {unassigned === 0 ? 'Every dollar has a job ✓' : unassigned > 0 ? `${formatCents(unassigned)} still to assign` : `${formatCents(-unassigned)} over your income`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-600">No envelopes yet. Fill them from your history to get started.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row, index) => (
            <li key={row.category} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{row.category}</span>
              <span className="text-xs text-ink-500 tnum">spent {formatCents(row.spentCents)}</span>
              <input
                aria-label={`Planned for ${row.category}`}
                inputMode="decimal"
                defaultValue={(row.plannedCents / 100).toFixed(0)}
                onBlur={(e) => {
                  const cents = Math.round((Number.parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0) * 100);
                  setRows((current) => current.map((r, i) => (i === index ? { ...r, plannedCents: cents } : r)));
                }}
                className="field w-24 py-1.5 text-right tnum"
              />
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <button
          onClick={async () => {
            setBusy(true);
            onSaved(await money.saveEnvelopes(rows.map((r) => ({ category: r.category, plannedCents: r.plannedCents, bucket: r.bucket }))));
            toast.show('Budget saved', 'success');
            setBusy(false);
          }}
          disabled={busy}
          className="btn-primary mt-4"
        >
          Save budget
        </button>
      )}
    </div>
  );
}
