import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Capital One's own palette: navy for structure, red for action.
        // Their app is mostly white with navy type and red primary buttons.
        navy: {
          50: '#f2f5f8',
          100: '#dfe7ee',
          200: '#bccedd',
          300: '#8ba7c2',
          400: '#5a7fa3',
          500: '#2e5f8a',
          600: '#004977', // Capital One blue
          700: '#013a5e',
          800: '#012c47',
          900: '#001c2e',
        },
        brand: {
          50: '#fdf2f2',
          100: '#fbe0df',
          200: '#f6bdbb',
          400: '#e3564d',
          500: '#d03027', // Capital One red
          600: '#b52219',
          700: '#8f1a13',
        },
        // Reserved strictly for positive money outcomes (money saved, income).
        money: {
          50: '#eef8f2',
          100: '#d2eede',
          600: '#1a7f4b',
          700: '#136139',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
