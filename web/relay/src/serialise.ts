import { concatBytes, MAX_RESPONSE_BYTES } from './limits.js';
import type { HttpResponse } from './contract.js';

/**
 * How an upstream `Response` becomes an `HttpResponse`: text bodies as
 * `bodyEncoding: 'text'`, everything else base64 — the encoding the page's
 * bridge client has always decoded (the contract learned it from the
 * extension's `ytFetch`, which is gone; the relay is the only writer now).
 */

/** An upstream response bigger than the relay is willing to buffer. */
export class ResponseTooLargeError extends Error {
  /** The dispatcher maps this to a bridge `network` error: the fetch is a failure, not a truncation. */
  readonly code = 'network';

  constructor(url: string, capBytes: number) {
    super(`${url} answered more than the relay's ${capBytes}-byte cap`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Decodes a base64 request body back to bytes (ytFetch.ts's toBytes). */
export function toBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Encodes bytes as base64 in chunks, so multi-megabyte bodies never blow the call stack (ytFetch.ts's toBase64). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Reads a response's body, refusing more than [capBytes]. The content-length
 * is checked first when the upstream states it, so an oversized answer costs
 * one header read rather than eight megabytes of streaming; a body without
 * one (chunked) is capped as it arrives.
 */
async function readCapped(response: Response, capBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > capBytes) {
    throw new ResponseTooLargeError(response.url, capBytes);
  }
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > capBytes) {
      // Stop the download rather than finish it; the call has already failed.
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(response.url, capBytes);
    }
    chunks.push(value);
  }
  return concatBytes(chunks, total);
}

/**
 * Serialises an upstream response for the page, exactly as the extension's
 * anonymous fetches do: headers lowercased, `content-type` deciding text vs
 * base64, and the final URL after redirects. The cap is enforced here so no
 * caller of `serialise` can forget it.
 */
export async function serialise(
  response: Response,
  capBytes: number = MAX_RESPONSE_BYTES,
): Promise<HttpResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  const type = response.headers.get('content-type') ?? '';
  // Same regex as ytFetch.ts: 'text' covers text/*, so HTML is text too.
  const textual = /json|text|javascript|xml/.test(type);
  const bytes = await readCapped(response, capBytes);
  return {
    status: response.status,
    headers,
    url: response.url,
    bodyEncoding: textual ? 'text' : 'base64',
    body: textual ? new TextDecoder().decode(bytes) : toBase64(bytes),
  };
}
