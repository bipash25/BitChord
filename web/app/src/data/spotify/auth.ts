import { useMutation, useQuery } from '@tanstack/react-query';
import { config } from '@/config';
import { queryClient } from '@/lib/queryClient';

/**
 * Spotify sign-in, in the page (relay.md phase 2): the official Web API's
 * Authorization Code flow with PKCE, so no client secret exists anywhere —
 * not in this bundle, not on the relay, which is not involved at all:
 * accounts.spotify.com and api.spotify.com both answer browser origins
 * directly. The token pair lives in this browser's localStorage and nowhere
 * else. Canvas, which needed the unofficial `sp_dc` machinery, went with the
 * extension; these scopes are strictly the read-only library ones.
 */

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
/** Read-only: the profile, the library's playlists, and Liked Songs. */
const SCOPES = ['user-read-private', 'playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];

/** Where the token pair lives. Only this module reads it; nothing leaves the browser. */
const TOKENS_KEY = 'bitchord:spotify-auth';
/** The PKCE verifier and the CSRF state, kept for exactly the round trip to Spotify's consent screen and back. */
const HANDSHAKE_KEY = 'bitchord:spotify-handshake';

export const spotifyAuthQueryKey = ['spotify', 'auth'] as const;

type Json = Record<string, unknown>;

/** The page's Spotify session: names only, never the tokens themselves. */
export interface SpotifyAuthState {
  /** A working token pair is held: requests to api.spotify.com will be made as the user. */
  signedIn: boolean;
  user: { name: string; avatarUrl: string | null } | null;
  /** Sign-in was refused or tokens are held but Spotify wouldn't answer: what went wrong, for display. */
  problem: string | null;
}

const SIGNED_OUT: SpotifyAuthState = { signedIn: false, user: null, problem: null };

/** A token pair that no longer works at all — the grant is gone, so the session is. */
class SpotifyGrantError extends Error {}

// ---- Storage -----------------------------------------------------------------------

// A private window (or a paranoid setting) can throw on every access, and a
// corrupted row reads as no session rather than a broken page.
function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* nothing can be stored; sign-in will simply not persist */
  }
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* equally fine */
  }
}

interface Tokens {
  accessToken: string;
  /** Spotify may omit it on refresh; then the previous one stays valid. */
  refreshToken: string | null;
  /** Epoch ms at which the access token stops working. */
  expiresAt: number;
}

const readTokens = (): Tokens | null => readJson<Tokens>(localStorage, TOKENS_KEY);
const storeTokens = (tokens: Tokens) => writeJson(localStorage, TOKENS_KEY, tokens);

// ---- The PKCE handshake --------------------------------------------------------------

/** Where Spotify sends the user back to: this origin's Spotify page, whose route already exists. */
function redirectUri(): string {
  return `${location.origin}/spotify`;
}

/** base64url, unpadded: the encoding PKCE challenges and OAuth states are written in. */
function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

interface Handshake {
  verifier: string;
  state: string;
}

/**
 * Starts sign-in: build the challenge, remember the verifier, and leave for
 * Spotify's consent screen. The browser comes back to `redirectUri()` with a
 * one-time code, and the SPA boots again into the same auth read below.
 */
export async function beginSpotifySignIn(): Promise<void> {
  if (!config.spotifyClientId) return;
  // crypto.subtle needs a secure context — localhost and https have it, an
  // http LAN address doesn't; nothing can be signed in from there.
  if (!crypto.subtle) throw new Error('Spotify sign-in needs a secure context (https or localhost).');
  const handshake: Handshake = {
    verifier: b64url(crypto.getRandomValues(new Uint8Array(48))),
    state: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  // sessionStorage, per tab: the return happens in this tab, and the verifier
  // must not outlive the single exchange it authorises.
  writeJson(sessionStorage, HANDSHAKE_KEY, handshake);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(handshake.verifier))));
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.spotifyClientId);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', handshake.state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  location.assign(url);
}

