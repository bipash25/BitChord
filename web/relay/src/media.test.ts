import { describe, expect, it } from 'vitest';
import { IpLimiter, RATE_BURST } from './limits.js';
import { parseByteRange, serveMedia, type MediaRequest, type MediaResponse } from './media.js';
import { CHROMIUM_USER_AGENT } from './hosts.js';

/** Fakes for MediaRequest and MediaResponse, capturing headers, chunks and lifecycle. */
function fakeExchange(init: { method?: string; url: string; headers?: Record<string, string> }) {
  const reqCloseListeners: (() => void)[] = [];
  const resListeners: { drain: (() => void)[]; close: (() => void)[] } = { drain: [], close: [] };
  const headers: Record<string, string> = {};
  const chunks: Uint8Array[] = [];
  let statusCode = 200;
  let headersSent = false;
  let destroyed = false;
  let ended = false;

  const request: MediaRequest = {
    method: init.method ?? 'GET',
    url: init.url,
    headers: init.headers ?? {},
    on(_event, listener) {
      reqCloseListeners.push(listener);
      return this;
    },
  };

  const response: MediaResponse = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    get headersSent() {
      return headersSent;
    },
    get destroyed() {
      return destroyed;
    },
    setHeader(name, value) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
      return this;
    },
    writeHead(status, extra) {
      statusCode = status;
      headersSent = true;
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
      }
      return this;
    },
    write(chunk) {
      headersSent = true;
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      return true;
    },
    end(data) {
      headersSent = true;
      if (data !== undefined) {
        chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      }
      ended = true;
      return this;
    },
    destroy() {
      destroyed = true;
      for (const fn of resListeners.close.splice(0)) fn();
      return this;
    },
    once(event, listener) {
      resListeners[event].push(listener);
      return this;
    },
    removeListener(event, listener) {
      const idx = resListeners[event].indexOf(listener);
      if (idx >= 0) resListeners[event].splice(idx, 1);
      return this;
    },
  };

  const bodyBytes = () => {
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  };

  const disconnectClient = () => {
    destroyed = true;
    for (const fn of reqCloseListeners.splice(0)) fn();
    for (const fn of resListeners.close.splice(0)) fn();
  };

  return {
    request,
    response,
    headers,
    bodyBytes,
    bodyText: () => new TextDecoder().decode(bodyBytes()),
    get status() {
      return statusCode;
    },
    get destroyed() {
      return destroyed;
    },
    get ended() {
      return ended;
    },
    disconnectClient,
  };
}

