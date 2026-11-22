import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PrefetchLink } from '@/components/PrefetchLink';
import { firstBrowseArtwork } from '@/data/music/mappers';
import { browseQuery, useYouTubeReady } from '@/data/music/queries';
import { sizedArtwork } from '@/lib/artwork';
import type { Category, CategoryGroup } from '@/data/music/types';
import { browseHref } from './links';

function useNearViewport<T extends HTMLElement>(rootMargin = '600px') {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return { ref, near };
}

/**
 * Android `MoodGenreCard` (`ExploreScreen.kt:164-285`, spec §6.3):
 * 18px radius, 1.72 aspect, 28% left stripe, duotone cover over right 72%,
 * top-left white bold title over a vertical top scrim.
 */
const tile =
  'relative flex aspect-[1.72] items-start overflow-hidden rounded-(--bc-radius-mood-card) px-3.5 py-3 text-white transition-transform duration-200 ease-out hover:scale-[1.015] active:scale-[0.985]';

function CategoryTile({ category }: { category: Category }) {
  const { ready } = useYouTubeReady();
  const { ref, near } = useNearViewport<HTMLLIElement>();
  const [loaded, setLoaded] = useState(false);
  const browse = useQuery({ ...browseQuery(category.link), enabled: ready && near });
  const borrowed = browse.data ? firstBrowseArtwork(browse.data) : null;
  const artwork = borrowed ? (borrowed.wide ? borrowed.thumbnail : sizedArtwork(borrowed.thumbnail, 480)) : null;
  const fade = {
    opacity: loaded ? 1 : 0,
    transition: 'opacity 300ms ease',
  } as React.CSSProperties;

  return (
    <li ref={ref}>
      <PrefetchLink
        to={browseHref(category.link)}
        className={tile}
        style={
          {
            '--tile-color': category.color,
            backgroundColor: 'color-mix(in srgb, var(--tile-color) 92%, #000)',
          } as React.CSSProperties
        }
      >
        {/* Right 72% artwork area with duotone treatment (`ExploreScreen.kt:178-194`). */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-[72%]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--tile-color) 55%, #000)' }}
        >
          {artwork && (
            <>
              <img
                src={artwork}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded(true)}
                className="size-full object-cover grayscale contrast-[1.05]"
                style={{ ...fade, objectPosition: '50% 25%' }}
              />
              <span
                className="absolute inset-0 mix-blend-multiply"
                style={{ ...fade, background: 'color-mix(in srgb, var(--tile-color) 68%, #fff)' }}
              />
              <span
                className="absolute inset-0 mix-blend-screen"
                style={{ ...fade, background: 'color-mix(in srgb, var(--tile-color) 32%, #000)' }}
              />
            </>
          )}
        </span>
        {/* Top vertical shade so pale stripes keep white type legible (`ExploreScreen.kt:197-201`). */}
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.24)_0%,transparent_62%)]"
        />
        <span className="relative line-clamp-2 bc-type-title-md font-bold [text-shadow:0_1px_6px_rgba(0,0,0,0.35)]">
          {category.title}
        </span>
      </PrefetchLink>
    </li>
  );
}

/**
 * Explore / Moods & Genres grid (`ExploreScreen.kt:266-290`, spec §6.3):
 * 12px gaps, 2 columns on phones, min 220px up to 6 columns on wide screens.
 */
export function CategoryTiles({ groups }: { groups: CategoryGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} className="pt-4" aria-label={group.title}>
          <h2 className="mx-(--bc-page-gutter) bc-type-headline text-(--bc-on-surface)">{group.title}</h2>
          <ul className="mx-(--bc-page-gutter) mt-3 mb-7 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] 2xl:grid-cols-6">
            {group.categories.map((category) => (
              <CategoryTile key={`${category.title}-${category.link.params}`} category={category} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
