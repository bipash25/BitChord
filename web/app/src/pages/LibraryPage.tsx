import { ChevronRight, Clock, Disc3, ListMusic, Mic2, Music2, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Navigate, useParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { PrefetchLink } from '@/components/PrefetchLink';
import { CircleLockup, SquareLockup, VideoLockup } from '@/components/music/Lockups';
import { EmptyState, LoadError, LoadMoreError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { isLibrarySection, LIBRARY_SECTIONS } from '@/data/music/library';
import { useLibrary, useSignedIn, useYouTubeReady } from '@/data/music/queries';
import { useSpotifySignedIn } from '@/data/spotify/auth';
import { useYtAuth } from '@/extension/useYtAuth';
import { PlainSkeleton } from '@/skeletons/PageSkeletons';
import { seeAllGrid, seeAllTracks } from './pageStyles';

function useLoadMore(onVisible: (() => void) | null) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = target.current;
    if (!node || !onVisible) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), {
      rootMargin: '600px 0px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);
  return target;
}

const LIBRARY_LINKS = [
  { to: '/history', label: 'History', Icon: Clock },
  { to: '/library/artists', label: 'Artists', Icon: Mic2 },
  { to: '/library/albums', label: 'Albums', Icon: Disc3 },
  { to: '/library/songs', label: 'Songs', Icon: Music2 },
  { to: '/library/made-for-you', label: 'Made for You', Icon: Sparkles },
] as const;

/**
 * Android `LibraryLinkList` (`LibraryScreen.kt:241-290`): plain folder rows
 * (icon, label, chevron, 0.5px hairlines inset 52px) inside a 14px surfaceVariant group.
 */
function LibraryLinks({ showSpotify }: { showSpotify: boolean }) {
  const links = showSpotify
    ? [...LIBRARY_LINKS, { to: '/spotify', label: 'Spotify Playlists', Icon: ListMusic }]
    : LIBRARY_LINKS;
  return (
    <nav aria-label="Library sections" className="mx-(--bc-page-gutter) mt-3 mb-5 overflow-hidden rounded-(--bc-radius-group) bg-(--bc-surface-variant)">
      {links.map(({ to, label, Icon }, i) => (
        <div key={to}>
          {i > 0 && <div className="ml-[52px] border-t-[0.5px] border-t-(--bc-outline)" aria-hidden="true" />}
          <PrefetchLink
            to={to}
            className="flex min-h-[50px] items-center gap-3.5 px-4 py-2.5 text-(--bc-on-surface) hover:bg-(--bc-hover-fill)"
          >
            <Icon size={20} className="shrink-0 text-(--bc-on-surface-variant)" />
            <span className="min-w-0 flex-1 truncate bc-type-title-md">{label}</span>
            <ChevronRight size={18} className="shrink-0 text-(--bc-on-surface-variant)/70" />
          </PrefetchLink>
        </div>
      ))}
    </nav>
  );
}

/** A library section (`LibraryScreen.kt`, spec §6.8): History, Artists, Albums, Songs, Made for You, All Playlists. */
export default function LibraryPage() {
  const section = useParams().section ?? '';
  const { missing } = useYouTubeReady();
  const auth = useYtAuth();
  const signedIn = useSignedIn();
  const spotifySignedIn = useSpotifySignedIn();
  const library = useLibrary(isLibrarySection(section) ? section : 'playlists');
  const loadMore = useLoadMore(
    library.hasNextPage && !library.isFetchingNextPage && !library.isFetchNextPageError
      ? () => void library.fetchNextPage()
      : null,
  );

  if (!isLibrarySection(section)) return <Navigate to="/home" replace />;
  const title = section === 'playlists' ? 'Library' : LIBRARY_SECTIONS[section].title;
  const showLinks = section === 'playlists';

  if (missing) return <NeedsExtension what="your library" />;
  if (auth.state === 'ready' && !signedIn) {
    return (
      <>
        <PageHeader title={title} />
        {showLinks && <LibraryLinks showSpotify={spotifySignedIn} />}
        <EmptyState
          title="Sign in to see your library"
          detail="BitChord uses the YouTube Music account this browser is signed in to. Sign in on music.youtube.com, then come back."
        />
      </>
    );
  }
  if (library.isError && !library.data) return <LoadError error={library.error} onRetry={() => void library.refetch()} />;
  if (!library.data) return <PlainSkeleton />;

  const grid = library.data.pages.flatMap((page) => page.data.grid);
  const tracks = library.data.pages.flatMap((page) => page.data.tracks);
  return (
    <>
      <PageHeader title={title} />
      {showLinks && <LibraryLinks showSpotify={spotifySignedIn} />}
      {!grid.length && !tracks.length && <EmptyState title="Nothing here yet" />}
      {grid.length > 0 && (
        <ul className={seeAllGrid} data-wide={grid.every((i) => i.wide) || undefined}>
          {grid.map((item, i) => (
            <li key={`${item.id}-${i}`}>
              {item.kind === 'artist' ? (
                <CircleLockup item={item} />
              ) : item.wide ? (
                <VideoLockup item={item} />
              ) : (
                <SquareLockup item={item} />
              )}
            </li>
          ))}
        </ul>
      )}
      {tracks.length > 0 && (
        <div className={seeAllTracks}>
          <TrackList
            tracks={tracks}
            variant="playlist"
            source={{ title, type: 'library', id: section }}
            onNearEnd={
              library.hasNextPage && !library.isFetchingNextPage && !library.isFetchNextPageError
                ? () => void library.fetchNextPage()
                : undefined
            }
          />
        </div>
      )}
      {grid.length > 0 && <div ref={loadMore} aria-hidden="true" />}
      {library.isFetchNextPageError && <LoadMoreError onRetry={() => void library.fetchNextPage()} />}
    </>
  );
}
