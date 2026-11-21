// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Innertube, YT } from 'youtubei.js/web';
import type { PlayerClientName, ResolvedPlayer } from './resolver';

// Ensure MediaError global exists in happy-dom
if (typeof globalThis.MediaError === 'undefined') {
  (globalThis as unknown as { MediaError: Record<string, number> }).MediaError = {
    MEDIA_ERR_ABORTED: 1,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
  };
}

let relayUrlValue = 'http://69.197.187.54:8080/relay';
vi.mock('@/config', () => ({
  get config() {
    return {
      partyServerUrl: '',
      relayUrl: relayUrlValue,
      spotifyClientId: '',
    };
  },
}));

vi.mock('shaka-player/dist/shaka-player.compiled', () => ({
  default: {
    util: { Error: class ShakaError extends Error { code = 0; severity = 2; data: unknown[] = []; } },
    polyfill: { installAll: () => {} },
    Player: { isBrowserSupported: () => true },
    net: { NetworkingEngine: { registerScheme: () => {}, PluginPriority: { FALLBACK: 1 } }, HttpFetchPlugin: { parse: () => {} } },
  },
}));

vi.mock('googlevideo/sabr-streaming-adapter', () => ({ SabrStreamingAdapter: class {} }));
vi.mock('googlevideo/utils', () => ({ buildSabrFormat: (x: unknown) => x }));
vi.mock('./ShakaPlayerAdapter', () => ({ ShakaPlayerAdapter: class {} }));
vi.mock('@/extension/useYtAuth', () => ({ ytAuthSnapshot: () => ({ signedIn: false }) }));

const fakeSession = { session: { player: {}, context: { client: {} } } } as unknown as Innertube;
vi.mock('./innertube', () => ({
  getInnertube: async () => fakeSession,
  getSignedInnertube: async () => fakeSession,
}));

const mintedFor: string[] = [];
vi.mock('./botguard', () => ({
  botguard: {
    init: async () => {},
    mint: async (binding: string) => {
      mintedFor.push(binding);
      return `POT_${binding}`;
    },
    coldStartToken: async () => 'COLD',
  },
}));

let scriptedResolves: (() => ResolvedPlayer)[] = [];
vi.mock('./resolver', () => ({
  CLIENT_ATTEMPTS: 3,
  usesWebPo: (client: PlayerClientName) => client !== 'VISIONOS',
  excludeClient: () => {},
  isRelayMode: () => true,
  playerRequest: async () => ({}),
  resolvePlayer: async () => {
    const next = scriptedResolves.shift();
    if (!next) throw new Error('No YouTube client would play this track');
    return next();
  },
  UnplayableError: class UnplayableError extends Error {
    ageGated: boolean;
    constructor(message: string, ageGated = false) {
      super(message);
      this.ageGated = ageGated;
    }
  },
}));

const { mediaProxyUrl, YouTubeEngine } = await import('./engine');

function makeResolved(client: PlayerClientName, directUrl: string | null): ResolvedPlayer {
  const adaptive_formats = directUrl
    ? [
        {
          itag: 251,
          mime_type: 'audio/webm; codecs="opus"',
          bitrate: 140_000,
          audio_sample_rate: 48_000,
          audio_channels: 2,
          has_audio: true,
          has_video: false,
          is_drc: false,
          url: directUrl,
          decipher: async () => directUrl,
        },
      ]
    : [{ has_audio: true, has_video: false }];
  return {
    videoId: 'Xi8Fabcb_MA',
    client,
    signed: false,
    yt: fakeSession,
    info: {
      basic_info: { title: 'Chaand Baliyan', author: 'Aditya A', duration: 103, thumbnail: [] },
      streaming_data: {
        server_abr_streaming_url: directUrl ? undefined : 'https://rr1---sn-x.googlevideo.com/videoplayback?sabr=1',
        adaptive_formats,
      },
    } as unknown as YT.VideoInfo,
  };
}

describe('mediaProxyUrl', () => {
  it('derives /media?u= from VITE_RELAY_URL regardless of trailing slash or /bridge suffix', () => {
    const stream = 'https://rr3---sn-vgqsrn6e.googlevideo.com/videoplayback?itag=251&clen=1821403';
    const encoded = encodeURIComponent(stream);
    expect(mediaProxyUrl(stream, 'http://69.197.187.54:8080/relay')).toBe(
      `http://69.197.187.54:8080/relay/media?u=${encoded}`,
    );
    expect(mediaProxyUrl(stream, '/relay/')).toBe(`/relay/media?u=${encoded}`);
    expect(mediaProxyUrl(stream, 'http://localhost:8787/bridge')).toBe(`http://localhost:8787/media?u=${encoded}`);
    expect(mediaProxyUrl(stream, '')).toBe(stream);
  });
});

describe('YouTubeEngine relay mode', () => {
  beforeEach(() => {
    mintedFor.length = 0;
    scriptedResolves = [];
    relayUrlValue = 'http://69.197.187.54:8080/relay';
  });

  it('attaches streaming pot for WEBPO clients and assigns the /media?u= proxy URL to audio.src', async () => {
    const raw = 'https://rr3---sn-vgqsrn6e.googlevideo.com/videoplayback?itag=251&c=WEB_REMIX&clen=1821403';
    scriptedResolves = [() => makeResolved('YTMUSIC', raw)];

    const audio = document.createElement('audio');
    audio.canPlayType = () => 'probably';
    audio.play = async () => {
      setTimeout(() => audio.dispatchEvent(new Event('canplay')), 0);
    };

    const engine = new YouTubeEngine(audio);
    const track = await engine.load('Xi8Fabcb_MA');

    expect(mintedFor).toEqual(['Xi8Fabcb_MA']);
    expect(track.client).toBe('YTMUSIC');
    expect(track.stream.mode).toBe('progressive');

    const assigned = new URL(audio.src);
    expect(`${assigned.origin}${assigned.pathname}`).toBe('http://69.197.187.54:8080/relay/media');
    const inner = new URL(assigned.searchParams.get('u')!);
    expect(inner.searchParams.get('pot')).toBe('POT_Xi8Fabcb_MA');
  });

  it('preserves the real media error instead of masking it behind SABR-only when a direct URL failed first', async () => {
    const raw = 'https://rr3---sn-vgqsrn6e.googlevideo.com/videoplayback?itag=251&c=WEB_REMIX&clen=1821403';
    scriptedResolves = [
      () => makeResolved('YTMUSIC', raw),
      () => makeResolved('WEB', null),
      () => makeResolved('MWEB', null),
    ];

    const audio = document.createElement('audio');
    audio.canPlayType = () => 'probably';
    audio.play = async () => {
      setTimeout(() => {
        Object.defineProperty(audio, 'error', { value: { code: 4 }, configurable: true });
        audio.dispatchEvent(new Event('error'));
      }, 0);
    };

    const engine = new YouTubeEngine(audio);
    await expect(engine.load('Xi8Fabcb_MA')).rejects.toThrow('media error src not supported');
  });

  it('still reports SABR-only when every client answered with SABR and none had direct audio URLs', async () => {
    scriptedResolves = [
      () => makeResolved('YTMUSIC', null),
      () => makeResolved('WEB', null),
      () => makeResolved('MWEB', null),
    ];

    const audio = document.createElement('audio');
    const engine = new YouTubeEngine(audio);
    await expect(engine.load('Xi8Fabcb_MA')).rejects.toThrow('This track only streams over SABR');
  });
});
