'use client';

// Travel & Rewards: book a trip without leaving the app, know whether to book
// now or wait, pay the smartest way with miles, and get money back
// automatically if the price drops after booking.
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiRequestError,
  more,
  type Airport,
  type Booking,
  type CancellationQuote,
  type FlightOption,
  type HotelOption,
  type Offer,
  type PayWith,
  type PriceForecast,
  type Rewards,
  type TripQuote,
  type TripRequest,
} from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Chip, EmptyState, ErrorState, PageHeader, Sheet, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useToast } from '@/components/Toast';

type Tab = 'book' | 'trips' | 'offers';

function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function TravelInner() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as Tab) ?? 'book';
  const [data, setData] = useState<{ airports: Airport[]; rewards: Rewards; bookings: Booking[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    more.travel().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const setTab = (next: Tab) => router.replace(`/travel?tab=${next}`, { scroll: false });

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav.travel')}
        title={t('page.travel.heading')}
        subtitle={t('page.travel.subtitle')}
      />

      {data ? <RewardsStrip rewards={data.rewards} /> : <Skeleton className="h-24" />}

      <div className="flex gap-1 rounded-full bg-surface p-1 ring-1 ring-line" role="tablist" aria-label="Travel sections">
        {(
          [
            ['book', 'Book a trip'],
            ['trips', `My trips${data?.bookings.length ? ` (${data.bookings.length})` : ''}`],
            ['offers', 'Offers'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${tab === id ? 'bg-ink-600 text-canvas' : 'text-ink-600 hover:bg-navy-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'book' && data && (
        <Book airports={data.airports} rewards={data.rewards} initialTo={params.get('to')} onBooked={() => { load(); setTab('trips'); }} />
      )}
      {tab === 'trips' && data && <Trips bookings={data.bookings} onChange={load} />}
      {tab === 'offers' && <Offers />}
    </div>
  );
}

function RewardsStrip({ rewards }: { rewards: Rewards }) {
  return (
    <section className="grid gap-3 rounded-2xl bg-ink-800 p-5 text-canvas sm:grid-cols-3" aria-label="Your rewards">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-200">Miles</p>
        <p className="mt-1 text-2xl font-semibold tnum">{rewards.miles.toLocaleString('en-US')}</p>
        <p className="text-xs text-ink-200">Worth {formatMoney(rewards.valueCents)} on travel</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-200">Travel credit left this year</p>
        <p className="mt-1 text-2xl font-semibold tnum">{formatMoney(rewards.travelCreditCents)}</p>
        <p className="text-xs text-ink-200">Applied automatically when you book here</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-200">Card ••{rewards.cardLast4 ?? '—'}</p>
        <p className="mt-1 text-2xl font-semibold tnum">{rewards.availableCreditCents !== null ? formatMoney(rewards.availableCreditCents) : '—'}</p>
        <p className="text-xs text-ink-200">{rewards.cardLocked ? 'Locked — unlock it to book' : 'Available credit'}</p>
      </div>
    </section>
  );
}

function ForecastBanner({ forecast }: { forecast: PriceForecast }) {
  const style = forecast.advice === 'book_now' ? 'border-warn-300 bg-warn-50' : forecast.advice === 'wait' ? 'border-ink-200 bg-navy-50' : 'border-money-100 bg-money-50';
  const icon = forecast.advice === 'book_now' ? '↑' : forecast.advice === 'wait' ? '↓' : '✓';
  return (
    <div className={`flex gap-3 rounded-2xl border px-4 py-3 ${style}`} role="status">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold text-ink-800" aria-hidden="true">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-ink-900">{forecast.headline}</p>
        <p className="text-sm text-ink-700">{forecast.reason} <span className="text-ink-600">({Math.round(forecast.confidence * 100)}% confidence)</span></p>
      </div>
    </div>
  );
}

function matchAirport(airports: Airport[], text: string | null): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  return airports.find((a) => a.code.toLowerCase() === t || a.city.toLowerCase().startsWith(t) || t.startsWith(a.city.toLowerCase().split(',')[0]!))?.code ?? null;
}

function Book({ airports, rewards, initialTo, onBooked }: { airports: Airport[]; rewards: Rewards; initialTo: string | null; onBooked: () => void }) {
  const [kind, setKind] = useState<'flight' | 'hotel'>('flight');
  // Nothing is pre-filled except a destination Ori was asked about: the trip is
  // the customer's to describe.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => matchAirport(airports, initialTo) ?? '');
  const [date, setDate] = useState('');
  const [travelers, setTravelers] = useState(1);
  const [city, setCity] = useState(initialTo ? initialTo.replace(/\b\w/g, (c) => c.toUpperCase()) : '');
  const [nights, setNights] = useState(3);

  const [results, setResults] = useState<{
    forecast: PriceForecast;
    flights?: FlightOption[];
    hotels?: HotelOption[];
    /** Only flights can be live; hotels are always the generated inventory. */
    source?: 'live' | 'generated';
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<TripRequest | null>(null);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSearching(true);
    setError(null);
    setChosen(null);
    try {
      if (kind === 'flight') {
        const r = await more.flights({ from, to, date, travelers });
        setResults({ forecast: r.forecast, flights: r.options, source: r.source });
      } else {
        const r = await more.hotels({ city, checkIn: date, nights });
        setResults({ forecast: r.forecast, hotels: r.options });
      }
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Search failed. Check the details and try again.');
    } finally {
      setSearching(false);
    }
  };

  const field = 'mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-500/20';

  return (
    <div className="space-y-5">
      <form onSubmit={search} className="card space-y-4 p-5">
        <div className="flex gap-2" role="radiogroup" aria-label="What to book">
          {(['flight', 'hotel'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setResults(null); }}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${kind === k ? 'bg-ink-100 text-ink-800' : 'text-ink-600 hover:bg-navy-50'}`}>
              {k === 'flight' ? 'Flights' : 'Hotels'}
            </button>
          ))}
        </div>

        {kind === 'flight' ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block"><span className="label">From</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={field} required>
                <option value="">Choose an airport</option>
                {airports.map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
              </select>
            </label>
            <label className="block"><span className="label">To</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={field} required>
                <option value="">Choose an airport</option>
                {airports.map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Depart</span>
              <input type="date" value={date} min={isoIn(1)} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="block"><span className="label">Travellers</span>
              <select value={travelers} onChange={(e) => setTravelers(Number(e.target.value))} className={field}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="label">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} className={field} placeholder="Where to?" required />
            </label>
            <label className="block"><span className="label">Check in</span>
              <input type="date" value={date} min={isoIn(1)} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <label className="block"><span className="label">Nights</span>
              <select value={nights} onChange={(e) => setNights(Number(e.target.value))} className={field}>
                {[1, 2, 3, 4, 5, 6, 7, 10, 14].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
        <button
          className="btn-primary w-full sm:w-auto"
          disabled={searching || (kind === 'flight' ? !from || !to || !date : !city || !date)}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
        {error && <p className="text-sm text-accent-700" role="alert">{error}</p>}
      </form>

      {results && (
        <section className="space-y-3" aria-label="Results">
          <ForecastBanner forecast={results.forecast} />
          {/* Say where these fares came from. A generated fare that looks live
              is the one thing a travel screen must not do. */}
          {results.flights && (
            <p className="text-xs leading-relaxed text-ink-600">
              {results.source === 'live' ? (
                <>
                  <strong className="font-semibold text-accent-700">Live fares</strong> from Google Flights. Booking here
                  records the itinerary and charges your card — it does not reserve a seat with the airline.
                </>
              ) : (
                <>
                  These fares are <strong className="font-semibold">generated from the route and date</strong>, not a live
                  airline feed. Pricing, miles, credits and refunds on them are real arithmetic.
                </>
              )}
            </p>
          )}
          <ul className="space-y-2">
            {results.flights?.map((f, i) => (
              <li key={f.id}>
                <OptionRow
                  selected={chosen?.optionId === f.id}
                  onSelect={() => setChosen({ kind: 'flight', search: { from, to, date, travelers }, optionId: f.id })}
                  title={`${new Date(f.departsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} → ${new Date(f.arrivesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`}
                  subtitle={`${f.airline} ${f.flightNumber} · ${Math.floor(f.durationMinutes / 60)}h ${f.durationMinutes % 60}m · ${f.stops === 0 ? 'Nonstop' : '1 stop'}${f.seatsLeft <= 3 ? ` · ${f.seatsLeft} seats left` : ''}`}
                  priceCents={f.priceCents}
                  badge={i === 0 ? 'Cheapest' : undefined}
                  miles={Math.floor(f.priceCents / 100) * 5}
                />
              </li>
            ))}
            {results.hotels?.map((h, i) => (
              <li key={h.id}>
                <OptionRow
                  selected={chosen?.optionId === h.id}
                  onSelect={() => setChosen({ kind: 'hotel', search: { city, checkIn: date, nights }, optionId: h.id })}
                  title={h.name}
                  subtitle={`★ ${h.rating} · ${formatMoney(h.nightlyCents)}/night${h.perks.length ? ` · ${h.perks.join(' · ')}` : ''}`}
                  priceCents={h.totalCents}
                  badge={i === 0 ? 'Best price' : undefined}
                  miles={Math.floor(h.totalCents / 100) * 10}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {chosen && <Checkout trip={chosen} rewards={rewards} onBooked={onBooked} />}
    </div>
  );
}

function OptionRow({ selected, onSelect, title, subtitle, priceCents, badge, miles }: {
  selected: boolean; onSelect: () => void; title: string; subtitle: string; priceCents: number; badge?: string; miles: number;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`card flex w-full items-center justify-between gap-4 p-4 text-left transition hover:shadow-md ${selected ? 'ring-2 ring-ink-600' : ''}`}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink-900">{title}</span>
          {badge && <Chip tone="money">{badge}</Chip>}
        </span>
        <span className="mt-0.5 block text-sm text-ink-700">{subtitle}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-lg font-semibold text-ink-900 tnum">{formatMoney(priceCents)}</span>
        <span className="text-xs text-ink-600">+{miles.toLocaleString('en-US')} miles</span>
      </span>
    </button>
  );
}

function Checkout({ trip, rewards, onBooked }: { trip: TripRequest; rewards: Rewards; onBooked: () => void }) {
  const toast = useToast();
  const [quote, setQuote] = useState<TripQuote | null>(null);
  const [payWith, setPayWith] = useState<PayWith>('card');
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    setQuote(null);
    more.quoteTrip(trip).then((q) => { setQuote(q); setPayWith(q.advice.bestId); }).catch((e: Error) => setError(e.message));
  }, [trip]);

  if (error) return <p className="text-sm text-accent-700" role="alert">{error}</p>;
  if (!quote) return <Skeleton className="h-64" />;

  const book = async () => {
    setBooking(true);
    setError(null);
    try {
      const b = await more.bookTrip(trip, payWith);
      toast.show(`Booked ${b.title}. You earned ${b.milesEarned.toLocaleString('en-US')} miles.`, 'success');
      onBooked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Booking failed.');
      setBooking(false);
    }
  };

  return (
    <section className="card space-y-4 p-5" aria-labelledby="checkout-heading">
      <div>
        <p className="label">Checkout</p>
        <h2 id="checkout-heading" className="text-lg font-semibold text-ink-900">{quote.title}</h2>
        <p className="text-sm text-ink-700">{formatMoney(quote.priceCents)} total{quote.advice.travelCreditAppliedCents > 0 && ` · ${formatMoney(quote.advice.travelCreditAppliedCents)} travel credit applied`}</p>
      </div>

      <div className="rounded-xl bg-money-50 px-4 py-3 text-sm text-accent-700">
        <strong className="font-semibold">Our recommendation:</strong> {quote.advice.headline}
      </div>

      <fieldset>
        <legend className="label mb-2">How would you like to pay?</legend>
        <div className="space-y-2">
          {quote.advice.options.map((o) => (
            <label key={o.id} className={`flex cursor-pointer gap-3 rounded-xl p-3.5 ring-1 transition ${payWith === o.id ? 'bg-navy-50 ring-ink-600' : 'ring-line hover:bg-navy-50/40'}`}>
              <input type="radio" name="pay" checked={payWith === o.id} onChange={() => setPayWith(o.id)} className="mt-1 h-4 w-4 accent-navy-600" />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink-900">{o.label}</span>
                  {o.id === quote.advice.bestId && <Chip tone="money">Best value</Chip>}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-700">{o.note}</span>
              </span>
              <span className="text-right text-sm">
                <span className="block font-semibold text-ink-900 tnum">{formatMoney(o.cardCents)}</span>
                <span className="text-xs text-ink-600">{o.milesUsed ? `${o.milesUsed.toLocaleString('en-US')} mi` : 'on card'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {quote.priceCents >= 10_000 && (
        <p className="text-xs text-ink-600">Over $100? After booking you can split it into monthly payments from the purchase in your card activity.</p>
      )}
      <p className="text-xs text-ink-600">
        Price drop protection is included: if the price falls before you travel, we credit the difference automatically (up to $50). Booked on your card ••{rewards.cardLast4} and recorded with Nessie.
      </p>
      {error && <p className="text-sm text-accent-700" role="alert">{error}</p>}
      <button onClick={book} disabled={booking || rewards.cardLocked} className="btn-primary w-full sm:w-auto">
        {booking ? 'Booking…' : rewards.cardLocked ? 'Unlock your card to book' : `Book for ${formatMoney(quote.advice.options.find((o) => o.id === payWith)?.cardCents ?? quote.priceCents)}`}
      </button>
    </section>
  );
}

function Trips({ bookings, onChange }: { bookings: Booking[]; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  /** The booking whose cancellation is being quoted. */
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  if (bookings.length === 0) {
    return <EmptyState title="No trips yet" body="Book a flight or hotel here and it will appear with its price protection status." />;
  }

  const check = async (id: string, demo: boolean) => {
    setBusy(id);
    try {
      const r = await more.checkPrice(id, demo);
      toast.show(r.refundCents > 0 ? `Price dropped — ${formatMoney(r.refundCents)} credited to your card` : `Checked: now ${formatMoney(r.newPriceCents)}. No drop yet — we’ll keep watching.`, r.refundCents > 0 ? 'success' : 'info');
      onChange();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="space-y-3">
      {bookings.map((b) => {
        const conf = String(b.details.confirmation ?? '');
        return (
          <li key={b.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label">{b.kind === 'flight' ? 'Flight' : 'Hotel'} · {new Date(b.departsAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                <h3 className="text-lg font-semibold text-ink-900">{b.title}</h3>
                <p className="text-sm text-ink-700">Confirmation {conf} · earned {b.milesEarned.toLocaleString('en-US')} miles{b.inNessie ? ' · recorded in Nessie' : ''}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-ink-900 tnum">{formatMoney(b.priceCents)}</p>
                <p className="text-xs text-ink-600">{b.paidMilesCents ? `${b.paidMilesCents.toLocaleString('en-US')} miles + ` : ''}{formatMoney(b.paidCardCents)} on card</p>
              </div>
            </div>
            {b.status === 'cancelled' ? (
              <p className="mt-4 rounded-xl bg-surface-sunken px-4 py-3 text-sm text-ink-700">
                <strong className="font-semibold">Cancelled.</strong> The refund is on your card and any miles you spent
                have been returned. The miles this trip earned were taken back.
              </p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-sunken px-4 py-3">
                  <p className="text-sm text-ink-800">
                    <strong className="font-semibold">Price protection:</strong>{' '}
                    {b.refundedCents > 0 ? `${formatMoney(b.refundedCents)} refunded so far` : 'watching for drops'} · today {formatMoney(b.currentPriceCents)}
                  </p>
                  <div className="flex gap-2">
                    <button className="btn-ghost !py-2 text-xs" disabled={busy === b.id} onClick={() => check(b.id, false)}>Check price now</button>
                    <button className="btn-ghost !py-2 text-xs" disabled={busy === b.id} onClick={() => check(b.id, true)}>Simulate a drop (demo)</button>
                  </div>
                </div>
                <button onClick={() => setCancelling(b)} className="btn-quiet mt-3 !px-3 !py-1.5 text-xs text-danger-600">
                  Cancel this {b.kind === 'flight' ? 'flight' : 'stay'}
                </button>
              </>
            )}
          </li>
        );
      })}

      {cancelling && (
        <CancelTrip
          booking={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(message) => {
            setCancelling(null);
            toast.show(message, 'success');
            onChange();
          }}
        />
      )}
    </ul>
  );
}

/**
 * Cancelling a trip, with the fee shown before it is charged.
 *
 * The quote is fetched fresh when the sheet opens rather than computed in the
 * browser: the fee depends on how close departure is, and the server is the
 * only clock worth trusting for that.
 */
function CancelTrip({
  booking,
  onClose,
  onCancelled,
}: {
  booking: Booking;
  onClose: () => void;
  onCancelled: (message: string) => void;
}) {
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    more
      .cancellationQuote(booking.id)
      .then((r) => setQuote(r.quote))
      .catch((cause: Error) => setError(cause.message));
  }, [booking.id]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await more.cancelBooking(booking.id);
      onCancelled(
        result.quote.feeCents > 0
          ? `Cancelled — ${formatMoney(result.quote.refundCents)} back, ${formatMoney(result.quote.feeCents)} fee`
          : `Cancelled — ${formatMoney(result.quote.refundCents)} back, no fee`,
      );
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Cancel ${booking.title}`}
      footer={
        quote ? (
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost flex-1">Keep my trip</button>
            <button onClick={() => void confirm()} disabled={busy} className="btn-danger flex-1">
              {busy ? 'Cancelling…' : 'Cancel it'}
            </button>
          </div>
        ) : undefined
      }
    >
      {error && !quote ? (
        <ErrorState message={error} onRetry={() => more.cancellationQuote(booking.id).then((r) => setQuote(r.quote))} />
      ) : !quote ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-700">Back on your card</dt>
              <dd className="font-display text-xl font-bold text-accent-600 tnum">{formatMoney(quote.refundCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-700">Cancellation fee</dt>
              <dd className={`font-display text-xl font-bold tnum ${quote.feeCents > 0 ? 'text-danger-600' : 'text-ink-500'}`}>
                {quote.feeCents > 0 ? `−${formatMoney(quote.feeCents)}` : 'None'}
              </dd>
            </div>
            {quote.milesRefunded > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-700">Miles returned</dt>
                <dd className="font-display text-xl font-bold text-ink-900 tnum">
                  {quote.milesRefunded.toLocaleString('en-US')}
                </dd>
              </div>
            )}
          </dl>

          <p className="rounded-xl bg-surface-sunken px-4 py-3 text-sm leading-relaxed text-ink-700">{quote.reason}</p>

          {quote.free && quote.freeWindowHoursLeft > 0 && (
            <p className="rounded-xl bg-accent-50 px-4 py-3 text-sm leading-relaxed text-accent-900">
              You have about {quote.freeWindowHoursLeft} hour{quote.freeWindowHoursLeft === 1 ? '' : 's'} left to cancel
              for nothing. After that a fee applies, and it grows as departure gets closer.
            </p>
          )}

          {booking.milesEarned > 0 && (
            <p className="text-xs leading-relaxed text-ink-600">
              The {booking.milesEarned.toLocaleString('en-US')} miles this trip earned will be taken back — you keep
              rewards for trips you take, not ones you cancel.
            </p>
          )}

          {error && <p role="alert" className="text-sm font-medium text-danger-600">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}

function Offers() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { more.offers().then(setOffers).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const totalProjected = useMemo(() => (offers ?? []).filter((o) => o.activated).reduce((s, o) => s + o.projectedCents, 0), [offers]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!offers) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-700">
        Sorted by what each offer would have earned you on last month’s spending. Turn one on and it applies automatically when you pay with your card.
        {totalProjected > 0 && <strong className="font-semibold text-accent-700"> Your active offers: about {formatMoney(totalProjected)} back a month.</strong>}
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {offers.map((o) => (
          <li key={o.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-ink-900">{o.merchant}</p>
                <p className="text-sm text-ink-700">{o.headline} · up to {formatMoney(o.maxCents)}</p>
              </div>
              {o.youShopHere && <Chip tone="accent">You shop here</Chip>}
            </div>
            <p className="mt-2 text-xs text-ink-600">
              {o.projectedCents > 0 ? `Would have earned you ${formatMoney(o.projectedCents)} last month` : 'New to you'} · ends in {o.expiresInDays} days
            </p>
            <button
              onClick={() => more.setOffer(o.id, !o.activated).then(setOffers)}
              aria-pressed={o.activated}
              className={`mt-3 ${o.activated ? 'btn-ghost' : 'btn-accent'}`}
            >
              {o.activated ? '✓ Added to card' : 'Add to card'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TravelPage() {
  const t = useT();
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <TravelInner />
    </Suspense>
  );
}
