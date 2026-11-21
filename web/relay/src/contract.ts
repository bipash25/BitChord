/**
 * The page ↔ relay contract: the same envelope the page speaks, copied by
 * hand from `web/shared/src/bridge/protocol.ts`.
 *
 * Why a copy: the relay has zero dependencies (relay.md) — `node:http` plus
 * the global fetch — and `@bitchord/shared` ships unbundled TypeScript aimed
 * at bundlers (vite), which a standalone Node service built with `tsc`
 * cannot import. The copy is kept to the subset the relay answers; a drift
 * between the two files fails loudly, because `ping` answers with this
 * `BRIDGE_PROTOCOL` and the page's transport refuses a number it doesn't
 * speak before any method runs.
 */

/** Bumped on any breaking change to an envelope or a method's shape. */
export const BRIDGE_PROTOCOL = 1;

/** Tags every message so the relay ignores everything else on the wire. */
export const BRIDGE_CHANNEL = 'bitchord-bridge';

/** What a transport can do; `ping` reports the relay's subset. Spotify left the bridge with the extension (relay.md phase 2). */
export type Capability = 'yt' | 'yt.auth' | 'yt.stats' | 'addon' | 'lyrics';

/** The relay is the one transport that is not a browser at all. */
export type BrowserFamily = 'chromium' | 'firefox' | 'server';

/** A plain HTTP exchange, serialisable across the channel. */
export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  /** Text bodies as-is; binary bodies base64-encoded with `bodyEncoding: 'base64'`. */
  body?: string;
  bodyEncoding?: 'text' | 'base64';
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** UTF-8 text, or base64 when `bodyEncoding` is `'base64'`. */
  body: string;
  bodyEncoding: 'text' | 'base64';
  /** The final URL after redirects. */
  url: string;
}

/** `yt.fetch` is the same exchange with the caller asking for a session the relay refuses to hold. */
export interface YtFetchParams extends HttpRequest {
  /** The relay has no Google session to send, so it answers `unauthenticated`. */
  auth?: boolean;
}

/** One identity requests can act as: a Google login's own channel, or one of its brand channels. */
export interface YtChannel {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  brand: boolean;
}

/** A Google login in a browser's cookie jar, as `X-Goog-AuthUser` addresses it. */
export interface YtAccount {
  authUser: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  channels: YtChannel[];
}

/** Who signed-in YouTube requests act as. The relay always answers the signed-out shape. */
export interface YtAuthState {
  browserSignedIn: boolean;
  connected: boolean;
  signedIn: boolean;
  accounts: YtAccount[];
  active: (YtChannel & { authUser: string }) | null;
  problem: string | null;
}

/**
 * A request as it arrives on the wire. `params` is left `unknown` on purpose:
 * the page is a typed partner, but the relay answers anyone who posts to
 * `/bridge`, so every method validates what it reads.
 */
export interface BridgeRequest {
  channel: typeof BRIDGE_CHANNEL;
  protocol: number;
  direction: 'to-extension';
  id: string;
  method: string;
  params: unknown;
}

/** Mirrors the shared contract's code list; `failure` maps errors onto it. */
export type BridgeErrorCode =
  | 'unsupported'
  | 'forbidden'
  | 'protocol'
  | 'network'
  | 'unauthenticated'
  | 'permission'
  | 'internal';

export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
}

export type BridgeResponse =
  | { channel: typeof BRIDGE_CHANNEL; protocol: number; direction: 'to-page'; id: string; ok: true; result: unknown }
  | { channel: typeof BRIDGE_CHANNEL; protocol: number; direction: 'to-page'; id: string; ok: false; error: BridgeError };

export function okResponse(id: string, result: unknown): BridgeResponse {
  return { channel: BRIDGE_CHANNEL, protocol: BRIDGE_PROTOCOL, direction: 'to-page', id, ok: true, result };
}

export function errorResponse(id: string, code: BridgeErrorCode, message: string): BridgeResponse {
  return { channel: BRIDGE_CHANNEL, protocol: BRIDGE_PROTOCOL, direction: 'to-page', id, ok: false, error: { code, message } };
}

/**
 * Envelope validation, same checks as the shared `isBridgeRequest`: channel,
 * direction, a string id and a string method. `protocol` is deliberately not
 * checked here so a mismatch can be answered as a bridge `protocol` error
 * with the request's own id (as the extension's dispatcher does).
 */
export function isBridgeRequest(value: unknown): value is BridgeRequest {
  const v = value as Partial<BridgeRequest> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    v.channel === BRIDGE_CHANNEL &&
    v.direction === 'to-extension' &&
    typeof v.id === 'string' &&
    typeof v.method === 'string'
  );
}
