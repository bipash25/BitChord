# Android auth, and how much of it the web can take

Read on 2026-11-22, branch `server-relay`. Every claim cites the file and
line it was read from (paths repo-root relative). Where the InnerTubeX
library (a JitPack dependency) hides internals, that is said as
"not visible in this repo" rather than guessed. Companion docs:
`web/docs/private-deployment.md` (the web's fallback design),
`web/docs/relay.md` (the relay's contract), `web/docs/youtube-signin.md`
(the extension-era sign-in, whose account-probing facts still hold).

**Why this exists.** The web app is mid-build on own-account sign-in: the
user's YouTube cookie jar held in their browser (localStorage), forwarded
per call through the relay, which signs with it and never stores it. The
owner's question: how does the Android app actually work after sign-in —
what it takes, what it keeps, how it uses it — and can the web just
replicate the Android app? This doc answers that mechanism by mechanism.

---

## 1. The short answer

The Android app signs in by **embedding Google's real login page in a
WebView and lifting the resulting cookie jar out of it**: the whole
`music.youtube.com` cookie header plus the identity the live page's own
`ytcfg` reports, taken only when the user says "use this profile"
(`app/src/main/java/com/music/bitchord/auth/YtMusicLoginScreen.kt:130`,
`:180`). The jar is stored encrypted per Google account
(`app/src/main/java/com/music/bitchord/auth/AuthStore.kt:35`), and every
InnerTube call is then signed with `Cookie` + `SAPISIDHASH` +
`X-Goog-AuthUser`/`X-Goog-PageId` and scoped by
`context.user.onBehalfOfUser`
(`shared/src/jvmSharedMain/kotlin/com/music/bitchord/data/innertube/Innertube.kt:1115`).

The web **cannot** replicate the capture — a page cannot read another
origin's cookies, and there is no working OAuth for InnerTube (both
measured; §8) — but almost everything *after* capture is mechanical and
the in-flight BYO-jar build already covers most of it: the relay already
builds the same `SAPISIDHASH` signature for its fallback jar
(`web/relay/src/fallback.ts:270`), the page already holds and forwards a
user jar per call (`web/app/src/extension/userJar.ts:32`,
`web/shared/src/bridge/server.ts:45`), and the stats-ping history protocol
is already ported whole (`web/app/src/playback/historyReporting.ts:17`).

---

## 2. Capture — the WebView flow

### 2.1 What loads

`SIGN_IN` mode loads Google's own login page with a bounce back to
YouTube Music:

```
https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube
    &prompt=select_account&continue=https%3A%2F%2Fmusic.youtube.com%2F
```

(`app/src/main/java/com/music/bitchord/auth/YtMusicLoginScreen.kt:26`).
The user authenticates directly against accounts.google.com — 2FA and
passkeys all work, because it is the real page (`YtMusicLoginScreen.kt:38`).
`prompt=select_account` is the account chooser. Before loading, the
WebView's Google cookies are **cleared by name** — never through Google's
logout endpoint — plus `clearCache/clearHistory/clearFormData`
(`YtMusicLoginScreen.kt:92`, `auth/WebSession.kt:98`). That ordering is
deliberate: clearing without logging out means adding an account cannot
invalidate a previously saved session (`YtMusicLoginScreen.kt:42`), and a
saved login cannot wave the next sign-in straight through as the wrong
account (`WebSession.kt:48`).

`SWITCH_CHANNEL` mode does the opposite: it *installs* a saved account's
cookie snapshot into the WebView jar first
(`BrowserSession.installGoogleCookies`, `YtMusicLoginScreen.kt:93`,
`WebSession.kt:71`) and opens `music.youtube.com` itself, so the user can
switch channels in YouTube Music's own avatar-menu Accounts list — the one
screen that authoritatively knows which channels exist (`YtMusicLoginScreen.kt:47`).
**Dormant on this branch:** nothing sets `WebSessionMode.SWITCH_CHANNEL`
(any grep over `app/src/main/java` finds only the enum, the two
`MainActivity` reads, and the `MainViewModel` branch); channel switching
today goes through the API-based `AccountProfileSelector`
(`app/src/main/java/com/music/bitchord/MainActivity.kt:5523`), which asks
`account/accounts_list` / `getAccountSwitcherEndpoint` instead.

### 2.2 What triggers capture

Nothing automatic. Reaching the music origin only *enables* the confirm
button — capturing on page-load was the race that "used to create a fake
'Personal' profile and close too soon" (`YtMusicLoginScreen.kt:105`). The
user taps **Use this profile**, which raises a `captureRequest` counter
read by a `LaunchedEffect` (`YtMusicLoginScreen.kt:81`,
`MainActivity.kt:5326`); the counter, not a flag, so a second tap after a
failed first one is a new request (`MainActivity.kt:5327`).

### 2.3 What is taken

`captureFrom` reads:

1. **The whole cookie jar for music.youtube.com** —
   `CookieManager.getInstance().getCookie(MUSIC_ORIGIN)`, every cookie,
   not just SAPISID (`YtMusicLoginScreen.kt:135`). It is accepted only if
   a cookie *named* `SAPISID`, `__Secure-3PAPISID` or `__Secure-1PAPISID`
   has a value (`AuthStore.hasApiSid`, `AuthStore.kt:212` — the name match
   matters; a substring test once let a `__Secure-`-only jar pass as
   signable, `AuthStore.kt:204`). The jar is flushed synchronously so the
   on-disk jar the next sign-in reads is this one (`YtMusicLoginScreen.kt:140`).
2. **The page's own `ytcfg`**, via a JS probe evaluated in the page:
   `LOGGED_IN`, `DELEGATED_SESSION_ID` (the brand channel → `pageId`),
   `DATASYNC_ID` (→ `dataSyncId`, normalised to its `||`-suffix,
   `shared/src/jvmSharedMain/kotlin/com/music/bitchord/auth/DataSyncId.kt:8`),
   `SESSION_INDEX` (→ `authUser`), `VISITOR_DATA`, and
   `INNERTUBE_CLIENT_VERSION` (`YtMusicLoginScreen.kt:180`). A page that
   does not report itself signed in is refused (`YtMusicLoginScreen.kt:150`).

The identity fields come from the live page rather than a later
server-side fetch, "and that is the entire point": which channel the page
in front of the user is currently showing is written down in the page
(`auth/WebSession.kt:23`). The typed credential never passes through app
code — only the resulting jar and config do.

### 2.4 Validation before anything is saved

`MainViewModel.onWebSession` does not persist first. It installs the
cookie + adopted scope, then calls `account/account_menu` (with one retry,
20 s timeout); only on a real account answer is anything written
(`app/src/main/java/com/music/bitchord/ui/MainViewModel.kt:3344`). A
rejected candidate restores the previous session's signing exactly
(`MainViewModel.kt:3439`) — "the old implementation persisted first and
unconditionally set signedIn=true; a half-finished channel chooser
therefore became a durable broken 'Personal' account"
(`MainViewModel.kt:3345`). A fresh sign-in whose email matches an existing
entry upgrades that entry instead of adding a duplicate after cookies
rotate (`MainViewModel.kt:3374`).

### 2.5 What happens to the WebView afterward

On success the full-screen overlay closes (`MainActivity.kt:5400`) and
the composable leaves composition, but the WebView's cookie jar is
process-wide and **keeps the Google login** — which is why sign-out must
clear it by name (§7), and why `SIGN_IN` clears it on entry (§2.1). The
same jar also holds the Discord and Last.fm logins from their own in-app
browsers, so YouTube sign-out must never call `removeAllCookies`
(`WebSession.kt:89`).

### 2.6 The same pattern, twice more

Discord and Spotify sign-in are the same shape — real login page in a
WebView, credential harvested at the end — with a different extraction
target: Discord's token is read from `localStorage` through a fresh
same-origin iframe (Discord removes it from the top-level window) and
smuggled out via `alert` (`auth/DiscordLoginScreen.kt:35`); Spotify's
`sp_dc` cookie is read off the jar when the page lands on
open.spotify.com (`auth/SpotifyLoginScreen.kt:116`). All three agree on
the principle: type credentials into the real page, take only the session
artifact.

---

## 3. Storage — what persists, encrypted how, for how long

- **Where:** `AuthStore` over `EncryptedSharedPreferences` — a Tink
  keyset wrapped by an Android Keystore `MasterKey` (AES256_GCM), values
  AES256_GCM, key names AES256_SIV (`auth/EncryptedPrefs.kt:62`). A file
  whose keyset this device can't unwrap is deleted and recreated; a dead
  Keystore degrades to a plain prefs file rather than failing launch
  (`EncryptedPrefs.kt:39`). The file is excluded from OS backups
  (`AuthStore.kt:17`, `backup_rules.xml`).
- **What, per account:** the whole cookie-header string, the account's
  name/email, and a list of `YouTubeProfile`s — each with `pageId`,
  `dataSyncId`, `authUser`, avatar, and a brand flag — as one JSON blob
  under `google_account_sessions_v2`, plus `activeAccountId` /
  `activeProfileId` (`AuthStore.kt:35`, `auth/AccountSessions.kt:8`,
  `:51`). A legacy single-cookie entry migrates lazily so an update never
  logs anyone out (`AuthStore.kt:31`). The Discord token and the
  WebDAV/SMB passwords live in the same encrypted store (`AuthStore.kt:101`).
- **For how long:** indefinitely, until sign-out or account removal. No
  expiry is recorded and nothing rotates the stored jar — Google rotates
  cookies in a real browser through page loads, and InnerTube responses
  carry no `Set-Cookie` at all (measured,
  `web/docs/private-deployment.md:210`), so there is nothing for the app
  to absorb. A dead session is detected lazily (§7), and re-login is the
  answer.
- **`isSignedIn`** is a local shape check — the active session's cookie
  carries a signable name — not a liveness probe (`AuthStore.kt:98`).
  Process-wide it is exposed as a `StateFlow` the playback service reads,
  so the notification and widgets offer Like on exactly the tracks the
  player does (`auth/SignedIn.kt:15`).

---

## 4. The signed call — exact anatomy

A signed InnerTube call is a POST to
`https://music.youtube.com/youtubei/v1/<endpoint>?prettyPrint=false&hl=…`
(`Innertube.kt:1130`) with:

**Headers** (`Innertube.postMusic`, `Innertube.kt:1130`–`1153`):

| Header | Value | Source |
|---|---|---|
| `Cookie` | the whole stored jar | `Innertube.kt:1146` |
| `Authorization` | `SAPISIDHASH <ts>_<sha1hex(ts + " " + secret + " " + origin)>` | `Innertube.kt:1152`, `:1280` |
| `X-Goog-AuthUser` | `SESSION_INDEX` — which Google login in the jar | `Innertube.kt:1150` |
| `X-Goog-PageId` | `DELEGATED_SESSION_ID`, brand channels only | `Innertube.kt:1151` |
| `X-Goog-Visitor-Id` | session visitor id | `Innertube.kt:1144` |
| `X-YouTube-Client-Name` / `-Version` | `67` / live WEB_REMIX version | `Innertube.kt:1142` |
| `X-Origin`, `Origin`, `Referer` | `https://music.youtube.com`, `…/` | `Innertube.kt:1136` |

The signing secret is whichever of `SAPISID`, `__Secure-3PAPISID`,
`__Secure-1PAPISID` the jar carries — all three names for one value
(`Innertube.sapisidFrom`, `Innertube.kt:1266`).

**Body** (`Innertube.kt:1154`): `context.client` = `WEB_REMIX`, the live
client version, `hl`/`gl`, `visitorData`; `context.user.onBehalfOfUser` =
the account's `dataSyncId` — "only ever a value read back from a shell
that said it was signed in: Google answers an `onBehalfOfUser` it cannot
tie to the cookie with 401" (`Innertube.kt:1171`).

**The scope.** "A cookie is not an account": one Google login carries
every account and brand channel the browser ever signed into, and nothing
in the cookie says which is meant (`Innertube.kt:203`). So the scope —
`dataSyncId`, `pageId`, `authUser`, `clientVersion` — is read once per
cookie from the signed music.youtube.com shell's HTML (regexes over
`LOGGED_IN`, `DATASYNC_ID`, `DELEGATED_SESSION_ID`, `SESSION_INDEX`,
`VISITOR_DATA`, `INNERTUBE_CLIENT_VERSION`, `Innertube.kt:414`–`453`),
or adopted whole from the captured page's `ytcfg` at sign-in
(`Innertube.adoptSessionScope`, `Innertube.kt:298`). A listener-chosen
channel overrides the shell's default (`Innertube.kt:237`). A signed-out
shell yields no scope — its `DATASYNC_ID` "belongs to no account, and
sending it would 401 every request in the app" (`Innertube.kt:425`).

