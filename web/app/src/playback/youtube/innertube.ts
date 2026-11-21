import type { Innertube, Types } from 'youtubei.js/web';
import type { Bridge } from '@bitchord/shared/bridge';
import { getBridge, getBridgeWhenSettled } from '@/extension/bridge';
import { ensureYtAuth, identityOf, noteMusicIdentity } from '@/extension/useYtAuth';
import { trackLog } from '../trackLog';

/**
 * The page's YouTube.js instance, created on first use (YouTube.js is large,
 * prompt §3). Its requests leave from the browser itself; the YouTube headers
 * come from the server relay's impersonation over `yt.fetch` (relay.md §3).
 */
let instance: Promise<Innertube> | null = null;

export function getInnertube(): Promise<Innertube> {
  instance ??= getBridgeWhenSettled()
    // The session's bootstrap (sw.js_data, the player script) races relay
    // detection on load — the home feed starts both at once — so wait for
    // the first answer before building it. Per-request, sessionFetch re-reads
    // the bridge: the relay may have answered only meanwhile.
    .then(() => create())
    .catch((error: unknown) => {
      instance = null;
      throw error;
    });
  return instance;
}

/**
 * A second instance for signed-in requests (prompt §5.3). Its InnerTube calls
 * go through the relay (`yt.fetch` with `auth`), which adds the user's
 * session; everything else (the session bootstrap, the player script) loads
 * like the anonymous instance's. The page never holds a cookie, so YouTube.js
 * is told it is signed in rather than given one.
 */
let signedInstance: Promise<Innertube> | null = null;

export function getSignedInnertube(): Promise<Innertube> {
  signedInstance ??= create(signedFetch).then(
    (yt) => {
      // Lifts YouTube.js's "must be signed in" checks (library pages). With
      // no cookie and no OAuth token it adds no credentials of its own.
      yt.session.logged_in = true;
      return yt;
    },
    (error: unknown) => {
      signedInstance = null;
      throw error;
    },
  );
  return signedInstance;
}

/** The instance browse requests should use: signed in when the user is, anonymous otherwise. */
export async function getMusicClient(): Promise<Innertube> {
  const auth = await ensureYtAuth().catch(() => null);
  // A failed auth read browses anonymously, and says so, so the answer that
  // does come later reloads what was read meanwhile (useYtAuth.adopt).
  noteMusicIdentity(auth ? identityOf(auth) : 'anonymous');
  return auth?.signedIn ? getSignedInnertube() : getInnertube();
}

const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'www.youtube.com', 'youtube.com']);

/** Headers a page may send without triggering a CORS preflight. */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language']);

/**
 * youtubei answers CORS preflights with 400 (measured; web/fixtures/README.md),
 * so InnerTube calls must be "simple" requests: a text/plain body and no
 * custom headers. youtubei parses the JSON body regardless of the declared
 * type, and everything the dropped headers carried (client name and version,
 * visitor data) is also in the body's `context.client`. Origin, Referer and
 * X-Origin are added by the transport that performs the request.
 */
async function simpleRequestFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());

  if (!YOUTUBE_HOSTS.has(url.hostname) || url.pathname.startsWith('/api/jnn/')) {
    return fetch(input, init);
  }

  const method = init?.method ?? request?.method ?? 'GET';
  const source = new Headers(init?.headers ?? request?.headers);
  const headers = new Headers();
  source.forEach((value, key) => {
    if (SAFELISTED.has(key.toLowerCase())) headers.set(key, value);
  });

  let body: BodyInit | null | undefined = init?.body;
  if (body === undefined && request && method !== 'GET' && method !== 'HEAD') {
    body = await request.text();
  }
  if (body != null) headers.set('Content-Type', 'text/plain;charset=UTF-8');

  return fetch(url, {
    method,
    headers,
    body: body ?? null,
    signal: init?.signal ?? request?.signal ?? null,
    // Anonymous: the user's YouTube cookies never ride along on page requests.
    credentials: 'omit',
  });
}

