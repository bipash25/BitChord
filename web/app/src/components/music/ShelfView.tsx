import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { shelfHeader, shelfKinds, shelfList, shelfSection, type ShelfKind } from '@/components/shelf';
import type { MusicItem, Shelf, Track } from '@/data/music/types';
import type { QueueSource } from '@/playback/queue/timeline';
import { browseHref } from './links';
import { CircleLockup, SquareLockup, TrackLockup, VideoLockup } from './Lockups';
import { playList } from './play';

// Desktop hover arrows (≥1000px): frosted pills using --bc-frost.
const arrow =
  'bc-frost absolute top-1/2 z-3 hidden h-13 w-7 -translate-y-1/2 place-items-center rounded-full text-(--bc-glass-content) opacity-0 shadow-(--bc-shadow-glass) transition-opacity duration-200 ease-linear hover:opacity-100 disabled:pointer-events-none lg:grid lg:enabled:group-hover/shelf:opacity-100';

function renderItem(shelf: Shelf, item: MusicItem): ReactNode {
  switch (shelf.layout) {
    case 'tracks':
      return <TrackLockup item={item} />;
    case 'video':
      return <VideoLockup item={item} />;
    case 'circle':
      return <CircleLockup item={item} />;
    default:
      return <SquareLockup item={item} />;
  }
}

export function ShelfScroller({ kind, children }: { kind: ShelfKind; children: ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const gutter = Number.parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
    el.scrollBy({ left: direction * (el.clientWidth - gutter * 2), behavior: 'smooth' });
  };

  return (
    <div className="group/shelf relative">
      <button
        className={`${arrow} left-1.5`}
        aria-label="Previous Page"
        disabled={edges.start}
        onClick={() => page(-1)}
      >
        <ChevronLeft size={20} strokeWidth={2.4} />
      </button>
      <ul ref={list} className={`${shelfList} ${shelfKinds[kind]}`} onScroll={measure}>
        {children}
      </ul>
      <button
        className={`${arrow} right-1.5`}
        aria-label="Next Page"
        disabled={edges.end}
        onClick={() => page(1)}
      >
        <ChevronRight size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** Section heading (`DetailScreen.kt:2000-2034`, `HomeScreen.kt:515-553`): 22px Semibold + optional Show All. */
function ShelfTitle({ title, to }: { title: string; to?: string | null }) {
  return (
    <div className={shelfHeader}>
      <h2 className="min-w-0 truncate bc-type-headline text-(--bc-page-on,var(--bc-on-surface))">{title}</h2>
      {to && (
        <PrefetchLink
          to={to}
          className="shrink-0 py-1 pl-3 bc-type-body font-semibold text-(--bc-page-accent,var(--bc-primary)) hover:underline"
        >
          Show all
        </PrefetchLink>
      )}
    </div>
  );
}

export const trackItem = (track: Track): MusicItem => ({
  kind: 'song',
  id: track.videoId,
  title: track.title,
  subtitle: track.album?.name ?? '',
  artists: track.artists,
  album: track.album,
  thumbnail: track.thumbnail,
  wide: false,
  durationSec: track.durationSec,
  explicit: track.explicit,
});

export function TrackShelf({
  title,
  to,
  tracks,
  source,
}: {
  title: string;
  to?: string | null;
  tracks: Track[];
  source: QueueSource;
}) {
  return (
    <section className={shelfSection} aria-label={title}>
      <ShelfTitle title={title} to={to} />
      <ShelfScroller key={tracks.length} kind="tracks">
        {tracks.map((track, i) => (
          <li key={`${track.videoId}-${i}`}>
            <TrackLockup item={trackItem(track)} onPlay={() => playList(tracks, i, { source })} />
          </li>
        ))}
      </ShelfScroller>
    </section>
  );
}

export function ShelfView({ shelf }: { shelf: Shelf }) {
  return (
    <section className={shelfSection} aria-label={shelf.title}>
      <ShelfTitle title={shelf.title} to={shelf.seeAll ? browseHref(shelf.seeAll) : null} />
      <ShelfScroller key={shelf.items.length} kind={shelf.layout}>
        {shelf.items.map((item, i) => (
          <li key={`${item.id}-${i}`}>{renderItem(shelf, item)}</li>
        ))}
      </ShelfScroller>
    </section>
  );
}

export function Shelves({ shelves }: { shelves: Shelf[] }) {
  return (
    <>
      {shelves.map((shelf, i) => (
        <ShelfView key={`${shelf.title}-${i}`} shelf={shelf} />
      ))}
    </>
  );
}
