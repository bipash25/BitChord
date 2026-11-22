import { describe, expect, it } from 'vitest';
import { MINI_PLAYER_SETTLE_SPRING, springStep } from '@/lib/spring';
import {
  PULL_BIAS,
  PULL_LIFT_EASE,
  PULL_LIFT_RATE,
  TOUCH_SLOP,
  TRACK_SWIPE_THRESHOLD,
  computeVelocityY,
  decideGestureAxis,
  pullLift,
  resolveHorizontalSwipe,
} from './MiniPlayerGestures';

describe('MiniPlayerGestures', () => {
  it('pins Android gesture constants from MiniPlayer.kt', () => {
    expect(TRACK_SWIPE_THRESHOLD).toBe(72);
    expect(PULL_BIAS).toBe(1.5);
    expect(PULL_LIFT_EASE).toBe(72);
    expect(PULL_LIFT_RATE).toBe(0.5);
  });

  it('locks gesture axis at touch slop with 1.5x upward pull bias', () => {
    expect(decideGestureAxis(3, -4, TOUCH_SLOP)).toBe('pending');
    // Arcing thumb pull: |dx| = 24 < 20 * 1.5 (30) -> still vertical-up.
    expect(decideGestureAxis(24, -20)).toBe('vertical-up');
    // Shallow horizontal swipe: |dx| = 35 >= 20 * 1.5 (30) -> horizontal.
    expect(decideGestureAxis(35, -20)).toBe('horizontal');
    // Downward drag on mini player -> ignore.
    expect(decideGestureAxis(5, 20)).toBe('ignore');
  });

  it('computes rubber-band pullLift at 0.5 / sqrt(1 + p/72) rate', () => {
    expect(pullLift(0)).toBe(0);
    expect(pullLift(-10)).toBe(0);
    expect(pullLift(72)).toBeCloseTo(72 * (Math.SQRT2 - 1), 4);
    // Initial slope near 0 is ~0.5.
    expect(pullLift(1) / 1).toBeCloseTo(0.5, 2);
  });

  it('triggers next on <= -72px and previous on >= 72px', () => {
    expect(resolveHorizontalSwipe(-71)).toBeNull();
    expect(resolveHorizontalSwipe(71)).toBeNull();
    expect(resolveHorizontalSwipe(-72)).toBe('next');
    expect(resolveHorizontalSwipe(72)).toBe('previous');
  });

  it('settles MINI_PLAYER_SETTLE_SPRING (ζ 0.65, stiffness 400) back to 0', () => {
    let x = pullLift(120);
    let v = 0;
    for (let i = 0; i < 60; i++) {
      [x, v] = springStep(x, v, 0, 1 / 60, MINI_PLAYER_SETTLE_SPRING.stiffness, MINI_PLAYER_SETTLE_SPRING.damping);
    }
    expect(Math.abs(x)).toBeLessThan(0.5);
  });

  it('estimates vertical release velocity in px/s', () => {
    const vel = computeVelocityY([
      { y: 700, t: 100 },
      { y: 650, t: 150 },
      { y: 600, t: 200 },
    ]);
    expect(vel).toBeCloseTo(-1000, 1);
  });
});