/** One POST to the token endpoint, form-encoded as Spotify's Web API wants it. */
async function tokenRequest(body: URLSearchParams): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const parsed = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string }
    | null;
  if (parsed?.access_token) {
    return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token ?? null, expiresIn: parsed.expires_in ?? 3600 };
  }
  const reason = parsed?.error_description ?? parsed?.error ?? `HTTP ${response.status}`;
  // 400/401 is Spotify refusing the grant itself (invalid_grant and friends);
  // anything else is a transient answer the caller may retry.
  if (response.status === 400 || response.status === 401) throw new SpotifyGrantError(`Spotify refused sign-in: ${reason}`);
  throw new Error(`Spotify's token endpoint answered ${response.status}`);
}

/**
 * Finishes sign-in if this load is the return from Spotify's consent screen
 * (`?code=` or `?error=` on this origin): spends the code for a token pair and
 * cleans the URL, so a reload or a shared link can't try the single-use code
 * again. Returns the problem to show when the handshake failed, else null.
 */
async function completeHandshake(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');
  if (!code && !error) return null;
  history.replaceState(null, '', location.pathname);
  const expected = readJson<Handshake>(sessionStorage, HANDSHAKE_KEY);
  remove(sessionStorage, HANDSHAKE_KEY);
  if (error) return 'Spotify sign-in was cancelled.';
  if (!code || !expected || !state || state !== expected.state) return 'Spotify sign-in didn’t complete correctly. Try again.';
  try {
    const granted = await tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: config.spotifyClientId,
        code_verifier: expected.verifier,
      }),
    );
    storeTokens({ accessToken: granted.accessToken, refreshToken: granted.refreshToken, expiresAt: Date.now() + granted.expiresIn * 1000 });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

// ---- Token use ----------------------------------------------------------------------

/** One refresh at a time: every request that lands during one shares it. */
let refreshing: Promise<Tokens> | null = null;

