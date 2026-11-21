/**
 * The relay's abuse limits (relay.md "Abuse limits"): a per-IP token bucket,
 * a request-body cap, a response cap and an upstream timeout. A public relay
 * without these is a free CORS proxy; with them, the worst a caller can do is
 * what one browser's page would do.
 */

/** 90 requests per minute sustained, refilled continuously. */
export const RATE_PER_MINUTE = 90;
/** The bucket's depth: 60 requests in one burst before the refill rate applies. */
export const RATE_BURST = 60;
/** Request bodies are capped at 64 KB; InnerTube bodies are small (relay.md). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Responses are capped at 8 MB; the player script is the largest thing fetched. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** An upstream that hasn't answered within 15 s is not going to. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * A classic lazy token bucket: the refill is computed from the elapsed time
 * on each take, so no timer runs and an idle bucket costs nothing.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.at = clock();
  }

  /**
   * Takes one token. Returns 0 when it was taken, else the whole seconds
   * until one is available — the `Retry-After` the relay answers with.
   */
  take(): number {
    const now = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.at) * this.refillPerMs);
    this.at = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) / this.refillPerMs / 1000);
  }
}

/** How long an idle IP's bucket is kept before it is forgotten. */
const BUCKET_IDLE_MS = 120_000;
/** Buckets are only pruned past this count, so the common path stays O(1). */
const BUCKET_PRUNE_AT = 1024;

/** One TokenBucket per client IP, pruned when the map grows past a small bound. */
export class IpLimiter {
  private readonly buckets = new Map<string, { bucket: TokenBucket; usedAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** Takes one token for [ip]; 0 when it was taken, else the seconds to wait (`Retry-After`). */
  take(ip: string): number {
    const now = this.clock();
    if (this.buckets.size > BUCKET_PRUNE_AT) this.prune(now);
    let entry = this.buckets.get(ip);
    if (!entry) {
      entry = { bucket: new TokenBucket(RATE_BURST, RATE_PER_MINUTE / 60_000, this.clock), usedAt: now };
      this.buckets.set(ip, entry);
    }
    entry.usedAt = now;
    return entry.bucket.take();
  }

  private prune(now: number): void {
    for (const [ip, entry] of this.buckets) {
      if (now - entry.usedAt > BUCKET_IDLE_MS) this.buckets.delete(ip);
    }
  }
}

/** A request body that exceeded the cap. The transport answers HTTP 413 for it. */
export class BodyTooLargeError extends Error {
  constructor(capBytes: number) {
    super(`Bridge requests are capped at ${capBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** Just the request surface the body reader needs, so it is testable without a socket. */
export interface BodyStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Reads a request body, refusing more than [capBytes]. On refusal the caller
 * answers 413 and destroys the connection: a legitimate bridge call never
 * comes close to the cap, so anything over it is either abuse or a bug, and
 * draining it would only spend the relay's bandwidth.
 */
export function readBody(stream: BodyStream, capBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    stream.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    stream.on('data', (chunk) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > capBytes) {
        settled = true;
        reject(new BodyTooLargeError(capBytes));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(concatBytes(chunks, total));
    });
  });
}

/** Concatenates byte chunks into one array; `total` must be their summed length. */
export function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
