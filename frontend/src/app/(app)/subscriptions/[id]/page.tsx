'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { api, type SubscriptionDetail } from '@/lib/api';
import { formatCents, formatLongDate, relativeDays, initial, merchantColor } from '@/lib/format';
import { BackLink, Chip, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();

  const [sub, setSub] = useState<SubscriptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .subscription(id)
      .then(setSub)
      .catch((cause: Error) => setError(cause.message));
  }, [id]);

  useEffect(load, [load]);

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    message?: string,
    tone: 'success' | 'warning' = 'success',
  ) => {
    setBusy(key);
    try {
      await action();
      load();
      if (message) toast.show(message, tone);
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'That did not work.', 'error');
    } finally {
      setBusy(null);
    }
  };

  /** Pushes a fake charge through the Guard rules so the outcome is visible. */
  const simulate = async () => {
    setBusy('simulate');
    try {
      const result = (await api.subscriptionAction(id, 'simulate_renewal')) as {
        decision: string;
        allowed: boolean;
        amountCents: number;
      };
      load();

      if (result.allowed) {
        toast.show(`Charge of ${formatCents(result.amountCents)} went through.`, 'success');
      } else if (result.decision === 'decline_pending_approval') {
        toast.show(
          `Declined. ${formatCents(result.amountCents)} is waiting for your decision in Alerts.`,
          'warning',
        );
      } else {
        toast.show(`Declined. ${formatCents(result.amountCents)} was blocked outright.`, 'warning');
      }
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!sub) return <DetailSkeleton />;

  const guarded = sub.status === 'guarded';
  const blocked = sub.status === 'blocked' || sub.status === 'canceled';

  return (
    <div className="space-y-5">
      <BackLink href="/subscriptions" label="All subscriptions" />

      <section className="card p-6">
        <div className="flex items-start gap-4">
          <span
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${merchantColor(sub.merchantName)}`}
            aria-hidden="true"
          >
            {initial(sub.merchantName)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{sub.merchantName}</h1>
              {guarded && <Chip tone="accent">Guarded</Chip>}
              {sub.status === 'blocked' && <Chip tone="danger">Blocked</Chip>}
              {sub.status === 'canceled' && <Chip tone="neutral">Cancelled</Chip>}
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {sub.category} · {sub.frequency} · detected with {Math.round(sub.confidence * 100)}%
              confidence
            </p>
          </div>

          <div className="text-right">
            <p className="text-2xl font-semibold text-ink-900 tnum">{formatCents(sub.amountCents)}</p>
            <p className="text-xs text-ink-600 tnum">{formatCents(sub.yearlyCostCents)}/yr</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <div>
            <dt className="label">Next charge</dt>
            <dd className="mt-1 text-sm font-medium text-ink-900">{formatLongDate(sub.nextChargeDate)}</dd>
            <dd className="text-xs text-ink-600">{relativeDays(sub.nextChargeDate)}</dd>
          </div>
          <div>
            <dt className="label">Paid so far</dt>
            <dd className="mt-1 text-sm font-medium text-ink-900 tnum">
              {formatCents(sub.paidToDateCents)}
            </dd>
            <dd className="text-xs text-ink-600 tnum">across {sub.chargeCount} charges</dd>
          </div>
          <div>
            <dt className="label">Billing</dt>
            <dd className="mt-1 text-sm font-medium text-ink-900">Every {sub.intervalDays} days</dd>
          </div>
          <div>
            <dt className="label">Guard activity</dt>
            <dd className="mt-1 text-sm font-medium text-ink-900 tnum">
              {sub.guardRule ? `${sub.guardRule.declinedCount} declined` : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <CostOverTime sub={sub} />

      {(sub.hasPriceIncrease || sub.isFreeTrial || sub.isDuplicate || sub.looksUnused) && (
        <section className="space-y-2.5">
          {sub.isFreeTrial && (
            <Flag tone="warn" title={`Free trial converts ${relativeDays(sub.nextChargeDate)}`}>
              This is still a trial. Turn on Subscription Guard now and you&rsquo;ll be asked before
              the first real charge of {formatCents(sub.amountCents)} instead of finding out
              afterwards.
            </Flag>
          )}
          {sub.hasPriceIncrease && sub.previousAmountCents && (
            <Flag tone="danger" title="The price went up">
              {sub.merchantName} moved from {formatCents(sub.previousAmountCents)} to{' '}
              {formatCents(sub.amountCents)} — an extra{' '}
              {formatCents((sub.amountCents - sub.previousAmountCents) * 12)} a year.
            </Flag>
          )}
          {sub.isDuplicate && (
            <Flag tone="info" title={`You have another ${sub.category} subscription`}>
              Two services in the same category usually means you&rsquo;re paying twice for the same
              thing.
            </Flag>
          )}
          {sub.looksUnused && (
            <Flag tone="neutral" title="This looks unused">
              You&rsquo;ve paid {formatCents(sub.paidToDateCents)} so far
              {sub.lastUsedAt ? `, and haven't used it since ${formatLongDate(sub.lastUsedAt)}` : ''}.
            </Flag>
          )}
        </section>
      )}

      <section className="card p-6">
        <h2 className="text-sm font-semibold text-ink-900">Take control</h2>
        <p className="mt-1 text-xs text-ink-600">
          Guard and blocking happen at the card level — they work even if you can&rsquo;t cancel on
          the merchant&rsquo;s website.
        </p>

        <div className="mt-4 space-y-3">
          <Control
            title="Ask me first"
            body="Future charges from this merchant are declined and you get an alert to approve or keep blocking."
            active={guarded}
            actionLabel={guarded ? 'Turn off' : 'Turn on'}
            busy={busy === 'guard'}
            onAction={() =>
              run(
                'guard',
                () => api.subscriptionAction(id, guarded ? 'unguard' : 'guard'),
                guarded
                  ? 'Guard turned off. Charges go through normally again.'
                  : 'Guard is on. Charges will be declined until you approve them.',
              )
            }
          />

          <Control
            title="Block permanently"
            body="A card-level block. This merchant can't charge you again, and the saving counts towards Money Saved."
            active={blocked}
            danger
            actionLabel={blocked ? 'Unblock' : 'Block'}
            busy={busy === 'block'}
            onAction={() =>
              run(
                'block',
                () => api.subscriptionAction(id, blocked ? 'unguard' : 'block'),
                blocked ? 'Unblocked.' : 'Blocked. This merchant can no longer charge you.',
              )
            }
          />

          <Control
            title="Replace with a virtual card"
            body={
              sub.virtualCard
                ? 'This merchant has its own card number. Your real card details are never shared with them.'
                : "Give this merchant its own card number, so your real card details are never shared with them."
            }
            active={Boolean(sub.virtualCard)}
            actionLabel={sub.virtualCard ? 'New number' : 'Create'}
            busy={busy === 'vcard'}
            onAction={() =>
              run(
                'vcard',
                () => api.subscriptionAction(id, 'create_virtual_card'),
                sub.virtualCard
                  ? 'New card number issued. The old one no longer works.'
                  : 'Virtual card created.',
              )
            }
          />
        </div>

        {sub.virtualCard && (
          <VirtualCard
            card={sub.virtualCard}
            id={id}
            merchantName={sub.merchantName}
            busy={busy}
            run={run}
          />
        )}
      </section>

      <RemindersCard sub={sub} id={id} busy={busy} run={run} />

      <section className="card border-dashed bg-navy-50/50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Demo mode</h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-600">
              Send a pretend charge from {sub.merchantName} through the Guard rules to see exactly
              what happens.
            </p>
          </div>
          <button onClick={simulate} disabled={busy !== null} className="btn-primary">
            {busy === 'simulate' ? 'Sending…' : 'Simulate renewal'}
          </button>
        </div>
      </section>

      {sub.cancelUrl && (
        <a
          href={sub.cancelUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="card flex items-center justify-between p-5 transition hover:border-ink-300"
        >
          <div>
            <p className="text-sm font-semibold text-ink-900">Cancel on {sub.merchantName}</p>
            <p className="mt-0.5 text-xs text-ink-600">
              Opens the merchant&rsquo;s own cancellation page in a new tab.
            </p>
          </div>
          <span className="text-ink-300" aria-hidden="true">↗</span>
        </a>
      )}
    </div>
  );
}

