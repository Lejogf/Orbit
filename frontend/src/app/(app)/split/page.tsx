'use client';

// Split a bill: snap the receipt, say who had what, and send requests.
//
// Text recognition runs in the browser (Tesseract), so the photo of the receipt
// never leaves the phone — only the text lines are sent to be parsed. If the
// photo is hard to read, every item is editable and can be typed instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, more, type PersonShare, type ReceiptItem, type SavedSplit, type SplitBody, type SplitPerson, type Transaction } from '@/lib/api';
import { formatCents, formatDate } from '@/lib/format';
import { Chip, PageHeader, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useToast } from '@/components/Toast';


const ME: SplitPerson = { id: 'me', name: 'You', isSelf: true };

const dollarsToCents = (value: string) => Math.round((Number.parseFloat(value.replace(/[^0-9.]/g, '')) || 0) * 100);

export default function SplitPage() {
  const t = useT();
  const toast = useToast();
  const [mode, setMode] = useState<'items' | 'even'>('items');
  const [title, setTitle] = useState('Dinner');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [taxCents, setTaxCents] = useState(0);
  const [tipCents, setTipCents] = useState(0);
  const [people, setPeople] = useState<SplitPerson[]>([ME]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [purchase, setPurchase] = useState<Transaction | null>(null);
  const [shares, setShares] = useState<PersonShare[]>([]);
  const [history, setHistory] = useState<SavedSplit[] | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    more.splits().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const subtotal = items.reduce((s, i) => s + i.cents, 0);
  const total = mode === 'even' && purchase ? -purchase.amountCents : subtotal + taxCents + tipCents;

  const body: SplitBody = useMemo(
    () => ({
      title: title || 'Shared bill',
      mode,
      people,
      items: mode === 'even' ? [] : items,
      assignments,
      taxCents: mode === 'even' ? 0 : taxCents,
      tipCents: mode === 'even' ? 0 : tipCents,
      totalCents: mode === 'even' ? total : undefined,
      extrasMode: 'proportional',
      transactionId: mode === 'even' ? purchase?.id ?? null : null,
    }),
    [title, mode, people, items, assignments, taxCents, tipCents, total, purchase],
  );

  // Live preview, debounced so typing a price doesn't send a request per key.
  useEffect(() => {
    if (people.length < 2 || total <= 0) {
      setShares([]);
      return;
    }
    const timer = setTimeout(() => {
      more.previewSplit(body).then(setShares).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [body, people.length, total]);

  const loadReceipt = async (text: string) => {
    const parsed = await more.parseReceipt(text);
    setItems(parsed.items);
    setTaxCents(parsed.taxCents ?? 0);
    setTipCents(parsed.tipCents ?? 0);
    setAssignments({});
    if (parsed.merchant) setTitle(parsed.merchant.replace(/\b\w+/g, (w) => w[0]! + w.slice(1).toLowerCase()));
    setNote(
      parsed.items.length === 0
        ? "We couldn't find any items. Try a clearer photo, or add them below."
        : parsed.reconciles
          ? `Found ${parsed.items.length} items, and they add up to the receipt. Check them, then say who had what.`
          : `Found ${parsed.items.length} items, but they don't quite match the receipt's subtotal. Check the prices below.`,
    );
  };

  const send = async () => {
    setSending(true);
    try {
      const saved = await more.saveSplit(body);
      toast.show(`Requests sent for ${saved.title}`, 'success');
      setItems([]);
      setPeople([ME]);
      setAssignments({});
      setShares([]);
      setPurchase(null);
      setNote(null);
      loadHistory();
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.split')}
        title={t('page.split.heading')}
        subtitle={t('page.split.subtitle')}
      />

      <div className="flex gap-1 rounded-full bg-surface p-1 ring-1 ring-line" role="tablist">
        {(
          [
            ['items', 'Scan a receipt'],
            ['even', 'Split a card purchase'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${mode === id ? 'bg-ink-600 text-white' : 'text-ink-600 hover:bg-navy-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'items' ? (
        <>
          <Scanner onText={loadReceipt} />
          {note && <p className="rounded-xl bg-navy-50 px-4 py-3 text-sm text-ink-800" role="status">{note}</p>}
        </>
      ) : (
        <PurchasePicker selected={purchase} onSelect={(t) => { setPurchase(t); setTitle(t.merchantName ?? t.description); }} />
      )}

      <People people={people} setPeople={setPeople} />

      {mode === 'items' && (
        <section className="card p-5" aria-labelledby="items-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="items-heading" className="text-base font-semibold text-ink-900">Items</h2>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-700">Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-40 rounded-lg border border-line px-2.5 py-1.5 text-sm" />
            </label>
          </div>
          <p className="mt-1 text-xs text-ink-600">Tap names to say who had each item. Nobody selected means everyone shared it.</p>

          <ul className="mt-3 divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="py-3">
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`name-${item.id}`}>Item name</label>
                  <input id={`name-${item.id}`} value={item.name} onChange={(e) => setItems((list) => list.map((i) => (i.id === item.id ? { ...i, name: e.target.value } : i)))} className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1.5 text-sm font-medium text-ink-900 hover:border-line focus:border-ink-500" />
                  <label className="sr-only" htmlFor={`price-${item.id}`}>Price</label>
                  <input id={`price-${item.id}`} inputMode="decimal" defaultValue={(item.cents / 100).toFixed(2)} onBlur={(e) => setItems((list) => list.map((i) => (i.id === item.id ? { ...i, cents: dollarsToCents(e.target.value) } : i)))} className="w-24 rounded-lg border border-line px-2 py-1.5 text-right text-sm tnum" />
                  <button aria-label={`Remove ${item.name}`} onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))} className="h-9 w-9 rounded-lg text-ink-500 hover:bg-brand-50 hover:text-accent-600">×</button>
                </div>
                {people.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Who had ${item.name}`}>
                    {people.map((p) => {
                      const on = (assignments[item.id] ?? []).includes(p.id);
                      return (
                        <button key={p.id} aria-pressed={on}
                          onClick={() => setAssignments((a) => {
                            const current = a[item.id] ?? [];
                            return { ...a, [item.id]: on ? current.filter((x) => x !== p.id) : [...current, p.id] };
                          })}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${on ? 'bg-ink-600 text-white' : 'bg-surface-sunken text-ink-700 hover:bg-ink-100'}`}>
                          {p.name}
                        </button>
                      );
                    })}
                    {!(assignments[item.id]?.length) && <span className="self-center text-xs text-ink-500">Shared by everyone</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button onClick={() => setItems((list) => [...list, { id: `item-${Date.now()}`, name: 'New item', cents: 0, quantity: 1 }])} className="btn-ghost mt-2 !py-2 text-xs">
            + Add item
          </button>

          <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <p className="text-sm"><span className="label block">Subtotal</span><span className="font-semibold tnum">{formatCents(subtotal)}</span></p>
            <label className="text-sm"><span className="label block">Tax</span>
              <input key={`tax-${taxCents}`} inputMode="decimal" defaultValue={(taxCents / 100).toFixed(2)} onBlur={(e) => setTaxCents(dollarsToCents(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-2.5 py-1.5 tnum" />
            </label>
            <div className="text-sm">
              <label htmlFor="tip" className="label block">Tip</label>
              <input id="tip" key={`tip-${tipCents}`} inputMode="decimal" defaultValue={(tipCents / 100).toFixed(2)} onBlur={(e) => setTipCents(dollarsToCents(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-2.5 py-1.5 tnum" />
              <div className="mt-1.5 flex gap-1">
                {[15, 18, 20].map((pct) => (
                  <button key={pct} onClick={() => setTipCents(Math.round((subtotal * pct) / 100))} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-700 hover:bg-ink-100">{pct}%</button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card p-5" aria-labelledby="result-heading" aria-live="polite">
        <div className="flex items-baseline justify-between">
          <h2 id="result-heading" className="text-base font-semibold text-ink-900">Each person pays</h2>
          <span className="text-sm text-ink-700">Total <strong className="tnum text-ink-900">{formatCents(Math.max(0, total))}</strong></span>
        </div>
        {shares.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">{people.length < 2 ? 'Add the people you’re splitting with.' : 'Add a receipt or choose a purchase.'}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {shares.map((s) => (
              <li key={s.personId} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{s.name}</p>
                  {s.items.length > 0 && <p className="truncate text-xs text-ink-600">{s.items.map((i) => i.name).join(', ')}</p>}
                  {(s.taxCents > 0 || s.tipCents > 0) && <p className="text-xs text-ink-600">incl. {formatCents(s.taxCents)} tax, {formatCents(s.tipCents)} tip</p>}
                </div>
                <p className="text-base font-semibold text-ink-900 tnum">{formatCents(s.totalCents)}</p>
              </li>
            ))}
          </ul>
        )}
        <button onClick={send} disabled={shares.length === 0 || sending} className="btn-primary mt-4 w-full sm:w-auto">
          {sending ? 'Sending…' : `Request with Zelle® (${Math.max(0, people.length - 1)})`}
        </button>
        <p className="mt-2 text-xs text-ink-600">
          Requests go out over Zelle® using the phone number or email you entered — no app to download, and most banks deliver the money in minutes.
          When someone pays, it lands in your checking account and your Safe to Spend goes up.
        </p>
      </section>

      <History history={history} onPaid={loadHistory} />
    </div>
  );
}

function Scanner({ onText }: { onText: (text: string) => Promise<void> }) {
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const scan = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setStatus('Reading the receipt on your device…');
    try {
      const { recognize } = await import('tesseract.js');
      const result = await recognize(file, 'eng', {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setStatus(`Reading the receipt… ${Math.round(m.progress * 100)}%`);
        },
      });
      await onText(result.data.text);
      setStatus(null);
    } catch {
      setStatus("We couldn't read that photo. Try again in good light, use the sample, or type the items.");
    }
  };

  return (
    <section className="card p-5" aria-labelledby="scan-heading">
      <h2 id="scan-heading" className="text-base font-semibold text-ink-900">Your receipt</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <input ref={fileInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void scan(e.target.files[0])} aria-label="Take or choose a photo of the receipt" />
        <button onClick={() => fileInput.current?.click()} className="btn-primary">Take or upload a photo</button>
        <button onClick={() => setTyped((v) => !v)} className="btn-ghost" aria-expanded={typed}>Type or paste it</button>
      </div>
      {status && <p className="mt-3 text-sm text-ink-700" role="status">{status}</p>}
      {preview && <img src={preview} alt="Your receipt" className="mt-3 max-h-56 rounded-xl border border-line object-contain" />}
      {typed && (
        <div className="mt-3">
          <label htmlFor="receipt-text" className="label">One item per line, price at the end</label>
          <textarea id="receipt-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Burger 14.50\nFries 4.00\nTax 1.48'} className="mt-1 w-full rounded-xl border border-line px-3 py-2 font-mono text-sm" />
          <button onClick={() => void onText(text)} disabled={!text.trim()} className="btn-accent mt-2">Use these items</button>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-600">Your photo stays on your device. Only the text we read from it is used.</p>
    </section>
  );
}

/** A Zelle® request needs a real destination: 10-digit mobile or an email. */
function contactError(contact: string): string | null {
  const trimmed = contact.trim();
  if (!trimmed) return 'Add their number or email so the request can reach them.';
  if (trimmed.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(trimmed) ? null : 'That email doesn’t look right.';
  }
  return trimmed.replace(/\D/g, '').length === 10 ? null : 'A US mobile number has 10 digits.';
}

function People({ people, setPeople }: { people: SplitPerson[]; setPeople: (fn: (p: SplitPerson[]) => SplitPerson[]) => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ name: string; handle: string }[]>([]);

  // People you've paid before, so you don't retype a number you already gave us.
  useEffect(() => {
    money
      .pay()
      .then((r) => setSuggestions(r.payees.filter((p) => p.kind === 'person').map((p) => ({ name: p.name, handle: p.displayHandle }))))
      .catch(() => undefined);
  }, []);

  const add = () => {
    if (!name.trim()) {
      setError('Enter their name.');
      return;
    }
    const problem = contactError(contact);
    if (problem) {
      setError(problem);
      return;
    }
    setPeople((p) => [...p, { id: `p-${Date.now()}`, name: name.trim(), contact: contact.trim() }]);
    setName('');
    setContact('');
    setError(null);
  };
  return (
    <section className="card p-5" aria-labelledby="people-heading">
      <h2 id="people-heading" className="text-base font-semibold text-ink-900">Who’s splitting</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 rounded-full bg-navy-50 py-1 pl-3 pr-1 text-sm font-medium text-ink-800">
            {p.name}
            {!p.isSelf && (
              <button aria-label={`Remove ${p.name}`} onClick={() => setPeople((list) => list.filter((x) => x.id !== p.id))} className="h-6 w-6 rounded-full text-ink-500 hover:bg-surface">×</button>
            )}
            {p.isSelf && <span className="pr-2" />}
          </li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="label mb-1.5">From your contacts</p>
          <div className="flex flex-wrap gap-2">
            {suggestions
              .filter((s) => !people.some((p) => p.name === s.name))
              .map((person) => (
                <button
                  key={person.handle}
                  onClick={() => setPeople((p) => [...p, { id: `p-${Date.now()}`, name: person.name, contact: person.handle }])}
                  className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-ink-800 transition hover:bg-surface-sunken"
                >
                  <span className="font-medium">{person.name}</span>
                  <span className="text-xs text-ink-500">{person.handle}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label className="sr-only" htmlFor="person-name">Name</label>
        <input id="person-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-36 flex-1 rounded-xl border border-line px-3 py-2 text-sm" />
        <label className="sr-only" htmlFor="person-contact">Phone or email</label>
        <input id="person-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email for Zelle®" className="w-48 flex-1 rounded-xl border border-line px-3 py-2 text-sm" />
        <button className="btn-accent" disabled={!name.trim() || !contact.trim()}>Add</button>
      </form>
      {error && <p className="mt-2 text-xs font-medium text-danger-600" role="alert">{error}</p>}
      <p className="mt-2 text-xs text-ink-500">Both a name and a way to reach them are needed before a request can be sent.</p>
    </section>
  );
}

function PurchasePicker({ selected, onSelect }: { selected: Transaction | null; onSelect: (t: Transaction) => void }) {
  const [purchases, setPurchases] = useState<Transaction[] | null>(null);
  useEffect(() => {
    api.accounts().then(async (accounts) => {
      const card = accounts.find((a) => a.type === 'Credit Card') ?? accounts[0];
      if (!card) return setPurchases([]);
      const list = await api.transactions(card.id, '?source=purchase&limit=15');
      setPurchases(list.filter((t) => t.amountCents < 0));
    }).catch(() => setPurchases([]));
  }, []);

  if (!purchases) return <Skeleton className="h-48" />;
  return (
    <section className="card p-5" aria-labelledby="purchase-heading">
      <h2 id="purchase-heading" className="text-base font-semibold text-ink-900">Choose a purchase</h2>
      <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto">
        {purchases.map((t) => (
          <li key={t.id}>
            <button onClick={() => onSelect(t)} aria-pressed={selected?.id === t.id}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-sm ${selected?.id === t.id ? 'bg-navy-50 ring-1 ring-ink-600' : 'hover:bg-navy-50/50'}`}>
              <span><span className="block font-medium text-ink-900">{t.merchantName ?? t.description}</span><span className="text-xs text-ink-600">{formatDate(t.postedAt)}</span></span>
              <span className="font-semibold tnum">{formatCents(-t.amountCents)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ history, onPaid }: { history: SavedSplit[] | null; onPaid: () => void }) {
  const toast = useToast();
  if (!history || history.length === 0) return null;
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="label mb-2">Your splits</h2>
      <ul className="space-y-3">
        {history.map((split) => (
          <li key={split.id} className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="font-semibold text-ink-900">{split.title}</p>
              <p className="text-sm text-ink-700 tnum">{formatCents(split.totalCents)} · {formatDate(split.createdAt)}</p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {split.shares.filter((s) => !s.isSelf).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-800">{s.name} · <span className="tnum">{formatCents(s.amountCents)}</span></span>
                  {s.status === 'paid' ? (
                    <Chip tone="money">Paid</Chip>
                  ) : (
                    <button
                      onClick={async () => { await more.markSharePaid(s.id); toast.show(`${s.name} paid you ${formatCents(s.amountCents)}`, 'success'); onPaid(); }}
                      className="text-xs font-semibold text-ink-600 underline-offset-2 hover:underline"
                    >
                      Zelle® request sent · mark as paid
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
