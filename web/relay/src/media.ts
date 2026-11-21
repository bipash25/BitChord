import type { IncomingHttpHeaders } from 'node:http';
import { CHROMIUM_USER_AGENT, isMediaUrl } from './hosts.js';
import { UPSTREAM_TIMEOUT_MS, type IpLimiter } from './limits.js';

/**
 * `/media?u=<googlevideo-url>` — the relay's bounded range-proxy for YouTube
 * audio streams (`web/docs/private-deployment.md`).
 *
 * Why it exists (measured 2026-11-21): a browser `<audio>` element sends an
 * open-ended `Range: bytes=0-`, and googlevideo rejects open ranges on
 * `c=WEB_REMIX` URLs outright with HTTP 403 while serving bounded ranges
 * (`bytes=0-262143`, …) with HTTP 206; browser `fetch()` cannot do the
 * splitting client-side because googlevideo refuses the `Range` CORS preflight
 * with HTTP 400. As Android's `ChunkedDataSource.kt` does in-process for
 * ExoPlayer, this endpoint accepts the element's open (or bounded) range and
 * walks googlevideo in fixed bounded chunks, streaming each 206 back to the
 * element as one continuous response with the full `Content-Range` and
 * `Content-Length` up front.
 *
 * Hygiene: strict `https://[*.]googlevideo.com/videoplayback` validation,
 * per-IP rate limiting, no server cookies or credentials attached (`omit`),
 * client disconnect aborts the upstream fetch immediately, and no URL query
 * parameters (signatures, tokens, client IPs) ever appear in a log or error.
 */

/**
 * 256 KB per upstream range: ~15 s of Opus audio on the first hop (~60 ms to
 * `canplay`), O(256 KB) memory per active stream, and comfortably inside
 * googlevideo's per-request range ceiling (`PlayerClient.NARROW_RANGE_BYTES`).
 */
export const MEDIA_CHUNK_BYTES = 256 * 1024;

/** Mirrors `ChunkedDataSource.MAX_EMPTY_RANGES`: stop if upstream answers 206 with 0 bytes repeatedly. */
const MAX_EMPTY_RANGES = 3;

/** Narrowed request surface so tests can drive `serveMedia` without opening sockets. */
export interface MediaRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
  on(event: 'close', listener: () => void): unknown;
}

/** Narrowed response surface matching `node:http`'s `ServerResponse`. */
export interface MediaResponse {
  statusCode: number;
  readonly headersSent: boolean;
  readonly destroyed: boolean;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  writeHead(status: number, headers?: Record<string, string | number | string[]>): unknown;
  write(chunk: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): unknown;
  destroy(): unknown;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  removeListener(event: 'drain' | 'close', listener: () => void): unknown;
}

export interface MediaDeps {
  fetchImpl: typeof globalThis.fetch;
  limiter: IpLimiter;
  allowedOrigins: ReadonlySet<string>;
  clientIp: string;
  chunkBytes?: number;
}

type ParsedRange =
  | { kind: 'ok'; start: number; end: number | null; ranged: boolean }
  | { kind: 'unsatisfiable' };

const BYTES_RANGE = /^bytes=(\d*)-(\d*)$/i;
const CONTENT_RANGE = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i;

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Parses a single-part HTTP `Range` header (`bytes=start-`, `bytes=start-end`,
 * or `bytes=-suffix` when [knownTotal] is available). Multi-part ranges and
 * malformed units answer `unsatisfiable` (HTTP 416).
 */
export function parseByteRange(header: string | undefined, knownTotal: number | null): ParsedRange {
  if (!header) return { kind: 'ok', start: 0, end: null, ranged: false };
  const match = BYTES_RANGE.exec(header.trim());
  if (!match) return { kind: 'unsatisfiable' };
  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';
  if (!startStr && !endStr) return { kind: 'unsatisfiable' };

  if (!startStr) {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0 || knownTotal === null || knownTotal <= 0) {
      return { kind: 'unsatisfiable' };
    }
    return { kind: 'ok', start: Math.max(0, knownTotal - suffix), end: knownTotal - 1, ranged: true };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0) return { kind: 'unsatisfiable' };
  if (!endStr) return { kind: 'ok', start, end: null, ranged: true };

  const end = Number(endStr);
  if (!Number.isInteger(end) || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'ok', start, end, ranged: true };
}

