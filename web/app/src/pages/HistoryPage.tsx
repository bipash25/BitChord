import { useCallback } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, LoadError, LoadMoreError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { useLibrary, useSignedIn, useYouTubeReady } from '@/data/music/queries';
import { useYtAuth } from '@/extension/useYtAuth';
import { HistorySkeleton } from '@/skeletons/PageSkeletons';

/**
 * Listening history (`HistoryScreen.kt:35-91`, spec §6.9):
 * a plain SongRow list with 0.5px dividers inset 84px, newest first. Tapping
 * a row plays it with the rest of the history queued behind it.
 */
export default function HistoryPage() {
  const { missing } = useYouTubeReady();
  const auth = useYtAuth();
  const signedIn = useSignedIn();
  const history = useLibrary('recent');

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = history;
  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (missing) {
    return (
      <>
        <PageHeader title="History" />
        <NeedsExtension what="your listening history" />
      </>
    );
  }
  if (auth.state === 'ready' && !signedIn) {
    return (
      <>
        <PageHeader title="History" />
        <EmptyState
          title="Sign in to see your history"
          detail="BitChord uses your YouTube Music account for your listening history. Sign in to view and replay it."
        />
      </>
    );
  }
  if (history.isError && !history.data) {
    return (
      <>
        <PageHeader title="History" />
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      </>
    );
  }
  if (!history.data) return <HistorySkeleton />;

  const tracks = history.data.pages.flatMap((page) => page.data.tracks);
  return (
    <>
      <PageHeader title="History" />
      {tracks.length === 0 ? (
        <EmptyState title="Nothing in your history yet" />
      ) : (
        <div className="pt-2">
          <TrackList
            tracks={tracks}
            variant="playlist"
            searchPlayingStyle
            source={{ title: 'History', type: 'library', id: 'recent' }}
            onNearEnd={onNearEnd}
          />
          {isFetchingNextPage && (
            <div className="flex justify-center py-5 bc-type-body text-(--bc-on-surface-variant)">
              Loading more history…
            </div>
          )}
          {history.isFetchNextPageError && <LoadMoreError onRetry={() => void fetchNextPage()} />}
        </div>
      )}
    </>
  );
}
