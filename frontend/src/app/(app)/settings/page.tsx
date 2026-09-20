'use client';

// Account settings.
//
// Split deliberately into what you can change yourself and what you can't.
// Legal name, date of birth and SSN are what the account was opened and
// identity-checked against, so a bank cannot let them be edited from a settings
// page. Showing them greyed out with the reason is more honest than hiding them.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiRequestError, auth, type Preferences, type Profile } from '@/lib/api';
import { formatCents, formatLongDate } from '@/lib/format';
import { PageHeader, Skeleton } from '@/components/ui';
import { useSession } from '@/components/AuthGuard';
import { useToast } from '@/components/Toast';

export default function SettingsPage() {
  const { session, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const { customer, preferences } = session;

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await action();
      await refresh();
      toast.show(message, 'success');
      return true;
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'That did not work.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('logout');
    try {
      await auth.logout();
      router.push('/');
    } catch {
      toast.show('Could not sign out. Try again.', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Account settings" />

      <ContactDetails customer={customer} busy={busy} run={run} />
      <LockedDetails customer={customer} />
      <SecuritySection busy={busy} run={run} onSignedOutEverywhere={() => router.push('/')} />
      <NotificationSection preferences={preferences} busy={busy} run={run} />

      <section className="card p-6">
        <h2 className="text-sm font-semibold text-navy-900">Session</h2>
        <p className="mt-1 text-xs text-navy-600">
          Signed in as {customer.email}. Member since {formatLongDate(customer.memberSince)}.
        </p>
        <button onClick={signOut} disabled={busy !== null} className="btn-ghost mt-4">
          {busy === 'logout' ? 'Signing out…' : 'Sign out'}
        </button>
      </section>

      <CloseAccountSection customer={customer} onClosed={() => router.push('/')} />
    </div>
  );
}

type Runner = (key: string, action: () => Promise<unknown>, message: string) => Promise<boolean>;

function ContactDetails({
  customer,
  busy,
  run,
}: {
  customer: Profile;
  busy: string | null;
  run: Runner;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <section className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Contact details</h2>
            <p className="mt-1 text-xs text-navy-600">Where we reach you about your account.</p>
          </div>
          <button onClick={() => setEditing(true)} className="btn-ghost">
            Edit
          </button>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Detail label="Email" value={customer.email} />
          <Detail label="Phone" value={customer.phone ?? 'Not set'} />
          <Detail
            label="Mailing address"
            value={
              customer.address.line1
                ? [
                    customer.address.line1,
                    customer.address.line2,
                    [customer.address.city, customer.address.state, customer.address.postalCode]
                      .filter(Boolean)
                      .join(' '),
                  ]
                    .filter(Boolean)
                    .join(', ')
                : 'Not set'
            }
          />
        </dl>
      </section>
    );
  }

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-navy-900">Edit contact details</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const ok = await run(
            'contact',
            () =>
              auth.updateProfile({
                email: String(form.get('email') ?? ''),
                phone: String(form.get('phone') ?? '') || null,
                addressLine1: String(form.get('addressLine1') ?? '') || null,
                addressLine2: String(form.get('addressLine2') ?? '') || null,
                city: String(form.get('city') ?? '') || null,
                state: String(form.get('state') ?? '') || null,
                postalCode: String(form.get('postalCode') ?? '') || null,
              }),
            'Contact details updated.',
          );
          if (ok) setEditing(false);
        }}
      >
        <Input label="Email" name="email" type="email" defaultValue={customer.email} required />
        <Input label="Phone" name="phone" type="tel" defaultValue={customer.phone ?? ''} />
        <Input label="Address" name="addressLine1" defaultValue={customer.address.line1 ?? ''} />
        <Input
          label="Apartment, suite, etc."
          name="addressLine2"
          defaultValue={customer.address.line2 ?? ''}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input label="City" name="city" defaultValue={customer.address.city ?? ''} />
          <Input label="State" name="state" defaultValue={customer.address.state ?? ''} />
          <Input label="ZIP" name="postalCode" defaultValue={customer.address.postalCode ?? ''} />
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={busy !== null} className="btn-primary">
            {busy === 'contact' ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="btn-ghost">
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function LockedDetails({ customer }: { customer: Profile }) {
  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-navy-900">Identity</h2>
      <p className="mt-1 text-xs leading-relaxed text-navy-600">
        These are what your account was opened and identity-checked against, so they can&rsquo;t be
        changed here. Call us on the number on the back of your card if any of them are wrong.
      </p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail label="Legal name" value={`${customer.firstName} ${customer.lastName}`} locked />
        <Detail
          label="Date of birth"
          value={customer.dateOfBirth ? formatLongDate(customer.dateOfBirth) : 'Not on file'}
          locked
        />
        <Detail
          label="Social Security number"
          value={customer.ssnLast4 ? `•••-••-${customer.ssnLast4}` : 'Not on file'}
          locked
        />
        <Detail label="Credit score" value={String(customer.creditScore)} locked />
      </dl>
    </section>
  );
}

