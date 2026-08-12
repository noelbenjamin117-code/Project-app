import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0d10',
        panel: '#14181d',
        edge: '#232a32',
        brand: '#f2542d',
        ok: '#2f9e69',
        warn: '#d99117',
        bad: '#d2453f',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        // Whiteboard scale — sized to read from 20 feet on a 1080p panel.
        tv: ['2.25rem', { lineHeight: '1.15' }],
        'tv-lg': ['3.5rem', { lineHeight: '1.05' }],
        'tv-xl': ['5rem', { lineHeight: '1' }],
      },
    },
  },
  plugins: [],
} satisfies Config;
