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
 * The relay answers the anonymous subset — `ping`, `yt.fetch`, `lyrics.fetch`,
 * `addon.fetch` — and reports every identity-holding method as signed out or
 * unsupported until phase 2's brokered sign-in lands.
 *
 * One endpoint: `POST {base}/bridge` with a `BridgeRequest` envelope, answered
 * with a `BridgeResponse` envelope. No credentials cross this boundary: the
 * relay holds none.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

let nextId = 0;
const newId = () => `s${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** The relay's single endpoint: `{base}/bridge`. */
export function serverBridge(baseUrl: string): Bridge {
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
      return callEndpoint(endpoint, request, options);
    },
    subscribe(_listener: (event: BridgeEvent) => void) {
      // The relay holds no identity and watches no cookies, so there is
      // nothing to push. State is re-read through calls, which always answer
      // signed out here.
      return () => {};
    },
  };
}

async function callEndpoint<M extends BridgeMethod>(
  endpoint: string,
  request: BridgeRequest<M>,
  options: CallOptions | undefined,
): Promise<ResultOf<M>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
