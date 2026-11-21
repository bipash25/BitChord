import { useState } from 'react';
import { useYtAuth } from '@/extension/useYtAuth';

// The signed-out pill: Apple's red "Sign In" (report §1, .navigation__native-cta).
const pill =
  'self-start rounded-[16px] bg-key px-3.5 py-[5px] type-[600_13px/18px] text-white hover:brightness-[1.08]';

/**
 * The sidebar's account control. The relay is the only transport, and its one
 * session is the fallback account (web/docs/private-deployment.md): a
 * throwaway the relay's operator holds, whose cookie jar signs playback — and
 * the library, history and likes with it — for listeners without a session of
 * their own. The browser itself holds nothing (`browserSignedIn` false), and
 * the relay never reads the account's identity (the corrected invisibility
 * ruling, 2026-11-22), so there is no name or avatar to show: where one would
 * render, the control is the sign-in prompt instead.
 *
 * The prompt is presentation only — the extension that used to notice a
 * Google sign-in is gone, so there is no sign-in this page could complete
 * (relay.md phase 2: the TV OAuth bearer authenticates and opens nothing).
 * Tapping it says so, in one honest line, rather than sending anyone to a
 * form that would connect nothing.
 */
export function AccountButton() {
  const status = useYtAuth();
  const [open, setOpen] = useState(false);

  if (status.state !== 'ready') return null;
  const { auth } = status;

  // The relay's session: functional but anonymous. The features it provides
  // are live; the account behind them is not shown. Without one the relay is
  // anonymous-only, and the same honest prompt stands in either way.
  const detail = auth.signedIn
    ? 'BitChord on the web plays and saves through the server’s shared YouTube account — library, likes and history all work on it. There’s no personal sign-in here.'
    : 'The server’s relay has no shared account configured, so nothing is playing as an account. There’s no personal sign-in here.';
  return (
    <div>
      <button className={pill} aria-expanded={open} onClick={() => setOpen((now) => !now)}>
        {auth.signedIn ? 'Sign in with YouTube' : 'Sign In'}
      </button>
      {open && <p className="mt-2 ps-1 type-callout text-secondary">{detail}</p>}
    </div>
  );
}
