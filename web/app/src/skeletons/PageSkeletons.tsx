import { PageHeader } from '@/components/PageHeader';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';
import { DetailSkeleton, SongListSkeleton } from './DetailSkeleton';
import { ShelfSkeleton } from './ShelfSkeleton';

const sectionTitle = 'mx-(--bc-page-gutter) mt-3';

export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <PageHeader title="Home" />
      <ShelfSkeleton kind="tracks" />
      <ShelfSkeleton kind="square" />
      <ShelfSkeleton kind="square" />
    </div>
  );
}

export function NewSkeleton() {
  return (
    <div aria-busy="true">
      <PageHeader title="New" />
      <ShelfSkeleton kind="square" />
      <ShelfSkeleton kind="tracks" />
      <ShelfSkeleton kind="square" />
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <div aria-busy="true">
      <div className="px-(--bc-page-gutter) pt-3 pb-2" aria-hidden="true">
        <SkeletonBlock width="100%" height={40} radius="var(--bc-radius-field)" />
      </div>
      <div className={sectionTitle} aria-hidden="true">
        <SkeletonLine lineHeight={26} fontSize={20} width={160} />
      </div>
      <div
        className="mx-(--bc-page-gutter) mt-3 mb-8 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
        aria-hidden="true"
      >
        {Array.from({ length: 12 }, (_, i) => (
          <SkeletonBlock key={i} aspectRatio="1.72" radius="var(--bc-radius-mood-card)" />
        ))}
      </div>
    </div>
  );
}

export function AlbumSkeleton() {
  return <DetailSkeleton />;
}

export function PlaylistSkeleton() {
  return <DetailSkeleton rowArtwork rows={10} />;
}

export function HistorySkeleton() {
  return (
    <div aria-busy="true">
      <PageHeader title="History" />
      <div className="pt-2">
        <SongListSkeleton count={10} />
      </div>
    </div>
  );
}

export function ArtistSkeleton() {
  return (
    <div aria-busy="true">
      <SkeletonBlock className="aspect-[0.95] max-h-[60vh] w-full max-lg:-mt-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h))]" radius={0} />
      <div className="mt-4 flex justify-center gap-6" aria-hidden="true">
        <SkeletonBlock width={52} height={52} radius="9999px" />
        <SkeletonBlock width={70} height={70} radius="9999px" />
      </div>
      <ShelfSkeleton kind="tracks" />
      <ShelfSkeleton kind="square" />
      <ShelfSkeleton kind="square" />
    </div>
  );
}

export function PlainSkeleton() {
  return (
    <div aria-busy="true" className={sectionTitle}>
      <SkeletonLine lineHeight={39} fontSize={34} width={220} style={{ marginTop: 32 }} />
    </div>
  );
}
