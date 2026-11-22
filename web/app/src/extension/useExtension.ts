import { detectExtension, type DetectedExtension } from '@bitchord/shared/bridge';
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config';
import { queryClient } from '@/lib/queryClient';
import { getUserJar } from './userJar';

export type ExtensionStatus =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'present'; extension: DetectedExtension };

export const extensionQueryKey = ['extension', 'detect'] as const;

/** Re-pings after a miss: a cold relay or a slow first network round-trip can miss the first one. */
const RECHECKS = 4;
const RECHECK_MS = 1500;
/** After those, a still-missing relay is polled slowly, so one that comes up later (or is configured meanwhile) is picked up without a reload. */
const SLOW_RECHECK_MS = 5000;

/**
 * One ping. When the relay was already known, a miss gets a second, more
 * patient ping, and if that misses too the known relay is kept: a transient
 * network failure must not flip the site to "nothing can play" and strand
 * everything that reads the bridge (history reporting, lyrics) until a
 * reload. The bridge is a function over fetch, so it recovers on its own
 * when the network is back; a relay that is actually gone fails each call
 * instead.
 */
export async function detect(): Promise<DetectedExtension | null> {
  const known = queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey) ?? null;
  // The jar accessor is handed to the bridge once, at detection, and read per
  // call from then on: connecting and disconnecting change the store, and the
  // next call picks that up without a new transport (server.ts's contract).
  const base = { serverBridgeUrl: config.relayUrl || undefined, userJar: getUserJar };
  const found = await detectExtension(base);
  if (found || !known) return found;
  return (await detectExtension({ ...base, timeoutMs: 4000 })) ?? known;
}

/**
 * Whether the server relay is reachable (relay.md phase 2: it is the only
 * transport). A miss is reported at once, so a visitor whose relay is
 * unreachable sees that straight away, but re-checked a few times: a slow
 * answer flips the page to its content on its own.
 */
export function useExtension(): ExtensionStatus {
  const query = useQuery({
    queryKey: extensionQueryKey,
    queryFn: detect,
    staleTime: 30_000,
    gcTime: Infinity,
    retry: false,
    // Re-pinged when the tab comes back, so a relay restarted or redeployed
    // meanwhile reports its new version.
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      q.state.data === null ? (q.state.dataUpdateCount <= RECHECKS ? RECHECK_MS : SLOW_RECHECK_MS) : false,
  });
  if (query.isPending) return { state: 'checking' };
  if (!query.data) return { state: 'missing' };
  return { state: 'present', extension: query.data };
}
