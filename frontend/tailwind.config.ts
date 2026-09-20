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
 * - cat      eight categorical hues for merchant marks and category chips
 */
const themed = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/**
 * The eight categorical hues. Each is a surface/ink pair, so `bg-cat-3-surface
 * text-cat-3-ink` is legible in both themes — unlike Tailwind's own palette,
 * which is fixed and cannot follow a theme.
 */
const categorical = () =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
      [`${n}-surface`, themed(`cat-${n}-surface`)],
      [`${n}-ink`, themed(`cat-${n}-ink`)],
    ]),
  ) as Record<string, string>;

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
        cat: categorical(),
        /* Text that sits on a saturated fill: `bg-accent-500 text-on-accent`. */
        on: {
          accent: themed('on-accent'),
          danger: themed('on-danger'),
          warn: themed('on-warn'),
          info: themed('on-info'),
        },
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
        // Its own endpoints per theme, so `text-on-accent` clears 4.5:1 across
        // the whole gradient in light AND dark. Built from accent-400/600 it
        // could not: in light the top end was too pale for white text, and in
        // dark the bottom end was too dark for the inverted on-colour.
        'accent-sheen': 'linear-gradient(135deg, rgb(var(--sheen-from)) 0%, rgb(var(--sheen-to)) 100%)',
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
