import { createHash } from 'node:crypto';

/**
 * The machinery both jar-holding credential classes share
 * (`web/docs/private-deployment.md`, 2026-11-22): the throwaway the relay
 * keeps for visitors without a session (`fallback.ts`), and the visitor's
 * own jar, held in their browser and attached to a call as it happens
 * (`userjar.ts`). One jar format, one SAPISIDHASH construction, one
 * two-origin fence — the difference between the classes is custody: the
 * fallback's jar is the relay's to keep alive, the visitor's is nobody's to
 * keep.
 *
 * Hygiene is the spine here as everywhere: the jar and the signature it
 * builds never appear in a log line, an error, a cache key or an answer to
 * the page, and the jar is attached only to the two YouTube origins the
 * impersonation table dresses signed calls as — the InnerTube rows and the
 * playback-stats pings. A page-supplied cookie never reaches this code: it
 * is dropped in `hosts.ts` before any of this runs.
 */

const MUSIC_ORIGIN = 'https://music.youtube.com';
const WWW_ORIGIN = 'https://www.youtube.com';

/** The origins a signed call may be dressed as: a jar's only destinations, restated as a fence. */
export const SIGNED_ORIGINS = new Set([MUSIC_ORIGIN, WWW_ORIGIN]);

/**
 * The cookies whose value can sign a SAPISIDHASH, in the order Google's own
 * clients prefer them — the list the extension's `ytAuth` used, which the
 * fallback spike checked the first two of.
 */
const SIGNING_COOKIES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'] as const;

/**
 * The minimum a jar must hold to be a session at all: one first-party
 * session id. The bar `loadFallbackCredential` holds the operator's jar to,
 * and the bar a page-held jar must clear before the relay treats it as a
 * credential at all.
 */
export const SESSION_CORE = ['SID', '__Secure-1PSID'] as const;

/** Whether [host] is youtube.com or google.com themselves or a subdomain: the rows a jar keeps. */
export function isYtHost(host: string): boolean {
  return (
    host === 'youtube.com' || host === 'google.com' || host.endsWith('.youtube.com') || host.endsWith('.google.com')
  );
}

/** A cookie name as the header grammar allows it. */
export const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A value the relay is willing to put in a header: no control characters, and
 * not empty. The jar is untrusted text input on both paths; a CRLF smuggled
 * into a value would otherwise become header smuggling the moment it is
 * attached.
 */
export function isCookieValue(value: string): boolean {
  return value.length > 0 && !/[\r\n\0]/.test(value);
}

// ---- the jar --------------------------------------------------------------------

/**
 * Parses a jar out of [text]: a Netscape cookies.txt (tab-separated rows) or
 * one raw `Cookie:` header line — the two shapes the runbook tells an
 * operator to produce and the sign-in flow asks a visitor for. Ported from
 * the spike's parser (`yt-pot-test/fallback-spike.mjs`) with two tightenings:
 * `#HttpOnly_` rows are cookies, not comments — the session cookies the jar
 * needs most (SID, `__Secure-*PSID`) are HttpOnly, and skipping them would
 * quietly sign with half a session — and the domain filter is exact, so
 * "evil-youtube.com" is not a youtube.com row.
 */
export function parseCookieJar(text: string): Map<string, string> {
  const jar = new Map<string, string>();
  if (text.includes('\t')) {
    for (const line of text.split(/\r?\n/)) {
      const row = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
      if (!row || row.startsWith('#')) continue;
      const parts = row.split('\t');
      const name = parts[5];
      const value = parts[6];
      if (name === undefined || value === undefined) continue;
      if (!isYtHost((parts[0] ?? '').replace(/^\./, ''))) continue;
      if (!COOKIE_NAME.test(name) || !isCookieValue(value)) continue;
      jar.set(name, value);
    }
  } else {
    // A raw header line; the doc allows the file to keep its "Cookie:" prefix.
    const line = text.replace(/^cookie:\s*/i, '').trim();
    for (const part of line.split(';')) {
      const at = part.indexOf('=');
      if (at <= 0) continue;
      const name = part.slice(0, at).trim();
      const value = part.slice(at + 1).trim();
      if (!COOKIE_NAME.test(name) || !isCookieValue(value)) continue;
      jar.set(name, value);
    }
  }
  return jar;
}

/**
 * `SAPISIDHASH <seconds>_<sha1(seconds + " " + secret + " " + origin)>` — the
 * signature the spike measured and the extension's `ytAuth` built before it
 * (DesktopYouTubeAuth's scheme). The timestamp is an argument so callers and
 * tests pin it; the hash input is exactly the three-part string Google's
 * clients use.
 */
export function sapisidhash(secret: string, origin: string, timestampSeconds: number): string {
  const digest = createHash('sha1').update(`${timestampSeconds} ${secret} ${origin}`).digest('hex');
  return `SAPISIDHASH ${timestampSeconds}_${digest}`;
}

// ---- the credential ----------------------------------------------------------------

/**
 * A jar as a credential: what signs a call. The signing material (the whole
 * jar as a `Cookie:` header, the SAPISID-family secret, the authUser that
 * addresses the one login a jar is) is derived once and re-derived on
 * rotation by subclasses that keep their jar living; nothing returned to a
 * caller ever carries any of it.
 */
export class JarCredential {
  protected readonly jar: Map<string, string>;
  protected cookie: string;
  protected secret: string | null;

  constructor(jar: ReadonlyMap<string, string>) {
    this.jar = new Map(jar);
    this.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    this.secret = SIGNING_COOKIES.map((name) => jar.get(name)).find((value): value is string => !!value) ?? null;
  }

  /** Whether the jar holds a first-party session at all (`SESSION_CORE`). */
  holdsSession(): boolean {
    return SESSION_CORE.some((name) => this.jar.has(name));
  }

  /**
   * Whether the jar can build a SAPISIDHASH at all: one of the signing
   * cookies — `SAPISID`, `__Secure-3PAPISID`, `__Secure-1PAPISID` — present
   * **by name** with a value. This is the working cookie set the Android app
   * measured (`AuthStore.hasApiSid`): a `__Secure-`-only jar is a real,
   * signable login, and the name match is the point — a substring test for
   * "SAPISID" once let a jar that couldn't sign pass as signable
   * (`web/docs/android-auth-port.md` §2.3).
   */
  canSign(): boolean {
    return this.secret !== null;
  }

  /**
   * Re-derives the signing material from the jar as it now stands — what a
   * subclass that keeps its jar living calls after changing it, so the next
   * sign() speaks the rotated jar rather than the one it was built from.
   */
  protected rotate(): void {
    this.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    this.secret = SIGNING_COOKIES.map((name) => this.jar.get(name)).find((value): value is string => !!value) ?? null;
  }

  /**
   * The headers that sign one InnerTube call dressed as [origin]: the jar as
   * a Cookie header, the SAPISIDHASH for that origin, and the authUser that
   * addresses the one login the jar is. [timestampSeconds] is the signature's
   * clock, an argument so tests can pin it.
   */
  sign(origin: string, timestampSeconds: number): Record<string, string> {
    if (!SIGNED_ORIGINS.has(origin)) {
      // The fence restated where the jar is actually attached: a change that
      // would send the cookie somewhere new must fail, not ship.
      throw Object.assign(new Error(`a jar credential only signs ${MUSIC_ORIGIN} and ${WWW_ORIGIN}`), {
        code: 'internal',
      });
    }
    const headers: Record<string, string> = { cookie: this.cookie, 'x-goog-authuser': '0' };
    if (this.secret) headers.authorization = sapisidhash(this.secret, origin, timestampSeconds);
    return headers;
  }
}
