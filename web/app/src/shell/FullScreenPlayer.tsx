import { ChevronDown, Maximize, Minimize } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type React from 'react';
import { useLocation } from 'react-router';
import {
  BackwardIcon,
  ForwardIcon,
  LyricsIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  UpNextIcon,
} from '@/components/icons/Transport';
import { ExplicitBadge } from '@/components/music/ExplicitBadge';
import { MARQUEE_ARTIST_STAGGER_MS, Marquee } from '@/components/Marquee';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { MotionArtwork } from '@/components/music/MotionArtwork';
import { TrackMenu } from '@/components/music/TrackMenu';
import { VideoSurface } from '@/components/music/VideoSurface';
import { albumHref } from '@/components/music/links';
import { useTrackMotion } from '@/data/apple/motionArt';
import { sizedArtwork } from '@/lib/artwork';
import {
  FADE_CURVE_STOPS,
  HERO_FADE_FRACTION,
  SUBVIEW_STATUS_SCRIM_MIN_ALPHA,
  heroBlurDissolveMask,
  heroDissolveMask,
  sampleTopBandLuminance,
  topBandScrimAlpha,
  topScrimGradient,
  verticalEdgeFadeMask,
} from '@/lib/fadeCurve';
import { useReducedMotion } from '@/lib/motionPrefs';
import type { Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { useHasVideo, useVideo } from '@/state/video';
import { Credits, PageLink } from './Lcd';
import { LyricsPanel } from './LyricsPanel';
import { MeshBackdrop } from './MeshBackdrop';
import { TOUCH_SLOP, computeVelocityY, type PointerSample } from './MiniPlayerGestures';
import { NerdStats } from './NerdStats';
import { DISMISS_STRIP_HEIGHT, usePlayerSheet } from './PlayerSheetMotion';
import { ThinSlider } from './ThinSlider';
import { UpNext } from './UpNext';
import { VideoQuality } from './VideoQuality';
import { VolumeControl, fadeForVolume } from './VolumeControl';
import { albumPageFor } from './nowPlayingLinks';

const LANDSCAPE_PLAYER_MIN_WIDTH = 560;
const TABLET_PLAYER_MIN_WIDTH = 700;
const IDLE_MS = 3000;

const ARTWORK_POSE_EASING = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
const ARTWORK_PAUSE_SCALE = 0.88;
const ARTWORK_DRAG_SCALE = 0.94;

const linkClass = 'cursor-pointer text-start hover:underline focus-visible:underline aria-busy:cursor-progress';

function useBrowserFullScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    },
    () => document.fullscreenElement !== null,
  );
}

