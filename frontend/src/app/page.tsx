'use client';

// The way in: sign in, or open an account.
//
// One promise, stated plainly, over a moving field of light — then the form,
// because people arriving here already know what they came to do.
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiRequestError, auth } from '@/lib/api';
import { OrbitWordmark } from '@/components/brand';
import { QuickDisplay } from '@/components/QuickDisplay';

type Mode = 'signin' | 'open';
type AccountKind = 'personal' | 'business';

function LandingInner() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [kind, setKind] = useState<AccountKind>('personal');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [demo, setDemo] = useState<{ email: string; username: string; password: string } | null>(null);

  useEffect(() => {
    auth.me().then(() => router.replace('/dashboard')).catch(() => undefined);
    auth.demoCredentials().then(setDemo).catch(() => undefined);
  }, [router]);

  const handle = async (label: string, action: () => Promise<{ hasBankingData: boolean }>) => {
    setBusy(label);
    setError(null);
    try {
      const result = await action();
      router.push(result.hasBankingData ? '/dashboard' : '/welcome');
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? { message: cause.message, field: cause.field }
          : { message: 'Something went wrong. Try again.', field: null },
      );
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas">
      {/* Atmosphere: soft orbits of light, motion-safe. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-accent-400/25 blur-[120px]" />
        <div className="absolute -bottom-52 right-[-10rem] h-[38rem] w-[38rem] rounded-full bg-info-400/20 blur-[130px]" />
        <div className="absolute left-1/2 top-1/3 h-[22rem] w-[22rem] -translate-x-1/2 rounded-full bg-accent-300/15 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <OrbitWordmark />
          <QuickDisplay />
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:gap-16">
          {/* The promise */}
          <section>
            <p className="label">Banking, minus the fog</p>
            <h1 className="mt-3 font-display text-[clamp(2.5rem,7vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink-900">
              Know what’s
              <br />
              <span className="bg-gradient-to-br from-accent-400 to-accent-700 bg-clip-text text-transparent">actually yours</span>
              <br />
              to spend.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-600">
              Most of your money is spoken for before you wake up. Orbit finds every subscription and instalment hiding in your
              statement, shows you what’s left, and helps you keep more of it.
            </p>

            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
              {[
                ['100 pts', 'is $1. Always.'],
                ['24/7', 'real humans, no phone tree'],
                ['$1', 'starts your investing'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="font-display text-2xl font-bold tracking-tight text-ink-900">{value}</dt>
                  <dd className="mt-1 text-xs leading-snug text-ink-600">{label}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* The door */}
          <section className="glass rounded-3xl p-6 sm:p-7">
            <div className="mb-6 flex rounded-full bg-surface-sunken p-1" role="tablist" aria-label="Sign in or open an account">
              {(
                [
                  ['signin', 'Sign in'],
                  ['open', 'Open an account'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => {
                    setMode(id);
                    setError(null);
                  }}
                  className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 ease-spring ${
                    mode === id ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && (
              <p role="alert" className="mb-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
                {error.message}
              </p>
            )}

            {mode === 'signin' ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void handle('signin', () => auth.login(String(form.get('identifier') ?? ''), String(form.get('password') ?? '')));
                }}
              >
                <Input
                  label="Username or email"
                  name="identifier"
                  autoComplete="username"
                  defaultValue={demo?.username}
                  invalid={error?.field === 'identifier'}
                  required
                />
                <Input
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue={demo?.password}
                  invalid={error?.field === 'password'}
                  required
                />
                <button type="submit" className="btn-primary w-full !py-3" disabled={busy !== null}>
                  {busy === 'signin' ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void handle('open', () =>
                    auth.register({
                      firstName: String(form.get('firstName') ?? ''),
                      lastName: String(form.get('lastName') ?? ''),
                      email: String(form.get('email') ?? ''),
                      username: String(form.get('username') ?? '') || undefined,
                      password: String(form.get('password') ?? ''),
                      phone: String(form.get('phone') ?? '') || undefined,
                      dateOfBirth: String(form.get('dateOfBirth') ?? '') || undefined,
                    }),
                  );
                }}
              >
                <div className="flex gap-2" role="radiogroup" aria-label="Account type">
                  {(
                    [
                      ['personal', 'Personal'],
                      ['business', 'Business'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={kind === id}
                      onClick={() => setKind(id)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                        kind === id ? 'border-ink-900 bg-surface text-ink-900' : 'border-line text-ink-600 hover:bg-surface'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="-mt-1 text-xs text-ink-500">
                  {kind === 'business'
                    ? 'You can add a personal account later — most people keep both.'
                    : 'You can add a business account later, in Settings.'}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="First name" name="firstName" invalid={error?.field === 'firstName'} required />
                  <Input label="Last name" name="lastName" invalid={error?.field === 'lastName'} required />
                </div>
                <Input label="Email" name="email" type="email" autoComplete="email" invalid={error?.field === 'email'} required />
                <Input label="Username" name="username" autoComplete="username" hint="You can sign in with this or your email." invalid={error?.field === 'username'} />
                <Input label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." invalid={error?.field === 'password'} required />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Phone" name="phone" type="tel" autoComplete="tel" optional />
                  <Input label="Date of birth" name="dateOfBirth" type="date" invalid={error?.field === 'dateOfBirth'} optional />
                </div>

                <button type="submit" className="btn-primary w-full !py-3" disabled={busy !== null}>
                  {busy === 'open' ? 'Opening…' : `Open my ${kind} account`}
                </button>
                <p className="text-[0.6875rem] leading-relaxed text-ink-500">
                  A demo build — don’t use a real password. No identity checks are run and no real accounts are opened.
                </p>
              </form>
            )}

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs font-medium text-ink-400">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <button onClick={() => void handle('demo', auth.demo)} disabled={busy !== null} className="btn-ghost w-full">
              {busy === 'demo' ? 'Opening…' : 'Explore the demo account'}
            </button>

            {demo && (
              <p className="mt-4 rounded-xl bg-surface-sunken px-4 py-3 text-xs leading-relaxed text-ink-600">
                Demo sign-in: <span className="font-mono font-semibold">{demo.username}</span> /{' '}
                <span className="font-mono font-semibold">{demo.password}</span> — Jordan Rivera’s account, with six months of history.
              </p>
            )}
          </section>
        </div>

        <footer className="border-t border-line py-5 text-xs text-ink-500">
          Orbit is a demo built for a hackathon. Not a real bank, and no real money moves.
        </footer>
      </div>
    </main>
  );
}

function Input({
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
        {optional && <span className="font-normal normal-case tracking-normal text-ink-400">Optional</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        aria-invalid={invalid || undefined}
        className={`field ${invalid ? 'border-danger-400 focus:border-danger-500 focus:ring-danger-500/20' : ''}`}
        {...rest}
      />
      {hint && <p className="mt-1.5 text-[0.6875rem] text-ink-500">{hint}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingInner />
    </Suspense>
  );
}
