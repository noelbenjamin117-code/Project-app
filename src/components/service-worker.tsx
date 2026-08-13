'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for the member surface.
 *
 * Registration is deferred until after load so it never competes with the
 * first render on a phone on gym wifi.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration only costs offline support; the app still works.
      });
    };

    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
