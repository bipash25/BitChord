/**
 * Page title row (`ExploreScreen.kt:89`, `LibraryScreen.kt:136`, `SettingsSheet.kt:2466`):
 * Display 34px W800 (draws Bold via shifted font face) aligned to Android's 16px page gutter.
 */
export function PageHeader({ title }: { title: string }) {
  return (
    <div className="mx-(--bc-page-gutter) pt-8 max-lg:pt-(--bc-topbar-gap)">
      <h1 className="bc-type-display text-(--bc-page-on,var(--bc-on-surface))">{title}</h1>
    </div>
  );
}
