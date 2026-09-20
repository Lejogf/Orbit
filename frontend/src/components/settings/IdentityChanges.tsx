'use client';

// Changing the things a bank usually refuses to change.
//
// Life moves: people marry, divorce, transition, and move house. Refusing those
// changes in-app doesn't make anyone safer, it just wastes an afternoon. So:
//
//   Address     you change it yourself, confirmed by a one-time code.
//   Legal name  you start it yourself with a document, and watch it progress.
//
// Identity rules still apply — a name change is reviewed, not rubber-stamped —
// but nothing sends you to a branch.
import { useCallback, useEffect, useState } from 'react';
import { more, type ChangeRequest, type Profile } from '@/lib/api';
import { Chip, Field, Sheet } from '@/components/ui';
import { useToast } from '@/components/Toast';

const STATUS: Record<string, { label: string; tone: 'warn' | 'info' | 'accent' | 'neutral' }> = {
  pending_verification: { label: 'Waiting for your code', tone: 'warn' },
  under_review: { label: 'Under review', tone: 'info' },
  approved: { label: 'Approved', tone: 'accent' },
  rejected: { label: 'Not approved', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function IdentityChanges({ customer, onChanged, openWith }: { customer: Profile; onChanged: () => void; openWith?: string | null }) {
  const toast = useToast();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [reasons, setReasons] = useState<{ id: string; label: string; documents: string[] }[]>([]);
  const [sheet, setSheet] = useState<'address' | 'name' | null>((openWith as 'address' | 'name') ?? null);

  const load = useCallback(() => {
    more.changeRequests().then((r) => {
      setRequests(r.requests);
      setReasons(r.reasons);
    }).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const open = requests.filter((r) => r.status === 'pending_verification' || r.status === 'under_review');

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold text-ink-900">Your details</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">
        Moved, married, or changed your name? You can do both here — no branch visit, no waiting on hold.
      </p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="label">Legal name</dt>
          <dd className="mt-1 text-sm font-medium text-ink-900">
            {customer.firstName} {customer.lastName}
          </dd>
        </div>
        <div>
          <dt className="label">Home address</dt>
          <dd className="mt-1 text-sm font-medium text-ink-900">
            {customer.address.line1 ? (
              <>
                {customer.address.line1}
                {customer.address.line2 ? `, ${customer.address.line2}` : ''}
                <br />
                {customer.address.city}, {customer.address.state} {customer.address.postalCode}
              </>
            ) : (
              'Not on file'
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={() => setSheet('address')} className="btn-ghost">
          I’ve moved
        </button>
        <button onClick={() => setSheet('name')} className="btn-ghost">
          Change my legal name
        </button>
      </div>

      {open.length > 0 && (
        <ul className="mt-5 space-y-3">
          {open.map((request) => (
            <li key={request.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">
                  {request.kind === 'address' ? 'Address change' : 'Legal name change'}
                </p>
                <Chip tone={STATUS[request.status]?.tone ?? 'neutral'}>{STATUS[request.status]?.label ?? request.status}</Chip>
              </div>
              {request.kind === 'legal_name' && (
                <p className="mt-1 text-sm text-ink-600">
                  To {String(request.payload.firstName)} {String(request.payload.lastName)} · {request.documentName}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === 'under_review' && (
                  <button
                    onClick={async () => {
                      await more.approveRequest(request.id);
                      toast.show('Approved — your name is updated everywhere', 'success');
                      load();
                      onChanged();
                    }}
                    className="btn-accent !py-2 text-xs"
                  >
                    Demo: approve now
                  </button>
                )}
                <button
                  onClick={async () => {
                    await more.cancelRequest(request.id);
                    toast.show('Request cancelled', 'info');
                    load();
                  }}
                  className="btn-ghost !py-2 text-xs"
                >
                  Cancel
                </button>
              </div>
              {request.status === 'under_review' && (
                <p className="mt-2 text-xs text-ink-500">
                  Normally a reviewer checks the document within one business day. The button above stands in for that, so you can
                  see the whole journey.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={sheet === 'address'} onClose={() => setSheet(null)} title="Change your address">
        <AddressFlow
          customer={customer}
          onDone={() => {
            setSheet(null);
            load();
            onChanged();
          }}
        />
      </Sheet>

      <Sheet open={sheet === 'name'} onClose={() => setSheet(null)} title="Change your legal name">
        <NameFlow
          customer={customer}
          reasons={reasons}
          onDone={() => {
            setSheet(null);
            load();
          }}
        />
      </Sheet>
    </section>
  );
}

function AddressFlow({ customer, onDone }: { customer: Profile; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [form, setForm] = useState({
    line1: customer.address.line1 ?? '',
    line2: customer.address.line2 ?? '',
    city: customer.address.city ?? '',
    state: customer.address.state ?? '',
    postalCode: customer.address.postalCode ?? '',
  });
  const [sent, setSent] = useState<{ requestId: string; sentTo: string; demoCode: string; standardized: typeof form; changed: boolean } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await more.startAddressChange(form);
      setSent({
        requestId: result.requestId,
        sentTo: result.sentTo,
        demoCode: result.demoCode,
        standardized: { ...form, ...result.standardized, line2: result.standardized.line2 ?? '' },
        changed: result.changed,
      });
      setStep('code');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await more.verifyAddressChange(sent!.requestId, code);
      toast.show(result.inNessie ? 'Address updated, and synced to your bank record' : 'Address updated', 'success');
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code' && sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-sunken p-4">
          <p className="label">New address</p>
          <p className="mt-1 text-sm font-medium text-ink-900">
            {sent.standardized.line1}
            {sent.standardized.line2 ? `, ${sent.standardized.line2}` : ''}
            <br />
            {sent.standardized.city}, {sent.standardized.state} {sent.standardized.postalCode}
          </p>
          {sent.changed && <p className="mt-2 text-xs text-ink-500">We tidied the formatting to match postal records.</p>}
        </div>

        <p className="text-sm text-ink-700">We sent a 6-digit code to {sent.sentTo}. Enter it to confirm this is you.</p>

        <Field label="Code" htmlFor="code" error={error}>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="field text-center font-mono text-2xl tracking-[0.35em]"
            placeholder="······"
          />
        </Field>

        <p className="rounded-xl bg-warn-50 px-3.5 py-2.5 text-xs leading-relaxed text-warn-800">
          Demo build: your code is <strong className="font-mono font-bold">{sent.demoCode}</strong>. A real deployment texts it and
          never shows it on screen.
        </p>

        <button onClick={() => void verify()} disabled={busy || code.length < 6} className="btn-primary w-full">
          {busy ? 'Checking…' : 'Confirm new address'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Street address" htmlFor="line1" error={error}>
        <input id="line1" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} className="field" placeholder="42 Oak Street" autoComplete="address-line1" />
      </Field>
      <Field label="Apartment, suite (optional)" htmlFor="line2">
        <input id="line2" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} className="field" autoComplete="address-line2" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" htmlFor="city">
          <input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="field" autoComplete="address-level2" />
        </Field>
        <Field label="State" htmlFor="state">
          <input id="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} className="field uppercase" placeholder="VA" autoComplete="address-level1" />
        </Field>
      </div>
      <Field label="ZIP code" htmlFor="zip">
        <input id="zip" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} className="field" inputMode="numeric" autoComplete="postal-code" />
      </Field>

      <button onClick={() => void start()} disabled={busy} className="btn-primary w-full">
        {busy ? 'Checking…' : 'Send me a code'}
      </button>
      <p className="text-xs leading-relaxed text-ink-500">
        Your statements, cards and anything we post will go to the new address once confirmed.
      </p>
    </div>
  );
}

function NameFlow({
  customer,
  reasons,
  onDone,
}: {
  customer: Profile;
  reasons: { id: string; label: string; documents: string[] }[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [firstName, setFirstName] = useState(customer.firstName);
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState(customer.lastName);
  const [reason, setReason] = useState(reasons[0]?.id ?? 'marriage');
  const [document, setDocument] = useState<{ name: string; type: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accepted = reasons.find((r) => r.id === reason)?.documents ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-700">
        Tell us your new name and show us the document behind it. We check it against the name you’re asking for — usually within
        one business day — then update your account and reprint your cards.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="First" htmlFor="first">
          <input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field" />
        </Field>
        <Field label="Middle (optional)" htmlFor="middle">
          <input id="middle" value={middleName} onChange={(e) => setMiddleName(e.target.value)} className="field" />
        </Field>
        <Field label="Last" htmlFor="last">
          <input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} className="field" />
        </Field>
      </div>

      <Field label="Reason" htmlFor="reason">
        <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="field">
          {reasons.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </Field>

      <div>
        <p className="label mb-1.5">Document</p>
        <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-4 transition ${document ? 'border-accent-500 bg-accent-50' : 'border-line hover:bg-surface-sunken'}`}>
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setDocument({ name: file.name, type: file.type, size: file.size });
            }}
          />
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
            </svg>
          </span>
          <span className="min-w-0 text-sm">
            <span className="block font-semibold text-ink-900">{document ? document.name : 'Photograph or upload'}</span>
            <span className="block text-xs text-ink-600">Accepted: {accepted.join(', ')}</span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}

      <button
        onClick={async () => {
          if (!document) {
            setError('We need the document before we can review this.');
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await more.requestNameChange({ firstName, lastName, middleName: middleName || null, reason, document });
            toast.show('Request received — we’ll review it shortly', 'success');
            onDone();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="btn-primary w-full"
      >
        {busy ? 'Sending…' : 'Submit for review'}
      </button>

      <p className="text-xs leading-relaxed text-ink-500">
        Why a review at all? Identity rules require us to verify the name on an account against a real document. The demo doesn’t
        keep your file — only its name and size are recorded.
      </p>
    </div>
  );
}