**visitorData.** Load-bearing, not stats garnish: a `player` request
without one is treated as no session at all (`Innertube.kt:123`). The
session-bound id from the signed shell (or captured page) outranks an
anonymous one minted from `www.youtube.com/sw.js_data`
(`Innertube.kt:148`, `:178`).

**Stats pings** (`s.youtube.com/api/stats/*`, GET) carry
`X-Origin/Origin/Referer`, `X-Goog-Visitor-Id`, `Cookie`,
`X-Goog-AuthUser`, `X-Goog-PageId` and the `SAPISIDHASH`, plus query
params `ver=2`, `c=WEB_REMIX`, `cver=<live>`, `cpn`, `cplayer`,
`cbr`, `cos`… (`Innertube.statsHeaders`, `Innertube.kt:847`; `pingStats`,
`Innertube.kt:815`).

**Stream requests** hand the jar to the extractor:
`innerTube.cookie = Innertube.cookie` before every extraction
(`shared/.../innertube/InnerTubeXResolver.kt:233`). Which clients use it,
and how the age-restricted `WEB_REMIX_SABR` path ranks signed requests,
is InnerTubeX catalog behaviour — not visible in this repo (JitPack
dependency). What is visible: uploads are requested with
authenticated clients only, login cookies first
(`InnerTubeXResolver.kt:217`), and a first refusal while signed in
escalates to an upload-hinted ask (`StreamResolver.kt:528`).

