import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Outlet } from 'react-router';
import { useExtension } from '@/extension/useExtension';
import { sizedArtwork } from '@/lib/artwork';
import { useReducedMotion } from '@/lib/motionPrefs';
import { resumeSession } from '@/party/listenTogether';
import { startPartySync } from '@/party/partySync';
import { startHistoryReporting } from '@/playback/historyReporting';
import { startLivePresence } from '@/playback/livePresence';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { Banner, bannerButtonClass } from './Banner';
import { FloatingTabBar } from './FloatingTabBar';
import { MobilePlayerBar } from './MobilePlayerBar';
import { MobileTopBar } from './MobileTopBar';
import { PlayerBar } from './PlayerBar';
import { PlayerSheetContext, PlayerSheetController } from './PlayerSheetMotion';
import { SidePanel } from './SidePanel';
import { Sidebar } from './Sidebar';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const loadFullScreenPlayer = () =>
  import('./FullScreenPlayer').then((m) => ({ default: m.FullScreenPlayer }));

// Preloaded once a track enters the queue so upward pull from MiniPlayer never stalls.
const FullScreenPlayer = lazy(loadFullScreenPlayer);

/**
 * The app frame: desktop frosted rail + floating pill above 1000px, and
 * Android-ported floating top controls, bottom scrim, mini player pill and
 * floating tab bar below 1000px.
 */
export function AppShell() {
  useKeyboardShortcuts();
  // Listen Together: pick a party back up after a reload, and keep the player in step with it.
  useEffect(() => {
    resumeSession();
    return startPartySync();
  }, []);
  // Plays into the account's YouTube Music history (Settings › Share Listening Activity).
  useEffect(() => startHistoryReporting(), []);
  // Counts this tab in the "listening now" figure beside the phone and PC apps.
  useEffect(() => startLivePresence(), []);

  const extension = useExtension();
  const bannerDismissed = useUi((s) => s.installBannerDismissed);
  const dismissBanner = useUi((s) => s.dismissInstallBanner);
  const fullScreen = useUi((s) => s.fullScreen);
  const artworkUrl = usePlayer((s) => s.nowPlaying?.artworkUrl ?? null);
  const hasMiniPlayer = usePlayer((s) => Boolean(s.nowPlaying) || s.status === 'loading' || s.status === 'error');
  const reducedMotion = useReducedMotion();

  const [sheetController] = useState(
    () =>
      new PlayerSheetController((shown) => {
        if (useUi.getState().fullScreen !== shown) {
          useUi.getState().setFullScreen(shown);
        }
      }),
  );
  const sheetSnapshot = useSyncExternalStore(sheetController.subscribe, sheetController.getSnapshot);
  const dockCloneRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => sheetController.dispose(), [sheetController]);

  useEffect(() => {
    sheetController.setReducedMotion(reducedMotion);
  }, [sheetController, reducedMotion]);

  useEffect(() => {
    sheetController.setArtworkUrl(artworkUrl);
  }, [sheetController, artworkUrl]);

  useEffect(() => {
    sheetController.registerDockClone(dockCloneRef.current);
    return () => sheetController.registerDockClone(null);
  }, [sheetController]);

  // Preload FullScreenPlayer as soon as playback begins so drag-to-expand is instant.
  useEffect(() => {
    if (hasMiniPlayer) void loadFullScreenPlayer();
  }, [hasMiniPlayer]);

  // Sync external fullScreen changes (e.g. Escape key or __bcUi) with the spring sheet.
  useEffect(() => {
    const snap = sheetController.getSnapshot();
    if (fullScreen && !snap.shown) {
      sheetController.open();
    } else if (!fullScreen && snap.shown && snap.phase !== 'closing' && snap.phase !== 'closed') {
      sheetController.close();
    }
  }, [fullScreen, sheetController]);

  let banner = null;
  if (extension.state === 'missing' && !bannerDismissed) {
    banner = (
      <Banner
        title="The server relay is unreachable."
        detail="Playback, search, lyrics and addons travel through BitChord’s server relay, and it didn’t answer. Check your connection and reload."
        action={
          <button className={bannerButtonClass} onClick={() => location.reload()}>
            Reload
          </button>
        }
        onDismiss={dismissBanner}
      />
    );
  }

  const scrimHeight = hasMiniPlayer
    ? 'calc(var(--bc-bottom-inset) + 254px)'
    : 'calc(var(--bc-bottom-inset) + 180px)';
  const tapGuardHeight = hasMiniPlayer
    ? 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px + var(--bc-miniplayer-h) + 8px)'
    : 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px)';

  return (
    <PlayerSheetContext.Provider value={sheetController}>
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
        {/* The side panel slides in from beyond the right edge; never let it scroll the page. */}
        <div className="relative min-h-0 overflow-hidden">
          <Sidebar />
          <MobileTopBar />
          {/* The page scrolls under the fixed sidebar and floating bars. */}
          <main
            id="scrollable-page"
            className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-(--bc-bg) pl-(--bc-sidebar-w) [scrollbar-gutter:stable] data-tint:bg-(--bc-page-surface) max-lg:pt-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h))] max-lg:pl-0"
          >
            <div className="min-h-full pb-[calc(var(--bc-miniplayer-h)+var(--bc-pill-bottom)+40px)] max-lg:pb-[calc(var(--bc-bottom-inset)+var(--bc-tabbar-lift)+var(--bc-tabbar-h)+var(--bc-miniplayer-h)+32px)]">
              <Outlet />
            </div>
          </main>
          {/* Bottom fade scrim + tap guard (BottomFadeScrim.kt): flat colour ramp + 8px dead strip above floating bars. */}
          <div
            className="bc-bottom-scrim pointer-events-none fixed inset-x-0 bottom-0 z-[calc(var(--z-web-chrome)-3)] lg:hidden"
            style={{ height: scrimHeight }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-auto fixed inset-x-0 bottom-0 z-[calc(var(--z-web-chrome)-2)] touch-none lg:hidden"
            style={{ height: tapGuardHeight }}
            aria-hidden="true"
          />
          <PlayerBar />
          <MobilePlayerBar />
          <FloatingTabBar />
          <SidePanel />
        </div>
        {banner}
        {sheetSnapshot.shown && (
          <Suspense fallback={null}>
            <FullScreenPlayer />
          </Suspense>
        )}
        {/* FLIP artwork docking clone flying between MiniPlayer cover and FullScreenPlayer sleeve. */}
        <div
          ref={dockCloneRef}
          className="pointer-events-none fixed top-0 left-0 z-[calc(var(--z-contextual-menus)-1)] hidden overflow-hidden bg-[#1c1c1e] shadow-(--bc-shadow-sleeve) will-change-transform"
          aria-hidden="true"
        >
          {artworkUrl && (
            <img
              className="size-full object-cover"
              src={sizedArtwork(artworkUrl, 600)}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
            />
          )}
        </div>
      </div>
    </PlayerSheetContext.Provider>
  );
}
