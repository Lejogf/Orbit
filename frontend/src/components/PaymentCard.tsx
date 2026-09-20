'use client';

// A card that looks like the card in your wallet.
//
// Each tier has its own material: matte for the starter cards, frosted for
// Rise, brushed metal for Summit. The sheen follows the pointer, which is what
// makes a flat rectangle read as a physical object.
import { useRef, useState } from 'react';
import type { CardArt } from '@/lib/api';
import { OrbitMark } from '@/components/brand';

export interface PaymentCardProps {
  name: string;
  last4: string;
  holder: string;
  art: CardArt;
  /**
   * Debit or credit, printed on the card face the way a real one is. This is
   * the distinction people actually need: a debit card spends money you have,
   * a credit card spends the bank's and bills you for it.
   */
  funding?: 'debit' | 'credit';
  /** Shows the full number instead of the masked one. */
  revealedNumber?: string | null;
  expiry?: string;
  locked?: boolean;
  /** Smaller, for lists and rails. */
  size?: 'sm' | 'md' | 'lg';
  business?: boolean;
  className?: string;
}

const TEXTURES: Record<CardArt['texture'], string> = {
  matte: 'after:opacity-0',
  frost: 'after:opacity-100 after:bg-[radial-gradient(120%_120%_at_20%_0%,rgba(255,255,255,0.45),transparent_55%)]',
  metal:
    'after:opacity-100 after:bg-[repeating-linear-gradient(115deg,rgba(255,255,255,0.16)_0px,rgba(255,255,255,0.16)_1px,transparent_1px,transparent_4px)]',
};

export function PaymentCard({
  name,
  last4,
  holder,
  art,
  funding,
  revealedNumber,
  expiry = '08/29',
  locked = false,
  size = 'md',
  business = false,
  className = '',
}: PaymentCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, active: false });

  const dims = size === 'lg' ? 'w-[21rem] text-[0.9375rem]' : size === 'sm' ? 'w-[13.5rem] text-[0.6875rem]' : 'w-[18rem] text-sm';
  // The card is a physical object, so its ink does NOT follow the app theme —
  // a card in your wallet looks the same at noon and at midnight. What it does
  // follow is its own artwork: light ink on dark plastic, dark ink on pale
  // metal. The muted tone was /70, which washed out over a gradient; /80 plus a
  // faint shadow keeps the small print readable on every finish.
  // These are literal colours, not theme tokens, and that is deliberate. The
  // card's artwork is fixed hex (a pale metal Summit card is pale in both
  // themes), so its ink must be fixed too. `text-ink-900` would have inverted
  // with the theme and put white text on the pale metal card in dark mode.
  const ink = art.ink === 'dark' ? 'text-[#0d1713]' : 'text-white';
  const muted = art.ink === 'dark' ? 'text-[#0d1713]/75' : 'text-white/80';
  const legible = art.ink === 'dark' ? '' : '[text-shadow:0_1px_2px_rgb(0_0_0_/_0.45)]';
  const badge =
    art.ink === 'dark'
      ? 'bg-[#0d1713]/15 text-[#0d1713] ring-[#0d1713]/30'
      : 'bg-white/20 text-white ring-white/35';

  const onMove = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    setTilt({ x: -y * 9, y: x * 12, active: true });
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0, active: false })}
      style={{
        background: `linear-gradient(135deg, ${art.from} 0%, ${art.to} 100%)`,
        transform: tilt.active ? `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(1.015)` : undefined,
      }}
      className={`relative aspect-[1.586/1] shrink-0 overflow-hidden rounded-2xl p-5 shadow-float transition-transform duration-200 ease-spring after:pointer-events-none after:absolute after:inset-0 after:content-[''] ${TEXTURES[art.texture]} ${dims} ${ink} ${legible} ${className}`}
    >
      {/* Sheen */}
      <div className="pointer-events-none absolute inset-0 bg-glass-sheen opacity-70" aria-hidden="true" />

      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`text-[0.625rem] font-semibold uppercase tracking-[0.16em] ${muted}`}>
              {business ? 'Orbit Business' : 'Orbit'}
            </p>
            <p className="font-display text-[1.05em] font-bold leading-tight">{name}</p>
            {funding && (
              <span
                className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-[0.18em] ring-1 ${badge}`}
              >
                {funding}
              </span>
            )}
          </div>
          <span className={art.ink === 'dark' ? 'opacity-80' : 'opacity-95'}>
            <OrbitMark size={size === 'sm' ? 22 : 30} />
          </span>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {/* Chip and contactless: the details that make it read as a real card. */}
            <div className="mb-3 flex items-center gap-2">
              <span
                className="grid h-6 w-8 place-items-center rounded-[4px] bg-[linear-gradient(135deg,#f5d98a,#c9a227)] shadow-sm"
                aria-hidden="true"
              >
                <span className="block h-3 w-5 rounded-[2px] border border-black/25" />
              </span>
              <svg viewBox="0 0 24 24" className={`h-4 w-4 ${muted}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                <path d="M8.5 8a5 5 0 0 1 0 8M12 5.5a8.5 8.5 0 0 1 0 13M5 10.5a2.5 2.5 0 0 1 0 3" />
              </svg>
            </div>
            <p className="font-mono text-[1.05em] tracking-[0.12em] tnum">
              {revealedNumber ?? `•••• •••• •••• ${last4}`}
            </p>
            <p className={`mt-2 truncate text-[0.72em] uppercase tracking-[0.1em] ${muted}`}>{holder}</p>
          </div>
          <div className="text-right">
            <p className={`text-[0.6em] uppercase tracking-[0.12em] ${muted}`}>Exp</p>
            <p className="font-mono text-[0.85em] tnum">{expiry}</p>
          </div>
        </div>
      </div>

      {locked && (
        <div className="absolute inset-0 grid place-items-center bg-ink-900/55 backdrop-blur-[3px]">
          <span className="flex items-center gap-2 rounded-full bg-canvas px-3.5 py-2 text-xs font-bold text-ink-900">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Locked
          </span>
        </div>
      )}
    </div>
  );
}