function SecuritySection({
  busy,
  run,
  onSignedOutEverywhere,
}: {
  busy: string | null;
  run: Runner;
  onSignedOutEverywhere: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const toast = useToast();

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-navy-900">Security</h2>

      {changing ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const next = String(form.get('newPassword') ?? '');
            if (next !== String(form.get('confirmPassword') ?? '')) {
              toast.show("Those passwords don't match.", 'error');
              return;
            }
            const ok = await run(
              'password',
              () => auth.changePassword(String(form.get('currentPassword') ?? ''), next),
              'Password changed. You were signed out everywhere else.',
            );
            if (ok) setChanging(false);
          }}
        >
          <Input label="Current password" name="currentPassword" type="password" required />
          <Input
            label="New password"
            name="newPassword"
            type="password"
            hint="At least 10 characters."
            required
          />
          <Input label="Confirm new password" name="confirmPassword" type="password" required />
          <div className="flex gap-2">
            <button type="submit" disabled={busy !== null} className="btn-primary">
              {busy === 'password' ? 'Changing…' : 'Change password'}
            </button>
            <button type="button" onClick={() => setChanging(false)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          <Row
            title="Password"
            body="Changing it signs you out on every other device."
            action={
              <button onClick={() => setChanging(true)} className="btn-ghost">
                Change
              </button>
            }
          />
          <Row
            title="Sign out everywhere"
            body="Ends every session, including this one. Use it if you've signed in somewhere you don't trust."
            action={
              <button
                onClick={async () => {
                  const ok = await run(
                    'everywhere',
                    () => auth.signOutEverywhere(),
                    'Signed out on every device.',
                  );
                  if (ok) onSignedOutEverywhere();
                }}
                disabled={busy !== null}
                className="btn-ghost"
              >
                Sign out
              </button>
            }
          />
        </div>
      )}
    </section>
  );
}

function NotificationSection({
  preferences,
  busy,
  run,
}: {
  preferences: Preferences | null;
  busy: string | null;
  run: Runner;
}) {
  if (!preferences) return <Skeleton className="h-48 rounded-2xl" />;

  const toggle = (key: keyof Preferences, label: string) => (
    <Toggle
      key={key}
      checked={Boolean(preferences[key])}
      disabled={busy !== null}
      label={label}
      onChange={(next) =>
        void run('prefs', () => auth.updatePreferences({ [key]: next }), 'Preferences updated.')
      }
    />
  );

  return (
    <section className="card p-6">
      <h2 className="text-sm font-semibold text-navy-900">Notifications</h2>
      <p className="mt-1 text-xs leading-relaxed text-navy-600">
        How we tell you about charges, trials and price rises.
      </p>

      <div className="mt-4 space-y-1">
        {toggle('alertsPush', 'App notifications')}
        {toggle('alertsEmail', 'Email')}
        {toggle('alertsSms', 'Text message')}
      </div>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-navy-500">
        Everything else
      </h3>
      <div className="mt-2 space-y-1">
        {toggle('paperless', 'Paperless statements')}
        {toggle('marketingEmail', 'Product news and offers')}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <label htmlFor="lowBalance" className="label mb-1.5 block">
          Warn me when Safe to Spend drops below
        </label>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400">
              $
            </span>
            <input
              id="lowBalance"
              inputMode="decimal"
              defaultValue={
                preferences.lowBalanceThresholdCents
                  ? (preferences.lowBalanceThresholdCents / 100).toFixed(0)
                  : ''
              }
              placeholder="0"
              onBlur={(event) => {
                const raw = event.target.value.replace(/[^0-9.]/g, '');
                const cents = raw ? Math.round(Number(raw) * 100) : null;
                if (cents === preferences.lowBalanceThresholdCents) return;
                void run(
                  'prefs',
                  () => auth.updatePreferences({ lowBalanceThresholdCents: cents }),
                  cents === null ? 'Low balance warning off.' : `We'll warn you below ${formatCents(cents)}.`,
                );
              }}
              className="w-32 rounded-xl border border-slate-200 py-2 pl-7 pr-3 text-sm tnum outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
            />
          </div>
          <span className="text-xs text-navy-500">Leave blank to turn it off.</span>
        </div>
      </div>
    </section>
  );
}

