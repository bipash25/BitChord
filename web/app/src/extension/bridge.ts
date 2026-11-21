import type { Bridge, DetectedExtension } from '@bitchord/shared/bridge';
import { queryClient } from '@/lib/queryClient';
import { detect, extensionQueryKey } from './useExtension';

/** The detected extension's bridge, for code outside React; null when it isn't installed. */
export function getBridge(): Bridge | null {
  return queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey)?.bridge ?? null;
}

/**
 * The bridge once detection has given its first answer: a null from
 * getBridge before that is "not looked yet", not "nothing installed". The
 * YouTube session's bootstrap must not race it — on a browser with no
 * extension, `sw.js_data` fetched direct fails, and YouTube.js then falls
 * back to a locally generated session that fails playback later (relay.md
 * §3). The answer itself may still be null; that is a real "nothing".
 */
export async function getBridgeWhenSettled(): Promise<Bridge | null> {
  // Only a first run is worth waiting for: background refetches (window
  // focus) keep status 'success' and don't block anyone.
  if (queryClient.getQueryState(extensionQueryKey)?.status !== 'pending') return getBridge();
  await queryClient.ensureQueryData({ queryKey: extensionQueryKey, queryFn: detect }).catch(() => {});
  return getBridge();
}
