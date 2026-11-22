/**
 * The relay's fences and its impersonation table — `web/docs/relay.md`'s
 * "What it does do" section: the header surgery the extension's
 * `declarativeNetRequest` rules used to perform, done server-side since the
 * extension went away.
 *
 * Every method is limited to an allowlist of hosts; the relay is never a
 * general proxy. All header names it builds are lowercase, which is how both
 * a `Headers` instance and the serialised `HttpResponse` report them.
 */

/**
 * The relay's face to YouTube (relay.md "User agent"). A page cannot send its
 * own User-Agent — it is a forbidden header — and the relay represents a
 * browser, not a Node script, so one realistic recent desktop Chromium UA is
 * pinned onto every upstream request. Node's default undici UA ("node") is
 * exactly the string YouTube's bot heuristics were written to catch.
 *
 * Taken 2026-11-21; update it as it ages.
 */
export const CHROMIUM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/** One row of the impersonation table (relay.md): a URL pattern and the YouTube origin it is dressed as. */
interface YtRule {
  pattern: RegExp;
  /**
   * The origin to impersonate, or null for a plain fetch: the
   * session-bootstrap URLs only ever needed CORS, which the relay adds
   * naturally.
   */
  origin: string | null;
  /** X-Origin rides along on the youtubei rows only, as the table says. */
  xOrigin?: boolean;
}

