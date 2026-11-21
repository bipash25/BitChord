import type { HttpResponse } from './contract.js';

/**
 * The relay's response cache (relay.md "Abuse limits" → Cache): GETs only,
 * in-memory, LRU, keyed by method + URL. Its job is to cut the InnerTube
 * request rate per user by most of the browsing chatter — the same session
 * bootstrap, the same player script, the same addon manifest, over and over —
 * which also softens the datacenter-IP problem every relay deployment has.
 *
 * TTLs per family:
 * - `/iframe_api` and the player script: 10 min. Session bootstrap cost,
 *   changing slowly. `sw.js_data` is deliberately excluded: caching it handed
 *   one shared `visitorData` across every listener, whereas Android's
 *   InnerTubeX treats per-session visitor data as load-bearing.
 * - `youtubei` JSON: 2 min. Fresh enough that browse and search don't serve
 *   yesterday, cached enough that a page reload doesn't re-ask.
 * - addon manifests: 5 min. The servers' own JSON indexes.
 *
 * The extension has no equivalent: it never had to, because the page's own
 * requests were free. lyrics.fetch is deliberately not cached — relay.md
 * lists only these three families, and lyric answers are small and
 * want to be fresh.
 */

const TTL_MS = {
  ytStatic: 10 * 60_000,
  ytInnertube: 2 * 60_000,
  addonManifest: 5 * 60_000,
} as const;

/** ≈512 entries (relay.md). */
const DEFAULT_CAPACITY = 512;
/**
 * A byte budget on top of the entry count: player scripts run to megabytes,
 * and 512 of those would be gigabytes. Entries hold serialised bodies, so
 * `body.length` is the right-enough cost (base64 inflates it ~33%, which
 * only makes the budget conservative).
 */
const DEFAULT_BYTE_BUDGET = 64 * 1024 * 1024;

/** The static part of a session bootstrap: iframe_api and the player script (never sw.js_data, which carries per-session visitorData). */
const YT_STATIC = /^https:\/\/www\.youtube\.com\/(iframe_api(\?|$)|s\/player\/)/;
/** InnerTube API calls on either YouTube origin. */
const YT_INNERTUBE = /^https:\/\/(music|www)\.youtube\.com\/youtubei\//;

/** The TTL for a stored response, or null when this method + URL is not cacheable. */
function ttlOf(method: string, url: string, contentType: string): number | null {
  const json = /json/.test(contentType);
  if (method === 'yt.fetch') {
    if (YT_STATIC.test(url)) return TTL_MS.ytStatic;
    if (YT_INNERTUBE.test(url) && json) return TTL_MS.ytInnertube;
    return null;
  }
  // An addon manifest is the JSON a GET returns; streams and other binaries pass through uncached.
  if (method === 'addon.fetch' && json) return TTL_MS.addonManifest;
  return null;
}

interface Entry {
  response: HttpResponse;
  expiresAt: number;
  bytes: number;
}

/** An LRU over `${method} ${url}` keys, each entry carrying its own expiry. */
export class RelayCache {
  private readonly entries = new Map<string, Entry>();
  private readonly capacity: number;
  private readonly byteBudget: number;
  private readonly clock: () => number;
  private totalBytes = 0;

  constructor(options: { capacity?: number; byteBudget?: number; clock?: () => number } = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.byteBudget = options.byteBudget ?? DEFAULT_BYTE_BUDGET;
    this.clock = options.clock ?? Date.now;
  }

  /** The cached response for a method + URL, or null. A hit is the most recently used. */
  lookup(method: string, url: string): HttpResponse | null {
    const key = `${method} ${url}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
      return null;
    }
    // LRU: move to the back of the Map, the end of the eviction order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.response;
  }

  /**
   * Stores a response if its family has a TTL. Only 200s: a cached error is
   * a lie that outlives its cause. The caller calls this for GETs only.
   */
  store(method: string, url: string, response: HttpResponse): void {
    const ttl = ttlOf(method, url, response.headers['content-type'] ?? '');
    if (ttl === null || response.status !== 200) return;
    const key = `${method} ${url}`;
    const previous = this.entries.get(key);
    if (previous) this.totalBytes -= previous.bytes;
    const entry: Entry = { response, expiresAt: this.clock() + ttl, bytes: response.body.length };
    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;
    this.evict();
  }

  /** Drops the oldest entries until both the count and byte budgets hold. */
  private evict(): void {
    while (this.entries.size > 1 && (this.entries.size > this.capacity || this.totalBytes > this.byteBudget)) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const entry = this.entries.get(oldest.value)!;
      this.entries.delete(oldest.value);
      this.totalBytes -= entry.bytes;
    }
  }
}
