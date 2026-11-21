import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { HttpResponse, YtAccount, YtAuthState } from './contract.js';
import { CHROMIUM_USER_AGENT, ytImpersonationFor } from './hosts.js';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS } from './limits.js';
import { serialise } from './serialise.js';

/**
 * The private deployment's fallback credential (`web/docs/private-deployment.md`):
 * a throwaway account's YouTube cookie jar, held by the relay and used to sign
 * the calls of listeners who never signed in. It is the one credential path
 * that crosses datacenter egress — anonymous `player` is refused from every
 * public IP, and the TV OAuth bearer authenticates and opens nothing — so on
 * a relay configured with it, the fallback covers the signed-out case
 * entirely.
 *
 * Hygiene is this module's spine, because the credential is a cookie: the jar
 * and the signature it builds never appear in a log line, an error, a cache
 * key or an answer to the page (names and pictures only), and the jar is
 * attached only to the two InnerTube origins the impersonation table dresses
 * calls as. It is never the page's to send — a page-supplied cookie is
 * dropped before any of this runs.
 */

const MUSIC_ORIGIN = 'https://music.youtube.com';
const WWW_ORIGIN = 'https://www.youtube.com';

/** The origins a signed call may be dressed as: the jar's only destinations, restated as a fence. */
const SIGNED_ORIGINS = new Set([MUSIC_ORIGIN, WWW_ORIGIN]);

/**
 * The cookies whose value can sign a SAPISIDHASH, in the order Google's own
 * clients prefer them — the list the extension's `ytAuth` used, which the
 * fallback spike checked the first two of.
 */
const SIGNING_COOKIES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'] as const;

/**
 * Any recent WEB_REMIX version is accepted for the account endpoints
 * (Innertube.kt keeps a fallback the same way; the extension pinned the same
 * idea). `67` is WEB_REMIX's client id, as the music page sends it.
 */
const WEB_REMIX_VERSION = '1.20251006.03.00';

/** Whether [host] is youtube.com or google.com themselves or a subdomain: the rows a jar keeps. */
function isYtHost(host: string): boolean {
  return (
    host === 'youtube.com' || host === 'google.com' || host.endsWith('.youtube.com') || host.endsWith('.google.com')
  );
}

/** A cookie name as the header grammar allows it. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A value the relay is willing to put in a header: no control characters, and
 * not empty. The jar is operator-supplied file input; a CRLF smuggled into a
 * value would otherwise become header smuggling the moment it is attached.
 */
function isCookieValue(value: string): boolean {
  return value.length > 0 && !/[\r\n\0]/.test(value);
}

// ---- the jar ------------------------------------------------------------------

/**
 * Parses a fallback jar out of [text]: a Netscape cookies.txt (tab-separated
 * rows) or one raw `Cookie:` header line — the two shapes the runbook tells
 * an operator to produce. Ported from the spike's parser
 * (`yt-pot-test/fallback-spike.mjs`) with two tightenings: `#HttpOnly_` rows
 * are cookies, not comments — the session cookies the jar needs most (SID,
 * `__Secure-*PSID`) are HttpOnly, and skipping them would quietly sign with
 * half a session — and the domain filter is exact, so "evil-youtube.com" is
 * not a youtube.com row.
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

// ---- reading the account (the extension's ytAuth renderers, slimmed) ----------

type Json = Record<string, unknown>;

/** Every object stored under [key], anywhere inside [root]. */
function renderers(root: unknown, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(root)) {
    for (const item of root) renderers(item, key, out);
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Json);
      else renderers(v, key, out);
    }
  }
  return out;
}

/** A `runs` or `simpleText` field as plain text. */
function text(node: unknown): string {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  if (n?.runs) return n.runs.map((r) => r.text ?? '').join('');
  return n?.simpleText ?? '';
}

/** The account's photo: the largest thumbnail, which YouTube orders last. */
function photo(item: Json): string | null {
  const thumbnails = (item.accountPhoto as { thumbnails?: { url?: string }[] } | undefined)?.thumbnails;
  return thumbnails?.at(-1)?.url ?? null;
}

