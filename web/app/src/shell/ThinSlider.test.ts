import { describe, expect, it } from 'vitest';
import { springStep } from '@/lib/spring';
import {
  LOADING_MIN_MS,
  PULSE_REST,
  SCRUB_ACTIVE_HEIGHT_PX,
  SCRUB_IDLE_HEIGHT_PX,
  SCRUB_MORPH_MS,
  SCRUB_THICKNESS_SPRING,
  SCRUB_TOUCH_HEIGHT_PX,
  SCRUBBER_LABEL_LIFT_PX,
  SHEEN_BAND_FRACTION,
  SHEEN_SWEEP_MS,
  WINDOW_FADE_MS,
  WINDOW_FEATHER_MAX_PX,
  WINDOW_FEATHER_MIN_PX,
  WINDOW_FEATHER_STEPS,
  beatShape,
  computeWindowFeatherStops,
  stepPulse,
} from './thinSliderMath';

describe('ThinSlider', () => {
  it('pins the Android ThinSlider and PlayerScrubber constants', () => {
    expect(SCRUB_IDLE_HEIGHT_PX).toBe(7);
    expect(SCRUB_ACTIVE_HEIGHT_PX).toBe(12);
    expect(SCRUB_TOUCH_HEIGHT_PX).toBe(34);
    expect(SCRUBBER_LABEL_LIFT_PX).toBe(9);
    expect(SHEEN_BAND_FRACTION).toBe(0.34);
    expect(SHEEN_SWEEP_MS).toBe(1000);
    expect(SCRUB_MORPH_MS).toBe(450);
    expect(LOADING_MIN_MS).toBe(600);
    expect(WINDOW_FADE_MS).toBe(500);
  });

  it('uses an under-damped bounce spring (ζ=0.5, stiffness=400) for 7px→12px thickness', () => {
    let h = SCRUB_IDLE_HEIGHT_PX;
    let v = 0;
    let maxH = h;
    for (let i = 0; i < 60; i++) {
      [h, v] = springStep(h, v, SCRUB_ACTIVE_HEIGHT_PX, 1 / 60, SCRUB_THICKNESS_SPRING.stiffness, SCRUB_THICKNESS_SPRING.damping);
      if (h > maxH) maxH = h;
    }
    // ζ=0.5 bounces slightly past 12px before settling at 12px.
    expect(maxH).toBeGreaterThan(SCRUB_ACTIVE_HEIGHT_PX);
    expect(Math.abs(h - SCRUB_ACTIVE_HEIGHT_PX)).toBeLessThan(0.1);
  });

  it('builds 6-step smoothstep feather ramps clamped between 6px and 40px', () => {
    const stops = computeWindowFeatherStops(200, 0.5);
    expect(stops.length).toBe((WINDOW_FEATHER_STEPS + 1) * 2);
    expect(stops[0]).toEqual({ offset: 0, alpha: 0 });
    // 40% of 200px = 80px -> clamped to WINDOW_FEATHER_MAX_PX (40px) => offset 40/200 = 0.2.
    expect(stops[WINDOW_FEATHER_STEPS]!.offset).toBeCloseTo(WINDOW_FEATHER_MAX_PX / 200, 5);
    expect(stops[WINDOW_FEATHER_STEPS]!.alpha).toBeCloseTo(0.5, 5);
    expect(stops[stops.length - 1]).toEqual({ offset: 1, alpha: 0 });

    // Narrow 10px span: min feather 6px clamped to span/2 = 5px => offset 0.5.
    const narrow = computeWindowFeatherStops(10, 0.5);
    expect(WINDOW_FEATHER_MIN_PX).toBe(6);
    expect(narrow[WINDOW_FEATHER_STEPS]!.offset).toBeCloseTo(0.5, 5);
  });

  it('pulses Automix fill with cos² beat shape down to PULSE_REST (0.1)', () => {
    expect(beatShape(0)).toBeCloseTo(1, 6);
    expect(beatShape(0.5)).toBeCloseTo(0, 6);
    expect(beatShape(1)).toBeCloseTo(1, 6);

    const pulse = { cover: 1, depth: 1, phase: 0.5, locked: true, last: 1000 };
    const atHalfBeat = stepPulse(pulse, 1000, { phase: 0.5 }, false);
    expect(atHalfBeat.alpha).toBeCloseTo(PULSE_REST, 5);
  });
});
