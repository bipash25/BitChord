// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { SidePanel } from './SidePanel';

// The lyrics body is a lazy Lit bundle; the panel's own surface is what is
// under test, so the panel content stands in for it.
vi.mock('./LyricsPanel', () => ({ LyricsPanel: () => <div data-testid="lyrics-body" /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW_PLAYING = {
  videoId: 'abc',
  title: 'Midnight City',
  artist: 'M83',
  artworkUrl: 'https://example.com/cover.jpg',
  durationSec: 243,
  streamInfo: null,
  stream: null,
};

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
  usePlayer.setState({ nowPlaying: null, status: 'idle', error: null, queue: [], index: -1 });
  useUi.setState({ sidePanel: 'lyrics', fullScreen: false });
  // The reduced-blur heuristic reads the core count; pin it high so the
  // backdrop tests exercise the artwork path, not the fallback.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
  vi.restoreAllMocks();
});

function renderPanel() {
  root = createRoot(mount);
  act(() => root!.render(<SidePanel />));
}

describe('SidePanel backdrop (NowPlayingScreen.kt:2362-2377: lyrics over the blurred cover)', () => {
  it('stands the lyrics on the blurred artwork instead of the old frost', () => {
    usePlayer.setState({ nowPlaying: NOW_PLAYING, status: 'playing' });
    renderPanel();
    const aside = mount.querySelector('aside');
    expect(aside?.getAttribute('aria-label')).toBe('Lyrics');
    // The frost is gone: the blurred cover layer replaced it.
    expect(aside?.className).not.toContain('bc-frost');
    const backdrop = aside?.querySelector('[data-blur-backdrop]');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.querySelector('img')?.getAttribute('src')).toContain('cover.jpg');
  });

  it('renders the backdrop even before any track has artwork, as the scrim over the fallback', () => {
    renderPanel();
    expect(mount.querySelector('aside [data-blur-backdrop]')).not.toBeNull();
    expect(mount.querySelector('aside [data-blur-backdrop] img')).toBeNull();
  });

  it('keeps the backdrop off while the full-screen player owns the lyrics', () => {
    useUi.setState({ fullScreen: true });
    renderPanel();
    expect(mount.querySelector('aside')).toBeNull();
  });

  it('gives Up Next the same blurred-cover ground the Android queue stands on', () => {
    useUi.setState({ sidePanel: 'up-next' });
    usePlayer.setState({ nowPlaying: NOW_PLAYING, status: 'playing' });
    renderPanel();
    expect(mount.querySelector('aside')?.getAttribute('aria-label')).toBe('Up Next');
    expect(mount.querySelector('aside [data-blur-backdrop] img')).not.toBeNull();
  });
});
