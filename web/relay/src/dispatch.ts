import {
  BRIDGE_PROTOCOL,
  errorResponse,
  okResponse,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeResponse,
  type Capability,
  type HttpRequest,
  type HttpResponse,
  type YtAuthState,
  type YtFetchParams,
} from './contract.js';
import { RelayCache } from './cache.js';
import type { FallbackCredential } from './fallback.js';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS } from './limits.js';
import { CHROMIUM_USER_AGENT, isAddonUrl, isInnerTubeUrl, isLyricOrigin, LYRIC_ORIGINS, sanitiseHeaders, ytImpersonationFor } from './hosts.js';
import { serialise, toBytes } from './serialise.js';
import { VERSION } from './version.js';

/**
 * The relay's method dispatch — protocol check first, then a method switch,
 * with a `failure()` mapping errors onto the bridge's error codes — answering
 * the subset relay.md's table lists. Everything identity-holding is answered
 * as signed out or unsupported. The one deliberate exception
 * (`web/docs/private-deployment.md`) is invisible: when the operator has
 * loaded a fallback credential, the relay signs anonymous InnerTube calls
 * with it and tells the page nothing — no capability, no identity, no hint
 * that a session exists (the owner's decision, 2026-11-21). The credential
 * itself never crosses back to the page in any form.
 */

/** What `ping` answers (relay.md): the anonymous subset — fallback or not, since the credential is invisible. */
export const RELAY_CAPABILITIES: Capability[] = ['yt', 'addon', 'lyrics'];

/**
 * The identity methods always answer this static shape, fallback or not: the
 * fallback is invisible (the owner's decision, 2026-11-21), so the page is
 * never told a session exists and renders its ordinary signed-out states
 * while the relay signs playback silently. The operator's health check for
 * the credential is the probe, not this answer.
 */
const SIGNED_OUT_YT: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

/** What a dispatch needs from the world: the upstream fetch, the cache, and the operator's fallback credential (or null). Injected so tests run without a network. */
export interface DispatchDeps {
  fetchImpl: typeof globalThis.fetch;
  cache: RelayCache;
  /**
   * The private deployment's fallback credential (`web/docs/private-deployment.md`),
   * loaded from `RELAY_FALLBACK_COOKIES_FILE` at startup by index.ts. Null on
   * a public relay, which stays anonymous-only.
   */
  fallback: FallbackCredential | null;
}

/** The server's own wiring; index.ts spreads the loaded fallback into it. */
export const dispatchDeps: DispatchDeps = { fetchImpl: fetch, cache: new RelayCache(), fallback: null };

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
function prepare(
  methodName: string,
  params: HttpRequest,
  options: { forwardAuthorization?: boolean } = {},
): Prepared {
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
  const headers = sanitiseHeaders((params.headers ?? {}) as Record<string, string>, options);
  const body =
    params.body === undefined ? undefined : params.bodyEncoding === 'base64' ? toBytes(params.body) : params.body;
  // A bad url throws here and lands in failure() as a network error.
  return { method, url: new URL(params.url), headers, body: body as BodyInit | undefined };
}

/** The allowlist's refusal, naming exactly what was asked for. */
function forbidden(methodName: string, url: URL): Error {
  return Object.assign(new Error(`${methodName} doesn't serve ${url.origin}${url.pathname}`), { code: 'forbidden' });
}

/**
 * InnerTube clients that take no session signals at all — InnerTubeX sends
 * nothing for VISIONOS, and even the extension stripped headers off
 * `c=VISIONOS` media URLs. Attaching the fallback's cookie and SAPISIDHASH to
 * such a client's call makes YouTube refuse the whole request with a 400
 * (measured: the probe's VISIONOS player call through a fallback-loaded relay,
 * 2026-11-21), so their calls stay anonymous and the client walk falls through
 * to a web client the fallback does sign.
 */
const UNSIGNED_CLIENTS = new Set(['VISIONOS']);

/**
 * The `context.client.clientName` of an InnerTube POST body, when the body is
 * JSON that carries one. Untrusted input: anything unparseable simply has no
 * client name, and an absent name signs (the web clients the fallback exists
 * for all say who they are).
 */
function bodyClientName(body: BodyInit | undefined): string | null {
  if (typeof body !== 'string' || !body.startsWith('{')) return null;
  try {
    const client = (JSON.parse(body) as { context?: { client?: { clientName?: unknown } } }).context?.client?.clientName;
    return typeof client === 'string' ? client : null;
  } catch {
    return null;
  }
}

/**
 * Performs one upstream fetch and serialises its answer, capped and time-boxed.
 * When [absorb] is the fallback this call was signed with, YouTube's Set-Cookie
 * rotations are collected before serialisation flattens duplicate headers and
 * merged into the live jar; either way, `set-cookie` never reaches the page —
 * the rotations belong to the credential, and the rest is session material no
 * caller has business seeing through the envelope.
 */
