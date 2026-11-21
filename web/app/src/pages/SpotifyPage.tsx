import { PageHeader } from '@/components/PageHeader';
import { SquareLockup } from '@/components/music/Lockups';
import { EmptyState, LoadError, stateStyles } from '@/components/music/States';
import type { MusicItem } from '@/data/music/types';
import { openSpotifySignIn, useRefreshSpotifyAuth, useSpotifyAuth } from '@/data/spotify/auth';
import { useSpotifyPlaylists } from '@/data/spotify/queries';
import { PlainSkeleton } from '@/skeletons/PageSkeletons';
import { seeAllGrid } from './pageStyles';

/**
 * The signed-in Spotify account's playlists (SpotifyLibraryScreen): this page
 * is only the way in; a playlist opens as an ordinary playlist page whose
 * songs are matched to YouTube Music. Spotify is reached directly by the page
 * (PKCE, relay.md phase 2), so none of this waits on the relay — only the
 * matching inside a playlist does.
 */
export default function SpotifyPage() {
  const auth = useSpotifyAuth();
  const playlists = useSpotifyPlaylists();
  const retry = useRefreshSpotifyAuth();

  if (auth.state === 'checking') return <PlainSkeleton />;
  if (auth.state === 'unconfigured') {
    return (
      <>
        <PageHeader title="Spotify" />
        <EmptyState title="Spotify isn’t configured on this deployment" />
      </>
    );
  }
  const state = auth.auth;
  if (!state.signedIn) {
    // A refused or half-finished handshake says so; otherwise this is the invitation.
    const detail = state.problem ?? 'Sign in to see your Spotify playlists, each matched to its YouTube Music song.';
    return (
      <>
        <PageHeader title="Spotify" />
        <div className={stateStyles.state}>
          <p className={stateStyles.title}>Sign in to Spotify</p>
          <p className={stateStyles.detail}>{detail}</p>
          <button className={stateStyles.button} disabled={retry.isPending} onClick={() => (state.problem ? retry.mutate() : openSpotifySignIn())}>
            {state.problem ? 'Try Again' : 'Sign In'}
          </button>
        </div>
      </>
    );
  }
  if (playlists.isError && !playlists.data) return <LoadError error={playlists.error} onRetry={() => void playlists.refetch()} />;
  if (!playlists.data) return <PlainSkeleton />;

  const items: MusicItem[] = playlists.data.map((p) => ({
    kind: 'spotify-playlist',
    id: p.id,
    title: p.name,
    subtitle: p.owner ?? 'Spotify',
    artists: [],
    album: null,
    thumbnail: p.imageUrl,
    wide: false,
    durationSec: null,
    explicit: false,
  }));
  return (
    <>
      <PageHeader title="Spotify" />
      {!items.length && <EmptyState title="No playlists yet" />}
      <ul className={seeAllGrid}>
        {items.map((item) => (
          <li key={item.id}>
            <SquareLockup item={item} />
          </li>
        ))}
      </ul>
    </>
  );
}
