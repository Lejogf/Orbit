'use client';

// Help & Support: real people, 24/7, in whichever way suits the customer.
//
// Arriving from Ori carries the conversation over, so the agent starts with the
// context. Accessibility needs are stated once, up front, and travel with the
// case: an ASL interpreter or TTY is arranged before the agent joins, not
// after the customer has struggled through the first minute.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { more, type SupportCase, type SupportCaseSummary, type SupportChannel } from '@/lib/api';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { HANDOFF_KEY } from '@/components/ori/OriAssistant';
import { useSession } from '@/components/AuthGuard';

const TOPICS = [
  'A charge I don’t recognise',
  'Lost or stolen card',
  'Possible scam',
  'Dispute a charge',
  'Subscriptions',
  'Paying my card',
  'Travel booking',
  'Legal name change',
  'Address change',
  'Signing in',
  'General help',
];

interface Handoff {
  channel: SupportChannel;
  topic: string;
  transcript: { author: 'customer' | 'eno'; text: string }[];
}

function readHandoff(): Handoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    return raw ? (JSON.parse(raw) as Handoff) : null;
  } catch {
    return null;
  }
}

function SupportInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [meta, setMeta] = useState<{ phone: string; needs: { id: string; label: string }[]; cases: SupportCaseSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [topic, setTopic] = useState('General help');
  const [needs, setNeeds] = useState<string[]>([]);
  const [channel, setChannel] = useState<SupportChannel | null>(null);

  const caseId = params.get('case');

  const load = useCallback(() => {
    more.support().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const h = readHandoff();
    if (h) {
      setHandoff(h);
      setTopic(h.topic || 'General help');
    }
    const start = params.get('start') as SupportChannel | null;
    if (start) setChannel(start);
  }, [load, params]);

  if (caseId) return <Conversation id={caseId} onBack={() => { router.push('/support'); load(); }} />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const opened = (created: SupportCase) => {
    try {
      window.sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      // fine
    }
    router.push(`/support?case=${created.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Help & Support"
        title="Talk to a real person"
        subtitle="Any time, day or night. No phone trees, no “try again later”. Whoever helps you sees what you’ve already told Ori."
      />

      {handoff && handoff.transcript.length > 0 && (
        <p className="rounded-xl border border-ink-200 bg-navy-50 px-4 py-3 text-sm text-ink-800">
          <strong className="font-semibold">Your conversation with Ori is attached</strong> ({handoff.transcript.length} messages), so you won’t need to repeat yourself.
        </p>
      )}

      <section className="card p-5" aria-labelledby="topic-heading">
        <h2 id="topic-heading" className="text-sm font-semibold text-ink-900">What do you need help with?</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="topic-heading">
          {TOPICS.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={topic === t}
              onClick={() => setTopic(t)}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                topic === t ? 'bg-ink-600 text-white' : 'bg-surface text-ink-700 ring-1 ring-line hover:bg-navy-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <details className="mt-5 rounded-xl bg-surface-sunken px-4 py-3" open={needs.length > 0}>
          <summary className="cursor-pointer text-sm font-semibold text-ink-800">
            How can we help you best? <span className="font-normal text-ink-600">(optional — ASL, TTY, language, pace)</span>
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(meta?.needs ?? []).map((need) => (
              <label key={need.id} className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface px-3 py-2.5 text-sm text-ink-800 ring-1 ring-line">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-navy-600"
                  checked={needs.includes(need.id)}
                  onChange={(e) => setNeeds((n) => (e.target.checked ? [...n, need.id] : n.filter((x) => x !== need.id)))}
                />
                {need.label}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-600">TTY users can also dial 711 for the relay service. Everything you choose is shared with the agent before they join.</p>
        </details>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <ChannelCard
          title="Chat now"
          badge="Usually under 2 min"
          body="A specialist joins this chat. Fraud and scam questions skip the line."
          active={channel === 'chat'}
          onSelect={() => setChannel('chat')}
        >
          <StartButton label="Start chat" payload={{ channel: 'chat', topic, needs, transcript: handoff?.transcript ?? [] }} onCreated={opened} />
        </ChannelCard>

        <ChannelCard
          title="Call us"
          badge="24/7 · free"
          body="Get a one-time code, then call. Say the code and you’re verified instantly — no security questions."
          active={channel === 'call'}
          onSelect={() => setChannel('call')}
        >
          <StartButton label="Get my call code" payload={{ channel: 'call', topic, needs, transcript: handoff?.transcript ?? [] }} onCreated={opened} />
        </ChannelCard>

        <ChannelCard
          title="Call me back"
          badge="You choose the time"
          body="No hold music. We call you at a time that works, already knowing what it’s about."
          active={channel === 'callback'}
          onSelect={() => setChannel('callback')}
        >
          <Callback topic={topic} needs={needs} transcript={handoff?.transcript ?? []} onCreated={opened} />
        </ChannelCard>

        <ChannelCard
          title="Send a secure message"
          badge="Reply within 4 hours"
          body="Write it at your own pace. We reply here and send you an alert."
          active={channel === 'message'}
          onSelect={() => setChannel('message')}
        >
          <SecureMessage topic={topic} needs={needs} transcript={handoff?.transcript ?? []} onCreated={opened} />
        </ChannelCard>
      </div>

      <section aria-labelledby="past-heading">
        <h2 id="past-heading" className="label mb-2">Your conversations</h2>
        {!meta ? (
          <Skeleton className="h-16" />
        ) : meta.cases.length === 0 ? (
          <p className="text-sm text-ink-600">None yet. Past conversations and their transcripts will appear here.</p>
        ) : (
          <ul className="card divide-y divide-line">
            {meta.cases.map((c) => (
              <li key={c.id}>
                <button onClick={() => router.push(`/support?case=${c.id}`)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-navy-50/50">
                  <span>
                    <span className="block text-sm font-medium text-ink-900">{c.topic}</span>
                    <span className="text-xs text-ink-600">
                      {c.channel === 'callback' ? 'Callback' : c.channel === 'call' ? 'Phone call' : c.channel === 'message' ? 'Secure message' : 'Chat'}
                      {c.agentName ? ` with ${c.agentName}` : ''} · {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={`chip ${c.status === 'resolved' ? 'bg-surface-sunken text-ink-700' : 'bg-accent-100 text-accent-700'}`}>
                    {c.status === 'resolved' ? 'Closed' : c.status === 'scheduled' ? 'Scheduled' : 'Open'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-ink-600">
        We will never ask for your password, PIN or a one-time code by phone, text or email. If someone does, hang up and contact us here.
      </p>
    </div>
  );
}

function ChannelCard({
  title,
  badge,
  body,
  active,
  onSelect,
  children,
}: {
  title: string;
  badge: string;
  body: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`card flex flex-col p-5 transition ${active ? 'ring-2 ring-ink-600' : ''}`} onFocus={onSelect} onClick={onSelect}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        <span className="chip bg-navy-50 text-ink-700">{badge}</span>
      </div>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-700">{body}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

type CasePayload = Parameters<typeof more.createCase>[0];

function StartButton({ label, payload, onCreated }: { label: string; payload: CasePayload; onCreated: (c: SupportCase) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn-primary w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            onCreated(await more.createCase(payload));
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Connecting…' : label}
      </button>
      {error && <p className="mt-2 text-xs text-accent-700" role="alert">{error} You can also call {`1-800-555-0199`} directly.</p>}
    </>
  );
}

function Callback({ topic, needs, transcript, onCreated }: { topic: string; needs: string[]; transcript: Handoff['transcript']; onCreated: (c: SupportCase) => void }) {
  const { session } = useSession();
  const [phone, setPhone] = useState(session.customer.phone ?? '');
  const [slot, setSlot] = useState<'asap' | string>('asap');

  const slots = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1 + i);
    return d;
  });

  const when = slot === 'asap' ? new Date(Date.now() + 5 * 60_000).toISOString() : slot;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">Call me on</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" className="mt-1 w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20" />
      </label>
      <label className="block">
        <span className="label">When</span>
        <select value={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm">
          <option value="asap">As soon as possible (about 5 minutes)</option>
          {slots.map((d) => (
            <option key={d.toISOString()} value={d.toISOString()}>
              {d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            </option>
          ))}
        </select>
      </label>
      <StartButton label="Schedule my callback" payload={{ channel: 'callback', topic, needs, transcript, callbackAt: when, phone }} onCreated={onCreated} />
    </div>
  );
}

function SecureMessage({ topic, needs, transcript, onCreated }: { topic: string; needs: string[]; transcript: Handoff['transcript']; onCreated: (c: SupportCase) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">Your message</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Tell us what’s going on…" className="w-full rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20" />
      </label>
      {text.trim() ? (
        <StartButton label="Send message" payload={{ channel: 'message', topic, needs, transcript, message: text }} onCreated={onCreated} />
      ) : (
        <button className="btn-primary w-full" disabled>Send message</button>
      )}
    </div>
  );
}

/** A live conversation, polled while open. */
function Conversation({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<SupportCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    more.supportCase(id).then((c) => { setData(c); setError(null); }).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [data?.messages.length, data?.agentTyping]);

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return <Skeleton className="h-96" />;

  const live = data.channel === 'chat' && data.status !== 'resolved';

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-800">
        ‹ Help & Support
      </button>

      <header className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="label">{data.team}</p>
          <h1 className="text-xl font-semibold text-ink-900">{data.topic}</h1>
          <p className="mt-0.5 text-sm text-ink-600">
            {data.status === 'queued' && data.channel === 'chat'
              ? `Connecting you now${data.waitingSeconds ? ` · about ${data.waitingSeconds}s` : ''}…`
              : data.agentName
                ? `You’re talking with ${data.agentName}`
                : data.status === 'scheduled'
                  ? `We’ll call ${data.callbackPhone ?? 'you'} ${data.scheduledFor ? `at ${new Date(data.scheduledFor).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'soon'}`
                  : data.status === 'resolved'
                    ? 'This conversation is closed'
                    : 'We’ve got your request'}
          </p>
        </div>
        {data.status !== 'resolved' && (
          <button onClick={() => more.closeCase(id).then(setData)} className="btn-ghost">
            {data.channel === 'chat' ? 'End chat' : 'Close request'}
          </button>
        )}
      </header>

      {data.channel === 'call' && data.callCode && (
        <section className="card p-6 text-center" aria-labelledby="call-heading">
          <h2 id="call-heading" className="text-sm font-semibold text-ink-700">Call us now</h2>
          <a href={`tel:${data.phone.replace(/[^\d+]/g, '')}`} className="mt-2 block text-3xl font-semibold tracking-tight text-ink-900 underline-offset-4 hover:underline">
            {data.phone}
          </a>
          <p className="mt-5 text-sm text-ink-700">When asked, say or type this code:</p>
          <p className="mt-2 font-mono text-4xl font-bold tracking-[0.2em] text-accent-600" aria-label={`Your code is ${data.callCode.split('').join(' ')}`}>
            {data.callCode}
          </p>
          <p className="mt-3 text-xs text-ink-600">Valid for 10 minutes. It verifies you instantly and sends you straight to {data.team}. TTY: dial 711 first.</p>
        </section>
      )}

      <section className="card flex flex-col" aria-label="Conversation">
        <ol className="max-h-[55vh] space-y-3 overflow-y-auto p-5" aria-live="polite">
          {data.messages.map((m) => (
            <li key={m.id} className={m.author === 'customer' ? 'flex justify-end' : m.author === 'system' ? 'flex justify-center' : 'flex'}>
              {m.author === 'system' ? (
                <p className="max-w-[90%] rounded-full bg-surface-sunken px-3 py-1.5 text-center text-xs text-ink-700">{m.body}</p>
              ) : (
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.author === 'customer' ? 'rounded-br-md bg-ink-600 text-white' : m.author === 'eno' ? 'rounded-bl-md bg-surface-sunken text-ink-800' : 'rounded-bl-md bg-surface text-ink-900 ring-1 ring-line'
                }`}>
                  <p className="mb-0.5 text-[11px] font-semibold opacity-70">
                    {m.author === 'customer' ? 'You' : m.author === 'eno' ? 'Ori (earlier)' : data.agentName ?? 'Agent'}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                </div>
              )}
            </li>
          ))}
          {(data.agentTyping || (data.status === 'queued' && data.channel === 'chat')) && (
            <li className="flex items-center gap-2 text-xs text-ink-600">
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-400" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </span>
              {data.agentTyping ? `${data.agentName ?? 'Agent'} is typing` : 'Finding the right person'}
            </li>
          )}
          <div ref={bottom} />
        </ol>

        {live && (
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              setSending(true);
              try {
                setData(await more.sendSupportMessage(id, draft));
                setDraft('');
              } finally {
                setSending(false);
              }
            }}
          >
            <label htmlFor="support-input" className="sr-only">Message</label>
            <input
              id="support-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={data.status === 'queued' ? 'You can start typing — they’ll see it when they join' : 'Type a message'}
              className="flex-1 rounded-xl border border-line px-3.5 py-2.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20"
            />
            <button className="btn-primary" disabled={sending || !draft.trim()}>Send</button>
          </form>
        )}
      </section>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SupportInner />
    </Suspense>
  );
}
