import { readFileSync, writeFileSync } from 'node:fs';
import {
  COOKIE_NAME,
  isCookieValue,
  isYtHost,
  JarCredential,
  parseCookieJar,
  SESSION_CORE,
  SIGNED_ORIGINS,
} from './credential.js';

// The jar formats and the SAPISIDHASH construction live in credential.ts now,
// shared with the visitor's page-held jar (userjar.ts); re-exported because
// this module is where both the tests and the runbook came to know them.
export { parseCookieJar, sapisidhash } from './credential.js';

const MUSIC_ORIGIN = 'https://music.youtube.com';
const WWW_ORIGIN = 'https://www.youtube.com';

/**
 * The first-party session cookies: the ones a signed-in export always holds
 * and a logout always deletes. Measured 2026-11-21, the dead jar's page load
 * answered with empty-value `Set-Cookie` lines for exactly this family (SID,
 * HSID, SSID, APISID, SAPISID, `__Secure-1PSID`, `__Secure-1PAPISID`,
 * LOGIN_INFO) while leaving the 3P variants and the visitor cookies standing
 * — so "the first-party session is gone" is testable, both at load time and
 * after an absorption.
 */
const SESSION_COOKIES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  'LOGIN_INFO',
]);

// ---- the credential ------------------------------------------------------------

/**
 * The jar as a live credential: what signs a call. Anonymous by design —
 * nothing about the account it holds is ever read or answered to the page
 * (the owner's corrected decision, 2026-11-22: the features the account
 * provides are fully live, its identity never surfaces), so it has no
 * identity to report; the probe is the operator's health check instead. The
 * cookie value and the SAPISID secret live in memory only; nothing returned
 * to a caller ever carries either.
 *
 * The jar is *living*, because a static one is measured to die within about a
 * quarter hour: Google rotates the session's cookies, and whichever side
 * stays active rotates the other side's copy out from under it (yt-dlp's "no
 * longer valid; likely rotated in the browser", 2026-11-21, after a jar that
 * had resolved itag 251 from this same egress half an hour earlier). This
 * relay is the side that holds the session now, so it is the side that must
 * keep it rotated — but the relay's own InnerTube traffic can't do it:
 * measured 2026-11-21, InnerTube responses carry **no Set-Cookie at all**, so
 * absorption on signed calls never fires (the seeded file was never
 * rewritten, and a jar refreshed only by what InnerTube sends stays exactly
 * as stale as the export). The rotations arrive on *page loads* instead — a
 * HEAD of the www homepage answers the jar with the session's `Set-Cookie`
 * family, which carries re-issued values while the session is alive
 * server-side and deletions once it is dead (both shapes measured 2026-11-21;
 * the deletion shape is the logout `absorbSetCookies` warns about) — so the
 * session keeper (`keeper.ts`) harvests there: rotations are absorbed into
 * the live jar, the next call signs with them, and the jar is persisted back
 * to [persistPath] (as one raw `Cookie:` line) so a restart continues the
 * same session instead of a dead export.
 */
export class FallbackCredential extends JarCredential {
  private readonly persistPath: string | null;
  /** A trailing persist, so a burst of rotations becomes one write. */
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(jar: ReadonlyMap<string, string>, persistPath: string | null = null) {
    super(jar);
    this.persistPath = persistPath;
  }

  /**
   * The Set-Cookie lines YouTube sent while serving one of this credential's
   * signed calls — or a session-keeper harvest (`keeper.ts`) — merged into the
   * live jar. Returns whether anything changed. Foreign domains and names the
   * header grammar rejects are ignored; an empty value is a deletion, so the
   * cookie stops being sent rather than lingering.
   */
  absorbSetCookies(lines: readonly string[]): boolean {
    let changed = false;
    const names: string[] = [];
    // Session cookies this batch deleted outright (empty value). A rotation
    // re-issues values; a deletion means the session is over server-side —
    // measured 2026-11-21, a page load of the dead jar deleted the whole
    // first-party family, and a later line re-setting the name cancels the
    // alarm (an account switch deletes then re-issues).
    const logout = new Set<string>();
    for (const line of lines) {
      const first = line.indexOf(';');
      const pair = first === -1 ? line : line.slice(0, first);
      const attrs = first === -1 ? '' : line.slice(first + 1);
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      if (!COOKIE_NAME.test(name)) continue;
      const value = pair.slice(at + 1).trim();
      // The attribute list begins right after the first ';', so the first
      // attribute has no separator of its own: '^' or ';', then its spaces.
      const domain = /(?:^|;)\s*domain=([^;]*)/i.exec(attrs)?.[1]?.trim().replace(/^\./, '') ?? '';
      // No Domain attribute defaults to the responding host, which for a
      // signed call is one of the two YouTube origins; a declared domain has
      // to be ours too before its rotation is trusted.
      if (domain && !isYtHost(domain)) continue;
      if (value === '') {
        if (this.jar.delete(name)) {
          changed = true;
          names.push(name);
        }
        if (SESSION_COOKIES.has(name)) logout.add(name);
        continue;
      }
      if (!isCookieValue(value)) continue;
      logout.delete(name);
      if (this.jar.get(name) !== value) {
        this.jar.set(name, value);
        changed = true;
        names.push(name);
      }
    }
    if (changed) {
      // The living jar's heartbeat, and — authState never reading the
      // account — the operator's only ongoing signal that the session is
      // still being renewed: a log line per absorption, carrying the names
      // YouTube rotated and nothing else (the value is the session itself).
      console.log(`BitChord relay: fallback jar absorbed a rotation: ${names.join(', ')}`);
      this.rotate();
    }
    if (logout.size) {
      // The loud version of the same hygiene: names only. Without this line
      // a logged-out jar keeps "working" — the relay signs anonymous
      // requests while claiming a fallback, and the operator finds out from
      // failing playback instead of the log.
      console.warn(
        `BitChord relay: YouTube logged the fallback session out (deleted ${[...logout].join(', ')}); ` +
          `playback will bot-check — replace the jar with the second burner's export`,
      );
    }
    return changed;
  }