function isInnertubeCall(url: URL): boolean {
  return (url.hostname === 'music.youtube.com' || url.hostname === 'www.youtube.com') && url.pathname.startsWith('/youtubei/');
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * The session's fetch when the server relay is the transport (relay.md §3):
 * every YouTube-host request — InnerTube calls, `sw.js_data`, the player
 * script — travels as a bridge `yt.fetch`, which the relay performs with the
 * YouTube headers a page isn't allowed to set and no CORS in the way. The
 * text/plain "simple request" trick above only exists to dodge preflights on
 * the direct path, so through the relay the session's own headers go along
 * untouched (the relay drops the credential-shaped ones itself, relay.md
 * "The contract").
 */
async function relayFetch(input: RequestInfo | URL, init: RequestInit | undefined, bridge: Bridge): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());
  // Only YouTube hosts travel through the relay: everything else the session
  // touches is still fetched by the page, exactly as before.
  if (!YOUTUBE_HOSTS.has(url.hostname)) return fetch(input, init);

  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'HEAD';
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? request?.headers).forEach((value, key) => (headers[key] = value));
  let body = init?.body ?? undefined;
  if (body === undefined && request && method !== 'GET' && method !== 'HEAD') body = await request.text();
  // The session's bodies are JSON text; a browser can't set the forbidden
  // headers (Referer, Cookie, User-Agent) anyway, so text is all there is.
  if (body != null && typeof body !== 'string') body = await new Response(body).text();

  const response = await bridge.call(
    'yt.fetch',
    {
      url: url.toString(),
      method,
      ...(Object.keys(headers).length > 0 && { headers }),
      ...(body != null && { body }),
    },
    { ...(init?.signal && { signal: init.signal }) },
  );
  const payload = response.bodyEncoding === 'base64' ? decodeBase64(response.body) : response.body;
  return new Response(response.status === 204 || response.status === 304 ? null : payload, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * The fetch YouTube.js's anonymous session uses: the relay when the relay is
 * the transport, the direct simple-request path otherwise. The transport is
 * re-read on every request — the detection query can settle after the session
 * has started building (warm() races them), and the session, once created, is
 * reused for the page's lifetime.
 */
async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const bridge = getBridge();
  if (bridge?.transport === 'server') return relayFetch(input, init, bridge);
  return simpleRequestFetch(input, init);
}

/**
 * InnerTube calls through the relay, signed as the chosen channel; the rest
 * as the anonymous session's own fetch. That delegate matters in relay mode:
 * the bootstrap and player-script URLs (`sw.js_data`, `iframe_api`,
 * `/s/player/*`) are not page-readable directly — a browser fetch of them
 * CORS-fails (relay.md's measurements), which is the whole reason the
 * anonymous session routes them through the relay. Signed-in requests used
 * to take the direct path here because the extension's rules made it work;
 * with the relay as the transport the session bootstrap must travel the same
 * way whether the instance is signed or not.
 */
async function signedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : input.toString());
  if (!isInnertubeCall(url)) return sessionFetch(input, init);

  const bridge = getBridge();
  if (!bridge) throw new Error('Signed-in requests need the server relay, which didn’t answer');
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? request?.headers).forEach((value, key) => (headers[key] = value));
  let body = init?.body ?? undefined;
  if (body === undefined && request && method !== 'GET') body = await request.text();
  if (body != null && typeof body !== 'string') body = await new Response(body).text();

  const response = await bridge.call(
    'yt.fetch',
    { url: url.toString(), method, headers, ...(typeof body === 'string' && { body }), auth: true },
    { ...(init?.signal && { signal: init.signal }) },
  );
  const payload = response.bodyEncoding === 'base64' ? decodeBase64(response.body) : response.body;
  return new Response(response.status === 204 || response.status === 304 ? null : payload, {
    status: response.status,
    headers: response.headers,
  });
}

async function isFirstRun(): Promise<boolean> {
  try {
    const databases = await indexedDB.databases();
    return !databases.some((db) => db.name === 'youtubei.js');
  } catch {
    return true;
  }
}

async function create(fetch: typeof globalThis.fetch = sessionFetch): Promise<Innertube> {
  const started = performance.now();
  const { Innertube, Platform, UniversalCache } = await import('youtubei.js/web');

  // Runs the player's signature and n-parameter functions, which YouTube.js
  // extracts from YouTube's player script (as Kira does).
  Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
    const properties: string[] = [];
    if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
    if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
    return new Function(`${data.output}\nreturn { ${properties.join(', ')} }`)();
  };

  const firstRun = await isFirstRun();
  try {
    const yt = await Innertube.create({
      cache: new UniversalCache(true),
      fetch,
      retrieve_player: true,
    });
    const client = yt.session.context.client;
    trackLog.i(
      `InnerTube ready in ${Math.round(performance.now() - started)}ms ` +
        `(${client.clientName} ${client.clientVersion}, player ${yt.session.player?.player_id ?? 'none'})`,
    );
    return yt;
  } catch (error) {
    // YouTube.js falls back to a locally generated session when /sw.js_data
    // fails on the very first run, and those sessions fail playback later.
    // Dropping its cache makes the next start retry for real (Kira does this).
    if (firstRun) indexedDB.deleteDatabase('youtubei.js');
    trackLog.e(`InnerTube failed to start: ${String(error)}`);
    throw error;
  }
}
