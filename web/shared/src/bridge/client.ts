import { type BridgeEvent, type BridgeMethod, type CallOptions, type ParamsOf, type ResultOf } from './protocol';
import { serverBridge } from './server';

/**
 * Page-side bridge (relay.md, phase 2): one transport — the server relay
 * (`web/relay`), speaking the envelope over HTTP from `server.ts`. The
 * extension transports this interface used to carry (Chromium
 * `externally_connectable`, the Firefox content-script relay) went with the
 * extension; detection is the server bridge or nothing.
 */
export interface Bridge {
  readonly transport: 'server';
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>, options?: CallOptions): Promise<ResultOf<M>>;
  /**
   * Pushed state changes. The relay's subscribe is a no-op (it holds no
   * identity and watches no cookies, so there is nothing to push — see
   * `server.ts`); the method stays because the contract keeps it, and phase
   * 2's sign-in work will push auth changes through it.
   */
  subscribe(listener: (event: BridgeEvent) => void): () => void;
}

export interface DetectedExtension {
  bridge: Bridge;
  info: ResultOf<'ping'>;
}

export interface DetectOptions {
  /**
   * The server relay's base URL (`web/relay`). Without it there is nothing to
   * find, so detection resolves `null` without a ping.
   */
  serverBridgeUrl?: string | undefined;
  /** How long to wait for a `ping` answer. */
  timeoutMs?: number;
}

/**
 * Finds the relay by pinging it: the server bridge, when its URL is
 * configured. Resolves `null` when nothing answers.
 */
export async function detectExtension(options: DetectOptions = {}): Promise<DetectedExtension | null> {
  if (!options.serverBridgeUrl) return null;
  const bridge = serverBridge(options.serverBridgeUrl);
  try {
    const info = await bridge.call('ping', {}, { timeoutMs: options.timeoutMs ?? 1500 });
    return { bridge, info };
  } catch {
    // The relay didn't answer: nothing else can be found.
    return null;
  }
}
