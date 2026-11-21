import { describe, expect, it, vi } from 'vitest';
import { RelayCache } from './cache.js';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL, isBridgeRequest, type BridgeRequest } from './contract.js';
import { dispatchDeps, handle, RELAY_CAPABILITIES } from './dispatch.js';
import { CHROMIUM_USER_AGENT } from './hosts.js';
import { VERSION } from './version.js';

/**
 * The dispatcher's behaviour, with the upstream fetch stubbed: the method
 * table of web/docs/relay.md, its refusals and its serialisation. No test
 * here touches the network.
 */

function request(method: string, params: unknown, protocol: number = BRIDGE_PROTOCOL): BridgeRequest {
  return { channel: BRIDGE_CHANNEL, protocol, direction: 'to-extension', id: 'test', method, params };
}

/** A dispatcher wired to a recording fetch and a clock the test can move. */
function makeDeps(respond?: (url: string) => Response) {
  const fetches: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    fetches.push({ url, init });
    return (
      respond?.(url) ??
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
  });
  let now = 0;
  return {
    fetches,
    advance: (ms: number) => {
      now += ms;
    },
    deps: { fetchImpl, cache: new RelayCache({ clock: () => now }) },
  };
}

/** The outgoing headers of the first proxied call, as a plain record. */
function sentHeaders(fetches: ReadonlyArray<{ init: RequestInit | undefined }>): Record<string, string> {
  const headers = fetches[0]?.init?.headers;
  expect(headers).toBeDefined();
  return headers as Record<string, string>;
}

describe('envelope', () => {
  it('refuses a protocol the relay does not speak', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('ping', {}, BRIDGE_PROTOCOL + 1), deps);
    expect(answer).toMatchObject({
      ok: false,
      id: 'test',
      error: { code: 'protocol', message: expect.stringContaining(String(BRIDGE_PROTOCOL + 1)) },
    });
  });

  it('validates the envelope the same way the shared isBridgeRequest does', () => {
    const base = { channel: BRIDGE_CHANNEL, protocol: BRIDGE_PROTOCOL, direction: 'to-extension', id: 't', method: 'ping', params: {} };
    expect(isBridgeRequest(base)).toBe(true);
    expect(isBridgeRequest({ ...base, channel: 'other' })).toBe(false);
    expect(isBridgeRequest({ ...base, direction: 'to-page' })).toBe(false);
    expect(isBridgeRequest({ ...base, id: 7 })).toBe(false);
    expect(isBridgeRequest('not an object')).toBe(false);
  });
});

