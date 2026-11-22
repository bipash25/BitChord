import { describe, expect, it, vi } from 'vitest';
import { RelayCache } from './cache.js';
import { BRIDGE_CHANNEL, BRIDGE_PROTOCOL, isBridgeRequest, type BridgeRequest, type Capability, type HttpResponse } from './contract.js';
import { dispatchDeps, handle, FALLBACK_CAPABILITIES, RELAY_CAPABILITIES } from './dispatch.js';
import { FallbackCredential, parseCookieJar, sapisidhash } from './fallback.js';
import { CHROMIUM_USER_AGENT } from './hosts.js';
import { VERSION } from './version.js';

/**
 * The dispatcher's behaviour, with the upstream fetch stubbed: the method
 * table of web/docs/relay.md, its refusals and its serialisation, and the
 * fallback credential's part in it (web/docs/private-deployment.md). No test
 * here touches the network.
 */

function request(method: string, params: unknown, protocol: number = BRIDGE_PROTOCOL): BridgeRequest {
  return { channel: BRIDGE_CHANNEL, protocol, direction: 'to-extension', id: 'test', method, params };
}

/** A dispatcher wired to a recording fetch and a clock the test can move. */
function makeDeps(respond?: (url: string) => Response, fallback: FallbackCredential | null = null) {
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
    deps: { fetchImpl, cache: new RelayCache({ clock: () => now }), fallback },
  };
}

/** The outgoing headers of the first proxied call, as a plain record. */
function sentHeaders(fetches: ReadonlyArray<{ init: RequestInit | undefined }>): Record<string, string> {
  const headers = fetches[0]?.init?.headers;
  expect(headers).toBeDefined();
  return headers as Record<string, string>;
}

/**
 * A minimal account_menu answer: the header renderer the extension's ytAuth
 * read, with the same field shapes (runs/simpleText, thumbnails last-biggest).
 */
const ACCOUNT_MENU_BODY = JSON.stringify({
  responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '1' }] }] },
  actions: [
    {
      openPopupAction: {
        popup: {
          multiPageMenuRenderer: {
            header: {
              activeAccountHeaderRenderer: {
                accountName: { runs: [{ text: 'Burner One' }] },
                email: { simpleText: 'burner@example.com' },
                channelHandle: { runs: [{ text: '@burner' }] },
                accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/burner.png' }] },
              },
            },
          },
        },
      },
    },
  ],
});

/** A one-cookie jar with an obviously-secret value, distinct per use so leak hunts can't cross-contaminate. */
const burner = () => new FallbackCredential(parseCookieJar('.google.com\tTRUE\t/\tFALSE\t1893456000\tSAPISID\tburner-secret'));

/**
 * The visitor's page-held jar as the page sends it: raw `Cookie:` line text,
 * with values distinct from the burner's so precedence and leak hunts can
 * tell them apart. `USER_JAR_NO_SESSION` parses but holds no SAPISID-family
 * cookie — the can't-sign shape.
 */
const USER_JAR = 'Cookie: SID=user-sid; SAPISID=user-secret';
const USER_JAR_NO_SESSION = 'Cookie: GPS=only-a-visitor-cookie';

/**
 * The account_menu answer for the visitor's own account: the same field
 * shapes as the burner's body, an identity that is unmistakably somebody
 * else's.
 */
