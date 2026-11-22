import { lazy, Suspense, useEffect } from 'react';
import { resumeSession } from '@/party/listenTogether';
import { startPartySync } from '@/party/partySync';
import { startHistoryReporting } from '@/playback/historyReporting';
import { startLivePresence } from '@/playback/livePresence';
import { Outlet } from 'react-router';
import { useExtension } from '@/extension/useExtension';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { Banner, bannerButtonClass } from './Banner';
import { FloatingTabBar } from './FloatingTabBar';
import { MobilePlayerBar } from './MobilePlayerBar';
import { MobileTopBar } from './MobileTopBar';
import { PlayerBar } from './PlayerBar';
import { SidePanel } from './SidePanel';
import { Sidebar } from './Sidebar';

// It carries am-lyrics; loaded the first time it opens, as the side panel's lyrics are.
const FullScreenPlayer = lazy(() => import('./FullScreenPlayer').then((m) => ({ default: m.FullScreenPlayer })));

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
  const hasMiniPlayer = usePlayer((s) => Boolean(s.nowPlaying) || s.status === 'loading' || s.status === 'error');

  let banner = null;
  // The banner is for visitors who can't play at all: the relay wasn't
  // configured or didn't answer, and reloading is the one thing worth trying.
  // There is nothing to install — the site no longer points at the Android
  // app anywhere — and 'checking' stays quiet until it settles.
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
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
      {/* The side panel slides in from beyond the right edge; never let it scroll the page. */}
      <div className="relative min-h-0 overflow-hidden">
        <Sidebar />
        <MobileTopBar />
        {/* The page scrolls under the fixed sidebar and floating bars. */}
        <main
          id="scrollable-page"
          className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-(--bc-bg) pl-(--web-navigation-width) [scrollbar-gutter:stable] data-tint:bg-(--page-tint) data-tint:transition-[background-color] data-tint:duration-300 data-tint:ease-in max-lg:pt-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h))] max-lg:pl-0"
        >
          <div className="min-h-full pb-[calc(var(--player-pill-height)+var(--player-bottom-offset)+40px)] max-lg:pb-[calc(var(--bc-bottom-inset)+var(--bc-tabbar-lift)+var(--bc-tabbar-h)+var(--bc-miniplayer-h)+32px)]">
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
      {fullScreen && (
        <Suspense fallback={null}>
          <FullScreenPlayer />
        </Suspense>
      )}
    </div>
  );
}
