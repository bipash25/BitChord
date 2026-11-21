/**
 * Ambient declarations for the Node APIs the relay touches: `node:http`,
 * `node:crypto`, `node:fs` and `process`.
 *
 * Why not `@types/node`: the relay's devDependencies are exactly the three
 * `web/app` pins (relay.md), so its dependency tree stays a subset of the
 * workspace's. Everything else the relay uses is a web-platform global that
 * Node also implements — `fetch`, `Response`, `Headers`, `AbortSignal`,
 * `btoa`/`atob`, `TextDecoder`, `URL` — typed by the base tsconfig's DOM lib,
 * which is why the relay reads like the extension code it ports.
 *
 * Each declaration here is deliberately narrower than the real API: it covers
 * exactly the calls the relay makes, with the shapes Node documents for them,
 * so a misuse inside the relay is still a type error.
 */

declare var process: {
  env: Record<string, string | undefined>;
};

declare module 'node:fs' {
  /** Reads its own package.json for `ping`, and the fallback jar at startup. */
  export function readFileSync(path: string | URL): Uint8Array;
  /** Persists the living jar as YouTube rotates the fallback session. */
  export function writeFileSync(path: string | URL, data: string): void;
  /** The persist round-trip test cleans up its scratch file. */
  export function rmSync(path: string | URL, options?: { force?: boolean }): void;
}

declare module 'node:os' {
  /** Where the persist round-trip test parks its scratch file. */
  export function tmpdir(): string;
}

declare module 'node:crypto' {
  /** The one algorithm the relay uses: the fallback's SAPISIDHASH digest. */
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  /** The one call the relay makes: `createHash('sha1')` for that digest. */
  export function createHash(algorithm: 'sha1'): Hash;
}

declare module 'node:http' {
  /** Node's header map: lowercase keys; arrays only for repeatable headers. */
  export interface IncomingHttpHeaders {
    [name: string]: string | string[] | undefined;
  }

  export class IncomingMessage {
    method?: string | undefined;
    url?: string | undefined;
    headers: IncomingHttpHeaders;
    /** Where the connection came from; the per-IP rate limit is keyed on it. */
    socket?: { remoteAddress?: string | undefined } | undefined;
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    destroy(): void;
  }

  export class ServerResponse {
    statusCode: number;
    /** Whether anything was already written, so an error path doesn't try to answer twice. */
    readonly headersSent: boolean;
    writeHead(status: number, headers?: Record<string, string | number | string[]>): this;
    setHeader(name: string, value: string | number | readonly string[]): this;
    write(chunk: string | Uint8Array): boolean;
    end(data?: string | Uint8Array): this;
  }

  export class Server {
    listen(port: number, callback?: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'clientError', listener: (error: Error, socket: { destroy(): void }) => void): this;
    close(): this;
  }

  export function createServer(
    handler?: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}
