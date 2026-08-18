'use client';

import { useState } from 'react';
import { gymConfig } from '~/gym.config';

/**
 * The gym's mark, wherever it appears.
 *
 * Drop a file at `public/logo.svg` and it shows up in the header, on the login
 * screen and on the gym TV. Until then — or if the file is missing, misnamed,
 * or fails to load — this falls back to the gym's short name set in
 * `gym.config.ts`. The fallback matters: a broken image in the header of a
 * booking app looks like the whole thing is broken.
 */
export function Wordmark({
  className,
  /** Height of the logo image. Text falls back to matching type sizes. */
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'tv';
}) {
  const [failed, setFailed] = useState(false);
  const logo = gymConfig.logo;

  const textClass = {
    sm: 'text-xs font-semibold uppercase tracking-widest text-brand',
    md: 'text-sm font-semibold uppercase tracking-widest text-brand',
    // The TV keeps the gym name in white: the header already carries a brand
    // rule beneath it, and red-on-red at that size is a lot from 20 feet.
    tv: 'text-tv-lg font-black uppercase tracking-tight text-white',
  }[size];

  const imgClass = {
    sm: 'h-5 w-auto',
    md: 'h-7 w-auto',
    tv: 'h-20 w-auto',
  }[size];

  if (!logo || failed) {
    return <span className={`${textClass} ${className ?? ''}`}>{gymConfig.shortName}</span>;
  }

  return (
    // A plain <img>: the logo is a fixed-size asset the gym drops in, not
    // something worth putting through the image optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // The markup is server-rendered, so a missing file has usually already
      // failed by the time React hydrates and `onError` would never fire —
      // leaving the browser's broken-image box in the header. A finished
      // image with no width is one that failed, so check for that on mount
      // as well as listening for the error.
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={logo}
      alt={gymConfig.name}
      className={`${imgClass} ${className ?? ''}`}
      onError={() => setFailed(true)}
    />
  );
}