async function forceRefresh(): Promise<Tokens> {
  const tokens = readTokens();
  if (!tokens) throw new SpotifyGrantError('Not signed in to Spotify.');
  if (!tokens.refreshToken) throw new SpotifyGrantError('Spotify sign-in expired. Sign in again.');
  refreshing ??= tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: config.spotifyClientId }))
    .then((granted) => {
      // A refresh may come back without a refresh_token; the old one stays valid.
      const merged: Tokens = {
        accessToken: granted.accessToken,
        refreshToken: granted.refreshToken ?? tokens.refreshToken,
        expiresAt: Date.now() + granted.expiresIn * 1000,
      };
      storeTokens(merged);
      return merged;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

/** A usable access token, refreshing first when the held one is about to lapse. */
async function accessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new SpotifyGrantError('Not signed in to Spotify.');
  // The 30 s margin covers the flight time of the call the token is for.
  if (tokens.expiresAt - 30_000 > Date.now()) return tokens.accessToken;
  return (await forceRefresh()).accessToken;
}

/**
 * One GET from api.spotify.com as the signed-in user. The API is CORS-enabled
 * for browsers, so this is a plain fetch — the relay is not involved. A 401
 * earns exactly one forced refresh and one retry: expiring between the read
 * and the call is normal, while a 401 on a fresh token means the grant is
 * gone, which signs the session out.
 */
export async function spotifyGet(path: string, params: Record<string, string | number> = {}): Promise<Json> {
  const url = new URL(`https://api.spotify.com/v1${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const call = (token: string) => fetch(url, { headers: { authorization: `Bearer ${token}` } });
  let response = await call(await accessToken());
  if (response.status === 401) {
    let token: string;
    try {
      token = (await forceRefresh()).accessToken;
    } catch (error) {
      if (error instanceof SpotifyGrantError) forget();
      throw error;
    }
    response = await call(token);
    if (response.status === 401) {
      forget();
      throw new SpotifyGrantError('Spotify refused the sign-in. Sign in again.');
    }
  }
  if (response.status === 429) throw new Error('Spotify is rate-limiting this browser. Try again shortly.');
  if (!response.ok) throw new Error(`Spotify answered HTTP ${response.status}`);
  return (await response.json().catch(() => null)) as Json;
}

// ---- The state the UI reads ---------------------------------------------------------

/** The signed-in user's name and picture (`/v1/me`), smallest image that's still an avatar. */
async function profileOf(): Promise<SpotifyAuthState['user']> {
  const me = await spotifyGet('/me');
  const name = (typeof me.display_name === 'string' && me.display_name.trim()) || (typeof me.id === 'string' ? me.id : '') || 'Spotify';
  const sources = (Array.isArray(me.images) ? me.images : [])
    .map((s) => ({ url: typeof s?.url === 'string' ? s.url : '', width: typeof s?.width === 'number' ? s.width : 0 }))
    .filter((s) => !!s.url)
    .sort((a, b) => a.width - b.width);
  return { name, avatarUrl: (sources.find((s) => s.width >= 64) ?? sources.at(-1))?.url ?? null };
}

/** The whole session as the UI should see it: the handshake first, then the held tokens. */
async function readAuth(): Promise<SpotifyAuthState> {
  if (!config.spotifyClientId) return SIGNED_OUT;
  const problem = await completeHandshake();
  if (!readTokens()) return problem ? { ...SIGNED_OUT, problem } : SIGNED_OUT;
  try {
    return { signedIn: true, user: await profileOf(), problem: null };
  } catch (error) {
    // A 401 even after a forced refresh has already forgotten the tokens (spotifyGet):
    // that is a real sign-out, not a problem to display.
    if (!readTokens()) return SIGNED_OUT;
    return { signedIn: true, user: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Takes in a state: a changed identity drops every list read as the old one. */
function applyAuth(state: SpotifyAuthState): void {
  const before = queryClient.getQueryData<SpotifyAuthState>(spotifyAuthQueryKey);
  queryClient.setQueryData(spotifyAuthQueryKey, state);
  if (before && (before.signedIn !== state.signedIn || before.user?.name !== state.user?.name)) {
    void queryClient.resetQueries({ queryKey: ['spotify', 'data'] });
  }
}

/** The session is gone: forget it here, and drop everything read as that account. */
function forget(): void {
  remove(localStorage, TOKENS_KEY);
  applyAuth(SIGNED_OUT);
}

export type SpotifyAuthStatus =
  | { state: 'checking' }
  /** No client id is configured: Spotify is simply not set up on this deployment. */
  | { state: 'unconfigured' }
  | { state: 'ready'; auth: SpotifyAuthState };

export function useSpotifyAuth(): SpotifyAuthStatus {
  const query = useQuery({
    queryKey: spotifyAuthQueryKey,
    queryFn: readAuth,
    // Without a client id there is nothing to ask about, and nothing to fail.
    enabled: !!config.spotifyClientId,
    staleTime: 60_000,
    // Also refreshes a token that lapsed while the tab was in the background.
    refetchOnWindowFocus: true,
    retry: 1,
  });
  if (!config.spotifyClientId) return { state: 'unconfigured' };
  if (query.isPending) return { state: 'checking' };
  return { state: 'ready', auth: query.data ?? SIGNED_OUT };
}

/** True once requests to api.spotify.com will be made as the user. */
export function useSpotifySignedIn(): boolean {
  const status = useSpotifyAuth();
  return status.state === 'ready' && status.auth.signedIn;
}

/** Leaves for Spotify's consent screen; the browser comes back to the Spotify page with a code. */
export function openSpotifySignIn(): void {
  beginSpotifySignIn().catch((error) => console.warn('BitChord: Spotify sign-in could not start', error));
}

/**
 * Disconnects. Spotify publishes no token-revocation endpoint — discarding the
 * token pair is the remedy its own docs give for a dead grant — so this
 * forgets the session locally, and the user can remove the grant itself at
 * spotify.com/account/apps if they want it gone from Spotify's side too.
 */
export function useSpotifyDisconnect() {
  return useMutation({ mutationFn: async () => forget() });
}

/** Re-reads the session: the "Try Again" for a sign-in that Spotify wouldn't answer. */
export function useRefreshSpotifyAuth() {
  return useMutation({ mutationFn: async () => applyAuth(await readAuth()) });
}
