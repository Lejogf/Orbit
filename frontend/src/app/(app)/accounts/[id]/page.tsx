'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AccountSummary, type Transaction } from '@/lib/api';
import { formatCents, formatDate, initial, merchantColor, percent } from '@/lib/format';
import { BackLink, Chip, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [eligibleOnly, setEligibleOnly] = useState(false);
  /** 0 = this month, 1 = last month, and so on. */
  const [monthOffset, setMonthOffset] = useState(0);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.account(id), api.transactions(id, '?limit=300')])
      .then(([acc, tx]) => {
        setAccount(acc);
        setTransactions(tx);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [id]);

  useEffect(load, [load]);

  /** The calendar month being shown, and the months that actually have activity. */
  const months = useMemo(() => {
    const seen = new Set<string>();
    for (const t of transactions ?? []) seen.add(t.postedAt.slice(0, 7));
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    seen.add(current);
    return [...seen].sort().reverse();
  }, [transactions]);

  const activeMonth = months[Math.min(monthOffset, Math.max(0, months.length - 1))] ?? '';

  const monthLabel = (key: string) =>
    key
      ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : '';

  const categories = useMemo(
    () => [...new Set((transactions ?? []).map((t) => t.category))].sort(),
    [transactions],
  );

  // Filtering happens client-side so typing feels instant; the API supports the
  // same filters for when the history is too large to hold in memory.
  const visible = useMemo(() => {
    if (!transactions) return [];
    const needle = search.trim().toLowerCase();

    return transactions.filter((t) => {
      // A search looks across every month; otherwise one month at a time.
      if (!needle && activeMonth && t.postedAt.slice(0, 7) !== activeMonth) return false;
      if (eligibleOnly && !t.isInstallmentEligible) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (!needle) return true;
      return (
        t.description.toLowerCase().includes(needle) ||
        (t.merchantName?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [transactions, search, category, eligibleOnly, activeMonth]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!account || !transactions) return <Skeleton className="h-96 rounded-2xl" />;

  const isCard = account.type === 'Credit Card';

  return (
    <div className="space-y-5">
      <BackLink href="/accounts" label="All accounts" />

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{account.nickname}</h1>
              {account.isLocked && <Chip tone="danger">Locked</Chip>}
            </div>
            <p className="mt-0.5 text-sm text-ink-600">
              {account.type} ···· {account.last4}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tracking-tight text-ink-900 tnum">
              {formatCents(account.balanceCents)}
            </p>
            {account.availableCreditCents !== null && (
              <p className="text-xs text-ink-600 tnum">
                {formatCents(account.availableCreditCents)} available ·{' '}
                {percent(account.balanceCents / (account.creditLimitCents || 1))} used
              </p>
            )}
          </div>
        </div>
      </section>

      {isCard && <CardControls account={account} onChange={load} />}

      {/* Transactions */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-900">Transactions</h2>

          {/* One month per page, newest first. A search spans every month. */}
          <div className="flex items-center gap-1 rounded-full bg-surface p-1 ring-1 ring-line" role="group" aria-label="Choose month">
            <button
              onClick={() => setMonthOffset((o) => Math.min(months.length - 1, o + 1))}
              disabled={Boolean(search) || monthOffset >= months.length - 1}
              aria-label="Older month"
              className="h-9 w-9 rounded-full text-ink-700 hover:bg-navy-50 disabled:opacity-30"
            >
              ‹
            </button>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold text-ink-900" aria-live="polite">
              {search ? 'All months' : monthLabel(activeMonth)}
            </span>
            <button
              onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
              disabled={Boolean(search) || monthOffset === 0}
              aria-label="Newer month"
              className="h-9 w-9 rounded-full text-ink-700 hover:bg-navy-50 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search merchant or description"
              aria-label="Search transactions"
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none transition focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20"
            />
          </div>

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-800 outline-none focus:border-ink-500"
          >
            <option value="all">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {isCard && (
            <button
              onClick={() => setEligibleOnly((value) => !value)}
              aria-pressed={eligibleOnly}
              className={eligibleOnly ? 'btn-accent' : 'btn-ghost'}
            >
              Splittable only
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : `Nothing in ${monthLabel(activeMonth)}`}
            body={search ? 'Nothing matches those filters.' : 'Use the arrows to look at another month.'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {visible.slice(0, 200).map((transaction) => (
              <li key={transaction.id}>
                <TransactionRow transaction={transaction} />
              </li>
            ))}
          </ul>
        )}

        {visible.length > 100 && (
          <p className="mt-4 text-center text-xs text-ink-600">
            Showing the first 100 of {visible.length}.
          </p>
        )}
      </section>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const name = transaction.merchantName ?? transaction.description;

  const body = (
    <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-surface-sunken">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          transaction.amountCents > 0 ? 'bg-navy-50 text-ink-700' : merchantColor(name)
        }`}
        aria-hidden="true"
      >
        {transaction.amountCents > 0 ? '↓' : initial(name)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{transaction.description}</p>
        <p className="text-xs text-ink-600">
          {formatDate(transaction.postedAt)} · {transaction.category}
        </p>
      </div>

      {transaction.isInstallmentEligible && (
        <span className="hidden sm:block">
          <Chip tone="accent">Split this</Chip>
        </span>
      )}

      <p
        className={`text-sm font-semibold tnum ${
          transaction.amountCents > 0 ? 'text-ink-700' : 'text-ink-900'
        }`}
      >
        {formatCents(transaction.amountCents, { showSign: transaction.amountCents > 0 })}
      </p>
    </div>
  );

  // Only eligible purchases lead anywhere — the plan picker.
  return transaction.isInstallmentEligible ? (
    <Link href={`/plans/new/${transaction.id}?from=accounts`}>{body}</Link>
  ) : (
    body
  );
}

/** Lock/unlock and reveal the card number. */
function CardControls({ account, onChange }: { account: AccountSummary; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ number: string; expiry: string; cvv: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const toast = useToast();

  const toggleLock = async () => {
    setBusy(true);
    const locking = !account.isLocked;
    try {
      await api.lockCard(account.id, locking);
      onChange();
      toast.show(
        locking
          ? 'Card locked. New charges will be declined until you unlock it.'
          : 'Card unlocked. Charges go through normally again.',
        locking ? 'warning' : 'success',
      );
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'Could not change the lock.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (!card) setCard(await api.cardNumber(account.id));
    setRevealed(true);
  };

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-ink-900">Card controls</h2>

      <div
        className={`mt-4 rounded-2xl p-5 text-canvas transition-colors ${
          account.isLocked ? 'bg-ink-900' : 'bg-ink-700'
        }`}
      >
        <div className="flex items-start justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-200">
            {account.nickname}
          </p>
          {account.isLocked && <Chip tone="danger">Locked</Chip>}
        </div>
        <p className="mt-3 font-mono text-lg tracking-[0.15em] tnum">
          {revealed && card ? card.number : `•••• •••• •••• ${account.last4}`}
        </p>
        <div className="mt-2 flex gap-5 text-xs text-ink-200">
          <span>Exp {revealed && card ? card.expiry : '••/••'}</span>
          <span>CVV {revealed && card ? card.cvv : '•••'}</span>
        </div>
        {account.rewardsCents !== null && (
          <p className="mt-4 text-xs text-ink-200 tnum">
            {formatCents(account.rewardsCents)} rewards available
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={reveal} className="btn-ghost">
          {revealed ? 'Hide' : 'Show'} card number
        </button>
        <button onClick={toggleLock} disabled={busy} className={account.isLocked ? 'btn-accent' : 'btn-danger'}>
          {busy ? '…' : account.isLocked ? 'Unlock card' : 'Lock card'}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-sunken p-4">
        <p className="text-xs font-semibold text-ink-900">
          {account.isLocked ? 'This card is locked' : 'What locking does'}
        </p>
        <dl className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-600">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 font-medium text-ink-800">Stops</dt>
            <dd>New purchases, cash advances and balance transfers.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 font-medium text-ink-800">Does not stop</dt>
            <dd>
              Recurring subscription charges you already authorised. That is how card locks work at
              Capital One and most other issuers.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-600">
          To stop a subscription, use{' '}
          <Link
            href="/subscriptions"
            className="font-semibold text-ink-700 underline underline-offset-2 hover:text-ink-900"
          >
            Subscription Guard
          </Link>{' '}
          instead — it works at the merchant level, so it catches the charges a lock lets through.
        </p>
      </div>
    </section>
  );
}
