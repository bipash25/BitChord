import { APPLE_ORIGINS, useAppleAccess } from '@/data/apple/artistArt';
import { useAppleSettings } from '@/data/apple/motionArt';
import { useHostAccess } from '@/extension/useHostAccess';
import { LYRIC_EXTENSION_ORIGINS } from '@/lyrics/http';
import { openSpotifySignIn, useRefreshSpotifyAuth, useSpotifyDisconnect, useSpotifyAuth, type SpotifyAuthStatus } from '@/data/spotify/auth';
import { settingsUi } from './settingsStyles';

/** Allowed, or an Allow button that asks the transport for the hosts it can't reach yet. */
function HostAccessValue({ access, request }: ReturnType<typeof useHostAccess>) {
  const text = { checking: 'Checking…', unavailable: 'Unavailable', granted: 'Allowed', needed: 'Not allowed' }[access];
  return (
    <span className={settingsUi.value}>
      <span>{text}</span>
      {access === 'needed' && (
        <button className={settingsUi.inlineButton} onClick={request}>
          Allow
        </button>
      )}
    </span>
  );
}

/** The Apple Music section's access row: one grant covers artist art and animated artwork. */
export function AppleMusicIntegration() {
  return <HostAccessValue {...useAppleAccess()} />;
}

/** The Apple Music section's switches. Neither needs an Apple Music account. */
export function AppleMusicToggles() {
  const { artistArt, motion, setArtistArt, setMotion } = useAppleSettings();
  return (
    <>
      <Toggle
        label="Artist Art"
        detail="Artist pages take Apple Music’s photo, logo and colour."
        checked={artistArt}
        onChange={setArtistArt}
      />
      <Toggle
        label="Animated Artwork"
        detail="Apple Music’s moving covers in the full-screen player and on album pages. Not on metered connections or with reduced motion."
        checked={motion}
        onChange={setMotion}
      />
    </>
  );
}

/**
 * The lyric sources a page can't ask itself (KuGou, Musixmatch, Genius,
 * PaxSenix…), as in the Lyrics dialog. Apple's hosts are granted under Apple
 * Music, so they aren't asked for twice.
 */
const LYRIC_ONLY_ORIGINS = LYRIC_EXTENSION_ORIGINS.filter((o) => !APPLE_ORIGINS.includes(o));
export function LyricSourcesAccess() {
  return <HostAccessValue {...useHostAccess(LYRIC_ONLY_ORIGINS)} />;
}

/** The Spotify row's words and button (SpotifyLibraryScreen's states): the page's own PKCE session, nothing to do with the relay. */
export function SpotifyIntegration() {
  const auth = useSpotifyAuth();
  const disconnect = useSpotifyDisconnect();
  const retry = useRefreshSpotifyAuth();
  if (auth.state !== 'ready') return <span className={settingsUi.value}>{spotifyText(auth)}</span>;
  const { signedIn, problem } = auth.auth;
  const action = signedIn
    ? { label: 'Disconnect', run: () => disconnect.mutate() }
    : problem
      ? { label: 'Retry', run: () => retry.mutate() }
      : { label: 'Sign In', run: openSpotifySignIn };
  return (
    <span className={settingsUi.value}>
      <span title={problem ?? undefined}>{spotifyText(auth)}</span>
      <button className={settingsUi.inlineButton} onClick={action.run} disabled={disconnect.isPending || retry.isPending}>
        {action.label}
      </button>
    </span>
  );
}

function spotifyText(auth: SpotifyAuthStatus): string {
  if (auth.state === 'checking') return 'Checking…';
  if (auth.state === 'unconfigured') return 'Not configured on this deployment';
  const { signedIn, user, problem } = auth.auth;
  if (!signedIn) return problem ? 'Couldn’t sign in' : 'Not signed in';
  return user ? `Signed in as ${user.name}` : (problem ?? 'Signed in');
}

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={settingsUi.controlRow}>
      <span className={settingsUi.rowText}>
        <span>{label}</span>
        {detail && <span className={settingsUi.rowDetail}>{detail}</span>}
      </span>
      <input type="checkbox" className={settingsUi.switch} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}
