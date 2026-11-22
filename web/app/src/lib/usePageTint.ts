import { useEffect } from 'react';
import type { ArtworkPalette, ArtworkPaletteResult } from './artworkPalette';

export interface UsePageTintOptions {
  /**
   * Release pages sit on `background`; artist pages whose photograph dissolves
   * into the bottom edge sit on `wash` (`DetailScreen.kt:540-544`).
   */
  surface?: 'background' | 'wash';
}

const TINT_PROPS = [
  '--bc-page-background',
  '--bc-page-wash',
  '--bc-page-elevated',
  '--bc-page-accent',
  '--bc-page-on',
  '--bc-page-on-variant',
  '--bc-page-divider',
  '--bc-page-surface',
] as const;

function isResult(value: ArtworkPaletteResult | ArtworkPalette): value is ArtworkPaletteResult {
  return 'palette' in value;
}

/**
 * Emits the 7 artwork-derived palette roles onto `#scrollable-page` (and
 * `--bc-page-color` onto its shell parent for `BottomFadeScrim` and
 * `bc-top-fade`) with Android's 260ms crossfade on uncached sleeves.
 */
export function usePageTint(
  input: ArtworkPaletteResult | ArtworkPalette | null,
  options?: UsePageTintOptions,
) {
  const palette = input ? (isResult(input) ? input.palette : input) : null;
  const snap = input && isResult(input) ? input.snap : false;
  const surface = options?.surface ?? 'background';

  useEffect(() => {
    const page = document.getElementById('scrollable-page');
    if (!page || !palette) return;

    const pageSurface = surface === 'wash' ? palette.wash : palette.background;
    page.style.setProperty('--bc-page-background', palette.background);
    page.style.setProperty('--bc-page-wash', palette.wash);
    page.style.setProperty('--bc-page-elevated', palette.elevated);
    page.style.setProperty('--bc-page-accent', palette.accent);
    page.style.setProperty('--bc-page-on', palette.onBackground);
    page.style.setProperty('--bc-page-on-variant', palette.onBackgroundVariant);
    page.style.setProperty('--bc-page-divider', palette.divider);
    page.style.setProperty('--bc-page-surface', pageSurface);

    page.dataset.tint = palette.dark ? 'dark' : 'light';
    if (snap) page.dataset.tintSnap = 'true';
    else delete page.dataset.tintSnap;

    // Sibling shell chrome (BottomFadeScrim + TopFadeBlur) sits outside #scrollable-page.
    page.parentElement?.style.setProperty('--bc-page-color', pageSurface);

    return () => {
      for (const prop of TINT_PROPS) {
        page.style.removeProperty(prop);
      }
      delete page.dataset.tint;
      delete page.dataset.tintSnap;
      page.parentElement?.style.removeProperty('--bc-page-color');
    };
  }, [palette, snap, surface]);
}
