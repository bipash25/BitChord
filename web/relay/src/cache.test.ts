import { describe, expect, it } from 'vitest';
import { RelayCache } from './cache.js';
import type { HttpResponse } from './contract.js';

/** The GET-only LRU: its families, TTLs, recency and budgets. */

const responseOf = (body: string, contentType: string): HttpResponse => ({
  status: 200,
  headers: { 'content-type': contentType },
  body,
  bodyEncoding: 'text',
  url: 'https://www.youtube.com/x',
});

describe('RelayCache', () => {
  it('misses, then stores, then hits', () => {
    let now = 0;
    const cache = new RelayCache({ clock: () => now });
    const url = 'https://www.youtube.com/iframe_api';
    expect(cache.lookup('yt.fetch', url)).toBeNull();
    const response = responseOf('bootstrap', 'text/javascript');
    cache.store('yt.fetch', url, response);
    expect(cache.lookup('yt.fetch', url)).toBe(response);
  });

  it('never caches sw.js_data so each session gets its own visitorData', () => {
    const cache = new RelayCache();
    const url = 'https://www.youtube.com/sw.js_data';
    cache.store('yt.fetch', url, responseOf('visitor', 'application/json'));
    expect(cache.lookup('yt.fetch', url)).toBeNull();
  });

  it('keys by method and URL together', () => {
    const cache = new RelayCache();
    const response = responseOf('m', 'application/json');
    cache.store('yt.fetch', 'https://www.youtube.com/youtubei/v1/x', response);
    expect(cache.lookup('addon.fetch', 'https://www.youtube.com/youtubei/v1/x')).toBeNull();
  });

  it('expires the static bootstrap assets after ten minutes', () => {
    let now = 0;
    const cache = new RelayCache({ clock: () => now });
    const url = 'https://www.youtube.com/iframe_api';
    cache.store('yt.fetch', url, responseOf('s', 'text/javascript'));
    now = 10 * 60_000;
    expect(cache.lookup('yt.fetch', url)).toBeNull();
  });

  it('expires youtubei JSON after two minutes', () => {
    let now = 0;
    const cache = new RelayCache({ clock: () => now });
    const url = 'https://www.youtube.com/youtubei/v1/player';
    cache.store('yt.fetch', url, responseOf('{}', 'application/json'));
    now = 2 * 60_000;
    expect(cache.lookup('yt.fetch', url)).toBeNull();
  });

  it('expires addon manifests after five minutes', () => {
    let now = 0;
    const cache = new RelayCache({ clock: () => now });
    const url = 'https://example.com/manifest.json';
    cache.store('addon.fetch', url, responseOf('{}', 'application/json'));
    now = 5 * 60_000;
    expect(cache.lookup('addon.fetch', url)).toBeNull();
  });

  it('stores only 200s: an error is never replayed', () => {
    const cache = new RelayCache();
    cache.store('yt.fetch', 'https://www.youtube.com/iframe_api', { ...responseOf('x', 'text/plain'), status: 503 });
    expect(cache.lookup('yt.fetch', 'https://www.youtube.com/iframe_api')).toBeNull();
  });

  it('caches youtubei only when the answer is JSON', () => {
    const cache = new RelayCache();
    const url = 'https://www.youtube.com/youtubei/v1/player';
    cache.store('yt.fetch', url, responseOf('raw', 'application/octet-stream'));
    expect(cache.lookup('yt.fetch', url)).toBeNull();
  });

  it('never caches lyrics', () => {
    const cache = new RelayCache();
    const url = 'https://lrclib.net/api/get';
    cache.store('lyrics.fetch', url, responseOf('{}', 'application/json'));
    expect(cache.lookup('lyrics.fetch', url)).toBeNull();
  });

  it('never caches yt URLs outside the families', () => {
    const cache = new RelayCache();
    cache.store('yt.fetch', 'https://www.youtube.com/api/jnn/GenerateIT', responseOf('{}', 'application/json'));
    expect(cache.lookup('yt.fetch', 'https://www.youtube.com/api/jnn/GenerateIT')).toBeNull();
  });

  it('evicts the least recently used past the capacity', () => {
    let now = 0;
    const cache = new RelayCache({ capacity: 2, clock: () => now });
    const a = 'https://www.youtube.com/s/player/0/base.js';
    const b = 'https://www.youtube.com/iframe_api';
    const c = 'https://www.youtube.com/s/player/1/base.js';
    cache.store('yt.fetch', a, responseOf('a', 'text/javascript'));
    cache.store('yt.fetch', b, responseOf('b', 'text/javascript'));
    expect(cache.lookup('yt.fetch', a)).not.toBeNull(); // a is now the most recent
    cache.store('yt.fetch', c, responseOf('c', 'text/javascript'));
    expect(cache.lookup('yt.fetch', b)).toBeNull(); // b was the least recent
    expect(cache.lookup('yt.fetch', a)).not.toBeNull();
    expect(cache.lookup('yt.fetch', c)).not.toBeNull();
  });

  it('evicts by bytes past the byte budget', () => {
    let now = 0;
    const cache = new RelayCache({ byteBudget: 10, clock: () => now });
    const a = 'https://www.youtube.com/s/player/0/base.js';
    const b = 'https://www.youtube.com/iframe_api';
    cache.store('yt.fetch', a, responseOf('12345678', 'text/javascript')); // 8 bytes
    cache.store('yt.fetch', b, responseOf('12345678', 'text/javascript')); // 16 > 10
    expect(cache.lookup('yt.fetch', a)).toBeNull();
    expect(cache.lookup('yt.fetch', b)).not.toBeNull();
  });

  it('refreshes the TTL when a URL is stored again', () => {
    let now = 0;
    const cache = new RelayCache({ clock: () => now });
    const url = 'https://www.youtube.com/iframe_api';
    cache.store('yt.fetch', url, responseOf('first', 'text/javascript'));
    now = 9 * 60_000;
    cache.store('yt.fetch', url, responseOf('second', 'text/javascript'));
    now = 12 * 60_000; // 3 minutes after the refresh, 12 after the first store
    expect(cache.lookup('yt.fetch', url)?.body).toBe('second');
  });
});
