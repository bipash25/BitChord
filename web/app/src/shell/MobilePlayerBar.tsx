import { ForwardIcon, PauseIcon, PlayIcon } from '@/components/icons/Transport';
import { LogoMark } from '@/components/icons/LogoMark';
import { sizedArtwork } from '@/lib/artwork';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

const control = 'grid size-10 place-items-center rounded-[6px] text-primary disabled:opacity-40 enabled:active:scale-90 transition-[scale]';

/**
 * The docked mini player for small screens (relay.md §8): PlayerBar is
 * max-sm:hidden, so a phone has no controls at all without this. Artwork,
 * title, play/pause and next; tapping the track opens the full-screen player,
 * which exists and carries the whole transport. Minimal — it unblocks use
 * over the server relay, where phones land; it is not the mobile redesign.
 *
 * The page's bottom padding already clears it: it was sized for the hidden
 * pill's height and offset, which is more than this bar plus the safe area.
 */
export function MobilePlayerBar() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const playing = status === 'playing' || status === 'buffering';
  const hasNext = usePlayer((s) => s.index + 1 < s.queue.length || s.repeat !== 'off' || (s.autoplay && s.index >= 0));
  const openFullScreen = useUi((s) => s.setFullScreen);
  const { togglePlay, next } = usePlayer.getState();

  // The phone's only now-playing surface: a load that failed (an age gate, a
  // SABR-only track over the relay) is said here, not only in the hidden pill.
  const title = status === 'error' && error ? error : nowPlaying?.title ?? '';
  const artist = status === 'error' && error ? '' : nowPlaying?.artist ?? '';

  return (
    <div
      className="glass-material absolute inset-x-0 bottom-0 z-[calc(var(--z-web-chrome)-1)] hidden max-sm:block pb-[env(safe-area-inset-bottom)]"
      role="region"
      aria-label="Player"
    >
      {/* The padding above is the phone's home indicator: outside the bar's
          height, which stays the full token for the controls. */}
      <div className="grid h-(--mini-player-height) grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 px-3.5">
        <button
          className="flex min-w-0 items-center gap-2.5 text-start"
          aria-label="Open full screen player"
          onClick={() => openFullScreen(true)}
        >
          {nowPlaying?.artworkUrl ? (
            <img
              className="size-[34px] flex-none rounded-(--radius-artwork-small) object-cover"
              src={sizedArtwork(nowPlaying.artworkUrl, 34)}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <span className="grid size-[34px] flex-none place-items-center rounded-(--radius-artwork-small) bg-joe text-tertiary" aria-hidden="true">
              <LogoMark size={20} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={`truncate ${status === 'error' ? 'type-callout-medium text-key' : 'type-body-emphasized'}`}>
              {title || (status === 'loading' ? 'Loading…' : '')}
            </span>
            {artist && <span className="truncate type-callout-medium text-secondary">{artist}</span>}
          </span>
        </button>
        <button className={control} disabled={!nowPlaying} aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
          {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button className={control} disabled={!nowPlaying || !hasNext} aria-label="Next" onClick={next}>
          <ForwardIcon size={24} />
        </button>
      </div>
    </div>
  );
}
