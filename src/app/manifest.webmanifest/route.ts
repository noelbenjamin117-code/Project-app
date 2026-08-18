import { gymConfig } from '~/gym.config';
import { THEME } from '@/lib/theme';

/**
 * The PWA manifest, generated rather than kept as a static file.
 *
 * This is what a member sees on their home screen once they install the app,
 * so it has to carry the gym's real name and colours. As a static file it went
 * stale the moment the gym was renamed — the icon on the home screen still
 * said the name of the demo gym. Built from the same config and theme tokens
 * as everything else, it cannot drift again.
 */
export const dynamic = 'force-static';

export function GET() {
  const manifest = {
    name: gymConfig.name,
    short_name: gymConfig.shortName,
    description: 'Book classes, check in, log your scores.',
    start_url: '/schedule',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: THEME.ink,
    theme_color: THEME.ink,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'content-type': 'application/manifest+json' },
  });
}
