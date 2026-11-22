import { ChevronLeft, ChevronRight, Disc3, ListEnd, ListPlus, ListStart, MoreVertical, Star, User } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Menu,
  MenuHeader,
  MenuItem,
  MenuQuickAction,
  MenuQuickActions,
  MenuSeparator,
  type MenuPlacement,
} from '@/components/Menu';
import { albumHref, artistHref } from '@/components/music/links';
import {
  useAddToPlaylist,
  useLikeStatus,
  usePlaylistOptions,
  useSetLiked,
  useSignedIn,
} from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { showToast } from '@/state/toast';

function PlaylistChoices({ videoId, onDone, onBack }: { videoId: string; onDone: () => void; onBack: () => void }) {
  const options = usePlaylistOptions(videoId, true);
  const add = useAddToPlaylist();
  return (
    <>
      <MenuItem icon={<ChevronLeft size={18} />} onSelect={onBack}>
        Back
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>Add to Playlist</MenuHeader>
      {options.isPending && (
        <MenuItem disabled onSelect={() => {}}>
          Loading…
        </MenuItem>
      )}
      {options.isError && (
        <MenuItem disabled onSelect={() => {}}>
          Couldn’t load your playlists
        </MenuItem>
      )}
      {options.data?.length === 0 && (
        <MenuItem disabled onSelect={() => {}}>
          No playlists yet
        </MenuItem>
      )}
      {options.data?.map((option) => (
        <MenuItem
          key={option.playlistId}
          onSelect={() => {
            add.mutate(
              { playlistId: option.playlistId, videoId },
              { onSuccess: () => showToast(`Added to ${option.title}`) },
            );
            onDone();
          }}
        >
          {option.title}
        </MenuItem>
      ))}
    </>
  );
}

function FavoriteQuickAction({ track, onDone }: { track: Track; onDone: () => void }) {
  const status = useLikeStatus(track.videoId);
  const setLiked = useSetLiked();
  const liked = status.data === 'LIKE';
  return (
    <MenuQuickAction
      icon={<Star size={22} fill={liked ? 'currentColor' : 'none'} />}
      label={liked ? 'Favorited' : 'Favorite'}
      tint={liked ? 'var(--bc-accent-red)' : undefined}
      disabled={status.isPending}
      onSelect={() => {
        setLiked.mutate({ videoId: track.videoId, liked: !liked });
        showToast(liked ? 'Removed from favorites' : 'Added to favorites');
        onDone();
      }}
    />
  );
}

/**
 * Shared track menu body (`SongActionsMenu.kt`, spec §3.7): quick-action tiles
 * across the top (`Play Next`, `Add to Queue`, and `Favorite` when signed in),
 * followed by `Add to Playlist` and `Go to Album` / `Go to Artist` rows.
 */
export function TrackMenuItems({ track, onClose }: { track: Track; onClose: () => void }) {
  const [view, setView] = useState<'main' | 'playlists'>('main');
  const signedIn = useSignedIn();
  const navigate = useNavigate();

  if (view === 'playlists') {
    return <PlaylistChoices videoId={track.videoId} onDone={onClose} onBack={() => setView('main')} />;
  }

  const { playNext, addToQueue } = usePlayer.getState();
  const toAlbum = albumHref(track.album?.id ?? null);
  const firstArtist = track.artists.find((a) => Boolean(a.id));
  const toArtist = artistHref(firstArtist?.id ?? null);
  const hasSecondaryRows = signedIn || Boolean(toAlbum) || Boolean(toArtist);

  return (
    <>
      <MenuQuickActions>
        <MenuQuickAction
          icon={<ListStart size={22} />}
          label="Play Next"
          onSelect={() => {
            onClose();
            playNext([track]);
          }}
        />
        <MenuQuickAction
          icon={<ListEnd size={22} />}
          label="Queue"
          onSelect={() => {
            onClose();
            addToQueue([track]);
          }}
        />
        {signedIn && <FavoriteQuickAction track={track} onDone={onClose} />}
      </MenuQuickActions>

      {hasSecondaryRows && <MenuSeparator />}

      {signedIn && (
        <MenuItem
          icon={<ListPlus size={20} />}
          trailing={<ChevronRight size={16} />}
          onSelect={() => setView('playlists')}
        >
          Add to Playlist
        </MenuItem>
      )}
      {toAlbum && (
        <MenuItem
          icon={<Disc3 size={20} />}
          onSelect={() => {
            onClose();
            navigate(toAlbum);
          }}
        >
          Go to Album
        </MenuItem>
      )}
      {toArtist && (
        <MenuItem
          icon={<User size={20} />}
          onSelect={() => {
            onClose();
            navigate(toArtist);
          }}
        >
          Go to Artist
        </MenuItem>
      )}
    </>
  );
}

/**
 * The ⋮ button at the end of a track row (`SongActionsMenu.kt`, spec §3.7, §6.21):
 * Play Next and Add to Queue for everyone; Favorite and Add to Playlist signed in.
 */
export function TrackMenu({
  track,
  className,
  placement,
  onOpenChange,
  icon,
}: {
  track: Track;
  className?: string;
  /** Where the menu opens from the button; the player's sit at the bottom of the window. */
  placement?: MenuPlacement;
  /** Told when the menu opens and closes; most mounts don't need to know. */
  onOpenChange?: (open: boolean) => void;
  /** Optional custom icon; defaults to Android's vertical overflow dots (Common.kt:675). */
  icon?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  useEffect(() => {
    onOpenChange?.(anchor !== null);
  }, [anchor, onOpenChange]);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={`More options for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-open={anchor !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {icon ?? <MoreVertical size={20} strokeWidth={2} />}
      </button>
      {anchor && (
        <Menu anchor={anchor} placement={placement} onClose={close} label={track.title}>
          <TrackMenuItems track={track} onClose={close} />
        </Menu>
      )}
    </>
  );
}
