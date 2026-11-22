import { describe, expect, it } from 'vitest';
import { GLASS_PILL_SPRING, PLAYER_SHEET_SPRING, TAB_PILL_SPRING, springStep } from './spring';

describe('springStep', () => {
  it('converges to the target with zero velocity', () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 120; i++) {
      [x, v] = springStep(x, v, 100, 1 / 60, TAB_PILL_SPRING.stiffness, TAB_PILL_SPRING.damping);
    }
    expect(x).toBeCloseTo(100, 2);
    expect(Math.abs(v)).toBeLessThan(0.1);
  });

  it('produces the underdamped soft overshoot for the tab pill spring (ζ 0.72)', () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      [x, v] = springStep(x, v, 100, 1 / 60, TAB_PILL_SPRING.stiffness, TAB_PILL_SPRING.damping);
      if (x > peak) peak = x;
    }
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(106);
  });

  it('stays critically damped for the player sheet spring (ζ 1)', () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 120; i++) {
      [x, v] = springStep(x, v, 100, 1 / 60, PLAYER_SHEET_SPRING.stiffness, PLAYER_SHEET_SPRING.damping);
      expect(x).toBeLessThanOrEqual(100.05);
    }
    expect(x).toBeCloseTo(100, 1);
  });

  it('remains stable across coarse frame steps via 1/240s substepping', () => {
    let fineX = 0;
    let fineV = 0;
    for (let i = 0; i < 24; i++) {
      [fineX, fineV] = springStep(fineX, fineV, 100, 1 / 240, GLASS_PILL_SPRING.stiffness, GLASS_PILL_SPRING.damping);
    }
    const [coarseX, coarseV] = springStep(0, 0, 100, 24 / 240, GLASS_PILL_SPRING.stiffness, GLASS_PILL_SPRING.damping);
    expect(coarseX).toBeCloseTo(fineX, 10);
    expect(coarseV).toBeCloseTo(fineV, 10);
  });
});
