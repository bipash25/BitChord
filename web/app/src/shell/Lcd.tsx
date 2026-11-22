import { Maximize2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { MARQUEE_ARTIST_STAGGER_MS, Marquee } from '@/components/Marquee';
import { LogoMark } from '@/components/icons/LogoMark';
import { ExplicitBadge } from '@/components/music/ExplicitBadge';
import { VideoSurface } from '@/components/music/VideoSurface';
import { albumHref, artistHref } from '@/components/music/links';
import { PrefetchLink } from '@/components/PrefetchLink';
import { artistCredits, creditSegments } from '@/lib/artistCredits';
import { sizedArtwork } from '@/lib/artwork';
import type { Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { useHasVideo } from '@/state/video';
import { albumPageFor, artistPageFor } from './nowPlayingLinks';
import { MixWindowHighlight } from './NerdStats';
import { usePlayerSheet } from './PlayerSheetMotion';
import { useScrubber } from './useScrubber';

// The title and each artist: plain until hovered, then underlined on their own.
export const pageLink = 'cursor-pointer text-start hover:underline focus-visible:underline aria-busy:cursor-progress';

/**
 * A name in the LCD that opens a page: a plain link when the page is known,
 * else a button that works out where it goes (nowPlayingLinks.ts) and then goes.
 */
interface PageLinkProps {
  href: string | null;
  resolve: () => Promise<string>;
  className: string;
  children: ReactNode;
}

export function PageLink({ href, resolve, className, children }: PageLinkProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (href) {
    return (
      <PrefetchLink to={href} className={className}>
        {children}
      </PrefetchLink>
    );
  }
  return (
    <button
      className={className}
      aria-busy={busy || undefined}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void resolve()
          .then((to) => navigate(to))
          .finally(() => setBusy(false));
      }}
    >
      {children}
    </button>
  );
}

/**
 * The artists, each its own link, as the phone draws its credit line: the
 * byline as written, with every credited name in it opening that artist's page.
 */
export function Credits({
  videoId,
  line,
  artists,
  className = pageLink,
}: {
  videoId: string;
  line: string;
  artists: Track['artists'];
  className?: string;
}) {
  const segments = creditSegments(line, artistCredits(line, artists));
  return segments.map((segment, i) =>
    segment.credit ? (
      <PageLink
        key={i}
        className={className}
        href={artistHref(segment.credit.id)}
        resolve={() => artistPageFor(videoId, segment.credit!)}
      >
        {segment.text}
      </PageLink>
    ) : (
      segment.text
    ),
  );
}

const titleClass = 'font-(family-name:--bc-font-family) text-[13px] leading-[1.2] font-bold tracking-(--bc-tracking-accessory-title) text-(--bc-on-surface)';

