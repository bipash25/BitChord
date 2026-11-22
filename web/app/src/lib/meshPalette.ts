import { artworkAtPixels } from './artwork';

export type Rgb = [number, number, number];

/** How many cells across the mesh is (ArtworkMeshBackdrop.kt:536). */
export const GRID = 6;

/** What a still sleeve is decoded at before averaging down (ArtworkMeshBackdrop.kt:512). */
export const MESH_PX = 120;

/** Saturation nudge & lightness floor (ArtworkMeshBackdrop.kt:754-755). */
export const MESH_VIBRANCE = 1.12;
export const MESH_FLOOR = 0.045;

/** Crossfade duration when track colours change (ArtworkMeshBackdrop.kt:571). */
export const MESH_FADE_MS = 900;

export interface GridCell {
  rgb: Rgb;
  count: number;
}

export interface ArtworkAnalysis120 {
  /** 6×6 grid flipped bottom-up (row 0 = sleeve bottom edge), unlifted mean RGB + pixel count. */
  cells: GridCell[];
  /** Mean RGB of the bottom 18% pixel rows (ArtworkPalette.kt:259-281). */
  bottomEdge: Rgb;
  /** Average WCAG relative luminance of the top 10% pixel rows (ArtworkPalette.kt:288-311). */
  topBandLuminance: number;
}

const cache = new Map<string, Rgb[]>();
const analysisCache = new Map<string, Promise<ArtworkAnalysis120>>();

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = Math.round(Math.min(255, Math.max(0, l * 255)));
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(Math.min(255, Math.max(0, hueToRgb(p, q, h + 1 / 3) * 255))),
    Math.round(Math.min(255, Math.max(0, hueToRgb(p, q, h) * 255))),
    Math.round(Math.min(255, Math.max(0, hueToRgb(p, q, h - 1 / 3) * 255))),
  ];
}

/**
 * Android's `Int.lifted()` (ArtworkMeshBackdrop.kt:747-755): nudge saturation by
 * 1.12x (recovering colour lost to cell averaging) and floor lightness at 0.045
 * so pure black still leaves a soft dark ground while proportions stay intact.
 */
export function liftCellColor(rgb: Rgb): Rgb {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([h, Math.min(1, s * MESH_VIBRANCE), Math.max(MESH_FLOOR, l)]);
}

