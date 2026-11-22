// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QR_DOT_RADIUS_RATIO, QR_DOT_SCALE, QrCode, buildQrGeometry } from './QrCode';

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

describe('buildQrGeometry', () => {
  it('produces rounded-square module geometry matching QrCode.kt ratios', () => {
    const geom = buildQrGeometry('https://bitchord.bipro.dev/invite/ABC123', 116);
    expect(geom).not.toBeNull();
    expect(geom!.modules).toBeGreaterThanOrEqual(21);
    const cell = 116 / geom!.modules;
    const expectedDot = Number((cell * QR_DOT_SCALE).toFixed(2));
    const expectedRx = Number((cell * QR_DOT_SCALE * QR_DOT_RADIUS_RATIO).toFixed(2));
    expect(geom!.rects[0]?.size).toBe(expectedDot);
    expect(geom!.rects[0]?.rx).toBe(expectedRx);
  });

  it('returns null for blank content', () => {
    expect(buildQrGeometry('   ', 120)).toBeNull();
  });
});

describe('QrCode', () => {
  it('renders an SVG with rounded rect modules and quiet zone padding', () => {
    root = createRoot(mount);
    act(() => root!.render(<QrCode content="https://bitchord.bipro.dev/invite/XYZ789" size={140} />));

    const container = mount.querySelector('[role="img"]');
    expect(container).not.toBeNull();
    const svg = container?.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll('rect').length).toBeGreaterThan(100);
  });
});
