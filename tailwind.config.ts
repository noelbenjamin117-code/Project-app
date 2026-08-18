import type { Config } from 'tailwindcss';
import { THEME } from './src/lib/theme';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // B42's colours, defined in src/lib/theme.ts so the app, the PWA
      // manifest and the home-screen icon all read the same values.
      colors: THEME,
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
