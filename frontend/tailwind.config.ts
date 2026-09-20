import type { Config } from 'tailwindcss';

/**
 * Orbit's design system.
 *
 * Every colour is a CSS variable holding an RGB triplet, so one set of utility
 * classes renders correctly in light, dark and high-contrast modes — the theme
 * swaps the variables, not the markup.
 *
 * - ink      the neutral scale: text, surfaces, borders
 * - accent   Orbit green, from the brand mark: growth, money coming in
 * - danger / warn / info  reserved states, never decorative
 */
const themed = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const scale = (name: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [step, themed(`${name}-${step}`)]),
  ) as Record<string, string>;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: themed('canvas'),
        surface: { DEFAULT: themed('surface'), raised: themed('surface-raised'), sunken: themed('surface-sunken') },
        line: { DEFAULT: themed('line'), strong: themed('line-strong') },
        ink: scale('ink'),
        accent: scale('accent'),
        danger: scale('danger'),
        warn: scale('warn'),
        info: scale('info'),
        // Kept so existing screens keep compiling while they are restyled; they
        // point at the new scales rather than the old Capital One palette.
        navy: scale('ink'),
        brand: scale('accent'),
        money: scale('accent'),
        slate: scale('ink'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        float: 'var(--shadow-float)',
        glow: '0 0 0 1px rgb(var(--accent-500) / 0.35), 0 8px 32px -8px rgb(var(--accent-500) / 0.45)',
      },
      backgroundImage: {
        'accent-sheen': 'linear-gradient(135deg, rgb(var(--accent-400)) 0%, rgb(var(--accent-600)) 100%)',
        'ink-sheen': 'linear-gradient(140deg, rgb(var(--ink-800)) 0%, rgb(var(--ink-900)) 100%)',
        'glass-sheen': 'linear-gradient(140deg, rgb(255 255 255 / 0.22) 0%, rgb(255 255 255 / 0.04) 45%, rgb(255 255 255 / 0) 100%)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
