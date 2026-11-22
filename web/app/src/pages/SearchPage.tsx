import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PrefetchLink } from '@/components/PrefetchLink';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';
import { Artwork } from '@/components/music/Artwork';
import { CategoryTiles } from '@/components/music/CategoryTiles';
import { CircleLockup, SquareLockup, VideoLockup } from '@/components/music/Lockups';
import { PillSegmentedControl, type SegmentOption } from '@/components/music/PillSegmentedControl';
import { SearchField } from '@/components/music/SearchField';
import { Shelves } from '@/components/music/ShelfView';
import { EmptyState, LoadError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { TrackMenu } from '@/components/music/TrackMenu';
import { hrefFor } from '@/components/music/links';
import { playTrack, toTrack } from '@/components/music/play';
import { useCategories, useSearch, useYouTubeReady } from '@/data/music/queries';
import type { MusicItem, SearchResults, Shelf } from '@/data/music/types';
import { ShelfSkeleton } from '@/skeletons/ShelfSkeleton';
import { seeAllGrid } from './pageStyles';

type SearchScope = 'all' | 'songs' | 'albums' | 'artists' | 'playlists' | 'videos';

const SCOPE_OPTIONS: readonly SegmentOption<SearchScope>[] = [
  { value: 'all', label: 'All' },
  { value: 'songs', label: 'Songs' },
  { value: 'albums', label: 'Albums' },
  { value: 'artists', label: 'Artists' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'videos', label: 'Videos' },
];

const KIND_LABEL: Record<MusicItem['kind'], string> = {
  song: 'Song',
  video: 'Video',
  album: 'Album',
  playlist: 'Playlist',
  'spotify-playlist': 'Spotify Playlist',
  artist: 'Artist',
  episode: 'Episode',
  podcast: 'Podcast',
  unknown: '',
};

function shelvesFor(results: SearchResults): Shelf[] {
  const shelf = (title: string, items: MusicItem[], layout: Shelf['layout']): Shelf | null =>
    items.length ? { title, strapline: null, layout, items, seeAll: null } : null;
  return [
    shelf('Artists', results.artists, 'circle'),
    shelf('Albums', results.albums, 'square'),
    shelf('Playlists', results.playlists, 'square'),
    shelf('Videos', results.videos, 'video'),
  ].filter((s): s is Shelf => Boolean(s));
}

const sectionTitle = 'mx-(--bc-page-gutter) mt-5 mb-2 bc-type-headline text-(--bc-on-surface)';
const topGrid =
  'mx-(--bc-page-gutter) mt-2 mb-4 grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-[607px]:grid-cols-1';
const topCard = 'group/top relative rounded-(--bc-radius-group) bg-(--bc-surface-variant) hover:bg-(--bc-hover-fill)';
const topLink =
  'grid min-h-[84px] w-full grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3.5 px-3 py-2.5 text-left';
const topMenu =
  'absolute right-2 top-1/2 -translate-y-1/2 z-3 grid size-9 place-items-center rounded-full text-(--bc-on-surface-variant) hover:bg-(--bc-hover-fill)';

function TopResult({ item }: { item: MusicItem }) {
  const href = hrefFor(item);
  const playable = item.kind === 'song' || item.kind === 'video';
  const body = (
    <>
      <div className="w-16">
        <Artwork
          src={item.thumbnail}
          displayWidth={64}
          radius={item.kind === 'artist' ? '50%' : 'var(--bc-radius-art)'}
        />
      </div>
      <div className={playable ? 'flex min-w-0 flex-col gap-0.5 pr-9' : 'flex min-w-0 flex-col gap-0.5'}>
        <span className="line-clamp-2 bc-type-title-md text-(--bc-on-surface)">{item.title}</span>
        <span className="truncate bc-type-body text-(--bc-on-surface-variant)">
          {[KIND_LABEL[item.kind], item.kind === 'artist' ? null : item.artists.map((a) => a.name).join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
    </>
  );

  return (
    <div className={topCard}>
      {href ? (
        <PrefetchLink to={href} className={topLink}>
          {body}
        </PrefetchLink>
      ) : (
        <button type="button" className={topLink} onClick={() => playTrack(item)}>
          {body}
        </button>
      )}
      {playable && <TrackMenu track={toTrack(item)} className={topMenu} />}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true">
      <div className={sectionTitle}>
        <SkeletonLine lineHeight={26} fontSize={20} width={130} />
      </div>
      <div className={topGrid} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${topCard} ${topLink}`}>
            <SkeletonBlock width={64} height={64} radius="var(--bc-radius-art)" />
            <div className="flex flex-col gap-1">
              <SkeletonLine lineHeight={20} fontSize={15} width="70%" />
              <SkeletonLine lineHeight={17} fontSize={13} width="45%" />
            </div>
          </div>
        ))}
      </div>
      <ShelfSkeleton kind="tracks" />
      <ShelfSkeleton kind="square" />
    </div>
  );
}

function Results({ query, scope }: { query: string; scope: SearchScope }) {
  const search = useSearch(query);
  if (search.isError) return <LoadError error={search.error} onRetry={() => void search.refetch()} />;
  if (!search.data) return <ResultsSkeleton />;

  const results = search.data;
  const songTracks = results.songs.map((item) => toTrack(item));
  const shelves = shelvesFor(results);

  if (!results.top.length && !songTracks.length && !shelves.length) {
    return <EmptyState title="No Results" detail={`Try a new search for something other than “${query}”.`} />;
  }

  if (scope === 'songs') {
    return songTracks.length > 0 ? (
      <div className="pt-2">
        <TrackList
          tracks={songTracks}
          variant="playlist"
          searchPlayingStyle
          source={{ title: `Search: ${query}`, type: 'other', id: `search:${query}` }}
        />
      </div>
    ) : (
      <EmptyState title="No Songs" detail={`No songs matched “${query}”.`} />
    );
  }

  if (scope === 'albums' || scope === 'artists' || scope === 'playlists' || scope === 'videos') {
    const items = results[scope];
    if (!items.length) {
      return <EmptyState title={`No ${scope}`} detail={`Nothing matched “${query}”.`} />;
    }
    return (
      <ul className={seeAllGrid} data-wide={scope === 'videos' || undefined}>
        {items.map((item, i) => (
          <li key={`${item.id}-${i}`}>
            {scope === 'artists' ? (
              <CircleLockup item={item} />
            ) : scope === 'videos' ? (
              <VideoLockup item={item} />
            ) : (
              <SquareLockup item={item} />
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {results.top.length > 0 && (
        <section aria-label="Top Results">
          <h2 className={sectionTitle}>Top Results</h2>
          <div className={topGrid}>
            {results.top.map((item) => (
              <TopResult key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {songTracks.length > 0 && (
        <section aria-label="Songs">
          <h2 className={sectionTitle}>Songs</h2>
          <TrackList
            tracks={songTracks}
            variant="playlist"
            searchPlayingStyle
            source={{ title: `Search: ${query}`, type: 'other', id: `search:${query}` }}
          />
        </section>
      )}
      <Shelves shelves={shelves} />
    </>
  );
}

function Landing() {
  const categories = useCategories();
  if (categories.isError) return <LoadError error={categories.error} onRetry={() => void categories.refetch()} />;
  if (!categories.data) {
    return (
      <div
        className="mx-(--bc-page-gutter) mt-4 mb-8 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
        aria-busy="true"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <SkeletonBlock key={i} aspectRatio="1.72" radius="var(--bc-radius-mood-card)" />
        ))}
      </div>
    );
  }
  return <CategoryTiles groups={categories.data.map((g) => ({ ...g, title: g.title || 'Browse Categories' }))} />;
}

/**
 * Search (`SearchScreen.kt`, spec §6.4): Android `PillTextField`,
 * `PillSegmentedControl` scope filter, SongRow results, and mood/genre tiles.
 */
export default function SearchPage() {
  const { missing } = useYouTubeReady();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [scope, setScope] = useState<SearchScope>('all');

  return (
    <>
      <div className="bc-top-bar-blur sticky top-0 z-[calc(var(--z-default)+5)] flex flex-col items-center gap-2 border-b-[0.5px] border-b-(--bc-glass-edge) px-(--bc-page-gutter) pt-3 pb-2">
        <SearchField
          initial={query}
          onSearch={(q) => {
            setScope('all');
            setParams(q ? { q } : {});
          }}
        />
        {!missing && query && (
          <div className="w-full max-w-[640px]">
            <PillSegmentedControl
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
              label="Search filter"
            />
          </div>
        )}
      </div>
      {missing ? <NeedsExtension /> : query ? <Results query={query} scope={scope} /> : <Landing />}
    </>
  );
}
