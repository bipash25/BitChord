import { shelfHeader, shelfKinds, shelfList, shelfSection, type ShelfKind } from '@/components/shelf';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';

export type { ShelfKind };

const ITEMS: Record<ShelfKind, number> = {
  editorial: 3,
  square: 8,
  tracks: 16,
  horizontal: 8,
  video: 5,
  circle: 8,
};

const caption = 'mt-2.5 flex flex-col gap-1';

function Item({ kind }: { kind: ShelfKind }) {
  switch (kind) {
    case 'square':
      return (
        <div className="flex flex-col">
          <SkeletonBlock aspectRatio="1" radius="var(--bc-radius-sleeve)" />
          <div className={caption}>
            <SkeletonLine lineHeight={20} fontSize={15} width="80%" />
            <SkeletonLine lineHeight={17} fontSize={13} width="55%" />
          </div>
        </div>
      );
    case 'video':
      return (
        <div className="flex flex-col">
          <SkeletonBlock aspectRatio="16 / 9" radius="var(--bc-radius-sleeve)" />
          <div className={caption}>
            <SkeletonLine lineHeight={20} fontSize={15} width="75%" />
            <SkeletonLine lineHeight={17} fontSize={13} width="45%" />
          </div>
        </div>
      );
    case 'circle':
      return (
        <div className="flex flex-col items-center">
          <SkeletonBlock aspectRatio="1" radius="50%" />
          <div className="mt-2.5 flex w-full justify-center">
            <SkeletonLine lineHeight={20} fontSize={15} width="65%" />
          </div>
        </div>
      );
    case 'tracks':
      return (
        <div className="flex items-center gap-3 py-1">
          <SkeletonBlock width={48} height={48} radius={7} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SkeletonLine lineHeight={20} fontSize={15} width="70%" />
            <SkeletonLine lineHeight={17} fontSize={13} width="42%" />
          </div>
        </div>
      );
    case 'horizontal':
      return (
        <div className="grid grid-cols-[97px_1fr] items-center gap-x-4">
          <SkeletonBlock width={97} height={97} radius="var(--bc-radius-art)" />
          <div className="flex flex-col gap-1">
            <SkeletonLine lineHeight={20} fontSize={15} width="75%" />
            <SkeletonLine lineHeight={17} fontSize={13} width="45%" />
          </div>
        </div>
      );
    case 'editorial':
      return (
        <div className="flex flex-col">
          <SkeletonBlock aspectRatio="16 / 9" radius="var(--bc-radius-sleeve)" />
          <div className={caption}>
            <SkeletonLine lineHeight={20} fontSize={15} width="60%" />
            <SkeletonLine lineHeight={17} fontSize={13} width="40%" />
          </div>
        </div>
      );
  }
}

export function ShelfSkeleton({ kind, title = true }: { kind: ShelfKind; title?: boolean }) {
  return (
    <section className={shelfSection} aria-hidden="true">
      {title && (
        <div className={shelfHeader}>
          <SkeletonLine lineHeight={26} fontSize={20} width={170} />
        </div>
      )}
      <div className="relative">
        <div className={`${shelfList} ${shelfKinds[kind]}`}>
          {Array.from({ length: ITEMS[kind] }, (_, i) => (
            <Item key={i} kind={kind} />
          ))}
        </div>
      </div>
    </section>
  );
}
