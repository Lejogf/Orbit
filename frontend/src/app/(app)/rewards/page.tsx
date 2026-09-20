'use client';

// Rewards.
//
// The whole page exists to answer one question honestly: what are my points
// worth? So the rate is stated at the top (100 points = $1), every redemption
// shows both its multiplier and the actual dollars, and the option with the
// worst value says so out loud instead of being hidden behind a nicer picture.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { money, type RedemptionRow, type RewardsResponse } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Chip, ErrorState, Field, PageHeader, Progress, SectionCard, Sheet, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

const TIER_LABEL: Record<string, string> = {
  start: 'Orbit Start',
  move: 'Orbit Move',
  rise: 'Orbit Rise',
  summit: 'Orbit Summit',
  business: 'Orbit Business',
};

export default function RewardsPage() {
  const t = useT();
  const toast = useToast();
  const [data, setData] = useState<RewardsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<RedemptionRow | null>(null);

  const load = useCallback(() => {
    setError(null);
    money.rewards().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.rewards')} title={t('page.rewards.title')} subtitle={t('page.rewards.subtitle')} />

      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Balance */}
          <section className="rounded-2xl bg-accent-sheen p-6 text-white shadow-raised">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] opacity-80">Points balance</p>
            <p className="mt-1.5 hero-number">{data.points.toLocaleString('en-US')}</p>
            <p className="mt-2 text-lg font-semibold">= {formatCents(data.valueCents)} in cash</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/25 pt-4 text-sm">
              <span className="opacity-90">+{data.earnedThisMonth.toLocaleString('en-US')} earned this month</span>
              <span className="opacity-90">On {TIER_LABEL[data.tier] ?? 'your card'}</span>
            </div>
          </section>

          {/* Redemptions */}
          <section aria-labelledby="redeem-heading">
            <h2 id="redeem-heading" className="mb-1 text-base font-semibold text-ink-900">What you can do with them</h2>
            <p className="mb-3 text-sm text-ink-600">Every option shows what 1,000 points is worth, so you can compare at a glance.</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {data.redemptions.map((option) => {
                const best = option.multiplier > 1;
                const worst = option.multiplier < 1;
                return (
                  <li key={option.id} className={`card flex flex-col p-4 ${best ? 'ring-1 ring-accent-400' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-base font-bold text-ink-900">{option.label}</h3>
                      {best && <Chip tone="accent">Best value</Chip>}
                      {worst && <Chip tone="warn">Lower value</Chip>}
                    </div>
                    <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-600">{option.description}</p>

                    <dl className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-surface-sunken px-3.5 py-2.5">
                      <div>
                        <dt className="text-[0.6875rem] text-ink-500">1,000 points</dt>
                        <dd className="font-display text-base font-bold text-ink-900 tnum">{formatCents(option.per1000Cents)}</dd>
                      </div>
                      <div className="text-right">
                        <dt className="text-[0.6875rem] text-ink-500">Your balance</dt>
                        <dd className="font-display text-base font-bold text-accent-600 tnum">{formatCents(option.valueCents)}</dd>
                      </div>
                    </dl>

                    <button
                      onClick={() => setRedeeming(option)}
                      disabled={!option.available}
                      className={`mt-3 ${best ? 'btn-accent' : 'btn-ghost'} w-full`}
                    >
                      {option.available ? 'Redeem' : `Needs ${option.minimumPoints.toLocaleString('en-US')} points`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Earn more */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Earn more">
              {data.tips.length === 0 ? (
                <p className="text-sm text-ink-600">Keep spending on your card and tips will appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {data.tips.map((tip) => (
                    <li key={tip.title} className="rounded-xl bg-surface-sunken p-3.5">
                      <p className="text-sm font-semibold text-ink-900">{tip.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{tip.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/cards" className="btn-ghost mt-4">
                Compare cards
              </Link>
            </SectionCard>

            <SectionCard title="Boosters running now">
              <ul className="space-y-3">
                {data.boosters.map((booster) => (
                  <li key={booster.id} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">{booster.label}</p>
                      <p className="text-xs text-ink-500">Ends in {booster.endsInDays} days</p>
                    </div>
                    <span className="font-display text-base font-bold text-accent-600">+{booster.bonusRate}x</span>
                  </li>
                ))}
              </ul>

              <h3 className="mt-5 text-sm font-semibold text-ink-900">Your cards earn</h3>
              <ul className="mt-2 space-y-2">
                {data.earnRates.map((card) => (
                  <li key={card.accountId} className="text-sm">
                    <p className="font-medium text-ink-800">{card.name}</p>
                    <p className="text-xs text-ink-600">{card.earn.map((rule) => `${rule.rate}x ${rule.category === 'everything' ? 'everything' : rule.category.toLowerCase()}`).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* Ledger */}
          <SectionCard title="Points history">
            {data.history.length === 0 ? (
              <p className="text-sm text-ink-600">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.history.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-ink-800">{entry.reason}</p>
                      <p className="text-xs text-ink-500">{new Date(entry.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold tnum ${entry.points > 0 ? 'text-accent-600' : 'text-ink-700'}`}>
                      {entry.points > 0 ? '+' : ''}
                      {entry.points.toLocaleString('en-US')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}

      {redeeming && data && (
        <RedeemSheet
          option={redeeming}
          balance={data.points}
          onClose={() => setRedeeming(null)}
          onDone={(message) => {
            toast.show(message, 'success');
            setRedeeming(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function RedeemSheet({
  option,
  balance,
  onClose,
  onDone,
}: {
  option: RedemptionRow;
  balance: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [points, setPoints] = useState(Math.min(balance, Math.max(option.minimumPoints, 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueCents = Math.round((points / 100) * 100 * option.multiplier);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await money.redeem(option.id, points);
      onDone(`${points.toLocaleString('en-US')} points redeemed for ${formatCents(result.valueCents)}`);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={option.label}
      footer={
        <button onClick={() => void submit()} disabled={busy || points < option.minimumPoints} className="btn-primary w-full">
          {busy ? 'Redeeming…' : `Redeem for ${formatCents(valueCents)}`}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-700">{option.description}</p>

        <div className="rounded-2xl bg-surface-sunken p-4 text-center">
          <p className="font-display text-3xl font-bold text-ink-900 tnum">{points.toLocaleString('en-US')}</p>
          <p className="text-sm text-ink-600">points</p>
          <p className="mt-3 font-display text-2xl font-bold text-accent-600 tnum">{formatCents(valueCents)}</p>
          {option.multiplier !== 1 && (
            <p className="text-xs text-ink-500">
              {option.multiplier > 1 ? `${Math.round((option.multiplier - 1) * 100)}% more than cash` : `${Math.round((1 - option.multiplier) * 100)}% less than cash`}
            </p>
          )}
        </div>

        <Field label="How many points" htmlFor="points" error={error} hint={`You have ${balance.toLocaleString('en-US')}. Minimum ${option.minimumPoints.toLocaleString('en-US')}.`}>
          <input
            id="points"
            type="range"
            min={option.minimumPoints}
            max={balance}
            step={100}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className="w-full accent-accent-500"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {[1000, 5000, 10000].filter((n) => n >= option.minimumPoints && n <= balance).map((preset) => (
            <button key={preset} onClick={() => setPoints(preset)} className="btn-ghost !px-3 !py-1.5 text-xs">
              {preset.toLocaleString('en-US')}
            </button>
          ))}
          <button onClick={() => setPoints(balance)} className="btn-ghost !px-3 !py-1.5 text-xs">
            All {balance.toLocaleString('en-US')}
          </button>
        </div>

        <Progress value={points / Math.max(1, balance)} />
      </div>
    </Sheet>
  );
}
