/** Build-time configuration, from Vite's `VITE_*` environment variables. */
export const config = {
  /** BitChord's Listen Together server. vite.config.ts refuses a production build without it. */
  partyServerUrl: import.meta.env.VITE_PARTY_SERVER_URL ?? '',
  /**
   * The server relay (web/docs/relay.md): the site's only transport — it does
   * the YouTube, lyric and addon networking a web page isn't allowed to do.
   * Empty means off; then nothing can play.
   */
  relayUrl: import.meta.env.VITE_RELAY_URL ?? '',
  /**
   * The Spotify app's client id (relay.md phase 2): the page signs in with
   * PKCE against the official Web API, so this is the only Spotify setting
   * there is — no secret exists anywhere. Empty means Spotify isn't
   * configured; every Spotify surface then shows its quiet "not configured"
   * state instead of an error.
   */
  spotifyClientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '',
} as const;