/** Deterministic 32-bit FNV-1a seed from an artwork URL. */
export function hashUrlSeed(url: string): number {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Keeps row 0 (the bottom seam of the artwork) literal so the sleeve dissolves
 * seamlessly into the backdrop, and cyclically shifts rows 1..rows-1 (mirrored
 * horizontally half the time) so faces/horizons don't repeat as a reflection
 * directly beneath themselves (ArtworkMeshBackdrop.kt:677-691).
 */
export function rotateBelowSeam(cells: Rgb[], cols: number, rows: number, seed: number): Rgb[] {
  if (rows <= 1 || cols <= 1) return cells.slice();
  const rand = mulberry32(seed);
  const mirror = rand() < 0.5;
  const shift = Math.floor(rand() * cols);
  const out = cells.slice();
  for (let row = 1; row < rows; row++) {
    const base = row * cols;
    for (let x = 0; x < cols; x++) {
      const src = mirror ? cols - 1 - x : x;
      out[base + x] = cells[base + ((src + shift) % cols)]!;
    }
  }
  return out;
}

/** WCAG relative luminance in linear light (ArtworkPalette.kt:303-311). */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Pure pixel analyzer for a 120×120 RGBA buffer: computes the 6×6 bottom-up grid,
 * bottom 18% mean edge colour, and top 10% relative luminance in one pass.
 */
export function analyzePixels120(data: Uint8ClampedArray, size = MESH_PX): ArtworkAnalysis120 {
  const count = new Int32Array(GRID * GRID);
  const red = new Float64Array(GRID * GRID);
  const green = new Float64Array(GRID * GRID);
  const blue = new Float64Array(GRID * GRID);

  const edgeRows = Math.max(1, Math.min(size, Math.floor(size * 0.18)));
  const edgeStartY = size - edgeRows;
  let edgeRed = 0;
  let edgeGreen = 0;
  let edgeBlue = 0;
  let edgeCount = 0;

  const topRows = Math.max(1, Math.min(size, Math.floor(size * 0.10)));
  let topLumSum = 0;
  let topCount = 0;

  for (let y = 0; y < size; y++) {
    // Flip vertically so row 0 = bottom edge of the sleeve (ArtworkMeshBackdrop.kt:621).
    const row = Math.floor(((size - 1 - y) * GRID) / size);
    const inEdge = y >= edgeStartY;
    const inTop = y < topRows;
    for (let x = 0; x < size; x++) {
      const col = Math.floor((x * GRID) / size);
      const cell = row * GRID + col;
      const idx = (y * size + x) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      red[cell]! += r;
      green[cell]! += g;
      blue[cell]! += b;
      count[cell]! += 1;

      if (inEdge) {
        edgeRed += r;
        edgeGreen += g;
        edgeBlue += b;
        edgeCount += 1;
      }
      if (inTop) {
        topLumSum += relativeLuminance([r, g, b]);
        topCount += 1;
      }
    }
  }

  const cells: GridCell[] = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const n = Math.max(1, count[i]!);
    cells.push({
      rgb: [red[i]! / n, green[i]! / n, blue[i]! / n],
      count: n,
    });
  }

  return {
    cells,
    bottomEdge: [
      Math.round(edgeRed / Math.max(1, edgeCount)),
      Math.round(edgeGreen / Math.max(1, edgeCount)),
      Math.round(edgeBlue / Math.max(1, edgeCount)),
    ],
    topBandLuminance: topCount > 0 ? topLumSum / topCount : 0,
  };
}

async function loadDrawable120(src: string): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void }> {
  // Fetch with CORS mode + no-cache so a prior non-CORS <img src={src}> in the
  // browser cache never poisons canvas pixel access on the same w120 URL.
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const res = await fetch(src, { mode: 'cors', referrerPolicy: 'no-referrer', cache: 'no-cache' });
    if (!res.ok) throw new Error(`Artwork fetch failed: ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx) => {
        ctx.drawImage(bitmap, 0, 0, MESH_PX, MESH_PX);
        bitmap.close();
      },
    };
  }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  image.src = src;
  await image.decode();
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (ctx) => ctx.drawImage(image, 0, 0, MESH_PX, MESH_PX),
  };
}

/**
 * Shared 120px artwork decode + analysis so the 6×6 mesh and the page-tint
 * ArtworkPalette share one image load and canvas read per URL.
 */
export function analyzeArtwork120(url: string): Promise<ArtworkAnalysis120> {
  const existing = analysisCache.get(url);
  if (existing) return existing;

  const task = (async () => {
    const drawable = await loadDrawable120(artworkAtPixels(url, MESH_PX));
    const canvas = document.createElement('canvas');
    canvas.width = MESH_PX;
    canvas.height = MESH_PX;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    drawable.draw(context);
    const { data } = context.getImageData(0, 0, MESH_PX, MESH_PX);
    return analyzePixels120(data, MESH_PX);
  })().catch((err) => {
    analysisCache.delete(url);
    throw err;
  });

  if (analysisCache.size >= 128) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(url, task);
  return task;
}

/**
 * Decodes the artwork at 120px and averages it into a 6×6 grid flipped bottom-up
 * so row 0 is the sleeve's bottom edge (ArtworkMeshBackdrop.kt:596-646).
 */
async function measure(url: string): Promise<Rgb[]> {
  const { cells } = await analyzeArtwork120(url);
  const grid = cells.map((cell) => liftCellColor(cell.rgb));
  return rotateBelowSeam(grid, GRID, GRID, hashUrlSeed(url));
}

export function meshPalette(url: string): Promise<Rgb[]> {
  const known = cache.get(url);
  if (known) return Promise.resolve(known);
  return measure(url).then((cells) => {
    cache.set(url, cells);
    return cells;
  });
}
