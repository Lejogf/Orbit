'use client';

// One turn in the Ori conversation: text, facts, links, a proposed action that
// needs confirming, and — when Ori can't help — a way to a person.
import { useState } from 'react';
import type { OriReply } from '@/lib/api';

export type ChatEntry =
  | { id: string; from: 'user'; text: string }
  | { id: string; from: 'note'; text: string }
  | { id: string; from: 'eno'; reply: OriReply; outcome?: 'done' | 'cancelled' };

export function OriMessage({
  entry,
  confirmTwice,
  onSuggestion,
  onConfirm,
  onCancel,
  onHandoff,
  onLink,
  onSpeak,
}: {
  entry: ChatEntry;
  confirmTwice: boolean;
  onSuggestion: (text: string) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  onHandoff: (channel: 'chat' | 'call' | 'callback', topic: string) => void;
  onLink: (href: string) => void;
  onSpeak: (text: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [working, setWorking] = useState(false);

  if (entry.from === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink-600 px-3.5 py-2.5 text-sm text-canvas">{entry.text}</p>
      </div>
    );
  }

  if (entry.from === 'note') {
    return (
      <p className="mx-auto max-w-[90%] rounded-xl bg-money-50 px-3 py-2 text-center text-xs font-medium text-accent-700" role="status">
        {entry.text}
      </p>
    );
  }

  const { reply, outcome } = entry;
  const proposal = reply.proposal;
  const needsSecondTap = confirmTwice && proposal?.action.type === 'transfer';

  return (
    <div className="max-w-[92%] space-y-2">
      <div className="rounded-2xl rounded-bl-md bg-surface-sunken px-3.5 py-2.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{reply.text}</p>

        {reply.facts.length > 0 && (
          <dl className="mt-2.5 divide-y divide-line rounded-xl bg-surface px-3">
            {reply.facts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <dt className="min-w-0 truncate text-ink-600">{fact.label}</dt>
                <dd className="shrink-0 font-semibold text-ink-900 tnum">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => onSpeak(reply.text)} className="text-[11px] font-semibold text-ink-500 hover:text-ink-800">
            Read aloud
          </button>
        </div>
      </div>

      {reply.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reply.links.map((link) => (
            <button
              key={link.href}
              onClick={() => onLink(link.href)}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:bg-navy-50"
            >
              {link.label}
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}

      {proposal && (
        <div className={`rounded-2xl border p-3.5 ${proposal.danger ? 'border-accent-200 bg-brand-50/50' : 'border-ink-200 bg-navy-50/50'}`}>
          <p className="text-sm font-semibold text-ink-900">{proposal.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-700">{proposal.summary}</p>
          {outcome ? (
            <p className="mt-2 text-xs font-semibold text-ink-600">{outcome === 'done' ? '✓ Done' : 'Not changed'}</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                disabled={working}
                onClick={async () => {
                  if (needsSecondTap && !armed) return setArmed(true);
                  setWorking(true);
                  await onConfirm();
                  setWorking(false);
                }}
                className={proposal.danger ? 'btn-primary !py-2 text-xs' : 'btn-accent !py-2 text-xs'}
              >
                {working ? 'Working…' : armed ? `Yes, ${proposal.confirmLabel.toLowerCase()}` : proposal.confirmLabel}
              </button>
              <button onClick={onCancel} disabled={working} className="btn-ghost !py-2 text-xs">
                Not now
              </button>
            </div>
          )}
          {armed && !outcome && <p className="mt-2 text-xs font-medium text-ink-700" role="alert">Tap again to confirm. You asked us to double-check before money moves.</p>}
        </div>
      )}

      {reply.handoff && (
        <div className={`rounded-2xl border p-3.5 ${reply.handoff.urgent ? 'border-ink-300 bg-surface shadow-sm' : 'border-line bg-surface'}`}>
          <p className="text-sm font-semibold text-ink-900">
            {reply.handoff.urgent ? 'Talk to a person now' : 'Prefer a person?'}
          </p>
          <p className="mt-0.5 text-xs text-ink-600">Available 24/7. They’ll see this conversation — no repeating yourself.</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {(
              [
                ['chat', 'Chat now'],
                ['call', 'Call'],
                ['callback', 'Call me back'],
              ] as const
            ).map(([channel, label]) => (
              <button
                key={channel}
                onClick={() => onHandoff(channel, reply.handoff!.topic)}
                className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${
                  channel === 'chat' ? 'bg-ink-600 text-canvas hover:bg-ink-700' : 'border border-ink-200 text-ink-700 hover:bg-navy-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {reply.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {reply.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestion(s)}
              className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-line transition hover:bg-navy-50 hover:ring-ink-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
