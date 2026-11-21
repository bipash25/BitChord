import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadFallbackCredential } from './fallback.js';
import { dispatchDeps, handle, type DispatchDeps } from './dispatch.js';
import { isBridgeRequest, type BridgeRequest } from './contract.js';
import { BodyTooLargeError, IpLimiter, MAX_BODY_BYTES, readBody } from './limits.js';
import { VERSION } from './version.js';

/**
 * The relay's front door: one HTTP server, one endpoint — `POST {base}/bridge`
 * with a BridgeRequest body, answered with a BridgeResponse envelope
 * (`web/shared/src/bridge/server.ts` already speaks it from the page side).
 *
 * CORS fencing (relay.md "Origins"): `Access-Control-Allow-Origin` echoes the
 * request origin only when it is in RELAY_ALLOWED_ORIGINS; a browser outside
 * the list gets no CORS header at all and cannot read an answer. The request
 * is still served — the origin list is a browser fence, not an
 * authentication, and v1 has no stronger one by design.
 */

/** The dev server's origin (web/app/vite.config.ts pins port 5173). */
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173';

function parseOrigins(value: string | undefined): Set<string> {
  const listed = (value ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(listed);
}

const port = Number(process.env.PORT ?? 8787) || 8787;
const allowedOrigins = parseOrigins(process.env.RELAY_ALLOWED_ORIGINS);
/**
 * Behind the README's reverse proxy every caller shares one socket address,
 * which would fuse the whole deployment into a single rate-limit bucket. Only
 * then is X-Forwarded-For consulted — and only when this flag says so,
 * because the header is client-writable and would otherwise be a free
 * bypass.
 */
const trustProxy = /^(1|true|yes)$/i.test(process.env.RELAY_TRUST_PROXY ?? '');
const limiter = new IpLimiter();

/**
 * The private deployment's fallback credential (`web/docs/private-deployment.md`):
 * the throwaway account's cookie jar, parsed once at startup. Rotation is an
 * env swap plus a restart by design — no hot reload, so there is never a
 * window with two jars live. A configured file with nothing usable in it
 * refuses to boot: a deployment that thinks it has playback and silently
 * doesn't is the worse failure.
 */
const fallback = loadFallbackCredential(process.env.RELAY_FALLBACK_COOKIES_FILE);
/** The dispatcher's wiring: the server's fetch and cache, plus the fallback. */
const deps: DispatchDeps = { ...dispatchDeps, fallback };

/** Reads one header, joining a repeated one as HTTP does. */
function header(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

function clientIp(request: IncomingMessage): string {
  if (trustProxy) {
    const forwarded = header(request.headers, 'x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first; // the proxy appends; the first value is the real client
  }
  const remote = request.socket?.remoteAddress ?? 'unknown';
  // Node reports IPv4 clients on IPv6 sockets as ::ffff:127.0.0.1; one shape, one bucket.
  return remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote;
}

function answer(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.end(body);
}

/** One header value off a response that may have already been written to. */
function fail(response: ServerResponse, status: number, body: string): void {
  if (!response.headersSent) answer(response, status, 'text/plain', body);
  else response.end();
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  // `/bridge` on its own, or under a proxy prefix (`/relay/bridge`), is the
  // one path the page addresses; everything else is a stray probe.
  const path = request.url ?? '';
  if (!path.endsWith('/bridge')) {
    answer(response, 404, 'text/plain', 'the relay serves POST /bridge');
    return;
  }

  const origin = header(request.headers, 'origin');
  const allowed = origin !== undefined && allowedOrigins.has(origin);

  if (request.method === 'OPTIONS') {
    // The preflight the page's bridge sends: POST with a content-type. Cached
    // for a day, so it costs one round trip per browser per day.
    response.setHeader('vary', 'Origin');
    if (allowed) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type');
      response.setHeader('access-control-max-age', '86400');
    }
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST, OPTIONS');
    answer(response, 405, 'text/plain', 'the relay serves POST /bridge');
    return;
  }

  // Preflights don't reach the bucket: they carry no work, and a browser that
  // only warmed its cache shouldn't have spent its burst.
  const retryAfter = limiter.take(clientIp(request));
  if (retryAfter > 0) {
    response.setHeader('retry-after', String(retryAfter));
    answer(response, 429, 'text/plain', `the relay is rate-limiting this address; retry in ${retryAfter}s`);
    return;
  }

  let body: Uint8Array;
  try {
    body = await readBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      answer(response, 413, 'text/plain', error.message);
      // Stop the upload rather than drain it: a bridge call never comes close
      // to the cap, so this is abuse or a bug, not a page.
      request.destroy();
      return;
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    answer(response, 400, 'text/plain', 'the bridge speaks JSON');
    return;
  }
  if (!isBridgeRequest(payload)) {
    answer(response, 400, 'text/plain', 'not a bridge request');
    return;
  }

  const envelope = await handle(payload as BridgeRequest, deps);
  response.setHeader('vary', 'Origin');
  if (allowed) response.setHeader('access-control-allow-origin', origin);
  answer(response, 200, 'application/json', JSON.stringify(envelope));
}

const server = createServer((request, response) => {
  // The handler answers its own errors; this backstop only covers what escaped it.
  void route(request, response).catch((error: unknown) => {
    console.error('relay: unhandled error while answering a request', error);
    fail(response, 500, 'internal relay error');
  });
});

// A malformed request line isn't worth a stack trace per offender; drop the socket quietly.
server.on('clientError', (_error, socket) => socket.destroy());

server.listen(port, () => {
  console.log(`BitChord relay ${VERSION} listening on http://0.0.0.0:${port}/bridge`);
  console.log(`allowed origins: ${[...allowedOrigins].join(', ')}`);
  if (trustProxy) console.log('trusting X-Forwarded-For (RELAY_TRUST_PROXY)');
  // Names the mode, never the jar: the credential's value appears in no log line.
  if (fallback) console.log('fallback credential loaded: anonymous InnerTube calls will be signed by it');
});

server.on('error', (error) => {
  console.error(`relay: cannot listen on port ${port}:`, error);
});
