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
- **Audio bytes flow browser ↔ googlevideo directly** — already true in
  relay mode; the media element fetches from the *user's* IP, no CORS
  needed for plain playback.
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
| Plays pollute the account's history/recommendations | Nothing to pollute; pause watch history and even that's gone |
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
- **Hygiene on the throwaway:** created fresh, nothing attached, no
  recovery email worth protecting; watch history paused; a second burner
  pre-created and waiting, so a bot-check on the first is a 5-minute env
  swap, not an outage.
- The existing relay fences (per-IP rate limit, response cache) keep the
  fallback account's request rate gentle as a side effect.

## Open before this is real

The spike, not yet run: one `player` call from the VPS with the cookie,
one with a device-flow bearer. Whichever answers settles the fallback
credential type for good — cookie is the expectation, bearer would be the
nicer surprise (revocable, scoped). `web/relay`'s devDependency on
`youtubei.js` is everything the test needs.

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
