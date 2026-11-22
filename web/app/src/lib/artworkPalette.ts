import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  analyzeArtwork120,
  hslToRgb,
  relativeLuminance,
  rgbToHsl,
  type ArtworkAnalysis120,
  type GridCell,
  type Rgb,
} from './meshPalette';
import { useReducedMotion } from './motionPrefs';

/**
 * The seven theme-aware colour roles derived from an artwork sleeve or
 * artist key colours (`ArtworkPalette.kt:35-70`, spec §5).
 */
export interface ArtworkPalette {
  background: string;
  wash: string;
  elevated: string;
  accent: string;
  onBackground: string;
  onBackgroundVariant: string;
  divider: string;
  topBandLuminance: number;
  dark: boolean;
}

export interface ArtworkKeyColors {
  background: string;
  accent: string;
}

export interface ArtworkSeed {
  dominant: Rgb;
  vibrant: Rgb;
  edge: Rgb;
  topBandLuminance: number;
}

export interface ArtworkPaletteResult {
  palette: ArtworkPalette | null;
  /** True when colours were known on frame 1 (cached/keyColors) or reduce-motion is on. */
  snap: boolean;
}

/** Below this saturation, boosting saturation turns quantisation noise into a false tint (ArtworkPalette.kt:409). */
export const CHROMATIC_SATURATION_THRESHOLD = 0.12;
export const TINT_FADE_MS = 260;

const SEED_CACHE_ENTRIES = 128;
const seedCache = new Map<string, ArtworkSeed>();

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Keeps neutral artwork neutral instead of inventing a hue for grey
 * (ArtworkPalette.kt:399-406).
 */
export function adaptedArtworkSaturation(source: number, minimum: number, maximum: number): number {
  const s = clamp01(source);
  return s < CHROMATIC_SATURATION_THRESHOLD ? s : clamp(s, minimum, maximum);
}

function withHsl(
  rgb: Rgb,
  saturation: (s: number) => number,
  lightness: (l: number) => number,
): Rgb {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([h, clamp01(saturation(s)), clamp01(lightness(l))]);
}

function parseColorToRgb(color: string): Rgb | null {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return Number.isNaN(r + g + b) ? null : [r, g, b];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return Number.isNaN(r + g + b) ? null : [r, g, b];
    }
  }
  const match = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) {
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return null;
}

interface SwatchCluster {
  rSum: number;
  gSum: number;
  bSum: number;
  population: number;
  rgb: Rgb;
}

const CLUSTER_DISTANCE_SQ = 36 * 36;
const MAX_SWATCH_CLUSTERS = 24;

/**
 * Clusters the 6×6 cell grid into up to 24 population-weighted swatches so large
 * uniform regions (sky, background) accumulate population instead of losing to
 * single high-contrast cells (ArtworkPalette.kt:211-229, spec §5).
 */
export function clusterGridSwatches(cells: readonly GridCell[]): SwatchCluster[] {
  const clusters: SwatchCluster[] = [];
  for (const cell of cells) {
    const [r, g, b] = cell.rgb;
    let best: SwatchCluster | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const dr = r - c.rgb[0];
      const dg = g - c.rgb[1];
      const db = b - c.rgb[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist <= CLUSTER_DISTANCE_SQ && dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    if (best) {
      best.rSum += r * cell.count;
      best.gSum += g * cell.count;
      best.bSum += b * cell.count;
      best.population += cell.count;
      best.rgb = [best.rSum / best.population, best.gSum / best.population, best.bSum / best.population];
    } else if (clusters.length < MAX_SWATCH_CLUSTERS) {
      clusters.push({
        rSum: r * cell.count,
        gSum: g * cell.count,
        bSum: b * cell.count,
        population: cell.count,
        rgb: [r, g, b],
      });
    } else {
      // Merge into the nearest existing cluster once the 24-swatch budget is full.
      let nearest = clusters[0]!;
      let nearestDist = Infinity;
      for (const c of clusters) {
        const dr = r - c.rgb[0];
        const dg = g - c.rgb[1];
        const db = b - c.rgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < nearestDist) {
          nearest = c;
          nearestDist = dist;
        }
      }
      nearest.rSum += r * cell.count;
      nearest.gSum += g * cell.count;
      nearest.bSum += b * cell.count;
      nearest.population += cell.count;
      nearest.rgb = [
        nearest.rSum / nearest.population,
        nearest.gSum / nearest.population,
        nearest.bSum / nearest.population,
      ];
    }
  }
  return clusters;
}

