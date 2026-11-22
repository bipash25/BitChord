import { describe, expect, it } from 'vitest';
import { GlassPillMotion } from './glassPillMotion';

describe('GlassPillMotion', () => {
  it('lifts on animateTo, squashes during acceleration, and settles cleanly flat', () => {
    const motion = new GlassPillMotion(0);
    motion.stepPx = 88;
    motion.animateTo(2);
    expect(motion.isFlat).toBe(false);

    let t = 0;
    let sawLift = false;
    let sawSquash = false;
    let sawRim = false;

    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      const active = motion.step(1 / 60, t);
      if (motion.liftX > 0.5 && motion.liftY > 0.5) sawLift = true;
      if (Math.abs(motion.deviation) > 0.001) sawSquash = true;
      if (motion.rimAlpha() > 0.2) sawRim = true;
      if (!active) break;
    }

    expect(sawLift).toBe(true);
    expect(sawSquash).toBe(true);
    expect(sawRim).toBe(true);
    expect(motion.position).toBe(2);
    expect(motion.liftX).toBe(0);
    expect(motion.liftY).toBe(0);
    expect(motion.rimAlpha()).toBe(0);
    expect(motion.isFlat).toBe(true);
  });

  it('snaps immediately without lift or squash under reduceMotion', () => {
    const motion = new GlassPillMotion(0);
    motion.reduceMotion = true;
    motion.animateTo(3);
    expect(motion.position).toBe(3);
    expect(motion.liftX).toBe(0);
    expect(motion.deviation).toBe(0);
    expect(motion.isFlat).toBe(true);
  });

  it('tracks drag and settles onto released target tab', () => {
    const motion = new GlassPillMotion(1);
    motion.stepPx = 88;
    motion.startDrag();
    motion.dragTo(2.4);

    let t = 0;
    for (let i = 0; i < 15; i++) {
      t += 1 / 60;
      motion.step(1 / 60, t);
    }
    expect(motion.position).toBeGreaterThan(2);

    motion.release(2);
    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      if (!motion.step(1 / 60, t)) break;
    }
    expect(motion.position).toBe(2);
    expect(motion.isFlat).toBe(true);
  });
});
