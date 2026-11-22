// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/data/music/types';
import { queryClient } from '@/lib/queryClient';
import { usePlayer } from '@/state/player';
import { useSleepTimer } from '@/state/sleepTimer';
import { TrackMenu } from './TrackMenu';

let mockSignedIn = false;

vi.mock('@/data/music/queries', () => ({
  useSignedIn: () => mockSignedIn,
  useLikeStatus: () => ({ data: 'INDIFFERENT', isPending: false }),
  useSetLiked: () => ({ mutate: vi.fn() }),
  useSetDisliked: () => ({ mutate: vi.fn() }),
  usePlaylistOptions: () => ({ data: [], isPending: false, isError: false }),
  useAddToPlaylist: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/data/music/api', () => ({
  fetchTrackLinks: vi.fn().mockResolvedValue(null),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleTrack: Track = {
  videoId: 'Xi8Fabcb_MA',
  title: 'Midnight City',
  artists: [{ id: 'UC123', name: 'M83' }],
  album: { id: 'MPREb_123', name: "Hurry Up, We're Dreaming" },
  durationSec: 243,
  explicit: false,
  thumbnail: null,
  index: null,
  plays: null,
};

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  mockSignedIn = false;
  useSleepTimer.setState({ minutes: null, deadlineMs: null, afterTrack: false });
  document.body.appendChild(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
  vi.restoreAllMocks();
});

function renderMenu(inPlayer = true) {
  root = createRoot(mount);
  act(() =>
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TrackMenu track={sampleTrack} inPlayer={inPlayer} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}

describe('TrackMenu', () => {
  it('renders SongActionsMenu web-feasible options including player-only items', () => {
    renderMenu(true);
    const trigger = mount.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const text = menu!.textContent ?? '';
    expect(text).toContain('Play Next');
    expect(text).toContain('Queue');
    expect(text).toContain('Share');
    expect(text).toContain('Start Radio');
    expect(text).toContain('Go to Album');
    expect(text).toContain('Go to Artist');
    expect(text).toContain('Song Info');
    expect(text).toContain('Open in YouTube Music');
    expect(text).toContain('Sleep Timer');
    expect(text).toContain('Copy Log');
  });

  it('includes Favorite, Dislike, and Add to Playlist when signed in', () => {
    mockSignedIn = true;
    renderMenu(true);
    const trigger = mount.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    act(() => trigger!.click());

    const menu = document.body.querySelector('[role="menu"]');
    const text = menu!.textContent ?? '';
    expect(text).toContain('Favorite');
    expect(text).toContain('Dislike');
    expect(text).toContain('Add to Playlist');
    expect(text).toContain('Start Radio');
  });

  it('opens SongInfoDialog from Song Info row and switches to Sleep Timer presets', () => {
    renderMenu(true);
    const trigger = mount.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    act(() => trigger!.click());

    const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const sleepBtn = items.find((el) => el.textContent?.includes('Sleep Timer'));
    expect(sleepBtn).toBeDefined();
    act(() => sleepBtn!.click());

    const subText = document.body.querySelector('[role="menu"]')?.textContent ?? '';
    expect(subText).toContain('After this song');
    expect(subText).toContain('15 minutes');

    const fifteenBtn = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((el) =>
      el.textContent?.includes('15 minutes'),
    );
    expect(fifteenBtn).toBeDefined();
    act(() => fifteenBtn!.click());
    expect(useSleepTimer.getState().minutes).toBe(15);

    // Reopen and open Song Info dialog.
    act(() => trigger!.click());
    const infoBtn = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('Song Info'),
    );
    expect(infoBtn).toBeDefined();
    act(() => infoBtn!.click());

    const dialog = document.body.querySelector('[role="dialog"][aria-label="Song Info"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Xi8Fabcb_MA');
    expect(dialog!.textContent).toContain("Hurry Up, We're Dreaming");
  });

  it('starts radio when Start Radio is selected', () => {
    const startRadio = vi.spyOn(usePlayer.getState(), 'startRadio').mockImplementation(() => {});
    renderMenu(true);
    const trigger = mount.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    act(() => trigger!.click());

    const radioBtn = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('Start Radio'),
    );
    expect(radioBtn).toBeDefined();
    act(() => radioBtn!.click());
    expect(startRadio).toHaveBeenCalledWith(sampleTrack);
  });
});
