/**
 * B42's colours, in one place.
 *
 * Tailwind reads these, so do the PWA manifest and the icon generator. Change
 * a value here and the app, the home-screen icon and the browser chrome all
 * follow — there is no second copy of the brand red to forget about.
 *
 * Plain hex strings with no imports, because `tailwind.config.ts` and a
 * standalone script both have to be able to read this file.
 */
export const THEME = {
  /** Deeper surface: the page behind the cards, inputs, recessed rows. */
  ink: '#0d1418',
  /** Background: the dominant surface, used by every card. */
  panel: '#1a2831',
  /** Hairline between surfaces — the background, lifted just enough to see. */
  edge: '#2d3d48',
  /** Primary / accent. */
  brand: '#e64a39',
  ok: '#2f9e69',
  warn: '#d99117',
  /**
   * Deliberately cooler and deeper than the brand red. The brand is a warm
   * orange-red meaning "do this"; danger is a colder crimson meaning "undo
   * this". On a roster both sit side by side, so they must not read as the
   * same colour.
   */
  bad: '#cf3d55',
} as const;

/** [r, g, b] for a hex string — the icon generator writes raw pixels. */
export function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}
