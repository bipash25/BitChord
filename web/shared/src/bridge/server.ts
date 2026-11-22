import {
  BRIDGE_CHANNEL,
  BRIDGE_PROTOCOL,
  BridgeCallError,
  isBridgeResponse,
  type BridgeEvent,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
  type CallOptions,
  type ParamsOf,
  type ResultOf,
} from './protocol';
import type { Bridge } from './client';

/**
 * The server relay transport (web/docs/relay.md): the same bridge contract,
 * served over HTTP by the `web/relay` service. Phase 2's only transport —
 * the extension it once trailed in detection is gone.
 *
 * The relay serves `ping`, `yt.fetch`, `lyrics.fetch` and `addon.fetch`, and
 * answers `yt.authState` from its own session state: a functional,
 * identity-free signed-in answer when its operator has loaded a fallback
 * credential (web/docs/private-deployment.md — the features are live, the
 * account is anonymous), the signed-out shape otherwise — unless the call
 * carries the visitor's own YouTube jar, which the relay signs with instead
 * and whose identity it then answers (below). Channel switching and connect
 * stay unsupported: the relay chooses no session, and the page holds its own.
 *
 * One endpoint: `POST {base}/bridge` with a `BridgeRequest` envelope, answered
 * with a `BridgeResponse` envelope. One credential crosses this boundary, by
 * the owner's design (private-deployment.md, 2026-11-22): the visitor's own
 * YouTube cookie jar, held in their browser, read per call from [userJar] and
 * attached as the `x-bitchord-user-jar` header on the two methods that use
 * it. The relay attaches it ephemerally to the YouTube calls it performs and
 * stores nothing — the relay-side fences are web/relay's to keep.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

let nextId = 0;
const newId = () => `s${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** How a page-held YouTube jar rides a bridge call (raw cookies.txt / `Cookie:` line text). */
export const USER_JAR_HEADER = 'x-bitchord-user-jar';

/** The methods a jar can sign: everything else is served without it. */
const JAR_METHODS = new Set<BridgeMethod>(['yt.fetch', 'yt.authState']);

/**
 * Options for the server bridge transport.
 */
export interface ServerBridgeOptions {
  /**
   * The page-held YouTube cookie jar (private-deployment.md, 2026-11-22), as
   * raw cookies.txt/`Cookie:` line text or null when none is stored. Read per
   * call, so connecting or disconnecting needs no new transport — the store
   * is the source of truth and this accessor is its window.
   */
  userJar?: () => string | null | undefined;
}

/** The relay's single endpoint: `{base}/bridge`. */
export function serverBridge(baseUrl: string, transport: ServerBridgeOptions = {}): Bridge {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/bridge`;
  return {
    transport: 'server',
    call(method, params, options) {
      const request: BridgeRequest<BridgeMethod> = {
        channel: BRIDGE_CHANNEL,
        protocol: BRIDGE_PROTOCOL,
        direction: 'to-extension',
        id: newId(),
        method,
        params: params as ParamsOf<BridgeMethod>,
      };
      return callEndpoint(endpoint, request, options, transport);
    },
    subscribe(_listener: (event: BridgeEvent) => void) {
      // The relay holds no identity and watches no cookies, so there is
      // nothing to push. State is re-read through calls — the auth answer
      // only changes with a relay restart, which a reload notices anyway.
      return () => {};
    },
  };
}

async function callEndpoint<M extends BridgeMethod>(
  endpoint: string,
  request: BridgeRequest<M>,
  options: CallOptions | undefined,
  transport: ServerBridgeOptions,
): Promise<ResultOf<M>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // The visitor's own jar rides only the calls that can sign with it, read
    // at send time so the store behind the accessor is always current. It is
    // a header, not an envelope field: the RPC stays credential-free, and a
    // relay that never learned the header simply never sees it (mixed
    // versions fail those two calls, as any protocol skew does).
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (JAR_METHODS.has(request.method)) {
      const jar = transport.userJar?.();
      if (jar) headers[USER_JAR_HEADER] = jar;
    }
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        // The relay is cross-origin from the site and carries no credentials.
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason ?? error;
      if (controller.signal.aborted) {
        throw new BridgeCallError('timeout', `No answer from the relay within ${timeoutMs} ms`);
      }
      throw new BridgeCallError('network', `The relay at ${new URL(endpoint).origin} didn't answer: ${String(error)}`);
    }
    if (response.status === 429) {
      throw new BridgeCallError('network', 'The relay is rate-limiting this browser. Try again shortly.');
    }
    if (!response.ok) {
      throw new BridgeCallError('unavailable', `The relay answered HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isBridgeResponse(body) || body.id !== request.id) {
      throw new BridgeCallError('protocol', 'Malformed response from the relay');
    }
    const answer = body as BridgeResponse<M>;
    if (answer.ok) return answer.result;
    throw new BridgeCallError(answer.error.code, answer.error.message);
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onAbort);
  }
}
