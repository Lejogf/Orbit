'use client';

// Statements, tax documents, and an export you can actually use.
//
// The CSV is generated here from your real transactions — no server round trip,
// nothing emailed — so it works offline and nothing leaves the device unless
// you save it. The tax forms are listed honestly: a demo cannot issue a real
// 1099, so it says which ones a bank would send and when.
import { useCallback, useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { useToast } from '@/components/Toast';

const YEAR = new Date().getFullYear();

const FORMS = [
  { code: '1099-INT', when: 'By 31 January', what: 'Interest paid on your savings, if it came to $10 or more.' },
  { code: '1099-B', when: 'By 15 February', what: 'Investments you sold, and what they cost you.' },
  { code: '1098', when: 'By 31 January', what: 'Mortgage interest, if you hold one with us.' },
];

export function Documents() {
  const toast = useToast();
  const [summary, setSummary] = useState<{ sold: number; invested: number; interest: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    money
      .invest()
      .then((r) => {
        const yearStart = new Date(YEAR, 0, 1).toISOString();
        const trades = r.trades.filter((t) => t.createdAt >= yearStart);
        setSummary({
          sold: trades.filter((t) => t.side === 'sell').reduce((s, t) => s + t.amountCents, 0),
          invested: trades.filter((t) => t.side === 'buy').reduce((s, t) => s + t.amountCents, 0),
          // Savings interest isn't modelled in this build; shown as zero rather than invented.
          interest: 0,
        });
      })
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const accounts = await api.accounts();
      const rows: string[] = ['Date,Account,Description,Category,Amount'];
      for (const account of accounts) {
        const transactions = await api.transactions(account.id, '?limit=500');
        for (const tx of transactions) {
          // Quote every field: merchant names contain commas.
          const cells = [
            tx.postedAt.slice(0, 10),
            account.nickname,
            tx.merchantName ?? tx.description,
            tx.category,
            (tx.amountCents / 100).toFixed(2),
          ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`);
          rows.push(cells.join(','));
        }
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orbit-transactions-${YEAR}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.show(`${rows.length - 1} transactions exported`, 'success');
    } catch (cause) {
      toast.show((cause as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold text-ink-900">Documents & tax</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">
        Everything you need at tax time, and a full export for your accountant or your own spreadsheet.
      </p>

      {summary && (
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {[
            ['Invested this year', formatCents(summary.invested)],
            ['Investments sold', formatCents(summary.sold)],
            ['Interest earned', formatCents(summary.interest)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-sunken p-3">
              <dt className="text-[0.6875rem] text-ink-500">{label}</dt>
              <dd className="mt-0.5 font-semibold text-ink-900 tnum">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <button onClick={() => void exportCsv()} disabled={busy} className="btn-ghost mt-4">
        {busy ? 'Preparing…' : `Export ${YEAR} transactions (CSV)`}
      </button>

      <h3 className="mt-6 text-sm font-semibold text-ink-900">Forms you’d receive</h3>
      <ul className="mt-2 divide-y divide-line">
        {FORMS.map((form) => (
          <li key={form.code} className="flex items-start justify-between gap-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink-900">{form.code}</p>
              <p className="text-xs text-ink-600">{form.what}</p>
            </div>
            <span className="shrink-0 text-xs text-ink-500">{form.when}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-500">
        This is a demo, so no real tax documents are issued. Selling an investment can create a tax bill — worth knowing before
        you sell, not after.
      </p>
    </section>
  );
}