export function Lcd() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const openFullScreen = useUi((s) => s.setFullScreen);
  const sheet = usePlayerSheet();
  const track = usePlayer((s) => {
    const entry = s.queue[s.index]?.track;
    return entry && entry.videoId === s.nowPlaying?.videoId ? entry : null;
  });
  const video = useHasVideo(nowPlaying?.videoId);
  const [titleOverflows, setTitleOverflows] = useState(false);

  if (!nowPlaying) {
    return (
      <div className="grid h-full place-items-center text-(--bc-on-surface-variant)">
        <LogoMark size={26} />
      </div>
    );
  }

  const { videoId, title, artist } = nowPlaying;
  const album = track?.album ?? null;
  return (
    <div
      className={`group/lcd relative grid h-full items-center gap-x-2 pb-1.5 ${video ? 'grid-cols-[60px_minmax(0,1fr)]' : 'grid-cols-[36px_minmax(0,1fr)]'}`}
    >
      <button
        className={`group/art relative block h-9 overflow-hidden rounded-(--bc-radius-art) bg-(--bc-surface-variant) p-0 transition-[filter,opacity] ${video ? 'w-[60px] bg-black' : 'w-9'}`}
        aria-label="Open full screen player"
        onClick={() => (sheet ? sheet.open() : openFullScreen(true))}
      >
        {nowPlaying.artworkUrl && (
          <img
            key={nowPlaying.artworkUrl}
            src={sizedArtwork(nowPlaying.artworkUrl, 34)}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            className="size-full object-cover opacity-0 transition-opacity duration-200 ease-in data-loaded:opacity-100"
            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
          />
        )}
        <VideoSurface
          className={`absolute inset-0 transition-opacity duration-300 ${video ? 'opacity-100' : 'opacity-0'}`}
        />
        {/* Hovering anywhere on the player pill dims the artwork and shows the expand glyph. */}
        <span
          className="absolute inset-0 grid place-items-center bg-[rgb(0_0_0/0.5)] text-white opacity-0 transition-opacity duration-200 group-hover/pill:opacity-100 group-focus-visible/art:opacity-100"
          aria-hidden="true"
        >
          <Maximize2 size={14} strokeWidth={2.25} />
        </span>
      </button>
      {/* Over the seek line, the names soften into the background so the times can sit over them. */}
      <div className="flex min-w-0 flex-col transition-[filter,opacity] group-has-[[data-scrubber]:hover]/lcd:opacity-30 group-has-[[data-scrubber]:hover]/lcd:blur-[3px] group-has-[[data-dragging]]/lcd:opacity-30 group-has-[[data-dragging]]/lcd:blur-[3px]">
        {title ? (
          // The song's name opens its album; an explicit song carries the E after it.
          <div className="flex min-w-0 items-center">
            <Marquee measureKey={title} onOverflowChange={setTitleOverflows} className={titleClass}>
              <PageLink
                className={pageLink}
                href={albumHref(album?.id ?? null)}
                resolve={() => albumPageFor(videoId, album, [title, artist].filter(Boolean).join(' '))}
              >
                {title}
              </PageLink>
            </Marquee>
            {track?.explicit && <ExplicitBadge size={11} />}
          </div>
        ) : (
          <span className={`truncate ${titleClass}`}>{status === 'loading' ? 'Loading…' : ''}</span>
        )}
        {status === 'error' ? (
          <span className="truncate font-(family-name:--bc-font-family) text-[12px] leading-[1.2] tracking-(--bc-tracking-accessory-artist) text-(--bc-accent-red)">
            {error}
          </span>
        ) : (
          <Marquee
            measureKey={artist}
            startDelayMs={titleOverflows ? MARQUEE_ARTIST_STAGGER_MS : 0}
            className="font-(family-name:--bc-font-family) text-[12px] leading-[1.2] tracking-(--bc-tracking-accessory-artist) text-(--bc-on-surface-variant)"
          >
            {artist ? <Credits videoId={videoId} line={artist} artists={track?.artists ?? []} /> : status === 'loading' ? 'Loading…' : ''}
          </Marquee>
        )}
      </div>
      <Progress />
    </div>
  );
}

const time =
  'pointer-events-none absolute bottom-[11px] bc-type-label-sm tabular-nums text-(--bc-on-surface) opacity-0 transition-opacity group-hover/scrub:opacity-100 group-data-dragging/scrub:opacity-100';

function Progress() {
  const { bar, elapsed, remaining, dragging, handlers } = useScrubber();
  return (
    <div
      className="group/scrub absolute inset-x-0 bottom-0 h-3.5 cursor-pointer touch-none"
      data-scrubber
      data-dragging={dragging || undefined}
      {...handlers}
    >
      <span ref={elapsed} className={`${time} left-0`} />
      <span ref={remaining} className={`${time} right-0`} />
      <div
        className="absolute inset-x-0 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-(--bc-outline) transition-[height,left,right] duration-100 ease-in group-hover/scrub:bottom-[5px] group-hover/scrub:h-1 group-data-dragging/scrub:bottom-[5px] group-data-dragging/scrub:h-1"
        aria-hidden="true"
      >
        <MixWindowHighlight />
        <div ref={bar} className="relative size-full origin-left scale-x-(--progress) bg-(--bc-on-surface-variant) [--progress:0]" />
      </div>
    </div>
  );
}
