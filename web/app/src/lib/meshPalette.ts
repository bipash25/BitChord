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

const cache = new Map<string, Rgb[]>();

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
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

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
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

/**
 * Decodes the artwork at 120px and averages it into a 6×6 grid flipped bottom-up
 * so row 0 is the sleeve's bottom edge (ArtworkMeshBackdrop.kt:596-646).
 */
async function measure(url: string): Promise<Rgb[]> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  image.src = artworkAtPixels(url, MESH_PX);
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = MESH_PX;
  canvas.height = MESH_PX;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, MESH_PX, MESH_PX);
  const { data } = context.getImageData(0, 0, MESH_PX, MESH_PX);

  const count = new Int32Array(GRID * GRID);
  const red = new Float64Array(GRID * GRID);
  const green = new Float64Array(GRID * GRID);
  const blue = new Float64Array(GRID * GRID);

  for (let y = 0; y < MESH_PX; y++) {
    // Flip vertically so row 0 = bottom edge of the sleeve (ArtworkMeshBackdrop.kt:621).
    const row = Math.floor(((MESH_PX - 1 - y) * GRID) / MESH_PX);
    for (let x = 0; x < MESH_PX; x++) {
      const col = Math.floor((x * GRID) / MESH_PX);
      const cell = row * GRID + col;
      const idx = (y * MESH_PX + x) * 4;
      red[cell]! += data[idx]!;
      green[cell]! += data[idx + 1]!;
      blue[cell]! += data[idx + 2]!;
      count[cell]! += 1;
    }
  }

  const grid: Rgb[] = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const n = Math.max(1, count[i]!);
    grid.push(liftCellColor([red[i]! / n, green[i]! / n, blue[i]! / n]));
  }
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