**PoToken minting** runs in a second, hidden WebView loaded with base URL
`https://www.youtube.com` and `blockNetworkLoads = true` — the BotGuard
service requests (`/api/jnn/v1/Create`, `/GenerateIT`) are made by the
app's own OkHttp, not the WebView
(`app/.../innertube/potoken/PoTokenWebView.kt:146`, `:367`). It is
entirely separate from the login WebView; one loaded page serves one
session (visitor data) and mints the session streaming token plus
per-video tokens (`shared/.../potoken/PoTokenGenerator.kt:45`).

---

## 5. Which flows go signed

Everything through `postMusic` is signed when a cookie is present
(`Innertube.kt:1126`); everything through `postMusicAnonymous` never is.

**Signed** (all `requireSession`-gated writes throw
`NotSignedInException`, `Innertube.kt:869`):

- Home (`FEmusic_home` + continuations), mood/genres, explore
  (`shared/.../data/YtMusicRepository.kt:83`, `:107`, `:303`).
- Library: Liked Music (`LM`), songs (`FEmusic_liked_videos`), albums,
  playlists, artists, subscriptions, podcasts, mixed-for-you
  (`YtMusicRepository.kt:951`–`985`, `:572`, `:1202`).
- History: browse `FEmusic_history`, remove-from-history via feedback
  tokens (`YtMusicRepository.kt:161`, `:196`).
