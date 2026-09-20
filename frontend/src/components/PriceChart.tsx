'use client';

// A price chart you can actually read a number off.
//
// A sparkline tells you the shape of the last three months and nothing else.
// Someone deciding whether to put $20 into a fund wants to point at a dip and
// ask "what was it worth then?" — so this chart is scrubbable by mouse AND by
// touch, and answers with a date and a price rather than a shape.
//
// Three things it does that a sparkline does not:
//   * an axis, so the range is anchored to real numbers;
//   * a crosshair that follows the pointer or finger and reads out the value;
//   * a stated source, because a simulated price must never look live.
//
// Colour is never the only signal: the change is always written as a signed
// percentage next to the line, so it survives colour-blind-safe mode.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { PricePoint, PriceSource } from '@/lib/api';
import { formatCents } from '@/lib/format';

/** The plot area inside the viewBox, leaving room for the axis labels. */
const VIEW = { w: 100, h: 42, top: 3, bottom: 6 };

export interface PriceChartProps {
  points: PricePoint[];
  source: PriceSource;
  /** Shown above the chart when scrubbing has not started. */
  label?: string;
  /** Taller, for a detail view rather than a card. */
  size?: 'sm' | 'lg';
  className?: string;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function PriceChart({ points, source, label, size = 'lg', className = '' }: PriceChartProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((p) => p.priceCents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series would divide by zero and draw a line through the roof.
    const span = Math.max(1, max - min);
    const plot = VIEW.h - VIEW.top - VIEW.bottom;

    const x = (i: number) => (i / (points.length - 1)) * VIEW.w;
    const y = (cents: number) => VIEW.top + plot - ((cents - min) / span) * plot;

    const line = points.map((p, i) => `${x(i)},${y(p.priceCents)}`).join(' ');
    // The area is the line, dropped to the baseline and closed.
    const area = `M ${x(0)},${VIEW.h - VIEW.bottom} L ${points.map((p, i) => `${x(i)},${y(p.priceCents)}`).join(' L ')} L ${x(points.length - 1)},${VIEW.h - VIEW.bottom} Z`;

    const first = values[0]!;
    const last = values.at(-1)!;
    return { min, max, x, y, line, area, rising: last >= first, changeRatio: first > 0 ? (last - first) / first : 0 };
  }, [points]);

  /** Map a pointer position to the nearest data point. */
  const scrub = useCallback(
    (clientX: number) => {
      const box = svg.current?.getBoundingClientRect();
      if (!box || points.length < 2) return;
      const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      setActive(Math.round(ratio * (points.length - 1)));
    },
    [points.length],
  );

  if (!chart) {
    return <p className={`py-6 text-center text-sm text-ink-600 ${className}`}>Not enough price history to chart yet.</p>;
  }

  const point = active !== null ? points[active] : null;
  const stroke = chart.rising ? 'rgb(var(--accent-500))' : 'rgb(var(--danger-500))';
  const gradientId = `price-fade-${chart.rising ? 'up' : 'down'}`;

  return (
    <figure className={className}>
      {/* The readout. It holds its height whether scrubbing or not, so the
          chart does not jump as a finger moves across it. */}
      <div className="mb-1.5 flex min-h-[2.25rem] items-baseline justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold text-ink-900 tnum">
            {formatCents(point ? point.priceCents : points.at(-1)!.priceCents)}
          </p>
          <p className="text-[0.6875rem] text-ink-500">{point ? shortDate(point.date) : (label ?? 'Latest')}</p>
        </div>
        <p className={`text-sm font-semibold tnum ${chart.rising ? 'text-accent-600' : 'text-danger-600'}`}>
          {chart.rising ? '▲' : '▼'} {(Math.abs(chart.changeRatio) * 100).toFixed(2)}%
        </p>
      </div>

      <svg
        ref={svg}
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        preserveAspectRatio="none"
        className={`w-full touch-none ${size === 'lg' ? 'h-44' : 'h-24'}`}
        role="img"
        aria-label={`Price over ${points.length} days, from ${formatCents(points[0]!.priceCents)} on ${shortDate(points[0]!.date)} to ${formatCents(points.at(-1)!.priceCents)} on ${shortDate(points.at(-1)!.date)}.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          // Mouse hovers without pressing; a finger must be down. `e.buttons`
          // is 0 for a hovering mouse and non-zero once anything is pressed.
          if (e.pointerType === 'mouse' || e.buttons > 0) scrub(e.clientX);
        }}
        onPointerUp={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>

        <path d={chart.area} fill={`url(#${gradientId})`} />
        <polyline
          points={chart.line}
          fill="none"
          stroke={stroke}
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {point && active !== null && (
          <g>
            <line
              x1={chart.x(active)}
              y1={VIEW.top}
              x2={chart.x(active)}
              y2={VIEW.h - VIEW.bottom}
              stroke="rgb(var(--ink-400))"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={chart.x(active)}
              cy={chart.y(point.priceCents)}
              r={2.4}
              fill="rgb(var(--surface))"
              stroke={stroke}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>

      <div className="mt-1 flex items-baseline justify-between text-[0.6875rem] text-ink-500 tnum">
        <span>{shortDate(points[0]!.date)}</span>
        <span className="text-ink-400">
          low {formatCents(chart.min)} · high {formatCents(chart.max)}
        </span>
        <span>{shortDate(points.at(-1)!.date)}</span>
      </div>

      <figcaption className="mt-1.5 text-center text-[0.6875rem] text-ink-500">
        {points.length} days ·{' '}
        {source === 'live' ? (
          <span className="font-semibold text-accent-600">Live daily closes from Alpha Vantage</span>
        ) : (
          <span>Simulated prices — no live data for this one right now</span>
        )}{' '}
        · drag across the chart to read any day
      </figcaption>
    </figure>
  );
}
