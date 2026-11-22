import { ForwardIcon, PauseIcon, PlayIcon } from '@/components/icons/Transport';
import { LogoMark } from '@/components/icons/LogoMark';
import { sizedArtwork } from '@/lib/artwork';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

const control =
  'grid size-(--bc-miniplayer-glyph-slot) place-items-center rounded-full text-(--bc-on-surface) disabled:opacity-40 enabled:active:scale-90 transition-[scale]';

/**
 * Android-ported floating mini player pill (MiniPlayer.kt:351-495, spec §3.5).
 *
 * Rides 8px above FloatingTabBar on screens below 1000px (lg:hidden): 56px tall,
 * 16px side gutters (capped at 440px), 24px frost with 0.5px edge hairline,
 * 40px art (8px radius), and 32px transport glyphs inside 40px slots.
 */
export function MobilePlayerBar() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const playing = status === 'playing' || status === 'buffering';
  const hasNext = usePlayer((s) => s.index + 1 < s.queue.length || s.repeat !== 'off' || (s.autoplay && s.index >= 0));
  const openFullScreen = useUi((s) => s.setFullScreen);
  const { togglePlay, next } = usePlayer.getState();

  if (!nowPlaying && status !== 'loading' && status !== 'error') return null;

  const title = status === 'error' && error ? error : nowPlaying?.title ?? '';
  const artist = status === 'error' && error ? '' : nowPlaying?.artist ?? '';

  return (
    <div
      className="bc-frost bc-pill-squircle fixed left-1/2 z-(--z-web-chrome) h-(--bc-miniplayer-h) w-[min(calc(100vw-2*var(--bc-bar-gutter)),var(--bc-floating-bar-max))] -translate-x-1/2 text-(--bc-glass-content) shadow-(--bc-shadow-glass) lg:hidden"
      style={{
        bottom: 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px)',
      }}
      role="region"
      aria-label="Player"
    >
      <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-(--bc-miniplayer-transport-gap) px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2.5 text-start"
          aria-label="Open full screen player"
          onClick={() => openFullScreen(true)}
        >
          <span className="artwork-stroke relative size-(--bc-miniplayer-art) flex-none overflow-hidden rounded-(--bc-radius-art) bg-(--bc-surface-variant)">
            {nowPlaying?.artworkUrl ? (
              <img
                className="size-full object-cover"
                src={sizedArtwork(nowPlaying.artworkUrl, 40)}
                alt=""
                referrerPolicy="no-referrer"
                decoding="async"
              />
            ) : (
              <span className="grid size-full place-items-center text-(--bc-on-surface-variant)" aria-hidden="true">
                <LogoMark size={20} />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={`truncate font-(family-name:--bc-font-family) text-[16px] leading-[1.25] font-semibold tracking-(--bc-tracking-title-md) ${
                status === 'error' ? 'text-(--bc-accent-red)' : 'text-(--bc-on-surface)'
              }`}
            >
              {title || (status === 'loading' ? 'Loading…' : '')}
            </span>
            {artist && (
              <span className="truncate font-(family-name:--bc-font-family) text-[14px] leading-[1.25] font-normal tracking-(--bc-tracking-body) text-(--bc-on-surface-variant)">
                {artist}
              </span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-(--bc-miniplayer-transport-gap)">
          <button type="button" className={control} disabled={!nowPlaying} aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {playing ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          <button type="button" className={control} disabled={!nowPlaying || !hasNext} aria-label="Next" onClick={next}>
            <ForwardIcon size={28} />
          </button>
        </div>
      </div>
    </div>
  );
}
