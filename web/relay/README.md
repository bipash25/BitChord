# The BitChord server relay

A small Node HTTP service that does the site's YouTube networking — every
browser reaches YouTube through it, on any device, with nothing but a URL.
The design record is `web/docs/relay.md`; this package is its implementation.

The page speaks to it through the bridge contract in `web/shared/src/bridge`
as its one transport (`serverBridge`): one endpoint, `POST {base}/bridge`, a
`BridgeRequest` envelope in, a `BridgeResponse` envelope out.

## What it deliberately does not do

- **Proxy audio.** Audio bytes flow browser ← googlevideo directly, on a plain
  media element that sends no Origin and no Referer. Proxying them would spend
  ~150 Mbps per 1000 listeners on the relay's NIC, a compute budget the
  original no-server design was built to avoid.
- **Hold user credentials.** No YouTube sign-in, no Spotify — Spotify never
  touches this relay at all, the page signs itself in with PKCE. A server
  holding users' Google session cookies is a honeypot — and there is no
  cookieless sign-in to hold instead (the TV OAuth bearer authenticates and
  opens nothing; `web/docs/relay.md`'s phase-2 record). One deliberate
  exception, decided in `web/docs/private-deployment.md`: the operator's
  **throwaway fallback account**, whose cookie jar this relay holds to sign
  anonymous playback on a private deployment — never the public site, never
  a personal account. See "Private deployment" below.
- **Become a general proxy.** `yt.fetch` serves an allowlist of YouTube API
  hosts; `lyrics.fetch` serves the hosts in `LYRIC_ORIGINS` (`src/hosts.ts`);
  only `addon.fetch` serves arbitrary URLs, because user-added addon servers
  are the point of that method.
- **Add headers of its own beyond impersonation.** Per-host lyric surgery (the
  Musixmatch capability cookie, Apple's Origin) is deliberately not performed:
  no cookie of any kind is ever added to a lyric or addon request. The one
  place a cookie is added at all is the fallback signing below, and it goes
  only to the two `youtube.com` InnerTube origins.

## Methods

| Method | Behaviour |
| --- | --- |
| `ping` | `{ version, protocol: 1, browser: "server", capabilities: ["yt", "addon", "lyrics"] }` — plus `"yt.auth"` when a fallback credential is loaded |
| `yt.fetch` | allowlisted YouTube hosts, impersonated per the table in `src/hosts.ts`. Anonymous InnerTube calls are signed with the fallback account when one is loaded; a page-held `Authorization` is forwarded untouched (bring your own); `auth: true` is served the same way with a fallback, `unauthenticated` without one |
| `addon.fetch` | any `https://` URL, no cookies, capped |
| `lyrics.fetch` | only the hosts in `LYRIC_ORIGINS` |
| `lyrics.permissions` | the requested origins that are allowlisted (the relay needs no grants) |
| `lyrics.requestPermissions` | a no-op |
| `yt.authState` | the fallback identity when a credential is loaded (read once, cached in memory), the static signed-out state otherwise |
| anything else | `unsupported` (including the retired `spotify.*` family — Spotify is the page's own PKCE business now, `web/docs/relay.md` phase 2) |

Responses are serialised as text bodies (`bodyEncoding: "text"`) and base64
for everything else.

## Abuse limits

A public relay is a free CORS proxy if it isn't fenced:

- **Origins.** `RELAY_ALLOWED_ORIGINS` (comma-separated). The
  `Access-Control-Allow-Origin` header echoes the request origin only when it
  is in the list; otherwise no CORS header, so browsers outside the list can't
  read an answer. The OPTIONS preflight (`POST`, `content-type`) is answered
  with `max-age: 86400`.
- **Rate.** Per-IP token bucket: 90 requests/minute sustained, 60 burst. Over
  it: HTTP 429 with `Retry-After`. Behind a reverse proxy, set
  `RELAY_TRUST_PROXY=1` so the bucket is keyed on `X-Forwarded-For` —
  otherwise every caller shares the proxy's one address.
- **Size and time.** Request bodies ≤ 64 KB (HTTP 413 over it); responses
  ≤ 8 MB (a bridge `network` error over it); upstream timeout 15 s.
- **Cache.** GETs only, in-memory LRU (~512 entries, 64 MiB of bodies):
  `sw.js_data`/`iframe_api`/the player script for 10 min, youtubei JSON for
  2 min, addon manifests for 5 min, keyed by method + URL. This cuts the
  InnerTube request rate per user by most of the browsing chatter — and
  softens the datacenter-IP problem below.

No query-string or header secrets in v1; the origin list is the fence. A
`RELAY_KEY` for private deployments can come later.

## Run and build

```bash
pnpm --filter @bitchord/relay install   # or pnpm -C web install once for the workspace
pnpm --filter @bitchord/relay dev       # tsx-free dev loop: tsc --watch + node --watch, port 8787
pnpm --filter @bitchord/relay build     # tsc → dist/
pnpm --filter @bitchord/relay test      # vitest, pure Node, no network
node web/relay/dist/index.js            # PORT=8787 RELAY_ALLOWED_ORIGINS=https://bitchord.in,http://localhost:5173
```

Zero runtime dependencies: `node:http` and the global `fetch`, nothing else.
Node 22+. The three devDependencies (`typescript`, `vitest`, `youtubei.js`)
are the versions `web/app` already pins, so the workspace lockfile doesn't
move; `youtubei.js` exists for the probe script only.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | The port the HTTP server listens on (all interfaces). |
| `RELAY_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins allowed to read answers (the Vite dev server's origin). |
| `RELAY_TRUST_PROXY` | off | `1` to key the rate limit on the first `X-Forwarded-For` value; set it only behind your own reverse proxy. |
| `RELAY_FALLBACK_COOKIES_FILE` | off | Path to the fallback account's cookie jar — a Netscape `cookies.txt` or a raw `Cookie:` header line. Signs anonymous InnerTube calls; see "Private deployment" below. |

The app side takes `VITE_RELAY_URL` (Cloudflare Pages env).

## Private deployment: the fallback account

Anonymous `player` is refused from datacenter egress — every public IP, VPS
and edge alike (`web/docs/relay.md`'s measurements) — so a relay without a
credential can browse and search but not play. The way out, decided in
`web/docs/private-deployment.md`, is a **throwaway Google account whose
cookie jar the relay holds** and signs every anonymous InnerTube call with:
the host plus 5–15 friends, everyone gets playback, nobody is asked to sign
in. This is the private deployment's design — never the public site, and
never a personal account (the blast radius of a cookie is the whole Google
login that made it).

Creating the burner, once:

1. Create a fresh Google account with nothing attached: no recovery email
   worth protecting, no subscriptions, no payment method. Assume it is burned
   the day it is made.
2. Sign in to youtube.com once in a normal browser, then **pause its watch
   history** (YouTube Settings → Playback and performance → "Pause watch
   history"), so nothing the relay plays shapes the account or marks it
   interesting.
3. Export the session as a cookies.txt with a browser extension ("Get
   cookies.txt" and friends) while signed in, then **sign out of that browser
   (or close the profile) immediately**. The file the relay wants is the
   `youtube.com` / `google.com` rows — `SID`, `HSID`, `SSID`, `SAPISID`, the
   `__Secure-*` family (HttpOnly rows included; the parser reads them). A raw
   `Cookie:` header line copied from devtools works too.
   The sign-out matters more than it looks: Google rotates the session's
   timestamp cookies (`__Secure-1PSIDTS` and friends) roughly every fifteen
   minutes, and whichever side stays signed in keeps rotating the other
   side's copy out from under it — a static export measured dead within half
   an hour of resolving tracks fine (yt-dlp's "no longer valid; likely
   rotated in the browser", 2026-11-21). The export only seeds the jar: the
   relay is the one making the account's calls from here on, so it absorbs
   the rotations YouTube sends back and persists them to the same file, and
   the session lives as long as the relay keeps running.
4. Put it somewhere the relay can read and the repo cannot — mode 600, owned
   by the relay's user:

   ```bash
   install -o relay -g relay -m 600 /tmp/cookies.txt /opt/bitchord/relay/fallback-cookies.txt
   ```

5. Point the relay at it and restart:

   ```ini
   Environment=RELAY_FALLBACK_COOKIES_FILE=/opt/bitchord/relay/fallback-cookies.txt
   ```

With a jar loaded, the relay signs every anonymous `youtubei` call it proxies
(`Cookie`, `SAPISIDHASH` for the origin the impersonation table picked,
`X-Goog-AuthUser: 0`), serves `yt.fetch` with `auth: true` the same way, and
answers `yt.authState` with the account's name and avatar — read once through
`account/account_menu` and cached in memory. The page never learns anything
credential-shaped: the cookie, the signature and the jar's contents appear in
no response, error, log line or cache key, and the jar is attached only to
the two `youtube.com` InnerTube origins. A friend who brings their own
credential never touches the fallback: a call that arrives with a page-held
`Authorization` header is forwarded untouched and left unsigned.

**Rotation.** A bot-check on the burner is an env swap, not an outage. Keep a
**second burner** pre-created and signed in, export its `cookies.txt` ahead
of time, and when the first account starts being refused again — playback
answering "confirm you're not a bot", or `yt.authState` reporting a problem —
copy the second file over the first and restart the relay. The per-IP rate
limit and the response cache keep the account's request rate gentle as a side
effect; at 5–15 users the traffic is tiny and human-shaped, which is exactly
the shape the shared-fallback design is sound at.

## The probe

`scripts/probe.mjs` is the end-to-end proof of the whole chain, minus the
browser's media element itself. Against a **running** relay it:

1. creates a YouTube.js session (Node entry) with **every** YouTube fetch
   routed through the relay as `yt.fetch` calls — the session bootstrap
   (`sw.js_data`), `iframe_api`, the player script and the InnerTube calls,
   mirroring the page's shim in `web/app/src/playback/youtube/innertube.ts`;
2. resolves five of the Debug page's test videoIds through the same client
   walk the app uses (`VISIONOS` first, then `YTMUSIC`/`WEB`/`MWEB`), printing
   the client, itag and resolve time for each;
3. performs a `Range: bytes=0-…` request on each winning direct URL with **no
   Origin and no Referer** — what a media element sends — and reports the
   bytes received.

```bash
node web/relay/dist/index.js &                        # the relay, in another shell
pnpm --filter @bitchord/relay probe http://localhost:8787
```

It exits non-zero on any failure, naming the step that failed. The
googlevideo hop (step 3) is the one thing relay mode assumes and cannot
enforce — the player request egresses from the relay's IP, the bytes are
fetched by the user's — so run the probe before believing a deployment works,
and again if playback ever breaks mid-track.

## Deployment

Nicer than a second domain: reverse-proxy the relay under the site's origin,
so there is no CORS at all in production. A Caddy stanza:

```caddyfile
bitchord.in {
    # /relay/ → the relay, prefix stripped: the page's VITE_RELAY_URL is
    # https://bitchord.in/relay and the relay itself sees plain /bridge.
    handle_path /relay/* {
        reverse_proxy 127.0.0.1:8787
    }
    # … the site itself …
}
```

(With `RELAY_TRUST_PROXY=1` set on the relay so the rate limit sees the real
client addresses Caddy forwards; Caddy appends to `X-Forwarded-For` and the
relay takes the first value.)

A systemd unit:

```ini
[Unit]
Description=BitChord server relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=relay
WorkingDirectory=/opt/bitchord/relay
Environment=PORT=8787
Environment=RELAY_ALLOWED_ORIGINS=https://bitchord.in
Environment=RELAY_TRUST_PROXY=1
# Private deployment only — the fallback account ("Private deployment" above).
#Environment=RELAY_FALLBACK_COOKIES_FILE=/opt/bitchord/relay/fallback-cookies.txt
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
# The relay is stateless: nothing to persist. With a fallback configured the
# one thing it reads is that jar, once, at startup — read-only is all it needs.
NoNewPrivileges=true
ProtectSystem=strict
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Where it runs is a real decision, not a detail.** Every InnerTube request
from a datacenter IP carries YouTube's datacenter-IP reputation with it — the
reason the original design avoided servers entirely. A big host or a
Workers-style edge is safer than one small VM. The cache and the rate limits
above are the mitigation available in code; measure with the probe before
believing a deployment works. Bind the port to localhost and let the reverse
proxy own the public face.

## Layout

| File | What lives there |
| --- | --- |
| `src/index.ts` | startup, env, CORS fencing, the `POST /bridge` endpoint |
| `src/dispatch.ts` | the method switch, the failure mapping, the static states, the fallback signing |
| `src/fallback.ts` | the fallback credential: jar parsing, SAPISIDHASH, the account identity read |
| `src/contract.ts` | the bridge envelope, hand-mirrored from `web/shared/src/bridge/protocol.ts` (the relay takes no dependencies, and shared ships unbundled TS for bundlers) |
| `src/hosts.ts` | the allowlists, the impersonation table, the pinned User-Agent, header sanitising |
| `src/limits.ts` | the token bucket, body cap, response cap, upstream timeout |
| `src/cache.ts` | the GET-only LRU with the per-family TTLs |
| `src/serialise.ts` | `Response` → `HttpResponse` |
| `src/node.d.ts` | ambient Node typings, kept narrow on purpose (no `@types/node` dependency) |
| `src/*.test.ts` | vitest suites: dispatch, fallback, hosts, limits, cache, serialise |
| `scripts/dev.mjs` | the tsx-free dev loop |
| `scripts/probe.mjs` | the end-to-end probe described above |
