'use client';

// Cards: the ones you hold, and the ones you could hold.
//
// Every card states the same two things first — what it pays back and what it
// costs — because that is what people actually compare. The recommendation
// explains its own reasoning, including when a fee would not pay for itself.
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, money, type CardCatalogueEntry, type CardsResponse, type HeldCard } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { Chip, ErrorState, PageHeader, Progress, SectionCard, Segmented, Sheet, Skeleton } from '@/components/ui';
import { PaymentCard } from '@/components/PaymentCard';
import { useSession } from '@/components/AuthGuard';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

function CardsInner() {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();
  const { session } = useSession();

  const [data, setData] = useState<CardsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get('card'));
  const [kind, setKind] = useState<'personal' | 'business'>('personal');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<CardCatalogueEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    money.cards().then((response) => {
      setData(response);
      setSelected((current) => current ?? response.cards[0]?.accountId ?? null);
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <CardsSkeleton />;

  const card = data.cards.find((c) => c.accountId === selected) ?? data.cards[0] ?? null;
  const holder = `${session.customer.firstName} ${session.customer.lastName}`;

  const toggleLock = async (target: HeldCard) => {
    await api.lockCard(target.accountId, !target.isLocked);
    toast.show(target.isLocked ? 'Card unlocked' : 'Card locked — new purchases will be declined', 'success');
    load();
  };

  const reveal = async (target: HeldCard) => {
    if (revealed[target.accountId]) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[target.accountId];
        return next;
      });
      return;
    }
    const details = await api.cardNumber(target.accountId);
    setRevealed((current) => ({ ...current, [target.accountId]: details.number }));
  };

  const apply = async (entry: CardCatalogueEntry) => {
    setBusy(true);
    try {
      await money.openCard(entry.id);
      toast.show(`${entry.name} approved — your digital card works right now`, 'success');
      setApplying(null);
      load();
    } catch (cause) {
      toast.show((cause as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const offers = data.catalogue.filter((entry) => entry.kind === kind && !entry.held);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.cards')} title={t('page.cards.title')} subtitle={t('page.cards.subtitle')} />

      {/* Wallet */}
      {data.cards.length > 0 && (
        <section aria-label="Your cards">
          <div className="rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {data.cards.map((held) => (
              <button
                key={held.accountId}
                onClick={() => setSelected(held.accountId)}
                aria-pressed={held.accountId === card?.accountId}
                className={`shrink-0 rounded-2xl transition-opacity ${held.accountId === card?.accountId ? '' : 'opacity-60 hover:opacity-100'}`}
              >
                <PaymentCard
                  name={held.name}
                  last4={held.last4}
                  holder={holder}
                  art={held.art}
                  locked={held.isLocked}
                  business={held.kind === 'business'}
                  revealedNumber={revealed[held.accountId] ?? null}
                  size="lg"
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* The selected card */}
      {card && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title={card.name}>
            <p className="text-sm leading-relaxed text-ink-700">{card.tagline}</p>

            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-sunken p-3">
                <dt className="text-xs text-ink-500">Balance</dt>
                <dd className="mt-0.5 font-display text-lg font-bold text-ink-900 tnum">{formatCents(card.balanceCents)}</dd>
              </div>
              <div className="rounded-xl bg-surface-sunken p-3">
                <dt className="text-xs text-ink-500">Available</dt>
                <dd className="mt-0.5 font-display text-lg font-bold text-ink-900 tnum">
                  {card.availableCents !== null ? formatCents(card.availableCents) : '—'}
                </dd>
              </div>
            </dl>

            {card.creditLimitCents !== null && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-ink-600">Credit used</span>
                  <span className="font-semibold text-ink-800 tnum">
                    {Math.round((card.balanceCents / card.creditLimitCents) * 100)}% of {formatCents(card.creditLimitCents)}
                  </span>
                </div>
                <Progress
                  value={card.balanceCents / card.creditLimitCents}
                  tone={card.balanceCents / card.creditLimitCents > 0.3 ? 'warn' : 'accent'}
                />
                <p className="mt-1.5 text-xs text-ink-500">Staying under 30% helps your credit score.</p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={() => void toggleLock(card)} className={card.isLocked ? 'btn-accent' : 'btn-ghost'}>
                {card.isLocked ? 'Unlock card' : 'Lock card'}
              </button>
              <button onClick={() => void reveal(card)} className="btn-ghost">
                {revealed[card.accountId] ? 'Hide number' : 'Show number'}
              </button>
              <Link href={`/accounts/${card.accountId}?from=cards`} className="btn-ghost">
                Transactions
              </Link>
              {!card.physicalOrderedAt ? (
                <button
                  onClick={async () => {
                    await money.orderPhysical(card.accountId);
                    toast.show('Physical card ordered — it arrives in 5–7 days', 'success');
                    load();
                  }}
                  className="btn-ghost"
                >
                  Order physical card
                </button>
              ) : (
                <Chip tone="accent">Physical card on its way</Chip>
              )}
            </div>
          </SectionCard>

          <SectionCard title="What this card earns">
            <ul className="space-y-2">
              {card.earn.map((rule) => (
                <li key={rule.category} className="flex items-center justify-between gap-3 rounded-xl bg-surface-sunken px-3.5 py-2.5">
                  <span className="text-sm text-ink-800">{rule.label}</span>
                  <span className="font-display text-sm font-bold text-accent-600">{rule.rate}x</span>
                </li>
              ))}
            </ul>

            <h3 className="mt-5 text-sm font-semibold text-ink-900">Included</h3>
            <ul className="mt-2 space-y-1.5">
              {card.perks.map((perk) => (
                <li key={perk} className="flex gap-2 text-sm text-ink-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                  {perk}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-ink-500">
              {card.annualFeeCents === 0 ? 'No annual fee.' : `${formatCents(card.annualFeeCents)} a year.`} Points are worth{' '}
              <Link href="/rewards" className="font-semibold underline">100 points = $1</Link>, always.
            </p>
          </SectionCard>
        </div>
      )}

      {/* Recommendation */}
      {data.recommendation && (
        <section className="rounded-2xl border border-accent-300 bg-accent-50 p-5">
          <p className="label text-accent-700">Suggested for you</p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink-900">
            {data.catalogue.find((c) => c.id === data.recommendation!.productId)?.name}
          </h2>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-700">{data.recommendation.reason}</p>
          <button
            onClick={() => setApplying(data.catalogue.find((c) => c.id === data.recommendation!.productId) ?? null)}
            className="btn-accent mt-4"
          >
            See the card
          </button>
        </section>
      )}

      {/* The line-up */}
      <section aria-labelledby="lineup-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="lineup-heading" className="text-base font-semibold text-ink-900">The rest of the line-up</h2>
          <Segmented
            label="Card type"
            value={kind}
            onChange={setKind}
            size="sm"
            options={[
              ['personal', 'Personal'],
              ['business', 'Business'],
            ] as const}
          />
        </div>

        {offers.length === 0 ? (
          <p className="text-sm text-ink-600">You already hold every card in this line-up.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {offers.map((entry) => (
              <li key={entry.id} className="card flex flex-col gap-4 p-5">
                <PaymentCard name={entry.name} last4="0000" holder={holder} art={entry.art} size="sm" business={entry.kind === 'business'} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-bold text-ink-900">{entry.name}</h3>
                    {entry.annualFeeCents === 0 ? <Chip tone="accent">No annual fee</Chip> : <Chip tone="neutral">{formatCents(entry.annualFeeCents)}/yr</Chip>}
                  </div>
                  <p className="mt-1 text-sm text-ink-700">{entry.tagline}</p>
                  <ul className="mt-3 space-y-1">
                    {entry.earn.slice(0, 3).map((rule) => (
                      <li key={rule.category} className="text-sm text-ink-700">
                        <span className="font-semibold text-accent-600">{rule.rate}x</span> {rule.label.replace(/^\d+(\.\d+)?% back on /, '')}
                      </li>
                    ))}
                  </ul>
                  {entry.eligibility && (
                    <p className={`mt-3 text-xs leading-relaxed ${entry.eligibility.eligible ? 'text-ink-600' : 'text-warn-700'}`}>
                      {entry.eligibility.reason}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setApplying(entry)}
                  disabled={entry.eligibility ? !entry.eligibility.eligible : false}
                  className="btn-primary w-full"
                >
                  {entry.eligibility?.eligible === false ? 'Not available yet' : 'Apply'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={applying !== null}
        onClose={() => setApplying(null)}
        title={applying ? `Apply for ${applying.name}` : ''}
        footer={
          applying && (
            <div className="flex gap-2">
              <button onClick={() => void apply(applying)} disabled={busy} className="btn-primary flex-1">
                {busy ? 'Opening…' : 'Open this card'}
              </button>
              <button onClick={() => setApplying(null)} className="btn-ghost">
                Not now
              </button>
            </div>
          )
        }
      >
        {applying && (
          <div className="space-y-4">
            <PaymentCard name={applying.name} last4="0000" holder={holder} art={applying.art} business={applying.kind === 'business'} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-sunken p-3">
                <dt className="text-xs text-ink-500">Annual fee</dt>
                <dd className="mt-0.5 font-semibold text-ink-900">{applying.annualFeeCents === 0 ? 'None' : formatCents(applying.annualFeeCents)}</dd>
              </div>
              <div className="rounded-xl bg-surface-sunken p-3">
                <dt className="text-xs text-ink-500">Typical starting limit</dt>
                <dd className="mt-0.5 font-semibold text-ink-900">{formatCents(applying.startingLimitCents)}</dd>
              </div>
            </dl>
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Earning</h3>
              <ul className="mt-2 space-y-1.5">
                {applying.earn.map((rule) => (
                  <li key={rule.category} className="text-sm text-ink-700">
                    <span className="font-semibold text-accent-600">{rule.rate}x</span> — {rule.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Included</h3>
              <ul className="mt-2 space-y-1.5">
                {applying.perks.map((perk) => (
                  <li key={perk} className="text-sm text-ink-700">{perk}</li>
                ))}
              </ul>
            </div>
            <p className="rounded-xl bg-surface-sunken px-3.5 py-3 text-xs leading-relaxed text-ink-600">
              This is a demo: no credit check is run and no real account is opened. In a real application we would check your credit,
              which can affect your score.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-52 w-[21rem]" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function CardsPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <CardsInner />
    </Suspense>
  );
}
