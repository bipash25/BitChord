import { describe, expect, it, vi } from 'vitest';
import { FallbackCredential, parseCookieJar } from './fallback.js';
import { startSessionKeeper } from './keeper.js';
import { CHROMIUM_USER_AGENT } from './hosts.js';

/**
 * The session keeper's units: the harvest is a browser navigation (the one
 * request shape measured to rotate the session), the rotation it answers is
 * absorbed, the cadence holds, a failed harvest doesn't kill the keeper, and
 * nothing it ever says carries a cookie's value. No test touches the network.
 */

/** A two-cookie jar with an obviously-secret value. */
const burner = () => new FallbackCredential(parseCookieJar('SID=stale; SAPISID=keeper-secret'));

/** One turn of the event loop — enough for a stubbed fetch to resolve. */
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fetch stub that records its calls and answers [respond] every time. */
function stubFetch(respond: () => Response) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => respond());
}

describe('startSessionKeeper', () => {
  it('harvests as a browser navigation: a HEAD of the www homepage with the jar, and no SAPISIDHASH or authUser', async () => {
    const fetchImpl = stubFetch(() => new Response(null, { status: 200 }));
    const stop = startSessionKeeper({ fetchImpl, credential: burner(), intervalMs: 60_000 });
    await tick();
    stop();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://www.youtube.com/');
    expect(init?.method).toBe('HEAD');
    const headers = init?.headers as Record<string, string>;
    // The navigation, not the signing shape: a page load carries the jar and
    // the browser identity, never the API call's signature.
    expect(headers['cookie']).toBe('SID=stale; SAPISID=keeper-secret');
    expect(headers['user-agent']).toBe(CHROMIUM_USER_AGENT);
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-goog-authuser']).toBeUndefined();
  });

  it('absorbs the rotation the harvest answers, so the next signed call signs with the fresh value', async () => {
    const credential = burner();
    const fetchImpl = stubFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: [['set-cookie', '__Secure-1PSIDTS=fresh; Path=/; Domain=.youtube.com; Secure']],
        }),
    );
    const stop = startSessionKeeper({ fetchImpl, credential, intervalMs: 60_000 });
    await tick();
    stop();
    expect(credential.sign('https://music.youtube.com', 0)['cookie']).toContain('__Secure-1PSIDTS=fresh');
  });

  it('keeps the cadence, and stopping stops it', async () => {
    const fetchImpl = stubFetch(() => new Response(null, { status: 200 }));
    const stop = startSessionKeeper({ fetchImpl, credential: burner(), intervalMs: 5 });
    await tick(60); // the immediate harvest plus several intervals
    stop();
    const harvested = fetchImpl.mock.calls.length;
    expect(harvested).toBeGreaterThanOrEqual(3);
    await tick(30);
    expect(fetchImpl.mock.calls.length).toBe(harvested);
  });

  it('survives a failed harvest and tries again on the next interval', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    const stop = startSessionKeeper({ fetchImpl, credential: burner(), intervalMs: 5 });
    await tick(30);
    stop();
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a refused harvest is not absorbed — a refusal is how a session gets logged out, not rotated', async () => {
    const credential = burner();
    const fetchImpl = stubFetch(
      () =>
        // YouTube's refusal pages replace session cookies; absorbing one
        // would quietly sign the jar out.
        new Response(null, { status: 403, headers: [['set-cookie', 'SID=; Path=/; Domain=.youtube.com; Max-Age=0']] }),
    );
    const stop = startSessionKeeper({ fetchImpl, credential, intervalMs: 60_000 });
    await tick();
    stop();
    expect(credential.sign('https://www.youtube.com', 0)['cookie']).toContain('SID=stale');
  });

  it('logs failures and rotations by name and status only — never a value from the jar', async () => {
    const logged: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    try {
      // A rotation first (absorbSetCookies' line), then a failure and a refusal.
      const rotating = stubFetch(
        () => new Response(null, { status: 200, headers: [['set-cookie', '__Secure-1PSIDTS=fresh; Domain=.youtube.com']] }),
      );
      const first = startSessionKeeper({ fetchImpl: rotating, credential: burner(), intervalMs: 60_000 });
      await tick();
      first();

      const failing = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        throw new TypeError('fetch failed');
      });
      const second = startSessionKeeper({ fetchImpl: failing, credential: burner(), intervalMs: 60_000 });
      await tick();
      second();

      const refused = stubFetch(() => new Response(null, { status: 403 }));
      const third = startSessionKeeper({ fetchImpl: refused, credential: burner(), intervalMs: 60_000 });
      await tick();
      third();

      const everything = logged.join('\n');
      expect(everything).toContain('__Secure-1PSIDTS'); // the rotated name, said aloud
      expect(everything).toContain('fetch failed');
      expect(everything).toContain('403');
      // And never the values: the secret, the stale cookie, the rotation's value.
      expect(everything).not.toContain('keeper-secret');
      expect(everything).not.toContain('SID=stale');
      expect(everything).not.toContain('__Secure-1PSIDTS=fresh');
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
