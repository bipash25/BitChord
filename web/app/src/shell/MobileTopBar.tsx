import { ChevronLeft, Menu, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { PrefetchLink } from '@/components/PrefetchLink';
import { LogoMark } from '@/components/icons/LogoMark';
import { useYtAuth } from '@/extension/useYtAuth';
import { useUi } from '@/state/ui';
import { isRootTabPath } from './FloatingTabBar';

/**
 * Android-ported floating top chrome (FrostedTopBar.kt + TopFadeBlur.kt, spec §3.2 & §3.6).
 *
 * Below 1000px (lg:hidden), root tabs render no bar pane — just the wordmark
 * and a floating frosted actions pill over the 24px TopFadeBlur scroll edge.
 * Pushed routes swap the wordmark for a 44px circular frosted Back button.
 */
export function MobileTopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const ytAuth = useYtAuth();

  const isRoot = isRootTabPath(pathname);
  const activeAccount =
    ytAuth.state === 'ready' && ytAuth.auth.signedIn && ytAuth.auth.active?.name ? ytAuth.auth.active : null;

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };

  return (
    <>
      <div
        className="bc-top-fade pointer-events-none fixed inset-x-0 top-0 z-[calc(var(--z-web-chrome)-2)] h-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h)+16px)] lg:hidden"
        aria-hidden="true"
      />
      <header className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top,0px)] z-[calc(var(--z-web-chrome)-1)] flex h-(--bc-topbar-h) items-center justify-between px-(--bc-bar-gutter) lg:hidden">
        <div className="pointer-events-auto flex items-center">
          {isRoot ? (
            <PrefetchLink
              to="/home"
              className="inline-flex items-center gap-1.5 font-(family-name:--bc-font-family) text-[18px] leading-none font-bold tracking-[-0.015em] text-(--bc-on-surface)"
              aria-label="BitChord, Home"
            >
              <LogoMark size={20} className="text-(--bc-on-surface)" />
              <span>BitChord</span>
            </PrefetchLink>
          ) : (
            <button
              type="button"
              className="bc-frost grid size-(--bc-top-control) place-items-center rounded-full text-(--bc-glass-content) shadow-(--bc-shadow-glass) transition-transform active:scale-92"
              aria-label="Back"
              onClick={handleBack}
            >
              <ChevronLeft size={22} strokeWidth={2.2} />
            </button>
          )}
        </div>

        <div className="pointer-events-auto bc-frost flex h-(--bc-top-control) items-center gap-(--bc-action-gap) rounded-full px-[1.5px] text-(--bc-glass-content) shadow-(--bc-shadow-glass)">
          <PrefetchLink
            to="/settings"
            className="grid size-(--bc-top-control) place-items-center rounded-full"
            aria-label={activeAccount ? `Account and settings (${activeAccount.name})` : 'Settings'}
            title="Settings"
          >
            {activeAccount?.avatarUrl ? (
              <img
                src={activeAccount.avatarUrl}
                alt=""
                className="size-(--bc-avatar) rounded-full border-[0.5px] border-(--bc-glass-edge) object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="grid size-(--bc-avatar) place-items-center rounded-full border-[0.5px] border-(--bc-glass-edge) bg-(--bc-surface-variant) text-(--bc-on-surface-variant)">
                <User size={16} strokeWidth={2} />
              </span>
            )}
          </PrefetchLink>
          <button
            type="button"
            className="grid size-(--bc-top-control) place-items-center rounded-full"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} strokeWidth={2} />
          </button>
        </div>
      </header>
    </>
  );
}
