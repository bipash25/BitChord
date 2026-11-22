import type { HttpResponse, YtAccount, YtAuthState } from './contract.js';
import { JarCredential, parseCookieJar } from './credential.js';
import { CHROMIUM_USER_AGENT, ytImpersonationFor } from './hosts.js';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS } from './limits.js';
import { serialise } from './serialise.js';

/**
 * The visitor's own YouTube credential (`web/docs/private-deployment.md`,
 * 2026-11-22): their cookie jar, exported in their browser, stored there, and
 * attached to each bridge call as the `x-bitchord-user-jar` header. This
 * credential exists for exactly one request: it is built from the header
 * text, signs that request's InnerTube/stats calls, and is gone — the relay
 * stores nothing, not even in memory beyond the request, which is the whole
 * shape of the bring-your-own-cookie design. It also never absorbs a
 * rotation: the page's copy is the page's to refresh (the same static-export
 * staleness the fallback's keeper exists for, recorded in
 * private-deployment.md, is the visitor's problem to notice — the auth read
 * is what surfaces it, because a jar YouTube refuses answers `problem`, and
 * the page then drops it and falls back).
 *
 * The user jar outranks the fallback wherever both could apply: a call the
 * visitor signed with their session is theirs — their library, their likes,
 * their history. Answers to user-signed calls are never cached (the URL-only
 * cache key can't tell identities apart), and the identity read here is the
 * one place a name is allowed to cross to the page, because it is the
 * visitor's own.
 */

const MUSIC_ORIGIN = 'https://music.youtube.com';

/**
 * Any recent WEB_REMIX version is accepted for the account endpoints
 * (Innertube.kt keeps a fallback the same way; the extension pinned the same
 * idea). `67` is WEB_REMIX's client id, as the music page sends it.
 */
const WEB_REMIX_VERSION = '1.20251006.03.00';

/**
 * A page-held jar as a per-request credential. Built from raw header text;
 * [fromText] returns null unless the jar can sign — one of `SAPISID`,
 * `__Secure-3PAPISID`, `__Secure-1PAPISID` present by name (`canSign`), the
 * working cookie set the Android app measured: a `__Secure-`-only jar is a
 * real login, and a jar with a session id but none of these cannot build the
 * signature at all. Null is "not a credential": signing treats it as no jar
 * (the visitor's calls fall to the fallback rather than breaking), while the
 * auth read answers it as a problem so the page can say so and drop it.
 */
export class UserCredential extends JarCredential {
  static fromText(text: string): UserCredential | null {
    const jar = parseCookieJar(text);
    if (jar.size === 0) return null;
    const credential = new UserCredential(jar);
    return credential.canSign() ? credential : null;
  }
}

// ---- reading the account (the extension's ytAuth renderers, slimmed) -----------

type Json = Record<string, unknown>;

/** Every object stored under [key], anywhere inside [root]. */
function renderers(root: unknown, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(root)) {
    for (const item of root) renderers(item, key, out);
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Json);
      else renderers(v, key, out);
    }
  }
  return out;
}

/** A `runs` or `simpleText` field as plain text. */
function text(node: unknown): string {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  if (n?.runs) return n.runs.map((r) => r.text ?? '').join('');
  return n?.simpleText ?? '';
}

/** The account's photo: the largest thumbnail, which YouTube orders last. */
function photo(item: Json): string | null {
  const thumbnails = (item.accountPhoto as { thumbnails?: { url?: string }[] } | undefined)?.thumbnails;
  return thumbnails?.at(-1)?.url ?? null;
}

/**
 * Not signed in as far as YouTube answered — the shape with [problem] set.
 * `signedIn` is false so the page drops the stored jar and returns to the
 * anonymous session (its features never depended on this one), and the
 * message is YouTube's own sentence wherever there is one.
 */
function problemState(problem: string): YtAuthState {
  return { browserSignedIn: false, connected: false, signedIn: false, accounts: [], active: null, problem };
}

/** Why an account_menu answer holds no account, read from what YouTube said about the session. */
function describeEmpty(menu: unknown): string {
  const services =
    (menu as { responseContext?: { serviceTrackingParams?: { params?: { key?: string; value?: string }[] }[] } })?.responseContext
      ?.serviceTrackingParams ?? [];
  const loggedIn = services
    .flatMap((service) => service.params ?? [])
    .find((param) => param.key === 'logged_in')?.value;
  if (loggedIn === '0') return 'YouTube answered as if signed out — the session was not accepted.';
  return 'YouTube answered with no account in it.';
}

/**
 * Reads the visitor's identity from `account/account_menu`, signed as them —
 * the endpoint that names the login a jar belongs to, read the same way the
 * extension's ytAuth did (WEB_REMIX dressed and signed). Their name, handle,
 * email and avatar are the one identity allowed to cross to the page,
 * because it is theirs. A refusal answers the signed-out-with-problem shape
 * so the connect flow can show exactly what YouTube said; network faults
 * throw instead (they say nothing about the jar, and the page must not
 * conclude it is dead because the relay's own fetch failed).
 */
export async function readUserIdentity(
  fetchImpl: typeof globalThis.fetch,
  credential: UserCredential,
): Promise<YtAuthState> {
  const url = new URL(`${MUSIC_ORIGIN}/youtubei/v1/account/account_menu?prettyPrint=false`);
  const impersonation = ytImpersonationFor(url);
  if (!impersonation) return problemState('the account read is not a call this relay can make');

  const answer: HttpResponse = await serialise(
    await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': '67',
        'x-youtube-client-version': WEB_REMIX_VERSION,
        ...impersonation,
        ...credential.sign(MUSIC_ORIGIN, Math.floor(Date.now() / 1000)),
        'user-agent': CHROMIUM_USER_AGENT,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl: 'en', gl: 'US' }, user: {} },
      }),
      // The jar is attached explicitly in these headers; the ambient cookie
      // store is empty and stays that way, same as every other upstream call.
      credentials: 'omit',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }),
    MAX_RESPONSE_BYTES,
  );

  if (answer.status !== 200) {
    // What YouTube said, in the fewest words: the status, plus YouTube's
    // own error message when the body carries one. Neither can quote the jar.
    let said = `YouTube refused the session: HTTP ${answer.status}`;
    try {
      const api = (JSON.parse(answer.body) as { error?: { message?: unknown } }).error;
      if (api && typeof api.message === 'string') said += ` — ${api.message}`;
    } catch {
      // Not JSON — a refusal page; the status is the whole sentence.
    }
    return problemState(said);
  }

  let menu: unknown;
  try {
    menu = JSON.parse(answer.body);
  } catch {
    return problemState('YouTube answered something other than an account (a bot-check page, most likely).');
  }
  const header = renderers(menu, 'activeAccountHeaderRenderer')[0];
  if (!header) return problemState(describeEmpty(menu));

  const name = text(header.accountName) || 'You';
  const email = text(header.email) || null;
  const handle = text(header.channelHandle) || null;
  const avatarUrl = photo(header);
  // One login, one channel: the jar is a single session, so there is nothing
  // to switch between. The id keeps the extension's `authUser:pageId` shape
  // so the page's machinery sees a channel like any other it has handled.
  const channel = { id: '0:own', name, handle, avatarUrl, brand: false };
  const account: YtAccount = { authUser: '0', name, email, avatarUrl, channels: [channel] };
  return {
    browserSignedIn: false,
    connected: true,
    signedIn: true,
    accounts: [account],
    active: { ...channel, authUser: '0' },
    problem: null,
  };
}
