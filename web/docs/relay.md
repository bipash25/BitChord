# The server relay (`web/relay`)

A small HTTP service that does the extension's work for browsers that can't
install one — every mobile browser, locked-down devices, Safari. It exists so
the site's core (browse, search, play, lyrics, addons, Listen Together) works
on a phone with nothing but a URL.

The decision it records: the extension (prompt §4) was built so **no server
traffic and no credential custody** were ever needed — the user's own browser
made every request, from their own IP, with the extension only doing header and
CORS surgery. The relay takes that job over **entirely**: phase 1 (this
document's contract) serves the anonymous, JSON-sized half, and phase 2 removes
the extension outright — sign-in arrives as brokered OAuth whose tokens stay in
the user's browser (see the last section). What the relay never does, in any
phase:

- **proxy audio.** Audio bytes flow browser ← googlevideo directly, on a plain
  media element (see "Playback in relay mode"). The original compute budget
  argument (prompt §1: ~150 Mbps per 1000 listeners) still holds.
- **hold user credentials.** No cookies, no `sp_dc`, no Discord tokens
  server-side — a server holding users' raw sessions is a honeypot. Phase 1
  serves anonymous only; phase 2 adds YouTube sign-in through Google's OAuth
  device flow, whose tokens live client-side (below). One deliberate
  exception, decided in `web/docs/private-deployment.md`: a *throwaway*
  account's cookie as the anonymous-fallback signer on a private deployment
  — never the public site, never a personal account.
- **become a general proxy.** Every method is limited to an allowlist of hosts.

What it *does* do — the header surgery the extension's `declarativeNetRequest`
rules used to perform (the extension is gone; its rules went with it),
server-side:

| Request | Headers the relay sets |
|---|---|
| `music.youtube.com/youtubei/*` | Origin/Referer/X-Origin = `https://music.youtube.com` |
| `www.youtube.com/youtubei/*` | Origin/Referer/X-Origin = `https://www.youtube.com` |
| `www.youtube.com/sw.js_data`, `/iframe_api`, `/s/player/*` | none (plain fetch, rules 3–5 only added CORS, which the relay adds naturally) |
| `www.youtube.com/api/jnn/*` (BotGuard GenerateIT) | Origin/Referer = `https://www.youtube.com` |

In extension mode the page makes these calls itself because the rules let it;
in relay mode the same calls travel through the relay, which performs them with
the same impersonation. **Audio is the difference**: rule 6/7 rewrite headers on
`googlevideo.com` so Shaka's XHRs work; the relay never touches googlevideo.
The page's media element requests it without Origin or Referer — exactly what
rule 7 spends effort arranging for `c=VISIONOS` URLs — so no rewriting is
needed there at all.

## The contract

The relay speaks the page ↔ extension bridge contract (`web/shared/src/bridge/`)
as a third transport, `serverBridge` (`web/shared/src/bridge/server.ts`, already
written). One endpoint:

- `POST {base}/bridge` — body: a `BridgeRequest` envelope, answer: a
  `BridgeResponse` envelope. Same ids, same `protocol` check
  (`BRIDGE_PROTOCOL`), same error codes as `extension/entrypoints/background.ts`.

The relay's `ping` answers:

```jsonc
{ "version": "<web/relay/package.json version>", "protocol": 1, "browser": "server", "capabilities": ["yt", "addon", "lyrics"] }
```

Methods served:

| Method | Behaviour |
|---|---|
| `ping` | as above |
| `yt.fetch` (no `auth`) | allowlisted YouTube hosts, impersonated as the table above |
| `yt.fetch` (`auth: true`) | `unauthenticated`: "The relay can't sign YouTube requests. The extension can." |
| `addon.fetch` | any `https://` URL (user-added addon servers), no cookies, capped |
| `lyrics.fetch` | only the hosts in the relay's `LYRIC_ORIGINS` (`web/relay/src/hosts.ts`) |
| `lyrics.permissions` | `{ granted: origins.filter(host is allowlisted) }` — the relay needs no grants |
| `lyrics.requestPermissions` | no-op `{}` |
| `yt.authState` | the static signed-out `YtAuthState` |
| anything else | `{ ok: false, error: { code: 'unsupported', … } }` |

Responses are serialised the way the extension's `ytFetch` did: text
bodies as `bodyEncoding: 'text'`, anything else base64.

The relay is stateless. It keeps **no** cookies, tokens or user data, and adds
no credential to any request (`credentials: 'omit'`, and it drops `cookie`,
`authorization`, `x-goog-*` headers from the page's params).

## Abuse limits

A public relay is a free CORS proxy if it isn't fenced:

- **Origins.** `RELAY_ALLOWED_ORIGINS` (env, comma-separated, same shape as the
  extension's `BITCHORD_SITE_ORIGINS`). `Access-Control-Allow-Origin` echoes the
  request origin only if allowed; otherwise no CORS header, so browsers outside
  the list can't read answers. `OPTIONS /bridge` answers the preflight
  (`POST`, `content-type`, max-age 86400).
- **Rate limit.** Per-IP token bucket (e.g. 90/min sustained, 60 burst). Over
  it: `429` with `Retry-After`. The page surfaces that as a bridge `network`
  error (`server.ts` already maps it).
- **Size and time.** Request bodies ≤ 64 KB (InnerTube bodies are small);
  responses ≤ 8 MB (player scripts are the largest thing fetched); upstream
  timeout 15 s.
- **Cache.** GETs only, in-memory LRU (≈512 entries): `sw.js_data` and the
  player script for 10 min, `youtubei` JSON for 2 min, addon manifests for 5.
  Keyed by method + URL. Cuts the InnerTube request rate per user by most of
  the browsing chatter and softens the datacenter-IP problem below.
- No query-string or header secrets in v1; the origin list is the fence. A
  `RELAY_KEY` for private deployments can come later.

## User agent

The page can't send its own User-Agent (forbidden header), and the relay
represents a browser to YouTube, so the relay pins one realistic recent
Chromium UA string for every proxied YouTube request. Keep it in one constant;
update it when it ages.

## The app side (`web/app`)

Detection and precedence are already in `web/shared`: `detectExtension` tries
the server bridge last, so an installed extension — which can do more — always
wins. The app work is:

1. **`src/config.ts`**: `relayUrl: import.meta.env.VITE_RELAY_URL ?? ''`
   (empty = off), and `VITE_RELAY_URL=` in `.env.example`.
2. **`src/extension/useExtension.ts`**: pass
   `serverBridgeUrl: config.relayUrl || undefined` to `detectExtension`.
3. **`src/playback/youtube/innertube.ts`**: the fetch shim. When the active
   bridge's `transport === 'server'`, every YouTube-host request the page's
   YouTube.js session would make — InnerTube calls, `sw.js_data`, the player
   script — goes as `bridge.call('yt.fetch', …)` instead of
   `simpleRequestFetch`. The text/plain "simple request" trick exists to dodge
   CORS preflights that the extension's rules would have handled; through the
   relay there are no preflights, so the original headers can be passed through.
   BotGuard `Create` stays a direct page fetch (it allows any origin);
   `GenerateIT` already goes through `yt.fetch` and just works.
4. **`src/playback/youtube/engine.ts`**: a **progressive playback path**. When
   the transport is `server` and `hasDirectAudio(info)`, skip Shaka entirely —
   no `ensurePlayer()`, so no MediaSource requirement, which is what makes iOS
   Safari possible at all. Pick the audio format (Opus itag 251 when
   `audio.canPlayType('audio/webm; codecs="opus"')` says maybe/probably, else
   AAC itag 140; avoid DRC renditions as `selectAudio` does), decipher its URL,
   add `pot` for the WEBPO clients (unchanged), then
   `audio.crossOrigin = null; audio.src = url; audio.currentTime = startSec;
   audio.play()`. `StreamStats.mode` gains `'progressive'`. A mid-playback
   refusal (the element's error event with an HTTP cause, or googlevideo's
   403) mirrors `onShakaError`: exclude the client, reload at the same
   position on the next one with direct URLs. A client with only SABR URLs
   can't play in relay mode — skip it in the walk and, if nothing remains,
   fail with a message that says so.
5. **`src/state/player.ts`**: `crossOrigin = 'anonymous'` is set once at deck
   creation (line ~187) so the element can be routed into Web Audio. That must
   not be set for a relay-mode YouTube track — with it, the element sends
   Origin and googlevideo 403s; without it, the element cannot be routed into
   an `AudioContext` (cross-origin media is silent there). So: the engine sets
   `crossOrigin` per track before assigning `src` (null on the progressive
   YouTube path, `anonymous` on the Shaka paths), and **Automix stays off in
   relay mode**: `ensureAutomix()` must refuse (return null) when the transport
   is `server` — its graph routes the tainted element (silence) and its
   analysis fetches googlevideo without CORS. The plain crossfade already
   works without the graph via `applyVolumes`' element-volume path; Automix's
   settings row should say it needs the extension when only the relay is
   present.
6. **`videoStream()`** (music video picture): needs Shaka + DASH. In relay mode
   return `null` — the song artwork shows, as it already does for art tracks.
7. **`src/shell/AppShell.tsx` + `ExtensionPage.tsx`**: the mobile banner
   ("better in the app") is shown when *nothing can play* — no extension and no
   relay detected. With the relay present on mobile, show nothing (or a
   dismissible note); desktop without extension keeps the install banner only
   when no relay is configured. The Extension page names the relay when it's
   the transport ("Server relay · anonymous playback") and still recommends
   the extension for sign-in, Spotify and Discord.
8. **A mobile mini-player.** `PlayerBar` is `max-sm:hidden`, so today a phone
   has no controls at all. Add a compact docked bar for small screens
   (artwork, title, play/pause, next; tap → `FullScreenPlayer`, which exists
   and has the full transport), styled from `styles/tokens.css` with
   `env(safe-area-inset-bottom)` padding. Minimal — this unblocks use, it is
   not the mobile redesign.

Capabilities already make the rest of the UI degrade correctly: the relay
reports no `yt.auth`/`yt.stats`, and the settings rows and `useYtAuth` render
their signed-out states for missing capabilities. Spotify no longer reads a
capability at all — the page's own PKCE sign-in is configured by
`VITE_SPOTIFY_CLIENT_ID`, and unconfigured means its quiet state.

## Playback in relay mode — constraints

Worth saying plainly, because they are the price of no extension:

- **VISIONOS carries the relay.** It's the client that answers with direct
  URLs, needs no PO token, and whose URLs are fetched with no Origin at all
  (`web/docs/youtube-playback.md`). The web clients' streams stop at ~60–70 s
  even with the extension (the open WebPO problem), so relay mode walks
  VISIONOS → any other client that still yields direct URLs.
- **No Web Audio for YouTube tracks** → no EQ, no loudness normalisation, no
  Automix, no Web-Audio crossfade. Element volume and the volume-fade
  crossfade path apply. Addon streams that send CORS headers can still be
  routed if they already are.
- **Age-gated tracks** answer `LOGIN_REQUIRED` with no sign-in path — the
  player already caches that verdict and says so.
- **The URLs' IP mismatch.** The player request egresses from the relay's IP;
  the bytes are fetched by the user's. googlevideo has historically not
  enforced the `ip` parameter on direct URLs (Piped hands server-resolved URLs
  to browsers at scale), but it's the assumption most likely to break. The
  probe below measures it; if it ever fails, the fallback is a bounded
  range-proxy for googlevideo only — deliberately not built now.

## Deployment

`web/relay` is a pnpm workspace package: Node 22+, TypeScript, **zero runtime
dependencies** (`node:http` + the global `fetch`), vitest for tests,
`youtubei.js` as a devDependency for the probe script only. Same versions as
`web/app` uses, so the lockfile doesn't move.

```bash
pnpm --filter @bitchord/relay dev      # tsx-free dev loop, port 8787
pnpm --filter @bitchord/relay build    # tsc → dist/index.js (ESM via the package's "type":"module")
node web/relay/dist/index.js           # PORT=8787 RELAY_ALLOWED_ORIGINS=https://bitchord.in,http://localhost:5173
```

The site takes `VITE_RELAY_URL` (Cloudflare Pages env). Nicer than a second
domain: reverse-proxy the relay under the site's origin (`/relay/` → relay), so
there is no CORS at all. A Caddy stanza and a systemd unit go in
`web/relay/README.md`.

**Where it runs is a real decision, not a detail.** Every InnerTube request
from a datacenter IP carries YouTube's datacenter-IP reputation with it (the
reason the original design avoided servers entirely). A big host or a
Workers-style edge is safer than one small VM. The cache and rate limits above
are the mitigation available in code; measure with the probe before believing a
deployment works.

**Measured from the dev VPS, 2026-11-21** (AS32097 WholeSale Internet, Kansas
City; raw curl, no cookies, no PO token) **and from Cloudflare Workers egress**
(a one-file probe Worker, three runs, `C:\Users\Administrator\Projects\yt-egress-probe`):

| Call | VPS (AS32097) | Cloudflare Workers |
|---|---|---|
| `music/browse` (FEmusic_home, WEB_REMIX) | **OK** — 200, 703 KB of real shelves | **OK** — 200, same |
| `music/search` (WEB_REMIX) | **OK** — 200, 817 KB, real videoIds | **OK** — 200, same |
| `player` (VISIONOS) | **Bot-checked** — `Sign in to confirm you're not a bot` | **Bot-checked** — identical |
| `player` (WEB_REMIX, with full Origin/Referer/X-Origin impersonation) | **Bot-checked** — same refusal | same |
| `player` with a foreign `Origin` | 403 Google "Sorry… automated queries" page | — |
| `Access-Control-Allow-Origin` on youtubei responses | **absent** — a page cannot read InnerTube responses at all, from any network. This is the whole reason a relay (or the extension) must exist | same |

The conclusion this forces: **anonymous `player` is refused from datacenter
egress, period — Cloudflare's pool gets exactly the treatment a budget VPS
does.** Egress choice is therefore operational only (edge latency, price,
maintenance), never a YouTube-trust decision, and a "cleaner" datacenter IP is
a decaying lottery, not an architecture. Browse, search, lyrics and addon JSON
work from any of them.

**PO tokens do not rescue it either — measured 2026-11-21.** With
`bgutil-ytdlp-pot-provider` 2.0.2 minting genuine BotGuard PO tokens on this
VPS (verified minted, verified attached to the `player` request), five clients
— tv_samsung, tv, mweb, web_safari, web_music — were all still answered
`LOGIN_REQUIRED` / "Sign in to confirm you're not a bot" (yt-dlp 2026.10.26,
`fetch_pot=always`; test harness in `C:\Users\Administrator\Projects\yt-pot-test`).
The provider's own README documents the general rule this matches: *a PO token
does not bypass IP-based login restrictions; on datacenter IPs you additionally
need cookies.* So attestation is dead as an anonymous rescue, and **sign-in is
the only playback path through any public server**: phase 2's OAuth bearer
(NewPipe's daily reality), with the caveat that the phase-2 spike must confirm
the bearer — not cookies — is what datacenter egress is served with.

Two config traps this test surfaced, for anyone re-running it: yt-dlp's player
PO-token policy is `required=False` on the player request (only GVS tokens are
`required=True`), so the default `fetch_pot=auto` attaches **no** player token
and proves nothing; and the provider's extractor arg is now
`youtubepot-bgutilhttp:base_url=…`, not the older `youtube:getpot_bgutil_baseurl=…`.

Treat the relay's egress as swappable: it is stateless precisely so the same
code can be re-deployed on the VPS, a Worker, or both, and re-probed.

## Verification

- `web/relay/scripts/probe.mjs`: boots nothing; creates a YouTube.js session in
  Node with **all** YouTube fetches routed through a running relay (mirroring
  the page's shim), resolves a handful of the Debug page's test videoIds,
  prints the client, itag and first-byte time for each, and for the winning
  direct URL performs a `Range: bytes=0-…` fetch with **no Origin or Referer**
  (what a media element sends) and reports the bytes received. Exits non-zero
  on any failure. This is the end-to-end proof of the whole chain, minus the
  browser's media element itself.
- `pnpm -C web -r typecheck`, `pnpm -C web/relay test`, `pnpm -C web/app build`
  (needs `VITE_PARTY_SERVER_URL` set, any value).
- In a browser without the extension (desktop Chrome with the extension
  removed, or a phone): home and search load, a track starts and survives a
  seek, lyrics open, the mini-player controls playback.

## Out of scope (for now)

An audio range-proxy, a `RELAY_KEY`, progressive video (itag 18) for the
music-video picture, and — permanently — anything holding user credentials
server-side.

## Phase 2: the extension goes away

Decided 2026-11-21: the relay is the only backend, and the extension is removed
entirely — its package, its transports, its page, its banners, its build
packaging. Nothing prefers it, because nothing can find it.

**YouTube sign-in without cookies.** The extension read the user's browser
cookies; the server must not. Instead the relay brokers Google's TV **OAuth
device flow** — the one YouTube.js implements (`session.signIn()`,
`core/OAuth2.js`; `HTTPClient.js` attaches `Authorization: Bearer …` to every
InnerTube call once signed in):

- The relay scrapes the TV client id/secret at runtime (as YouTube.js does),
  mints a device code, and hands the page the user code plus the verification
  URL. The user types it at `youtube.com/activate` on any device — including
  the phone the web app runs on.
- The token exchange polls **through the relay** (the two OAuth endpoints are
  proxied; the client secret never reaches the page).
- The **tokens stay in the user's browser** (localStorage). The page's
  YouTube.js session signs in with them, and its signed-in InnerTube calls
  carry `Authorization: Bearer …`, which the relay lets through on youtubei
  hosts — phase 1 drops that header; phase 2 narrows the drop to cookies and
  `SAPISIDHASH`. "Disconnect" revokes the token; the server forgets nothing,
  because it never knew anything.
- This is NewPipe's account model: no server-side user credentials, revocable,
  works on mobile.
- Identity for the sidebar (name, avatar): `account_menu` on the signed-in
  session.
- Measured 2026-11-21, a real account through the flow: the device exchange
  works from datacenter egress, and the bearer *authenticates* — the
  anonymous bot-check is replaced by HTTP 403 PERMISSION_DENIED ("The caller
  does not have permission") on `player`. The cause is in the grant, not the
  IP: the TV flow requests the Data-API-era scope
  `http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content`
  (youtubei.js `core/OAuth2.js`), which does not cover InnerTube's internal
  `player`. The matrix in `web/docs/private-deployment.md` has since answered
  the player half: **403 on WEB, WEB_REMIX and ANDROID alike — the TV bearer
  does not open InnerTube playback, on any client.** Playback through a
  public relay is therefore credential-blocked until something changes
  upstream; on a private deployment the cookie fallback
  (private-deployment.md) is the path. The rest of the matrix has since
  closed the question completely: browse, the library families and
  `account_menu` all answer the same 403, and the official Data API v3 —
  which the gdata scope genuinely reaches — is refused only because the TV
  client's backing Google-internal project has that API disabled.
  **There is no cookieless sign-in for InnerTube: the bearer authenticates
  and opens nothing.** Phase 2's OAuth sign-in is therefore dropped; the
  private deployment's cookie fallback is the only credential path, and a
  public relay stays anonymous-only — browse, search, lyrics, addons —
  unless its operator self-hosts at home, where residential egress plays
  anonymously without any credential at all. The private path is confirmed:
  with a real jar on the dev VPS, yt-dlp resolved itag 251 over https from
  that same bot-checked egress, and a fallback-loaded relay passed the wall
  on its first live probe (see `web/docs/private-deployment.md`).
- Age-restricted playback: the signed web clients' streams still carry the
  ~60–70 s stream-protection problem (`web/docs/youtube-playback.md`),
  independent of how auth travels; age-gated tracks may stay unplayable until
  that is solved.

**Spotify: official OAuth (PKCE) in the page.** No extension, no `sp_dc`. A
Spotify app is registered once (client id, the site's redirect URIs); PKCE
keeps everything in the browser with no secret. Liked songs, playlists, the
library and import-to-YouTube-Music all work through the official Web API.
**Canvas is cut** — it was the unofficial Pathfinder API and needed `sp_dc`.
Landed as written: `web/app/src/data/spotify/auth.ts` holds the PKCE flow and
the token pair (localStorage, S256, redirect URI `{origin}/spotify`), `api.ts`
reads the library through `v1/me/playlists`, `v1/playlists/{id}/tracks` and
`v1/me/tracks`, and the `spotify.*` bridge methods and the `spotify`
capability are gone from the contract and the relay's mirror. One measured
deviation from the ideal: Spotify publishes no token-revocation endpoint, so
"Disconnect" discards the token pair locally (the remedy its own docs give for
a dead grant) and the README points at spotify.com/account/apps for removing
the grant itself; the scopes granted are read-only, which bounds what a
forgotten grant can read. An unset `VITE_SPOTIFY_CLIENT_ID` is not an error:
every Spotify surface renders its quiet "not configured on this deployment"
state.

**Discord: cut.** Rich presence from the web would mean the server holds the
user's Discord token and runs a gateway per connected user — the same
terms-violating automation the extension performed, with worse custody.
Decided with the removal (2026-11-21): Discord is gone from the web app
entirely — its settings page and presence wiring, and the `discord.*` bridge
methods from the contract and the relay's mirror. It can come back only as an
opt-in design that doesn't put a user token on the server, never as a port of
the extension's gateway.

**The removal, one mechanical pass:** delete `web/extension/`; remove the
external and Firefox-relay transports from `web/shared/src/bridge/client.ts`
(the `Bridge` interface, `serverBridge` and the envelope stay); remove
`ExtensionPage`, the `/extension` route, the install banners,
`useExtensionUpdate`, and `VITE_EXTENSION_*`; `build:site` stops packaging the
extension; `web/README.md` and `.github/workflows/web.yml` updated. Detection
becomes: the server bridge, or nothing.
