// TEMPORARY control (deleted after the run): asks YouTube /player for one
// video as every InnerTube client youtubei.js 18.1.0 supports, DIRECT (no
// relay), to find which clients this network's IP serves anonymous playback.
import { Innertube, Utils, YT } from 'youtubei.js';

const VIDEO_ID = process.argv[2] ?? 'ZEcqHA7dbwM';
const CLIENTS = [
  'VISIONOS', 'YTMUSIC', 'WEB', 'MWEB',
  'ANDROID_VR', 'ANDROID', 'IOS', 'YTMUSIC_ANDROID',
  'TV_EMBEDDED', 'TV', 'TV_SIMPLY', 'WEB_EMBEDDED', 'WEB_CREATOR',
  'YTKIDS', 'YTSTUDIO_ANDROID',
];

const yt = await Innertube.create({ retrieve_player: true });
console.log(
  `session: ${yt.session.context.client.clientName} ${yt.session.context.client.clientVersion}, ` +
  `player ${yt.session.player?.player_id}, st ${yt.session.player?.signature_timestamp}`,
);

for (const client of CLIENTS) {
  const started = performance.now();
  try {
    const response = await yt.actions.execute('/player', {
      videoId: VIDEO_ID,
      contentCheckOk: true,
      racyCheckOk: true,
      client,
      playbackContext: {
        contentPlaybackContext: { signatureTimestamp: yt.session.player?.signature_timestamp },
      },
    });
    const info = new YT.VideoInfo([response], yt.actions, Utils.generateRandomString(16));
    const status = info.playability_status?.status ?? 'no status';
    const reason = info.playability_status?.reason ?? 'no reason';
    const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
      (f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher),
    );
    const direct = formats.filter((f) => f.url).length;
    const itags = formats.map((f) => `${f.itag}${f.url ? '' : '*'}`).join(',');
    const ms = Math.round(performance.now() - started);
    console.log(
      `${client.padEnd(16)} ${status.padEnd(14)} ${String(reason).slice(0, 52).padEnd(52)} ` +
      `audio=${formats.length} direct=${direct} itags=${itags} (${ms}ms)`,
    );
  } catch (error) {
    console.log(`${client.padEnd(16)} THREW ${String(error?.message ?? error).slice(0, 120)}`);
  }
}