function CloseAccountSection({ customer, onClosed }: { customer: Profile; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const check = async () => {
    setBusy(true);
    try {
      const result = await auth.closureCheck();
      setBlockers(result.blockers);
      setOpen(true);
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'Could not check.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card border-brand-200 p-6">
      <h2 className="text-sm font-semibold text-navy-900">Close your account</h2>
      <p className="mt-1 text-xs leading-relaxed text-navy-600">
        Closing is permanent. We keep your transaction history because financial records have to
        outlive the account, but you won&rsquo;t be able to sign in again.
      </p>

      {!open ? (
        <button onClick={check} disabled={busy} className="btn-danger mt-4">
          {busy ? 'Checking…' : 'Close account'}
        </button>
      ) : blockers && blockers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-navy-900">Not yet — sort these out first</p>
          <ul className="mt-2 space-y-1.5 text-sm text-navy-700">
            {blockers.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => setOpen(false)} className="btn-ghost mt-4">
            Close this
          </button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            try {
              await auth.closeAccount(
                String(form.get('password') ?? ''),
                String(form.get('confirmation') ?? ''),
              );
              toast.show('Your account has been closed.', 'warning');
              onClosed();
            } catch (cause) {
              if (cause instanceof ApiRequestError && cause.blockers.length > 0) {
                setBlockers(cause.blockers);
              } else {
                toast.show(cause instanceof Error ? cause.message : 'Could not close.', 'error');
              }
              setBusy(false);
            }
          }}
        >
          {customer.isDemoUser && (
            <p className="rounded-lg bg-white px-3 py-2 text-xs text-navy-700">
              The demo account can&rsquo;t be closed — other people need it. Register your own
              account to try this.
            </p>
          )}
          <Input label="Your password" name="password" type="password" required />
          <Input
            label={'Type "CLOSE MY ACCOUNT" to confirm'}
            name="confirmation"
            placeholder="CLOSE MY ACCOUNT"
            required
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-danger">
              {busy ? 'Closing…' : 'Close my account permanently'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
              Keep my account
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// --- small pieces ---

function Detail({ label, value, locked }: { label: string; value: string; locked?: boolean }) {
  return (
    <div>
      <dt className="label flex items-center gap-1.5">
        {label}
        {locked && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3"
               aria-label="Cannot be changed here">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 1 1 8 0v3" />
          </svg>
        )}
      </dt>
      <dd className={`mt-1 text-sm ${locked ? 'text-navy-500' : 'font-medium text-navy-900'}`}>
        {value}
      </dd>
    </div>
  );
}

function Row({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-navy-600">{body}</p>
      </div>
      {action}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg px-1 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-60"
    >
      <span className="text-sm text-navy-800">{label}</span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-navy-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Input({
  label,
  name,
  hint,
  ...rest
}: { label: string; name: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="label mb-1.5 block">
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
        {...rest}
      />
      {hint && <p className="mt-1 text-[11px] text-navy-500">{hint}</p>}
    </div>
  );
}