const USER_MENU_BODY = JSON.stringify({
  responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '1' }] }] },
  actions: [
    {
      openPopupAction: {
        popup: {
          multiPageMenuRenderer: {
            header: {
              activeAccountHeaderRenderer: {
                accountName: { runs: [{ text: 'Ada Lovelace' }] },
                email: { simpleText: 'ada@example.com' },
                channelHandle: { runs: [{ text: '@ada' }] },
                accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/ada.png' }] },
              },
            },
          },
        },
      },
    },
  ],
});

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

  it('claims the session families only when a fallback makes them real', () => {
    // The anonymous relay claims neither: it signs nothing.
    expect(RELAY_CAPABILITIES).not.toContain('yt.auth');
    expect(RELAY_CAPABILITIES).not.toContain('yt.stats');
    // The fallback-loaded relay claims exactly both — it signs auth calls and
    // the stats pings — and nothing outside the contract's vocabulary.
    expect(FALLBACK_CAPABILITIES).toContain('yt.auth');
    expect(FALLBACK_CAPABILITIES).toContain('yt.stats');
    const vocabulary: Capability[] = ['yt', 'yt.auth', 'yt.stats', 'addon', 'lyrics'];
    for (const capability of [...RELAY_CAPABILITIES, ...FALLBACK_CAPABILITIES]) {
      expect(vocabulary, capability).toContain(capability);
    }
  });

  it('reads the version out of package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('yt.fetch', () => {
  it('refuses to sign when no fallback is configured, and says so', async () => {
    const { deps, fetches } = makeDeps();
    const answer = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      deps,
    );
    expect(answer).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated', message: expect.stringContaining("The relay can't sign YouTube requests") },
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

  it('impersonates the web client on www InnerTube, forwarding the page-held bearer and dropping the rest of the identity headers', async () => {
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
    // The page's own Authorization is its per-call credential and travels
    // untouched; cookies, YouTube identity headers and host never cross.
    expect(headers['authorization']).toBe('Bearer smuggled');
    for (const dropped of ['cookie', 'x-goog-authuser', 'x-goog-visitor-id', 'host']) {
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

  it('leaves the static bootstrap plain and caches it, while sw.js_data stays uncached per session', async () => {
    const { deps, fetches } = makeDeps();
    const first = await handle(request('yt.fetch', { url: 'https://www.youtube.com/iframe_api' }), deps);
    const headers = sentHeaders(fetches);
    for (const absent of ['origin', 'referer', 'x-origin']) {
      expect(headers[absent], absent).toBeUndefined();
    }
    const second = await handle(request('yt.fetch', { url: 'https://www.youtube.com/iframe_api' }), deps);
    expect(fetches).toHaveLength(1); // the 10-minute family
    expect(second).toEqual(first);

    await handle(request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }), deps);
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }), deps);
    expect(fetches).toHaveLength(3); // never shared across sessions
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
  it('answers YouTube as signed out when no fallback is configured', async () => {
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

  it('answers ping with the session capabilities only when a fallback is loaded', async () => {
    const bare = await handle(request('ping', {}), makeDeps().deps);
    expect(bare).toMatchObject({ ok: true, result: { capabilities: RELAY_CAPABILITIES } });
    const signed = await handle(request('ping', {}), makeDeps(undefined, burner()).deps);
    expect(signed).toMatchObject({ ok: true, result: { capabilities: FALLBACK_CAPABILITIES } });
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

  it('answers every identity-holding method as unsupported — and the retired spotify family too', async () => {
    const { deps, fetches } = makeDeps();
    // spotify.authState used to be served; it must now fall through to the
    // same unsupported answer as anything else the relay has never heard of.
    for (const method of ['yt.selectChannel', 'yt.setConnected', 'spotify.authState', 'no.such.method']) {
      const answer = await handle(request(method, {}), deps);
      expect(answer, method).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    }
    expect(fetches).toHaveLength(0);
  });
});

describe('failure mapping', () => {
  it('maps upstream TypeErrors to network', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const deps = { fetchImpl, cache: new RelayCache(), fallback: null };
    const answer = await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps);
    expect(answer).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('maps the upstream timeout to network', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    const deps = { fetchImpl, cache: new RelayCache(), fallback: null };
    const answer = await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps);
    expect(answer).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('keeps unknown errors internal rather than leaking a wrong code', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('boom')));
    const deps = { fetchImpl, cache: new RelayCache(), fallback: null };
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

describe('the fallback credential (private-deployment.md)', () => {
  it('signs anonymous InnerTube calls with the jar, a SAPISIDHASH for the dressed origin, and X-Goog-AuthUser', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', body: '{"videoId":"x"}' }),
      deps,
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBe('SAPISID=burner-secret');
    expect(headers['authorization']).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers['x-goog-authuser']).toBe('0');
    // The impersonation still dresses the call; the page's own headers still ride along.
    expect(headers['origin']).toBe('https://www.youtube.com');
    expect(headers['referer']).toBe('https://www.youtube.com/');
  });

  it('builds the SAPISIDHASH for the origin the impersonation table picked', async () => {
    const credential = burner();
    const www = makeDeps(undefined, credential);
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), www.deps);
    const music = makeDeps(undefined, credential);
    await handle(request('yt.fetch', { url: 'https://music.youtube.com/youtubei/v1/player' }), music.deps);
    const sent = (fetches: ReadonlyArray<{ init: RequestInit | undefined }>) =>
      (fetches[0]?.init?.headers as Record<string, string>).authorization;
    expect(sent(www.fetches)).not.toBe(sent(music.fetches));
  });

  it('leaves the session bootstrap and BotGuard rows unsigned', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }), deps);
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/api/jnn/GenerateIT' }), deps);
    expect(fetches).toHaveLength(2);
    for (const call of fetches) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['cookie']).toBeUndefined();
      expect(headers['authorization']).toBeUndefined();
      expect(headers['x-goog-authuser']).toBeUndefined();
    }
  });

  it('leaves an unsigned-by-design client (VISIONOS) anonymous even under a fallback: a session attached to its call is refused outright', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(
      request('yt.fetch', {
        url: 'https://www.youtube.com/youtubei/v1/player',
        method: 'POST',
        // resolver.ts's VISIONOS body shape; the client name is what the skip reads.
        body: '{"context":{"client":{"clientName":"VISIONOS","clientVersion":"0.1"}},"videoId":"x"}',
      }),
      deps,
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-goog-authuser']).toBeUndefined();
    // The impersonation the call would have had without a fallback still applies.
    expect(headers['user-agent']).toBeDefined();
  });

  it('absorbs a rotation YouTube sends while serving a signed call, and Set-Cookie never reaches the page', async () => {
    const credential = burner();
    const { deps, fetches } = makeDeps(
      () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: [
            ['content-type', 'application/json'],
            ['set-cookie', '__Secure-1PSIDTS=rotated; Path=/; Domain=.youtube.com; Secure'],
          ],
        }),
      credential,
    );
    const logged: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    try {
      const url = 'https://www.youtube.com/youtubei/v1/player';
      const first = (await handle(request('yt.fetch', { url, method: 'POST', body: '{"videoId":"x"}' }), deps)) as {
        ok: boolean;
        result: HttpResponse;
      };
      // The rotation stays between the relay and YouTube: the envelope carries
      // no set-cookie at all, so no session material crosses to the page.
      expect(first.ok).toBe(true);
      expect(first.result.headers['set-cookie']).toBeUndefined();
      // The next signed call signs with the rotated value — the living jar.
      await handle(request('yt.fetch', { url, method: 'POST', body: '{"videoId":"y"}' }), deps);
      const second = (fetches[1]?.init?.headers ?? {}) as Record<string, string>;
      expect(second['cookie']).toContain('__Secure-1PSIDTS=rotated');
      // The rotation's log line — the operator's heartbeat for the living
      // jar — says the name and never the value or the jar it landed in.
      const line = logged.join('\n');
      expect(line).toContain('__Secure-1PSIDTS');
      expect(line).not.toContain('rotated');
      expect(line).not.toContain('burner-secret');
    } finally {
      log.mockRestore();
    }
  });

  it("leaves a call carrying the page's own Authorization untouched, and its answer out of the shared cache", async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    const url = 'https://www.youtube.com/youtubei/v1/player';
    await handle(request('yt.fetch', { url, headers: { authorization: 'Bearer page-token' } }), deps);
    const headers = sentHeaders(fetches);
    expect(headers['authorization']).toBe('Bearer page-token');
    expect(headers['cookie']).toBeUndefined();
    expect(headers['x-goog-authuser']).toBeUndefined();
    // A page-held credential is a different identity than the fallback, and
    // the credential can't be a cache key — so its answer is not stored, and
    // the anonymous call after it re-fetches rather than read it.
    await handle(request('yt.fetch', { url }), deps);
    expect(fetches).toHaveLength(2);
  });

  it("drops a page-supplied SAPISIDHASH: the relay's scheme is never the page's to speak", async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', headers: { authorization: 'SAPISIDHASH 1_forged' } }),
      deps,
    );
    const headers = sentHeaders(fetches);
    expect(headers['authorization']).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/); // the relay's own, not the forged one
    expect(headers['authorization']).not.toBe('SAPISIDHASH 1_forged');
  });

  it("still drops a page-supplied cookie — the fallback is the relay's to add, never the page's", async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(
      request('yt.fetch', { url: 'https://music.youtube.com/youtubei/v1/browse', headers: { cookie: 'SAPISID=smuggled' } }),
      deps,
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBe('SAPISID=burner-secret');
    expect(headers['cookie']).not.toContain('smuggled');
  });

  it('serves yt.fetch auth:true with the fallback, and refuses it without one', async () => {
    const withFallback = makeDeps(undefined, burner());
    const served = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      withFallback.deps,
    );
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    expect(sentHeaders(withFallback.fetches)['cookie']).toBe('SAPISID=burner-secret');

    const bare = makeDeps();
    const refused = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      bare.deps,
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect(bare.fetches).toHaveLength(0);
  });

  it('keeps the jar off addon and lyrics calls', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(request('addon.fetch', { url: 'https://example.com/manifest.json' }), deps);
    await handle(request('lyrics.fetch', { url: 'https://lrclib.net/api/search' }), deps);
    expect(fetches).toHaveLength(2);
    for (const call of fetches) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['cookie']).toBeUndefined();
      expect(headers['authorization']).toBeUndefined();
    }
  });

  it('answers authState as a functional, identity-free signed-in session when a fallback is loaded — and never reads the account to build it', async () => {
    // The account_menu responder is wired to prove the negative: even with a
    // readable identity one call away, nothing asks. The identity-read code
    // is gone (the corrected ruling), so no name can leak into an answer.
    const { deps, fetches } = makeDeps(
      (url) =>
        url.includes('account_menu')
          ? new Response(ACCOUNT_MENU_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
      burner(),
    );
    const answer = await handle(request('yt.authState', {}), deps);
    // Functional: signedIn is what the page's flows gate on, so the library,
    // history, likes and the signed playback retry all engage.
    expect(answer).toMatchObject({
      ok: true,
      result: {
        browserSignedIn: false,
        connected: true,
        signedIn: true,
        accounts: [],
        active: { id: expect.any(String), name: '', handle: null, avatarUrl: null, brand: false, authUser: '0' },
        problem: null,
      },
    });
    // Identity-free: nothing from the account_menu body — the name, email,
    // handle or avatar the responder holds — is anywhere in the answer.
    const json = JSON.stringify(answer);
    for (const identity of ['Burner One', 'burner@example.com', '@burner', 'burner.png']) {
      expect(json.includes(identity), identity).toBe(false);
    }
    // Nothing about the account is ever asked, refresh or not.
    expect(fetches).toHaveLength(0);
    const again = await handle(request('yt.authState', { refresh: true }), deps);
    expect(again).toMatchObject({ ok: true, result: { signedIn: true } });
    expect(fetches).toHaveLength(0);
  });

  it('serves the playback-tracking stats pings GET-only, signed by the jar, and never caches them', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    const url = 'https://s.youtube.com/api/stats/playback?cl=TEST&cpn=nonce';
    const served = await handle(request('yt.fetch', { url, method: 'GET', auth: true }), deps);
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    const headers = sentHeaders(fetches);
    // Dressed and signed as the music page the ping's own c= names.
    expect(headers['origin']).toBe('https://music.youtube.com');
    expect(headers['referer']).toBe('https://music.youtube.com/');
    expect(headers['cookie']).toBe('SAPISID=burner-secret');
    expect(headers['authorization']).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    // A ping is a side effect: the same URL twice must reach YouTube twice,
    // or the second play's registration would be swallowed by the cache.
    await handle(request('yt.fetch', { url, method: 'GET', auth: true }), deps);
    expect(fetches).toHaveLength(2);
    // Only GETs are the page speaking: the family is not a POST surface.
    const posted = await handle(request('yt.fetch', { url, method: 'POST', body: '{}' }), deps);
    expect(posted).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    // And without a fallback the auth call is refused, as every auth call is.
    const bare = makeDeps();
    const refused = await handle(request('yt.fetch', { url, method: 'GET', auth: true }), bare.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect(bare.fetches).toHaveLength(0);
  });

  it('leaks no part of the jar, or its signature, into any answer or error the dispatcher can produce', async () => {
    const respond = (url: string) =>
      url.includes('account_menu')
        ? new Response('<html>sign in</html>', { status: 403, headers: { 'content-type': 'text/html' } })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    const wired = makeDeps(respond, burner());
    const answers: unknown[] = [];
    for (const req of [
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', body: '{}' }),
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/browse' }),
      request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }),
      request('yt.fetch', { url: 'https://evil.example.com/youtubei/v1/player' }),
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      request('yt.fetch', { url: 'https://s.youtube.com/api/stats/playback?cpn=nonce', auth: true }),
      request('yt.authState', {}),
      request('addon.fetch', { url: 'https://example.com/manifest.json' }),
      request('yt.selectChannel', { channelId: 'x' }),
      request('no.such.method', {}),
      request('ping', {}),
    ]) {
      answers.push(await handle(req, wired.deps));
    }
    // And the failure paths: a dead upstream, and a body-less protocol error.
    const dead = makeDeps(() => {
      throw new TypeError('fetch failed');
    }, burner());
    answers.push(await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), dead.deps));
    answers.push(await handle(request('yt.fetch', {}), dead.deps));

    // The exact strings that must never come back: the cookie as sent, the
    // secret alone, and each SAPISIDHASH as sent.
    const sent = [...wired.fetches, ...dead.fetches].flatMap((call) =>
      Object.values((call.init?.headers ?? {}) as Record<string, string>),
    );
    const forbidden = new Set(['SAPISID=burner-secret', 'burner-secret', ...sent.filter((v) => v.startsWith('SAPISIDHASH '))]);
    for (const answer of answers) {
      const json = JSON.stringify(answer);
      for (const secret of forbidden) {
        expect(json.includes(secret), `leaked ${secret.slice(0, 12)}…`).toBe(false);
      }
    }
  });
});