- Identity: `account/account_menu` (`Innertube.kt:551`), channel
  enumeration via `account/accounts_list` and the youtube.com
  `getAccountSwitcherEndpoint` fallback (`Innertube.kt:561`, `:576`).
- Writes: like/dislike/removelike (`Innertube.kt:882`), save/unsave
  releases (`like/like` on a playlist id, `Innertube.kt:916`),
  subscribe/unsubscribe (`Innertube.kt:941`), library feedback tokens
  (`Innertube.kt:959`), playlist create/delete/add/remove/reorder/rename
  (`Innertube.kt:973`–`1105`).
- A *submitted* search (the query the listener commits, recorded in the
  account's search history for recall) — `runSearch(anonymous = false)`
  (`MainViewModel.kt:2159`; the endpoint records queries against the
  account, which is why the anonymous option exists at all,
  `Innertube.kt:629`).
- The `player` call made purely to obtain `playbackTracking`, which needs
  the session and a current `signatureTimestamp` parsed from YouTube's
  player JS (`Innertube.kt:715`; timestamp via
  `StreamResolver.kt:793`).
- The stats pings that write history (`Innertube.kt:772`–`812`).

**Anonymous, deliberately:**

- `searchTypeahead` — intermediate keystrokes must not land in the
  account's search history (`Innertube.kt:666`, `:676`); `search`'s own
  default is anonymous too (`Innertube.kt:629`), so only the committed
  query above carries the session.
- Stream resolution's device-client player calls (InnerTubeX decides per
  client; the relay found the same rule from the other side — VISIONOS
  signed is a 400, `web/relay/src/dispatch.ts:141`).

---

## 6. What the account buys the listener

| Feature | Mechanism | Citation |
|---|---|---|
| Identity: name, email/handle, avatar | `account_menu` → settings header and account surfaces | `Innertube.kt:551`, `InnertubeParser.kt:1217`, `MainViewModel.kt:1556` |
| Brand-channel identity | `accounts_list`/switcher enumerate channels with the `pageIdToken`/`datasyncIdToken` needed to act as each | `Innertube.kt:561`, `:553` |
| Personalised home feed | signed `FEmusic_home` shelves; recently-played only when signed in | `YtMusicRepository.kt:78`, `:128` |
| Library sections | the `FEmusic_liked_*` / corpus families, paged | `YtMusicRepository.kt:951`, `:572` |
| Like state per track | `likeButtonRenderer` on the watch queue (`/next`); no standalone "is this liked" endpoint exists | `InnertubeParser.kt:1438` |
| Like/dislike/save/subscribe writes | `like/*`, `subscription/*`, feedback tokens | `Innertube.kt:882`–`959` |
| Playlists (create/edit/own) | `playlist/*`, `browse/edit_playlist`, ownership from the header's edit capability | `Innertube.kt:973`, `InnertubeParser.kt:1566` |
| Listening history + recommendations | the three-ping protocol (playback → atr → watchtime, one `cpn`) creates entries the home feed feeds off | `PlaybackTracker.kt:19`, `:247` |
| Remove from history | feedback token off a history row's menu | `YtMusicRepository.kt:196`, `InnertubeParser.kt:1421` |
| Age-restricted playback | signed WEB_REMIX (SABR-ranked on the phone); anonymous gets a "Sign in to play this" verdict | `StreamResolver.kt:1083`, `web/docs/youtube-playback.md:56` |
| Own uploaded tracks | upload-hinted extraction, authenticated clients only; escalation on first refusal | `InnerTubeXResolver.kt:217`, `StreamResolver.kt:538` |
| Like on notification/widgets/watch | the `SignedIn` flow the playback service reads | `auth/SignedIn.kt:15` |

