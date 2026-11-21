#!/usr/bin/env node
/**
 * web/relay/scripts/probe.mjs — the relay's end-to-end proof (relay.md
 * "Verification").
 *
 * Boots nothing itself: it takes a RUNNING relay's URL and creates a
 * YouTube.js session (the Node entry of youtubei.js) with every YouTube fetch
 * routed through the relay as `yt.fetch` calls — the session bootstrap
 * (sw.js_data), the player script and the InnerTube calls, mirroring what
 * web/app/src/playback/youtube/innertube.ts does for the page. It then
 * resolves a handful of the Debug page's test videoIds through the same
 * client walk the app uses (VISIONOS first, web/docs/relay.md "Playback in
 * relay mode"), prints the client, itag and resolve time for each, and
 * performs a Range request on the winning direct URL with no Origin and no
 * Referer — exactly what a media element sends — reporting the bytes
 * received. That last hop is the one thing relay mode assumes and cannot
 * enforce (the player request egresses from the relay's IP, the bytes are
 * fetched by the user's); the probe measures it.
 *
 * Usage: node scripts/probe.mjs <relay-base-url>
 *   e.g. node scripts/probe.mjs http://localhost:8787
 * Exits non-zero on any failure, naming the step that failed.
 */
import { Innertube, Platform, Utils, YT } from 'youtubei.js';

// The same deciphering evaluator the app installs (innertube.ts's create):
// YouTube.js runs the player script's signature and n-parameter functions
// through it. Without this, a track that resolves perfectly fails at the
// decipher step with "provide your own JavaScript evaluator" — which measures
// the harness, not the relay.
Platform.shim.eval = async (data, env) => {
  const properties = [];
  if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  return new Function(`${data.output}\nreturn { ${properties.join(', ')} }`)();
};

/**
 * The acceptance set. The first four are the Debug page's spread of eras and
 * regions; the next four the owner hand-verified on YouTube (2026-11-21)
 * before trusting them here. Every id has resolved through a
 * fallback-loaded relay with a 206 range-fetch to show for it — except the
 * one deliberately left out: Eminem · Lose Yourself (4wOLVrGHiIU, explicit)
 * measured "Video unavailable" from every client under the fallback, the
 * explicit/age-gated family — the throwaway isn't age-verified, and a relay
 * wanting those tracks needs a burner that is.
 */
const TRACKS = [
  { id: 'ZEcqHA7dbwM', label: 'Frank Sinatra · Fly Me To The Moon (1964)' },
  { id: 'BSTsnWoslP4', label: 'Queen · Bohemian Rhapsody (1975)' },
  { id: 'J7p4bzqLvCw', label: 'The Weeknd · Blinding Lights (2019)' },
  { id: 'NJAv_7lHUIU', label: 'Arijit Singh · Kesariya (Hindi)' },
  { id: 'nfs8NYg7yQM', label: 'Attention (owner-verified)' },
  { id: 'Xi8Fabcb_MA', label: 'Chaand Baliyan (owner-verified)' },
  { id: 'kTJczUoc26U', label: 'STAY (owner-verified)' },
  { id: 'a7fzkqLozwA', label: 'I Like Me Better (owner-verified)' },
];

/** resolver.ts's CLIENT_ORDER: VISIONOS first — it answers with direct URLs and needs no PO token. */
const CLIENT_ORDER = ['VISIONOS', 'YTMUSIC', 'WEB', 'MWEB'];

/**
 * What a media element sends: the browser's User-Agent, and deliberately no
 * Origin and no Referer (a plain <audio> request carries neither, which is
 * why relay mode's googlevideo hop works at all).
 */
const MEDIA_ELEMENT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

/** Enough bytes to prove real media flows, without paying for whole tracks. */
const RANGE = 'bytes=0-131071';

/** How many bridge calls the probe made, per named stretch — the cache should bend this down fast. */
let bridgeCalls = 0;
let bridgeCallsAt = 0;
const callsSince = () => bridgeCalls - bridgeCallsAt;

const arg = process.argv.slice(2)[0];
if (!arg) {
  console.error('usage: node scripts/probe.mjs <relay-base-url>   (e.g. http://localhost:8787)');
  process.exit(2);
}
const endpoint = `${arg.replace(/\/+$/, '').replace(/\/bridge$/, '')}/bridge`;

// ---- The bridge client, one function ------------------------------------------

let nextId = 0;