/** A fake googlevideo server holding [payload] and rejecting open ranges just like WEB_REMIX does. */
function fakeGooglevideo(payload: Uint8Array, options: { failAtOffset?: number } = {}) {
  const seenRanges: string[] = [];
  const seenInits: RequestInit[] = [];
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    seenInits.push(init ?? {});
    const hdrs = new Headers(init?.headers);
    const range = hdrs.get('range') ?? '';
    seenRanges.push(range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) {
      // Mirrors live googlevideo on c=WEB_REMIX: open or missing ranges answer 403.
      return new Response(null, { status: 403 });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), payload.byteLength - 1);
    if (options.failAtOffset !== undefined && start >= options.failAtOffset) {
      return new Response(null, { status: 403 });
    }
    if (start >= payload.byteLength || end < start) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${payload.byteLength}` },
      });
    }
    const slice = new Uint8Array(payload.subarray(start, end + 1));
    return new Response(slice, {
      status: 206,
      headers: {
        'content-type': 'audio/webm',
        'content-range': `bytes ${start}-${end}/${payload.byteLength}`,
        'content-length': String(slice.byteLength),
      },
    });
  };
  return { fetchImpl, seenRanges, seenInits };
}

const VALID_URL = 'https://rr3---sn-vgqsrn6e.googlevideo.com/videoplayback?itag=251&clen=10';

describe('parseByteRange', () => {
  it('parses open, bounded, suffix and missing ranges, rejecting multi-ranges and malformed headers', () => {
    expect(parseByteRange(undefined, 100)).toEqual({ kind: 'ok', start: 0, end: null, ranged: false });
    expect(parseByteRange('bytes=0-', 100)).toEqual({ kind: 'ok', start: 0, end: null, ranged: true });
    expect(parseByteRange('bytes=0-1', 100)).toEqual({ kind: 'ok', start: 0, end: 1, ranged: true });
    expect(parseByteRange('bytes=-20', 100)).toEqual({ kind: 'ok', start: 80, end: 99, ranged: true });
    expect(parseByteRange('bytes=10-5', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=0-1, 4-5', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('items=0-5', 100)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('serveMedia', () => {
  it('translates an open Range: bytes=0- into bounded upstream 206s and streams the full body', async () => {
    const source = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const gv = fakeGooglevideo(source);
    const ex = fakeExchange({
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=0-', origin: 'http://localhost:8080' },
    });

    await serveMedia(ex.request, ex.response, {
      fetchImpl: gv.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(['http://localhost:8080']),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });

    expect(gv.seenRanges).toEqual(['bytes=0-3', 'bytes=4-7', 'bytes=8-9']);
    expect(new Headers(gv.seenInits[0]?.headers).get('user-agent')).toBe(CHROMIUM_USER_AGENT);
    expect(gv.seenInits[0]?.credentials).toBe('omit');
    expect(ex.status).toBe(206);
    expect(ex.headers['content-type']).toBe('audio/webm');
    expect(ex.headers['content-range']).toBe('bytes 0-9/10');
    expect(ex.headers['content-length']).toBe('10');
    expect(ex.headers['accept-ranges']).toBe('bytes');
    expect(ex.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect([...ex.bodyBytes()]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ex.ended).toBe(true);
    expect(ex.destroyed).toBe(false);
  });

  it('serves Safari probe ranges (bytes=0-1) and mid-track seeks (bytes=5-) accurately', async () => {
    const source = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const gv = fakeGooglevideo(source);

    const probe = fakeExchange({
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=0-1' },
    });
    await serveMedia(probe.request, probe.response, {
      fetchImpl: gv.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });
    expect(probe.status).toBe(206);
    expect(probe.headers['content-range']).toBe('bytes 0-1/10');
    expect(probe.headers['content-length']).toBe('2');
    expect([...probe.bodyBytes()]).toEqual([10, 11]);

    gv.seenRanges.length = 0;
    const seek = fakeExchange({
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=5-' },
    });
    await serveMedia(seek.request, seek.response, {
      fetchImpl: gv.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 3,
    });
    expect(gv.seenRanges).toEqual(['bytes=5-7', 'bytes=8-9']);
    expect(seek.status).toBe(206);
    expect(seek.headers['content-range']).toBe('bytes 5-9/10');
    expect(seek.headers['content-length']).toBe('5');
    expect([...seek.bodyBytes()]).toEqual([15, 16, 17, 18, 19]);
  });

  it('answers HEAD with headers only and fetches just one probe chunk', async () => {
    const source = new Uint8Array(10);
    const gv = fakeGooglevideo(source);
    const ex = fakeExchange({
      method: 'HEAD',
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=0-' },
    });

    await serveMedia(ex.request, ex.response, {
      fetchImpl: gv.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });

    expect(gv.seenRanges).toEqual(['bytes=0-3']);
    expect(ex.status).toBe(206);
    expect(ex.headers['content-range']).toBe('bytes 0-9/10');
    expect(ex.headers['content-length']).toBe('10');
    expect(ex.bodyBytes().byteLength).toBe(0);
  });

  it('rejects non-googlevideo URLs, missing parameters and disallowed methods before touching fetch', async () => {
    let called = 0;
    const neverFetch: typeof globalThis.fetch = async () => {
      called++;
      return new Response();
    };
    const deps = {
      fetchImpl: neverFetch,
      limiter: new IpLimiter(),
      allowedOrigins: new Set<string>(),
      clientIp: '127.0.0.1',
    };

    const missing = fakeExchange({ url: '/media' });
    await serveMedia(missing.request, missing.response, deps);
    expect(missing.status).toBe(400);

    const badHost = fakeExchange({ url: `/media?u=${encodeURIComponent('https://evil.example/videoplayback')}` });
    await serveMedia(badHost.request, badHost.response, deps);
    expect(badHost.status).toBe(403);

    const badPath = fakeExchange({ url: `/media?u=${encodeURIComponent('https://googlevideo.com/other')}` });
    await serveMedia(badPath.request, badPath.response, deps);
    expect(badPath.status).toBe(403);

    const badVerb = fakeExchange({ method: 'POST', url: `/media?u=${encodeURIComponent(VALID_URL)}` });
    await serveMedia(badVerb.request, badVerb.response, deps);
    expect(badVerb.status).toBe(405);

    expect(called).toBe(0);
  });

  it('enforces the per-IP rate limiter', async () => {
    const limiter = new IpLimiter(() => 0);
    for (let i = 0; i < RATE_BURST; i++) expect(limiter.take('10.0.0.1')).toBe(0);

    const gv = fakeGooglevideo(new Uint8Array(10));
    const ex = fakeExchange({ url: `/media?u=${encodeURIComponent(VALID_URL)}` });
    await serveMedia(ex.request, ex.response, {
      fetchImpl: gv.fetchImpl,
      limiter,
      allowedOrigins: new Set(),
      clientIp: '10.0.0.1',
    });

    expect(ex.status).toBe(429);
    expect(Number(ex.headers['retry-after'])).toBeGreaterThan(0);
    expect(gv.seenRanges).toEqual([]);
  });

  it('forwards an initial upstream 403 and destroys the stream on a mid-track 403', async () => {
    const source = new Uint8Array(10);
    const initialFail = fakeGooglevideo(source, { failAtOffset: 0 });
    const ex1 = fakeExchange({
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=0-' },
    });
    await serveMedia(ex1.request, ex1.response, {
      fetchImpl: initialFail.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });
    expect(ex1.status).toBe(403);

    const midFail = fakeGooglevideo(source, { failAtOffset: 4 });
    const ex2 = fakeExchange({
      url: `/media?u=${encodeURIComponent(VALID_URL)}`,
      headers: { range: 'bytes=0-' },
    });
    await serveMedia(ex2.request, ex2.response, {
      fetchImpl: midFail.fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });
    expect(ex2.status).toBe(206);
    expect(ex2.bodyBytes().byteLength).toBe(4);
    expect(ex2.destroyed).toBe(true);
    expect(ex2.ended).toBe(false);
  });

  it('stops requesting further chunks as soon as the client disconnects', async () => {
    const source = new Uint8Array(12);
    const seenRanges: string[] = [];
    let exRef!: ReturnType<typeof fakeExchange>;
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? '';
      seenRanges.push(range);
      if (seenRanges.length === 1) exRef.disconnectClient();
      return new Response(new Uint8Array(4), {
        status: 206,
        headers: { 'content-type': 'audio/webm', 'content-range': 'bytes 0-3/12' },
      });
    };
    exRef = fakeExchange({
      url: `/media?u=${encodeURIComponent('https://googlevideo.com/videoplayback?clen=12')}`,
      headers: { range: 'bytes=0-' },
    });
    await serveMedia(exRef.request, exRef.response, {
      fetchImpl,
      limiter: new IpLimiter(),
      allowedOrigins: new Set(),
      clientIp: '127.0.0.1',
      chunkBytes: 4,
    });
    expect(seenRanges).toEqual(['bytes=0-3']);
  });
});
