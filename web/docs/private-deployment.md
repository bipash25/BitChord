# Private deployment — the relay for a household, not the world

Decided 2026-11-21. A decision record for running `web/relay` for a small
private group instead of the public site, extending `web/docs/relay.md`.

## The deployment this records

The host runs the web version for **themselves plus 5–15 friends** (similar
music taste, low traffic). Everyone is asked to sign in with their own
Google account; a **throwaway account**, held by the relay, is the fallback
for anyone who hasn't — so a friend who forgot to log in gets playback
anyway instead of a dead app. The extension is dropped entirely: mobile
browsers are the target, and the relay is the only backend.

## Why the question existed (the measured facts)

From `relay.md`'s probe matrix, re-verified by hand on 2026-11-21:

- **No CORS on InnerTube, from any origin, any IP** — `youtubei` responses
  carry no `Access-Control-Allow-Origin`, and a foreign `Origin` gets
  Google's 403 "automated queries" page. A web page can send the requests
  but can never read the answers; this is why the relay (or the extension)
  must make the API calls at all.
- **Audio bytes need a bounded range-proxy (`GET /media?u=…`)** — originally
  assumed unnecessary because the acceptance probe's bounded `Range:
  bytes=0-131071` answered 206, whereas a real browser `<audio>` element sends
  open-ended `Range: bytes=0-`, which googlevideo rejects on `c=WEB_REMIX` URLs
  with HTTP 403 while refusing `Range` CORS preflights with HTTP 400 (measured
  below). At 5–15 listeners (~2 Mbps ceiling), splitting open ranges on the
  relay costs negligible bandwidth.
- **Anonymous `player` is refused from datacenter egress, period** — the
  VPS, Cloudflare Workers, and genuine PO tokens were all measured and all
  answered "Sign in to confirm you're not a bot". A signed-in session is
  the one path through that wall.

So the open question was: whose session? The host's account for everyone,
per-user accounts, or both.

## The verdict

**At 5–15 users, the shared-fallback design is sound; at public scale it
would not be.** Every objection to a server-held credential scales with
traffic, and a household is under the noise floor:

| Objection (public scale) | At 5–15 users |
|---|---|
| One account absorbing everyone's `player` calls looks like a bot farm | Total traffic is tiny and human-shaped; anomaly detection has nothing to bite on |
| Server-held credential is a honeypot | It's a burner with nothing attached — already assumed burned the day it's created |
| Plays pollute the account's history/recommendations | Nothing to pollute — and since the 2026-11-22 correction the history is the point: plays reporting to it is what keeps Recently Played and the recommendations following what's played here |
| ToS exposure for proxying on behalf of strangers | A private instance for known friends, same terms as any self-hosted proxy |

**The one form that stays wrong at any scale: the host's *main* account on
the server.** Same mechanics, but the blast radius is the whole Google
account (mail, subscriptions, recovery). The fallback credential is a
dedicated throwaway, never the personal account. Friends who sign in use
*their own* accounts through Phase 2's browser-held tokens — their calls,
their history, no server custody.

## The design

- **Fallback credential: the throwaway's YouTube cookie jar** (`SID`,
  `HSID`, `SSID`, `SAPISID`, `__Secure-*` for youtube.com/.google.com —
  the first draft of this document said `sp_dc`, which is Spotify's
  cookie and plays no part here). Requests carry the `Cookie` header
  plus the `SAPISIDHASH` authorization and `X-Goog-AuthUser` the
  extension's `ytAuth` used to build. Cookies are the *proven* path
  through datacenter egress (yt-dlp's documented rule: PO tokens don't
  rescue datacenter IPs, cookies do); the OAuth bearer is the
  NewPipe-suggested but unverified one. On a burner, the cookie's large
  blast radius is irrelevant.
- **Friends' sign-in: Phase 2 as `relay.md` specced it** — TV OAuth device
  flow, tokens in the user's browser, `Authorization: Bearer …` forwarded
  (not stored) by the relay.
- **Relay change:** `yt.fetch` with `auth: true` stops answering
  `unauthenticated` when the server holds the fallback credential — it
  signs the call with it instead. Signed-in users never touch the
  fallback; only the not-logged-in case lands on the burner.
- **Invisibility, corrected (the owner's ruling, 2026-11-22):** the
  fallback's *identity* is invisible; its *features* are not. `ping`
  answers `yt.auth` and `yt.stats` when a fallback is loaded, and
  `yt.authState` answers a functional signed-in state — `signedIn: true`
  with a chosen-channel row whose identity fields are empty — so the
  library, listen history, likes, add-to-playlist and the personalized
  home all work through the relay's signed calls, and the UI renders its
  "Sign in with YouTube" prompt wherever the account's own name, avatar,
  email or handle would have appeared. The identity-read code is gone
  outright: no name is ever read, so none can surface, on any screen. The
  operator's health check for the credential remains the probe (and the
  rotation log lines below), not an identity answer. (The 2026-11-21
  ruling this corrects — "the page is never told a session exists" —
  over-stripped: it gated off every feature the fallback was for. See
  "The invisibility correction" below.)
- **Hygiene on the throwaway:** created fresh, nothing attached, no
  recovery email worth protecting; watch history *on* — the corrected
  design reports plays to it deliberately (Recently Played and the
  recommendations follow them); a second burner pre-created and waiting,
  so a bot-check on the first is a 5-minute env swap, not an outage.
- The existing relay fences (per-IP rate limit, response cache) keep the
  fallback account's request rate gentle as a side effect.

## The invisibility correction — 2026-11-22

The first invisibility ruling (2026-11-21) was read as "the page is never
told a session exists": `ping` stopped answering `yt.auth` and
`yt.authState` answered the static signed-out state, fallback or not. That
over-stripped. Signed-out answers gate off everything the fallback existed
to provide — the signed InnerTube session (library, history, likes,
add-to-playlist), the personalized home, the age-gate signed retry in the
engine, and the watch-history reporting — leaving the burner to sign
playback into an account whose features nobody could reach.

**The corrected ruling: invisible means only that the throwaway's name,
avatar, email and handle never appear anywhere in the frontend. The
features the relay account provides are fully live.**

- `ping` answers `yt.auth` and `yt.stats` when a fallback credential is
  loaded (the capabilities are real — the relay signs), and the anonymous
  subset without one.
- `yt.authState` answers a functional but identity-free session:
  `browserSignedIn: false, connected: true, signedIn: true`, `accounts: []`,
  and an `active` channel with empty identity fields. `signedIn` is what
  the app's flows gate on; the `active` row exists so the app's
  identity-keyed cache resets engage as they do for a real sign-in; the
  empty fields are why no screen can render a name. Nothing is read to
  build the answer — the account-menu identity-read code was removed with
  the first ruling and stays removed.
- The UI shows its sign-in prompt ("Sign in with YouTube" — the pattern
  LibraryPage already carried) wherever the account's own name/avatar
  would have rendered: the sidebar's account control and Settings'
  account row. The prompt is presentation only — there is no web sign-in
  to complete (the TV bearer opens nothing), so tapping it explains that
  in one honest line.
- Watch-history reporting works: the page's stats pings
  (`s.youtube.com/api/stats/*`, GET, `auth: true`) are served signed by
  the fallback, like every other auth call, and are never cached — a ping
  is a side effect; serving one from the cache would swallow the play it
  registers.
- Hygiene is unchanged: no credential material in any log line, error,
  cache key or answer, ever; the identity-read code stays gone, so no
  query the relay can make ever asks YouTube who the burner is.

## Open before this is real

The spike, first result 2026-11-21 (a real account through the flow, run
from this VPS): the device exchange works end-to-end — code minted,
authorized, tokens returned — and the bearer **authenticates**. The
anonymous bot-check disappears; `player` instead answers HTTP 403
`PERMISSION_DENIED`, "The caller does not have permission". The cause sits
in the grant, not the IP: the TV flow requests the Data-API-era scope
`http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content`
(youtubei.js `core/OAuth2.js` line 162), which plausibly covers account
endpoints but not InnerTube's internal `player`. The second code entry
settled the player half: **403 PERMISSION_DENIED on WEB, WEB_REMIX and
ANDROID alike — the bearer does not open InnerTube playback on any
client.** Cookie is therefore no longer the expectation for playback; it
is the only candidate. Still open: whether the bearer opens the account
endpoints (browse, the library families, `account_menu`) — and whether
its gdata grant opens the official **Data API v3**, which would give
library features a sanctioned path even if InnerTube refuses.

The third code entry finished the matrix, and nothing opened: browse
home, the music library and `account_menu` all answer the same 403
PERMISSION_DENIED, and the official **Data API v3** — which the gdata
scope really does reach — is refused only because the TV client's
backing Google-internal project (861556708454) has that API disabled,
which nobody outside Google can change. So there is **no cookieless
sign-in for InnerTube at all**: the TV bearer authenticates and opens
nothing. The cookie jar is therefore not the expectation but the only
credential path — for the fallback, and for any per-user identity the
deployment ever wants (bring-your-own-cookie, page-held and forwarded
per call, is the natural v2).

**The cookie spike answered, 2026-11-21, with a real jar on this VPS:**
yt-dlp resolved itag 251 over https from this egress with the jar
attached — the documented cookies-rescue-datacenter behavior, reproduced.
The relay itself got just as far on its first live run: its probe passed
YouTube's wall (every earlier run died at `LOGIN_REQUIRED`; this one
returned formats and failed only at the local decipher step), with two
harness bugs since fixed — the relay no longer signs VISIONOS calls (a
session attached to that client is refused with a 400; it is
anonymous-by-design, so its calls stay anonymous and the walk falls
through to a web client the fallback does sign), and the probe now
installs the app's JavaScript evaluator for signature deciphering. The
final end-to-end probe run against a fallback-loaded relay is the
acceptance test for the whole design.

**It passed, 2026-11-21**: eight tracks — the four-era spread plus four
the owner hand-verified on YouTube before trusting them — every one
resolved as `YTMUSIC answered` with itag 251 and a media hop of `HTTP 206,
131072 bytes, range honored`, no `Origin` on the fetch: the exact path a
phone browser will take. VISIONOS answered the anonymous bot-check on
every track (as designed; its calls stay unsigned and the walk falls
through to the signed web client). One track was moved out of the set
rather than counted as a failure: the explicit track (Lose Yourself)
answers "Video unavailable" from every client under the fallback — the
age/explicit family, which needs an age-verified burner, not a relay
change. The run also exposed the rotation problem: the static jar that
resolved the first green run was dead half an hour later — measured
properly below, because the fix the first draft assumed (absorbing
`Set-Cookie` off signed calls) turned out to be a mechanism with nothing
to eat.

## Session keeping — measured 2026-11-21, evening

The dead-by-17:00 jar was probed directly (raw calls from this VPS, names
only ever printed), and the endpoint family split cleanly:

| Request (jar attached, signed where InnerTube) | Set-Cookie in the answer |
|---|---|
| InnerTube `player` (WEB_REMIX, music origin, SAPISIDHASH) | **none** — every time |
| InnerTube `account/account_menu` (WEB, www origin, SAPISIDHASH) | **none** |
| `GET https://www.youtube.com/` as a navigation | the session family's names: empty-value **deletions** for the first-party family (SID, HSID, SSID, APISID, SAPISID, `__Secure-1PSID`, `__Secure-1PAPISID`, LOGIN_INFO, YSC — a logout, since the session was already dead server-side) plus value rotations for the anonymous pair (GPS, SIDCC, `__Secure-1PSIDCC`) |
| `HEAD https://www.youtube.com/` as a navigation | the same names, in a zero-byte response — YouTube decides the session's cookies before it would stream a body |
| `GET https://www.youtube.com/sw.js_data` | `__Secure-YEC` only |
| `accounts.google.com/RotateCookies` | refused in every shape tried (405 GET, 500 POST with `content-length: 0`, 400 POST JSON) |

Consequences, in order:

- **InnerTube never touches the session's cookies.** The absorption wired
  into the relay's signed calls is correct code that cannot fire — the
  seeded file sat untouched through the whole first deployment (its mtime
  was still the export's, and the relay rewrites it as a `Cookie:` line on
  its first absorbed rotation). A jar refreshed only by what InnerTube
  sends stays exactly as stale as the export.
- **Page loads are the only place the session's cookies are decided** —
  re-issued for a session that is alive server-side (what a signed-in
  browser keeps receiving), deleted for one that is dead. So the relay
  runs a **session keeper** (`web/relay/src/keeper.ts`): with a fallback
  loaded, a `HEAD` of the www homepage — one immediately at startup, then
  one every ten minutes, comfortably inside the 15–30 minute death window
  of an un-rotated jar — answered with the jar, its `Set-Cookie` absorbed
  into the live jar, persisted back to the seed file. Every absorption
  logs the touched cookie *names*, never a value.
- **The dead session's page load is a logout, and the relay says so
  loudly.** The first live keeper run proved the deletion reading
  end-to-end: the harvest at 18:00 absorbed the batch above, logged the
  names, persisted — and the jar came out at 21 entries with the entire
  first-party family gone. (Each deleted name had appeared exactly once
  in the absorption log, so those were single deletion lines, not a
  delete-then-re-issue pair an account switch would produce.) The relay
  now warns on the logout signature — `YouTube logged the fallback
  session out (deleted SID, HSID, …)` — and `loadFallbackCredential`
  refuses a jar with no `SID`/`__Secure-1PSID` left (the logged-out
  remnant the persist writes) as a loud error line and runs
  anonymous-only rather than throwing, so the site's browse and search
  survive while playback waits for a fresh export. This also explains the
  evening's earlier "refresh the jar, then call player" test: the refresh
  had *removed* the session, so `player` answered the anonymous
  bot-check.
- **The bot-check itself is a separate problem from session death.** The
  signed `player` was refused at 17:36 while the homepage was still
  answering (a 425 KB `account_menu` body at 200, sign-in or sign-out
  alike), and the logout only landed at 18:00. This egress had by then
  carried three probe runs plus hosting traffic within two hours, all
  from one datacenter IP; whether the flag or the source browser's
  rotation killed the session first is what the fresh export decides.
- **The `__Secure-1PSIDTS` pair is rotated by nothing the relay can
  reach** — not the homepage, not `sw.js_data`, not InnerTube, and
  `RotateCookies` refuses. It is the cookie yt-dlp blames ("no longer
  valid; likely rotated in the browser"); in a browser it presumably
  arrives through an accounts.google.com flow the relay cannot reproduce.
  Whether the PSIDTS gap matters — whether the rest of the family is
  enough to keep a *live* session alive — is precisely what the fresh-jar
  test answers next.

**The one thing still needed from the operator:** a fresh export from the
throwaway, taken from a browser that is then **quit entirely — not signed
out** — with no other device holding that session, then probed immediately
(the relay's re-verification run). Two outcomes, each decisive: it plays,
and the keeper holds it alive past the half-hour mark that killed every
jar so far — session-keeping solved, and the PSIDTS gap answered with it;
or it bot-checks on arrival, and the account itself is flagged, making the
pre-created second burner the answer rather than any relay change.

The harness is `C:\Users\Administrator\Projects\yt-pot-test\fallback-spike.mjs`,
three modes: `anonymous` (the control — the refusal we already know),
`cookie <cookies.txt>` (Netscape cookies.txt or a raw `Cookie:` header
line; tries WEB_REMIX dressed with SAPISIDHASH and VISIONOS with the bare
jar), and `bearer` (mints through the TV device flow — enter the code it
prints — and holds the tokens in memory only, writing nothing but the
verdict). Implementation note for whichever lands last: the fallback
needs no `auth: true` round-trip — signed-in callers already carry their
own `Authorization: Bearer`, so the relay can sign the *anonymous* player
call with the fallback credential whenever one is configured.

## Media serving — why the bounded range-proxy landed

Reversing `relay.md`'s earlier "deliberately not built" decision, measured on
the live trial (`Xi8Fabcb_MA`, itag 251, `clen=1821403`):

1. **`VISIONOS_0_1` cannot carry the fallback session.** Tested against both
   InnerTube origins with Android's `VISIONOS_0_1` client (`0.1`, `VISION_OS`,
   `RealityDevice14,1`, `MOBILE`): signed `music.youtube.com/youtubei/v1/player`
   and signed `www.youtube.com/youtubei/v1/player` both answer HTTP 400
   `"Request contains an invalid argument."`, matching `VISIONOS` 1.02; unsigned
   `VISIONOS_0_1` on `music.youtube.com` answers HTTP 200 `UNPLAYABLE` ("Sign in
   to confirm you're not a bot"). `VISIONOS` therefore stays unsigned across
   every shape, and fallback-signed `YTMUSIC` (`c=WEB_REMIX`, with no
   player-request `poToken`) is the client that returns direct audio URLs.
2. **A browser `<audio>` element cannot play `c=WEB_REMIX` URLs directly.** The
   acceptance probe tested `Range: bytes=0-131071` (bounded) and got HTTP 206,
   but an `<audio>` element can only open progressive playback with `Range:
   bytes=0-` (open-ended), which googlevideo rejects on `c=WEB_REMIX` URLs with
   HTTP 403 (`MEDIA_ERR_SRC_NOT_SUPPORTED`). Splitting ranges in page `fetch()`
   is blocked too: googlevideo answers the `Range` CORS preflight with HTTP 400.
3. **Private-deployment scope makes `GET /media?u=<googlevideo-url>` cheap and
   fenced.** At 5–15 listeners (~2 Mbps peak), the public-scale 150 Mbps / 1000
   listeners objection does not apply. `web/relay/src/media.ts` validates
   `https://[*.]googlevideo.com/videoplayback` strictly, applies the per-IP
   token bucket, attaches no server credentials (`credentials: 'omit'`), and
   translates open `Range: bytes=0-` (and seek ranges) into sequential 256 KB
   bounded upstream `206` fetches streamed back with `Content-Range` and
   `Content-Length` (mirroring Android's `ChunkedDataSource.kt`).
4. **BotGuard `GenerateIT` and the ~768 KB `c=WEB_REMIX` wall.** `hosts.ts`
   previously dropped every `x-goog-*` header including the public
   `x-goog-api-key`, making `GenerateIT` fail with HTTP 403 ("Permission denied
   on the service"); preserving `x-goog-api-key` restores HTTP 200 and lets
   `startProgressive` attach the page-minted `pot`. Even with a valid browser
   `pot` (tested across `Create`+`GenerateIT`, homepage `ytcfg`+`ytAtN`,
   `videoId`, `visitorData`, and `datasyncId` bindings), `c=WEB_REMIX` streams
   still hit googlevideo's `sps=2` 403 wall at byte `786,432` (~45–60 s, the
   open WebPO issue in `web/docs/youtube-playback.md`). Separately measured via
   `yt-dlp`, signed `tv_samsung` (`c=TVHTML5`, Tizen UA) serves the full
   1.82 MB file (`Range: bytes=0-` and `bytes=1400000-1821402` both HTTP 206,
   no PO token) if full-length fallback client support is needed next.
