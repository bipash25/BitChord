import { PrefetchLink } from '@/components/PrefetchLink';
import { PlayIcon } from '@/components/icons/Transport';
import type { MusicItem } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { artistHref, hrefFor } from './links';
import { playTrack, toTrack } from './play';
import { PlayingBars } from './PlayingBars';
import { TrackMenu } from './TrackMenu';

const isPlayable = (item: MusicItem) => item.kind === 'song' || item.kind === 'video';

const lockup = 'flex min-w-0 flex-col';
const caption = 'mt-2.5 flex min-w-0 flex-col gap-0.5';
const title = 'flex min-w-0 items-center bc-type-title-md text-(--bc-page-on,var(--bc-on-surface)) [&>:first-child]:truncate';
const subtitle = 'truncate bc-type-body text-(--bc-page-on-variant,var(--bc-on-surface-variant))';
const overlayLink = 'absolute inset-0 z-1 rounded-[inherit]';

function Byline({ item }: { item: MusicItem }) {
  const linked = item.artists.some((a) => a.id);
  if (!linked || item.kind === 'album' || item.kind === 'playlist') return <>{item.subtitle}</>;
  return (
    <>
      {item.artists.map((artist, i) => {
        const href = artistHref(artist.id);
        return (
          <span key={`${artist.name}-${i}`}>
            {i > 0 && ', '}
            {href ? (
              <PrefetchLink to={href} className="hover:underline">
                {artist.name}
              </PrefetchLink>
            ) : (
              artist.name
            )}
          </span>
        );
      })}
    </>
  );
}

function PlayPlatter({ item }: { item: MusicItem }) {
  return (
    <button
      className="pointer-events-auto absolute bottom-2.5 left-2.5 bc-frost grid size-8 place-items-center rounded-full text-(--bc-glass-content) shadow-(--bc-shadow-glass) transition-transform hover:scale-105"
      aria-label={`Play ${item.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        playTrack(item);
      }}
    >
      <PlayIcon size={16} />
    </button>
  );
}

function LockupArtwork({ item, width, aspect }: { item: MusicItem; width: number; aspect: number }) {
  const href = hrefFor(item);
  const playingHere = usePlayer(
    (s) =>
      Boolean(item.id) &&
      s.nowPlaying?.videoId === item.id &&
      (s.status === 'playing' || s.status === 'buffering'),
  );
  return (
    <div className="group/art relative rounded-(--bc-radius-sleeve)">
      <Artwork src={item.thumbnail} displayWidth={width} aspect={aspect} radius="var(--bc-radius-sleeve)" />
      {href ? (
        <PrefetchLink to={href} className={overlayLink} aria-label={item.title} />
      ) : (
        <button className={overlayLink} aria-label={`Play ${item.title}`} onClick={() => playTrack(item)} />
      )}
      {playingHere && <PlayingBars className="absolute inset-0 z-2 m-auto" />}
      <div className="pointer-events-none absolute inset-0 z-2 rounded-[inherit] bg-black/25 opacity-0 transition-opacity duration-150 group-focus-visible/art:opacity-100 group-hover/art:opacity-100">
        {isPlayable(item) && <PlayPlatter item={item} />}
      </div>
      {isPlayable(item) && (
        <TrackMenu
          track={toTrack(item)}
          className="bc-frost absolute top-2 right-2 z-3 grid size-7 place-items-center rounded-full text-(--bc-glass-content) opacity-0 transition-opacity duration-150 group-hover/art:opacity-100 focus-visible:opacity-100 data-open:opacity-100"
        />
      )}
    </div>
  );
}

/** Android ShelfCard (`HomeScreen.kt:931-1025`, `Common.kt:163`): 150px square card with 12px corner. */
export function SquareLockup({ item, width = 150 }: { item: MusicItem; width?: number }) {
  const href = hrefFor(item);
  return (
    <div className={lockup}>
      <LockupArtwork item={item} width={width} aspect={1} />
      <div className={caption}>
        <div className={title}>
          {href ? (
            <PrefetchLink to={href} className="hover:underline">
              {item.title}
            </PrefetchLink>
          ) : (
            <span>{item.title}</span>
          )}
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className={subtitle}>
          <Byline item={item} />
        </div>
      </div>
    </div>
  );
}

/** Android VideoShelfCard (`HomeScreen.kt:779-836`): 248px 16:9 card with 12px corner. */
export function VideoLockup({ item, width = 248 }: { item: MusicItem; width?: number }) {
  return (
    <div className={lockup}>
      <LockupArtwork item={item} width={width} aspect={16 / 9} />
      <div className={caption}>
        <div className={title}>
          <span>{item.title}</span>
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className={subtitle}>{item.subtitle}</div>
      </div>
    </div>
  );
}

/** Circular artist lockup. */
export function CircleLockup({ item, width = 132 }: { item: MusicItem; width?: number }) {
  return (
    <PrefetchLink to={hrefFor(item) ?? '#'} className="group/circle flex min-w-0 flex-col items-center gap-2.5">
      <Artwork src={item.thumbnail} displayWidth={width} radius="50%" />
      <span className="max-w-full truncate text-center bc-type-title-md text-(--bc-page-on,var(--bc-on-surface)) group-hover/circle:underline">
        {item.title}
      </span>
    </PrefetchLink>
  );
}

/**
 * Android's `CompactTrackRow` (`HomeScreen.kt:401-454`, `DetailScreen.kt:2041-2090`):
 * 48px art (7px corner), 12px gap, 16px Medium title, 14px subtitle, and always-accessible `⋮`.
 */
export function TrackLockup({ item, onPlay }: { item: MusicItem; onPlay?: () => void }) {
  const play = onPlay ?? (() => playTrack(item));
  const isCurrent = usePlayer((s) => s.nowPlaying?.videoId === item.id);
  const isPlaying = usePlayer(
    (s) => s.nowPlaying?.videoId === item.id && (s.status === 'playing' || s.status === 'buffering'),
  );
  const isVideo = item.kind === 'video';
  return (
    <div className="group/track flex items-center gap-3 py-1">
      <button
        type="button"
        className={`relative h-12 shrink-0 overflow-hidden rounded-[7px] ${isVideo ? 'w-[85px]' : 'w-12'}`}
        aria-label={`Play ${item.title}`}
        onClick={play}
      >
        <Artwork src={item.thumbnail} displayWidth={isVideo ? 85 : 48} aspect={isVideo ? 16 / 9 : 1} radius={7} />
        {isCurrent && isPlaying ? (
          <PlayingBars className="absolute inset-0 m-auto" />
        ) : (
          <span
            className="absolute inset-0 grid place-items-center rounded-[inherit] bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover/track:opacity-100"
            aria-hidden="true"
          >
            <PlayIcon size={18} />
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            className={`min-w-0 truncate text-left bc-type-title-md ${
              isCurrent ? 'text-(--bc-page-accent,var(--bc-primary))' : 'text-(--bc-page-on,var(--bc-on-surface))'
            }`}
            onClick={play}
          >
            {item.title}
          </button>
          {item.explicit && <ExplicitBadge />}
        </div>
        <div className="truncate bc-type-body text-(--bc-page-on-variant,var(--bc-on-surface-variant))">
          <Byline item={item} />
        </div>
      </div>
      {isPlayable(item) && (
        <TrackMenu
          track={toTrack(item)}
          className="-mr-2 grid size-9 shrink-0 place-items-center rounded-full text-(--bc-page-on-variant,var(--bc-on-surface-variant)) hover:bg-(--bc-hover-fill)"
        />
      )}
    </div>
  );
}
