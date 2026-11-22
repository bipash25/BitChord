import { useReducedMotion } from '@/lib/motionPrefs';
import { usePlayer } from '@/state/player';
import { dismissToast, useToast } from '@/state/toast';

/**
 * Android-ported `QueueActionNoticeHost` (`QueueActionNotice.kt:35-76`, spec §6.23):
 * frosted confirmation strip anchored immediately above the MiniPlayer (or tab
 * bar when idle), keyed by notice `id` so repeated actions re-trigger entrance.
 */
export function QueueActionNoticeHost() {
  const notice = useToast((s) => s.notice);
  const reducedMotion = useReducedMotion();
  const hasMiniPlayer = usePlayer((s) => Boolean(s.nowPlaying) || s.status === 'loading' || s.status === 'error');

  if (!notice) return null;

  const mobileBottom = hasMiniPlayer
    ? 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px + var(--bc-miniplayer-h) + 8px)'
    : 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px)';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-(--z-contextual-menus) flex justify-center px-(--bc-bar-gutter) lg:right-0 lg:bottom-[calc(var(--bc-pill-bottom)+var(--bc-miniplayer-h)+12px)]! lg:left-(--bc-sidebar-w)"
      style={{ bottom: mobileBottom }}
    >
      <div
        key={notice.id}
        role="status"
        aria-live="polite"
        onClick={dismissToast}
        className={`bc-frost bc-continuous pointer-events-auto w-full max-w-(--bc-floating-bar-max) cursor-pointer rounded-(--bc-radius-alert) px-5 py-3.5 text-(--bc-on-surface) shadow-(--bc-shadow-glass) ${
          reducedMotion ? '' : 'animate-toast-in motion-reduce:animate-none'
        }`}
      >
        <p className="bc-type-body-lg font-medium">{notice.message}</p>
      </div>
    </div>
  );
}
