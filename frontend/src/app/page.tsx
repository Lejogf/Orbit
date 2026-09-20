'use client';

// Sign in, register, or take the demo account.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiRequestError, auth } from '@/lib/api';

type Mode = 'signin' | 'register';

export default function LandingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [demo, setDemo] = useState<{ email: string; password: string } | null>(null);

  // Already signed in? Skip the form.
  useEffect(() => {
    auth
      .me()
      .then(() => router.replace('/dashboard'))
      .catch(() => undefined);

    auth
      .demoCredentials()
      .then(setDemo)
      .catch(() => undefined);
  }, [router]);

  const handle = async (label: string, action: () => Promise<{ hasBankingData: boolean }>) => {
    setBusy(label);
    setError(null);
    try {
      const result = await action();
      router.push(result.hasBankingData ? '/dashboard' : '/welcome');
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        setError({ message: cause.message, field: cause.field });
      } else {
        setError({ message: 'Something went wrong. Try again.', field: null });
      }
      setBusy(null);
    }
  };

  const signIn = (form: FormData) =>
    handle('signin', () =>
      auth.login(String(form.get('email') ?? ''), String(form.get('password') ?? '')),
    );

  const register = (form: FormData) =>
    handle('register', () =>
      auth.register({
        firstName: String(form.get('firstName') ?? ''),
        lastName: String(form.get('lastName') ?? ''),
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        phone: String(form.get('phone') ?? '') || undefined,
        dateOfBirth: String(form.get('dateOfBirth') ?? '') || undefined,
      }),
    );

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on phones so the form gets the whole screen. */}
      <section className="relative hidden overflow-hidden bg-navy-800 p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-navy-500/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-200">
            Capital One
          </span>
          <span className="text-4xl font-semibold tracking-tight text-white">Flow</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white">
            Most of your money is spent before you wake up.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-navy-200">
            Flow finds every subscription and instalment hiding in your statement, then puts you
            back in charge of them.
          </p>
        </div>

        <dl className="relative grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
          {[
            ['10', 'subscriptions found'],
            ['4', 'need attention'],
            ['$2,815', 'committed a year'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="text-2xl font-semibold text-white tnum">{value}</dt>
              <dd className="mt-1 text-xs leading-snug text-navy-200">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-500">
              Capital One
            </span>
            <span className="text-3xl font-semibold tracking-tight text-navy-800">Flow</span>
          </div>

          {/* Mode switch */}
          <div className="mb-6 flex rounded-full border border-slate-200 bg-white p-1" role="tablist">
            {(['signin', 'register'] as Mode[]).map((option) => (
              <button
                key={option}
                role="tab"
                aria-selected={mode === option}
                onClick={() => {
                  setMode(option);
                  setError(null);
                }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  mode === option ? 'bg-navy-600 text-white' : 'text-navy-600 hover:text-navy-800'
                }`}
              >
                {option === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700"
            >
              {error.message}
            </p>
          )}

          {mode === 'signin' ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn(new FormData(event.currentTarget));
              }}
            >
              <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={demo?.email}
                invalid={error?.field === 'email'}
                required
              />
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue={demo?.password}
                invalid={error?.field === 'password'}
                required
              />
              <button type="submit" className="btn-primary w-full" disabled={busy !== null}>
                {busy === 'signin' ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void register(new FormData(event.currentTarget));
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" name="firstName" invalid={error?.field === 'firstName'} required />
                <Field label="Last name" name="lastName" invalid={error?.field === 'lastName'} required />
              </div>
              <Field
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                invalid={error?.field === 'email'}
                required
              />
              <Field
                label="Password"
                name="password"
                type="password"
                autoComplete="new-password"
                hint="At least 10 characters."
                invalid={error?.field === 'password'}
                required
              />
              <Field label="Phone" name="phone" type="tel" autoComplete="tel" optional />
              <Field
                label="Date of birth"
                name="dateOfBirth"
                type="date"
                hint="You must be 18 or over."
                invalid={error?.field === 'dateOfBirth'}
                optional
              />
              <button type="submit" className="btn-primary w-full" disabled={busy !== null}>
                {busy === 'register' ? 'Creating account…' : 'Create account'}
              </button>
              <p className="text-[11px] leading-relaxed text-navy-600">
                A demo build — don&rsquo;t use a real password. No identity checks are performed and
                no real accounts are opened.
              </p>
            </form>
          )}

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-navy-400">or</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            onClick={() => void handle('demo', auth.demo)}
            disabled={busy !== null}
            className="btn-ghost w-full"
          >
            {busy === 'demo' ? 'Opening…' : 'Explore the demo account'}
          </button>

          {demo && (
            <p className="mt-4 rounded-xl bg-navy-50 px-4 py-3 text-xs leading-relaxed text-navy-600">
              Demo sign-in: <span className="font-mono">{demo.email}</span> /{' '}
              <span className="font-mono">{demo.password}</span>. Jordan Rivera&rsquo;s account, with
              six months of history.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type = 'text',
  hint,
  optional,
  invalid,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
  optional?: boolean;
  invalid?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="label mb-1.5 flex items-baseline justify-between">
        <span>{label}</span>
        {optional && <span className="font-normal normal-case tracking-normal text-navy-400">Optional</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        aria-invalid={invalid || undefined}
        className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-navy-900 outline-none transition focus:ring-2 ${
          invalid
            ? 'border-brand-400 focus:border-brand-500 focus:ring-brand-500/20'
            : 'border-slate-200 focus:border-navy-500 focus:ring-navy-500/20'
        }`}
        {...rest}
      />
      {hint && <p className="mt-1 text-[11px] text-navy-500">{hint}</p>}
    </div>
  );
}