describe('the server wiring', () => {
  it('ships a real fetch and a shared cache, and no fallback until index.ts loads one', () => {
    expect(typeof dispatchDeps.fetchImpl).toBe('function');
    expect(dispatchDeps.cache).toBeInstanceOf(RelayCache);
    expect(dispatchDeps.fallback).toBeNull();
  });
});

describe("the visitor's page-held jar (private-deployment.md, 2026-11-22)", () => {
  it('signs InnerTube calls with the jar — a SAPISIDHASH for the dressed origin, and X-Goog-AuthUser', async () => {
    const { deps, fetches } = makeDeps();
    await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', body: '{"videoId":"x"}' }),
      deps,
      { userJar: USER_JAR },
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
    expect(headers['authorization']).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers['x-goog-authuser']).toBe('0');
    // The call is still dressed the way the table says.
    expect(headers['origin']).toBe('https://www.youtube.com');
    expect(headers['referer']).toBe('https://www.youtube.com/');
  });

  it('outranks the fallback when both could sign: the visitor’s calls are theirs', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), deps, { userJar: USER_JAR });
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
    expect(headers['cookie']).not.toContain('burner-secret');
  });

  it('serves auth:true with a user jar even on a relay with no fallback', async () => {
    const { deps, fetches } = makeDeps();
    const served = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      deps,
      { userJar: USER_JAR },
    );
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    expect(sentHeaders(fetches)['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
  });

  it('never caches a user-signed answer — the URL-only key cannot tell identities apart', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    const url = 'https://www.youtube.com/youtubei/v1/browse';
    await handle(request('yt.fetch', { url }), deps, { userJar: USER_JAR });
    await handle(request('yt.fetch', { url }), deps, { userJar: USER_JAR });
    // Every jar-carrying call reached YouTube; the same URL without one is
    // the shared family and caches exactly as before.
    expect(fetches).toHaveLength(2);
    await handle(request('yt.fetch', { url }), deps);
    await handle(request('yt.fetch', { url }), deps);
    expect(fetches).toHaveLength(3);
  });

  it('signs the playback-tracking stats pings with the visitor’s jar — their history, not the burner’s', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    const url = 'https://s.youtube.com/api/stats/playback?cl=TEST&cpn=nonce';
    const served = await handle(
      request('yt.fetch', { url, method: 'GET', headers: { 'X-Goog-Visitor-Id': 'visitor-of-the-session' }, auth: true }),
      deps,
      { userJar: USER_JAR },
    );
    expect(served).toMatchObject({ ok: true, result: { status: 200 } });
    const headers = sentHeaders(fetches);
    expect(headers['origin']).toBe('https://music.youtube.com');
    expect(headers['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
    // The visitor id is part of the ping's protocol, and the session-bound
    // one the page read rides it — matched to the account that played.
    expect(headers['x-goog-visitor-id']).toBe('visitor-of-the-session');
    // And the ping is still a side effect: never served from a cache.
    await handle(request('yt.fetch', { url, method: 'GET', auth: true }), deps, { userJar: USER_JAR });
    expect(fetches).toHaveLength(2);
  });

  it('leaves the session bootstrap and BotGuard rows unsigned and cached under a jar', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/iframe_api' }), deps, { userJar: USER_JAR });
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/iframe_api' }), deps, { userJar: USER_JAR });
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/api/jnn/GenerateIT' }), deps, { userJar: USER_JAR });
    expect(fetches).toHaveLength(2); // the 10-minute family still shares; the jar never signed these rows
    for (const call of fetches) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['cookie']).toBeUndefined();
      expect(headers['authorization']).toBeUndefined();
    }
  });

  it('leaves an unsigned-by-design client (VISIONOS) anonymous under a jar too', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    await handle(
      request('yt.fetch', {
        url: 'https://www.youtube.com/youtubei/v1/player',
        method: 'POST',
        body: '{"context":{"client":{"clientName":"VISIONOS","clientVersion":"0.1"}},"videoId":"x"}',
      }),
      deps,
      { userJar: USER_JAR },
    );
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-goog-authuser']).toBeUndefined();
  });

  it('leaves a page-held Authorization untouched ahead of the jar, and its answer uncached', async () => {
    const { deps, fetches } = makeDeps(undefined, burner());
    const url = 'https://www.youtube.com/youtubei/v1/player';
    await handle(request('yt.fetch', { url, headers: { authorization: 'Bearer page-token' } }), deps, { userJar: USER_JAR });
    const headers = sentHeaders(fetches);
    expect(headers['authorization']).toBe('Bearer page-token');
    expect(headers['cookie']).toBeUndefined();
    await handle(request('yt.fetch', { url }), deps);
    expect(fetches).toHaveLength(2);
  });

  it('treats a jar that cannot sign as absent: the fallback covers, nothing breaks', async () => {
    // With a fallback loaded, the broken store falls back to it — a jar with
    // a session id but no SAPISID-family name cannot build the signature
    // (the name match is the point; a substring test would pass it).
    const withFallback = makeDeps(undefined, burner());
    for (const jar of [USER_JAR_NO_SESSION, 'Cookie: SID=only-a-session-id']) {
      await handle(
        request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }),
        withFallback.deps,
        { userJar: jar },
      );
      expect(sentHeaders(withFallback.fetches)['cookie']).toBe('SAPISID=burner-secret');
    }
    // And its answer is the shared family, so it caches: not a credential.
    await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), withFallback.deps, {
      userJar: USER_JAR_NO_SESSION,
    });
    expect(withFallback.fetches).toHaveLength(1);
    // Without one, an auth call goes back to refusing: a broken paste is no
    // credential to sign with.
    const bare = makeDeps();
    const refused = await handle(
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      bare.deps,
      { userJar: USER_JAR_NO_SESSION },
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect(bare.fetches).toHaveLength(0);
  });

  it('accepts a __Secure-only jar as the real login it is — the working set is the SAPISID family, by name', async () => {
    const { deps, fetches } = makeDeps();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      await handle(
        request('yt.fetch', { url: 'https://music.youtube.com/youtubei/v1/player', method: 'POST', body: '{"videoId":"x"}' }),
        deps,
        { userJar: 'Cookie: __Secure-3PAPISID=3p-secret; __Secure-3PSID=3p-sid' },
      );
    } finally {
      clock.mockRestore();
    }
    const headers = sentHeaders(fetches);
    expect(headers['cookie']).toBe('__Secure-3PAPISID=3p-secret; __Secure-3PSID=3p-sid');
    // The SAPISIDHASH is built over the __Secure-3PAPISID secret for the
    // origin the call is dressed as.
    expect(headers['authorization']).toBe(sapisidhash('3p-secret', 'https://music.youtube.com', 1_700_000_000));
  });

  it('absorbs nothing from a user-signed call: the page’s copy is the only copy, and Set-Cookie never crosses', async () => {
    const rotate = () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: [
          ['content-type', 'application/json'],
          ['set-cookie', '__Secure-1PSIDTS=rotated; Path=/; Domain=.youtube.com; Secure'],
        ],
      });
    const { deps, fetches } = makeDeps(rotate, burner());
    const url = 'https://www.youtube.com/youtubei/v1/player';
    for (const _ of [1, 2]) {
      const answer = (await handle(request('yt.fetch', { url, method: 'POST', body: '{"videoId":"x"}' }), deps, {
        userJar: USER_JAR,
      })) as { ok: boolean; result: HttpResponse };
      expect(answer.ok).toBe(true);
      expect(answer.result.headers['set-cookie']).toBeUndefined();
    }
    // The relay stayed stateless: the second call signs with the page's text
    // exactly as the first did — no rotation was kept anywhere.
    const second = (fetches[1]?.init?.headers ?? {}) as Record<string, string>;
    expect(second['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
    expect(second['cookie']).not.toContain('__Secure-1PSIDTS');
  });

  it('answers authState with the visitor’s identity, read from account_menu signed as them', async () => {
    const { deps, fetches } = makeDeps(
      (url) =>
        url.includes('account_menu')
          ? new Response(USER_MENU_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const answer = await handle(request('yt.authState', { refresh: true }), deps, { userJar: USER_JAR });
    // Their identity is the one identity allowed to cross, because it is theirs.
    expect(answer).toMatchObject({
      ok: true,
      result: {
        browserSignedIn: false,
        connected: true,
        signedIn: true,
        accounts: [
          {
            authUser: '0',
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            avatarUrl: 'https://yt3.ggpht.com/ada.png',
            channels: [{ id: '0:own', name: 'Ada Lovelace', handle: '@ada', avatarUrl: 'https://yt3.ggpht.com/ada.png', brand: false }],
          },
        ],
        active: { id: '0:own', name: 'Ada Lovelace', handle: '@ada', avatarUrl: 'https://yt3.ggpht.com/ada.png', brand: false, authUser: '0' },
        problem: null,
      },
    });
    // The read itself: account_menu on the music origin, WEB_REMIX dressed,
    // signed with the visitor's jar.
    const call = fetches[0];
    expect(String(call?.url)).toBe('https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false');
    const headers = (call?.init?.headers ?? {}) as Record<string, string>;
    expect(headers['cookie']).toBe('SID=user-sid; SAPISID=user-secret');
    expect(headers['authorization']).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers['origin']).toBe('https://music.youtube.com');
    expect(String(call?.init?.body)).toContain('WEB_REMIX');
    // The relay is stateless: every ask reads again, never a cached identity.
    await handle(request('yt.authState', {}), deps, { userJar: USER_JAR });
    expect(fetches).toHaveLength(2);
  });

  it('answers authState with what YouTube said when the jar is refused — the identity problem path', async () => {
    const { deps, fetches } = makeDeps(
      (url) =>
        url.includes('account_menu')
          ? new Response('<html>sign in</html>', { status: 403, headers: { 'content-type': 'text/html' } })
          : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const answer = await handle(request('yt.authState', {}), deps, { userJar: USER_JAR });
    expect(answer).toMatchObject({
      ok: true,
      result: { signedIn: false, connected: false, accounts: [], active: null, problem: expect.stringContaining('HTTP 403') },
    });
    expect(fetches).toHaveLength(1); // the refusal was read, not assumed
    // The no-account answer (logged_in 0) says so in YouTube's own terms.
    const signedOut = makeDeps(
      (url) =>
        url.includes('account_menu')
          ? new Response(JSON.stringify({ responseContext: { serviceTrackingParams: [{ params: [{ key: 'logged_in', value: '0' }] }] } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('{"ok":true}', { status: 200 }),
    );
    const asIfSignedOut = await handle(request('yt.authState', {}), signedOut.deps, { userJar: USER_JAR });
    expect(asIfSignedOut).toMatchObject({
      ok: true,
      result: { signedIn: false, problem: expect.stringContaining('as if signed out') },
    });
  });

  it('answers authState with the no-session problem for a paste that cannot sign, asking YouTube nothing', async () => {
    const { deps, fetches } = makeDeps();
    const answer = await handle(request('yt.authState', {}), deps, { userJar: USER_JAR_NO_SESSION });
    expect(answer).toMatchObject({
      ok: true,
      result: { signedIn: false, problem: expect.stringContaining('no SAPISID-family cookie') },
    });
    expect(fetches).toHaveLength(0);
    // An empty header is no header: the static answers stand.
    const empty = await handle(request('yt.authState', {}), deps, { userJar: '' });
    expect(empty).toMatchObject({ ok: true, result: { signedIn: false, problem: null } });
  });

  it('still answers the static states when the request carries no jar — the invisible fallback stands', async () => {
    const { deps, fetches } = makeDeps(
      (url) =>
        url.includes('account_menu')
          ? new Response(USER_MENU_BODY, { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
      burner(),
    );
    const answer = await handle(request('yt.authState', { refresh: true }), deps);
    expect(answer).toMatchObject({ ok: true, result: { signedIn: true, active: { name: '' } } });
    const json = JSON.stringify(answer);
    for (const identity of ['Ada Lovelace', 'ada@example.com', '@ada', 'ada.png']) {
      expect(json.includes(identity), identity).toBe(false);
    }
    expect(fetches).toHaveLength(0);
  });

  it('leaks no part of a page-held jar, or its signature, into any answer or error the dispatcher can produce', async () => {
    const respond = (url: string) =>
      url.includes('account_menu')
        ? new Response('<html>sign in</html>', { status: 403, headers: { 'content-type': 'text/html' } })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    const wired = makeDeps(respond, burner());
    const answers: unknown[] = [];
    for (const req of [
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', method: 'POST', body: '{}' }),
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/browse' }),
      request('yt.fetch', { url: 'https://www.youtube.com/sw.js_data' }),
      request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player', auth: true }),
      request('yt.fetch', { url: 'https://s.youtube.com/api/stats/playback?cpn=nonce', auth: true }),
      request('yt.authState', {}),
      request('yt.authState', {}),
    ]) {
      answers.push(await handle(req, wired.deps, { userJar: USER_JAR }));
    }
    // And the failure paths: a dead upstream mid-read, a body-less protocol
    // error, and a network-shaped account_menu failure.
    const dead = makeDeps(
      () => {
        throw new TypeError('fetch failed');
      },
      burner(),
    );
    answers.push(await handle(request('yt.fetch', { url: 'https://www.youtube.com/youtubei/v1/player' }), dead.deps, { userJar: USER_JAR }));
    answers.push(await handle(request('yt.fetch', {}), dead.deps, { userJar: USER_JAR }));
    answers.push(await handle(request('yt.authState', {}), dead.deps, { userJar: USER_JAR }));

    // The exact strings that must never come back: the jar as sent, each
    // value alone, the raw pasted text, and each SAPISIDHASH as sent.
    const sent = [...wired.fetches, ...dead.fetches].flatMap((call) =>
      Object.values((call.init?.headers ?? {}) as Record<string, string>),
    );
    const forbidden = new Set([
      USER_JAR,
      'SID=user-sid; SAPISID=user-secret',
      'user-sid',
      'user-secret',
      ...sent.filter((value) => value.startsWith('SAPISIDHASH ')),
    ]);
    for (const answer of answers) {
      const json = JSON.stringify(answer);
      for (const secret of forbidden) {
        expect(json.includes(secret), `leaked ${secret.slice(0, 12)}…`).toBe(false);
      }
    }
  });
});
