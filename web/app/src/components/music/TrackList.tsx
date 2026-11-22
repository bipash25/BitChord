import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import type { ArtistRef, Track } from '@/data/music/types';
import { playList, playTrack, type ListContext } from './play';
import { SongRow, SongRowDivider } from './SongRow';

type Variant = 'album' | 'playlist';

/** 52px artwork/number slot + 4px top + 4px bottom padding (Common.kt:523, :531). */
const ROW_HEIGHT = 60;
/** Below this, plain rows: an album or a short playlist gains nothing from virtualizing. */
const VIRTUALIZE_FROM = 80;

interface TrackListProps {
  tracks: Track[];
  variant: Variant;
  /** Album artwork, for rows that have none of their own (album tracks). */
  fallbackArtwork?: string | null;
  /** The album's artists, credited when a track has none of its own. */
  fallbackArtists?: ArtistRef[];
  /** Called when the list nears its end, to load the next page of a long playlist. */
  onNearEnd?: () => void;
  /** Where the list comes from: playing a row queues the list from there. Without it, a row plays alone. */
  source?: ListContext['source'];
  /** Use searchPlayingStyle (animated bars over artwork/slot) instead of row tint. */
  searchPlayingStyle?: boolean;
}

/**
 * Album, playlist and history track lists built on Android's `SongRow`
 * (`Common.kt:269-649`, spec §6.9), preserving virtualization for long lists.
 */
export function TrackList({
  tracks,
  variant,
  fallbackArtwork,
  fallbackArtists,
  onNearEnd,
  source,
  searchPlayingStyle = true,
}: TrackListProps) {
  const playRow = (i: number) => {
    // Rows from another catalogue that found no YouTube Music song stay out of the queue.
    if (source) {
      const playable = tracks.filter((t) => !t.unavailable);
      return playList(playable, Math.max(0, playable.indexOf(tracks[i]!)), { source, fallbackArtwork, fallbackArtists });
    }
    const track = tracks[i]!;
    playTrack(track.artists.length || !fallbackArtists ? track : { ...track, artists: fallbackArtists }, fallbackArtwork);
  };

  const container = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useEffect(() => setScrollElement(document.getElementById('scrollable-page')), []);
  const virtual = tracks.length >= VIRTUALIZE_FROM;

  const virtualizer = useVirtualizer({
    count: virtual ? tracks.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: container.current?.offsetTop ?? 0,
  });

  const items = virtual ? virtualizer.getVirtualItems() : [];
  const last = items[items.length - 1];
  useEffect(() => {
    if (!onNearEnd) return;
    if (virtual ? last && last.index >= tracks.length - 20 : true) onNearEnd();
  }, [last?.index, tracks.length, virtual, onNearEnd]);

  const numbered = variant === 'album';

  return (
    <div data-variant={variant} role="list" aria-label="Songs">
      <div ref={container}>
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const track = tracks[item.index]!;
              return (
                <div
                  key={item.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <SongRow
                    track={track}
                    trackNumber={numbered ? (track.index ?? item.index + 1) : null}
                    fallbackArtwork={fallbackArtwork}
                    fallbackArtists={fallbackArtists}
                    searchPlayingStyle={searchPlayingStyle}
                    onPlay={() => playRow(item.index)}
                  />
                  {item.index < tracks.length - 1 && <SongRowDivider numbered={numbered} />}
                </div>
              );
            })}
          </div>
        ) : (
          tracks.map((track, i) => (
            <div key={`${track.videoId}-${i}`}>
              <SongRow
                track={track}
                trackNumber={numbered ? (track.index ?? i + 1) : null}
                fallbackArtwork={fallbackArtwork}
                fallbackArtists={fallbackArtists}
                searchPlayingStyle={searchPlayingStyle}
                onPlay={() => playRow(i)}
              />
              {i < tracks.length - 1 && <SongRowDivider numbered={numbered} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