describe('ping', () => {
  it('answers the relay identity from relay.md', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('ping', {}), deps);
    expect(answer).toMatchObject({
      ok: true,
      result: { version: VERSION, protocol: BRIDGE_PROTOCOL, browser: 'server', capabilities: ['yt', 'addon', 'lyrics'] },
    });
  });

  it('claims nothing identity-shaped', () => {
    expect(RELAY_CAPABILITIES).not.toContain('yt.auth');
    expect(RELAY_CAPABILITIES).not.toContain('yt.stats');
    expect(RELAY_CAPABILITIES).not.toContain('spotify');
    expect(RELAY_CAPABILITIES).not.toContain('discord');
  });

  it('reads the version out of package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('yt.fetch', () => {
  it('refuses to sign, and says where signing lives', async () => {
    const { deps, fetches } = makeDeps();
    const answer = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      deps,
    );
    expect(answer).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated', message: "The relay can't sign YouTube requests. The extension can." },
    });
    expect(fetches).toHaveLength(0);
  });

  it('refuses every host the table does not allow', async () => {
    const { deps, fetches } = makeDeps();
    for (const url of [
      'https://evil.example.com/youtubei/v1/player',
      'https://rr1---sn-x.googlevideo.com/videoplayback',
      'http://www.youtube.com/youtubei/v1/player', // https only
      'https://youtube.com/youtubei/v1/player', // the table names www and music
      'https://music.youtube.com/sw.js_data', // music serves InnerTube only
      'https://www.youtube.com/watch',
    ]) {
      const answer = await handle(request('yt.fetch', { url }), deps);
      expect(answer, url).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    expect(fetches).toHaveLength(0);
  });

  it('impersonates the web client on www InnerTube and drops identity headers', async () => {
    const { deps, fetches } = makeDeps();
    const answer = await handle(
      request('yt.fetch', {
        url: 'https://www.youtube.com/youtubei/v1/player?alt=json',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: '*/*',
          cookie: 'SAPISID=smuggled',
          authorization: 'Bearer smuggled',
          'x-goog-authuser': '1',
          'x-goog-visitor-id': 'smuggled',
          'user-agent': 'attacker/1.0',
          host: 'www.youtube.com',
        },
        body: '{"videoId":"x"}',
      }),
      deps,
    );
    expect(answer).toMatchObject({ ok: true, result: { status: 200, bodyEncoding: 'text', body: '{"ok":true}' } });
    const headers = sentHeaders(fetches);
    expect(headers['origin']).toBe('https://www.youtube.com');
    expect(headers['referer']).toBe('https://www.youtube.com/');
    expect(headers['x-origin']).toBe('https://www.youtube.com');
    expect(headers['user-agent']).toBe(CHROMIUM_USER_AGENT);
    expect(headers['accept']).toBe('*/*');
    expect(headers['content-type']).toBe('application/json');
    // Identity never crosses: no cookies, no bearer, no YouTube identity headers, no host.
    for (const dropped of ['cookie', 'authorization', 'x-goog-authuser', 'x-goog-visitor-id', 'host']) {
      expect(headers[dropped], dropped).toBeUndefined();
    }
    expect(fetches[0]?.init?.body).toBe('{"videoId":"x"}');
  });

  it('impersonates the music client on music InnerTube', async () => {
    const { deps, fetches } = makeDeps();
    await handle(request('yt.fetch', { url: 'https://music.youtube.com/youtubei/v1/player' }), deps);
    const headers = sentHeaders(fetches);
    expect(headers['origin']).toBe('https://music.youtube.com');
    expect(headers['referer']).toBe('https://music.youtube.com/');
    expect(headers['x-origin']).toBe('https://music.youtube.com');
  });

  it('dresses BotGuard with Origin and Referer only', async () => {
    const { deps, fetches } = makeDeps();
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/api/jnn/GenerateIT' }), deps);
    const headers = sentHeaders(fetches);
    expect(headers['origin']).toBe('https://www.youtube.com');
    expect(headers['referer']).toBe('https://www.youtube.com/');
    expect(headers['x-origin']).toBeUndefined();
  });

  it('leaves the session bootstrap plain and caches it', async () => {
    const { deps, fetches } = makeDeps();
    const first = await handle(request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }), deps);
    const headers = sentHeaders(fetches);
    for (const absent of ['origin', 'referer', 'x-origin']) {
      expect(headers[absent], absent).toBeUndefined();
    }
    const second = await handle(request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }), deps);
    expect(fetches).toHaveLength(1); // the 10-minute family
    expect(second).toEqual(first);
  });

  it('caches youtubei JSON for two minutes only', async () => {
    const { deps, fetches, advance } = makeDeps();
    const url = 'https://www.youtube.com/youtubei/v1/browse';
    await handle(request('yt.fetch', { url }), deps);
    await handle(request('yt.fetch', { url }), deps);
    expect(fetches).toHaveLength(1);
    advance(2 * 60_000 + 1);
    await handle(request('yt.fetch', { url }), deps);
    expect(fetches).toHaveLength(2);
  });

  it('decodes base64 request bodies', async () => {
    const { deps, fetches } = makeDeps();
    const bytes = new Uint8Array([1, 2, 250, 255]);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await handle(
      request('yt.fetch', {
        url: 'https://www.youtube.com/youtubei/v1/player',
        method: 'POST',
        body: btoa(binary),
        bodyEncoding: 'base64',
      }),
      deps,
    );
    expect(fetches[0]?.init?.body).toEqual(bytes);
  });
});

