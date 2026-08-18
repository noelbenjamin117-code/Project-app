import type { Metadata, Viewport } from 'next';
import { gymConfig } from '~/gym.config';
import './globals.css';

export const metadata: Metadata = {
  title: gymConfig.name,
  description: `Class booking and whiteboard for ${gymConfig.name}`,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: gymConfig.shortName,
  },
};

export const viewport: Viewport = {
  themeColor: '#0d1418',
  width: 'device-width',
  initialScale: 1,
  // The member surface is a tool used on the gym floor; pinch-zooming it while
  // tapping a booking button causes more misses than it solves.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