function readViewport() {
  if (typeof window === 'undefined') return { w: 390, h: 844 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function usePlayerViewport() {
  const [size, setSize] = useState(readViewport);
  useEffect(() => {
    const onResize = () => setSize(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const landscape = size.w > size.h && size.w >= LANDSCAPE_PLAYER_MIN_WIDTH;
  const tablet = size.w >= TABLET_PLAYER_MIN_WIDTH;
  const shortLandscape = landscape && size.h < 540;
  return { ...size, landscape, tablet, shortLandscape };
}

const transportButton =
  'grid place-items-center rounded-full text-white transition-[opacity,scale,background-color] duration-150 enabled:hover:bg-white/10 enabled:active:scale-90 disabled:opacity-30';

/**
 * Android-ported transport (`PlayerControls.kt:839-846`):
 * 53px skip buttons squashed vertically (`scaleY(0.85)`), large central play/pause,
 * and flanking shuffle / repeat toggles.
 */
function Transport({ compact = false }: { compact?: boolean }) {
  const hasTrack = usePlayer((s) => s.nowPlaying !== null);
  const playing = usePlayer((s) => s.status === 'playing' || s.status === 'buffering');
  const hasNext = usePlayer((s) => s.index + 1 < s.queue.length || s.repeat !== 'off' || (s.autoplay && s.index >= 0));
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat } = usePlayer.getState();

  return (
    <div
      className={`mx-auto flex w-full max-w-[340px] items-center justify-between ${
        compact ? 'mt-1 h-[54px]' : 'mt-[clamp(6px,1.4vh,14px)] h-[64px]'
      }`}
    >
      <button
        type="button"
        className={`${transportButton} size-9 ${shuffle ? 'text-white' : 'text-white/45'}`}
        aria-label="Shuffle"
        aria-pressed={shuffle}
        onClick={toggleShuffle}
      >
        <ShuffleIcon size={24} />
      </button>

      <button
        type="button"
        className={`${transportButton} size-(--bc-skip-icon)`}
        disabled={!hasTrack}
        aria-label="Previous"
        onClick={previous}
      >
        <BackwardIcon size={53} style={{ transform: 'scaleX(-1) scaleY(0.85)' }} />
      </button>

      <button
        type="button"
        className={`${transportButton} ${compact ? 'size-14' : 'size-16'}`}
        disabled={!hasTrack}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={togglePlay}
      >
        {playing ? <PauseIcon size={compact ? 46 : 54} /> : <PlayIcon size={compact ? 46 : 54} />}
      </button>

      <button
        type="button"
        className={`${transportButton} size-(--bc-skip-icon)`}
        disabled={!hasTrack || !hasNext}
        aria-label="Next"
        onClick={next}
      >
        <ForwardIcon size={53} style={{ transform: 'scaleY(0.85)' }} />
      </button>

      <button
        type="button"
        className={`${transportButton} size-9 ${repeat !== 'off' ? 'text-white' : 'text-white/45'}`}
        aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat'}
        aria-pressed={repeat !== 'off'}
        onClick={cycleRepeat}
      >
        {repeat === 'one' ? <RepeatOneIcon size={24} /> : <RepeatIcon size={24} />}
      </button>
    </div>
  );
}

/**
 * Bottom action button (`PlayerControls.kt:848-860, :1271-1329`):
 * 44px touch slot, 26px glyph, and when active a 35px rounded-[7px] white@62%
 * tile with the glyph punched out via SVG mask (`SrcOut`) so the backdrop shines through.
 */
function BottomActionTile({
  label,
  active,
  onClick,
  kind,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  kind: 'lyrics' | 'queue';
}) {
  const maskId = useId();
  const Icon = kind === 'lyrics' ? LyricsIcon : UpNextIcon;

  return (
    <button
      type="button"
      className="relative grid size-(--bc-bottom-action) place-items-center rounded-[10px] text-white/75 transition-[transform,color] duration-200 hover:text-white active:scale-92"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <span
        className={`absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-out ${
          active ? 'scale-100 opacity-100' : 'scale-85 opacity-0'
        }`}
        aria-hidden="true"
      >
        <svg width={35} height={35} viewBox="0 0 35 35">
          <defs>
            <mask id={maskId}>
              <rect width={35} height={35} rx={7} fill="#ffffff" />
              <Icon x={4.5} y={4.5} size={26} color="#000000" />
            </mask>
          </defs>
          <rect width={35} height={35} rx={7} fill="rgba(255, 255, 255, 0.62)" mask={`url(#${maskId})`} />
        </svg>
      </span>
      <span
        className={`grid place-items-center transition-[opacity,transform] duration-200 ease-out ${
          active ? 'scale-90 opacity-0' : 'scale-100 opacity-100'
        }`}
        aria-hidden="true"
      >
        <Icon size={26} />
      </span>
    </button>
  );
}

const chromeDiscButton =
  'grid size-[34px] flex-none place-items-center rounded-full bg-white/18 text-white transition-[background-color,transform] duration-150 hover:bg-white/28 active:scale-92';

/**
 * Android-ported Now Playing sheet (`NowPlayingScreen.kt`, spec §2.5, §4.1, §4.2):
 * - Fixed sheet driven by `PlayerSheetMotion` (`PLAYER_SHEET_SPRING` 195/ζ1) + FLIP artwork flight.
 * - Portrait layout with 30px `--bc-player-gutter`, max-width 560px, bottom-seam-anchored 6×6 mesh,
 *   54px collapsed header for Lyrics/Queue, `ThinSlider`, 53px `scaleY(0.85)` skips, and 44px/35px bottom tiles.
 * - Landscape / desktop layout with two columns and 500ms ease-out artwork poses (1 / .88 / .94).
 */
export function FullScreenPlayer() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const track = usePlayer((s) => {
    const entry = s.queue[s.index]?.track;
    return entry && entry.videoId === s.nowPlaying?.videoId ? entry : null;
  });
  const motion = useTrackMotion(nowPlaying?.title, nowPlaying?.artist, track?.album?.name);
  const { pathname } = useLocation();
  const openedAt = useRef(pathname);
  const playing = usePlayer((s) => s.status === 'playing' || s.status === 'buffering');
  const setFullScreen = useUi((s) => s.setFullScreen);
  const sheet = usePlayerSheet();
  const reducedMotion = useReducedMotion();
  const video = useHasVideo(nowPlaying?.videoId);
  const viewport = usePlayerViewport();

  const [panel, setPanel] = useState<'lyrics' | 'queue' | null>(() =>
    nowPlaying && useVideo.getState().videoId === nowPlaying.videoId
      ? null
      : viewport.landscape && !viewport.shortLandscape
        ? 'lyrics'
        : null,
  );
  const picked = useRef(false);
  const [idle, setIdle] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [seamY, setSeamY] = useState(0);
  const [heroBottomPx, setHeroBottomPx] = useState(0);
  const [topLuminance, setTopLuminance] = useState<number | null>(null);
  const [titleOverflows, setTitleOverflows] = useState(false);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const openArtRef = useRef<HTMLDivElement>(null);
  const enteredBrowserFullScreen = useRef(false);
  const browserFullScreen = useBrowserFullScreen();

  const showLyrics = panel === 'lyrics';
  const showQueue = panel === 'queue';
  const column = showLyrics || showQueue;
  const theater = video && !column;

  const togglePanel = (p: 'lyrics' | 'queue') => {
    picked.current = true;
    setPanel((on) => (on === p ? null : p));
  };

  useEffect(() => {
    if (video && !picked.current) setPanel(null);
  }, [video]);

  // Sample top 10% artwork luminance for the top status-bar gradient scrim (ArtworkPalette.kt:288-324).
  useEffect(() => {
    const url = nowPlaying?.artworkUrl;
    if (!url) {
      setTopLuminance(null);
      return;
    }
    let live = true;
    void sampleTopBandLuminance(url).then((lum) => {
      if (live) setTopLuminance(lum);
    });
    return () => {
      live = false;
    };
  }, [nowPlaying?.artworkUrl]);

  const handleClose = useCallback(() => {
    if (sheet) sheet.close();
    else setFullScreen(false);
  }, [sheet, setFullScreen]);

  // Register sheet & open-artwork container with PlayerSheetController.
  useLayoutEffect(() => {
    if (!sheet) return;
    sheet.registerSheet(sheetRef.current, contentRef.current);
    return () => sheet.registerSheet(null, null);
  }, [sheet]);

  const fullBleedHeroEligible =
    !viewport.landscape &&
    viewport.w <= 620 &&
    !theater &&
    !video &&
    Boolean(nowPlaying?.artworkUrl);
  const fullBleedHero = fullBleedHeroEligible && !column;
  const portraitMainArt = !viewport.landscape && !column && !theater;
  const desktopArtVisible = viewport.landscape && !theater;

  useLayoutEffect(() => {
    if (!sheet) return;
    const target = portraitMainArt || desktopArtVisible ? openArtRef.current : null;
    sheet.registerOpenArt(target, fullBleedHero ? 0 : 12);
    return () => sheet.registerOpenArt(null, 12);
  }, [sheet, portraitMainArt, desktopArtVisible, fullBleedHero, nowPlaying?.artworkUrl]);

  // Measure the portrait artwork / hero bottom edge for the 6×6 mesh seam anchor.
  useLayoutEffect(() => {
    const el = fullBleedHero ? heroSlotRef.current : portraitMainArt ? openArtRef.current : null;
    if (!el) {
      setSeamY(0);
      setHeroBottomPx(0);
      return;
    }
    const updateSeam = () => {
      const container = contentRef.current;
      const rect = el.getBoundingClientRect();
      const topAnchor = container ? container.getBoundingClientRect().top : sheet?.getSnapshot().offset ?? 0;
      const rawBottom = rect.bottom - topAnchor;
      const bottom = fullBleedHero ? Math.max(0, Math.round(rawBottom + 10)) : Math.max(0, Math.round(rawBottom));
      if (fullBleedHero) setHeroBottomPx(bottom);
      setSeamY(bottom);
    };
    updateSeam();
    const ro = new ResizeObserver(updateSeam);
    ro.observe(el);
    window.addEventListener('resize', updateSeam);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSeam);
    };
  }, [fullBleedHero, portraitMainArt, sheet, viewport.w, viewport.h]);

  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (enteredBrowserFullScreen.current && document.fullscreenElement) void document.exitFullscreen();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (pathname !== openedAt.current) {
      if (sheet) sheet.dismissImmediately();
      else setFullScreen(false);
    }
  }, [pathname, setFullScreen, sheet]);

  useEffect(() => {
    if (!nowPlaying) {
      if (sheet) sheet.dismissImmediately();
      else setFullScreen(false);
    }
  }, [nowPlaying, setFullScreen, sheet]);

  // Drag-down-to-dismiss on the 32px top strip and non-interactive upper player region.
  const dismissDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastY: number;
    locked: boolean;
    samples: PointerSample[];
  } | null>(null);

  const onSheetPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    wake();
    if (!sheet || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, [role="slider"], [data-no-sheet-drag]')) return;
    dismissDrag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      locked: false,
      samples: [{ y: e.clientY, t: e.timeStamp || performance.now() }],
    };
  };

  const onSheetPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    wake();
    const d = dismissDrag.current;
    if (!d || d.pointerId !== e.pointerId || !sheet) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const t = e.timeStamp || performance.now();

    if (!d.locked) {
      if (Math.hypot(dx, dy) < TOUCH_SLOP) return;
      if (dy > 0 && dy > Math.abs(dx)) {
        d.locked = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic events.
        }
        sheet.drag(dy);
        d.lastY = e.clientY;
        d.samples.push({ y: e.clientY, t });
      } else {
        dismissDrag.current = null;
      }
      return;
    }

    const deltaY = e.clientY - d.lastY;
    d.lastY = e.clientY;
    d.samples.push({ y: e.clientY, t });
    if (d.samples.length > 12) d.samples.shift();
    sheet.drag(deltaY);
  };

  const finishSheetDrag = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = dismissDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dismissDrag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore.
    }
    if (d.locked && sheet) {
      sheet.release(cancelled ? 0 : computeVelocityY(d.samples));
    }
  };

  const toggleBrowserFullScreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().then(
        () => (enteredBrowserFullScreen.current = true),
        () => undefined,
      );
    }
  };

  if (!nowPlaying) return null;
  const { videoId, title, artist } = nowPlaying;
  const album = track?.album ?? null;
  const effectiveTrack: Track = track ?? {
    videoId,
    title,
    artists: artist ? [{ name: artist, id: null }] : [],
    album: null,
    durationSec: nowPlaying.durationSec || null,
    explicit: false,
    thumbnail: nowPlaying.artworkUrl,
    index: null,
    plays: null,
  };

  const hidden = theater && playing && idle ? ' pointer-events-none opacity-0' : '';
  const artworkPoseScale = !playing ? ARTWORK_PAUSE_SCALE : scrubbing ? ARTWORK_DRAG_SCALE : 1;
  const backdropMode = column || viewport.tablet || theater ? 'fullBlur' : 'mesh';

  const baseTopAlpha = topBandScrimAlpha(topLuminance);
  const topGradientAlpha = column ? Math.max(baseTopAlpha, SUBVIEW_STATUS_SCRIM_MIN_ALPHA) : baseTopAlpha;
  const topScrimBg = topScrimGradient(topGradientAlpha);
  const heroMask = heroDissolveMask(HERO_FADE_FRACTION, FADE_CURVE_STOPS);
  const heroBlurMask = heroBlurDissolveMask(HERO_FADE_FRACTION, FADE_CURVE_STOPS);
  const queueMask = verticalEdgeFadeMask('28px', '28px', 8);

  const initialOffset = sheet?.getSnapshot().offset ?? 0;

  const renderArtworkBox = (className: string) => (
    <div
      ref={openArtRef}
      className={`relative overflow-hidden rounded-(--bc-radius-sleeve) bg-[#1c1c1e] shadow-(--bc-shadow-sleeve) ${className}`}
      style={{
        transform: `scale(${artworkPoseScale})`,
        transition: reducedMotion ? 'none' : `transform 500ms ${ARTWORK_POSE_EASING}`,
      }}
    >
      {nowPlaying.artworkUrl && (
        <img
          key={nowPlaying.artworkUrl}
          className="size-full animate-[fade-in_320ms_ease] object-cover"
          src={sizedArtwork(nowPlaying.artworkUrl, 600)}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
        />
      )}
      {motion && (
        <MotionArtwork
          key={motion.url}
          motion={motion}
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-600 ease-in data-ready:opacity-100"
          playing={playing}
        />
      )}
      {video && !theater && <VideoSurface className="absolute inset-0" />}
    </div>
  );

  const renderMetadata = (compact = false) => (
    <div className="flex items-center gap-3">
      <div
        key={`${videoId}-${title}-${compact ? 'c' : 'f'}`}
        className="flex min-w-0 flex-1 animate-[fade-in_300ms_ease] flex-col gap-0.5"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Marquee
            measureKey={`${title}-${compact ? 'c' : 'f'}`}
            onOverflowChange={setTitleOverflows}
            className={`font-(family-name:--bc-font-family) font-bold text-white ${
              compact ? 'text-[17px] leading-[1.25]' : 'text-[22px] leading-[1.2] tracking-(--bc-tracking-headline)'
            }`}
          >
            <PageLink
              className={linkClass}
              href={albumHref(album?.id ?? null)}
              resolve={() => albumPageFor(videoId, album, [title, artist].filter(Boolean).join(' '))}
            >
              {title}
            </PageLink>
          </Marquee>
          {track?.explicit && <ExplicitBadge size={14} />}
        </div>
        <Marquee
          measureKey={`${artist}-${album?.name ?? ''}-${compact ? 'c' : 'f'}`}
          startDelayMs={titleOverflows ? MARQUEE_ARTIST_STAGGER_MS : 0}
          className={`font-(family-name:--bc-font-family) text-white/72 ${
            compact ? 'text-[14px] leading-[1.3]' : 'text-[16px] leading-[1.35] tracking-(--bc-tracking-body-lg)'
          }`}
        >
          {artist && <Credits videoId={videoId} line={artist} artists={track?.artists ?? []} className={linkClass} />}
          {artist && album?.name && ' — '}
          {album?.name && (
            <PageLink
              className={linkClass}
              href={albumHref(album.id ?? null)}
              resolve={() => albumPageFor(videoId, album, [title, artist].filter(Boolean).join(' '))}
            >
              {album.name}
            </PageLink>
          )}
        </Marquee>
        {!compact && <NerdStats />}
      </div>
      <FavoriteButton videoId={nowPlaying.videoId} className={chromeDiscButton} size={18} />
      <TrackMenu track={effectiveTrack} inPlayer className={chromeDiscButton} placement="above-end" />
    </div>
  );

  const renderBottomRow = (includeVolume = false) => (
    <div className="relative flex w-full items-center justify-center gap-10">
      <BottomActionTile label="Lyrics" active={showLyrics} onClick={() => togglePanel('lyrics')} kind="lyrics" />
      <BottomActionTile label="Up Next" active={showQueue} onClick={() => togglePanel('queue')} kind="queue" />
      {includeVolume && (
        <div
          className="group/actions relative flex items-center [--volume-gap:36px]"
          data-volume-open={volumeOpen || undefined}
          onPointerLeave={() => setVolumeOpen(false)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setVolumeOpen(false);
          }}
        >
          <span className={fadeForVolume} aria-hidden="true" />
          <VolumeControl
            open={volumeOpen}
            onOpen={() => setVolumeOpen(true)}
            className="grid size-(--bc-bottom-action) place-items-center rounded-[10px] text-white/75 hover:text-white"
            iconSize={22}
          />
        </div>
      )}
    </div>
  );

  const renderQueueContainer = (wrapperClassName: string) => (
    <div className={`relative ${wrapperClassName}`}>
      <div
        className="flex size-full min-h-0 flex-1 flex-col overflow-hidden"
        style={{ maskImage: queueMask, WebkitMaskImage: queueMask }}
      >
        <UpNext />
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-7 backdrop-blur-[14px] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.6)_45%,transparent_100%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-9 backdrop-blur-[14px] [mask-image:linear-gradient(to_top,#000_0%,rgba(0,0,0,0.6)_45%,transparent_100%)]"
        aria-hidden="true"
      />
    </div>
  );

  return (
    <div
      ref={sheetRef}
      className="fixed inset-0 z-[calc(var(--z-contextual-menus)-2)] isolate overflow-hidden text-white will-change-transform"
      style={{
        transform: `translate3d(0, ${initialOffset}px, 0)`,
        cursor: theater && playing && idle ? 'none' : undefined,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      data-full-screen
      data-paused={!playing || undefined}
      onPointerDown={onSheetPointerDown}
      onPointerMove={onSheetPointerMove}
      onPointerUp={(e) => finishSheetDrag(e, false)}
      onPointerCancel={(e) => finishSheetDrag(e, true)}
      onKeyDown={wake}
    >
      <div ref={contentRef} className="relative flex size-full flex-col bg-[#121212]">
        <MeshBackdrop artworkUrl={nowPlaying.artworkUrl} seamY={seamY} mode={backdropMode} />

        {/* Full-bleed phone hero artwork with 16-stop smootherstep dissolve + gradient blur into 6x6 mesh (NowPlayingScreen.kt:3006-3311). */}
        {fullBleedHeroEligible && nowPlaying.artworkUrl && (
          <div
            ref={fullBleedHero ? openArtRef : undefined}
            className="pointer-events-none absolute inset-x-0 top-0 z-0 overflow-hidden"
            style={{
              height: heroBottomPx > 0 ? `${heroBottomPx}px` : '56dvh',
              maskImage: heroMask,
              WebkitMaskImage: heroMask,
              opacity: fullBleedHero ? 1 : 0,
              transform: fullBleedHero ? 'scale(1)' : 'scale(0.92)',
              transformOrigin: 'top center',
              transition: reducedMotion
                ? 'none'
                : 'opacity 420ms cubic-bezier(0.2, 0, 0, 1), transform 420ms cubic-bezier(0.2, 0, 0, 1)',
            }}
            aria-hidden="true"
          >
            <img
              key={nowPlaying.artworkUrl}
              className="size-full animate-[fade-in_320ms_ease] object-cover"
              src={sizedArtwork(nowPlaying.artworkUrl, 900)}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
            />
            {motion && (
              <MotionArtwork
                key={motion.url}
                motion={motion}
                className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-600 ease-in data-ready:opacity-100"
                playing={playing}
              />
            )}
            {/* Gradient-blur dissolve over bottom 42% so the cover melts into the mesh with no seam. */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                maskImage: heroBlurMask,
                WebkitMaskImage: heroBlurMask,
              }}
            >
              <img
                src={sizedArtwork(nowPlaying.artworkUrl, 240)}
                alt=""
                referrerPolicy="no-referrer"
                decoding="async"
                className="size-full scale-108 object-cover blur-[22px] saturate-115"
              />
              <div className="absolute inset-0 backdrop-blur-[18px]" />
            </div>
          </div>
        )}

        {theater && (
          <div className="absolute inset-0 bg-black">
            <VideoSurface fit="contain" className="size-full" />
          </div>
        )}

        {/* Top status/dismiss scrim + progressive blur for scrolled subviews (NowPlayingScreen.kt:2522-2547). */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-1"
          style={{
            height: 'calc(env(safe-area-inset-top, 0px) + 56px)',
            background: topScrimBg,
          }}
          aria-hidden="true"
        />
        {column && (
          <div
            className="bc-top-fade pointer-events-none absolute inset-x-0 top-0 z-1"
            style={{ height: 'calc(env(safe-area-inset-top, 0px) + 48px)' }}
            aria-hidden="true"
          />
        )}

        {/* 32px top dismiss strip (`DISMISS_STRIP_HEIGHT`, NowPlayingScreen.kt:271). */}
        <div
          className={`relative z-2 flex flex-none touch-none items-center justify-between px-4 pt-[env(safe-area-inset-top,0px)] transition-opacity duration-300${hidden}`}
          style={{ minHeight: `${DISMISS_STRIP_HEIGHT}px` }}
        >
          <button
            ref={closeRef}
            type="button"
            className="grid size-9 place-items-center rounded-full text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-colors hover:bg-white/12 hover:text-white"
            aria-label="Close"
            onClick={handleClose}
          >
            <ChevronDown size={22} />
          </button>

          {/* Grab pill indicator (NowPlayingScreen.kt:2715-2721): 38x5px white@70% with shadow. */}
          <div
            className="pointer-events-none h-[5px] w-[38px] rounded-[3px] bg-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
            aria-hidden="true"
          />

          <div className="flex items-center gap-2">
            {video && <VideoQuality />}
            {document.fullscreenEnabled && (
              <button
                type="button"
                className="grid size-9 place-items-center rounded-full text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-colors hover:bg-white/12 hover:text-white"
                aria-label={browserFullScreen ? 'Exit full screen' : 'Enter full screen'}
                onClick={toggleBrowserFullScreen}
              >
                {browserFullScreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            )}
          </div>
        </div>

        {/* Main responsive player body */}
        {theater ? (
          <div
            className={`absolute inset-x-0 bottom-0 z-1 flex justify-center bg-[linear-gradient(to_top,rgb(0_0_0/0.78),rgb(0_0_0/0.4)_58%,transparent)] px-(--bc-player-gutter) pt-28 pb-[max(env(safe-area-inset-bottom,0px),20px)] transition-opacity duration-300${hidden}`}
          >
            <div className="flex w-full max-w-[680px] flex-col gap-3">
              {renderMetadata()}
              <ThinSlider onScrubDragChange={setScrubbing} />
              <Transport />
              {renderBottomRow(viewport.landscape)}
            </div>
          </div>
        ) : viewport.landscape ? (
          <div className="relative z-1 mx-auto grid min-h-0 w-full max-w-[1120px] flex-1 grid-cols-[minmax(260px,420px)_minmax(300px,1fr)] items-center gap-x-[clamp(32px,6vw,96px)] px-(--bc-player-gutter) pb-6">
            <section className="flex min-h-0 flex-col items-center justify-center gap-5" aria-label="Player">
              {renderArtworkBox(
                `w-full ${video ? 'aspect-video bg-black' : 'aspect-square'} max-w-[min(38vw,calc(100dvh-220px),420px)]`,
              )}
              {(!column || viewport.shortLandscape) && renderBottomRow(true)}
            </section>

            <section className="flex h-full min-h-0 flex-col justify-center" aria-label={showLyrics ? 'Lyrics' : showQueue ? 'Up Next' : 'Controls'}>
              {showLyrics ? (
                <div key="landscape-lyrics" className="flex h-[min(78dvh,640px)] min-h-0 animate-enter flex-col" data-no-sheet-drag>
                  <LyricsPanel variant="full" />
                  {!viewport.shortLandscape && (
                    <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
                      <ThinSlider onScrubDragChange={setScrubbing} />
                      <Transport compact />
                      {renderBottomRow(true)}
                    </div>
                  )}
                </div>
              ) : showQueue ? (
                <div key="landscape-queue" className="flex h-[min(78dvh,640px)] min-h-0 animate-enter flex-col" data-no-sheet-drag>
                  {renderQueueContainer('min-h-0 flex-1')}
                  {!viewport.shortLandscape && (
                    <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
                      <ThinSlider onScrubDragChange={setScrubbing} />
                      <Transport compact />
                      {renderBottomRow(true)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex w-full max-w-[440px] flex-col gap-3 justify-self-center">
                  {renderMetadata()}
                  <ThinSlider onScrubDragChange={setScrubbing} />
                  <Transport />
                </div>
              )}
            </section>
          </div>
        ) : (
          /* Portrait layout: 30px `--bc-player-gutter`, max 560px (`NowPlayingScreen.kt:402-409`). */
          <div className="relative z-1 mx-auto flex min-h-0 w-full max-w-(--bc-player-max) flex-1 flex-col px-(--bc-player-gutter) pb-[max(env(safe-area-inset-bottom,0px),16px)]">
            {column ? (
              <>
                {/* Collapsed 60px header with 54px thumbnail (`NowPlayingScreen.kt:235-236`). */}
                <div className="flex h-(--bc-player-header) flex-none touch-none items-center gap-3 animate-enter">
                  <button
                    type="button"
                    aria-label="Return to cover"
                    className="size-(--bc-player-thumb) flex-none overflow-hidden rounded-(--bc-radius-art) bg-[#1c1c1e] shadow-(--bc-shadow-sleeve) transition-transform active:scale-95"
                    onClick={() => setPanel(null)}
                  >
                    {nowPlaying.artworkUrl && (
                      <img
                        className="size-full object-cover"
                        src={sizedArtwork(nowPlaying.artworkUrl, 108)}
                        alt=""
                        referrerPolicy="no-referrer"
                        decoding="async"
                      />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">{renderMetadata(true)}</div>
                </div>

                <div key={`portrait-${panel}`} className="mt-2 flex min-h-0 flex-1 animate-enter flex-col" data-no-sheet-drag>
                  {showLyrics ? (
                    <LyricsPanel variant="full" />
                  ) : (
                    renderQueueContainer('flex min-h-0 flex-1 flex-col')
                  )}
                </div>

                <div className="mt-2 flex flex-none flex-col gap-1">
                  <ThinSlider onScrubDragChange={setScrubbing} />
                  <Transport compact />
                  <div className="mt-1">{renderBottomRow(false)}</div>
                </div>
              </>
            ) : (
              <div key="portrait-main" className="flex min-h-0 flex-1 animate-enter flex-col">
                <div ref={heroSlotRef} className="flex min-h-0 flex-1 touch-none items-center justify-center py-2">
                  {!fullBleedHero &&
                    renderArtworkBox(
                      `w-full ${video ? 'aspect-video bg-black' : 'aspect-square'} max-w-[min(calc(100vw-2*var(--bc-player-gutter)),calc(100dvh-390px),500px)]`,
                    )}
                </div>

                <div className="mt-(--bc-player-art-title-gap) flex flex-none flex-col">
                  {renderMetadata()}
                  <div className="mt-2">
                    <ThinSlider onScrubDragChange={setScrubbing} />
                  </div>
                  <Transport />
                  <div className="mt-2">{renderBottomRow(false)}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