/** Projects the cost forward over a horizon the user picks. */
function CostOverTime({ sub }: { sub: SubscriptionDetail }) {
  const [years, setYears] = useState(5);

  const projected = sub.yearlyCostCents * years;
  // What it costs in total if you keep it: what's gone plus what's ahead.
  const lifetime = sub.paidToDateCents + projected;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">What this costs you</h2>
        <p className="text-xs text-ink-600">
          {formatCents(sub.amountCents)} {sub.frequency}
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <CostTile
          label="Already paid"
          value={formatCents(sub.paidToDateCents)}
          note={sub.firstChargeDate ? `since ${formatLongDate(sub.firstChargeDate)}` : 'to date'}
        />
        <CostTile
          label="Next 12 months"
          value={formatCents(sub.yearlyCostCents)}
          note="if you keep it"
        />
        <CostTile
          label={`Next ${years} ${years === 1 ? 'year' : 'years'}`}
          value={formatCents(projected)}
          note="at today's price"
          emphasis
        />
      </div>

      {/* Horizon picker. A slider makes the compounding obvious as you drag it. */}
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="horizon" className="label">
            Look ahead
          </label>
          <div className="flex items-center gap-2">
            {[1, 3, 5, 10].map((preset) => (
              <button
                key={preset}
                onClick={() => setYears(preset)}
                aria-pressed={years === preset}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  years === preset
                    ? 'bg-ink-600 text-white'
                    : 'bg-surface-sunken text-ink-600 hover:bg-slate-200'
                }`}
              >
                {preset}y
              </button>
            ))}
          </div>
        </div>

        <input
          id="horizon"
          type="range"
          min={1}
          max={20}
          value={years}
          onChange={(event) => setYears(Number(event.target.value))}
          aria-valuetext={`${years} years`}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-navy-600"
        />
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-400 tnum">
          <span>1 year</span>
          <span>20 years</span>
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2.5 text-xs leading-relaxed text-ink-700">
        Keep {sub.merchantName} for another {years} {years === 1 ? 'year' : 'years'} and it will have
        taken <strong className="font-semibold tnum">{formatCents(lifetime)}</strong> from you in
        total.
      </p>

      {sub.hasPriceIncrease && sub.previousAmountCents && (
        <p className="mt-2.5 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-accent-700">
          The price rise alone accounts for{' '}
          {formatCents((sub.amountCents - sub.previousAmountCents) * 12 * years)} of that — it was{' '}
          {formatCents(sub.previousAmountCents)} before.
        </p>
      )}
    </section>
  );
}

function CostTile({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${emphasis ? 'bg-ink-600 text-white' : 'bg-surface-sunken'}`}>
      <p className={`label ${emphasis ? 'text-ink-100' : ''}`}>{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tnum ${emphasis ? 'text-white' : 'text-ink-900'}`}>
        {value}
      </p>
      <p className={`mt-0.5 text-xs ${emphasis ? 'text-ink-200' : 'text-ink-600'}`}>{note}</p>
    </div>
  );
}

function Flag({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'danger' | 'info' | 'neutral';
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    warn: 'border-warn-300 bg-warn-50/70',
    danger: 'border-accent-200 bg-brand-50/70',
    info: 'border-ink-200 bg-navy-50/70',
    neutral: 'border-line bg-surface-sunken',
  };
  return (
    <div className={`card p-4 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">{children}</p>
    </div>
  );
}

function Control({
  title,
  body,
  active,
  danger,
  actionLabel,
  busy,
  onAction,
}: {
  title: string;
  body: string;
  active: boolean;
  danger?: boolean;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition ${
        active ? 'border-ink-300 bg-navy-50/60' : 'border-line bg-surface'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">
          {title}
          {active && (
            <span className="ml-2 align-middle">
              <Chip tone="accent">On</Chip>
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{body}</p>
      </div>
      <button
        onClick={onAction}
        disabled={busy}
        className={danger && !active ? 'btn-danger' : active ? 'btn-ghost' : 'btn-accent'}
      >
        {busy ? '…' : actionLabel}
      </button>
    </div>
  );
}

function VirtualCard({
  card,
  id,
  merchantName,
  busy,
  run,
}: {
  card: NonNullable<SubscriptionDetail['virtualCard']>;
  id: string;
  merchantName: string;
  busy: string | null;
  run: (
    key: string,
    action: () => Promise<unknown>,
    message?: string,
    tone?: 'success' | 'warning',
  ) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const locked = card.status === 'locked';

  return (
    <div className="mt-4 rounded-2xl bg-ink-700 p-5 text-white">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-200">
          Virtual card
        </p>
        <Chip tone={locked ? 'warn' : 'money'}>{locked ? 'Locked' : 'Active'}</Chip>
      </div>

      <p className="mt-3 font-mono text-lg tracking-[0.15em] tnum">
        {revealed ? card.number.replace(/(.{4})/g, '$1 ').trim() : `•••• •••• •••• ${card.last4}`}
      </p>

      <div className="mt-2 flex gap-5 text-xs text-ink-200">
        <span>
          Exp {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
        </span>
        <span>CVV {revealed ? card.cvv : '•••'}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setRevealed((value) => !value)}
          className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          {revealed ? 'Hide' : 'Show'} number
        </button>

        <button
          onClick={() =>
            run(
              'vclock',
              () => api.setVirtualCardLock(id, !locked),
              locked
                ? 'Card unlocked. Charges can go through again.'
                : 'Card locked. Charges are paused until you unlock it.',
            )
          }
          disabled={busy !== null}
          className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          {locked ? 'Unlock' : 'Lock'}
        </button>

        <button
          onClick={() =>
            run(
              'vcoff',
              () => api.subscriptionAction(id, 'remove_virtual_card'),
              'Virtual card removed. This merchant now uses your real card again.',
            )
          }
          disabled={busy !== null}
          className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          Use my real card
        </button>

        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={busy !== null}
          className="rounded-full bg-accent-500/25 px-3.5 py-1.5 text-xs font-semibold text-accent-100 transition hover:bg-accent-500/40"
        >
          Delete number
        </button>
      </div>

      <dl className="mt-4 space-y-1 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-ink-200">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-ink-100">Lock</dt>
          <dd>Pauses charges. Same number, reversible any time.</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-ink-100">Real card</dt>
          <dd>Stops using a virtual number. The subscription carries on.</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 font-semibold text-ink-100">Delete</dt>
          <dd>Destroys the number for good. You choose what the subscription does next.</dd>
        </div>
      </dl>

      {confirmingDelete && (
        <DeleteCardDialog
          merchantName={merchantName}
          busy={busy !== null}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={(then) => {
            setConfirmingDelete(false);
            void run(
              'vcdelete',
              () => api.deleteVirtualCard(id, then),
              then === 'cancel'
                ? 'Number destroyed and the subscription cancelled.'
                : `Number destroyed. ${merchantName} will bill your real card from now on.`,
              then === 'cancel' ? 'warning' : 'success',
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * Deleting a virtual number and cancelling a subscription are separate
 * decisions. Burning the card so a free trial can't convert, while keeping the
 * option to subscribe properly later, is a normal thing to want — so this asks
 * rather than assuming.
 */
function DeleteCardDialog({
  merchantName,
  busy,
  onCancel,
  onConfirm,
}: {
  merchantName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (then: 'cancel' | 'move_to_real_card') => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-card-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 text-ink-900 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="delete-card-title" className="text-base font-semibold">
          Delete this card number?
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
          The number stops working immediately and can&rsquo;t be recovered. What should happen to
          your {merchantName} subscription?
        </p>

        <div className="mt-5 space-y-2.5">
          <button
            onClick={() => onConfirm('move_to_real_card')}
            disabled={busy}
            className="w-full rounded-xl border border-line p-4 text-left transition hover:border-ink-400 hover:bg-navy-50"
          >
            <span className="block text-sm font-semibold">Keep it, on my real card</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">
              {merchantName} keeps billing you, using your Quicksilver card instead. Use this when
              you want the service but not that number.
            </span>
          </button>

          <button
            onClick={() => onConfirm('cancel')}
            disabled={busy}
            className="w-full rounded-xl border border-accent-200 p-4 text-left transition hover:border-accent-400 hover:bg-brand-50"
          >
            <span className="block text-sm font-semibold text-accent-700">
              Cancel the subscription
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-600">
              Nothing left to charge, so {merchantName} stops. The saving counts towards Money
              Saved. Use this to stop a free trial converting.
            </span>
          </button>
        </div>

        <button onClick={onCancel} className="btn-ghost mt-4 w-full">
          Keep the card
        </button>
      </div>
    </div>
  );
}

const PRESET_DAYS = [1, 3, 7] as const;

const CHANNELS = [
  { value: 'push', label: 'App notification', note: 'Recommended' },
  { value: 'email', label: 'Email', note: '' },
  { value: 'sms', label: 'Text message', note: '' },
] as const;

function RemindersCard({
  sub,
  id,
  busy,
  run,
}: {
  sub: SubscriptionDetail;
  id: string;
  busy: string | null;
  run: (
    key: string,
    action: () => Promise<unknown>,
    message?: string,
    tone?: 'success' | 'warning',
  ) => Promise<void>;
}) {
  const [channel, setChannel] = useState<'push' | 'email' | 'sms'>('push');
  const [custom, setCustom] = useState('');

  const channelLabel = CHANNELS.find((c) => c.value === channel)!.label.toLowerCase();
  const setDays = (days: number) =>
    run(
      `remind${days}`,
      () => api.setReminder(id, days, channel),
      `We'll send you ${channelLabel === 'app notification' ? 'an app notification' : `an ${channelLabel}`} ${days} ${days === 1 ? 'day' : 'days'} before ${sub.merchantName} renews.`,
    );

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-ink-900">Remind me before it renews</h2>

      <fieldset className="mt-4">
        <legend className="label mb-2">How should we tell you?</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((option) => (
            <button
              key={option.value}
              onClick={() => setChannel(option.value)}
              aria-pressed={channel === option.value}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                channel === option.value
                  ? 'border-ink-600 bg-ink-600 text-white'
                  : 'border-line bg-surface text-ink-600 hover:border-ink-300'
              }`}
            >
              {option.label}
              {option.note && (
                <span className={channel === option.value ? 'text-ink-200' : 'text-ink-400'}>
                  {' '}· {option.note}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
          App notifications are the safest option — your bank will never send you a link by text, so
          a text asking you to tap one is exactly what a scam looks like.
        </p>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="label mb-2">When?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_DAYS.map((days) => {
            const set = sub.reminders.some((r) => r.daysBefore === days);
            return (
              <button
                key={days}
                onClick={() => setDays(days)}
                disabled={busy !== null}
                aria-pressed={set}
                className={set ? 'btn-accent' : 'btn-ghost'}
              >
                {set && <span aria-hidden="true">✓</span>} {days} {days === 1 ? 'day' : 'days'} before
              </button>
            );
          })}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const days = Number(custom);
              if (!Number.isInteger(days) || days < 1 || days > 90) return;
              setDays(days);
              setCustom('');
            }}
            className="flex items-center gap-2"
          >
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Custom"
              aria-label="Custom number of days before renewal"
              className="w-24 rounded-full border border-line px-3.5 py-2 text-xs tnum outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20"
            />
            <button type="submit" disabled={!custom || busy !== null} className="btn-ghost">
              Add
            </button>
          </form>
        </div>
      </fieldset>

      {sub.reminders.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
          {[...sub.reminders]
            .sort((a, b) => a.daysBefore - b.daysBefore)
            .map((reminder) => (
              <li
                key={reminder.daysBefore}
                className="flex items-center justify-between text-xs text-ink-600"
              >
                <span>
                  {reminder.daysBefore} {reminder.daysBefore === 1 ? 'day' : 'days'} before ·{' '}
                  {CHANNELS.find((c) => c.value === reminder.channel)?.label ?? reminder.channel}
                </span>
                <button
                  onClick={() =>
                    run(
                      `rm${reminder.daysBefore}`,
                      () => api.clearReminder(id, reminder.daysBefore),
                      'Reminder removed.',
                    )
                  }
                  disabled={busy !== null}
                  className="font-semibold text-accent-600 hover:text-accent-700"
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-52 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
