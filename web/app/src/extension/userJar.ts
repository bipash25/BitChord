import { serverBridge } from '@bitchord/shared/bridge';
import type { YtAuthState } from '@bitchord/shared/bridge';
import { config } from '@/config';

/**
 * The visitor's own YouTube credential (web/docs/private-deployment.md,
 * 2026-11-22): their cookie jar as exported text — a Netscape cookies.txt or
 * a raw `Cookie:` header line — kept in THIS browser and forwarded, per call,
 * on the two bridge methods that can sign with it. Signing in with your own
 * account is the recommended path: the library, likes, history and
 * personalization are yours, and so is the name and avatar the UI shows.
 * Visitors who haven't connected keep every feature through the invisible
 * anonymous session the deployment provides; this store is what upgrades a
 * visitor from that to their own account.
 *
 * Hygiene mirrors the relay's: the raw text is stored and transmitted, never
 * rendered — no screen, log or error shows any part of it.
 */

const KEY = 'bitchord:yt-user-jar';

/**
 * The most the jar text may be. The relay's HTTP parser caps the whole
 * request header block (16 KB in Node), and the jar rides a header, so an
 * honest bound belongs here rather than a 431 the page can't decode. A
 * youtube.com-only export is a few kilobytes; a cross-domain dump is the
 * shape that trips this.
 */
export const JAR_MAX_CHARS = 12_000;

/** The stored jar text, or null when this browser holds none. */
export function getUserJar(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // A locked-down or private browsing context: no store, no jar — features
    // continue anonymously rather than failing.
    return null;
  }
}

/**
 * Stores the jar. Returns whether the browser accepted it: a store that
 * silently dropped the jar would look connected while signing nothing.
 */
export function setUserJar(text: string): boolean {
  try {
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Disconnect: the jar is dropped, and the anonymous session takes over again. */
export function clearUserJar(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to drop.
  }
}

/**
 * Verifies [text] as a sign-in before anything is stored: one bridge call
 * that carries the jar and asks YouTube who it belongs to. The answer is the
 * auth state the app would adopt on success — the visitor's identity — or a
 * signed-out state whose `problem` says what YouTube answered (the connect
 * flow shows that verbatim, because it is YouTube's own sentence). Transport
 * failures throw; those are ours, not YouTube's, and never mean the jar is
 * dead.
 *
 * A one-off bridge, not the detected one: the jar is not in the store yet,
 * and a credential that hasn't verified must not ride any other call.
 */
export async function verifyUserJar(text: string): Promise<YtAuthState> {
  if (!config.relayUrl) throw new Error('No relay is configured for this build');
  const bridge = serverBridge(config.relayUrl, { userJar: () => text });
  return bridge.call('yt.authState', { refresh: true }, { timeoutMs: 20_000 });
}