async function upstream(
  deps: DispatchDeps,
  url: URL,
  init: { method: Prepared['method']; headers: Record<string, string>; body: BodyInit | undefined },
  absorb?: FallbackCredential | null,
): Promise<HttpResponse> {
  const response = await deps.fetchImpl(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    redirect: 'follow',
    // No ambient cookie store rides along: "omit" says so in the one vocabulary
    // Node and the DOM share. The fallback's jar, when there is one, is attached
    // explicitly in init.headers — never left to the fetch's own cookie handling.
    credentials: 'omit',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const rotations = (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (absorb && rotations.length) absorb.absorbSetCookies(rotations);
  const serialised = await serialise(response, MAX_RESPONSE_BYTES);
  delete serialised.headers['set-cookie'];
  return serialised;
}

/**
 * Answers one bridge request. Never throws: every failure lands in the
 * envelope as a `BridgeResponse` error, so the page sees the code rather
 * than a dropped call.
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
          // The fallback is invisible by the owner's decision (2026-11-21):
          // it signs the calls silently, and `yt.auth` is never reported, so
          // the page's account machinery renders its ordinary signed-out
          // states while playback just works.
          capabilities: RELAY_CAPABILITIES,
        });
      case 'yt.fetch': {
        const params = (request.params ?? {}) as YtFetchParams;
        if (params.auth === true && !deps.fallback) {
          // The refusal stands when there is no fallback: the relay holds no
          // YouTube session and won't pretend to sign one. With a fallback
          // loaded, an auth call is served exactly like an anonymous one —
          // signed with the account the relay holds, because the page has no
          // credential of its own to add (private-deployment.md: "auth: true
          // stops answering unauthenticated").
          return errorResponse(
            request.id,
            'unauthenticated',
            "The relay can't sign YouTube requests; its operator can set RELAY_FALLBACK_COOKIES_FILE to a shared account.",
          );
        }
        // A page-held Authorization is forwarded untouched (see hosts.ts), so
        // the caller bringing its own credential keeps it: the fallback signs
        // only the calls with none.
        const { method, url, headers, body } = prepare('yt.fetch', params, { forwardAuthorization: true });
        const impersonation = ytImpersonationFor(url);
        if (!impersonation) throw forbidden('yt.fetch', url);
        const pageAuthorized = headers.authorization !== undefined;
        const signOrigin = isInnerTubeUrl(url) ? impersonation.origin : undefined;
        // UNSIGNED_CLIENTS keep their calls anonymous even under a fallback:
        // their requests malformed with a session attached are refused outright.
        const unsignedClient = UNSIGNED_CLIENTS.has(bodyClientName(body) ?? '');
        const signed =
          deps.fallback && signOrigin && !pageAuthorized && !unsignedClient
            ? deps.fallback.sign(signOrigin, Math.floor(Date.now() / 1000))
            : null;
        // The credential must never become a cache key (hygiene), so the key
        // cannot tell the fallback's answers from a page credential's; calls
        // carrying one therefore bypass the shared cache in both directions.
        const cacheable = method === 'GET' && !pageAuthorized;
        if (cacheable) {
          const cached = deps.cache.lookup('yt.fetch', url.href);
          if (cached) return okResponse(request.id, cached);
        }
        const response = await upstream(
          deps,
          url,
          {
            method,
            headers: { ...headers, ...impersonation, ...(signed ?? {}), 'user-agent': CHROMIUM_USER_AGENT },
            body,
          },
          // The call's rotations belong to the credential that signed it.
          signed ? deps.fallback : undefined,
        );
        if (cacheable) deps.cache.store('yt.fetch', url.href, response);
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
        // answers are small enough to stay fresh. Per-host grants are not
        // mirrored either — the relay needs none.
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
      case 'yt.authState': {
        // Always the static signed-out answer, fallback or not: the
        // credential is invisible (the owner's decision, 2026-11-21) — it
        // signs silently, and the page is never told a session exists, so no
        // name, avatar or email of the shared account can surface anywhere.
        // The operator's health check is the probe, not this answer.
        return okResponse(request.id, SIGNED_OUT_YT);
      }
      default:
        // Includes the retired `spotify.*` family (relay.md phase 2): Spotify
        // is the page's own PKCE business now, so a stale page still gets a
        // clean `unsupported` rather than a hang.
        return errorResponse(request.id, 'unsupported', `${request.method} isn't served by the relay.`);
    }
  } catch (error) {
    return failure(request.id, error);
  }
}

/**
 * The error-code mapping. `protocol` and `network` pass through, because a
 * request whose params don't speak the contract, and the relay's own upstream
 * timeout and response cap, are failures the page never used to see from a
 * partner that threw and was caught.
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
