'use client';

// Pay and get paid.
//
// One screen for the four things people actually do: send money, ask for money,
// pay a bill, and deposit a cheque. Sending is a single form that can also be
// scheduled or repeated — a future payment is the same act, just later.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { money, type PayResponse, type PayeeRow, type Repeat } from '@/lib/api';
import { formatCents, formatDate, relativeDays } from '@/lib/format';
import { Chip, EmptyState, ErrorState, Field, MerchantMark, Money, PageHeader, SectionCard, Segmented, Sheet, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useAccessibility } from '@/lib/accessibility';
import { useT } from '@/lib/i18n';

type Mode = 'send' | 'request' | 'bill' | 'deposit';

/** Phone (10 digits) or email — what a Zelle-style transfer needs. */
function handleError(handle: string): string | null {
  const trimmed = handle.trim();
  if (!trimmed) return 'Enter a mobile number or email.';
  if (trimmed.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(trimmed) ? null : 'That email doesn’t look right.';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 10) return 'A US mobile number has 10 digits.';
  return null;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function PayInner() {
  const t = useT();
  const toast = useToast();
  const params = useSearchParams();
  const { settings } = useAccessibility();

  const [data, setData] = useState<PayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>((params.get('action') as Mode) ?? 'send');
  const [receipt, setReceipt] = useState<{ title: string; amountCents: number; to: string; when: string } | null>(null);

  const load = useCallback(() => {
    setError(null);
    money.pay().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.pay')} title={t('page.pay.title')} subtitle={t('page.pay.subtitle')} />

      <Segmented
        label="What would you like to do?"
        value={mode}
        onChange={setMode}
        options={[
          ['send', t('home.send')],
          ['request', t('home.request')],
          ['bill', 'Pay a bill'],
          ['deposit', 'Deposit'],
        ] as const}
      />

      {!data ? (
        <Skeleton className="h-96" />
      ) : mode === 'deposit' ? (
        <DepositCheck data={data} onDone={load} />
      ) : (
        <SendForm
          data={data}
          mode={mode}
          confirmTwice={settings.confirmMoney}
          onDone={(summary) => {
            load();
            setReceipt(summary);
          }}
        />
      )}

      {data && (
        <>
          {data.upcoming.length > 0 && (
            <SectionCard title="Scheduled">
              <ul className="divide-y divide-line">
                {data.upcoming.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 py-3">
                    <MerchantMark name={payment.payee?.name ?? 'Payment'} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {payment.direction === 'request' ? 'From' : 'To'} {payment.payee?.name}
                      </p>
                      <p className="text-xs text-ink-500">
                        {formatDate(payment.dueDate)} · {relativeDays(payment.dueDate)}
                        {payment.repeat !== 'none' && ` · repeats ${payment.repeat}`}
                        {payment.memo && ` · “${payment.memo}”`}
                      </p>
                    </div>
                    <span className="font-semibold text-ink-900 tnum">{formatCents(payment.amountCents)}</span>
                    <button
                      onClick={async () => {
                        await money.cancelPayment(payment.id);
                        toast.show('Payment cancelled', 'info');
                        load();
                      }}
                      className="text-xs font-semibold text-ink-500 hover:text-danger-600"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {data.deposits.length > 0 && (
            <SectionCard title="Cheque deposits">
              <ul className="divide-y divide-line">
                {data.deposits.map((deposit) => (
                  <li key={deposit.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div>
                      <p className="font-semibold text-ink-900 tnum">{formatCents(deposit.amountCents)}</p>
                      <p className="text-xs text-ink-500">
                        {deposit.status === 'pending' ? `Available ${formatDate(deposit.availableOn)}` : 'In your account'}
                      </p>
                    </div>
                    <Chip tone={deposit.status === 'pending' ? 'warn' : 'accent'}>{deposit.status === 'pending' ? 'On hold' : 'Available'}</Chip>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SectionCard title="Recent activity">
            {data.history.length === 0 ? (
              <p className="text-sm text-ink-600">Nothing yet. Money you send or request will show here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.history.slice(0, 10).map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 py-3">
                    <MerchantMark name={payment.payee?.name ?? 'Payment'} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{payment.payee?.name}</p>
                      <p className="text-xs text-ink-500">
                        {payment.status === 'failed' ? 'Failed — nothing was sent' : payment.direction === 'request' ? 'Requested' : 'Sent'} ·{' '}
                        {formatDate(payment.sentAt ?? payment.createdAt)}
                      </p>
                    </div>
                    {payment.direction === 'request' && payment.status === 'sent' ? (
                      <button
                        onClick={async () => {
                          await money.markReceived(payment.id);
                          toast.show('Marked as paid', 'success');
                          load();
                        }}
                        className="btn-ghost !py-1.5 text-xs"
                      >
                        Mark paid
                      </button>
                    ) : (
                      <Money
                        cents={payment.direction === 'request' ? payment.amountCents : -payment.amountCents}
                        signed
                        className="text-sm font-semibold"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}

      {/* Receipt */}
      <Sheet open={receipt !== null} onClose={() => setReceipt(null)} title="">
        {receipt && (
          <div className="py-4 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent-100">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent-600" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold text-ink-900">{receipt.title}</h2>
            <p className="mt-1 text-sm text-ink-600">{receipt.when}</p>

            <dl className="mt-6 divide-y divide-line rounded-2xl border border-line text-left">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-sm text-ink-600">{t('common.to')}</dt>
                <dd className="text-sm font-semibold text-ink-900">{receipt.to}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-sm text-ink-600">{t('common.amount')}</dt>
                <dd className="font-display text-xl font-bold text-ink-900 tnum">{formatCents(receipt.amountCents)}</dd>
              </div>
            </dl>

            <button onClick={() => setReceipt(null)} className="btn-primary mt-6 w-full">
              {t('common.done')}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function SendForm({
  data,
  mode,
  confirmTwice,
  onDone,
}: {
  data: PayResponse;
  mode: 'send' | 'request' | 'bill';
  confirmTwice: boolean;
  onDone: (summary: { title: string; amountCents: number; to: string; when: string }) => void;
}) {
  const toast = useToast();
  const [payee, setPayee] = useState<PayeeRow | null>(null);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.type === 'Checking')?.id ?? data.accounts[0]?.id ?? '');
  const [when, setWhen] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [errors, setErrors] = useState<{ handle?: string; amount?: string }>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const people = useMemo(
    () => data.payees.filter((p) => (mode === 'bill' ? p.kind === 'biller' : p.kind === 'person')),
    [data.payees, mode],
  );

  const amountCents = Math.round((Number.parseFloat(amount.replace(/[^0-9.]/g, '')) || 0) * 100);
  const account = data.accounts.find((a) => a.id === accountId);
  const isNew = payee === null;

  const submit = async () => {
    const nextErrors: typeof errors = {};
    if (isNew) {
      const problem = handleError(handle);
      if (problem) nextErrors.handle = problem;
      if (!name.trim()) nextErrors.handle = nextErrors.handle ?? 'Enter their name.';
    }
    if (amountCents <= 0) nextErrors.amount = 'Enter an amount.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (confirmTwice && mode !== 'request' && !armed) {
      setArmed(true);
      return;
    }

    setBusy(true);
    try {
      await money.sendMoney({
        payeeId: payee?.id ?? null,
        name: isNew ? name : undefined,
        handle: isNew ? handle : undefined,
        accountId,
        amountCents,
        memo: memo || null,
        direction: mode,
        dueDate: when || null,
        repeat,
      });
      onDone({
        title: mode === 'request' ? 'Request sent' : when ? 'Payment scheduled' : 'Money sent',
        amountCents,
        to: payee?.name ?? name,
        when: when ? `Arrives ${formatDate(when)}` : new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
      });
      setAmount('');
      setMemo('');
      setArmed(false);
      setPayee(null);
      setName('');
      setHandle('');
    } catch (cause) {
      toast.show((cause as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      {/* Contacts you've paid before */}
      {people.length > 0 && (
        <div className="mb-5">
          <p className="label mb-2">Recent</p>
          <div className="rail -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {people.map((person) => (
              <button
                key={person.id}
                onClick={() => {
                  setPayee(person.id === payee?.id ? null : person);
                  setErrors({});
                }}
                aria-pressed={person.id === payee?.id}
                className={`flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-2xl border p-2.5 transition ${
                  person.id === payee?.id ? 'border-ink-900 bg-surface-sunken' : 'border-line hover:bg-surface-sunken'
                }`}
              >
                <MerchantMark name={person.name} size={40} />
                <span className="w-full truncate text-center text-[0.6875rem] font-semibold text-ink-800">{person.name}</span>
              </button>
            ))}
            <button
              onClick={() => setPayee(null)}
              aria-pressed={payee === null}
              className={`flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-2xl border p-2.5 transition ${
                payee === null ? 'border-ink-900 bg-surface-sunken' : 'border-line hover:bg-surface-sunken'
              }`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-100 text-accent-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="text-[0.6875rem] font-semibold text-ink-800">Someone new</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {isNew && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={mode === 'bill' ? 'Company' : 'Their name'} htmlFor="payee-name">
              <input id="payee-name" value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder={mode === 'bill' ? 'City Power' : 'Sam Rivera'} autoComplete="off" />
            </Field>
            <Field
              label={mode === 'bill' ? 'Account number' : 'Mobile number or email'}
              htmlFor="payee-handle"
              error={errors.handle}
              hint={mode === 'bill' ? undefined : 'Both are needed so the money can actually reach them.'}
            >
              <input
                id="payee-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value.includes('@') ? e.target.value : formatPhone(e.target.value))}
                onBlur={() => setErrors((current) => ({ ...current, handle: handleError(handle) ?? undefined }))}
                className="field"
                inputMode={mode === 'bill' ? 'text' : 'tel'}
                placeholder={mode === 'bill' ? '4471-8890' : '(555) 123-4567'}
              />
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="amount" error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-ink-400">$</span>
              <input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="field py-4 pl-10 font-display text-2xl font-bold tnum"
              />
            </div>
          </Field>

          <Field label={mode === 'request' ? 'To your' : 'Pay from'} htmlFor="account">
            <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="field">
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname} ••{a.last4} — {formatCents(a.balanceCents)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Note" htmlFor="memo" hint="They'll see this.">
          <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={140} className="field" placeholder={mode === 'bill' ? 'September bill' : 'Dinner on Friday 🍜'} />
        </Field>

        <details className="rounded-xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-800">Schedule or repeat</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Send on" htmlFor="when" hint="Leave empty to send now.">
              <input id="when" type="date" value={when} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setWhen(e.target.value)} className="field" />
            </Field>
            <Field label="Repeat" htmlFor="repeat">
              <select id="repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className="field">
                <option value="none">Just once</option>
                <option value="weekly">Every week</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
          </div>
        </details>

        {armed && (
          <p role="alert" className="rounded-xl bg-warn-50 px-4 py-3 text-sm font-medium text-warn-800">
            Sending {formatCents(amountCents)} to {payee?.name ?? (name || 'them')} from {account?.nickname}. Tap again to confirm.
          </p>
        )}

        <button onClick={() => void submit()} disabled={busy} className="btn-primary w-full sm:w-auto">
          {busy
            ? 'Working…'
            : armed
              ? `Yes, send ${formatCents(amountCents)}`
              : mode === 'request'
                ? `Request${amountCents ? ` ${formatCents(amountCents)}` : ''}`
                : when
                  ? 'Schedule it'
                  : `Send${amountCents ? ` ${formatCents(amountCents)}` : ''}`}
        </button>

        <p className="text-xs text-ink-500">
          {mode === 'request'
            ? 'Requests go out over Zelle®. Most banks deliver the money in minutes.'
            : 'Sent over Zelle® to the number or email you entered. Only send to people you know — payments cannot be reversed.'}
        </p>
      </div>
    </SectionCard>
  );
}

function DepositCheck({ data, onDone }: { data: PayResponse; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [front, setFront] = useState<{ name: string; url: string } | null>(null);
  const [back, setBack] = useState<{ name: string; url: string } | null>(null);
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.type === 'Checking')?.id ?? '');
  const [busy, setBusy] = useState(false);

  const amountCents = Math.round((Number.parseFloat(amount.replace(/[^0-9.]/g, '')) || 0) * 100);

  const submit = async () => {
    setBusy(true);
    try {
      await money.depositCheck({ accountId, amountCents, frontName: front?.name, backName: back?.name });
      toast.show('Cheque received — we’ll let you know when it clears', 'success');
      setAmount('');
      setFront(null);
      setBack(null);
      onDone();
    } catch (cause) {
      toast.show((cause as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Deposit a cheque">
      <p className="mb-4 text-sm text-ink-700">
        Sign the back, lay it on a dark surface, and photograph both sides. Keep the paper cheque until the money appears.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {([['front', front, setFront], ['back', back, setBack]] as const).map(([side, value, set]) => (
          <label
            key={side}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition ${
              value ? 'border-accent-500 bg-accent-50' : 'border-line hover:border-ink-400 hover:bg-surface-sunken'
            }`}
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) set({ name: file.name, url: URL.createObjectURL(file) });
              }}
            />
            {value ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview, never uploaded
              <img src={value.url} alt={`Cheque ${side}`} className="max-h-28 rounded-lg object-contain" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-sunken text-ink-500">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
            )}
            <span className="text-sm font-semibold text-ink-800">{side === 'front' ? 'Front' : 'Back (signed)'}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Amount on the cheque" htmlFor="check-amount">
          <input id="check-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="field font-display text-xl font-bold tnum" />
        </Field>
        <Field label="Deposit into" htmlFor="check-account">
          <select id="check-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="field">
            {data.accounts.filter((a) => a.type !== 'Credit Card').map((a) => (
              <option key={a.id} value={a.id}>{a.nickname} ••{a.last4}</option>
            ))}
          </select>
        </Field>
      </div>

      <button onClick={() => void submit()} disabled={busy || !front || !back || amountCents <= 0} className="btn-primary mt-4 w-full sm:w-auto">
        {busy ? 'Sending…' : 'Deposit cheque'}
      </button>
      <p className="mt-2 text-xs text-ink-500">
        Cheques are held for two business days before the money is available — the same as at a branch. Limit $5,000 per cheque.
        Photos stay on your device; only the amount is submitted in this demo.
      </p>
    </SectionCard>
  );
}

export default function PayPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PayInner />
    </Suspense>
  );
}
