'use client';

// A sign-in name you can remember, and someone we can call if things look wrong.
import { useState } from 'react';
import { more, type Profile } from '@/lib/api';
import { Field } from '@/components/ui';
import { useToast } from '@/components/Toast';

export function UsernameAndContact({ customer, onChanged }: { customer: Profile; onChanged: () => void }) {
  const toast = useToast();
  const [username, setUsername] = useState(customer.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [contactName, setContactName] = useState(customer.trustedContact?.name ?? '');
  const [contactPhone, setContactPhone] = useState(customer.trustedContact?.phone ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section className="card p-6">
      <h2 className="text-base font-semibold text-ink-900">Signing in</h2>
      <p className="mt-1 text-sm text-ink-600">Use a username or your email — whichever you remember.</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Field label="Username" htmlFor="username" error={usernameError} hint="Letters, numbers, dots, dashes and underscores.">
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className="field"
              autoComplete="username"
              placeholder="jordan"
            />
          </Field>
        </div>
        <button
          onClick={async () => {
            setBusy('username');
            setUsernameError(null);
            try {
              await more.setUsername(username);
              toast.show('Username saved', 'success');
              onChanged();
            } catch (cause) {
              setUsernameError((cause as Error).message);
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy !== null || !username.trim()}
          className="btn-ghost"
        >
          {busy === 'username' ? 'Saving…' : 'Save'}
        </button>
      </div>

      <hr className="my-6 border-line" />

      <h2 className="text-base font-semibold text-ink-900">Trusted contact</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">
        Someone we can call if we can’t reach you, or if we see activity that looks like a scam. They get no access to your money
        and cannot move it — they are just a second pair of eyes.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Their name" htmlFor="contact-name">
          <input id="contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} className="field" placeholder="Alex Rivera" />
        </Field>
        <Field label="Their phone" htmlFor="contact-phone">
          <input id="contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="field" inputMode="tel" placeholder="(555) 123-4567" />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={async () => {
            setBusy('contact');
            try {
              await more.setTrustedContact(contactName || null, contactPhone || null);
              toast.show('Trusted contact saved', 'success');
              onChanged();
            } catch (cause) {
              toast.show((cause as Error).message, 'error');
            } finally {
              setBusy(null);
            }
          }}
          disabled={busy !== null}
          className="btn-ghost"
        >
          {busy === 'contact' ? 'Saving…' : 'Save contact'}
        </button>
        {customer.trustedContact && (
          <button
            onClick={async () => {
              setBusy('contact');
              await more.setTrustedContact(null, null);
              setContactName('');
              setContactPhone('');
              toast.show('Trusted contact removed', 'info');
              onChanged();
              setBusy(null);
            }}
            className="btn-quiet"
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}
