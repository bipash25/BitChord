// @vitest-environment happy-dom
import { act } from 'react';
import type React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// motionPrefs reads `matchMedia` once at import and caches the query lists, so
// the stub has to exist before the module under test loads — and `matches`
// must be a getter, so flipping the preference is live for later renders.
let transparencyReduced = false;
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-transparency') && transparencyReduced;
    },
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })),
);

const { BlurredArtworkBackdrop, MeshBackdrop } = await import('./MeshBackdrop');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
  vi.useRealTimers();
  transparencyReduced = false;
});

function render(element: React.ReactElement) {
  root = createRoot(mount);
  act(() => root!.render(element));
}

function reRender(element: React.ReactElement) {
  act(() => root!.render(element));
}

/** Fires the load event on the incoming cover (the last img in the layer). */
function loadCover() {
  act(() => {
    const imgs = mount.querySelectorAll('img');
    imgs[imgs.length - 1]?.dispatchEvent(new Event('load'));
  });
}

const A = 'https://example.com/a.jpg';
const B = 'https://example.com/b.jpg';

describe('BlurredArtworkBackdrop (ArtworkMeshBackdrop.kt:128-168)', () => {
  it('draws the cover once loaded, starting invisible so it fades in over the fallback', () => {
    render(<BlurredArtworkBackdrop artworkUrl={A} />);
    const img = mount.querySelector('img');
    expect(img?.getAttribute('src')).toContain('a.jpg');
    expect(img?.style.opacity).toBe('0');
    loadCover();
    expect(mount.querySelector('img')?.style.opacity).toBe('1');
  });

  it('crossfades to the next cover and retires the old one only after the fade', () => {
    render(<BlurredArtworkBackdrop artworkUrl={A} />);
    loadCover();
    reRender(<BlurredArtworkBackdrop artworkUrl={B} />);
    // Both covers painted: the old one held while the new one loads.
    const imgs = mount.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]?.getAttribute('src')).toContain('a.jpg');
    expect(imgs[1]?.getAttribute('src')).toContain('b.jpg');
    loadCover();
    act(() => vi.advanceTimersByTime(319));
    expect(mount.querySelectorAll('img')).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    const after = mount.querySelectorAll('img');
    expect(after).toHaveLength(1);
    expect(after[0]?.getAttribute('src')).toContain('b.jpg');
  });

  it('holds the last cover when the new artwork never loads', () => {
    render(<BlurredArtworkBackdrop artworkUrl={A} />);
    loadCover();
    reRender(<BlurredArtworkBackdrop artworkUrl={B} />);
    // No load event for B: the outgoing cover is never retired.
    act(() => vi.advanceTimersByTime(5000));
    expect(mount.querySelectorAll('img')).toHaveLength(2);
  });

  it('trades the cover for the opaque fallback under reduced transparency', () => {
    transparencyReduced = true;
    render(<BlurredArtworkBackdrop artworkUrl={A} />);
    expect(mount.querySelector('[data-blur-backdrop] img')).toBeNull();
    // The scrim stays: white lyric type still gets its ground.
    expect(mount.querySelector('[data-blur-backdrop]')?.children.length).toBe(1);
  });
});

describe('MeshBackdrop wiring', () => {
  it('crossfades its blurred cover layer over the mesh for fullBlur mode', () => {
    render(<MeshBackdrop artworkUrl={A} mode="fullBlur" />);
    const blurLayer = mount.querySelector('[data-blur-backdrop]');
    expect(blurLayer?.querySelector('img')?.getAttribute('src')).toContain('a.jpg');
    expect(blurLayer?.parentElement?.style.opacity).toBe('1');
    reRender(<MeshBackdrop artworkUrl={A} mode="mesh" />);
    // The layer stays mounted (ready to fade in) but is hidden behind the mesh.
    expect(mount.querySelector('[data-blur-backdrop]')).not.toBeNull();
    expect(mount.querySelector('[data-blur-backdrop]')?.parentElement?.style.opacity).toBe('0');
  });
});
