import {
  BRIDGE_PROTOCOL,
  errorResponse,
  okResponse,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
  type Capability,
  type DiscordState,
  type HttpRequest,
  type HttpResponse,
  type SpotifyAuthState,
  type YtAuthState,
  type YtFetchParams,
} from './contract.js';
import { RelayCache } from './cache.js';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS } from './limits.js';
import { CHROMIUM_USER_AGENT, isAddonUrl, isLyricOrigin, LYRIC_ORIGINS, sanitiseHeaders, ytImpersonationFor } from './hosts.js';
import { serialise, toBytes } from './serialise.js';
import { VERSION } from './version.js';

/**
 * The relay's method dispatch: the same shape as the extension's dispatcher
 * (`web/extension/entrypoints/background.ts`) — protocol check first, then a
 * method switch, with a `failure()` mapping errors onto the bridge's error
 * codes — answering the anonymous subset relay.md's table lists. Everything
 * identity-holding is answered as signed out or unsupported: the relay holds
 * no credentials, by design.
 */

/** What `ping` answers (relay.md): the anonymous subset, nothing identity-shaped. */
export const RELAY_CAPABILITIES: Capability[] = ['yt', 'addon', 'lyrics'];

/**
 * The relay holds no identity and watches no cookies, so the identity methods
 * always answer these static shapes. The UI already renders "Needs the
 * extension" for a transport that lacks the matching capability.
 */
const SIGNED_OUT_YT: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

const SIGNED_OUT_SPOTIFY: SpotifyAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  user: null,
  problem: null,
};

const DISCORD_OFF: DiscordState = {
  available: false,
  connected: false,
  enabled: false,
  user: null,
  gateway: 'off',
  problem: null,
};

/** What a dispatch needs from the world: the upstream fetch and the cache. Injected so tests run without a network. */
export interface DispatchDeps {
  fetchImpl: typeof globalThis.fetch;
  cache: RelayCache;
}

/** The server's own wiring. */
export const dispatchDeps: DispatchDeps = { fetchImpl: fetch, cache: new RelayCache() };

/** One proxied request, prepared and validated. */
interface Prepared {
  method: 'GET' | 'POST' | 'HEAD';
  url: URL;
  headers: Record<string, string>;
  body: BodyInit | undefined;
}

/**
 * Reads an HttpRequest out of untrusted params. Unlike the extension, whose
 * page is a typed partner, the relay answers anyone who posts to /bridge, so
 * the shape is checked before anything is fetched.
 */
function prepare(methodName: string, params: HttpRequest): Prepared {
  if (typeof params.url !== 'string' || !params.url) {
    throw Object.assign(new Error(`${methodName} needs a url`), { code: 'protocol' });
  }
  const method = params.method ?? 'GET';
  // The contract's HttpRequest vocabulary is GET, POST and HEAD; anything
  // else is not the page speaking, and the relay won't forward verbs it
  // can't vouch for.
  if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') {
    throw Object.assign(new Error(`The bridge speaks GET, POST and HEAD, not ${String(method)}`), { code: 'forbidden' });
  }
  const headers = sanitiseHeaders((params.headers ?? {}) as Record<string, string>);
  const body =
    params.body === undefined ? undefined : params.bodyEncoding === 'base64' ? toBytes(params.body) : params.body;
  // A bad url throws here and lands in failure() as a network error, as the extension's did.
  return { method, url: new URL(params.url), headers, body: body as BodyInit | undefined };
}

/** The allowlist's refusal, in the extension's words (ytFetch.ts's forbidden()). */
function forbidden(methodName: string, url: URL): Error {
  return Object.assign(new Error(`${methodName} doesn't serve ${url.origin}${url.pathname}`), { code: 'forbidden' });
}

