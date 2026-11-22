import { useSyncExternalStore } from 'react';

/**
 * When moving pictures are a cost rather than a delight: the user asked the
 * system to calm motion, or the connection pays by the byte. What the
 * Spotify Canvas gate used to ask too; with Canvas gone (relay.md phase 2),
 * Apple's animated sleeves are the consumer.
 */

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedTransparency = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce)') : null;

/** The system's reduced-motion preference, kept live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      reducedMotion?.addEventListener('change', onChange);
      return () => reducedMotion?.removeEventListener('change', onChange);
    },
    () => reducedMotion?.matches ?? false,
  );
}

/** The system's reduced-transparency preference, kept live (Android's reduceDynamicBlur contract). */
export function useReducedTransparency(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      reducedTransparency?.addEventListener('change', onChange);
      return () => reducedTransparency?.removeEventListener('change', onChange);
    },
    () => reducedTransparency?.matches ?? false,
  );
}

/** Save-Data, or a cellular link where the browser says so (Network Information API, Chromium only). */
export function metered(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  return !!connection?.saveData || connection?.type === 'cellular';
}