/** Why an account_menu answer holds no account, read from what YouTube said about the session. */
function describeEmpty(menu: unknown): string {
  const services =
    (menu as { responseContext?: { serviceTrackingParams?: { params?: { key?: string; value?: string }[] }[] } })?.responseContext
      ?.serviceTrackingParams ?? [];
  const loggedIn = services
    .flatMap((service) => service.params ?? [])
    .find((param) => param.key === 'logged_in')?.value;
  if (loggedIn === '0') return 'YouTube answered as if signed out — the fallback session was not accepted';
  return 'no account in the answer';
}

// ---- the credential ------------------------------------------------------------

/**
 * The jar as a live credential: what signs a call, and who the page should be
 * told is playing. The cookie value and the SAPISID secret live in memory
 * only; nothing returned to a caller ever carries either.
 *
 * The jar is *living*, because a static one is measured to die within about a
 * quarter hour: Google rotates the timestamp cookies (`__Secure-1PSIDTS` and
 * friends) on every authenticated response, and whichever side holds the
 * session — the browser the jar was exported from, if it stayed signed in —
 * rotates the other side's copy out from under it (yt-dlp's "no longer valid;
 * likely rotated in the browser", 2026-11-21, after a jar that had resolved
 * itag 251 from this same egress half an hour earlier). This relay is the one
 * making the account's calls, so it is the side that keeps the session: the
 * rotations YouTube sends while serving a signed call are absorbed into the
 * live jar, the next call signs with them, and the jar is persisted back to
 * [persistPath] (as one raw `Cookie:` line) so a restart continues the same
 * session instead of a dead export.
 */
export class FallbackCredential {
  private readonly jar: Map<string, string>;
  private readonly persistPath: string | null;
  private cookie: string;
  private secret: string | null;
  /** The identity authState answered, cached for the process's lifetime (the doc: "in memory"). */
  private cached: YtAuthState | null = null;
  /** One account read in flight, however many callers arrive while it runs. */
  private reading: Promise<YtAuthState> | null = null;
  /** A trailing persist, so a burst of rotations becomes one write. */
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(jar: ReadonlyMap<string, string>, persistPath: string | null = null) {
    this.jar = new Map(jar);
    this.persistPath = persistPath;
    this.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    this.secret = SIGNING_COOKIES.map((name) => jar.get(name)).find((value): value is string => !!value) ?? null;
  }

