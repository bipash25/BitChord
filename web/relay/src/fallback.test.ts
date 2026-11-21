import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FallbackCredential, parseCookieJar, sapisidhash } from './fallback.js';

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

