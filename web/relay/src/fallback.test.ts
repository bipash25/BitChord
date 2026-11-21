import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackCredential, loadFallbackCredential, parseCookieJar, sapisidhash } from './fallback.js';

/**
 * The fallback credential's own units: the jar parser (Netscape and raw
 * shapes), the SAPISIDHASH construction, the signing fence, and the
 * rotation absorption. What the dispatcher does with the credential — what
 * gets signed, what never leaks — lives in dispatch.test.ts.
 */

/** A small jar with obviously-secret values, and rows that must not survive parsing. */
const NETSCAPE = [
  '# Netscape HTTP Cookie File',
  '# comment rows are skipped',
  '#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1893456000\tSID\tSID-secret',
  '.google.com\tTRUE\t/\tFALSE\t1893456000\tSAPISID\tSAPISID-secret',
  '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-3PSID\tPSID-secret',
  '.youtube.com\tTRUE\t/\tTRUE\t1893456000\t__Secure-3PAPISID\t3PAPISID-secret',
  'example.com\tTRUE\t/\tFALSE\t1893456000\tOTHER\tnot-a-youtube-row',
  'evil-youtube.com\tTRUE\t/\tFALSE\t1893456000\tEVIL\tnot-really-a-subdomain',
  'not-enough-columns',
  '',
].join('\n');

describe('parseCookieJar', () => {
  it('reads a Netscape cookies.txt — HttpOnly rows included, other domains dropped', () => {
    // HttpOnly rows are the session cookies the jar needs most; dropping them
    // (the spike's parser did) would sign with half a session.
    expect([...parseCookieJar(NETSCAPE).entries()]).toEqual([
      ['SID', 'SID-secret'],
      ['SAPISID', 'SAPISID-secret'],
      ['__Secure-3PSID', 'PSID-secret'],
      ['__Secure-3PAPISID', '3PAPISID-secret'],
    ]);
  });

  it('reads a raw Cookie: header line, prefix or not', () => {
    expect([...parseCookieJar('Cookie: SID=a; HSID=b; SAPISID=c').entries()]).toEqual([
      ['SID', 'a'],
      ['HSID', 'b'],
      ['SAPISID', 'c'],
    ]);
    expect([...parseCookieJar('SID=a; HSID=b').entries()]).toEqual([
      ['SID', 'a'],
      ['HSID', 'b'],
    ]);
  });

  it('refuses names and values that would smuggle headers', () => {
    const jar = parseCookieJar('SID=ok; BAD=a\r\nX-Injected: 1; =novalue');
    expect(jar.get('SID')).toBe('ok');
    expect(jar.has('BAD')).toBe(false);
    expect(jar.size).toBe(1);
  });
});

describe('sapisidhash', () => {
  it('builds the SHA-1 over "<seconds> <secret> <origin>", with the timestamp injected', () => {
    const expected = createHash('sha1').update('1700000000 the-secret https://music.youtube.com').digest('hex');
    expect(sapisidhash('the-secret', 'https://music.youtube.com', 1_700_000_000)).toBe(
      `SAPISIDHASH 1700000000_${expected}`,
    );
  });

  it('hashes the origin it will be sent to, so music and www differ', () => {
    const music = sapisidhash('s', 'https://music.youtube.com', 1);
    const www = sapisidhash('s', 'https://www.youtube.com', 1);
    expect(music).not.toBe(www);
  });
});

