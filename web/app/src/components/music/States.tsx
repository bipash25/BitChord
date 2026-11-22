/** A page-sized message (`Common.kt:920-943`, `MessageState`), centred. */
export const stateStyles = {
  state: 'mx-auto my-20 flex max-w-[420px] flex-col items-center gap-3 px-(--bc-page-gutter) text-center',
  title: 'bc-type-headline text-(--bc-page-on,var(--bc-on-surface))',
  detail: 'bc-type-body-lg text-(--bc-page-on-variant,var(--bc-on-surface-variant))',
  button:
    'mt-2 inline-flex h-10 items-center justify-center rounded-full bg-(--bc-primary) px-5 bc-type-title-md text-(--bc-on-primary) transition-opacity hover:opacity-90 disabled:opacity-40',
};

export function NeedsExtension({ what = 'YouTube Music' }: { what?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Can’t reach the server relay</p>
      <p className={stateStyles.detail}>
        BitChord brings {what} into this page through its server relay, and it didn’t answer. Check your connection and
        reload.
      </p>
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>Couldn’t load this page</p>
      <p className={stateStyles.detail}>{error instanceof Error ? error.message : String(error)}</p>
      <button className={stateStyles.button} onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={stateStyles.state}>
      <p className={stateStyles.title}>{title}</p>
      {detail && <p className={stateStyles.detail}>{detail}</p>}
    </div>
  );
}

export function LoadMoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-(--bc-page-gutter) pt-6 pb-10 bc-type-body text-(--bc-page-on-variant,var(--bc-on-surface-variant))">
      <span>Couldn’t load more.</span>
      <button className="bc-type-label text-(--bc-page-accent,var(--bc-primary)) hover:underline" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}