/**
 * Derives dominant, vibrant, edge and topBandLuminance from the shared 120px
 * grid + edge analysis (`ArtworkPalette.kt:207-236`).
 */
export function seedFromAnalysis(analysis: ArtworkAnalysis120): ArtworkSeed | null {
  const all = clusterGridSwatches(analysis.cells);
  if (all.length === 0) return null;

  const dominant = all.reduce((best, cur) => (cur.population > best.population ? cur : best));

  // Mirror Android Palette's default filter: drop near-black (L < 0.08) and
  // near-white (L > 0.92) when picking an accent, falling back to all swatches.
  const filtered = all.filter((c) => {
    const [, , l] = rgbToHsl(c.rgb);
    return l >= 0.08 && l <= 0.92;
  });
  const candidates = filtered.length > 0 ? filtered : all;

  const vibrant = candidates.reduce((best, cur) => {
    const [, bestS] = rgbToHsl(best.rgb);
    const [, curS] = rgbToHsl(cur.rgb);
    const bestScore = bestS * Math.sqrt(best.population);
    const curScore = curS * Math.sqrt(cur.population);
    return curScore > bestScore ? cur : best;
  });

  return {
    dominant: dominant.rgb,
    vibrant: vibrant.rgb,
    edge: analysis.bottomEdge,
    topBandLuminance: analysis.topBandLuminance,
  };
}

/**
 * Converts a raw seed into the seven theme-aware palette roles
 * (`ArtworkPalette.kt:326-388`).
 */
export function seedToPalette(seed: ArtworkSeed, dark: boolean): ArtworkPalette {
  if (dark) {
    return {
      background: rgbCss(
        withHsl(
          seed.dominant,
          (s) => adaptedArtworkSaturation(s, 0.20, 0.62),
          () => 0.13,
        ),
      ),
      wash: rgbCss(
        withHsl(
          seed.edge,
          (s) => adaptedArtworkSaturation(s, 0.18, 0.58),
          (l) => clamp(l, 0.14, 0.24),
        ),
      ),
      elevated: rgbCss(
        withHsl(
          seed.dominant,
          (s) => adaptedArtworkSaturation(s, 0.20, 0.62),
          () => 0.22,
        ),
      ),
      accent: rgbCss(
        withHsl(
          seed.vibrant,
          (s) => adaptedArtworkSaturation(s, 0.55, 1.0),
          (l) => clamp(l, 0.62, 0.78),
        ),
      ),
      onBackground: '#ffffff',
      onBackgroundVariant: rgbCss(
        withHsl(
          seed.dominant,
          (s) => adaptedArtworkSaturation(s, 0.22, 0.50),
          () => 0.80,
        ),
      ),
      divider: 'rgba(255, 255, 255, 0.12)',
      topBandLuminance: seed.topBandLuminance,
      dark: true,
    };
  }

  return {
    background: rgbCss(
      withHsl(
        seed.dominant,
        (s) => adaptedArtworkSaturation(s, 0.14, 0.50),
        () => 0.91,
      ),
    ),
    wash: rgbCss(
      withHsl(
        seed.edge,
        (s) => adaptedArtworkSaturation(s, 0.12, 0.46),
        (l) => clamp(l, 0.78, 0.90),
      ),
    ),
    elevated: rgbCss(
      withHsl(
        seed.dominant,
        (s) => adaptedArtworkSaturation(s, 0.14, 0.50),
        () => 0.83,
      ),
    ),
    accent: rgbCss(
      withHsl(
        seed.vibrant,
        (s) => adaptedArtworkSaturation(s, 0.55, 1.0),
        (l) => clamp(l, 0.30, 0.44),
      ),
    ),
    onBackground: '#000000',
    onBackgroundVariant: rgbCss(
      withHsl(
        seed.dominant,
        (s) => adaptedArtworkSaturation(s, 0.22, 0.55),
        () => 0.34,
      ),
    ),
    divider: 'rgba(0, 0, 0, 0.10)',
    topBandLuminance: seed.topBandLuminance,
    dark: false,
  };
}