const YT_RULES: readonly YtRule[] = [
  // InnerTube, dressed as the YouTube Music and YouTube web clients.
  { pattern: /^https:\/\/music\.youtube\.com\/youtubei\//, origin: 'https://music.youtube.com', xOrigin: true },
  { pattern: /^https:\/\/www\.youtube\.com\/youtubei\//, origin: 'https://www.youtube.com', xOrigin: true },
  // What YouTube.js reads to build a session and decipher stream URLs: plain fetches.
  { pattern: /^https:\/\/www\.youtube\.com\/(sw\.js_data|iframe_api)(\?|$)/, origin: null },
  { pattern: /^https:\/\/www\.youtube\.com\/s\/player\//, origin: null },
  // BotGuard GenerateIT must come from YouTube's origin, Origin and Referer only.
  { pattern: /^https:\/\/www\.youtube\.com\/api\/jnn\//, origin: 'https://www.youtube.com' },
  // Playback-tracking pings (`videostatsPlaybackUrl` & family from a signed
  // /player answer): the page's history reporting sends them as GETs with
  // `auth: true`, and the relay signs them like any other YouTube call
  // (web/app historyReporting.ts). Dressed as the music client — the WEB_REMIX
  // page a stats ping's own `c=` parameter names.
  { pattern: /^https:\/\/s\.youtube\.com\/api\/stats\//, origin: 'https://music.youtube.com' },
];

/**
 * The headers a proxied `yt.fetch` is dressed in, or null when the URL is not
 * allowed. An empty object means "allowed, plain fetch": no impersonation,
 * only the relay's pinned User-Agent.
 */
export function ytImpersonationFor(url: URL): Record<string, string> | null {
  for (const rule of YT_RULES) {
    if (!rule.pattern.test(url.href)) continue;
    if (!rule.origin) return {};
    const headers: Record<string, string> = { origin: rule.origin, referer: `${rule.origin}/` };
    if (rule.xOrigin) headers['x-origin'] = rule.origin;
    return headers;
  }
  return null;
}

/**
 * Whether [url] is an InnerTube API call on one of the two web origins —
 * browse, search, player and their siblings. This is the family a fallback
 * credential signs (`web/docs/private-deployment.md`); the session bootstrap
 * and BotGuard rows stay anonymous, exactly as the table dresses them.
 */
export function isInnerTubeUrl(url: URL): boolean {
  return (
    (url.hostname === 'music.youtube.com' || url.hostname === 'www.youtube.com') &&
    url.pathname.startsWith('/youtubei/')
  );
}

/**
 * Whether [url] is one of YouTube's playback-tracking pings
 * (`s.youtube.com/api/stats/*`): the watch-history reporting the page sends
 * as the signed account. Two things distinguish them from every other row
 * the table serves: they are side effects rather than reads — a served
 * answer must never come from the cache, or the play it registers is
 * swallowed — and the page only ever sends them as GETs, so anything else
 * aimed at the family is not the page speaking.
 */
export function isStatsUrl(url: URL): boolean {
  return url.hostname === 's.youtube.com' && url.pathname.startsWith('/api/stats/');
}

/**
 * Lyric providers the page can't reach itself. The list is the relay's own
 * now that the extension (whose `lyricHosts.ts` it was copied from) is gone;
 * the app learns which of the hosts it routes through the bridge are served
 * by asking `lyrics.permissions`. The relay performs no per-host header
 * surgery (the Musixmatch capability cookie, Apple's Origin) — the design
 * rule is that no credential, and no cookie of any kind, is ever added to a
 * lyric or addon request. The only cookies the relay ever attaches are jar
 * credentials — the fallback's or the visitor's page-held one — on the
 * YouTube rows they sign: InnerTube and the stats pings (`fallback.ts`,
 * `userjar.ts`).
 */
export const LYRIC_ORIGINS = [
  'https://lrc.red',
  'https://lyrics-api.binimum.org',
  'https://lyrics-api.boidu.dev',
  'https://unison.boidu.dev',
  'https://lyrics.paxsenix.org',
  'https://api.paxsenix.org',
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
  'https://lrclib.net',
  'https://mobileservice.kugou.com',
  'https://lyrics.kugou.com',
  'https://apic.musixmatch.com',
  'https://www.musixmatch.com',
  'https://genius.com',
  'https://music.apple.com',
  'https://amp-api.music.apple.com',
] as const;

/** lyrics.fetch's fence: the whole origin (scheme, host, port) must be one of LYRIC_ORIGINS. */
export function isLyricOrigin(url: URL): boolean {
  return (LYRIC_ORIGINS as readonly string[]).includes(url.origin);
}

/** addon.fetch's fence: any https URL. The hosts are user-added addon servers, so the list is the protocol. */
export function isAddonUrl(url: URL): boolean {
  return url.protocol === 'https:';
}

/** A valid DNS hostname label sequence, with no empty labels or leading/trailing dots. */
const GOOGLEVIDEO_HOST = /^(?:[a-z0-9-]+\.)*googlevideo\.com$/i;

/**
 * `/media`'s fence: only `https://[*.]googlevideo.com/videoplayback` with no
 * embedded credentials and no non-default port. The endpoint streams unbounded
 * responses, so anything outside googlevideo's playback path is refused before
 * a socket opens.
 */
export function isMediaUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    GOOGLEVIDEO_HOST.test(url.hostname) &&
    url.pathname === '/videoplayback'
  );
}

/**
 * Header names the relay never forwards from the page's params:
 * - `cookie`: identity. A page never gets to choose the session a request
 *   rides on — a jar is attached by the relay, from the credential it holds
 *   or the `x-bitchord-user-jar` header the *whole call* arrived with, never
 *   from the call's own headers (private-deployment.md's hygiene).
 * - `user-agent`: always the relay's pinned Chromium, mirroring what a
 *   browser's fetch does to a page that tries to set its own.
 * - `host`, `content-length`: forbidden header names a browser fetch silently
 *   drops; undici would either override or trip over them.
 *
 * `authorization` is handled apart from this list — see `sanitiseHeaders`.
 */
const DROPPED_HEADERS = new Set(['cookie', 'user-agent', 'host', 'content-length']);

/** A header name as the HTTP grammar allows it; anything else is not forwarded. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * The page's headers, sanitised: identity and fetch-managed headers dropped,
 * `x-goog-*` identity headers dropped (YouTube session/visitor headers the
 * relay speaks without, or adds itself when a fallback is configured) — except
 * `x-goog-api-key`, which is the public WAA API key BotGuard's `GenerateIT`
 * requires (measured 2026-11-21: stripping it makes `GenerateIT` answer HTTP
 * 403 "Permission denied on the service", keeping it answers 200) — and
 * anything a browser fetch would refuse dropped rather than thrown at, so one
 * bad header can't take a whole call down.
 *
 * `authorization` is dropped like the rest of the identity headers unless
 * [options.forwardAuthorization] is set (yt.fetch sets it): a page-held
 * credential is the caller's own per-call choice and travels untouched. One
 * exception stands in both settings: a `SAPISIDHASH` value is never the
 * page's to speak — that scheme is the relay's to build over its own jar, so
 * a page-supplied one is dropped like a cookie would be.
 *
 * [options.forwardVisitorId] (the stats-ping family only) lets the page's
 * `x-goog-visitor-id` through: the visitor id is part of the playback-stats
 * protocol — the signed session's own id, which the page reads from the
 * session-bound player answer (`historyReporting.ts`) so a play is reported
 * about the account that played it, not "about nobody" — and it is a
 * pseudonymous id, never a credential. Every other family still drops it,
 * along with the rest of the identity headers.
 */
export function sanitiseHeaders(
  headers: Record<string, string>,
  options: { forwardAuthorization?: boolean; forwardVisitorId?: boolean } = {},
): Record<string, string> {
  const outgoing: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    // JSON can carry an own "__proto__" key; assigning that name would set the prototype instead of a header.
    if (lower === '__proto__') continue;
    if (typeof value !== 'string' || value.includes('\r') || value.includes('\n')) continue;
    if (lower === 'authorization' && (!options.forwardAuthorization || value.startsWith('SAPISIDHASH '))) continue;
    if (
      DROPPED_HEADERS.has(lower) ||
      (lower.startsWith('x-goog-') && lower !== 'x-goog-api-key' && !(options.forwardVisitorId && lower === 'x-goog-visitor-id'))
    ) {
      continue;
    }
    if (!HEADER_NAME.test(name)) continue;
    outgoing[lower] = value;
  }
  return outgoing;
}
