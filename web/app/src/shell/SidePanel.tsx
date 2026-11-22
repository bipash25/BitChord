import { lazy, Suspense } from 'react';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { BlurredArtworkBackdrop } from './MeshBackdrop';
import { UpNext } from './UpNext';

// am-lyrics is large; it loads the first time the panel opens (prompt §3).
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/**
 * Up Next / Lyrics panel (report §7). The Android player has no side panel — its
 * lyrics and queue both stand on the blurred cover (`NowPlayingScreen.kt:2362-2377`),
 * so this panel carries that backdrop instead of the frost over the page it used
 * to be: blurred artwork, the scrim that keeps the white type readable, and a
 * 320ms cover crossfade when the track changes.
 */
export function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  // Hidden under the full-screen player, which has its own lyrics: one am-lyrics at a time.
  const fullScreen = useUi((s) => s.fullScreen);
  const artworkUrl = usePlayer((s) => s.nowPlaying?.artworkUrl ?? null);
  if (!panel || fullScreen) return null;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-(--z-web-chrome) flex w-(--bc-sidepanel-w) animate-slide-in flex-col overflow-hidden border-0 border-l-[0.5px] border-l-(--bc-glass-edge) shadow-(--bc-shadow-menu) max-sm:w-full"
      aria-label={panel === 'up-next' ? 'Up Next' : 'Lyrics'}
    >
      <BlurredArtworkBackdrop artworkUrl={artworkUrl} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {panel === 'up-next' ? (
          <UpNext />
        ) : (
          <Suspense fallback={null}>
            <LyricsPanel />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
