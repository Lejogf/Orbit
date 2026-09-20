'use client';

// Where a brand-new account lands. Without banking data the rest of the app has
// nothing to show, so this offers a way to fill it rather than presenting a
// dashboard full of zeroes that looks broken.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiRequestError, auth, type Profile } from '@/lib/api';
import { ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function WelcomePage() {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth
      .me()
      .then((state) => {
        // Nothing to set up if the account already has data.
        if (state.hasBankingData) router.replace('/dashboard');
        else setProfile(state.customer);
      })
      .catch((cause: ApiRequestError) =>
        cause.isAuthError ? router.replace('/') : setError(cause.message),
      );
  }, [router]);

  const load = async () => {
    setBusy(true);
    try {
      await auth.loadSampleData();
      toast.show('Sample accounts and six months of history added.', 'success');
      router.push('/dashboard');
    } catch (cause) {
      toast.show(cause instanceof Error ? cause.message : 'Could not load sample data.', 'error');
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (!profile) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="label">Welcome</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-900">
        You&rsquo;re all set, {profile.firstName}.
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">
        Your account is open, but there&rsquo;s nothing in it yet. Flow works by reading your card
        history, so it needs transactions before it can find anything.
      </p>

      <div className="card mt-6 p-6">
        <h2 className="text-base font-semibold text-navy-900">Load sample data</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-600">
          Adds a checking account, a savings account and a Quicksilver card with six months of
          realistic history — including ten subscriptions with problems worth finding. It&rsquo;s
          your own copy, separate from every other account.
        </p>
        <button onClick={load} disabled={busy} className="btn-primary mt-4">
          {busy ? 'Setting up…' : 'Load sample data'}
        </button>
      </div>

      <div className="card mt-4 p-6">
        <h2 className="text-base font-semibold text-navy-900">Start empty instead</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-600">
          Go straight to the dashboard. Most screens will be empty until transactions exist, which
          is the honest state for a new account.
        </p>
        <button onClick={() => router.push('/dashboard')} className="btn-ghost mt-4">
          Go to the dashboard
        </button>
      </div>
    </div>
  );
}
