'use client';

// Investing, for people doing it for the first time.
//
// Every instrument says what it actually is and how much it moves, orders start
// at $1, and the risk note is shown without being asked for. Points can buy
// shares at the same 1:1 rate as cash — the gentlest possible first investment,
// because it costs nothing you were counting on.
import { useCallback, useEffect, useState } from 'react';
import { money, type InvestResponse, type PricePoint, type PriceSource, type Quote, type ValuedPosition } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { PriceChart } from '@/components/PriceChart';
import { Chip, ErrorState, Field, Money, PageHeader, SectionCard, Segmented, Sheet, Skeleton } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n';

const RISK_TONE = { lower: 'accent', medium: 'info', higher: 'warn' } as const;
const RISK_LABEL = { lower: 'Steadier', medium: 'Moves a bit', higher: 'Moves a lot' } as const;

export default function InvestPage() {
  const t = useT();
  const toast = useToast();
  const [data, setData] = useState<InvestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'portfolio' | 'market'>('portfolio');
  const [trading, setTrading] = useState<{ quote: Quote; side: 'buy' | 'sell'; position?: ValuedPosition } | null>(null);
  /** The symbol whose chart is open. Tapping a row is how you ask for a price. */
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    money.invest().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const portfolio = data?.portfolio;
  const invested = (portfolio?.valueCents ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('nav.invest')} title={t('page.invest.title')} subtitle={t('page.invest.subtitle')} />

      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Portfolio value */}
          <section className="rounded-2xl bg-ink-sheen p-6 text-canvas shadow-raised">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] opacity-70">Portfolio value</p>
            <p className="mt-1.5 hero-number">{formatCents(portfolio?.valueCents ?? 0)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                <Money cents={portfolio?.dayChangeCents ?? 0} signed tone={(portfolio?.dayChangeCents ?? 0) >= 0 ? 'positive' : 'negative'} className="font-semibold" />
                <span className="ml-1.5 opacity-70">today</span>
              </span>
              <span>
                <Money cents={portfolio?.gainCents ?? 0} signed className="font-semibold" />
                <span className="ml-1.5 opacity-70">
                  all time {portfolio && portfolio.costBasisCents > 0 ? `(${(portfolio.gainPercent * 100).toFixed(1)}%)` : ''}
                </span>
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 border-t border-canvas/15 pt-4 text-sm">
              <span className="opacity-80">Cash to invest: <strong className="font-semibold">{formatCents(data.availableCents)}</strong></span>
              <span className="opacity-80">Points: <strong className="font-semibold">{data.points.toLocaleString('en-US')}</strong> ({formatCents(data.pointsValueCents)})</span>
            </div>
          </section>

          {data.riskNote && (
            <p className="rounded-2xl border border-warn-300 bg-warn-50 px-4 py-3 text-sm leading-relaxed text-warn-800" role="status">
              <strong className="font-semibold">Worth knowing: </strong>
              {data.riskNote}
            </p>
          )}

          <Segmented
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              ['portfolio', `Holdings${portfolio?.positions.length ? ` (${portfolio.positions.length})` : ''}`],
              ['market', 'Browse'],
            ] as const}
          />

          {tab === 'portfolio' ? (
            invested ? (
              <SectionCard>
                <ul className="divide-y divide-line">
                  {portfolio!.positions.map((position) => (
                    <li key={position.symbol} className="flex items-center gap-3 py-3.5">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-sunken font-display text-xs font-bold text-ink-800">
                        {position.symbol}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">{position.name}</p>
                        <p className="text-xs text-ink-500 tnum">
                          {position.quantity.toFixed(position.quantity < 1 ? 6 : 4)} × {formatCents(position.priceCents)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-ink-900 tnum">{formatCents(position.valueCents)}</p>
                        <p className="text-xs">
                          <Money cents={position.gainCents} signed />
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const quote = data.market.find((q) => q.symbol === position.symbol);
                          if (quote) setTrading({ quote, side: 'sell', position });
                        }}
                        className="btn-ghost !px-3 !py-1.5 text-xs"
                      >
                        Sell
                      </button>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : (
              <SectionCard>
                <div className="py-6 text-center">
                  <h2 className="font-display text-xl font-bold text-ink-900">Start with a dollar</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-700">
                    You don’t need a lot to begin. A broad fund spreads your money across hundreds of companies at once, which is
                    why most people start there rather than picking a single stock.
                  </p>
                  <button onClick={() => setTab('market')} className="btn-primary mt-4">
                    Browse investments
                  </button>
                </div>
              </SectionCard>
            )
          ) : (
            <>
              <MarketDataNote status={data.marketData} />
              <ul className="grid gap-3 sm:grid-cols-2">
                {data.market.map((quote) => (
                  <li key={quote.symbol} className="card flex flex-col p-4">
                    {/* The whole row opens the chart. "Touch it and get the
                        price" should not require finding a small target. */}
                    <button
                      onClick={() => setViewing(quote.symbol)}
                      className="-m-1 rounded-xl p-1 text-left transition hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                      aria-label={`${quote.name}, ${formatCents(quote.priceCents)}. Open its chart.`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-base font-bold text-ink-900">{quote.symbol}</span>
                            <Chip tone={RISK_TONE[quote.risk]}>{RISK_LABEL[quote.risk]}</Chip>
                            {quote.source === 'live' && <LivePip />}
                          </div>
                          <p className="truncate text-sm text-ink-700">{quote.name}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-ink-900 tnum">{formatCents(quote.priceCents)}</p>
                          <p className={`text-xs font-semibold tnum ${quote.changeCents >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>
                            {quote.changeCents >= 0 ? '▲' : '▼'} {(Math.abs(quote.changePercent) * 100).toFixed(2)}%
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-ink-600">{quote.blurb}</p>
                    </button>

                    <div className="mt-auto flex items-center gap-3 pt-3">
                      <button onClick={() => setViewing(quote.symbol)} className="btn-ghost flex-1 !py-2 text-sm">
                        Chart
                      </button>
                      <button onClick={() => setTrading({ quote, side: 'buy' })} className="btn-accent flex-1 !py-2 text-sm">
                        Buy
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Moving out */}
          <SectionCard title="Take your investments elsewhere">
            <p className="text-sm leading-relaxed text-ink-700">
              Your holdings are yours. An in-kind transfer moves the shares themselves to another broker — nothing is sold, so there
              is no tax bill and you stay invested the whole time. It usually takes 5–7 business days.
            </p>
            <button
              onClick={async () => {
                const broker = window.prompt('Which broker would you like to transfer to?');
                if (!broker) return;
                const result = await money.transferOut(broker);
                toast.show(`Transfer to ${result.broker} started — ${result.positions} positions`, 'success');
              }}
              className="btn-ghost mt-3"
            >
              Start a transfer
            </button>
          </SectionCard>

          {data.trades.length > 0 && (
            <SectionCard title="Your orders">
              <ul className="divide-y divide-line">
                {data.trades.map((trade) => (
                  <li key={trade.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-ink-800">
                      <strong className="font-semibold capitalize">{trade.side}</strong> {trade.symbol}
                      {trade.fundedBy === 'points' && <span className="ml-2 text-xs text-accent-600">with points</span>}
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold text-ink-900 tnum">{formatCents(trade.amountCents)}</span>
                      <span className="text-xs text-ink-500">{new Date(trade.createdAt).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <p className="text-xs leading-relaxed text-ink-500">
            Investments can go down as well as up, and you can get back less than you put in. Prices in this demo are simulated,
            not live market data. Crypto is not insured.
          </p>
        </>
      )}

      {viewing && (
        <InstrumentSheet
          symbol={viewing}
          onClose={() => setViewing(null)}
          onBuy={(quote) => {
            setViewing(null);
            setTrading({ quote, side: 'buy' });
          }}
        />
      )}

      {trading && (
        <TradeSheet
          state={trading}
          availableCents={data?.availableCents ?? 0}
          points={data?.points ?? 0}
          onClose={() => setTrading(null)}
          onDone={(message) => {
            toast.show(message, 'success');
            setTrading(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TradeSheet({
  state,
  availableCents,
  points,
  onClose,
  onDone,
}: {
  state: { quote: Quote; side: 'buy' | 'sell'; position?: ValuedPosition };
  availableCents: number;
  points: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { quote, side, position } = state;
  const [amount, setAmount] = useState('');
  const [fundedBy, setFundedBy] = useState<'cash' | 'points'>('cash');
  const [sellAll, setSellAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ points: PricePoint[]; source: PriceSource } | null>(null);

  useEffect(() => {
    money
      .instrument(quote.symbol, 90)
      .then((r) => setHistory({ points: r.history, source: r.historySource }))
      .catch(() => setHistory({ points: [], source: 'simulated' }));
  }, [quote.symbol]);

  const amountCents = Math.round((Number.parseFloat(amount.replace(/[^0-9.]/g, '')) || 0) * 100);
  const shares = quote.priceCents > 0 ? amountCents / quote.priceCents : 0;
  const sellQuantity = sellAll ? position?.quantity ?? 0 : amountCents / quote.priceCents;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (side === 'buy') {
        await money.buy(quote.symbol, amountCents, fundedBy);
        onDone(`Bought ${formatCents(amountCents)} of ${quote.symbol}`);
      } else {
        await money.sell(quote.symbol, sellQuantity);
        onDone(`Sold ${quote.symbol}`);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const max = side === 'buy' ? (fundedBy === 'points' ? points : availableCents) : position?.valueCents ?? 0;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${side === 'buy' ? 'Buy' : 'Sell'} ${quote.symbol}`}
      footer={
        <button onClick={() => void submit()} disabled={busy || (side === 'buy' ? amountCents <= 0 : sellQuantity <= 0)} className="btn-primary w-full">
          {busy ? 'Placing order…' : side === 'buy' ? `Buy ${amountCents > 0 ? formatCents(amountCents) : ''}` : sellAll ? 'Sell everything' : `Sell ${amountCents > 0 ? formatCents(amountCents) : ''}`}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-display text-xl font-bold text-ink-900">{quote.name}</p>
            <p className="text-sm text-ink-600">{quote.blurb}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-xl font-bold text-ink-900 tnum">{formatCents(quote.priceCents)}</p>
            <p className={`text-xs font-semibold ${quote.changeCents >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>
              {(quote.changePercent * 100).toFixed(2)}% today
            </p>
          </div>
        </div>

        {history && history.points.length > 1 && (
          <PriceChart points={history.points} source={history.source} size="sm" label="Latest close" />
        )}

        {side === 'buy' && (
          <Segmented
            label="Pay with"
            size="sm"
            value={fundedBy}
            onChange={setFundedBy}
            options={[
              ['cash', `Cash (${formatCents(availableCents)})`],
              ['points', `Points (${formatCents(points)})`],
            ] as const}
          />
        )}

        <Field label={side === 'buy' ? 'How much to invest' : 'How much to sell'} htmlFor="trade-amount" error={error}>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-display text-2xl font-bold text-ink-400">$</span>
            <input
              id="trade-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSellAll(false);
              }}
              inputMode="decimal"
              placeholder="0.00"
              className="field py-4 pl-10 font-display text-2xl font-bold tnum"
            />
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          {[1000, 2500, 10000].map((preset) => (
            <button key={preset} onClick={() => { setAmount((preset / 100).toFixed(0)); setSellAll(false); }} className="btn-ghost !px-3 !py-1.5 text-xs">
              {formatCents(preset)}
            </button>
          ))}
          <button
            onClick={() => {
              if (side === 'sell') setSellAll(true);
              setAmount((max / 100).toFixed(2));
            }}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            {side === 'buy' ? 'Max' : 'Everything'}
          </button>
        </div>

        <dl className="rounded-xl bg-surface-sunken p-3.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">{side === 'buy' ? 'You’ll own' : 'You’ll sell'}</dt>
            <dd className="font-semibold text-ink-900 tnum">
              {(side === 'buy' ? shares : sellQuantity).toFixed(6)} {quote.symbol}
            </dd>
          </div>
          {position && (
            <div className="mt-1.5 flex justify-between">
              <dt className="text-ink-600">You hold</dt>
              <dd className="text-ink-800 tnum">{position.quantity.toFixed(6)} ({formatCents(position.valueCents)})</dd>
            </div>
          )}
        </dl>

        {quote.risk === 'higher' && side === 'buy' && (
          <p className="rounded-xl bg-warn-50 px-3.5 py-3 text-xs leading-relaxed text-warn-800">
            This one moves a lot. Only put in money you could manage without for a few years.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** A quiet "this number is real" marker. Never the only signal: the chart and
 *  the detail sheet both say it in words too. */
function LivePip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-accent-700">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />
      Live
    </span>
  );
}

/**
 * What the market data is actually doing. Alpha Vantage's free tier allows 25
 * calls a day and one a second, so the board warms up over a few seconds rather
 * than arriving live. Saying so beats a page that silently shows made-up
 * numbers next to real ones.
 */
function MarketDataNote({ status }: { status: InvestResponse['marketData'] }) {
  if (!status.configured) {
    return (
      <p className="mb-3 rounded-xl bg-surface-sunken px-4 py-2.5 text-xs leading-relaxed text-ink-600">
        No market data key is configured, so every price here is simulated — generated from the symbol and the date, so the
        same day always shows the same number.
      </p>
    );
  }
  // The free tier is 25 calls a day. Once those are gone, more waiting will not
  // help, so say that rather than telling someone to reload for ever.
  const spent = status.callsToday >= status.dailyBudget;
  if (spent) {
    return (
      <p className="mb-3 rounded-xl bg-warn-50 px-4 py-2.5 text-xs leading-relaxed text-warn-900">
        Today&rsquo;s {status.dailyBudget} live price requests are used up, so anything without a{' '}
        <strong className="font-semibold">Live</strong> badge is showing a simulated price. The allowance resets at
        midnight UTC.
      </p>
    );
  }
  if (status.warming > 0) {
    return (
      <p className="mb-3 rounded-xl bg-info-50 px-4 py-2.5 text-xs leading-relaxed text-info-900">
        Fetching live prices for {status.warming} more {status.warming === 1 ? 'investment' : 'investments'}. Anything not
        marked <strong className="font-semibold">Live</strong> yet is simulated — reload in a moment.
      </p>
    );
  }
  return (
    <p className="mb-3 text-xs text-ink-500">
      Live prices from {status.provider}, {status.callsToday} of {status.dailyBudget} daily requests used. Tap any
      investment for its chart.
    </p>
  );
}

/**
 * One investment, full size: the live price, a scrubbable chart, what it is,
 * and how risky it is. Reached by tapping a row, which is how someone asks
 * "what is this worth right now?".
 */
function InstrumentSheet({
  symbol,
  onClose,
  onBuy,
}: {
  symbol: string;
  onClose: () => void;
  onBuy: (quote: Quote) => void;
}) {
  const [detail, setDetail] = useState<{ quote: Quote; history: PricePoint[]; historySource: PriceSource } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Segmented takes string values, so the range is a string and parsed once.
  const [range, setRange] = useState<'30' | '90'>('90');
  const days = Number(range);

  useEffect(() => {
    setDetail(null);
    setError(null);
    money
      .instrument(symbol, days)
      .then(setDetail)
      .catch((cause: Error) => setError(cause.message));
  }, [symbol, days]);

  return (
    <Sheet
      open
      onClose={onClose}
      title={symbol}
      footer={
        detail ? (
          <button onClick={() => onBuy(detail.quote)} className="btn-accent w-full">
            Buy {symbol} from $1
          </button>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={() => setRange((r) => r)} />
      ) : !detail ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-44" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-xl font-bold text-ink-900">{detail.quote.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Chip tone={RISK_TONE[detail.quote.risk]}>{RISK_LABEL[detail.quote.risk]}</Chip>
                {detail.quote.source === 'live' ? (
                  <LivePip />
                ) : (
                  <Chip tone="info">Simulated price</Chip>
                )}
              </div>
            </div>
            <Segmented
              label="Range"
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                ['30', '1M'],
                ['90', '3M'],
              ] as const}
            />
          </div>

          <PriceChart points={detail.history} source={detail.historySource} label="Latest close" />

          <p className="text-sm leading-relaxed text-ink-700">{detail.quote.blurb}</p>

          <p className="rounded-xl bg-surface-sunken px-4 py-3 text-xs leading-relaxed text-ink-600">
            {detail.quote.source === 'live' ? (
              <>
                Priced from the market close on{' '}
                {new Date(detail.quote.asOf).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. An order fills
                at the price shown when you confirm it.
              </>
            ) : (
              <>
                This price is simulated, not live — generated from the symbol and the date so the same day always shows the
                same number. Everything else here (what you own, what you paid, profit and loss) is real arithmetic on it.
              </>
            )}
          </p>
        </div>
      )}
    </Sheet>
  );
}