---

## 7. Lifecycle — rotation, expiry, multi-account, sign-out

- **Nothing refreshes the session.** No re-login, no rotation, no keeper.
  The stored jar is a snapshot; InnerTube never sends `Set-Cookie`
  (measured, `web/docs/private-deployment.md:210`), and only page loads in
  a real browser rotate Google's session cookies. A jar can die
  server-side while the app holds it.
- **Dead-session detection is lazy and partial.** `YtMusicRepository.call`
  retries once when a failure mentions 401/403/"rejected": it calls
  `Innertube.refreshSessionScope()` (drop the cached scope, re-read the
  shell under the same cookie) and repeats the call — "never loop or
  silently sign the listener out" (`YtMusicRepository.kt:1232`). If the
  shell now reports signed-out, the scope is dropped and requests degrade
  to cookie-bearing-but-unscoped, which fails writes loudly (a refused
  rating still answers HTTP 200 with an `error` object, which `rate`
  inspects and throws on, `Innertube.kt:892`). Nothing ever marks the
  account signed-out locally; **re-login is the answer**.
- **Every sign-in/sign-out resets per-identity state.** The cookie setter
  drops the scope, visitorData and channel override — "a scope kept
  across a sign-in would credit the new account's plays to the old one"
  (`Innertube.kt:104`). `StreamResolver.onSessionChanged` clears
  unplayable verdicts, client exclusions and upload marks: "an age gate
  stops mattering the moment the listener signs in" (`StreamResolver.kt:313`,
  `:361`). The view model additionally drops the on-screen library,
  likes and playlists of the identity being left (`MainViewModel.kt:3525`).
- **Multi-account.** Each Google login is kept as an independent cookie
  snapshot in the registry; `AccountProfileSelector` picks account and
  profile (personal or brand), swipes step through them
  (`MainActivity.kt:5523`, `AccountSessions.kt:33`). Selecting a profile
  re-installs that session's cookie and channel and refetches
  (`MainViewModel.selectProfile`, `MainViewModel.kt:3447`). Removing an
  account falls back to another stored one or signs out fully
  (`AuthStore.removeAccount`, `AuthStore.kt:88`; `MainViewModel.kt:3485`).
  The WebView's single process-wide jar is why `installGoogleCookies`
  exists at all (`WebSession.kt:65`).
- **Sign-out.** With multiple accounts, sign-out removes only the current
  Google session; a single-account install gets the familiar full
  sign-out (`MainViewModel.signOut`, `MainViewModel.kt:3582`). Both clear
  the chosen channel (a `dataSyncId` from one login replayed under
  another's cookie is "answered with 401 on every request",
  `AuthStore.kt:130`) and the WebView's Google cookies by name so the
  next sign-in cannot be auto-bounced (`AuthStore.kt:186`,
  `WebSession.kt:98`). The Google account itself stays logged in — Google's
  logout endpoint is never called.
- **Restore at process start.** `BitChordApplication` seeds
  `Innertube.cookie` from the encrypted store before anything resolves a
  track, restores the chosen channel *after* the cookie (setting the
  cookie clears the channel), and fires `ensureSessionScope()` in the
  background (`app/.../BitChordApplication.kt:123`–`143`). The playback
  service re-seeds from `AuthStore` when started without the UI
  (`PlaybackService.kt:1287`).

---

## 8. Can the web replicate it? — the boundary, then mechanism by mechanism

### 8.1 The hard boundary, verified

- **A web page cannot read another origin's cookies.** The Android app
  owns its WebView, so the login page's jar is its jar; a page owns
  nothing cross-origin. The extension that used to bridge exactly this
  (it read the browser's YouTube cookies and built the same SAPISIDHASH,
  `web/docs/youtube-signin.md:3`–`:12`) was removed by design
  (`web/docs/relay.md:325`).
- **There is no working OAuth for InnerTube.** The TV device-flow bearer
  authenticates and opens nothing — 403 PERMISSION_DENIED on `player`,
  browse, the library families and `account_menu` alike, and the Data API
  v3 the gdata scope reaches is disabled on the TV client's internal
  Google project: "no cookieless sign-in for InnerTube at all"
  (`web/docs/private-deployment.md:146`–`171`, `web/docs/relay.md:353`).
