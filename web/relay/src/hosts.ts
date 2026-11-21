/**
 * The relay's fences and its impersonation table — `web/docs/relay.md`'s
 * "What it does do" section, which is the extension's `declarativeNetRequest`
 * rules (`web/extension/lib/rules.ts`) performed server-side.
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
   * The origin to impersonate, or null for a plain fetch: rules 3–5 of
   * rules.ts only added CORS headers, which the relay adds naturally.
   */
  origin: string | null;
  /** X-Origin rides along on the youtubei rows only, as the table says. */
  xOrigin?: boolean;
}

const YT_RULES: readonly YtRule[] = [
  // InnerTube, as the YouTube Music and YouTube web clients (rules 1–2).
  { pattern: /^https:\/\/music\.youtube\.com\/youtubei\//, origin: 'https://music.youtube.com', xOrigin: true },
  { pattern: /^https:\/\/www\.youtube\.com\/youtubei\//, origin: 'https://www.youtube.com', xOrigin: true },
  // What YouTube.js reads to build a session and decipher stream URLs (rules 3–5): plain fetches.
  { pattern: /^https:\/\/www\.youtube\.com\/(sw\.js_data|iframe_api)(\?|$)/, origin: null },
  { pattern: /^https:\/\/www\.youtube\.com\/s\/player\//, origin: null },
  // BotGuard GenerateIT must come from YouTube's origin, Origin and Referer
  // only — the extension's own fetch rule (rules.ts) sets exactly those two.
  { pattern: /^https:\/\/www\.youtube\.com\/api\/jnn\//, origin: 'https://www.youtube.com' },
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
 * Lyric providers the page can't reach itself: a copy of
 * `web/extension/lib/lyricHosts.ts`'s LYRIC_ORIGINS, kept in sync by hand.
 * The relay performs none of the extension's per-host header surgery (the
 * Musixmatch capability cookie, Apple's Origin) — the design rule is that no
 * credential, and no cookie of any kind, is ever added to an upstream request.
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

/**
 * Header names the relay never forwards from the page's params:
 * - `cookie` and `authorization`: identity. The relay holds none, and no
 *   request it makes may carry one the page smuggled in.
 * - `user-agent`: always the relay's pinned Chromium, mirroring what a
 *   browser's fetch does to a page that tries to set its own.
 * - `host`, `content-length`: forbidden header names a browser fetch silently
 *   drops; undici would either override or trip over them.
 */
const DROPPED_HEADERS = new Set(['cookie', 'authorization', 'user-agent', 'host', 'content-length']);

/** A header name as the HTTP grammar allows it; anything else is not forwarded. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * The page's headers, sanitised: identity and fetch-managed headers dropped,
 * `x-goog-*` dropped (YouTube identity the relay speaks without), and
 * anything a browser fetch would refuse — malformed names, newlines in
 * values, non-string values from an untrusted body — dropped rather than
 * thrown at, so one bad header can't take a whole call down.
 */
export function sanitiseHeaders(headers: Record<string, string>): Record<string, string> {
  const outgoing: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.has(lower) || lower.startsWith('x-goog-')) continue;
    // JSON can carry an own "__proto__" key; assigning that name would set the prototype instead of a header.
    if (lower === '__proto__') continue;
    if (typeof value !== 'string' || value.includes('\r') || value.includes('\n')) continue;
    if (!HEADER_NAME.test(name)) continue;
    outgoing[lower] = value;
  }
  return outgoing;
}
