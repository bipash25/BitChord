// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { playingBarHeight } from './PlayingBars';
import { SongRow, SongRowDivider } from './SongRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/data/music/queries', () => ({
  useLikeStatus: () => ({ data: null, isPending: false }),
  useSetLiked: () => ({ mutate: vi.fn() }),
  useSignedIn: () => false,
  usePlaylistOptions: () => ({ data: [], isPending: false, isError: false }),
  useAddToPlaylist: () => ({ mutate: vi.fn() }),
}));

const sampleTrack: Track = {
  videoId: 'abc123def45',
  title: 'Let Down',
  artists: [{ name: 'Radiohead', id: 'UCradio' }],
  album: { name: 'OK Computer', id: 'MPREok' },
  thumbnail: 'https://lh3.googleusercontent.com/art=w120-h120',
  durationSec: 299,
  explicit: true,
  index: 5,
  plays: null,
};

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
  usePlayer.setState({ nowPlaying: null, status: 'idle' });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
});

describe('SongRow', () => {
  it('renders artwork row with title, artist, explicit badge, duration and trailing menu', () => {
    const onPlay = vi.fn();
    root = createRoot(mount);
    act(() => {
      root!.render(
        <MemoryRouter>
          <SongRow track={sampleTrack} onPlay={onPlay} />
          <SongRowDivider />
        </MemoryRouter>,
      );
    });

    expect(mount.textContent).toContain('Let Down');
    expect(mount.textContent).toContain('Radiohead');
    expect(mount.textContent).toContain('4:59');
    expect(mount.querySelector('[aria-label="Explicit"]')).not.toBeNull();
    expect(mount.querySelector('[aria-label="More options for Let Down"]')).not.toBeNull();

    const divider = mount.querySelector('div[aria-hidden="true"]') as HTMLElement;
    expect(divider.style.marginLeft).toBe('var(--bc-queue-divider-inset)');

    const row = mount.querySelector('[role="button"]') as HTMLElement;
    act(() => row.click());
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('renders numbered album row and switches to active state + PlayingBars when playing', () => {
    usePlayer.setState({
      nowPlaying: {
        videoId: sampleTrack.videoId,
        title: sampleTrack.title,
        artist: 'Radiohead',
        artworkUrl: sampleTrack.thumbnail,
        durationSec: 299,
        streamInfo: null,
        stream: null,
      },
      status: 'playing',
    });

    root = createRoot(mount);
    act(() => {
      root!.render(
        <MemoryRouter>
          <SongRow track={sampleTrack} trackNumber={5} searchPlayingStyle onPlay={vi.fn()} />
          <SongRowDivider numbered />
        </MemoryRouter>,
      );
    });

    expect(mount.querySelector('[aria-label="Playing"]')).not.toBeNull();
    const row = mount.querySelector('[role="button"]');
    expect(row?.getAttribute('data-current')).toBe('true');

    const dividers = mount.querySelectorAll('[aria-hidden="true"]');
    const divider = dividers[dividers.length - 1] as HTMLElement;
    expect(divider.style.marginLeft).toBe('56px');
  });

  it('dims missing tracks and disables play', () => {
    const onPlay = vi.fn();
    root = createRoot(mount);
    act(() => {
      root!.render(
        <MemoryRouter>
          <SongRow track={{ ...sampleTrack, unavailable: 'missing' }} onPlay={onPlay} />
        </MemoryRouter>,
      );
    });

    const row = mount.querySelector('[role="button"]') as HTMLElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Not found');
    act(() => row.click());
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('playingBarHeight', () => {
  it('stays bounded between each bar minimum and 1 across its period', () => {
    const mins = [0.38, 0.78, 0.52];
    for (let bar = 0; bar < 3; bar++) {
      for (let ms = 0; ms <= 2000; ms += 37) {
        const h = playingBarHeight(bar, ms);
        expect(h).toBeGreaterThanOrEqual(mins[bar]! - 0.001);
        expect(h).toBeLessThanOrEqual(1.001);
      }
    }
  });
});
