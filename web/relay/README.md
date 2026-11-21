# The BitChord server relay

A small Node HTTP service that does the companion extension's work for
browsers that can't install one — every mobile browser, locked-down devices,
Safari. It exists so the site's core (browse, search, play, lyrics, addons)
works on a phone with nothing but a URL. The design record is
`web/docs/relay.md`; this package is its implementation.

The page speaks to it through the bridge contract in `web/shared/src/bridge`
as a third transport (`serverBridge`): one endpoint, `POST {base}/bridge`, a
`BridgeRequest` envelope in, a `BridgeResponse` envelope out. An installed
extension always wins over the relay, because it can do more.

## What it deliberately does not do

- **Proxy audio.** Audio bytes flow browser ← googlevideo directly, on a plain
  media element that sends no Origin and no Referer. Proxying them would spend
  ~150 Mbps per 1000 listeners on the relay's NIC, which is the compute budget
  the extension was built to avoid.
- **Hold user credentials.** No YouTube sign-in, no Spotify, no Discord. A
  server holding users' Google session cookies is a honeypot. `yt.fetch` with
  `auth: true` is answered with `unauthenticated`; those features stay
  extension-only and the UI keeps saying so.
- **Become a general proxy.** `yt.fetch` serves an allowlist of YouTube API
  hosts; `lyrics.fetch` serves the hosts in
  `web/extension/lib/lyricHosts.ts`; only `addon.fetch` serves arbitrary URLs,
  because user-added addon servers are the point of that method.
- **Add headers of its own beyond impersonation.** The extension's per-host
  lyric surgery (the Musixmatch capability cookie, Apple's Origin) is
  deliberately not ported: no cookie of any kind is ever added to an upstream
  request. Those two hosts may refuse the relay; the rest work plainly.

## Methods

| Method | Behaviour |
| --- | --- |
| `ping` | `{ version, protocol: 1, browser: "server", capabilities: ["yt", "addon", "lyrics"] }` |
| `yt.fetch` | anonymous only, allowlisted YouTube hosts, impersonated as the extension's rules do (`src/hosts.ts`); `auth: true` → `unauthenticated` |
| `addon.fetch` | any `https://` URL, no cookies, capped |
| `lyrics.fetch` | only the hosts in `LYRIC_ORIGINS` |
| `lyrics.permissions` | the requested origins that are allowlisted (the relay needs no grants) |
| `lyrics.requestPermissions` | a no-op |
| `yt.authState`, `spotify.authState` | the static signed-out states |
| `discord.state` | `{ available: false, … }` |
| anything else | `unsupported` |

Responses are serialised exactly as the extension's anonymous fetches do
(`web/extension/lib/ytFetch.ts`): text bodies as `bodyEncoding: "text"`,
everything else base64.

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

The app side takes `VITE_RELAY_URL` (Cloudflare Pages env).

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
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
# The relay is stateless: nothing to persist, nothing to read.
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
| `src/dispatch.ts` | the method switch, the failure mapping, the static states |
| `src/contract.ts` | the bridge envelope, hand-mirrored from `web/shared/src/bridge/protocol.ts` (the relay takes no dependencies, and shared ships unbundled TS for bundlers) |
| `src/hosts.ts` | the allowlists, the impersonation table, the pinned User-Agent, header sanitising |
| `src/limits.ts` | the token bucket, body cap, response cap, upstream timeout |
| `src/cache.ts` | the GET-only LRU with the per-family TTLs |
| `src/serialise.ts` | `Response` → `HttpResponse`, ported from `web/extension/lib/ytFetch.ts` |
| `src/node.d.ts` | ambient Node typings, kept narrow on purpose (no `@types/node` dependency) |
| `src/*.test.ts` | vitest suites: dispatch, hosts, limits, cache, serialise |
| `scripts/dev.mjs` | the tsx-free dev loop |
| `scripts/probe.mjs` | the end-to-end probe described above |
