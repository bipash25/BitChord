// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Innertube } from 'youtubei.js/web';

// What isRelayMode reads; switched per test by mutating [transport].
let transport: 'server' | null = null;
vi.mock('@/extension/bridge', () => ({ getBridge: () => (transport ? { transport } : null) }));

// A mint that always succeeds: a token missing from a request is then there
// because the code chose not to send it, not because BotGuard failed.
vi.mock('./botguard', () => ({ botguard: { mint: async () => 'MINTED' } }));

// VideoInfo is all resolvePlayer reads off an answer, so the mock just passes
// the response's playability status and streaming data through.
interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: { server_abr_streaming_url?: string; adaptive_formats?: { has_audio: boolean; has_video: boolean }[] };
}
vi.mock('youtubei.js/web', () => ({
  Utils: { generateRandomString: (n: number) => 'a'.repeat(n) },
  YT: {
    VideoInfo: class {
      playability_status: PlayerResponse['playabilityStatus'];
      streaming_data: PlayerResponse['streamingData'];
      constructor([response]: [PlayerResponse]) {
        this.playability_status = response.playabilityStatus;
        this.streaming_data = response.streamingData;
      }
    },
  },
}));

const { CLIENT_ORDER, clientsFor, onSessionChanged, playerRequest, resolvePlayer, unplayableReason, UnplayableError } =
  await import('./resolver');

/** A session whose /player answers per client, recording every payload it is sent. */
function fakeYt(answer: (client: string) => PlayerResponse) {
  const payloads: { client: string; body: Record<string, unknown> }[] = [];
  const yt = {
    session: { context: { client: { visitorData: 'CAUQAA' } }, player: { signature_timestamp: 20_000 } },
    actions: {
      execute: async (_path: string, body: Record<string, unknown>) => {
        payloads.push({ client: String(body.client), body });
        return answer(String(body.client));
      },
    },
  } as unknown as Innertube;
  return { yt, payloads };
}

/** A web client's good answer: status OK with direct audio URLs. */
const ok = (): PlayerResponse => ({
  playabilityStatus: { status: 'OK' },
  streamingData: { adaptive_formats: [{ has_audio: true, has_video: false }] },
});

/** A refusal, in YouTube's own reason text (the curly apostrophe is theirs). */
const refused = (reason: string): PlayerResponse => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason } });

describe('resolver relay awareness', () => {
  beforeEach(() => onSessionChanged());

  it('sends no PO token through the relay, and the minted token without one', async () => {
    transport = 'server';
    const relay = fakeYt(() => ok());
    await playerRequest(relay.yt, 'videoid123', 'YTMUSIC');
    expect(relay.payloads[0]!.body.serviceIntegrityDimensions).toBeUndefined();

    transport = null;
    const direct = fakeYt(() => ok());
    await playerRequest(direct.yt, 'videoid123', 'YTMUSIC');
    expect(direct.payloads[0]!.body.serviceIntegrityDimensions).toEqual({ poToken: 'MINTED' });
  });

  it('resolves past a bot-check in relay mode without a verdict or an exclusion', async () => {
    transport = 'server';
    // The trial's exact walk: VISIONOS (unsigned, anonymous) bot-checks, the
    // fallback-signed YTMUSIC answers with direct URLs — the probe's shape.
    const { yt, payloads } = fakeYt((client) => (client === 'VISIONOS' ? refused('Sign in to confirm you’re not a bot') : ok()));
    const resolved = await resolvePlayer(yt, 'videoid123');
    expect(resolved.client).toBe('YTMUSIC');
    expect(payloads.find((p) => p.client === 'YTMUSIC')!.body.serviceIntegrityDimensions).toBeUndefined();
    // The bot-check is the relay's credential state, not this track's verdict.
    expect(unplayableReason('videoid123')).toBeNull();
    expect(clientsFor('videoid123')).toEqual([...CLIENT_ORDER]);
  });

  it('still calls an age gate a track verdict in relay mode, and remembers it', async () => {
    transport = 'server';
    const { yt } = fakeYt(() => refused('Sign in to confirm your age'));
    const failure = await resolvePlayer(yt, 'videoid123').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(UnplayableError);
    expect((failure as InstanceType<typeof UnplayableError>).ageGated).toBe(true);
    expect((failure as InstanceType<typeof UnplayableError>).message).toBe(
      'This track is age-restricted. Sign in to YouTube Music in this browser to play it.',
    );
    expect(unplayableReason('videoid123')).toBe('This track is age-restricted. Sign in to YouTube Music in this browser to play it.');
    // The asked half of the walk sits out; the fourth client is still there.
    expect(clientsFor('videoid123')).toEqual(['MWEB']);
  });

  it('keeps the extension-mode exclusion for a bot-check: there the client is the credential', async () => {
    transport = null;
    const { yt } = fakeYt(() => refused('Sign in to confirm you’re not a bot'));
    const failure = await resolvePlayer(yt, 'videoid123').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeInstanceOf(UnplayableError);
    expect(unplayableReason('videoid123')).toBeNull();
    expect(clientsFor('videoid123')).toEqual(['MWEB']);
  });
});
