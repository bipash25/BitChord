import { AudioLines, ListPlus, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HELD_LONG_PRESS_MS, HELD_MOVE_TOLERANCE_PX, HeldContextMenu, type HeldBounds } from '@/components/HeldContextMenu';
import { PrefetchLink } from '@/components/PrefetchLink';
import type { ArtistRef, Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { artistHref, formatDuration } from './links';
import { PlayingBars } from './PlayingBars';
import { TrackMenu, TrackMenuItems } from './TrackMenu';

export const SWIPE_COMMIT_FRACTION = 0.45;
export const SWIPE_HYSTERESIS_FACTOR = 0.8;

export interface SongRowProps {
  track: Track;
  onPlay: () => void;
  /** Numbered rows (albums) omit the repeated cover and show the track number in a 24px column. */
  trackNumber?: number | null;
  fallbackArtwork?: string | null;
  fallbackArtists?: ArtistRef[];
  /** Search/History/Detail style: shows animated PlayingBars over art/slot instead of tinting the whole row. */
  searchPlayingStyle?: boolean;
  /** Swipe-to-queue callback; when provided, horizontal drag >= 45% width triggers it. */
  onSwipeToQueue?: () => void;
  /** Optional subtitle override (e.g. "Album · Artist"). */
  subtitle?: string | null;
  /** Optional custom trailing action rendered just ahead of the overflow button. */
  trailing?: React.ReactNode;
  /** Render 16:9 thumbnail box at 52px height for music videos (Common.kt:171). */
  isVideo?: boolean;
}

function ArtistsLine({ artists }: { artists: ArtistRef[] }) {
  return (
    <>
      {artists.map((artist, i) => {
        const href = artistHref(artist.id);
        return (
          <span key={`${artist.name}-${i}`}>
            {i > 0 && ', '}
            {href ? (
              <PrefetchLink
                to={href}
                className="text-inherit hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {artist.name}
              </PrefetchLink>
            ) : (
              artist.name
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * Android's `SongRow` (`Common.kt:269-695`, spec §6.9): the single list-row
 * primitive shared by Album, Playlist, History, Search, and Library song lists.
 *
 * 16px horizontal / 4px vertical padding, 52px cover (8px corner + 0.5px
 * inner hairline) or 24px number column, 16px Medium title, 14px subtitle,
 * 12px duration, and a 36px `⋮` button overhanging 14px into the right gutter.
 */
export function SongRow({
  track,
  onPlay,
  trackNumber = null,
  fallbackArtwork,
  fallbackArtists,
  searchPlayingStyle = false,
  onSwipeToQueue,
  subtitle,
  trailing,
  isVideo = false,
}: SongRowProps) {
  const isCurrent = usePlayer((s) => s.nowPlaying?.videoId === track.videoId);
  const isPlaying = usePlayer(
    (s) => s.nowPlaying?.videoId === track.videoId && (s.status === 'playing' || s.status === 'buffering'),
  );
  const togglePlay = usePlayer((s) => s.togglePlay);
  const addToQueue = usePlayer((s) => s.addToQueue);

  const unavailable = track.unavailable;
  const effectiveArtists = track.artists.length > 0 ? track.artists : (fallbackArtists ?? []);
  const resolvedTrack: Track =
    track.artists.length || !fallbackArtists ? track : { ...track, artists: fallbackArtists };

  const handleRowClick = () => {
    if (unavailable) return;
    if (isCurrent) togglePlay();
    else onPlay();
  };

  // Horizontal swipe-to-queue (Common.kt:369-479, spec §4.9): commits at 45% of row width.
  const rowRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<{ timer: number | null; startX: number; startY: number }>({
    timer: null,
    startX: 0,
    startY: 0,
  });
  const [held, setHeld] = useState<{ open: boolean; bounds: HeldBounds } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current.timer !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const swipeRef = useRef({
    active: false,
    locked: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    dx: 0,
    armed: false,
    suppressClick: false,
  });
  const [swipeX, setSwipeX] = useState(0);
  const [armedNudge, setArmedNudge] = useState(false);

  const queueHandler = unavailable
    ? undefined
    : (onSwipeToQueue ?? (() => addToQueue([resolvedTrack])));

  const openHeldMenu = useCallback(() => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    swipeRef.current.active = false;
    swipeRef.current.locked = false;
    swipeRef.current.suppressClick = true;
    setSwipeX(0);
    setArmedNudge(false);
    setHeld({
      open: true,
      bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  }, []);

  const dismissHeldMenu = useCallback(() => {
    setHeld((prev) => (prev ? { ...prev, open: false } : null));
  }, []);

  const clearHeldMenu = useCallback(() => {
    setHeld(null);
    setTimeout(() => {
      swipeRef.current.suppressClick = false;
    }, 60);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || unavailable) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest('button, a')) {
      cancelLongPress();
      longPressRef.current.startX = e.clientX;
      longPressRef.current.startY = e.clientY;
      longPressRef.current.timer = window.setTimeout(() => {
        longPressRef.current.timer = null;
        openHeldMenu();
      }, HELD_LONG_PRESS_MS);
    }

    if (!queueHandler || e.pointerType === 'mouse') return;
    swipeRef.current = {
      active: true,
      locked: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      armed: false,
      suppressClick: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressRef.current.timer !== null) {
      const moveDist = Math.hypot(e.clientX - longPressRef.current.startX, e.clientY - longPressRef.current.startY);
      if (moveDist > HELD_MOVE_TOLERANCE_PX) cancelLongPress();
    }
    const s = swipeRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
        s.active = false;
        return;
      }
      s.locked = true;
      s.suppressClick = true;
      cancelLongPress();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const width = rowRef.current?.clientWidth || 360;
    const clamped = Math.max(-width * 0.65, Math.min(width * 0.65, dx));
    s.dx = clamped;
    const armAt = width * SWIPE_COMMIT_FRACTION;
    const travelled = Math.abs(clamped);
    if (!s.armed && travelled >= armAt) {
      s.armed = true;
      setArmedNudge(true);
    } else if (s.armed && travelled < armAt * SWIPE_HYSTERESIS_FACTOR) {
      s.armed = false;
      setArmedNudge(false);
    }
    setSwipeX(clamped);
  };

  const finishSwipe = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    const s = swipeRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    const width = rowRef.current?.clientWidth || 360;
    if (s.locked && Math.abs(s.dx) >= width * SWIPE_COMMIT_FRACTION && queueHandler) {
      queueHandler();
    }
    s.active = false;
    s.locked = false;
    s.dx = 0;
    s.armed = false;
    setArmedNudge(false);
    setSwipeX(0);
    if (s.suppressClick) {
      setTimeout(() => {
        swipeRef.current.suppressClick = false;
      }, 60);
    }
  };

  const showActiveRowTint = isCurrent && !searchPlayingStyle;
  const titleColor = showActiveRowTint
    ? 'text-(--bc-page-accent,var(--bc-primary))'
    : 'text-(--bc-page-on,var(--bc-on-surface))';
  const secondaryColor = 'text-(--bc-page-on-variant,var(--bc-on-surface-variant))';
  const accentColor = 'text-(--bc-page-accent,var(--bc-primary))';

  const renderRowBody = (includeMenu: boolean) => (
    <>
      {trackNumber !== null ? (
        <div className="mr-(--bc-page-gutter) grid h-[52px] w-(--bc-track-number-w) shrink-0 place-items-center">
          {searchPlayingStyle && isCurrent && isPlaying ? (
            <PlayingBars />
          ) : isCurrent ? (
            isPlaying ? (
              <AudioLines size={20} className={accentColor} aria-label="Now playing" />
            ) : (
              <Play size={18} className={accentColor} fill="currentColor" aria-label="Now playing" />
            )
          ) : (
            <span className={`bc-type-body-lg tabular-nums ${secondaryColor}`}>{trackNumber}</span>
          )}
        </div>
      ) : (
        <div
          className={`relative mr-3.5 h-[52px] shrink-0 overflow-hidden rounded-(--bc-radius-art) bg-(--bc-page-elevated,var(--bc-surface-variant)) ${
            isVideo ? 'w-[92px]' : 'w-[52px]'
          }`}
        >
          <Artwork
            src={track.thumbnail ?? fallbackArtwork ?? null}
            displayWidth={isVideo ? 92 : 52}
            aspect={isVideo ? 16 / 9 : 1}
            radius="var(--bc-radius-art)"
          />
          {searchPlayingStyle && isCurrent && isPlaying && (
            <PlayingBars className="absolute inset-0 m-auto" />
          )}
        </div>
      )}

      <div
        className={`min-w-0 flex-1 flex-col flex ${
          unavailable === 'matching' ? 'animate-matching motion-reduce:animate-none' : ''
        }`}
      >
        <div className="flex min-w-0 items-center">
          <span className={`truncate bc-type-title-md ${titleColor}`}>{track.title}</span>
          {track.explicit && <ExplicitBadge />}
        </div>
        {(subtitle || effectiveArtists.length > 0) && (
          <div className={`mt-0.5 truncate bc-type-body ${secondaryColor}`}>
            {subtitle ?? <ArtistsLine artists={effectiveArtists} />}
          </div>
        )}
      </div>

      {isCurrent && trackNumber === null && !searchPlayingStyle && (
        <span className={`ml-2 shrink-0 ${accentColor}`} aria-label="Now playing">
          {isPlaying ? <AudioLines size={18} /> : <Play size={16} fill="currentColor" />}
        </span>
      )}

      {unavailable === 'matching' ? (
        <span
          className={`ml-2 size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${secondaryColor}`}
          aria-label="Matching"
        />
      ) : (
        (unavailable === 'missing' || track.durationSec !== null) && (
          <span className={`ml-2 shrink-0 bc-type-label tabular-nums ${secondaryColor}`}>
            {unavailable === 'missing' ? 'Not found' : formatDuration(track.durationSec)}
          </span>
        )
      )}

      {includeMenu && trailing && !unavailable && <span className="ml-1 shrink-0">{trailing}</span>}

      {includeMenu && !unavailable && (
        <TrackMenu
          track={resolvedTrack}
          className={`-mr-3.5 ml-0.5 grid size-9 shrink-0 place-items-center rounded-full ${secondaryColor} hover:bg-(--bc-hover-fill)`}
        />
      )}
    </>
  );

  return (
    <div ref={rowRef} className="relative overflow-hidden">
      {swipeX !== 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-between bg-[color-mix(in_srgb,var(--bc-primary)_18%,transparent)] px-(--bc-page-gutter) text-(--bc-primary)"
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5 bc-type-label">
            <ListPlus size={20} />
            <span>Queue</span>
          </span>
          <span className="inline-flex items-center gap-1.5 bc-type-label">
            <ListPlus size={20} />
            <span>Queue</span>
          </span>
        </div>
      )}
      <div
        role="button"
        tabIndex={unavailable ? -1 : 0}
        aria-disabled={unavailable ? true : undefined}
        data-current={isCurrent || undefined}
        data-unavailable={unavailable}
        title={
          unavailable === 'matching'
            ? 'Looking for this on YouTube Music…'
            : unavailable === 'missing'
              ? 'Not found on YouTube Music'
              : undefined
        }
        onClick={() => {
          if (swipeRef.current.suppressClick) return;
          handleRowClick();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick();
          }
        }}
        onContextMenu={(e) => {
          if (unavailable) return;
          e.preventDefault();
          cancelLongPress();
          openHeldMenu();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
        style={
          swipeX !== 0
            ? { transform: `translate3d(${swipeX + (armedNudge ? Math.sign(swipeX) * 2 : 0)}px, 0, 0)` }
            : undefined
        }
        className={[
          'group/row relative flex w-full items-center px-(--bc-page-gutter) py-1 text-start select-none',
          unavailable ? 'cursor-default' : 'cursor-pointer hover:bg-(--bc-hover-fill)',
          unavailable === 'missing' ? 'opacity-45' : '',
          showActiveRowTint ? 'bg-(--bc-active-row-fill)' : 'bg-transparent',
          swipeX === 0 ? 'transition-transform duration-200 ease-out' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {renderRowBody(true)}
      </div>

      {held && (
        <HeldContextMenu
          open={held.open}
          bounds={held.bounds}
          onDismiss={dismissHeldMenu}
          onExited={clearHeldMenu}
          label={`Actions for ${track.title}`}
          preview={
            <div className="flex size-full items-center px-(--bc-page-gutter) py-1 text-start select-none">
              {renderRowBody(false)}
            </div>
          }
          actions={<TrackMenuItems track={resolvedTrack} onClose={dismissHeldMenu} />}
        />
      )}
    </div>
  );
}

/**
 * 0.5px divider inset past the leading art (`84px`) or track number (`56px`)
 * (`Common.kt:127, :138`, `HistoryScreen.kt:81-85`).
 */
export function SongRowDivider({ numbered = false }: { numbered?: boolean }) {
  return (
    <div
      className="h-0 border-t-[0.5px] border-t-(--bc-page-divider,color-mix(in_srgb,var(--bc-outline)_50%,transparent))"
      style={{ marginLeft: numbered ? 56 : 'var(--bc-queue-divider-inset)' }}
      aria-hidden="true"
    />
  );
}
