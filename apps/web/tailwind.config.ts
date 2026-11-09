import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        muted: v('muted'),
        line: v('line'),
        ink: v('ink'),
        sub: v('sub'),
        faint: v('faint'),
        brand: v('brand'),
        'brand-ink': v('brand-ink'),
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
      },
      fontFamily: { sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'] },
      borderRadius: { xl: '14px', '2xl': '20px' },
    },
  },
  plugins: [],
} satisfies Config;