  /**
   * The Set-Cookie lines YouTube sent while serving one of this credential's
   * signed calls, merged into the live jar. Returns whether anything changed.
   * Foreign domains and names the header grammar rejects are ignored; an empty
   * value is a deletion, so the cookie stops being sent rather than lingering.
   */
  absorbSetCookies(lines: readonly string[]): boolean {
    let changed = false;
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
        if (this.jar.delete(name)) changed = true;
        continue;
      }
      if (!isCookieValue(value)) continue;
      if (this.jar.get(name) !== value) {
        this.jar.set(name, value);
        changed = true;
      }
    }
    if (changed) this.rotate();
    return changed;
  }

  /** Re-derives the signing material from the rotated jar and schedules the persist. */
  private rotate(): void {
    this.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    this.secret = SIGNING_COOKIES.map((name) => this.jar.get(name)).find((value): value is string => !!value) ?? null;
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
   * The headers that sign one InnerTube call dressed as [origin]: the jar as
   * a Cookie header, the SAPISIDHASH for that origin, and the authUser that
   * addresses the one login the jar is. [timestampSeconds] is the signature's
   * clock, an argument so tests can pin it.
   */
  sign(origin: string, timestampSeconds: number): Record<string, string> {
    if (!SIGNED_ORIGINS.has(origin)) {
      // The fence restated where the jar is actually attached: a change that
      // would send the cookie somewhere new must fail, not ship.
      throw Object.assign(new Error(`the fallback credential only signs ${MUSIC_ORIGIN} and ${WWW_ORIGIN}`), {
        code: 'internal',
      });
    }
    const headers: Record<string, string> = { cookie: this.cookie, 'x-goog-authuser': '0' };
    if (this.secret) headers.authorization = sapisidhash(this.secret, origin, timestampSeconds);
    return headers;
  }

  /**
   * authState over the fallback: the throwaway's name and avatar, read once
   * through the signed session and cached. A failed read is answered as
   * signed-in-with-problem and not pinned, so the next call tries the account
   * again — a dead burner surfaces as a message, not as a wrong "signed out".
   */
  authState(fetchImpl: typeof globalThis.fetch, refresh = false): Promise<YtAuthState> {
    if (!refresh && this.cached) return Promise.resolve(this.cached);
    this.reading ??= this.readIdentity(fetchImpl)
      .then((state) => {
        if (state.problem === null) this.cached = state;
        return state;
      })
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  /** Signed in regardless of the read: playback is signed by the jar either way. [problem] says what YouTube said, never what the relay holds. */
  private problemState(problem: string): YtAuthState {
    return { browserSignedIn: false, connected: true, signedIn: true, accounts: [], active: null, problem };
  }

  /** Reads the throwaway's identity from account_menu through the signed session. */
  private async readIdentity(fetchImpl: typeof globalThis.fetch): Promise<YtAuthState> {
    // account_menu is the endpoint that names the login a jar belongs to; the
    // extension's ytAuth read it the same way, WEB_REMIX dressed and signed.
    const url = new URL(`${MUSIC_ORIGIN}/youtubei/v1/account/account_menu?prettyPrint=false`);
    const impersonation = ytImpersonationFor(url);
    if (!impersonation) return this.problemState('account_menu is not a call this relay can make');

    let answer: HttpResponse;
    try {
      answer = await serialise(
        await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-youtube-client-name': '67',
            'x-youtube-client-version': WEB_REMIX_VERSION,
            ...impersonation,
            ...this.sign(MUSIC_ORIGIN, Math.floor(Date.now() / 1000)),
            'user-agent': CHROMIUM_USER_AGENT,
          },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl: 'en', gl: 'US' }, user: {} },
          }),
          // The jar is attached explicitly in these headers; the ambient cookie
          // store is empty and stays that way, same as every other upstream call.
          credentials: 'omit',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }),
        MAX_RESPONSE_BYTES,
      );
    } catch (error) {
      return this.problemState(`account_menu: ${error instanceof Error ? error.message : 'the call failed'}`);
    }

    if (answer.status !== 200) {
      // What YouTube said, in the fewest words: the status, plus YouTube's
      // own error message when the body carries one. Neither can quote the jar.
      let said = `HTTP ${answer.status}`;
      try {
        const api = (JSON.parse(answer.body) as { error?: { message?: unknown } }).error;
        if (api && typeof api.message === 'string') said += `: ${api.message}`;
      } catch {
        // Not JSON — a refusal page; the status is the whole sentence.
      }
      return this.problemState(`account_menu: ${said}`);
    }

    let menu: unknown;
    try {
      menu = JSON.parse(answer.body);
    } catch {
      return this.problemState('account_menu: the answer was not JSON (a bot-check page, most likely)');
    }
    const header = renderers(menu, 'activeAccountHeaderRenderer')[0];
    if (!header) return this.problemState(`account_menu: ${describeEmpty(menu)}`);

    const name = text(header.accountName) || 'Relay account';
    const email = text(header.email) || null;
    const handle = text(header.channelHandle) || null;
    const avatarUrl = photo(header);
    // One login, one channel: the jar is a single throwaway, so there is
    // nothing to switch between. The id keeps the extension's
    // `authUser:pageId` shape so the page's machinery sees a channel like any
    // other it has ever handled.
    const channel = { id: '0:own', name, handle, avatarUrl, brand: false };
    const account: YtAccount = { authUser: '0', name, email, avatarUrl, channels: [channel] };
    return {
      browserSignedIn: false,
      connected: true,
      signedIn: true,
      accounts: [account],
      active: { ...channel, authUser: '0' },
      problem: null,
    };
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
 * The file is the relay's to keep from then on: as YouTube rotates the
 * session, the jar is persisted back to it as one raw `Cookie:` line, so the
 * export is only the jar's *seed*. The runbook says to export from a browser
 * signed out immediately afterwards — a browser that stays signed in keeps
 * rotating the session out from under the relay, which is what kills a static
 * export (measured 2026-11-21).
 */
export function loadFallbackCredential(path: string | undefined): FallbackCredential | null {
  if (!path) return null;
  const jar = parseCookieJar(new TextDecoder().decode(readFileSync(path)));
  if (jar.size === 0) {
    throw new Error(`${path} holds no youtube.com or google.com cookies; the fallback cannot sign anything`);
  }
  return new FallbackCredential(jar, path);
}