  /** Re-derives the signing material from the rotated jar and schedules the persist. */
  protected override rotate(): void {
    super.rotate();
    const path = this.persistPath;
    if (!path) return;
    this.persistTimer ??= setTimeout(() => {
      this.persistTimer = undefined;
      try {
        writeFileSync(path, `Cookie: ${this.cookie}\n`);
      } catch (error) {
        // The jar stays live in memory; only its on-disk copy is stale. The
        // message names the file, never its contents.
        console.error(`BitChord relay: persisting the fallback jar to ${path} failed: ${String(error)}`);
      }
    }, 1_000);
  }

  /**
   * The headers a signed-in browser's *navigation* to [origin] would carry:
   * the jar as its Cookie header, and nothing else — a page load sends no
   * SAPISIDHASH and no authUser, and the session keeper's harvest
   * (`keeper.ts`) is exactly that shape. Measured 2026-11-21: the www
   * homepage answered it with the session's `Set-Cookie` family (the SID,
   * HSID, SSID, APISID, SAPISID, `__Secure-1PSID`, SIDCC names — re-issued
   * values for a live session, deletions for a dead one) while every
   * InnerTube response carried no Set-Cookie at all — page loads are the
   * only place YouTube touches the session's cookies, so they are the only
   * thing the relay can harvest. Same two-origin fence as sign().
   */
  navigationHeaders(origin: string): { cookie: string } {
    if (!SIGNED_ORIGINS.has(origin)) {
      throw Object.assign(new Error(`the fallback credential only navigates ${MUSIC_ORIGIN} and ${WWW_ORIGIN}`), {
        code: 'internal',
      });
    }
    return { cookie: this.cookie };
  }
}

/**
 * Loads the fallback at startup: [path] points at the throwaway's jar, as a
 * Netscape cookies.txt or a raw `Cookie:` line. Null when no path is
 * configured. A configured path with nothing usable in it is a startup error
 * rather than a silent anonymous relay — the operator pointed at playback
 * working, so it must fail loudly. The error names the file, never its
 * contents.
 *
 * One shape is warned about rather than thrown at: a jar that parses but
 * holds no first-party session cookie is the logged-out remnant of a session
 * that died while the relay was running (the persist wrote YouTube's logout
 * back to the file — the deletion signature `absorbSetCookies` documents).
 * Throwing would take the whole site's browse and search down with playback;
 * instead the relay runs anonymous-only, says so here, and the fresh export
 * the runbook asks for makes the next restart a fallback again.
 *
 * The file is the relay's to keep from then on: as YouTube rotates the
 * session, the jar is persisted back to it as one raw `Cookie:` line, so the
 * export is only the jar's *seed*. The runbook says to export from a browser
 * that is then quit entirely — without signing out, which would invalidate
 * the session — because a browser that stays active keeps rotating the
 * session out from under the relay, which is what kills a static export
 * (measured 2026-11-21).
 */
export function loadFallbackCredential(path: string | undefined): FallbackCredential | null {
  if (!path) return null;
  const jar = parseCookieJar(new TextDecoder().decode(readFileSync(path)));
  if (jar.size === 0) {
    throw new Error(`${path} holds no youtube.com or google.com cookies; the fallback cannot sign anything`);
  }
  if (!SESSION_CORE.some((name) => jar.has(name))) {
    console.error(
      `BitChord relay: ${path} holds no first-party session cookie (SID or __Secure-1PSID) — ` +
        `the logged-out remnant of a dead session, so the relay runs anonymous-only; ` +
        `replace the file with a fresh export and restart`,
    );
    return null;
  }
  return new FallbackCredential(jar, path);
}
