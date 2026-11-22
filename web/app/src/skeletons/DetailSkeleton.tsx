import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';

/**
 * Android `SongListSkeleton` (`Skeletons.kt` / `Common.kt:512-649`):
 * 60px rows, 52px art (8px corner) or 24px number column, 16px side gutters,
 * and 0.5px dividers inset 84px / 56px.
 */
export function SongListSkeleton({ count = 10, numbered = false }: { count?: number; numbered?: boolean }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="flex items-center px-(--bc-page-gutter) py-1">
            {numbered ? (
              <div className="mr-(--bc-page-gutter) grid h-[52px] w-(--bc-track-number-w) shrink-0 place-items-center">
                <SkeletonLine lineHeight={20} fontSize={14} width={14} />
              </div>
            ) : (
              <div className="mr-3.5 shrink-0">
                <SkeletonBlock width={52} height={52} radius="var(--bc-radius-art)" />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <SkeletonLine lineHeight={20} fontSize={15} width={`${36 + ((i * 29) % 36)}%`} />
              <SkeletonLine lineHeight={17} fontSize={13} width={`${24 + ((i * 19) % 28)}%`} />
            </div>
            <SkeletonLine lineHeight={16} fontSize={12} width={32} style={{ marginLeft: 12 }} />
          </div>
          {i < count - 1 && (
            <div
              className="h-0 border-t-[0.5px] border-t-(--bc-outline)/50"
              style={{ marginLeft: numbered ? 56 : 'var(--bc-queue-divider-inset)' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Android release detail skeleton: centered 76%/50vh sleeve, title, pills, and SongRows. */
export function DetailSkeleton({ rows = 10, rowArtwork = false }: { rows?: number; rowArtwork?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="flex flex-col items-center pt-5 pb-[18px]" aria-hidden="true">
        <SkeletonBlock
          className="w-[min(76vw,50vh,340px)]"
          aspectRatio="1"
          radius="var(--bc-radius-sleeve)"
        />
        <div className="mt-5 flex flex-col items-center gap-1.5">
          <SkeletonLine lineHeight={26} fontSize={22} width={220} />
          <SkeletonLine lineHeight={22} fontSize={18} width={140} />
          <SkeletonLine lineHeight={16} fontSize={12} width={160} />
        </div>
        <div className="mt-[18px] flex w-full max-w-[420px] items-center gap-3.5 px-6">
          <SkeletonBlock width={50} height={50} radius="9999px" />
          <SkeletonBlock className="flex-1" height={50} radius="9999px" />
          <SkeletonBlock width={50} height={50} radius="9999px" />
        </div>
      </div>
      <SongListSkeleton count={rows} numbered={!rowArtwork} />
    </div>
  );
}
