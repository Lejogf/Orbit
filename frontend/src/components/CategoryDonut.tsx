'use client';

// Spending by category as a donut, with a labelled legend beside it.
//
// The palette is the validated eight-slot categorical set: worst adjacent
// colour-blind separation ΔE 9.1, above the 8 target. Hues are assigned in a
// fixed order and never cycled — past eight categories the tail folds into
// "Other" rather than inventing a ninth colour. Every slice is also named and
// valued in the legend, so nothing depends on colour alone.
import { useState } from 'react';
import { formatMoney } from '@/lib/format';

/** Fixed order. Slot 9 is the neutral "Other". */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER = '#6b7280';

export interface Slice {
  category: string;
  cents: number;
  share: number;
}

const TAU = Math.PI * 2;

/** An SVG arc path for a ring segment. */
function arc(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(outer, from);
  const [x2, y2] = p(outer, to);
  const [x3, y3] = p(inner, to);
  const [x4, y4] = p(inner, from);
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

export function CategoryDonut({ categories, totalCents }: { categories: Slice[]; totalCents: number }) {
  const [active, setActive] = useState<string | null>(null);

  const spent = categories.filter((c) => c.cents > 0);
  if (spent.length === 0 || totalCents <= 0) {
    return <p className="py-8 text-center text-sm text-ink-600">No spending to chart this month.</p>;
  }

  // Keep the eight biggest; everything smaller becomes one "Other" slice.
  const top = spent.slice(0, SERIES.length);
  const rest = spent.slice(SERIES.length);
  const restCents = rest.reduce((s, c) => s + c.cents, 0);
  const slices = [
    ...top.map((c, i) => ({ ...c, color: SERIES[i]!, label: c.category })),
    ...(restCents > 0
      ? [{ category: 'Other', label: `Other (${rest.length})`, cents: restCents, share: restCents / totalCents, color: OTHER }]
      : []),
  ];

  const shown = slices.reduce((s, c) => s + c.cents, 0);
  // A 2px gap of surface between segments keeps neighbouring hues apart.
  const gap = 0.016;
  let angle = -Math.PI / 2;

  const highlighted = slices.find((s) => s.category === active) ?? null;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <figure className="relative shrink-0" onMouseLeave={() => setActive(null)}>
        <svg viewBox="0 0 200 200" className="h-52 w-52 overflow-visible" role="img" aria-label={`Spending by category, ${formatMoney(totalCents)} total`}>
          {slices.map((slice) => {
            const sweep = (slice.cents / shown) * TAU;
            const from = angle + gap / 2;
            const to = angle + sweep - gap / 2;
            angle += sweep;
            const isActive = active === slice.category;
            const end = Math.max(from + 0.004, to);
            return (
              <g key={slice.category}>
                <path
                  d={arc(100, 100, 90, 58, from, end)}
                  fill={slice.color}
                  className="cursor-pointer transition-opacity duration-200"
                  opacity={active && !isActive ? 0.45 : 1}
                  onMouseEnter={() => setActive(slice.category)}
                  onFocus={() => setActive(slice.category)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  role="listitem"
                  aria-label={`${slice.label}: ${formatMoney(slice.cents)}, ${Math.round(slice.share * 100)} percent`}
                />
                {/* The selected slice gets an outline that follows its own arc,
                    rather than a box or a wedge that changes size. */}
                {isActive && (
                  <path
                    d={arc(100, 100, 96, 54, from, end)}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    className="pointer-events-none"
                  />
                )}
              </g>
            );
          })}
        </svg>
        {/* The hero number sits in the hole, and follows what you hover. */}
        <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[6.5rem] truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-500">
            {highlighted ? highlighted.label : 'Total'}
          </span>
          <span className="text-xl font-semibold text-ink-900 tnum">
            {formatMoney(highlighted ? highlighted.cents : totalCents)}
          </span>
          {highlighted && <span className="text-xs text-ink-600 tnum">{Math.round(highlighted.share * 100)}%</span>}
        </figcaption>
      </figure>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.category}>
            <button
              onMouseEnter={() => setActive(slice.category)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(slice.category)}
              onBlur={() => setActive(null)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                active === slice.category ? 'bg-surface-sunken' : 'hover:bg-surface-sunken'
              }`}
            >
              <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: slice.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{slice.label}</span>
              <span className="shrink-0 text-sm font-semibold text-ink-900 tnum">{formatMoney(slice.cents)}</span>
              <span className="w-10 shrink-0 text-right text-xs text-ink-600 tnum">{Math.round(slice.share * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
