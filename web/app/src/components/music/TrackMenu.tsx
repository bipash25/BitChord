import {
  Bug,
  ChevronLeft,
  ChevronRight,
  Disc3,
  ExternalLink,
  Info,
  ListEnd,
  ListPlus,
  ListStart,
  Moon,
  MoreVertical,
  Radio,
  Share2,
  Star,
  ThumbsDown,
  User,
} from 'lucide-react';
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
import { SongInfoDialog } from '@/components/music/SongInfoDialog';
import { albumHref, artistHref } from '@/components/music/links';
import { fetchTrackLinks } from '@/data/music/api';
import {
  useAddToPlaylist,
  useLikeStatus,
  usePlaylistOptions,
  useSetDisliked,
  useSetLiked,
  useSignedIn,
} from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { useTrackLog } from '@/playback/trackLog';
import { usePlayer } from '@/state/player';
import { SLEEP_TIMER_PRESETS, formatSleepCountdown, useSleepTimer } from '@/state/sleepTimer';
import { showToast } from '@/state/toast';

function youtubeMusicUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

async function shareOrCopyTrackLink(track: Track) {
  const url = youtubeMusicUrl(track.videoId);
  const artist = track.artists.map((a) => a.name).join(', ');
  const text = artist ? `${track.title} — ${artist}` : track.title;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: track.title, text, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  if (await copyText(url)) showToast('Link copied');
  else showToast('Could not copy link');
}

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

