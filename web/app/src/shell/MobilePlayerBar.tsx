import { useCallback, useEffect, useRef } from 'react';
import { LogoMark } from '@/components/icons/LogoMark';
import { ForwardIcon, PauseIcon, PlayIcon } from '@/components/icons/Transport';
import { sizedArtwork } from '@/lib/artwork';
import { useReducedMotion } from '@/lib/motionPrefs';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { useHasVideo } from '@/state/video';
import { useMiniPlayerGestures } from './MiniPlayerGestures';
import { usePlayerSheet } from './PlayerSheetMotion';

const control =
  'grid size-(--bc-miniplayer-glyph-slot) place-items-center rounded-full text-(--bc-on-surface) disabled:opacity-40 enabled:active:scale-90 transition-[scale]';

/**
 * Android-ported floating mini player pill (MiniPlayer.kt:351-495, spec §3.5, §4.4).
 *
 * Rides 8px above FloatingTabBar on screens below 1000px (lg:hidden): 56px tall,
 * 16px side gutters (capped at 440px), 24px frost with 0.5px edge hairline,
 * 40px art (8px radius, 71×40 for video), and 32px transport glyphs inside 40px slots.
 * Supports upward pull-to-expand and 72px horizontal swipe-to-skip.
 */
export function MobilePlayerBar() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const playing = status === 'playing' || status === 'buffering';
  const hasNext = usePlayer((s) => s.index + 1 < s.queue.length || s.repeat !== 'off' || (s.autoplay && s.index >= 0));
  const setFullScreen = useUi((s) => s.setFullScreen);
  const { togglePlay, next, previous } = usePlayer.getState();
  const sheet = usePlayerSheet();
  const reducedMotion = useReducedMotion();
  const video = useHasVideo(nowPlaying?.videoId);
  const artRef = useRef<HTMLSpanElement>(null);

  const visible = Boolean(nowPlaying) || status === 'loading' || status === 'error';

  useEffect(() => {
    if (!sheet) return;
    sheet.registerMiniArt(visible ? artRef.current : null, 8);
    return () => sheet.registerMiniArt(null, 8);
  }, [sheet, visible, nowPlaying?.artworkUrl]);

  const handleOpen = useCallback(() => {
    if (sheet) sheet.open();
    else setFullScreen(true);
  }, [sheet, setFullScreen]);

  const handlePullDrag = useCallback(
    (deltaY: number) => {
      sheet?.drag(deltaY);
    },
    [sheet],
  );

  const handlePullRelease = useCallback(
    (velocityY: number) => {
      sheet?.release(velocityY);
    },
    [sheet],
  );

  const { liftRef, handlers } = useMiniPlayerGestures({
    enabled: visible,
    canPull: Boolean(sheet && nowPlaying),
    reducedMotion,
    onPullDrag: handlePullDrag,
    onPullRelease: handlePullRelease,
    onNext: next,
    onPrevious: previous,
  });

  if (!visible) return null;

  const title = status === 'error' && error ? error : nowPlaying?.title ?? '';
  const artist = status === 'error' && error ? '' : nowPlaying?.artist ?? '';

  return (
    <div
      className="fixed left-1/2 z-(--z-web-chrome) h-(--bc-miniplayer-h) w-[min(calc(100vw-2*var(--bc-bar-gutter)),var(--bc-floating-bar-max))] -translate-x-1/2 touch-none lg:hidden"
      style={{
        bottom: 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px)',
      }}
      role="region"
      aria-label="Player"
      {...handlers}
    >
      <div
        ref={liftRef}
        className="bc-frost bc-pill-squircle size-full text-(--bc-glass-content) shadow-(--bc-shadow-glass) will-change-transform"
      >
        <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-(--bc-miniplayer-transport-gap) px-3 py-2">
          <button
            type="button"
            className="flex min-w-0 items-center gap-2.5 text-start"
            aria-label="Open full screen player"
            onClick={handleOpen}
          >
            <span
              ref={artRef}
              className={`artwork-stroke relative h-(--bc-miniplayer-art) flex-none overflow-hidden rounded-(--bc-radius-art) bg-(--bc-surface-variant) ${
                video ? 'w-[71px] bg-black' : 'w-(--bc-miniplayer-art)'
              }`}
            >
              {nowPlaying?.artworkUrl ? (
                <img
                  className="size-full object-cover"
                  src={sizedArtwork(nowPlaying.artworkUrl, 80)}
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
    </div>
  );
}
