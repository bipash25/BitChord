import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useTrackLog } from '@/playback/trackLog';
import { usePlayer } from '@/state/player';

export const TEST_TRACKS: { id: string; label: string }[] = [
  { id: 'ZEcqHA7dbwM', label: 'Frank Sinatra · Fly Me To The Moon (1964)' },
  { id: 'xUNqsfFUwhY', label: 'The Beatles · Here Comes The Sun (1969)' },
  { id: 'h4R4aSIAG0A', label: 'Chris Isaak · Can’t Help Falling In Love' },
  { id: 'BSTsnWoslP4', label: 'Queen · Bohemian Rhapsody (1975)' },
  { id: '7CTJcHjkq0E', label: 'Michael Jackson · Billie Jean (1982)' },
  { id: 'ZVgHPSyEIqk', label: 'Radiohead · Let Down (1997)' },
  { id: 'J7p4bzqLvCw', label: 'The Weeknd · Blinding Lights (2019)' },
  { id: '3YgtjHZyCIQ', label: 'Taylor Swift · Anti-Hero (2022)' },
  { id: 'kIft-LUHHVA', label: 'Sabrina Carpenter · Espresso (2024, explicit)' },
  { id: 'NJAv_7lHUIU', label: 'Arijit Singh · Kesariya (Hindi)' },
  { id: 'FM2ykrYbzqg', label: 'AP Dhillon · Brown Munde (Punjabi)' },
  { id: 'HaEYUJ2aRHs', label: 'BTS · Dynamite (K-pop)' },
  { id: 'juRFjpB5Ppg', label: 'Bad Bunny · Tití Me Preguntó (Spanish, explicit)' },
  { id: 'RHR0tKRxiyY', label: 'Fela Kuti · Water No Get Enemy (Afrobeat)' },
  { id: 'gI7hyn18Xn8', label: 'Lata Mangeshkar · Lag Ja Gale (1964, Hindi)' },
  { id: '4wOLVrGHiIU', label: 'Eminem · Lose Yourself (explicit)' },
  { id: 'H4RELGc9su8', label: 'Kendrick Lamar · HUMBLE. (explicit)' },
  { id: 'Y3SKjM_2M5k', label: 'Cardi B · WAP' },
  { id: 'Tq92D6wQ1mg', label: 'Age-restricted: [MMD] Adios · EVERGLOW' },
  { id: 'HtVdAasjOgU', label: 'Age-restricted: The Witcher 3 trailer' },
];

export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const id = url.searchParams.get('v') ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : null);
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const sectionHeader = 'mt-7 mb-2 bc-type-label-sm uppercase text-(--bc-on-surface-variant)';

export default function DebugPage() {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<'all' | 'current'>('current');
  const lines = useTrackLog((s) => s.lines);
  const clear = useTrackLog((s) => s.clear);
  const playVideo = usePlayer((s) => s.playVideo);
  const nowPlaying = usePlayer((s) => s.nowPlaying);

  const shown = useMemo(
    () =>
      filter === 'current' && nowPlaying
        ? lines.filter((l) => l.about === nowPlaying.videoId || l.about === null)
        : lines,
    [lines, filter, nowPlaying],
  );
  const id = parseVideoId(input);

  return (
    <>
      <PageHeader title="Debug" />
      <div className="mx-(--bc-page-gutter) mt-5 max-w-[980px]">
        <form
          className="flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (id) void playVideo(id);
          }}
        >
          <input
            className="h-10 flex-1 rounded-(--bc-radius-field) border-0 bg-(--bc-surface-variant) px-3.5 font-(family-name:--bc-font-family) text-[15px] text-(--bc-on-surface) placeholder:text-(--bc-on-surface-variant)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Video id or YouTube link"
            aria-label="Video id or YouTube link"
          />
          <button
            className="h-10 rounded-full bg-(--bc-primary) px-5 bc-type-title-md text-(--bc-on-primary) disabled:opacity-40"
            type="submit"
            disabled={!id}
          >
            Play
          </button>
        </form>
        {nowPlaying?.streamInfo && (
          <p className="mt-2 bc-type-body text-(--bc-on-surface-variant)">{nowPlaying.streamInfo}</p>
        )}

        <h2 className={sectionHeader}>Test tracks</h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-5 gap-y-0.5">
          {TEST_TRACKS.map((t) => (
            <li key={t.id}>
              <button
                className="flex w-full justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left bc-type-body text-(--bc-on-surface) hover:bg-(--bc-hover-fill) data-[current=true]:bg-(--bc-tab-pill-bg) data-[current=true]:font-semibold"
                data-current={nowPlaying?.videoId === t.id}
                onClick={() => void playVideo(t.id)}
              >
                <span>{t.label}</span>
                <code className="bc-type-label text-(--bc-on-surface-variant)">{t.id}</code>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between">
          <h2 className={sectionHeader}>Track log</h2>
          <div className="flex gap-4 bc-type-label text-(--bc-primary)">
            <button onClick={() => setFilter(filter === 'all' ? 'current' : 'all')}>
              {filter === 'all' ? 'Show current track' : 'Show everything'}
            </button>
            <button onClick={clear}>Clear</button>
          </div>
        </div>
        <ol
          className="max-h-[420px] overflow-auto rounded-(--bc-radius-group) bg-(--bc-surface-variant) px-3 py-2.5 [font:400_12px/18px_ui-monospace,Menlo,Consolas,monospace]"
          data-testid="track-log"
        >
          {shown.map((line) => (
            <li
              key={line.id}
              className="flex gap-2.5 text-(--bc-on-surface) data-[level=debug]:text-(--bc-on-surface-variant) data-[level=error]:text-(--bc-accent-red) data-[level=warn]:text-[#d29a00]"
              data-level={line.level}
            >
              <span className="min-w-14 shrink-0 text-right text-(--bc-on-surface-variant)">
                {(line.t / 1000).toFixed(2)}
              </span>
              {line.about && <span className="shrink-0 text-(--bc-on-surface-variant)">{line.about}</span>}
              <span>{line.message}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