function useSleepTimerStatus(): string | undefined {
  const afterTrack = useSleepTimer((s) => s.afterTrack);
  const deadlineMs = useSleepTimer((s) => s.deadlineMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (afterTrack) return 'After song';
  if (deadlineMs !== null) {
    const remaining = Math.max(0, deadlineMs - now);
    if (remaining > 0) return formatSleepCountdown(remaining);
  }
  return undefined;
}

function SleepTimerPicker({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const chosen = useSleepTimer((s) => s.minutes);
  const afterTrack = useSleepTimer((s) => s.afterTrack);
  const status = useSleepTimerStatus();
  const { start, startAfterTrack, cancel } = useSleepTimer.getState();

  return (
    <>
      <MenuItem icon={<ChevronLeft size={18} />} onSelect={onBack}>
        Back
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>{status ? `Sleep Timer · ${status}` : 'Sleep Timer'}</MenuHeader>
      <MenuItem
        checked={afterTrack}
        onSelect={() => {
          startAfterTrack();
          onDone();
        }}
      >
        After this song
      </MenuItem>
      {SLEEP_TIMER_PRESETS.map((minutes) => (
        <MenuItem
          key={minutes}
          checked={chosen === minutes}
          onSelect={() => {
            start(minutes);
            onDone();
          }}
        >
          {minutes === 60 ? '1 hour' : `${minutes} minutes`}
        </MenuItem>
      ))}
      {(chosen !== null || afterTrack) && (
        <>
          <MenuSeparator />
          <MenuItem
            destructive
            onSelect={() => {
              cancel();
              onDone();
            }}
          >
            Turn off timer
          </MenuItem>
        </>
      )}
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

function DislikeQuickAction({ track, onDone }: { track: Track; onDone: () => void }) {
  const status = useLikeStatus(track.videoId);
  const setDisliked = useSetDisliked();
  const disliked = status.data === 'DISLIKE';
  return (
    <MenuQuickAction
      icon={<ThumbsDown size={21} fill={disliked ? 'currentColor' : 'none'} />}
      label={disliked ? 'Disliked' : 'Dislike'}
      tint={disliked ? 'var(--bc-accent-red)' : undefined}
      disabled={status.isPending}
      onSelect={() => {
        setDisliked.mutate({ videoId: track.videoId, disliked: !disliked });
        showToast(disliked ? 'Removed dislike' : 'Disliked song');
        onDone();
      }}
    />
  );
}

/**
 * Shared track menu body (`SongActionsMenu.kt:202-416`, spec §3.7):
 * - Quick-action tiles across the top (`Favorite`, `Dislike`, `Share` signed in;
 *   `Play Next`, `Queue`, `Share` when signed out).
 * - `Add to Playlist` (signed in), `Start Radio`, `Play Next` / `Add to Queue`,
 *   `Go to Album` / `Go to Artist`, `Song Info`, `Open in YouTube Music`.
 * - Player-only group (`inPlayer`): `Sleep Timer` sub-picker and `Copy Log`.
 */
export function TrackMenuItems({
  track,
  onClose,
  inPlayer = false,
  onOpenInfo,
}: {
  track: Track;
  onClose: () => void;
  inPlayer?: boolean;
  onOpenInfo?: () => void;
}) {
  const [view, setView] = useState<'main' | 'playlists' | 'sleep-timer'>('main');
  const [resolved, setResolved] = useState<Track | null>(null);
  const signedIn = useSignedIn();
  const navigate = useNavigate();
  const sleepStatus = useSleepTimerStatus();

  const needsLinks =
    inPlayer && (!track.album?.id || !track.artists.some((a) => Boolean(a.id)));

  useEffect(() => {
    if (!needsLinks) return;
    let live = true;
    void fetchTrackLinks(track.videoId)
      .then((found) => {
        if (live && found) setResolved(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needsLinks, track.videoId]);

  if (view === 'playlists') {
    return <PlaylistChoices videoId={track.videoId} onDone={onClose} onBack={() => setView('main')} />;
  }
  if (view === 'sleep-timer') {
    return <SleepTimerPicker onDone={onClose} onBack={() => setView('main')} />;
  }

  const effective = resolved
    ? {
        ...track,
        album: track.album?.id ? track.album : resolved.album ?? track.album,
        artists: track.artists.some((a) => Boolean(a.id)) ? track.artists : resolved.artists,
      }
    : track;

  const { playNext, addToQueue, startRadio } = usePlayer.getState();
  const toAlbum = albumHref(effective.album?.id ?? null);
  const firstArtist = effective.artists.find((a) => Boolean(a.id));
  const toArtist = artistHref(firstArtist?.id ?? null);

  const handleCopyLog = () => {
    const lines = useTrackLog.getState().lines.filter((line) => line.about === track.videoId);
    onClose();
    if (!lines.length) {
      showToast('No log entries for this track');
      return;
    }
    const body = lines
      .map((l) => `${(l.t / 1000).toFixed(2)}s [${l.level}] ${l.message}`)
      .join('\n');
    void copyText(body).then((ok) => showToast(ok ? 'Copied track log' : 'Could not copy log'));
  };

  return (
    <>
      <MenuQuickActions>
        {signedIn ? (
          <>
            <FavoriteQuickAction track={effective} onDone={onClose} />
            <DislikeQuickAction track={effective} onDone={onClose} />
          </>
        ) : (
          <>
            <MenuQuickAction
              icon={<ListStart size={22} />}
              label="Play Next"
              onSelect={() => {
                onClose();
                playNext([effective]);
              }}
            />
            <MenuQuickAction
              icon={<ListEnd size={22} />}
              label="Queue"
              onSelect={() => {
                onClose();
                addToQueue([effective]);
              }}
            />
          </>
        )}
        <MenuQuickAction
          icon={<Share2 size={21} />}
          label="Share"
          onSelect={() => {
            onClose();
            void shareOrCopyTrackLink(effective);
          }}
        />
      </MenuQuickActions>

      {signedIn && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<ListPlus size={20} />}
            trailing={<ChevronRight size={16} />}
            onSelect={() => setView('playlists')}
          >
            Add to Playlist
          </MenuItem>
        </>
      )}

      <MenuSeparator />
      <MenuItem
        icon={<Radio size={20} />}
        onSelect={() => {
          onClose();
          startRadio(effective);
        }}
      >
        Start Radio
      </MenuItem>
      {signedIn && (
        <>
          <MenuItem
            icon={<ListStart size={20} />}
            onSelect={() => {
              onClose();
              playNext([effective]);
            }}
          >
            Play Next
          </MenuItem>
          <MenuItem
            icon={<ListEnd size={20} />}
            onSelect={() => {
              onClose();
              addToQueue([effective]);
            }}
          >
            Add to Queue
          </MenuItem>
        </>
      )}

      <MenuSeparator />
      {toAlbum && (
        <MenuItem
          icon={<Disc3 size={20} />}
          description={effective.album?.name}
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
          description={firstArtist?.name}
          onSelect={() => {
            onClose();
            navigate(toArtist);
          }}
        >
          Go to Artist
        </MenuItem>
      )}
      {onOpenInfo && (
        <MenuItem
          icon={<Info size={20} />}
          onSelect={() => {
            onClose();
            onOpenInfo();
          }}
        >
          Song Info
        </MenuItem>
      )}
      <MenuItem
        icon={<ExternalLink size={20} />}
        onSelect={() => {
          onClose();
          window.open(youtubeMusicUrl(effective.videoId), '_blank', 'noopener,noreferrer');
        }}
      >
        Open in YouTube Music
      </MenuItem>

      {inPlayer && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Moon size={20} />}
            trailing={sleepStatus ?? <ChevronRight size={16} />}
            onSelect={() => setView('sleep-timer')}
          >
            Sleep Timer
          </MenuItem>
          <MenuItem icon={<Bug size={20} />} onSelect={handleCopyLog}>
            Copy Log
          </MenuItem>
        </>
      )}
    </>
  );
}

/**
 * The ⋮ button at the end of a track row or in the full-screen player
 * (`SongActionsMenu.kt`, spec §3.7, §6.21).
 */
export function TrackMenu({
  track,
  className,
  placement,
  inPlayer = false,
  onOpenChange,
  icon,
}: {
  track: Track;
  className?: string;
  /** Where the menu opens from the button; the player's sit at the bottom of the window. */
  placement?: MenuPlacement;
  /** True when mounted in the player so player-only options (Sleep Timer, Copy Log) appear. */
  inPlayer?: boolean;
  /** Told when the menu opens and closes; most mounts don't need to know. */
  onOpenChange?: (open: boolean) => void;
  /** Optional custom icon; defaults to Android's vertical overflow dots (Common.kt:675). */
  icon?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
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
          <TrackMenuItems
            track={track}
            inPlayer={inPlayer}
            onClose={close}
            onOpenInfo={() => setInfoOpen(true)}
          />
        </Menu>
      )}
      {infoOpen && <SongInfoDialog track={track} onClose={() => setInfoOpen(false)} />}
    </>
  );
}