/** Performs one upstream fetch and serialises its answer, capped and time-boxed. */
async function upstream(
  deps: DispatchDeps,
  url: URL,
  init: { method: Prepared['method']; headers: Record<string, string>; body: BodyInit | undefined },
): Promise<HttpResponse> {
  const response = await deps.fetchImpl(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    redirect: 'follow',
    // The relay holds no cookies; "omit" is that fact in the one vocabulary Node and the DOM share.
    credentials: 'omit',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  return serialise(response, MAX_RESPONSE_BYTES);
}

/**
 * Answers one bridge request. Never throws: every failure lands in the
 * envelope as a `BridgeResponse` error, exactly as the extension's
 * dispatcher does, so the page sees the code rather than a dropped call.
 */
export async function handle(request: BridgeRequest, deps: DispatchDeps): Promise<BridgeResponse> {
  if (request.protocol !== BRIDGE_PROTOCOL) {
    return errorResponse(
      request.id,
      'protocol',
      `The page speaks bridge protocol ${request.protocol}; this relay speaks ${BRIDGE_PROTOCOL}. Update whichever is older.`,
    );
  }
  try {
    switch (request.method) {
      case 'ping':
        return okResponse(request.id, {
          version: VERSION,
          protocol: BRIDGE_PROTOCOL,
          browser: 'server',
          capabilities: RELAY_CAPABILITIES,
        });
      case 'yt.fetch': {
        const params = (request.params ?? {}) as YtFetchParams;
        if (params.auth === true) {
          // relay.md's exact refusal: it points at the transport that can.
          return errorResponse(request.id, 'unauthenticated', "The relay can't sign YouTube requests. The extension can.");
        }
        const { method, url, headers, body } = prepare('yt.fetch', params);
        const impersonation = ytImpersonationFor(url);
        if (!impersonation) throw forbidden('yt.fetch', url);
        if (method === 'GET') {
          const cached = deps.cache.lookup('yt.fetch', url.href);
          if (cached) return okResponse(request.id, cached);
        }
        const response = await upstream(deps, url, {
          method,
          headers: { ...headers, ...impersonation, 'user-agent': CHROMIUM_USER_AGENT },
          body,
        });
        if (method === 'GET') deps.cache.store('yt.fetch', url.href, response);
        return okResponse(request.id, response);
      }
      case 'addon.fetch': {
        const params = (request.params ?? {}) as HttpRequest;
        const { method, url, headers, body } = prepare('addon.fetch', params);
        if (!isAddonUrl(url)) throw forbidden('addon.fetch', url);
        if (method === 'GET') {
          const cached = deps.cache.lookup('addon.fetch', url.href);
          if (cached) return okResponse(request.id, cached);
        }
        const response = await upstream(deps, url, {
          method,
          // No impersonation: addon servers are the user's own and see the relay as a browser.
          headers: { ...headers, 'user-agent': CHROMIUM_USER_AGENT },
          body,
        });
        if (method === 'GET') deps.cache.store('addon.fetch', url.href, response);
        return okResponse(request.id, response);
      }
      case 'lyrics.fetch': {
        const params = (request.params ?? {}) as HttpRequest;
        const { method, url, headers, body } = prepare('lyrics.fetch', params);
        if (!isLyricOrigin(url)) throw forbidden('lyrics.fetch', url);
        // No cache: relay.md caches only the yt and addon families, and lyric
        // answers are small enough to stay fresh. The extension's per-host
        // grants are not mirrored either — the relay needs none.
        const response = await upstream(deps, url, {
          method,
          headers: { ...headers, 'user-agent': CHROMIUM_USER_AGENT },
          body,
        });
        return okResponse(request.id, response);
      }
      case 'lyrics.permissions': {
        // The relay needs no grants, so the allowlist itself is the answer
        // (relay.md): of the origins the page asks about, the ones it serves.
        const origins = (request.params as { origins?: unknown } | null | undefined)?.origins;
        const requested = Array.isArray(origins) ? origins : [];
        const granted = requested.filter(
          (origin): origin is string => typeof origin === 'string' && (LYRIC_ORIGINS as readonly string[]).includes(origin),
        );
        return okResponse(request.id, { granted });
      }
      case 'lyrics.requestPermissions':
        // A no-op: there is no permission prompt on a server, so nothing to open.
        return okResponse(request.id, {});
      case 'yt.authState':
        return okResponse(request.id, SIGNED_OUT_YT);
      case 'spotify.authState':
        return okResponse(request.id, SIGNED_OUT_SPOTIFY);
      case 'discord.state':
        return okResponse(request.id, DISCORD_OFF);
      default:
        return errorResponse(
          request.id,
          'unsupported',
          `${request.method} isn't served by the relay; the BitChord extension serves it.`,
        );
    }
  } catch (error) {
    return failure(request.id, error);
  }
}

/**
 * The error-code mapping, mirroring background.ts's failure(). Two additions
 * a server needs: `protocol` and `network` pass through, because a request
 * whose params don't speak the contract, and the relay's own upstream timeout
 * and response cap, are failures the extension never had to name (its fetches
 * simply threw, and its page was a typed partner).
 */
function failure(id: string, error: unknown): BridgeResponse {
  const known = (error as { code?: string }).code;
  const code: BridgeErrorCode =
    known === 'forbidden' ||
    known === 'unauthenticated' ||
    known === 'permission' ||
    known === 'protocol' ||
    known === 'network'
      ? known
      : error instanceof TypeError
        ? 'network'
        : error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
          ? 'network'
          : 'internal';
  return errorResponse(id, code, error instanceof Error ? error.message : String(error));
}
