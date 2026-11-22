import { IosAlert, IosAlertAction, IosAlertBody, IosAlertRule } from '@/components/IosAlert';
import type { Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'Unavailable';
  const whole = Math.round(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function SongInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-(--bc-alert-action-h) items-center justify-between gap-3 px-4 py-2.5">
      <span className="font-(family-name:--bc-font-family) text-[14px] text-(--bc-on-surface-variant)">{label}</span>
      <span className="min-w-0 truncate text-end font-(family-name:--bc-font-family) text-[14px] font-medium text-(--bc-on-surface)">
        {value}
      </span>
    </div>
  );
}

/**
 * Android-ported `SongInfoDialog` (`SongInfoDialog.kt:43-166`, spec §3.9):
 * iOS alert card displaying track metadata, stream format (when playing), and
 * direct YouTube Music link.
 */
export function SongInfoDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const nowPlaying = usePlayer((s) => (s.nowPlaying?.videoId === track.videoId ? s.nowPlaying : null));
  const artistLine = track.artists.map((a) => a.name).join(', ') || nowPlaying?.artist || '';
  const durationSec = track.durationSec || nowPlaying?.durationSec || null;
  const stream = nowPlaying?.stream ?? null;
  const streamText = stream
    ? [
        stream.codec,
        stream.bitrateKbps ? `${stream.bitrateKbps} kbps` : null,
        stream.sampleRateHz ? `${(stream.sampleRateHz / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : null,
        stream.client,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const rows: { label: string; value: string }[] = [
    { label: 'Album', value: track.album?.name ?? 'Unavailable' },
    { label: 'Duration', value: formatDuration(durationSec) },
    { label: 'Video ID', value: track.videoId },
  ];
  if (streamText) rows.push({ label: 'Stream', value: streamText });

  const ytUrl = `https://music.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`;

  return (
    <IosAlert onClose={onClose} label="Song Info" size="dialog">
      <IosAlertBody title="Song Info" message={[track.title, artistLine].filter(Boolean).join(' — ')} />
      <IosAlertRule />
      <div className="max-h-[320px] overflow-y-auto">
        {rows.map((row, index) => (
          <div key={row.label}>
            {index > 0 && <IosAlertRule className="ml-4 w-[calc(100%-16px)]" />}
            <SongInfoRow label={row.label} value={row.value} />
          </div>
        ))}
      </div>
      <IosAlertRule />
      <IosAlertAction
        label="Open in YouTube Music"
        onClick={() => {
          window.open(ytUrl, '_blank', 'noopener,noreferrer');
          onClose();
        }}
      />
      <IosAlertRule />
      <IosAlertAction label="Done" emphasised onClick={onClose} />
    </IosAlert>
  );
}
