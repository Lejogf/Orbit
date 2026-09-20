'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type AccountSummary } from '@/lib/api';
import { formatCents, percent } from '@/lib/format';
import { Chip, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function AccountsPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.accounts().then(setAccounts).catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!accounts)
    return (
      <div className="space-y-3">
        <Skeleton className="mb-6 h-9 w-52" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    );

  return (
    <div>
      <PageHeader
        eyebrow={t('nav.accounts')}
        title={t('page.accounts.heading')}
        action={
          <Link href="/transfer" className="btn-ghost">
            Transfer
          </Link>
        }
      />

      <ul className="space-y-3">
        {accounts.map((account) => {
          const utilization =
            account.creditLimitCents && account.creditLimitCents > 0
              ? account.balanceCents / account.creditLimitCents
              : null;

          return (
            <li key={account.id}>
              <Link
                href={`/accounts/${account.id}?from=accounts`}
                className="card group block p-5 transition hover:border-ink-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-ink-900">{account.nickname}</p>
                      {account.isLocked && <Chip tone="danger">Locked</Chip>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {account.type} ···· {account.last4}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-2xl font-semibold tracking-tight text-ink-900 tnum">
                      {formatCents(account.balanceCents)}
                    </p>
                    <p className="text-xs text-ink-600">
                      {account.type === 'Credit Card' ? 'current balance' : 'available'}
                    </p>
                  </div>
                </div>

                {utilization !== null && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-ink-600">
                      <span>
                        {formatCents(account.availableCreditCents ?? 0)} available credit
                      </span>
                      <span className="tnum">{percent(utilization)} used</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          utilization > 0.7 ? 'bg-accent-500' : utilization > 0.3 ? 'bg-warn-500' : 'bg-ink-500'
                        }`}
                        style={{ width: `${Math.min(100, utilization * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {account.rewardsCents !== null && account.rewardsCents > 0 && (
                  <p className="mt-3 inline-block rounded-lg bg-navy-50 px-2.5 py-1 text-xs font-semibold text-ink-700 tnum">
                    {formatCents(account.rewardsCents)} rewards
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