export function keyColorsToSeed(keyColors: ArtworkKeyColors): ArtworkSeed | null {
  const bg = parseColorToRgb(keyColors.background);
  if (!bg) return null;
  const accent = parseColorToRgb(keyColors.accent) ?? bg;
  return {
    dominant: bg,
    vibrant: accent,
    edge: bg,
    topBandLuminance: relativeLuminance(bg),
  };
}

function getCachedSeed(url: string): ArtworkSeed | null {
  const hit = seedCache.get(url);
  if (!hit) return null;
  // Refresh LRU order on read.
  seedCache.delete(url);
  seedCache.set(url, hit);
  return hit;
}

function setCachedSeed(url: string, seed: ArtworkSeed): void {
  if (seedCache.has(url)) seedCache.delete(url);
  else if (seedCache.size >= SEED_CACHE_ENTRIES) {
    const oldest = seedCache.keys().next().value;
    if (oldest !== undefined) seedCache.delete(oldest);
  }
  seedCache.set(url, seed);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemDark(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSystemDarkSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Tracks `prefers-color-scheme: dark` so tinted pages stay theme-aware live. */
export function useSystemDarkMode(): boolean {
  return useSyncExternalStore(subscribeSystemDark, getSystemDarkSnapshot, () => false);
}

/**
 * Decodes `imageUrl` (or uses `keyColors` when already supplied, as on artist
 * pages) and returns the theme-aware 7-role `ArtworkPalette`.
 *
 * Cached palettes land on frame 1 with `snap: true`; uncached sleeves fade
 * over 260ms (`ArtworkPalette.kt:115-131`), snapped when reduced motion is on.
 */
export function useArtworkPalette(
  imageUrl: string | null | undefined,
  options?: { keyColors?: ArtworkKeyColors | null },
): ArtworkPaletteResult {
  const dark = useSystemDarkMode();
  const reducedMotion = useReducedMotion();
  const keySeed = options?.keyColors ? keyColorsToSeed(options.keyColors) : null;

  const [decoded, setDecoded] = useState<{ url: string; seed: ArtworkSeed; cached: boolean } | null>(() => {
    if (!imageUrl || keySeed) return null;
    const hit = getCachedSeed(imageUrl);
    return hit ? { url: imageUrl, seed: hit, cached: true } : null;
  });

  useEffect(() => {
    if (!imageUrl || keySeed) {
      setDecoded(null);
      return;
    }
    const hit = getCachedSeed(imageUrl);
    if (hit) {
      setDecoded({ url: imageUrl, seed: hit, cached: true });
      return;
    }
    setDecoded(null);
    let live = true;
    analyzeArtwork120(imageUrl)
      .then((analysis) => {
        const seed = seedFromAnalysis(analysis);
        if (!seed) return;
        setCachedSeed(imageUrl, seed);
        if (live) setDecoded({ url: imageUrl, seed, cached: false });
      })
      .catch(() => {
        // Unreadable image leaves the page in its flat theme scheme.
      });
    return () => {
      live = false;
    };
  }, [imageUrl, Boolean(keySeed)]);

  const activeSeed = keySeed ?? (decoded && decoded.url === imageUrl ? decoded.seed : null);
  const palette = activeSeed ? seedToPalette(activeSeed, dark) : null;
  const knownUpFront = Boolean(keySeed) || Boolean(decoded && decoded.url === imageUrl && decoded.cached);

  return {
    palette,
    snap: reducedMotion || knownUpFront,
  };
}
