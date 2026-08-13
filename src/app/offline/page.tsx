import { gymConfig } from '~/gym.config';

/**
 * The offline shell the service worker falls back to. Deliberately does not
 * pretend to show schedule data — a member acting on yesterday's capacity is
 * worse than one who knows they are offline.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-brand">
        {gymConfig.shortName}
      </p>
      <h1 className="mt-3 text-2xl font-bold">You're offline</h1>
      <p className="mt-2 text-white/50">
        Booking and check-in need a connection, so we won't show you a schedule that might be out
        of date. This page will work again as soon as you're back online.
      </p>
    </main>
  );
}
