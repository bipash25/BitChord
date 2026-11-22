import { describe, expect, it } from 'vitest';
import { REFRESH_PUCK_SIZE, REFRESH_PUCK_TRAVEL, computeRefreshPuckState } from './PullToRefresh';

describe('computeRefreshPuckState', () => {
  it('follows f linearly up to threshold and eases at 0.35 past 1', () => {
    const half = computeRefreshPuckState(0.5);
    expect(half.eased).toBeCloseTo(0.5, 4);
    expect(half.alpha).toBe(1);
    expect(half.rotationDeg).toBe(90);
    expect(half.progress).toBeCloseTo(0.4, 4);

    const over = computeRefreshPuckState(1.5);
    expect(over.eased).toBeCloseTo(1 + 0.5 * 0.35, 4);
    expect(over.translateY).toBeCloseTo(REFRESH_PUCK_TRAVEL * over.eased - REFRESH_PUCK_SIZE, 4);
    expect(over.rotationDeg).toBe(270);
    expect(over.progress).toBe(0.8);
  });

  it('ramps alpha smoothly over the first third of travel', () => {
    const start = computeRefreshPuckState(0.1);
    expect(start.alpha).toBeCloseTo(0.3, 4);
  });
});