function parseTotalFromContentRange(value: string | null): number | null {
  if (!value) return null;
  const match = CONTENT_RANGE.exec(value.trim());
  if (!match) return null;
  const totalStr = match[3] ?? '';
  if (totalStr === '*') return null;
  const total = Number(totalStr);
  return Number.isInteger(total) && total > 0 ? total : null;
}

function plain(response: MediaResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(body);
}

/** Combines client-disconnect cancellation with a per-chunk upstream timeout. */
function chunkSignal(clientAbort: AbortController, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  if (clientAbort.signal.aborted) {
    controller.abort();
    return { signal: controller.signal, clear: () => {} };
  }
  clientAbort.signal.addEventListener('abort', onClientAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      clientAbort.signal.removeEventListener('abort', onClientAbort);
    },
  };
}

/** Writes one buffer, waiting for TCP drain when the downstream socket is full. */
function writeChunk(response: MediaResponse, chunk: Uint8Array): Promise<boolean> {
  if (response.destroyed) return Promise.resolve(false);
  if (response.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onDrain = () => {
      response.removeListener('close', onClose);
      resolve(true);
    };
    const onClose = () => {
      response.removeListener('drain', onDrain);
      resolve(false);
    };
    response.once('drain', onDrain);
    response.once('close', onClose);
  });
}

/** Streams up to [maxBytes] from an upstream `Response` into [response], returning the bytes written. */
async function pumpBody(
  upstream: Response,
  response: MediaResponse,
  maxBytes: number,
  clientAbort: AbortController,
): Promise<number> {
  if (!upstream.body) {
    const raw = new Uint8Array(await upstream.arrayBuffer());
    const slice = raw.byteLength > maxBytes ? raw.subarray(0, maxBytes) : raw;
    if (slice.byteLength === 0) return 0;
    const ok = await writeChunk(response, slice);
    return ok ? slice.byteLength : 0;
  }
  const reader = upstream.body.getReader();
  let written = 0;
  try {
    while (written < maxBytes && !clientAbort.signal.aborted && !response.destroyed) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - written;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      if (slice.byteLength > 0) {
        const ok = await writeChunk(response, slice);
        if (!ok) break;
        written += slice.byteLength;
      }
      if (value.byteLength > remaining) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    if (clientAbort.signal.aborted || response.destroyed) {
      await reader.cancel().catch(() => {});
    } else {
      reader.releaseLock();
    }
  }
  return written;
}

