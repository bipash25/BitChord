import { artworkAtPixels } from '@/lib/artwork';

/** How many stops a smootherstep gradient is cut into to prevent 8-bit banding (`FadeCurve.kt:21`). */
export const FADE_CURVE_STOPS = 16;

/** Share of the portrait full-bleed hero artwork height given over to its bottom dissolve (`NowPlayingScreen.kt:288`). */
export const HERO_FADE_FRACTION = 0.42;

/** Status-scrim alpha range mapped from top-10% artwork luminance (`ArtworkPalette.kt:323-324`). */
export const PLAYER_STATUS_SCRIM_MIN_ALPHA = 0.16;
export const PLAYER_STATUS_SCRIM_MAX_ALPHA = 0.65;

/** Modest floor for the top status scrim while a lyrics/queue subview sits over the blurred artwork (`NowPlayingScreen.kt:291`). */
export const SUBVIEW_STATUS_SCRIM_MIN_ALPHA = 0.4;

const TOP_BAND_FRACTION = 0.1;
const topLuminanceCache = new Map<string, number>();

/**
 * Smootherstep (`6t⁵ - 15t⁴ + 10t³`, `FadeCurve.kt:11-14`):
 * zero slope and zero curvature at both ends so fades have no visible edge line.
 */
export function smootherStep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Maps top-band relative luminance (0..1) to top-scrim opacity (`ArtworkPalette.kt:317-321`). */
export function topBandScrimAlpha(luminance: number | null): number {
  const l = luminance === null ? 0 : Math.min(1, Math.max(0, luminance));
  return PLAYER_STATUS_SCRIM_MIN_ALPHA + (PLAYER_STATUS_SCRIM_MAX_ALPHA - PLAYER_STATUS_SCRIM_MIN_ALPHA) * l;
}

/**
 * 8-stop power-1.5 vertical scrim (`NowPlayingScreen.kt:2536-2546`), keeping top
 * chrome readable over light sleeves without a visible bottom seam.
 */
export function topScrimGradient(maxAlpha: number, steps = 8): string {
  const clamped = Math.min(1, Math.max(0, maxAlpha));
  const stops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const alpha = clamped * Math.pow(1 - progress, 1.5);
    const pct = (progress * 100).toFixed(2);
    stops.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${pct}%`);
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

/**
 * 16-stop `smootherStep` bottom dissolve mask for the full-bleed hero cover
 * (`NowPlayingScreen.kt:3297-3310`): solid down to `1 - fadeFraction`, then
 * easing smoothly to transparent at 100%.
 */
export function heroDissolveMask(fadeFraction = HERO_FADE_FRACTION, stops = FADE_CURVE_STOPS): string {
  const startPct = (1 - Math.min(1, Math.max(0, fadeFraction))) * 100;
  const parts = ['#000 0%'];
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const pos = startPct + (100 - startPct) * t;
    const alpha = 1 - smootherStep(t);
    parts.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${pos.toFixed(2)}%`);
  }
  return `linear-gradient(to bottom, ${parts.join(', ')})`;
}

/**
 * Complementary `smootherStep` gradient-blur mask over the hero's bottom dissolve
 * zone: invisible above `1 - fadeFraction`, rising smoothly to full blur at the
 * bottom edge so the cover melts into the 6x6 mesh without a sharp boundary.
 */
export function heroBlurDissolveMask(fadeFraction = HERO_FADE_FRACTION, stops = FADE_CURVE_STOPS): string {
  const startPct = (1 - Math.min(1, Math.max(0, fadeFraction))) * 100;
  const parts = ['transparent 0%'];
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const pos = startPct + (100 - startPct) * t;
    const alpha = smootherStep(t);
    parts.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${pos.toFixed(2)}%`);
  }
  return `linear-gradient(to bottom, ${parts.join(', ')})`;
}

/**
 * Multi-stop `smootherStep` vertical edge mask (`PlayerQueue.kt:128-149`,
 * `PlayerLyrics.kt:2055`) softening content into the blurred backdrop at top
 * and bottom edges.
 */
export function verticalEdgeFadeMask(
  topFade: string,
  bottomFade: string,
  stops = 8,
): string {
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const alpha = smootherStep(t);
    const pos = topFade === '0px' ? '0px' : `calc(${topFade} * ${t.toFixed(4)})`;
    parts.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${pos}`);
  }
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const alpha = 1 - smootherStep(t);
    const pos = `calc(100% - ${bottomFade} * ${(1 - t).toFixed(4)})`;
    parts.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${pos}`);
  }
  return `linear-gradient(to bottom, ${parts.join(', ')})`;
}

/**
 * Multi-stop `smootherStep` horizontal edge mask (`FadingEdges.kt:27-56`) for
 * overflowing marquee titles/artists.
 */
export function horizontalEdgeFadeMask(fadePx: number, leftStrength: number, rightStrength: number, stops = 6): string {
  const left = Math.min(1, Math.max(0, leftStrength));
  const right = Math.min(1, Math.max(0, rightStrength));
  const parts: string[] = [];
  if (left > 0.02) {
    const width = Math.round(fadePx * left);
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      parts.push(`rgba(0, 0, 0, ${smootherStep(t).toFixed(4)}) ${Math.round(width * t)}px`);
    }
  } else {
    parts.push('#000 0%');
  }
  if (right > 0.02) {
    const width = Math.round(fadePx * right);
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const alpha = 1 - smootherStep(t);
      parts.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) calc(100% - ${Math.round(width * (1 - t))}px)`);
    }
  } else {
    parts.push('#000 100%');
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Measures mean WCAG relative luminance over the top 10% of the sleeve (`ArtworkPalette.kt:288-311`). */
export async function sampleTopBandLuminance(url: string): Promise<number | null> {
  const cached = topLuminanceCache.get(url);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return null;

  const src = artworkAtPixels(url, 120);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  if (!loaded || img.naturalWidth < 1 || img.naturalHeight < 1) return null;

  const size = 60;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);

  const bandRows = Math.max(1, Math.floor(size * TOP_BAND_FRACTION));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, bandRows).data;
  } catch {
    return null;
  }
  let sum = 0;
  const pixels = size * bandRows;
  for (let i = 0; i < data.length; i += 4) {
    sum +=
      0.2126 * srgbToLinear(data[i]!) +
      0.7152 * srgbToLinear(data[i + 1]!) +
      0.0722 * srgbToLinear(data[i + 2]!);
  }
  const lum = pixels > 0 ? sum / pixels : 0;
  topLuminanceCache.set(url, lum);
  if (topLuminanceCache.size > 64) {
    const first = topLuminanceCache.keys().next().value;
    if (first !== undefined) topLuminanceCache.delete(first);
  }
  return lum;
}
