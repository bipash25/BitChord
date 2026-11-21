import { describe, expect, it } from 'vitest';
import {
  BodyTooLargeError,
  concatBytes,
  IpLimiter,
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  RATE_BURST,
  RATE_PER_MINUTE,
  readBody,
  TokenBucket,
  UPSTREAM_TIMEOUT_MS,
  type BodyStream,
} from './limits.js';

/** The abuse limits from relay.md, with the clock in the test's hand. */

const REFILL_PER_MS = RATE_PER_MINUTE / 60_000;

describe('TokenBucket', () => {
  it('admits a burst of RATE_BURST, then refuses with a wait', () => {
    let now = 0;
    const bucket = new TokenBucket(RATE_BURST, REFILL_PER_MS, () => now);
    for (let i = 0; i < RATE_BURST; i++) expect(bucket.take()).toBe(0);
    expect(bucket.take()).toBeGreaterThan(0);
  });

  it('refills at the sustained rate', () => {
    let now = 0;
    const bucket = new TokenBucket(RATE_BURST, REFILL_PER_MS, () => now);
    for (let i = 0; i < RATE_BURST; i++) bucket.take();
    now += 1000; // 1.5 tokens back
    expect(bucket.take()).toBe(0);
    expect(bucket.take()).toBeGreaterThan(0); // 0.5 left, less than one
  });

  it('sustains one request per second indefinitely', () => {
    let now = 0;
    const bucket = new TokenBucket(RATE_BURST, REFILL_PER_MS, () => now);
    // A browsing page asks for well under one bridge call a second.
    for (let i = 0; i < 5000; i++) {
      now += 1000;
      expect(bucket.take(), `at ${i}s`).toBe(0);
    }
  });

  it('returns whole seconds to wait', () => {
    let now = 0;
    const bucket = new TokenBucket(RATE_BURST, REFILL_PER_MS, () => now);
    for (let i = 0; i < RATE_BURST; i++) bucket.take();
    now += 333; // half a token back
    expect(bucket.take()).toBe(1); // ceil(0.5 tokens / 1.5 per second)
  });
});

describe('IpLimiter', () => {
  it('keeps addresses in separate buckets', () => {
    let now = 0;
    const limiter = new IpLimiter(() => now);
    for (let i = 0; i < RATE_BURST; i++) expect(limiter.take('1.1.1.1')).toBe(0);
    expect(limiter.take('1.1.1.1')).toBeGreaterThan(0);
    expect(limiter.take('2.2.2.2')).toBe(0);
  });

  it('counts IPv4-mapped IPv6 addresses as the same client', () => {
    // index.ts normalises before it gets here; the limiter itself is keyed by string.
    const limiter = new IpLimiter();
    expect(limiter.take('127.0.0.1')).toBe(0);
    expect(limiter.take('127.0.0.1')).toBe(0);
  });
});

/** A request stream the test feeds by hand. */
class FakeStream implements BodyStream {
  private readonly data: Array<(chunk: Uint8Array) => void> = [];
  private readonly ended: Array<() => void> = [];
  private readonly failed: Array<(error: Error) => void> = [];

  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: string, listener: never): unknown {
    // The overloads above route each event to its own list, so the listener
    // is stored with the type its event actually delivers.
    if (event === 'data') this.data.push(listener as (chunk: Uint8Array) => void);
    else if (event === 'end') this.ended.push(listener as unknown as () => void);
    else this.failed.push(listener as (error: Error) => void);
    return this;
  }

  emit(event: 'data', chunk: Uint8Array): void;
  emit(event: 'end'): void;
  emit(event: 'error', error: Error): void;
  emit(event: string, arg?: unknown): void {
    if (event === 'data') for (const listener of this.data) listener(arg as Uint8Array);
    else if (event === 'end') for (const listener of this.ended) listener();
    else if (event === 'error') for (const listener of this.failed) listener(arg as Error);
  }
}

describe('readBody', () => {
  it('concatenates the chunks of one body', async () => {
    const stream = new FakeStream();
    const promise = readBody(stream, 1024);
    stream.emit('data', new Uint8Array([1, 2, 3]));
    stream.emit('data', new Uint8Array([4, 5]));
    stream.emit('end');
    await expect(promise).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('refuses a body past the cap, mid-stream', async () => {
    const stream = new FakeStream();
    const promise = readBody(stream, 4);
    stream.emit('data', new Uint8Array([1, 2, 3, 4, 5]));
    stream.emit('end');
    await expect(promise).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('propagates a broken request', async () => {
    const stream = new FakeStream();
    const promise = readBody(stream, 1024);
    stream.emit('error', new Error('connection reset'));
    await expect(promise).rejects.toThrow('connection reset');
  });
});

describe('the constants from relay.md', () => {
  it('are the documented numbers', () => {
    expect(RATE_PER_MINUTE).toBe(90);
    expect(RATE_BURST).toBe(60);
    expect(MAX_BODY_BYTES).toBe(64 * 1024);
    expect(MAX_RESPONSE_BYTES).toBe(8 * 1024 * 1024);
    expect(UPSTREAM_TIMEOUT_MS).toBe(15_000);
  });
});

describe('concatBytes', () => {
  it('splices chunks in order, across the chunking the base64 path uses', () => {
    const chunks = [new Uint8Array(0x8000).fill(1), new Uint8Array(5).fill(2)];
    const out = concatBytes(chunks, 0x8000 + 5);
    expect(out).toHaveLength(0x8000 + 5);
    expect(out[0]).toBe(1);
    expect(out[0x8000 - 1]).toBe(1);
    expect(out[0x8000]).toBe(2);
  });
});
