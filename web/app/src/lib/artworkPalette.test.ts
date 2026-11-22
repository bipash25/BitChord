import { describe, expect, it } from 'vitest';
import {
  adaptedArtworkSaturation,
  CHROMATIC_SATURATION_THRESHOLD,
  keyColorsToSeed,
  seedFromAnalysis,
  seedToPalette,
} from './artworkPalette';
import { analyzePixels120, GRID, MESH_PX, rgbToHsl, type Rgb } from './meshPalette';

function makeSolidBuffer(rgb: Rgb, size = MESH_PX): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function parseRgbCss(css: string): Rgb {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Expected rgb(...) string, got ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe('artworkPalette', () => {
  it('keeps neutral greys below the 12% chromatic saturation threshold instead of inventing a hue', () => {
    expect(adaptedArtworkSaturation(0.05, 0.2, 0.62)).toBe(0.05);
    expect(adaptedArtworkSaturation(CHROMATIC_SATURATION_THRESHOLD - 0.001, 0.2, 0.62)).toBeCloseTo(0.119, 3);
    expect(adaptedArtworkSaturation(0.15, 0.2, 0.62)).toBe(0.2);
    expect(adaptedArtworkSaturation(0.8, 0.2, 0.62)).toBe(0.62);

    const greyAnalysis = analyzePixels120(makeSolidBuffer([120, 120, 120]));
    const seed = seedFromAnalysis(greyAnalysis)!;
    const dark = seedToPalette(seed, true);
    const [, bgSat, bgL] = rgbToHsl(parseRgbCss(dark.background));
    expect(bgSat).toBeLessThan(0.05);
    expect(bgL).toBeCloseTo(0.13, 1);
  });

  it('emits all seven roles within Android HSL bands for dark and light modes', () => {
    // Rich blue sleeve with bright orange bottom band.
    const data = makeSolidBuffer([30, 80, 200]);
    const edgeStart = Math.floor(MESH_PX * 0.82);
    for (let y = edgeStart; y < MESH_PX; y++) {
      for (let x = 0; x < MESH_PX; x++) {
        const idx = (y * MESH_PX + x) * 4;
        data[idx] = 230;
        data[idx + 1] = 110;
        data[idx + 2] = 30;
      }
    }
    const analysis = analyzePixels120(data);
    expect(analysis.cells).toHaveLength(GRID * GRID);
    expect(analysis.bottomEdge[0]).toBeGreaterThan(200);

    const seed = seedFromAnalysis(analysis)!;
    const dark = seedToPalette(seed, true);
    const light = seedToPalette(seed, false);

    // Dark roles
    expect(dark.onBackground).toBe('#ffffff');
    expect(dark.divider).toBe('rgba(255, 255, 255, 0.12)');
    const [, darkBgS, darkBgL] = rgbToHsl(parseRgbCss(dark.background));
    const [, , darkElevL] = rgbToHsl(parseRgbCss(dark.elevated));
    const [, darkWashS, darkWashL] = rgbToHsl(parseRgbCss(dark.wash));
    const [, darkAccS, darkAccL] = rgbToHsl(parseRgbCss(dark.accent));
    const [, , darkVarL] = rgbToHsl(parseRgbCss(dark.onBackgroundVariant));
    expect(darkBgL).toBeCloseTo(0.13, 1);
    expect(darkBgS).toBeGreaterThanOrEqual(0.18);
    expect(darkBgS).toBeLessThanOrEqual(0.65);
    expect(darkElevL).toBeCloseTo(0.22, 1);
    expect(darkWashS).toBeGreaterThanOrEqual(0.16);
    expect(darkWashL).toBeGreaterThanOrEqual(0.12);
    expect(darkWashL).toBeLessThanOrEqual(0.26);
    expect(darkAccS).toBeGreaterThanOrEqual(0.52);
    expect(darkAccL).toBeGreaterThanOrEqual(0.60);
    expect(darkAccL).toBeLessThanOrEqual(0.80);
    expect(darkVarL).toBeCloseTo(0.80, 1);

    // Light roles
    expect(light.onBackground).toBe('#000000');
    expect(light.divider).toBe('rgba(0, 0, 0, 0.10)');
    const [, , lightBgL] = rgbToHsl(parseRgbCss(light.background));
    const [, , lightElevL] = rgbToHsl(parseRgbCss(light.elevated));
    const [, , lightWashL] = rgbToHsl(parseRgbCss(light.wash));
    const [, lightAccS, lightAccL] = rgbToHsl(parseRgbCss(light.accent));
    const [, , lightVarL] = rgbToHsl(parseRgbCss(light.onBackgroundVariant));
    expect(lightBgL).toBeCloseTo(0.91, 1);
    expect(lightElevL).toBeCloseTo(0.83, 1);
    expect(lightWashL).toBeGreaterThanOrEqual(0.76);
    expect(lightWashL).toBeLessThanOrEqual(0.92);
    expect(lightAccS).toBeGreaterThanOrEqual(0.52);
    expect(lightAccL).toBeGreaterThanOrEqual(0.28);
    expect(lightAccL).toBeLessThanOrEqual(0.46);
    expect(lightVarL).toBeCloseTo(0.34, 1);
  });

  it('picks vibrant accent using saturation * sqrt(population) rather than raw black', () => {
    // 80% near-black sky, 20% vivid magenta.
    const data = makeSolidBuffer([8, 8, 10]);
    for (let y = 0; y < MESH_PX; y++) {
      for (let x = 0; x < Math.floor(MESH_PX * 0.25); x++) {
        const idx = (y * MESH_PX + x) * 4;
        data[idx] = 220;
        data[idx + 1] = 30;
        data[idx + 2] = 140;
      }
    }
    const seed = seedFromAnalysis(analyzePixels120(data))!;
    // Dominant should be near-black sky, vibrant should be magenta.
    expect(seed.dominant[0]).toBeLessThan(30);
    expect(seed.vibrant[0]).toBeGreaterThan(180);
  });

  it('computes top-band relative luminance in linear light and supports keyColors', () => {
    const whiteTop = makeSolidBuffer([255, 255, 255]);
    const darkTop = makeSolidBuffer([0, 0, 0]);
    expect(analyzePixels120(whiteTop).topBandLuminance).toBeCloseTo(1, 3);
    expect(analyzePixels120(darkTop).topBandLuminance).toBeCloseTo(0, 3);

    const keySeed = keyColorsToSeed({ background: '#1e3a5f', accent: '#ff5533' });
    expect(keySeed).not.toBeNull();
    const palette = seedToPalette(keySeed!, true);
    expect(palette.dark).toBe(true);
    expect(palette.onBackground).toBe('#ffffff');
  });
});
