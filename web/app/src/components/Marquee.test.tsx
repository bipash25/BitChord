// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARQUEE_GAP_PX, MARQUEE_SPEED_PX_PER_SEC, Marquee, computeMarqueeMetrics } from './Marquee';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
});

describe('computeMarqueeMetrics', () => {
  it('disables scrolling when text fits inside its container', () => {
    expect(computeMarqueeMetrics(120, 200)).toEqual({
      overflowing: false,
      travelPx: 0,
      scrollMs: 0,
    });
  });

  it('computes 48px-gapped travel distance and 26px/s duration when overflowing', () => {
    const m = computeMarqueeMetrics(260, 150);
    expect(m.overflowing).toBe(true);
    expect(m.travelPx).toBe(260 + MARQUEE_GAP_PX);
    expect(m.scrollMs).toBe(Math.round(((260 + MARQUEE_GAP_PX) / MARQUEE_SPEED_PX_PER_SEC) * 1000));
  });
});

describe('Marquee', () => {
  it('renders its text child', () => {
    root = createRoot(mount);
    act(() => root!.render(<Marquee measureKey="A very long song title">A very long song title</Marquee>));
    expect(mount.textContent).toContain('A very long song title');
  });
});