/** One bridge call, in the page's envelope (web/shared/src/bridge/server.ts). */
async function bridgeCall(method, params) {
  bridgeCalls++;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'bitchord-bridge',
      protocol: 1,
      direction: 'to-extension',
      id: `probe-${nextId++}`,
      method,
      params,
    }),
  });
  if (response.status === 429) throw new Error('the relay rate-limited the probe (429)');
  if (!response.ok) throw new Error(`the relay answered HTTP ${response.status}`);
  const answer = await response.json();
  if (!answer || answer.channel !== 'bitchord-bridge' || answer.id !== `probe-${nextId - 1}`) {
    throw new Error('malformed bridge answer');
  }
  if (!answer.ok) throw new Error(`${method} failed: ${answer.error?.code}: ${answer.error?.message}`);
  return answer.result;
}

/** A relay HttpResponse back into a fetch Response, as innertube.ts does for the page. */
function toResponse(http) {
  const body =
    http.bodyEncoding === 'base64' ? Uint8Array.from(atob(http.body), (c) => c.charCodeAt(0)) : http.body;
  return new Response(http.status === 204 || http.status === 304 ? null : body, {
    status: http.status,
    headers: http.headers,
  });
}

// ---- The fetch shim: every YouTube request through the relay ------------------

/** The hosts whose requests the page sends through the bridge (innertube.ts's YOUTUBE_HOSTS). */
const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'www.youtube.com', 'youtube.com']);

/**
 * YouTube.js's fetch: anything on a YouTube host becomes a `yt.fetch` call;
 * anything else (nothing in this flow, but BotGuard endpoints move around)
 * goes out directly so the session can't be silently broken by a new host.
 */
async function relayFetch(input, init) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  if (!YOUTUBE_HOSTS.has(url.hostname)) {
    console.warn(`  (direct fetch, not a YouTube host: ${url.hostname})`);
    return fetch(input, init);
  }

  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const headers = {};
  new Headers(init?.headers ?? request?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  let body = init?.body ?? undefined;
  if (body === undefined && request && method !== 'GET' && method !== 'HEAD') body = await request.text();
  if (body != null && typeof body !== 'string') body = await new Response(body).text();

  const http = await bridgeCall('yt.fetch', {
    url: url.toString(),
    method,
    ...(Object.keys(headers).length > 0 && { headers }),
    ...(typeof body === 'string' && { body }),
  });
  return toResponse(http);
}

// ---- The client walk (resolver.ts, VISIONOS first) ----------------------------

/** Asks [client] for [videoId]'s player response, in the app's shape (resolver.ts's playerRequest, minus the BotGuard tokens the probe cannot mint). */
async function playerRequest(yt, videoId, client) {
  return yt.actions.execute('/player', {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    client,
    playbackContext: {
      contentPlaybackContext: { signatureTimestamp: yt.session.player?.signature_timestamp },
    },
  });
}

/**
 * YouTube's datacenter-IP refusal: "Sign in to confirm you're not a bot"
 * (LOGIN_REQUIRED, occasionally UNPLAYABLE; YouTube sends a curly apostrophe).
 * Matched against the lowercased reason, as resolver.ts's AGE_GATE does. This
 * is the one refusal that indicts the relay's egress rather than the relay or
 * the track, so the walk's failure has to name it — otherwise a probe failure
 * from a bot-checked IP reads as a client-walk or relay defect, and someone
 * re-runs the control experiment by hand to find out otherwise (measured
 * 2026-11-21: all fifteen InnerTube clients, both youtubei hosts, fresh and
 * absent visitor identities alike are refused from this network's IP).
 */
const BOT_CHECK = /sign in to confirm|not a bot/;

/**
 * Walks the clients until one answers OK with direct audio URLs, as
 * resolvePlayer does. No BotGuard: VISIONOS takes no PO token and is first,
 * and the walk says plainly when a client refuses.
 */
async function resolveTrack(yt, videoId) {
  let botChecked = false;
  for (const client of CLIENT_ORDER) {
    const started = performance.now();
    try {
      const response = await playerRequest(yt, videoId, client);
      const info = new YT.VideoInfo([response], yt.actions, Utils.generateRandomString(16));
      const status = info.playability_status?.status;
      const ms = Math.round(performance.now() - started);
      // relay mode plays direct URLs only (engine.ts's hasDirectAudio): a
      // client that offers just a SABR URL can't play without the extension.
      const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
        (f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher),
      );
      if (status === 'OK' && formats.length > 0) {
        return { client, info, formats, ms };
      }
      const reason = info.playability_status?.reason ?? '';
      botChecked ||= BOT_CHECK.test(reason.toLowerCase());
      console.log(`    ${client}: ${status ?? 'no status'} — ${reason || 'no direct audio URLs'} (${ms}ms)`);
    } catch (error) {
      console.log(`    ${client}: request failed — ${String(error?.message ?? error)}`);
    }
  }
  if (botChecked) {
    // The chain itself worked: these answers came through the relay's
    // impersonation intact, and the same requests are refused identically
    // without it — and, measured the same day, from Cloudflare Workers egress
    // too (relay.md's measurement table). Anonymous `player` is what
    // datacenter-IP reputation is enforced against; relay.md's rescue paths
    // for playback are a signed-in request (phase 2) or a PO token minted in
    // a real browser.
    throw new Error(
      'every client answered "Sign in to confirm you\'re not a bot": YouTube refuses anonymous playback from this ' +
        "egress IP, which is a deployment property (relay.md, “Where it runs is a real decision”), not a relay defect. " +
        'Re-probe from the deployment\'s own egress before trusting playback.',
    );
  }
  throw new Error('no client answered OK with direct audio URLs (relay mode needs VISIONOS-style URLs)');
}

