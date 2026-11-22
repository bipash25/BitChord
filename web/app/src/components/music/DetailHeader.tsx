import { Check, Plus, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PlayIcon } from '@/components/icons/Transport';
import type { AppleMotion } from '@/data/apple/motionArt';
import { useSetListSaved, useSignedIn } from '@/data/music/queries';
import type { HeaderInfo } from '@/data/music/types';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { artistHref } from './links';
import { MotionArtwork } from './MotionArtwork';

interface DetailHeaderProps {
  info: HeaderInfo;
  onPlay: () => void;
  onShuffle: () => void;
  canPlay: boolean;
  /** More actions after the library toggle (a Spotify playlist's Import). */
  extra?: React.ReactNode;
  /** Apple's motion artwork for an album, over the cover once it plays. */
  motion?: AppleMotion | null;
}

/**
 * Release action buttons (`DetailScreen.kt:1651-1796`): white Play pill +
 * 50px veil-glass side circles with 10% rim hairline.
 */
export const detailButton = {
  pill: 'inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 bc-type-title-md text-black shadow-[0_2px_12px_rgba(0,0,0,0.12)] transition-transform active:scale-[0.98] disabled:opacity-40 enabled:hover:opacity-92',
  circle:
    'grid size-[50px] shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--bc-page-on,var(--bc-on-surface))_14%,transparent)] bg-[color-mix(in_srgb,var(--bc-page-on,var(--bc-on-surface))_8%,transparent)] text-(--bc-page-on,var(--bc-on-surface)) transition-transform active:scale-95 disabled:opacity-38 enabled:hover:bg-[color-mix(in_srgb,var(--bc-page-on,var(--bc-on-surface))_14%,transparent)]',
};

/**
 * Android `ReleaseHeader` (`DetailScreen.kt:915-1180`, spec §6.5 & §6.7):
 * framed sleeve (76% width capped at 50% height, 12px corner, 18px shadow),
 * centered title/credit/meta, Shuffle · Play · Library row, and collapsible About.
 */
export function DetailHeader({ info, onPlay, onShuffle, canPlay, extra, motion }: DetailHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const signedIn = useSignedIn();
  const setSaved = useSetListSaved();
  const library = signedIn ? info.library : null;
  const metaLine = [info.subtitle, info.meta].filter(Boolean).join(' · ');

  return (
    <header className="flex flex-col items-center pt-5 pb-[18px] text-center">
      <div className="relative w-[min(76vw,50vh,340px)] overflow-hidden rounded-(--bc-radius-sleeve) bg-(--bc-page-elevated,var(--bc-surface-variant)) shadow-(--bc-shadow-sleeve)">
        <Artwork src={info.thumbnail} displayWidth={340} radius="var(--bc-radius-sleeve)" eager />
        {motion && (
          <MotionArtwork
            key={motion.url}
            motion={motion}
            className="absolute inset-0 size-full rounded-(--bc-radius-sleeve) object-cover opacity-0 transition-opacity duration-600 ease-in data-ready:opacity-100"
          />
        )}
      </div>

      <h1 className="mt-5 flex max-w-[560px] items-center justify-center px-6 bc-type-headline text-(--bc-page-on,var(--bc-on-surface))">
        <span className="line-clamp-2">{info.title}</span>
        {info.explicit && <ExplicitBadge size={15} />}
      </h1>

      {info.artists.length > 0 && (
        <div className="mt-0.5 max-w-[560px] truncate px-6 font-(family-name:--bc-font-family) text-[19px] leading-snug font-normal tracking-(--bc-tracking-title) text-(--bc-page-on-variant,var(--bc-on-surface-variant))">
          {info.artists.map((artist, i) => {
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
        </div>
      )}

      {metaLine && (
        <div className="mt-1 max-w-[560px] truncate px-6 bc-type-label text-(--bc-page-on-variant,var(--bc-on-surface-variant))">
          {metaLine}
        </div>
      )}

      <div className="mt-[18px] flex w-full max-w-[420px] items-center gap-3.5 px-6">
        <button
          type="button"
          className={detailButton.circle}
          aria-label="Shuffle"
          onClick={onShuffle}
          disabled={!canPlay}
        >
          <Shuffle size={20} strokeWidth={2.2} />
        </button>
        <button type="button" className={detailButton.pill} onClick={onPlay} disabled={!canPlay}>
          <PlayIcon size={18} />
          <span>Play</span>
        </button>
        {library ? (
          <button
            type="button"
            className={detailButton.circle}
            aria-label={library.saved ? 'Remove from Library' : 'Add to Library'}
            aria-pressed={library.saved}
            title={library.saved ? 'In your library' : 'Add to Library'}
            disabled={setSaved.isPending}
            onClick={() => setSaved.mutate({ playlistId: library.playlistId, saved: !library.saved })}
          >
            {library.saved ? <Check size={22} strokeWidth={2.3} /> : <Plus size={22} strokeWidth={2.3} />}
          </button>
        ) : (
          <button
            type="button"
            className={detailButton.circle}
            aria-label="Add to Library"
            disabled
          >
            <Plus size={22} strokeWidth={2.3} />
          </button>
        )}
        {extra}
      </div>

      {info.description && (
        <div className="mt-5 w-full px-[22px] text-start">
          <h2 className="mb-1.5 bc-type-title-md text-(--bc-page-on,var(--bc-on-surface))">About</h2>
          <p
            className={`bc-type-body-lg text-(--bc-page-on-variant,var(--bc-on-surface-variant)) ${
              expanded ? 'whitespace-pre-line' : 'line-clamp-2'
            }`}
          >
            {info.description}
          </p>
          {info.description.length > 120 && (
            <button
              type="button"
              className="mt-1 py-1 bc-type-label text-(--bc-page-accent,var(--bc-primary)) hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
