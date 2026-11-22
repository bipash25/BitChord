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
import { CHROMIUM_USER_AGENT, isAddonUrl, isInnerTubeUrl, isLyricOrigin, isStatsUrl, LYRIC_ORIGINS, sanitiseHeaders, ytImpersonationFor } from './hosts.js';
import { serialise, toBytes } from './serialise.js';
import { readUserIdentity, UserCredential } from './userjar.js';
import { VERSION } from './version.js';

/**
 * The relay's method dispatch — protocol check first, then a method switch,
 * with a `failure()` mapping errors onto the bridge's error codes — answering
 * the subset relay.md's table lists. Identity-holding methods beyond
 * `yt.authState` (channel switching, connect) stay unsupported: the relay
 * chooses no session for anyone, and connecting is the page's business — its
 * own jar, held in its browser and attached per call (below).
 *
 * Two credentials can sign here, and precedence is fixed: the visitor's own
 * jar (the `x-bitchord-user-jar` header, private-deployment.md 2026-11-22)
 * outranks the fallback wherever both could apply — their calls are theirs,
 * their library, their history — and the fallback covers everyone else:
 * signed calls, the library, history, likes, fully live, while the throwaway
 * account itself stays anonymous (the owner's corrected decision, 2026-11-22)
 * — no name, avatar, email or handle of it is ever read or returned, so no
 * screen can show one. When the request carries a usable user jar,
 * `yt.authState` reads and answers the visitor's own identity instead — the
 * one identity allowed to cross, because it is theirs. Neither credential
 * ever crosses back to the page in any form.
 */

/**
 * What `ping` answers (relay.md) on a relay with no fallback credential: the
 * anonymous subset — nothing can be signed, so neither session capability is
 * claimed.
 */
export const RELAY_CAPABILITIES: Capability[] = ['yt', 'addon', 'lyrics'];

/**
 * The same answer with a fallback loaded: the session families are real now.
 * `yt.auth` because the relay signs `auth: true` calls with the fallback;
 * `yt.stats` because the playback-tracking pings the page's history
 * reporting sends are served the same signed way.
 */
export const FALLBACK_CAPABILITIES: Capability[] = ['yt', 'yt.auth', 'yt.stats', 'addon', 'lyrics'];

/**
 * What `yt.authState` answers when no fallback is configured: the page gets
 * its ordinary signed-out states, and every auth-gated flow stays off.
 */
const SIGNED_OUT_YT: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

/**
 * What `yt.authState` answers when a fallback credential is loaded: the
 * session is real and every signed flow works — library, history, likes,
 * the signed playback retry — so `signedIn` is true and the page's machinery
 * engages. But the account is the relay's throwaway, and the corrected
 * invisibility ruling (`web/docs/private-deployment.md`, 2026-11-22) is that
 * its identity never surfaces: no name, avatar, email or handle is read
 * anywhere (the identity-reading code is gone), so the answer carries an
 * `active` channel whose identity fields are empty — present because the
 * app keys its query-cache resets on the chosen identity's id, empty so the
 * UI renders its sign-in prompt where an account's own would have shown.
 * `browserSignedIn` stays false: the browser holds nothing; the relay does.
 * (The account_menu identity read exists for the *visitor's* jar —
 * `userjar.ts` — and only for it; the fallback's own identity stays
 * unread.)
 */
const SHARED_SESSION_YT: YtAuthState = {
  browserSignedIn: false,
  connected: true,
  signedIn: true,
  accounts: [],
  active: { id: 'relay-session', name: '', handle: null, avatarUrl: null, brand: false, authUser: '0' },
  problem: null,
};

/**
 * What `yt.authState` answers when the request carried a jar that holds no
 * YouTube session: signed out, with the problem saying what was wrong with
 * the paste — the connect flow shows that sentence, and the page's next read
 * drops the stored jar (useYtAuth) so features fall back undamaged.
 */
const NO_SESSION_YT: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem:
    'The cookies hold nothing YouTube can sign with — no SAPISID-family cookie (SAPISID, __Secure-3PAPISID, __Secure-1PAPISID). Export again from a signed-in browser.',
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

/**
 * What one request carries beyond its envelope: the visitor's own YouTube
 * jar, read from the `x-bitchord-user-jar` HTTP header by index.ts. Raw
 * cookies.txt / `Cookie:` line text, page-held and forwarded per call —
 * nothing is derived here, nothing is kept: the credential built from it
 * lives exactly as long as the request being answered.
 */
export interface RequestContext {
  userJar?: string;
}

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
  options: { forwardAuthorization?: boolean; forwardVisitorId?: boolean } = {},
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

/**
 * The stats-ping family, decided from the raw param before `prepare` owns
 * the url's error handling: sanitisation needs to know whether the call is
 * one of the pings whose protocol carries the page's visitor id.
 */
function statsFamily(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    return isStatsUrl(new URL(url));
  } catch {
    return false;
  }
}

/** The allowlist's refusal, naming exactly what was asked for. */
function forbidden(methodName: string, url: URL): Error {
  return Object.assign(new Error(`${methodName} doesn't serve ${url.origin}${url.pathname}`), { code: 'forbidden' });
}

/**
 * InnerTube clients that take no session signals at all — InnerTubeX sends
 * nothing for VISIONOS, and even the extension stripped headers off
 * `c=VISIONOS` media URLs. Attaching the fallback's cookie and SAPISIDHASH to
 * such a client's call makes YouTube refuse the whole request with HTTP 400
 * "Request contains an invalid argument." across every shape and host
 * (measured 2026-11-21: signed VISIONOS 1.02 on www = 400, signed VISIONOS_0_1
 * 0.1 on music.youtube.com = 400 and on www.youtube.com = 400, while unsigned
 * VISIONOS_0_1 on music = 200 UNPLAYABLE bot-check), so their calls stay
 * anonymous and the client walk falls through to a web client the fallback
 * does sign.
 */
