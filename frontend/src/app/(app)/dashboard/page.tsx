'use client';

// Home.
//
// The order is deliberate: who you are, what you can actually spend, what you
// can do about it, then what is coming. Anything that needs a decision is
// pulled to the top.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, money, type Dashboard, type HeldCard, type RewardsResponse } from '@/lib/api';
import { formatCents, formatDate, relativeDays } from '@/lib/format';
import { Chip, ErrorState, Money, Progress, SectionCard, Skeleton, StatCard } from '@/components/ui';
import { PaymentCard } from '@/components/PaymentCard';
import { MerchantMark } from '@/components/ui';
import { useSession } from '@/components/AuthGuard';
import { useT, greetingKey } from '@/lib/i18n';
import { askOri } from '@/components/ori/OriAssistant';

export default function DashboardPage() {
  const t = useT();
  const { session } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [cards, setCards] = useState<HeldCard[]>([]);
  const [rewards, setRewards] = useState<RewardsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.dashboard().then(setData).catch((e: Error) => setError(e.message));
    money.cards().then((r) => setCards(r.cards)).catch(() => undefined);
    money.rewards().then(setRewards).catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  // Anything Ori or another screen changes should show here immediately.
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('orbit:data-changed', onChange);
    return () => window.removeEventListener('orbit:data-changed', onChange);
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const needsYou = data?.alerts.filter((a) => a.needsDecision) ?? [];
  const checking = data?.accounts.find((a) => a.type === 'Checking');

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <header>
        <p className="label">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="mt-1 font-display text-[1.75rem] font-bold tracking-[-0.025em] text-ink-900 sm:text-[2.125rem]">
          {t(greetingKey())}, {session.customer.firstName}
        </h1>
      </header>

      {!data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* The money */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              tone="ink"
              className="sm:col-span-2"
              label={t('home.available')}
              value={formatCents(checking?.balanceCents ?? 0)}
              hint={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    {t('home.free')}: <strong className="font-semibold">{formatCents(data.safeToSpend.safeToSpendCents)}</strong>
                  </span>
                  <span className="opacity-75">
                    {t('home.committed')}: {formatCents(data.safeToSpend.committedCents)}
                    {data.safeToSpend.daysUntilPayday !== null && ` · payday in ${data.safeToSpend.daysUntilPayday}d`}
                  </span>
                </span>
              }
            />
            <StatCard
              label={t('home.points')}
              value={(rewards?.points ?? 0).toLocaleString('en-US')}
              hint={
                <>
                  Worth {formatCents(rewards?.valueCents ?? 0)} ·{' '}
                  <Link href="/rewards" className="font-semibold text-accent-600 underline-offset-2 hover:underline">
                    Redeem
                  </Link>
                </>
              }
            />
          </div>

          {/* Quick actions */}
          <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2 sm:gap-3">
            {[
              { href: '/pay?action=send', label: t('home.send'), icon: 'M5 12h14M13 6l6 6-6 6' },
              { href: '/pay?action=request', label: t('home.request'), icon: 'M19 12H5M11 18l-6-6 6-6' },
              { href: '/pay?action=deposit', label: t('home.deposit'), icon: 'M12 4v12M7 11l5 5 5-5M5 20h14' },
              { href: '/transfer', label: t('home.move'), icon: 'M7 7h13l-3-3M17 17H4l3 3' },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-center shadow-card transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-raised"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-100 text-accent-700 transition-colors group-hover:bg-accent-500 group-hover:text-on-accent">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={action.icon} />
                  </svg>
                </span>
                <span className="text-xs font-semibold leading-tight text-ink-800">{action.label}</span>
              </Link>
            ))}
          </nav>

          {/* Anything that needs a decision */}
          {needsYou.length > 0 && (
            <SectionCard
              title={t('home.needsYou')}
              action={
                <Link href="/alerts" className="text-sm font-semibold text-accent-600 hover:underline">
                  {t('home.seeAll')}
                </Link>
              }
              className="border-warn-300"
            >
              <ul className="space-y-3">
                {needsYou.slice(0, 3).map((alert) => (
                  <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn-50 p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{alert.title}</p>
                      <p className="text-xs text-ink-600">{alert.body}</p>
                    </div>
                    <Link href={`/alerts`} className="btn-primary !py-2 text-xs">
                      Decide
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* Cards */}
          <section aria-labelledby="cards-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="cards-heading" className="text-base font-semibold text-ink-900">{t('home.yourCards')}</h2>
              <Link href="/cards" className="text-sm font-semibold text-accent-600 hover:underline">{t('home.seeAll')}</Link>
            </div>
            {cards.length === 0 ? (
              <Skeleton className="h-44 w-72" />
            ) : (
              <div className="rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                {cards.map((card) => (
                  <Link key={card.accountId} href={`/cards?card=${card.accountId}`} className="shrink-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
                    <PaymentCard
                      name={card.name}
                      last4={card.last4}
                      holder={`${session.customer.firstName} ${session.customer.lastName}`}
                      art={card.art}
                      funding={card.funding}
                      locked={card.isLocked}
                      business={card.kind === 'business'}
                    />
                    <p className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-600">
                      <span>{card.availableCents !== null ? `${formatCents(card.availableCents)} available` : card.nickname}</span>
                      {/* Never says "owed" about a debit card: nothing is. */}
                      <span className="font-semibold text-ink-800">
                        {card.funding === 'debit' ? 'Debit' : `${formatCents(card.balanceCents)} owed`}
                      </span>
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* What's coming */}
            <SectionCard
              title={t('home.coming')}
              action={<Link href="/budget" className="text-sm font-semibold text-accent-600 hover:underline">Plan</Link>}
            >
              {data.timeline.length === 0 ? (
                <p className="text-sm text-ink-600">Nothing scheduled in the next few weeks.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.timeline.slice(0, 6).map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2.5">
                      <MerchantMark name={item.label} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{item.label}</p>
                        <p className="text-xs text-ink-500">
                          {formatDate(item.date)} · {relativeDays(item.date)}
                          {item.isFreeTrialConversion && ' · trial ends'}
                        </p>
                      </div>
                      <Money cents={item.amountCents} signed className="text-sm font-semibold" />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* Committed vs free, plus investments */}
            <div className="space-y-4">
              <SectionCard title="This month">
                <div className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="text-ink-700">Committed before payday</span>
                      <span className="font-semibold text-ink-900 tnum">{formatCents(data.safeToSpend.committedCents)}</span>
                    </div>
                    <Progress
                      value={
                        data.safeToSpend.checkingBalanceCents > 0
                          ? data.safeToSpend.committedCents / data.safeToSpend.checkingBalanceCents
                          : 0
                      }
                      tone="ink"
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-surface-sunken p-3">
                      <dt className="text-xs text-ink-500">Subscriptions</dt>
                      <dd className="mt-0.5 font-semibold text-ink-900 tnum">{formatCents(data.subscriptions.monthlyTotalCents)}/mo</dd>
                    </div>
                    <div className="rounded-xl bg-surface-sunken p-3">
                      <dt className="text-xs text-ink-500">Saved by blocking</dt>
                      <dd className="mt-0.5 font-semibold text-accent-600 tnum">{formatCents(data.subscriptions.savedYearlyCents)}/yr</dd>
                    </div>
                  </dl>
                  {data.activePlans.count > 0 && (
                    <p className="text-sm text-ink-700">
                      {data.activePlans.count} payment plan{data.activePlans.count === 1 ? '' : 's'} ·{' '}
                      <strong className="font-semibold">{formatCents(data.activePlans.monthlyTotalCents)}</strong> a month
                    </p>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title={t('home.portfolio')}
                action={<Link href="/invest" className="text-sm font-semibold text-accent-600 hover:underline">Open</Link>}
              >
                <InvestTeaser />
              </SectionCard>
            </div>
          </div>

          <button onClick={() => askOri('What should I do with my money this week?')} className="btn-ghost w-full sm:w-auto">
            Ask Ori what to do this week
          </button>
        </>
      )}
    </div>
  );
}

function InvestTeaser() {
  const [value, setValue] = useState<{ valueCents: number; gainCents: number; dayChangeCents: number } | null>(null);

  useEffect(() => {
    money.invest().then((r) => setValue(r.portfolio)).catch(() => undefined);
  }, []);

  if (!value) return <Skeleton className="h-16" />;
  if (value.valueCents === 0) {
    return (
      <p className="text-sm text-ink-700">
        You haven’t started investing yet. You can begin with <strong className="font-semibold">$1</strong>, or put your points to work.
      </p>
    );
  }
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="font-display text-2xl font-bold text-ink-900 tnum">{formatCents(value.valueCents)}</p>
        <p className="mt-1 text-sm">
          <Money cents={value.gainCents} signed className="font-semibold" /> <span className="text-ink-600">all time</span>
        </p>
      </div>
      <p className="text-sm">
        <Money cents={value.dayChangeCents} signed className="font-semibold" /> <span className="text-ink-500">today</span>
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-32 sm:col-span-2" />
        <Skeleton className="h-32" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-52 w-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