describe('FallbackCredential.absorbSetCookies', () => {
  /** The credential under test, from a jar with one known stale value. */
  const credential = () => new FallbackCredential(parseCookieJar('SID=stale; SAPISID=secret'));

  it('merges a rotation into the live jar, so the next call signs with the fresh value', () => {
    const c = credential();
    const changed = c.absorbSetCookies(['__Secure-1PSIDTS=rotated; Path=/; Domain=.youtube.com; Secure']);
    expect(changed).toBe(true);
    // sign() is the observable surface: its Cookie header carries the rotation.
    expect(c.sign('https://music.youtube.com', 0)['cookie']).toContain('__Secure-1PSIDTS=rotated');
    expect(c.sign('https://music.youtube.com', 0)['cookie']).toContain('SAPISID=secret');
  });

  it('logs the rotation it absorbed by name only — the value is the session itself', () => {
    const logged: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    try {
      const c = credential();
      c.absorbSetCookies(['__Secure-1PSIDTS=rotated; Path=/; Domain=.youtube.com; Secure']);
      const line = logged.join('\n');
      expect(line).toContain('__Secure-1PSIDTS'); // the name, said aloud
      expect(line).not.toContain('rotated'); // the value, never
      expect(line).not.toContain('secret'); // the jar's other secret, never either
    } finally {
      log.mockRestore();
    }
  });

  it('reports no change when YouTube restates what the jar already holds', () => {
    const c = credential();
    expect(c.absorbSetCookies(['SID=stale; Path=/; Domain=.youtube.com'])).toBe(false);
  });

  it('ignores rotations for domains outside the YouTube/Google hosts', () => {
    const c = credential();
    expect(c.absorbSetCookies(['TRACKID=1; Domain=.doubleclick.net'])).toBe(false);
    expect(c.sign('https://music.youtube.com', 0)['cookie']).not.toContain('TRACKID');
  });

  it('treats an empty value as a deletion: the cookie stops being sent', () => {
    const c = credential();
    c.absorbSetCookies(['SID=; Path=/; Domain=.youtube.com; Max-Age=0']);
    // By name, not substring: "SAPISID=…" contains "SID=" as text.
    const names = (c.sign('https://music.youtube.com', 0)['cookie'] ?? '').split('; ').map((part) => part.split('=')[0]);
    expect(names).not.toContain('SID');
  });

  it('warns loudly, by name, when an absorption deletes the session family — YouTube logged the session out', () => {
    // The measured shape of a dead jar's page load: empty-value Set-Cookie
    // lines for the first-party family. A relay that absorbed this silently
    // would sign anonymous requests while claiming a fallback.
    const warned: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const c = credential();
      c.absorbSetCookies(['SID=; Path=/; Domain=.youtube.com; Max-Age=0', 'SAPISID=; Domain=.youtube.com; Max-Age=0']);
      const line = warned.join('\n');
      expect(line).toContain('logged the fallback session out');
      expect(line).toContain('SID');
      expect(line).toContain('SAPISID');
      expect(line).not.toContain('secret'); // the jar's values stay out of it
      // And the jar really is gutted: sign() no longer carries a session.
      expect(c.sign('https://music.youtube.com', 0)['cookie']).not.toContain('SID=');
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('does not cry logout when a deletion is re-set in the same batch — an account switch, not an ending', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const c = credential();
      c.absorbSetCookies(['SID=; Domain=.youtube.com; Max-Age=0', 'SID=switched; Domain=.youtube.com']);
      expect(warn).not.toHaveBeenCalled();
      expect(c.sign('https://music.youtube.com', 0)['cookie']).toContain('SID=switched');
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('re-signs with a rotated SAPISID, keeping the HttpOnly session cookies alongside', () => {
    const c = credential();
    c.absorbSetCookies(['SAPISID=next-secret; Path=/; Domain=.youtube.com']);
    // The authorization is a SAPISIDHASH built over the rotated secret.
    expect(c.sign('https://music.youtube.com', 5)['authorization']).toBe(sapisidhash('next-secret', 'https://music.youtube.com', 5));
  });
});

describe('FallbackCredential.sign', () => {
  it('signs with the whole jar, the SAPISIDHASH, and the authUser', () => {
    const fallback = new FallbackCredential(parseCookieJar(NETSCAPE));
    expect(fallback.sign('https://music.youtube.com', 1_700_000_000)).toEqual({
      cookie: 'SID=SID-secret; SAPISID=SAPISID-secret; __Secure-3PSID=PSID-secret; __Secure-3PAPISID=3PAPISID-secret',
      authorization: `SAPISIDHASH 1700000000_${createHash('sha1').update('1700000000 SAPISID-secret https://music.youtube.com').digest('hex')}`,
      'x-goog-authuser': '0',
    });
  });

  it('prefers SAPISID, then __Secure-3PAPISID, then __Secure-1PAPISID', () => {
    const fallback = new FallbackCredential(parseCookieJar('__Secure-1PAPISID=one; __Secure-3PAPISID=three'));
    const { authorization } = fallback.sign('https://www.youtube.com', 5);
    expect(authorization).toBe(`SAPISIDHASH 5_${createHash('sha1').update('5 three https://www.youtube.com').digest('hex')}`);
  });

  it('signs with the bare jar when no SAPISID-family cookie exists', () => {
    const fallback = new FallbackCredential(parseCookieJar('SID=only'));
    expect(fallback.sign('https://music.youtube.com', 5)).toEqual({ cookie: 'SID=only', 'x-goog-authuser': '0' });
  });

  it('refuses an origin that is not one of the two InnerTube origins', () => {
    const fallback = new FallbackCredential(parseCookieJar('SAPISID=s'));
    expect(() => fallback.sign('https://evil.example', 1)).toThrow(/only signs/);
  });
});

describe('FallbackCredential.navigationHeaders', () => {
  it('carries the jar the way a page load would: the cookie alone, no signature, no authUser', () => {
    const fallback = new FallbackCredential(parseCookieJar('SID=a; SAPISID=s'));
    expect(fallback.navigationHeaders('https://www.youtube.com')).toEqual({ cookie: 'SID=a; SAPISID=s' });
    expect(fallback.navigationHeaders('https://music.youtube.com')).toEqual({ cookie: 'SID=a; SAPISID=s' });
  });

  it('refuses an origin outside the two YouTube origins, exactly as sign does', () => {
    const fallback = new FallbackCredential(parseCookieJar('SAPISID=s'));
    expect(() => fallback.navigationHeaders('https://accounts.google.com')).toThrow(/only navigates/);
  });
});

describe('loadFallbackCredential', () => {
  const scratch = (name: string) => `${tmpdir()}/bitchord-load-${name}.test.txt`;

  it('loads a jar that holds a first-party session cookie', () => {
    const path = scratch('good');
    writeFileSync(path, 'SID=a; HSID=b; SAPISID=s\n');
    try {
      const credential = loadFallbackCredential(path);
      expect(credential).not.toBeNull();
      expect(credential?.sign('https://music.youtube.com', 1)['cookie']).toContain('SID=a');
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('refuses the logged-out remnant loudly and answers null — the relay runs anonymous-only', () => {
    const path = scratch('remnant');
    // The shape the persist writes after YouTube logs the session out: the
    // 3P variants and visitor cookies stand, the first-party family is gone.
    writeFileSync(path, 'Cookie: __Secure-3PSID=x; __Secure-3PAPISID=y; SIDCC=z\n');
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      expect(loadFallbackCredential(path)).toBeNull();
      const line = errors.join('\n');
      expect(line).toContain('logged-out remnant');
      // Names only, ever: none of the remnant's values cross into the line.
      expect(line).not.toContain('=x');
      expect(line).not.toContain('=y');
    } finally {
      error.mockRestore();
      rmSync(path, { force: true });
    }
  });

  it('still throws outright on a configured file with nothing usable in it', () => {
    const path = scratch('empty');
    writeFileSync(path, '# nothing parseable\n');
    try {
      expect(() => loadFallbackCredential(path)).toThrow(/holds no youtube\.com or google\.com cookies/);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe('the persist round-trip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rewrites the seed file as one raw Cookie: line a restart continues from', () => {
    vi.useFakeTimers();
    const path = `${tmpdir()}/bitchord-fallback-persist.test.txt`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const credential = new FallbackCredential(parseCookieJar('SID=stale; SAPISID=secret'), path);
      expect(credential.absorbSetCookies(['__Secure-1PSIDTS=fresh; Path=/; Domain=.youtube.com; Secure'])).toBe(true);
      vi.advanceTimersByTime(1_000); // the trailing persist's debounce
      const persisted = new TextDecoder().decode(readFileSync(path));
      expect(persisted.startsWith('Cookie: ')).toBe(true);
      expect(persisted).toContain('__Secure-1PSIDTS=fresh');
      // The shape the relay itself boots from: a restart reloads this as a jar
      // and continues the same session instead of the dead export.
      expect(parseCookieJar(persisted).get('__Secure-1PSIDTS')).toBe('fresh');
    } finally {
      log.mockRestore();
      rmSync(path, { force: true });
    }
  });

  it('collapses a burst of rotations into one write', () => {
    vi.useFakeTimers();
    const path = `${tmpdir()}/bitchord-fallback-burst.test.txt`;
    // The file exists already — it is the seed the relay booted from — so
    // "nothing written yet" is observable as the seed still sitting there.
    writeFileSync(path, 'Cookie: SID=stale; SAPISID=secret\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const credential = new FallbackCredential(parseCookieJar('SID=stale; SAPISID=secret'), path);
      credential.absorbSetCookies(['__Secure-1PSIDTS=first; Domain=.youtube.com']);
      credential.absorbSetCookies(['SIDCC=second; Domain=.youtube.com']);
      // Still inside the debounce window: the seed is untouched.
      vi.advanceTimersByTime(500);
      expect(new TextDecoder().decode(readFileSync(path))).toBe('Cookie: SID=stale; SAPISID=secret\n');
      vi.advanceTimersByTime(500);
      // One write, carrying both rotations.
      const persisted = new TextDecoder().decode(readFileSync(path));
      expect(persisted).toContain('SIDCC=second');
      expect(persisted).toContain('__Secure-1PSIDTS=first');
    } finally {
      log.mockRestore();
      rmSync(path, { force: true });
    }
  });
});