describe('addon.fetch', () => {
  it('serves any https URL and no others', async () => {
    const { deps, fetches } = makeDeps();
    const refused = await handle(request('addon.fetch', { url: 'http://example.com/manifest.json' }), deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const served = await handle(request('addon.fetch', { url: 'https://example.com/manifest.json' }), deps);
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    expect(fetches).toHaveLength(1);
  });

  it('sends no cookies and pins the browser user agent', async () => {
    const { deps, fetches } = makeDeps();
    await handle(
      request('addon.fetch', {
        url: 'https://example.com/manifest.json',
        headers: { cookie: 'session=smuggled', 'user-agent': 'attacker/1.0' },
      }),
      deps,
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBeUndefined();
    expect(headers['user-agent']).toBe(CHROMIUM_USER_AGENT);
  });

  it('caches JSON manifests for five minutes, streams never', async () => {
    const { deps, fetches, advance } = makeDeps();
    const respond = (url: string) =>
      url.endsWith('.mp3')
        ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const wired = makeDeps(respond);
    const manifest = 'https://example.com/manifest.json';
    await handle(request('addon.fetch', { url: manifest }), wired.deps);
    await handle(request('addon.fetch', { url: manifest }), wired.deps);
    expect(wired.fetches).toHaveLength(1);
    wired.advance(5 * 60_000 + 1);
    await handle(request('addon.fetch', { url: manifest }), wired.deps);
    expect(wired.fetches).toHaveLength(2);
    const stream = 'https://example.com/track.mp3';
    await handle(request('addon.fetch', { url: stream }), wired.deps);
    await handle(request('addon.fetch', { url: stream }), wired.deps);
    expect(wired.fetches).toHaveLength(4);
    expect(fetches).toHaveLength(0); // the default-wired dispatcher was never used in this test
  });
});

describe('lyrics.fetch', () => {
  it('serves only the LYRIC_ORIGINS hosts', async () => {
    const { deps, fetches } = makeDeps();
    const refused = await handle(request('lyrics.fetch', { url: 'https://evil.example.com/lyrics' }), deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const served = await handle(request('lyrics.fetch', { url: 'https://lrclib.net/api/search' }), deps);
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    expect(fetches).toHaveLength(1);
  });

  it('never caches, and needs no permission grants', async () => {
    const { deps, fetches } = makeDeps();
    const url = 'https://lrclib.net/api/search';
    await handle(request('lyrics.fetch', { url }), deps);
    await handle(request('lyrics.fetch', { url }), deps);
    expect(fetches).toHaveLength(2);
  });
});

describe('the static states', () => {
  it('answers YouTube as signed out', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('yt.authState', {}), deps);
    expect(answer).toMatchObject({
      ok: true,
      result: {
        browserSignedIn: false,
        connected: false,
        signedIn: false,
        accounts: [],
        active: null,
        problem: null,
      },
    });
  });

  it('answers Spotify as signed out', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('spotify.authState', {}), deps);
    expect(answer).toMatchObject({
      ok: true,
      result: { browserSignedIn: false, connected: false, signedIn: false, user: null, problem: null },
    });
  });

  it('answers Discord as unavailable and off', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('discord.state', {}), deps);
    expect(answer).toMatchObject({
      ok: true,
      result: { available: false, connected: false, enabled: false, user: null, gateway: 'off', problem: null },
    });
  });
});

describe('permissions and the unsupported rest', () => {
  it('echoes the requested origins that are allowlisted', async () => {
    const { deps } = makeDeps();
    const answer = await handle(
      request('lyrics.permissions', { origins: ['https://lrclib.net', 'https://evil.example', 'https://genius.com'] }),
      deps,
    );
    expect(answer).toMatchObject({ ok: true, result: { granted: ['https://lrclib.net', 'https://genius.com'] } });
  });

  it('survives malformed permissions params', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('lyrics.permissions', { origins: 'not-a-list' }), deps);
    expect(answer).toMatchObject({ ok: true, result: { granted: [] } });
  });

  it('answers lyrics.requestPermissions as the no-op it is', async () => {
    const { deps } = makeDeps();
    const answer = await handle(request('lyrics.requestPermissions', { origins: ['https://lrclib.net'] }), deps);
    expect(answer).toMatchObject({ ok: true, result: {} });
  });

  it('answers every identity-holding method as unsupported', async () => {
    const { deps, fetches } = makeDeps();
    for (const method of ['yt.selectChannel', 'yt.setConnected', 'spotify.playlists', 'discord.presence', 'no.such.method']) {
      const answer = await handle(request(method, {}), deps);
      expect(answer, method).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    }
    expect(fetches).toHaveLength(0);
  });
});

describe('failure mapping', () => {
  it('maps upstream TypeErrors to network, as the extension does', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const deps = { fetchImpl, cache: new RelayCache() };
    const answer = await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps);
    expect(answer).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('maps the upstream timeout to network', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    const deps = { fetchImpl, cache: new RelayCache() };
    const answer = await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps);
    expect(answer).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('keeps unknown errors internal rather than leaking a wrong code', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('boom')));
    const deps = { fetchImpl, cache: new RelayCache() };
    const answer = await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps);
    expect(answer).toMatchObject({ ok: false, error: { code: 'internal', message: 'boom' } });
  });

  it('refuses requests that are not the page speaking', async () => {
    const { deps, fetches } = makeDeps();
    const noUrl = await handle(request('yt.fetch', {}), deps);
    expect(noUrl).toMatchObject({ ok: false, error: { code: 'protocol' } });
    const badVerb = await handle(request('addon.fetch', { url: 'https://example.com/x', method: 'PUT' }), deps);
    expect(badVerb).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(fetches).toHaveLength(0);
  });
});

describe('the server wiring', () => {
  it('ships a real fetch and a shared cache', () => {
    expect(typeof dispatchDeps.fetchImpl).toBe('function');
    expect(dispatchDeps.cache).toBeInstanceOf(RelayCache);
  });
});
