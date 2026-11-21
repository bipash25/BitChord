# BitChord Web

The web player and the server relay that does its networking. The original
plan is in [`docs/web-app-build-prompt.md`](../docs/web-app-build-prompt.md);
why the extension that plan called for was replaced by the relay is in
[`docs/relay.md`](docs/relay.md) (its "Phase 2" section records the removal).

| Package | What it is |
|---|---|
| `app/` | The site: Vite, React 19, TypeScript, React Router, TanStack Query, Zustand, Tailwind CSS v4 |
| `relay/` | The server relay: Node, zero runtime dependencies, the site's one transport (its own [README](relay/README.md) has the details) |
| `shared/` | The page ↔ relay bridge contract and client, used by both |
| `docs/` | `apple-music-dom.md` (the design measurements), `kira-notes.md` (how the reference YouTube web client plays), `youtube-playback.md`, `youtube-signin.md`, `queue-and-player.md`, `lyrics.md`, `spotify-and-discord.md`, `relay.md` |
| `fixtures/` | Real captured responses for parser tests (see its README) |
| `scripts/` | `capture-fixtures.mjs` |

## Setup

Node 22 or newer. pnpm comes through corepack, so nothing needs a global install:

```bash
corepack pnpm --dir web install
```

## Run the site

```bash
corepack pnpm --dir web/app dev
```

It serves on `http://localhost:5173`, and only there (`strictPort`): the
relay's default `RELAY_ALLOWED_ORIGINS` names that exact origin.

## Run the relay

Every browser — mobile included — reaches YouTube through the relay, so a
dev site needs one running:

```bash
corepack pnpm --dir web --filter @bitchord/relay dev    # tsc --watch + node --watch, port 8787
```

or built and run directly:

```bash
corepack pnpm --dir web --filter @bitchord/relay build
node web/relay/dist/index.js          # PORT=8787 RELAY_ALLOWED_ORIGINS=http://localhost:5173
```

Then point the site at it: `VITE_RELAY_URL=http://localhost:8787` in
`app/.env.local`. Without a relay nothing can play — there is no other
transport.

The relay is stateless (no cookies, no tokens, no user data) and fenced: an
origin allowlist, a per-IP rate limit, and size/time caps. Environment
(`PORT`, `RELAY_ALLOWED_ORIGINS`, `RELAY_TRUST_PROXY`), the abuse limits and
the probe that verifies a deployment are in [`relay/README.md`](relay/README.md).

## Configuration

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `VITE_RELAY_URL` | app (`app/.env.local`, Pages env) | None. Empty = off, nothing can play | The relay's base URL, e.g. `https://bitchord.in/relay`. Production sets it in the Cloudflare Pages environment |
| `VITE_PARTY_SERVER_URL` | app (`app/.env.local`, Pages env) | None. The Listen Together server; `vite build` fails without it | |
| `VITE_SPOTIFY_CLIENT_ID` | app (`app/.env.local`, Pages env) | None. Empty = Spotify isn't configured; its surfaces show a quiet "not configured" state | The Spotify app's client id for the page's PKCE sign-in (see "Spotify" below) |

## Spotify

Spotify is reached directly by the page — the official Web API with an
Authorization Code + PKCE flow, so no client secret exists anywhere and the
relay is not involved (`web/docs/relay.md`, phase 2). Setting it up, once:

1. Register an app in the [Spotify developer
   dashboard](https://developer.spotify.com/dashboard) (a "Web API" app).
   No client secret is used or needed; the flow never has one.
2. In the app's settings, add its **redirect URIs** — exactly, as Spotify
   matches them letter for letter:
   - the site's: `https://your-domain/spotify`
   - localhost, for development: `http://localhost:5173/spotify`
3. Copy the **client id** into `VITE_SPOTIFY_CLIENT_ID`
   (`app/.env.local`, or the Cloudflare Pages environment in production).

While the app is in Spotify's development mode, only the account that owns it
(and up to 25 users manually added in the dashboard's *User Management*) can
sign in — fine for a private deployment, and the thing to know before
wondering why a friend's sign-in is refused. Serving the public site means
requesting extended quota mode from Spotify.

The scopes asked for are read-only (`user-read-private`,
`playlist-read-private`, `playlist-read-collaborative`, `user-library-read`).
The tokens live in the user's browser only. "Disconnect" discards them there;
Spotify publishes no token-revocation endpoint, so a user who wants the grant
itself removed can do that at
[spotify.com/account/apps](https://www.spotify.com/account/apps).

Canvas, Spotify's looping clip, is gone with the extension: it came from the
unofficial Pathfinder API and needed `sp_dc`, which nothing holds any more.

## Deploy (Cloudflare Pages)

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `pnpm build:site` |
| Output directory | `app/dist` |
| Environment | `NODE_VERSION=22`, `VITE_PARTY_SERVER_URL`, `VITE_RELAY_URL`, `VITE_SPOTIFY_CLIENT_ID` (optional — see "Spotify") |

`build:site` builds only the app. The relay is deployed separately — it is a
Node service, not a static asset. Nicer than a second domain: reverse-proxy
it under the site's origin (`/relay/` → relay, prefix stripped, so the page's
`VITE_RELAY_URL` is `https://bitchord.in/relay` and there is no CORS at all).
The Caddy stanza, a systemd unit and the egress considerations (measure with
the probe before believing a deployment works) are in
[`relay/README.md`](relay/README.md).

## Checks

```bash
corepack pnpm --dir web -r typecheck
corepack pnpm --dir web -r test
corepack pnpm --dir web/app build
```
