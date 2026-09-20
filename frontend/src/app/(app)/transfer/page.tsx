'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type AccountSummary } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';

export default function TransferPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .accounts()
      .then((data) => {
        setAccounts(data);
        // Sensible default: out of checking, into the first other account.
        const checking = data.find((a) => a.type === 'Checking');
        setFrom(checking?.id ?? data[0]?.id ?? '');
        setTo(data.find((a) => a.id !== (checking?.id ?? data[0]?.id))?.id ?? '');
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  const amountCents = Math.round(Number(amount.replace(/[^0-9.]/g, '')) * 100);
  const source = accounts?.find((a) => a.id === from);
  const valid =
    from !== '' && to !== '' && from !== to && Number.isFinite(amountCents) && amountCents > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const response = await api.transfer({ fromAccountId: from, toAccountId: to, amountCents });
      setResult(`${formatCents(response.amountCents)} transferred. ${response.description}`);
      setAmount('');
      load();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'The transfer did not go through.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!accounts) return <Skeleton className="h-80 rounded-2xl" />;

  return (
    <div>
      <PageHeader
        eyebrow="Transfer"
        title="Move money between your accounts"
        back={{ href: '/accounts', label: 'Accounts' }}
      />

      <form onSubmit={submit} className="card max-w-lg space-y-4 p-6">
        <div>
          <label htmlFor="from" className="label mb-1.5 block">
            From
          </label>
          <select
            id="from"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
          >
            {accounts
              .filter((a) => a.type !== 'Credit Card')
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname} ···· {account.last4} — {formatCents(account.balanceCents)}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="to" className="label mb-1.5 block">
            To
          </label>
          <select
            id="to"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
          >
            {accounts
              .filter((account) => account.id !== from)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname} ···· {account.last4}
                  {account.type === 'Credit Card' ? ' — pay down balance' : ''}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="amount" className="label mb-1.5 block">
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400">
              $
            </span>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-7 pr-3.5 text-sm tnum outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
            />
          </div>
          {source && (
            <p className="mt-1.5 text-xs text-navy-600 tnum">
              {formatCents(source.balanceCents)} available
            </p>
          )}
        </div>

        <button type="submit" disabled={!valid || busy} className="btn-primary w-full">
          {busy ? 'Transferring…' : 'Transfer'}
        </button>

        {result && (
          <p role="status" className="rounded-xl bg-navy-50 px-4 py-3 text-sm font-medium text-navy-700">
            {result}
          </p>
        )}
        {failure && (
          <p role="alert" className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
            {failure}
          </p>
        )}
      </form>

      <Link href="/accounts" className="mt-4 inline-block text-sm font-medium text-navy-600 hover:text-navy-700">
        ← Back to accounts
      </Link>
    </div>
  );
}
