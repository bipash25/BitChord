import type { FallbackCredential } from './fallback.js';
import { CHROMIUM_USER_AGENT } from './hosts.js';
import { UPSTREAM_TIMEOUT_MS } from './limits.js';

/**
 * The session keeper: the relay's share of keeping the fallback account's
 * session rotated (`web/docs/private-deployment.md`). The browser that
 * exported the jar used to do this by accident — every page load it made
 * re-issued the session cookies — and a jar nobody rotates is measured dead
 * within about a quarter hour. The relay can't harvest on the calls it
 * already makes: InnerTube responses carry no `Set-Cookie` at all (measured
 * 2026-11-21, player and account_menu alike, on a jar YouTube was still
 * recognizing), so this module performs the one request that *is* measured to
 * rotate: a page load of the www homepage as the signed-in browser would
 * make it. A HEAD suffices and costs a zero-byte body — YouTube decides the
 * rotation before it would stream anything — and the answer's `Set-Cookie`
 * lines are absorbed into the live jar (`absorbSetCookies` does the merging,
 * the persisting and the names-only log line).
 *
 * What this cannot do, recorded rather than hidden: the harvest rotates the
 * core session family (SID, HSID, SSID, APISID, SAPISID, `__Secure-1PSID`,
 * the SIDCC pair) but never the `__Secure-1PSIDTS` pair yt-dlp blames for
 * stale exports — no youtube.com page or InnerTube endpoint measured
 * re-issues those, and Google's `RotateCookies` servlet refuses every shape
 * tried (405 GET, 500 and 400 POST). Whether a PSIDTS gap matters is what
 * the fresh-jar test answers; if it does, the keeper is where the answer
 * lands.
 *
 * Hygiene is the module's law as everywhere: the jar crosses to
 * `www.youtube.com` and nowhere else, and a log line carries names and
 * statuses, never a value.
 */

/** The harvest: the www homepage, whose response re-issues the session cookies. */
const HARVEST_URL = 'https://www.youtube.com/';

/**
 * The cadence. An un-rotated jar measured dead within 15–30 minutes, so the
 * keeper sits comfortably inside that window; each harvest is one HEAD whose
 * body is empty, so the cost of the margin is ~1 KB of headers every ten
 * minutes.
 */
export const HARVEST_INTERVAL_MS = 10 * 60_000;

/** What a keeper needs from the world: the upstream fetch and the credential it rotates. Injected so tests run without a network. */
export interface SessionKeeperDeps {
  fetchImpl: typeof globalThis.fetch;
  credential: FallbackCredential;
  /** The cadence; an argument so tests can compress it. Defaults to HARVEST_INTERVAL_MS. */
  intervalMs?: number;
}

/** Runs one harvest: the navigation, the absorption, and nothing said beyond names and statuses. */
async function harvest(deps: SessionKeeperDeps): Promise<void> {
  let response: Response;
  try {
    response = await deps.fetchImpl(HARVEST_URL, {
      method: 'HEAD',
      headers: {
        ...deps.credential.navigationHeaders('https://www.youtube.com'),
        'user-agent': CHROMIUM_USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      // No ambient cookie store rides along (the same vocabulary dispatch.ts
      // uses): the jar travels only in the header the credential built.
      credentials: 'omit',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    // One missed harvest is not a lost session — the next interval tries
    // again — and the message is the network's, which never saw the jar.
    console.warn(`BitChord relay: session keeper's harvest failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!response.ok) {
    // The status is a number and the body is a HEAD's — nothing to read, so
    // nothing that could carry a value is ever repeated.
    console.warn(`BitChord relay: session keeper's harvest answered HTTP ${response.status}; the jar was not refreshed`);
    return;
  }
  const rotations = (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (rotations.length) deps.credential.absorbSetCookies(rotations);
}

/**
 * Starts the keeper for [deps.credential]: one harvest immediately — a relay
 * restarted hours after the export refreshes the stale jar before the first
 * playback request signs with it — then one per [deps.intervalMs]. Returns
 * the stop handle, which index.ts never needs (the keeper lives exactly as
 * long as the process) but tests do.
 */
export function startSessionKeeper(deps: SessionKeeperDeps): () => void {
  void harvest(deps);
  const timer = setInterval(() => void harvest(deps), deps.intervalMs ?? HARVEST_INTERVAL_MS);
  // A keeper must not be what keeps a broken process alive: the listening
  // server owns that; the timer only rides along. Node's timer has `unref`;
  // the DOM vocabulary the relay otherwise speaks does not, hence the cast —
  // the same one `getSetCookie` gets in dispatch.ts.
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}