const UNSIGNED_CLIENTS = new Set(['VISIONOS']);

/**
 * The `context.client.clientName` of an InnerTube POST body, when the body is
 * JSON that carries one. Untrusted input: anything unparseable simply has no
 * client name, and an absent name signs (the web clients the fallback exists
 * for all say who they are).
 */
function bodyClientName(body: BodyInit | undefined): string | null {
  if (typeof body !== 'string') return null;
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{')) return null;
  try {
    const client = (JSON.parse(trimmed) as { context?: { client?: { clientName?: unknown } } }).context?.client
      ?.clientName;
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
 * than a dropped call. [ctx] carries what arrived with the request outside
 * the envelope — the visitor's page-held jar, when the call brought one.
 */
export async function handle(
  request: BridgeRequest,
  deps: DispatchDeps,
  ctx: RequestContext = {},
): Promise<BridgeResponse> {
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
          // The session families are reported only when they are real: with a
          // fallback loaded the relay signs `auth` calls and the stats pings,
          // so the page's account machinery engages; without one it keeps
          // rendering its signed-out states.
          capabilities: deps.fallback ? FALLBACK_CAPABILITIES : RELAY_CAPABILITIES,
        });
      case 'yt.fetch': {
        const params = (request.params ?? {}) as YtFetchParams;
        // The visitor's jar, when the request carried one and it parses into a
        // session. Null means "not a credential" (nothing pasted, or a paste
        // with no session in it): signing then falls to the fallback exactly
        // as with no header at all, so a broken store never breaks a feature.
        const userJar = ctx.userJar ? UserCredential.fromText(ctx.userJar) : null;
        if (params.auth === true && !deps.fallback && !userJar) {
          // The refusal stands when there is nothing to sign with: no
          // fallback and no page-held jar. With either, an auth call is
          // served exactly like an anonymous one — signed with the session
          // the request belongs to (private-deployment.md: "auth: true stops
          // answering unauthenticated").
          return errorResponse(
            request.id,
            'unauthenticated',
            "The relay can't sign YouTube requests; its operator can set RELAY_FALLBACK_COOKIES_FILE to a shared account.",
          );
        }
        // A page-held Authorization is forwarded untouched (see hosts.ts), so
        // the caller bringing its own credential keeps it: the jar signs only
        // the calls with none. The stats family also carries the page's
        // visitor id — the protocol's own field, matched to the session that
        // played (hosts.ts's `forwardVisitorId`).
        const { method, url, headers, body } = prepare('yt.fetch', params, {
          forwardAuthorization: true,
          forwardVisitorId: statsFamily(params.url),
        });
        const impersonation = ytImpersonationFor(url);
        if (!impersonation) throw forbidden('yt.fetch', url);
        // A playback-tracking ping is a side effect, not a read (hosts.ts):
        // the page only ever sends GETs, and a served-from-cache answer would
        // swallow the play it was meant to register.
        const statsPing = isStatsUrl(url);
        if (statsPing && method !== 'GET') {
          throw Object.assign(new Error(`yt.fetch serves playback-tracking pings as GET only, not ${method}`), {
            code: 'forbidden',
          });
        }
        const pageAuthorized = headers.authorization !== undefined;
        // InnerTube calls and the stats pings are the two families a jar
        // signs; the session bootstrap and BotGuard rows stay anonymous
        // exactly as the impersonation table dresses them.
        const signOrigin = isInnerTubeUrl(url) || statsPing ? impersonation.origin : undefined;
        // UNSIGNED_CLIENTS keep their calls anonymous even under a jar:
        // their requests malformed with a session attached are refused outright.
        const unsignedClient = UNSIGNED_CLIENTS.has(bodyClientName(body) ?? '');
        // The visitor's jar outranks the fallback: a call their session signs
        // is theirs — their library, their likes, their history.
        const signer: FallbackCredential | UserCredential | null = userJar ?? deps.fallback ?? null;
        const signed =
          signer && signOrigin && !pageAuthorized && !unsignedClient
            ? signer.sign(signOrigin, Math.floor(Date.now() / 1000))
            : null;
        const userSigned = userJar !== null && !!signOrigin && !pageAuthorized && !unsignedClient;
        // The credential must never become a cache key (hygiene), so the key
        // cannot tell one identity's answers from another's; calls carrying
        // one therefore bypass the shared cache in both directions — and so
        // do the stats pings, whose effect lives on YouTube's side.
        const cacheable = method === 'GET' && !pageAuthorized && !statsPing && !userSigned;
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
          // The call's rotations belong to the fallback that signed it — a
          // user jar absorbs nothing, and stays nowhere.
          signed && !userSigned ? deps.fallback : undefined,
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
        // A request carrying the visitor's jar asks about *their* session:
        // one account_menu read, signed as them, answers their identity —
        // the only identity a relay answer may ever carry, because it is the
        // visitor's own. Every other request gets the static answers: with a
        // fallback loaded the functional, identity-free session
        // (SHARED_SESSION_YT) — the features are live, the throwaway account
        // is not, and no upstream call is ever made to read one — and without
        // one the static signed-out answer stands.
        const jarText = ctx.userJar;
        if (jarText !== undefined && jarText !== '') {
          const credential = UserCredential.fromText(jarText);
          if (!credential) {
            return okResponse(
              request.id,
              NO_SESSION_YT,
            );
          }
          return okResponse(request.id, await readUserIdentity(deps.fetchImpl, credential));
        }
        return okResponse(request.id, deps.fallback ? SHARED_SESSION_YT : SIGNED_OUT_YT);
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