- **The server holding user cookies was rejected as a honeypot**
  (`web/docs/relay.md:28`). The one deliberate exception is the private
  deployment's *throwaway* fallback, never a personal account
  (`web/docs/private-deployment.md:52`).

So the web's real mechanism is the one in flight: **the BYO page-held
jar** — the visitor's own export, stored in their browser
(`web/app/src/extension/userJar.ts:20`), forwarded per call as the
`x-bitchord-user-jar` header on exactly `yt.fetch` and `yt.authState`
(`web/shared/src/bridge/server.ts:45`), signed ephemerally by the relay
and stored nowhere. **Build state (uncommitted working tree,
2026-11-22):** both halves exist. Page side — `userJar.ts` plus the
wiring (`useExtension.ts:34`, `useYtAuth.ts:28`, `SettingsPage.tsx:88`,
`historyReporting.ts:71`), including `verifyUserJar`, the
validate-before-persist probe (`userJar.ts:76`). Relay side —
`web/relay/src/userjar.ts` builds a `UserCredential` from the header
text per request ("exists for exactly one request… the relay stores
nothing, not even in memory beyond the request", `userjar.ts:7`),
signs InnerTube/stats calls with it, outranks the fallback wherever
both could apply, never caches user-signed answers, and reads the
visitor's identity from `account/account_menu` — the one identity
allowed to cross, because it is theirs (`userjar.ts:118`). What is
still *not* built is everything Android derives from the shell: the
scope (`dataSyncId`/`pageId`/`authUser`/`onBehalfOfUser`), the
session-bound visitorData, and channel enumeration. (For orientation
against the committed tree: the page half and the header plumbing were
already committed; the relay's user-jar handling is the in-flight
part.) The fences the design rests on still hold in the working tree: a
page-supplied `cookie` or `SAPISIDHASH` inside the call's own headers is
dropped — the signature is "the relay's to build over its own jar"
(`web/relay/src/hosts.ts:189`), and the jar arrives only as the
per-request header `index.ts` reads and drops with the request
(`web/relay/src/index.ts:183`).

### 8.2 Mechanism-by-mechanism verdict

"Replicable" = the BYO jar covers it, and the in-flight build or existing
relay code already does. "Extra work" = same architecture, more to build.
"Not replicable" = the mechanism itself cannot exist on the web.

| # | Android mechanism | Verdict | Why / what it takes |
|---|---|---|---|
| 1 | WebView capture of Google's login | **Not replicable** | Cross-origin cookie reads are impossible for a page; OAuth is a measured dead end (§8.1). Replacement: paste/export a jar — already the BYO design. |
| 2 | Capture-side identity confirmation (ytcfg pageId/dataSyncId/authUser) | **Extra work** | The identity read is in flight (`readUserIdentity` via `account_menu`); the *scope* is not. The relay must derive it the same way Android does: fetch the music shell under the jar (`Innertube.fetchSessionScope` is the recipe, `Innertube.kt:414`). The extension-era web already probed `SESSION_INDEX` per login (`web/docs/youtube-signin.md:18`). |
| 3 | Validate-before-persist, revert on rejection | **Replicable** | Both sides exist in flight: `verifyUserJar` asks `yt.authState` with the jar before storing (`userJar.ts:76`), and the relay answers a jarless-session paste with a signed-out state whose `problem` says what was wrong (`NO_SESSION_YT`, `web/relay/src/dispatch.ts:102`; `userjar.ts:92`) — Android's `onWebSession` discipline (`MainViewModel.kt:3344`) is the model. |
| 4 | `SAPISIDHASH` + whole-jar `Cookie` per call | **Replicable** | `FallbackCredential.sign`/`sapisidhash` build the identical signature (`web/relay/src/fallback.ts:126`, `:270`); the jar rides per call and is never stored. |
| 5 | `X-Goog-AuthUser` / `X-Goog-PageId` channel addressing | **Extra work** | `authUser` is easy (a single-login export is `0`, as the fallback signs, `fallback.ts:278`); brand channels need the `accounts_list` enumeration plus a `yt.selectChannel` path the relay currently answers `unsupported` (`web/relay/src/dispatch.ts:26`). |
| 6 | `onBehalfOfUser` scoping | **Extra work** | Web currently sends none and picks identity by headers only (`web/docs/youtube-signin.md:14`); adding it requires the shell/scope read of #2, and the discipline of never sending a stale one (the desktop measured 400s). |
| 7 | Session-bound visitorData | **Extra work** | Web mints anonymous visitorData from `sw.js_data` (deliberately uncached, `web/docs/relay.md:127`); taking the signed shell's id needs #2. |
| 8 | Signed browse/library/likes/playlist writes | **Replicable** | The page's `getSignedInnertube` + `yt.fetch auth: true` design (`web/app/src/playback/youtube/innertube.ts:37`); the relay signs whichever jar the call carries. |
| 9 | History stats pings (playback/atr/watchtime, one cpn) | **Replicable** | Ported whole: `historyReporting.ts:17` mirrors `PlaybackTracker.kt` including the final flush and atr schedule; the relay serves stats pings GET-only and never caches them (`web/docs/relay.md:92`). |
| 10 | Age-gate signed retry | **Replicable (mechanism), blocked (playback)** | The engine already retries age-gated refusals signed-in with web clients first (`web/app/src/playback/youtube/engine.ts:199`; `SIGNED_ORDER` YTMUSIC→WEB→VISIONOS, `resolver.ts:135`). The open blocker is the web clients' ~60–70 s WebPO wall, independent of auth (`web/docs/youtube-playback.md:51`). |
| 11 | Age-restricted audio via `WEB_REMIX_SABR` | **Not replicable today** | The web's progressive path cannot play SABR-only responses at all (`engine.ts:241`); the phone's SABR ranking is InnerTubeX-internal (not visible in this repo). Needs SABR support or a WebPO fix, not a sign-in change. |
| 12 | Own-upload tracks (upload-hinted walk) | **Not replicable today** | No upload escalation exists in the web resolver; the client-ranking that makes it work is InnerTubeX catalog behaviour, not visible in this repo. |
| 13 | BotGuard PoTokens in a youtube.com WebView | **Replicable, differently** | The web runs BotGuard in-page with `bgutils-js` (Create direct, GenerateIT through the relay for the Origin) — "the user's real browser is where it expects to run" (`web/app/src/playback/youtube/botguard.ts:1`). Built. |
| 14 | Multi-account with independent jars | **Extra work** | Multiple jars in the page's store plus a picker — the bridge protocol already models accounts/channels (`web/shared/src/bridge/protocol.ts:52`). The web doc currently marks this "by decision" (`web/docs/android-vs-web-ui.md:260`); the BYO jar makes it possible if wanted. |
| 15 | Keystore-encrypted at-rest storage | **Not replicable** | localStorage is plaintext; the web's mitigations are hygiene (never rendered, dropped on disconnect, `userJar.ts:17`) and the relay storing nothing. Strictly weaker than Android — say so in the connect UI. |
| 16 | Session rotation/keeper | **Not replicable cleanly** | InnerTube never rotates (measured); the fallback's keeper works only because the relay owns that jar and absorbs homepage `Set-Cookie` server-side (`web/docs/private-deployment.md:217`). Returning rotations for a *user's* jar would move the credential toward server custody — against the honeypot ruling — and `__Secure-1PSIDTS` is unrotatable by anything the relay can reach even for the fallback (`web/docs/private-deployment.md:257`). Re-export is the web's re-login. |
| 17 | Lazy dead-session detection (retry once, refresh scope) | **Replicable (half built)** | The detection half is in flight: the auth read surfaces a jar YouTube refuses as `problem` and the page drops it ("the auth read is what surfaces it", `web/relay/src/userjar.ts:15`; `useYtAuth` clears the jar on a problem, `web/app/src/extension/useYtAuth.ts:82`). The write-path refinement — retry once on 401/403, re-read the scope, never silently sign out (`YtMusicRepository.kt:1232`) — is the remaining work. |
| 18 | Disconnect-not-logout semantics; sign-out never kills other sessions | **Replicable** | `clearUserJar` is exactly Android's semantics — BitChord forgets its copy, Google keeps the session (`userJar.ts:55`). Android's subtler rule — using one saved session must not disturb another (`WebSession.kt:61`) — is free on the web, where jars are per-store strings, not one process-wide WebView jar. |
| 19 | Anonymous typeahead / committed-search split | **Replicable** | The page already keeps keystroke lookups anonymous, "like the app's (`Innertube.searchTypeahead`)" (`web/app/src/data/music/queries.ts:131`); the committed search then goes through the signed client. |
| 20 | Identity display (name/avatar/email for the user's own account) | **Replicable** | `account_menu` through the signed relay — read in flight as `readUserIdentity` (`web/relay/src/userjar.ts:118`; verified read-only in the extension era, `web/docs/youtube-signin.md:50`). The invisibility rule applies to the *fallback's* identity only (`web/docs/private-deployment.md:112`); for a visitor's own jar, "the name and avatar the UI shows [are] theirs" (`userJar.ts:11`). |

**Counts:** replicable (BYO jar covers it, largely already built or in
flight): 10 of 20 (#3, 4, 8, 9, 10*, 13, 17, 18, 19, 20 — #10's
mechanism is built, its playback wall is a separate open problem; #17's
detection half is built, its write-path retry is not). Extra work:
5 (#2, 5, 6, 7, 14). Not replicable: 5 (#1, 11, 12, 15, 16).

---

## 9. What the web build should adopt from Android

Ranked for the in-flight sign-in build:

1. **Validate before persist, and revert on rejection** — Android's
   hardest-won rule: a half-finished capture became "a durable broken
   'Personal' account" when it persisted first (`MainViewModel.kt:3345`).
   `verifyUserJar` already implements it; keep the connect flow honest
   about transport failures (ours) versus YouTube refusals (the jar's) —
   the in-flight relay side draws exactly that line ("network faults
   throw instead; they say nothing about the jar",
   `web/relay/src/userjar.ts:115`).
2. **The exact cookie set that matters, matched by name.** Signability =
   a non-empty `SAPISID` / `__Secure-3PAPISID` / `__Secure-1PAPISID`
   (`AuthStore.kt:212`, `Innertube.kt:1277`), and the signing secret is
   any of the three. A `__Secure-`-only jar is a real, working login —
   don't reject it, and don't substring-test for `SAPISID`.
3. **Never guess the account.** The jar alone says nothing about which
   login/channel it means (`Innertube.kt:203`). When the web adds
   `onBehalfOfUser` or brand channels, read the scope from the signed
   shell exactly as `fetchSessionScope` does (`Innertube.kt:414`) and
   drop a signed-out shell's values entirely — a stale `dataSyncId`
   400s every request, as the desktop measured
   (`web/docs/youtube-signin.md:14`).
4. **Session-bound visitorData outranks anonymous.** A signed-in play
   reported under an anonymous visitor id "is a play reported about
   nobody" (`Innertube.kt:441`). Take the shell's/captured page's id when
   signing in; keep the two-signal precedence so a late anonymous mint
   can't overwrite it (`Innertube.kt:148`).
5. **The stats-ping discipline.** Three pings, one cpn, `atr` at the
   response's own schedule, watchtime every 30 s, a final `final=1` flush
   on pause/track-change/end, and "a ping is a side effect — never cache
   it" (`PlaybackTracker.kt:19`, `web/docs/relay.md:92`). The port exists;
   protect the final flush, which is what keeps an entry from reading as
   a skip.
6. **Retry once on 401/403, re-read the scope, never silently sign out**
   (`YtMusicRepository.kt:1232`). The web's auth-read probe (the in-flight
   `problem` path) covers detection; the write-path refinement — one
   retry after a scope refresh, with the jar kept, since a transport
   failure is not a dead session — is the part still to build.
7. **Reset per-identity state on every identity change.** Verdicts,
   client exclusions, upload marks, the on-screen library and likes all
   belong to "who is asking" (`StreamResolver.kt:361`,
   `MainViewModel.kt:3525`). The web already resets `['music']` queries
   and resolver verdicts on identity change (`useYtAuth.ts:62`) — keep
   that list complete as signed surfaces grow.
8. **Disconnect, not logout.** Dropping the stored jar must leave the
   Google session untouched, and adding a jar must never invalidate
   another stored one (`YtMusicLoginScreen.kt:42` — trivially true for
   the web's per-store jars, worth stating in the connect copy).
9. **Age-gate retry order: anonymous refusal → signed web clients first**
   (`engine.ts:199`, `resolver.ts:135` mirrors the phone's
   WEB_REMIX-with-cookies path, `web/docs/youtube-playback.md:60`), with
   verdicts keyed per signed identity (`resolver.ts:84`, the direct
   analogue of `StreamResolver`'s session-cleared verdicts).
10. **The capture UX concept, translated.** Android never captures what
    the page hasn't confirmed: the user sees the profile the live page
    shows, says "use this profile", and only then is anything saved
    (`MainActivity.kt:5372`). The web's connect flow should show the
    verified account's own name/avatar (from `verifyUserJar`'s answer)
    before the jar is stored — never a blind paste-and-pray.

---

## 10. Related

- `web/docs/private-deployment.md` — the fallback jar, the keeper, the
  measured Set-Cookie and rotation facts the web's session model rests on.
- `web/docs/relay.md` — the relay contract, the egress and PO-token
  measurements, and the phase-2 decisions that removed the extension.
- `web/docs/youtube-signin.md` — the extension-era sign-in; its
  account-probing facts (live logins 0–9, `accounts_list` not trusted
  alone, `SESSION_INDEX` from the music shell) remain the reference for
  any future channel enumeration.
- `web/docs/android-vs-web-ui.md` — the feature-surface comparison; §12
  and its gap table row #35 predate the BYO jar and read "relay holds one
  identity / by decision".
