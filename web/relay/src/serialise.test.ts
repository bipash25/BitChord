import { describe, expect, it } from 'vitest';
import { ResponseTooLargeError, serialise, toBase64, toBytes } from './serialise.js';

/**
 * The HttpResponse serialisation: the same text-vs-base64 decision the
 * extension's ytFetch.ts makes, plus the response cap the relay adds.
 */

describe('serialise', () => {
  it('serialises JSON as text', async () => {
    const response = new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    const result = await serialise(response, 1024);
    expect(result).toMatchObject({ status: 200, bodyEncoding: 'text', body: '{"a":1}' });
    expect(result.headers['content-type']).toBe('application/json');
  });

  it('serialises text/* as text, HTML included', async () => {
    const response = new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const result = await serialise(response, 1024);
    expect(result.bodyEncoding).toBe('text');
    expect(result.body).toBe('<html></html>');
  });

  it('serialises everything else as base64, bytes intact', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const response = new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    const result = await serialise(response, 1024);
    expect(result.bodyEncoding).toBe('base64');
    expect(Array.from(toBytes(result.body))).toEqual(Array.from(bytes));
  });

  it('treats a missing content-type as binary', async () => {
    // A stream body carries no content-type unless the caller set one;
    // undici would have filled one in for a plain string.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('plain'));
        controller.close();
      },
    });
    const response = new Response(body);
    const result = await serialise(response, 1024);
    expect(result.bodyEncoding).toBe('base64');
  });

  it('carries non-2xx statuses the extension callers rely on', async () => {
    const response = new Response('no', { status: 403, headers: { 'content-type': 'text/plain' } });
    const result = await serialise(response, 1024);
    expect(result.status).toBe(403);
  });

  it('reports the final URL after redirects', async () => {
    const response = new Response('x', { headers: { 'content-type': 'text/plain' } });
    // A constructed Response has no url of its own; pin one the way a fetched one would carry it.
    Object.defineProperty(response, 'url', { value: 'https://www.youtube.com/final' });
    const result = await serialise(response, 1024);
    expect(result.url).toBe('https://www.youtube.com/final');
  });

  it('refuses a response over the cap before reading it all', async () => {
    const response = new Response('x'.repeat(100), { headers: { 'content-type': 'text/plain' } });
    await expect(serialise(response, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('refuses a chunked response over the cap while it streams', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64).fill(1));
        controller.close();
      },
    });
    const response = new Response(body, { headers: { 'content-type': 'application/octet-stream' } });
    await expect(serialise(response, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
});

describe('the base64 pair', () => {
  it('round-trips bytes across the 0x8000 chunk boundary', () => {
    const bytes = new Uint8Array(0x8000 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    expect(Array.from(toBytes(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
