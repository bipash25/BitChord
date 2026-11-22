import { Shuffle, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { browseHref } from '@/components/music/links';
import { playList, shuffleList } from '@/components/music/play';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import {
  requestAppleAccess,
  useAppleArtistArt,
  useUngrantedAppleOrigins,
  type AppleArtistArt,
} from '@/data/apple/artistArt';
import { useArtist, useYouTubeReady } from '@/data/music/queries';
import { useArtworkPalette } from '@/lib/artworkPalette';
import { usePageTint } from '@/lib/usePageTint';
import { ArtistSkeleton } from '@/skeletons/PageSkeletons';

/**
 * The name, or Apple's title logo in its place (`DetailScreen.kt:1322-1448`):
 * until the logo decodes, the name stands in so the header is never empty.
 */
function ArtistName({ name, apple }: { name: string; apple: AppleArtistArt | null }) {
  const logo = apple?.logoUrl ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const logoShown = Boolean(logo) && shown === logo;

  return (
    <h1
      className="px-6 text-center bc-type-display text-(--bc-page-on,var(--bc-on-surface)) [text-shadow:0_2px_18px_rgba(0,0,0,0.35)] data-logo:w-full data-logo:[text-shadow:none]"
      data-logo={logoShown || undefined}
    >
      {!logoShown && name}
      {logo && (
        <img
          key={logo}
          className="mx-auto block h-auto max-h-[min(18vh,160px)] w-auto max-w-[min(82%,540px)] [filter:drop-shadow(0_2px_16px_rgba(0,0,0,0.28))]"
          src={logo}
          alt={logoShown ? name : ''}
          hidden={!logoShown}
          style={{ aspectRatio: String(apple!.logoAspect) }}
          decoding="async"
          onLoad={() => setShown(logo)}
        />
      )}
    </h1>
  );
}

/**
 * Artist detail (`DetailScreen.kt:392-435, 1322-1997`, spec §6.6):
 * full-bleed photo (0.95 aspect capped at 60vh) dissolving into `--bc-page-wash`,
 * 70px Play circle + 52px Shuffle circle, 4-row Top Songs pager, shelves, and About + stats chip.
 */
export default function ArtistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const artist = useArtist(id);
  const apple = useAppleArtistArt(artist.data?.name);
  const appleUngranted = useUngrantedAppleOrigins();
  const [aboutExpanded, setAboutExpanded] = useState(false);

  const keyColors = useMemo(
    () => (apple ? { background: apple.background, accent: apple.keyColor ?? '#ffffff' } : null),
    [apple],
  );
  const paletteResult = useArtworkPalette(apple?.heroUrl ?? artist.data?.heroImage, { keyColors });
  usePageTint(paletteResult, { surface: 'wash' });

  if (missing) return <NeedsExtension />;
  if (artist.isError) return <LoadError error={artist.error} onRetry={() => void artist.refetch()} />;
  if (!artist.data) return <ArtistSkeleton />;

  const data = artist.data;
  const topSongs = { title: `${data.name}: Top Songs`, type: 'artist' as const, id: data.id };
  const canPlay = data.topSongs.length > 0;
  const playFill = apple?.keyColor ?? '#ffffff';
  const playInk = paletteResult.palette?.wash ?? 'var(--bc-bg)';

  return (
    <>
      <header className="relative overflow-hidden max-lg:-mt-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h))]">
        <div className="relative w-full aspect-[0.95] max-h-[60vh]">
          <Artwork src={data.heroImage} displayWidth={1200} aspect={0.95} className="size-full" radius={0} eager />
          {apple && (
            <img
              key={apple.heroUrl}
              className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-400 ease-in data-loaded:opacity-100"
              src={apple.heroUrl}
              alt=""
              decoding="async"
              onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
            />
          )}
          {/* Eased multi-stop dissolve into --bc-page-wash (DetailScreen.kt:1543-1549). */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, transparent 45%, color-mix(in srgb, var(--bc-page-surface, var(--bc-bg)) 30%, transparent) 65%, color-mix(in srgb, var(--bc-page-surface, var(--bc-bg)) 72%, transparent) 82%, color-mix(in srgb, var(--bc-page-surface, var(--bc-bg)) 95%, transparent) 94%, var(--bc-page-surface, var(--bc-bg)) 100%)',
            }}
            aria-hidden="true"
          />
        </div>

        <div className="relative -mt-12 flex flex-col items-center pb-5">
          <ArtistName name={data.name} apple={apple} />

          <div className="mt-4 flex items-center justify-center gap-6 px-6">
            <button
              type="button"
              className="grid size-[52px] place-items-center rounded-full border border-[color-mix(in_srgb,var(--bc-page-on,var(--bc-on-surface))_14%,transparent)] bg-[color-mix(in_srgb,var(--bc-page-on,var(--bc-on-surface))_8%,transparent)] text-(--bc-page-on,var(--bc-on-surface)) transition-transform active:scale-95 disabled:opacity-38"
              aria-label={`Shuffle ${data.name}`}
              disabled={!canPlay}
              onClick={() => shuffleList(data.topSongs, { source: topSongs })}
            >
              <Shuffle size={22} strokeWidth={2.2} />
            </button>

            <button
              type="button"
              className="grid size-(--bc-artist-play) place-items-center rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.22)] transition-transform active:scale-95 enabled:hover:scale-[1.03] disabled:opacity-40"
              style={{ backgroundColor: playFill, color: playInk }}
              aria-label={`Play ${data.name}`}
              disabled={!canPlay}
              onClick={() => playList(data.topSongs, 0, { source: topSongs })}
            >
              <PlayIcon size={36} />
            </button>
          </div>

          {!apple && appleUngranted.length > 0 && (
            <div className="bc-frost mt-4 flex items-center gap-2.5 rounded-full py-1.5 pr-2 pl-3.5 bc-type-label text-(--bc-glass-content)">
              <span>Apple Music artist art needs the server relay’s permission.</span>
              <button
                type="button"
                className="flex-none rounded-full bg-white/20 px-2.5 py-1 bc-type-label-sm hover:bg-white/30"
                onClick={requestAppleAccess}
              >
                Allow
              </button>
            </div>
          )}
        </div>
      </header>

      {data.topSongs.length > 0 && (
        <TrackShelf
          title="Top Songs"
          to={data.topSongsSeeAll ? browseHref(data.topSongsSeeAll) : null}
          tracks={data.topSongs}
          source={topSongs}
        />
      )}

      <Shelves shelves={data.shelves} />

      {(data.description || data.audience) && (
        <section className="mx-(--bc-page-gutter) mt-7 mb-10" aria-label={`About ${data.name}`}>
          <h2 className="mb-1.5 bc-type-title-md text-(--bc-page-on,var(--bc-on-surface))">
            About {data.name}
          </h2>
          {data.description && (
            <>
              <p
                className={`max-w-[720px] bc-type-body-lg text-(--bc-page-on-variant,var(--bc-on-surface-variant)) ${
                  aboutExpanded ? 'whitespace-pre-line' : 'line-clamp-2'
                }`}
              >
                {data.description}
              </p>
              {data.description.length > 120 && (
                <button
                  type="button"
                  className="mt-1 py-1 bc-type-label text-(--bc-page-accent,var(--bc-primary)) hover:underline"
                  onClick={() => setAboutExpanded((v) => !v)}
                >
                  {aboutExpanded ? 'Less' : 'More'}
                </button>
              )}
            </>
          )}
          {data.audience && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="bc-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bc-type-label text-(--bc-page-on-variant,var(--bc-on-surface-variant))">
                <Users size={15} />
                <span>{data.audience}</span>
              </span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