/**
 * Picks the audio format as the engine does (engine.ts's selectAudio): the
 * preferred codec's highest bitrate, DRC renditions avoided — Opus (itag 251)
 * when the caller can decode it, else AAC (140).
 */
function selectAudio(formats) {
  const audio = formats.filter((f) => !f.is_drc);
  const pick = (prefix) =>
    audio
      .filter((f) => (f.mime_type ?? '').startsWith(prefix))
      .sort((a, b) => b.bitrate - a.bitrate)[0];
  return pick('audio/webm') ?? pick('audio/mp4') ?? formats[0];
}

/** The winning direct URL, deciphered by the player script the relay fetched. */
async function directUrl(yt, format) {
  return format.decipher(yt.session.player);
}

/** The media-element hop: a Range request with no Origin and no Referer. */
async function rangeFetch(url) {
  const response = await fetch(url, {
    headers: { ...MEDIA_ELEMENT_HEADERS, range: RANGE },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`googlevideo answered HTTP ${response.status} for a headerless range request`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('googlevideo answered 0 bytes');
  return { status: response.status, bytes: bytes.byteLength, contentRange: response.headers.get('content-range') };
}

// ---- The run ------------------------------------------------------------------

/** Wraps a step so a failure names itself on the way out. */
async function step(name, fn) {
  try {
    return await fn();
  } catch (error) {
    error.step = name;
    throw error;
  }
}

async function main() {
  console.log(`probing relay at ${endpoint}`);

  const yt = await step('create the YouTube.js session through the relay', async () => {
    // No cache: a cached session or player would bypass the relay, and the
    // probe exists to measure the whole chain.
    const session = await Innertube.create({ fetch: relayFetch, retrieve_player: true });
    if (!session.session.player) {
      // A session that fell back to local data (sw.js_data refused) cannot
      // decipher anything; fail loudly rather than measure a ghost.
      throw new Error('no player script came through the relay; the session fell back to local data');
    }
    return session;
  });
  const client = yt.session.context.client;
  console.log(
    `session: ${client.clientName} ${client.clientVersion}, player ${yt.session.player.player_id}` +
      ` (${bridgeCalls} yt.fetch calls)`,
  );

  let failures = 0;
  for (const track of TRACKS) {
    bridgeCallsAt = bridgeCalls;
    const resolved = await step(`resolve ${track.label} (${track.id})`, () => resolveTrack(yt, track.id));
    const format = selectAudio(resolved.formats);
    const url = await step(`decipher ${track.id}`, () => directUrl(yt, format));
    console.log(
      `  ${track.label}: ${resolved.client} answered in ${resolved.ms}ms — itag ${format.itag} ` +
        `${(format.mime_type ?? '').split(';')[0]} ${Math.round(format.bitrate / 1000)}kbps, ` +
        `${callsSince()} yt.fetch calls`,
    );

    const range = await step(`range-fetch ${track.id} from googlevideo with no Origin/Referer`, () => rangeFetch(url));
    const honored = range.status === 206 ? 'range honored' : 'range ignored (full body)';
    console.log(
      `    media hop: HTTP ${range.status} (${honored}), ${range.bytes} bytes received` +
        (range.contentRange ? `, content-range ${range.contentRange}` : ''),
    );
    if (range.status !== 206) failures++;
  }

  console.log(
    `\nprobe passed: ${TRACKS.length} tracks resolved through the relay, ${bridgeCalls} yt.fetch calls in total` +
      (failures > 0 ? `; ${failures} track(s) where googlevideo ignored the Range` : ''),
  );
}

main().catch((error) => {
  console.error(`\nprobe FAILED at: ${error.step ?? 'an unnamed step'}`);
  console.error(`  ${String(error?.message ?? error)}`);
  process.exit(1);
});
