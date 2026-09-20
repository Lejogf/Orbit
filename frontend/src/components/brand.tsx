'use client';

// Orbit's brand marks.
//
// The symbol is an orbit: a ring with a satellite, drawn in the brand green.
// Ori — the assistant — uses the supplied star mark, which spins once when the
// assistant is opened.

export function OrbitMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} role="img" aria-label="Orbit">
      <defs>
        <linearGradient id="orbit-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent-400))" />
          <stop offset="100%" stopColor="rgb(var(--accent-600))" />
        </linearGradient>
      </defs>
      <ellipse cx="24" cy="24" rx="19" ry="11" transform="rotate(-28 24 24)" fill="none" stroke="url(#orbit-ring)" strokeWidth="3.2" />
      <circle cx="24" cy="24" r="7.5" fill="rgb(var(--ink-900))" />
      <circle cx="24" cy="24" r="3" fill="rgb(var(--canvas))" />
      <circle cx="39" cy="15" r="4" fill="rgb(var(--accent-500))" />
    </svg>
  );
}

export function OrbitWordmark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <OrbitMark size={compact ? 30 : 34} />
      {!compact && (
        <span className="font-display text-[1.45rem] font-bold tracking-[-0.03em] text-ink-900">
          Orbit
        </span>
      )}
    </span>
  );
}

/**
 * Ori's avatar. `spinning` plays one rotation — used when the assistant opens,
 * so the mark feels alive without animating forever in the corner.
 */
export function OriAvatar({ size = 40, spinning = false, className = '' }: { size?: number; spinning?: boolean; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-900 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand mark, not content */}
      <img
        src="/ori.png"
        alt=""
        width={size}
        height={size}
        className={`h-full w-full object-cover ${spinning ? 'animate-orbit' : ''}`}
      />
    </span>
  );
}
