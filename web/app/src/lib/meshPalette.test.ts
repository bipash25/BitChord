import { describe, expect, it } from 'vitest';
import {
  GRID,
  MESH_FADE_MS,
  MESH_FLOOR,
  MESH_PX,
  MESH_VIBRANCE,
  hashUrlSeed,
  liftCellColor,
  rotateBelowSeam,
  type Rgb,
} from './meshPalette';

describe('meshPalette', () => {
  it('pins the Android 6×6 mesh constants', () => {
    expect(GRID).toBe(6);
    expect(MESH_PX).toBe(120);
    expect(MESH_VIBRANCE).toBe(1.12);
    expect(MESH_FLOOR).toBe(0.045);
    expect(MESH_FADE_MS).toBe(900);
  });

  it('floors pure black cells to MESH_FLOOR lightness and nudges saturation', () => {
    const blackLifted = liftCellColor([0, 0, 0]);
    const expected = Math.round(MESH_FLOOR * 255);
    expect(blackLifted).toEqual([expected, expected, expected]);

    // A desaturated red should gain saturation without changing hue order.
    const mutedRed: Rgb = [140, 100, 100];
    const liftedRed = liftCellColor(mutedRed);
    expect(liftedRed[0]).toBeGreaterThan(liftedRed[1]);
    expect(liftedRed[0] - liftedRed[1]).toBeGreaterThan(mutedRed[0] - mutedRed[1]);
  });

  it('keeps row 0 literal as the artwork seam while deterministically rotating rows 1..5', () => {
    const cells: Rgb[] = Array.from({ length: GRID * GRID }, (_, i) => [i, i * 2, i * 3]);
    const seed = hashUrlSeed('https://lh3.googleusercontent.com/test-sleeve=w544-h544');
    const rotatedA = rotateBelowSeam(cells, GRID, GRID, seed);
    const rotatedB = rotateBelowSeam(cells, GRID, GRID, seed);

    expect(rotatedA).toEqual(rotatedB);
    // Row 0 (bottom edge seam) must stay cell-for-cell identical.
    expect(rotatedA.slice(0, GRID)).toEqual(cells.slice(0, GRID));
    // Rows 1..5 keep the same set of cells per row, only shifted/mirrored.
    for (let row = 1; row < GRID; row++) {
      const origRow = cells.slice(row * GRID, (row + 1) * GRID).map((c) => c[0]).sort((a, b) => a - b);
      const rotRow = rotatedA.slice(row * GRID, (row + 1) * GRID).map((c) => c[0]).sort((a, b) => a - b);
      expect(rotRow).toEqual(origRow);
    }
  });
});