/** Answers `GET` / `HEAD` / `OPTIONS` on `/media?u=<googlevideo-url>`. */
export async function serveMedia(request: MediaRequest, response: MediaResponse, deps: MediaDeps): Promise<void> {
  const origin = headerValue(request.headers, 'origin');
  const allowedOrigin = origin !== undefined && deps.allowedOrigins.has(origin) ? origin : undefined;

  response.setHeader('vary', 'Origin');
  if (allowedOrigin) {
    response.setHeader('access-control-allow-origin', allowedOrigin);
    response.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges');
  }

  if (request.method === 'OPTIONS') {
    if (allowedOrigin) {
      response.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
      response.setHeader('access-control-allow-headers', 'range');
      response.setHeader('access-control-max-age', '86400');
    }
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD, OPTIONS');
    plain(response, 405, 'the media proxy serves GET and HEAD');
    return;
  }

  const retryAfter = deps.limiter.take(deps.clientIp);
  if (retryAfter > 0) {
    response.setHeader('retry-after', String(retryAfter));
    plain(response, 429, `the relay is rate-limiting this address; retry in ${retryAfter}s`);
    return;
  }

  const reqUrl = new URL(request.url ?? '/', 'http://localhost');
  const rawTarget = reqUrl.searchParams.get('u');
  if (!rawTarget) {
    plain(response, 400, '/media needs a u query parameter');
    return;
  }

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    plain(response, 400, '/media u is not a valid URL');
    return;
  }
  if (!isMediaUrl(target)) {
    plain(response, 403, `/media serves googlevideo.com/videoplayback only, not ${target.origin}${target.pathname}`);
    return;
  }

  const clenRaw = Number(target.searchParams.get('clen') ?? '');
  const knownTotal = Number.isInteger(clenRaw) && clenRaw > 0 ? clenRaw : null;
  const parsedRange = parseByteRange(headerValue(request.headers, 'range'), knownTotal);

  if (parsedRange.kind === 'unsatisfiable' || (knownTotal !== null && parsedRange.start >= knownTotal)) {
    if (knownTotal !== null) response.setHeader('content-range', `bytes */${knownTotal}`);
    plain(response, 416, 'range not satisfiable');
    return;
  }

  const chunkBytes = deps.chunkBytes ?? MEDIA_CHUNK_BYTES;
  const clientAbort = new AbortController();
  const onClose = () => clientAbort.abort();
  request.on('close', onClose);
  response.once('close', onClose);

  const fetchChunk = async (start: number, end: number): Promise<Response> => {
    const { signal, clear } = chunkSignal(clientAbort, UPSTREAM_TIMEOUT_MS);
    try {
      return await deps.fetchImpl(target, {
        method: 'GET',
        headers: {
          'user-agent': CHROMIUM_USER_AGENT,
          range: `bytes=${start}-${end}`,
        },
        redirect: 'follow',
        credentials: 'omit',
        signal,
      });
    } finally {
      clear();
    }
  };

  const initialCap =
    parsedRange.end !== null
      ? knownTotal !== null
        ? Math.min(parsedRange.end, knownTotal - 1)
        : parsedRange.end
      : knownTotal !== null
        ? knownTotal - 1
        : null;
  const firstEnd =
    initialCap !== null ? Math.min(initialCap, parsedRange.start + chunkBytes - 1) : parsedRange.start + chunkBytes - 1;

  let firstRes: Response;
  try {
    firstRes = await fetchChunk(parsedRange.start, firstEnd);
  } catch {
    if (!clientAbort.signal.aborted && !response.headersSent) {
      plain(response, 502, 'upstream media fetch failed');
    }
    return;
  }

  if (firstRes.status === 416) {
    const cr = firstRes.headers.get('content-range');
    if (cr) response.setHeader('content-range', cr);
    await firstRes.body?.cancel().catch(() => {});
    plain(response, 416, 'range not satisfiable');
    return;
  }

  if (firstRes.status !== 206 && firstRes.status !== 200) {
    await firstRes.body?.cancel().catch(() => {});
    plain(response, firstRes.status, `googlevideo answered HTTP ${firstRes.status}`);
    return;
  }

  const totalBytes =
    parseTotalFromContentRange(firstRes.headers.get('content-range')) ??
    knownTotal ??
    (firstRes.status === 200 ? Number(firstRes.headers.get('content-length') ?? '') || null : null);

  if (!totalBytes || totalBytes <= parsedRange.start) {
    await firstRes.body?.cancel().catch(() => {});
    plain(response, 502, 'upstream media response stated no total length');
    return;
  }

  const streamEnd = parsedRange.end !== null ? Math.min(parsedRange.end, totalBytes - 1) : totalBytes - 1;
  const streamLength = streamEnd - parsedRange.start + 1;
  const contentType = firstRes.headers.get('content-type') ?? 'application/octet-stream';

  const outHeaders: Record<string, string> = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'content-length': String(streamLength),
    'cache-control': 'no-store',
  };
  if (parsedRange.ranged) {
    outHeaders['content-range'] = `bytes ${parsedRange.start}-${streamEnd}/${totalBytes}`;
  }
  response.writeHead(parsedRange.ranged ? 206 : 200, outHeaders);

  if (request.method === 'HEAD') {
    await firstRes.body?.cancel().catch(() => {});
    response.end();
    return;
  }

  try {
    let offset = parsedRange.start;
    const firstWritten = await pumpBody(firstRes, response, streamEnd - offset + 1, clientAbort);
    offset += firstWritten;
    if (firstWritten === 0 && offset <= streamEnd) {
      response.destroy();
      return;
    }

    let emptyRanges = 0;
    while (offset <= streamEnd && !clientAbort.signal.aborted && !response.destroyed) {
      const nextEnd = Math.min(streamEnd, offset + chunkBytes - 1);
      const chunkRes = await fetchChunk(offset, nextEnd);
      if (chunkRes.status !== 206) {
        await chunkRes.body?.cancel().catch(() => {});
        // Truncate the declared Content-Length stream abruptly so the browser's
        // <audio> element raises MEDIA_ERR_NETWORK rather than treating a
        // mid-track 403 as normal end-of-track.
        response.destroy();
        return;
      }
      const written = await pumpBody(chunkRes, response, streamEnd - offset + 1, clientAbort);
      if (written === 0) {
        emptyRanges++;
        if (emptyRanges >= MAX_EMPTY_RANGES) {
          response.destroy();
          return;
        }
        continue;
      }
      emptyRanges = 0;
      offset += written;
    }

    if (!clientAbort.signal.aborted && !response.destroyed) {
      response.end();
    }
  } catch {
    if (!response.destroyed) response.destroy();
  }
}
