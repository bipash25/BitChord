import { describe, expect, it } from 'vitest';
import {
  FADE_CURVE_STOPS,
  HERO_FADE_FRACTION,
  PLAYER_STATUS_SCRIM_MAX_ALPHA,
  PLAYER_STATUS_SCRIM_MIN_ALPHA,
  heroBlurDissolveMask,
  heroDissolveMask,
  horizontalEdgeFadeMask,
  smootherStep,
  topBandScrimAlpha,
  topScrimGradient,
  verticalEdgeFadeMask,
} from './fadeCurve';

describe('fadeCurve', () => {
  it('computes smootherStep with zero slope/curvature endpoints', () => {
    expect(smootherStep(-0.5)).toBe(0);
    expect(smootherStep(0)).toBe(0);
    expect(smootherStep(0.5)).toBeCloseTo(0.5, 6);
    expect(smootherStep(1)).toBe(1);
    expect(smootherStep(1.5)).toBe(1);
  });

  it('maps artwork top-band luminance to Android scrim alpha bounds', () => {
    expect(topBandScrimAlpha(null)).toBeCloseTo(PLAYER_STATUS_SCRIM_MIN_ALPHA, 5);
    expect(topBandScrimAlpha(0)).toBeCloseTo(PLAYER_STATUS_SCRIM_MIN_ALPHA, 5);
    expect(topBandScrimAlpha(1)).toBeCloseTo(PLAYER_STATUS_SCRIM_MAX_ALPHA, 5);
    expect(topBandScrimAlpha(0.5)).toBeCloseTo((PLAYER_STATUS_SCRIM_MIN_ALPHA + PLAYER_STATUS_SCRIM_MAX_ALPHA) / 2, 5);
  });

  it('generates 8-stop top scrim and 16-stop hero dissolve masks', () => {
    const scrim = topScrimGradient(0.5);
    expect(scrim).toContain('rgba(0, 0, 0, 0.5000) 0.00%');
    expect(scrim).toContain('rgba(0, 0, 0, 0.0000) 100.00%');

    const dissolve = heroDissolveMask(HERO_FADE_FRACTION, FADE_CURVE_STOPS);
    expect(dissolve).toContain('#000 0%');
    expect(dissolve).toContain('58.00%');
    expect(dissolve).toContain('rgba(0, 0, 0, 0.0000) 100.00%');

    const blurMask = heroBlurDissolveMask(HERO_FADE_FRACTION, FADE_CURVE_STOPS);
    expect(blurMask).toContain('transparent 0%');
    expect(blurMask).toContain('rgba(0, 0, 0, 1.0000) 100.00%');
  });

  it('generates vertical and horizontal edge masks', () => {
    const vMask = verticalEdgeFadeMask('28px', '28px', 4);
    expect(vMask).toContain('rgba(0, 0, 0, 0.0000) calc(28px * 0.0000)');
    expect(vMask).toContain('rgba(0, 0, 0, 0.0000) calc(100% - 28px * 0.0000)');

    const hMask = horizontalEdgeFadeMask(16, 0, 1);
    expect(hMask).toContain('#000 0%');
    expect(hMask).toContain('rgba(0, 0, 0, 0.0000) calc(100% - 0px)');
  });
});
