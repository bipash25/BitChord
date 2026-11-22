import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useYtAuth } from '@/extension/useYtAuth';

// The signed-out pill: Apple's red "Sign In" (report §1, .navigation__native-cta).
const pill =
  'self-start rounded-[16px] bg-key px-3.5 py-[5px] type-[600_13px/18px] text-white hover:brightness-[1.08]';
// The prompt's one action, in the key-colour pill idiom the app uses elsewhere.
const openMusic =
  'inline-flex h-8 items-center whitespace-nowrap rounded-pill bg-key-bg px-4 type-body-emphasized text-white hover:brightness-[1.08]';

/**
 * The sidebar's account control. The transport's session is functional but
 * identity-free, and the standing rule (web/docs/private-deployment.md,
 * 2026-11-22) is absolute: no name, avatar, email — no hint of the account
 * behind the app at all — may appear in the frontend. So where the account's
 * own control would render, the sign-in prompt stands instead (the pattern
 * LibraryPage already carries), and tapping it asks for a sign-in exactly
 * the way any signed-out app would. What answers behind that ask is the
 * operator's business, documented under web/docs — never the page's.
 */
export function AccountButton() {
  const status = useYtAuth();
  const [open, setOpen] = useState(false);

  if (status.state !== 'ready') return null;
  const { auth } = status;

  return (
    <div>
      <button className={pill} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {auth.signedIn ? 'Sign in with YouTube' : 'Sign In'}
      </button>
      {open && <SignInPrompt onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The sign-in ask, in the app's modal idiom (LyricsSettings' scrim and card):
 * the wording LibraryPage already carries, plus the one thing a signed-out
 * app can usefully offer — the link out to music.youtube.com in a new tab.
 */
function SignInPrompt({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    // A modal (report §8): scrim, 14px card radius, fade with a slight zoom, 30px close circle.
    <div
      className="fixed inset-0 z-(--z-modal) grid animate-fade place-items-center bg-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-[min(360px,calc(100vw-32px))] animate-zoom flex-col rounded-[14px] bg-page shadow-glass"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in with YouTube"
      >
        <header className="flex items-center justify-between px-5 pt-[18px] pb-1">
          <h2 className="type-title-2-emphasized">Sign in with YouTube</h2>
          <button className="grid size-[30px] place-items-center rounded-full bg-[#333336] text-secondary" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <p className="px-5 type-body-tall text-secondary">
          BitChord uses the YouTube Music account this browser is signed in to. Sign in on music.youtube.com, then come back.
        </p>
        <div className="px-5 pt-4 pb-5">
          <a className={openMusic} href="https://music.youtube.com" target="_blank" rel="noreferrer">
            Open music.youtube.com
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
