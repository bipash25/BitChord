// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayer } from '@/state/player';
import { MobilePlayerBar } from './MobilePlayerBar';
import { PlayerSheetContext, PlayerSheetController } from './PlayerSheetMotion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
  usePlayer.setState({ nowPlaying: null, status: 'idle', error: null, queue: [], index: -1 });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
});

function renderBar() {
  root = createRoot(mount);
  act(() => root!.render(<MobilePlayerBar />));
}

describe('MobilePlayerBar', () => {
  it('stays hidden when no track is loaded or active', () => {
    renderBar();
    expect(mount.querySelector('[role="region"]')).toBeNull();
  });

  it('renders the 56px frosted mini player pill when a track is loaded', () => {
    usePlayer.setState({
      nowPlaying: {
        videoId: 'abc',
        title: 'Midnight City',
        artist: 'M83',
        artworkUrl: null,
        durationSec: 243,
        streamInfo: null,
        stream: null,
      },
      status: 'playing',
      queue: [
        {
          entryId: 'e1',
          tier: 'context',
          source: null,
          track: {
            videoId: 'abc',
            title: 'Midnight City',
            artists: [{ id: null, name: 'M83' }],
            album: null,
            durationSec: 243,
            explicit: false,
            thumbnail: null,
            index: null,
            plays: null,
          },
        },
      ],
      index: 0,
    });
    renderBar();
    const region = mount.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toContain('Midnight City');
    expect(region?.textContent).toContain('M83');
    expect(mount.querySelector('button[aria-label="Pause"]')).not.toBeNull();
  });

  it('opens the PlayerSheetController when the track button is tapped', () => {
    const onShown = vi.fn();
    const sheet = new PlayerSheetController(onShown);
    sheet.setReducedMotion(true);

    usePlayer.setState({
      nowPlaying: {
        videoId: 'abc',
        title: 'Midnight City',
        artist: 'M83',
        artworkUrl: null,
        durationSec: 243,
        streamInfo: null,
        stream: null,
      },
      status: 'playing',
      queue: [],
      index: -1,
    });

    root = createRoot(mount);
    act(() =>
      root!.render(
        <PlayerSheetContext.Provider value={sheet}>
          <MobilePlayerBar />
        </PlayerSheetContext.Provider>,
      ),
    );

    const openBtn = mount.querySelector<HTMLButtonElement>('button[aria-label="Open full screen player"]');
    expect(openBtn).not.toBeNull();
    act(() => openBtn!.click());
    expect(onShown).toHaveBeenCalledWith(true);
    expect(sheet.getSnapshot().phase).toBe('open');
    sheet.dispose();
  });
});
