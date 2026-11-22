// Registers <am-lyrics>.
import '@uimaxbai/am-lyrics/am-lyrics.js';
import { Check, ChevronDown, Loader2, Minus, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { getBridge } from '@/extension/bridge';
import { LyricClock } from '@/lyrics/clock';
import { onUngrantedChange, ungrantedOrigins } from '@/lyrics/http';
import type { SourceState } from '@/lyrics/repository';
import { enabledSources } from '@/lyrics/settings';
import { sourceById, type LyricsSourceId } from '@/lyrics/sources';
import { useLyrics, useLyricsUi } from '@/lyrics/useLyrics';
import { getAudio, getPlayhead, usePlayer } from '@/state/player';
import { LyricsSettings } from './LyricsSettings';

type AmLyricsElement = HTMLElement & {
  currentTime: number;
  ttml?: string;
  interpolate: boolean;
  autoScroll: boolean;
  highlightColor: string;
  fontFamily?: string;
  updateComplete?: Promise<unknown>;
};

/**
 * am-lyrics' own footer offers to fetch from its own providers; ours decide.
 * Kept in layout (`visibility: hidden`) so scroll range calculation still works.
 */
const HIDE_FOOTER = '.lyrics-footer { visibility: hidden !important; pointer-events: none !important; }';

/** The phone's lyric typeface (@font-face in styles/android-tokens.css), then fallbacks. */
const LYRIC_FONT = "'BitChord SF Pro Display', system-ui, sans-serif";

let lyricFont: Promise<void> | null = null;
let lyricFontLoaded = false;

function loadLyricFont(): Promise<void> {
  lyricFont ??= Promise.race([
    Promise.all([
      document.fonts.load(`800 34px ${LYRIC_FONT}`),
      document.fonts.load(`600 23px ${LYRIC_FONT}`),
      document.fonts.load(`400 28px ${LYRIC_FONT}`),
    ]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ])
    .catch(() => undefined)
    .then(() => {
      lyricFontLoaded = true;
    });
  return lyricFont;
}

function useLyricFont(): boolean {
  const [ready, setReady] = useState(lyricFontLoaded);
  useEffect(() => {
    if (!ready) void loadLyricFont().then(() => setReady(true));
  }, [ready]);
  return ready;
}

/**
 * Android `PlayerLyrics.kt` presentation overrides (spec §4.7):
 * - Synced 34px/41px ExtraBold (asked 800 → Bold in BitChord SF Pro Display), unsynced 30px/38px.
 * - Unswept part at 45% alpha (side panel keeps 55% strip alpha).
 * - Glow bloom: 6px radius white@62% with 10px room on carried words; 30px wipe feather; 2px word rise.
 * - Line falloff: 1 / .8 / .7 / .58 / .46 (phone: 1 / .74 / .6 / .48 / .4 / .34), blur 0 / 1 / 1 / 1.7 / 2.4px.
 * - Scroll & line settle: 400ms cubic-bezier(.41, 0, .12, .99), pressed .96, inactive .98, browsing .8.
 * - Backing vocals: 23px/29px @ 72%, 6px rise, 400ms open / 450ms close, rest scale .94; duet lane 44px.
 * - Translation slide: 540ms; instrumental dots: 13px / 5px gaps / .25 rest alpha / .76 rest scale.
 */
const ANDROID_LYRICS_STYLE = `
  :host([data-full]) {
    --lyplus-text-secondary: color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 55%);
    --lyplus-font-size-base: 34px;
    --am-lyrics-line-height: 1.2059;
    --am-lyrics-line-spacing: 24px;
    --am-lyrics-inline-padding: 0px;
    --lyplus-padding-line: 10px;
    --lyrics-scroll-padding-top: 26%;
    --am-lyrics-inactive-scale: 0.98;
    --am-lyrics-touch-scale: 0.96;
    --am-lyrics-progression-feather: 30px;
    --am-lyrics-glow-radius: 6px;
    --char-rise-y: -2px;
    --am-lyrics-lift: 1;
    --am-lyrics-background-vocal-scale: 0.94;
    --am-lyrics-background-vocal-enter-duration: 400ms;
    --am-lyrics-background-vocal-exit-duration: 450ms;
    --lyplus-gap-dot-size: 13px;
    --lyplus-gap-dot-margin: 2.5px;
    --scroll-duration: 400ms;
    font-weight: 800;
  }

  :host([data-full]) .lyrics-container {
    --lyplus-font-size-base: 34px;
    padding-top: 24px;
  }

  :host([data-full]) .lyrics-container.is-unsynced .lyrics-line {
    font-size: 30px;
    line-height: 38px;
    font-weight: 700;
  }

  :host([data-full]) .lyrics-line {
    transition:
      opacity 400ms cubic-bezier(0.41, 0, 0.12, 0.99),
      transform 400ms cubic-bezier(0.41, 0, 0.12, 0.99) var(--lyrics-line-delay, 0ms),
      filter 400ms cubic-bezier(0.41, 0, 0.12, 0.99);
  }

  :host([data-full]) .lyrics-line.active,
  :host([data-full]) .lyrics-line.pre-active {
    opacity: 1;
    filter: blur(0px) !important;
  }

  :host([data-full]) .lyrics-line.post-active-line:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line.next-active-line:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line.lyrics-activest:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.8;
    filter: blur(1px);
  }

  :host([data-full]) .lyrics-line.prev-2:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line.next-2:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.7;
    filter: blur(1px);
  }

  :host([data-full]) .lyrics-line.prev-3:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line.next-3:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.58;
    filter: blur(1.7px);
  }

  :host([data-full]) .lyrics-line.prev-4:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line.next-4:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full]) .lyrics-line:not(.active):not(.pre-active):not(.lyrics-activest):not(.post-active-line):not(.next-active-line):not(.prev-2):not(.prev-3):not(.prev-4):not(.next-2):not(.next-3):not(.next-4):not(.lyrics-gap) {
    opacity: 0.46;
    filter: blur(2.4px);
  }

  :host([data-full][data-phone]) .lyrics-line.post-active-line:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full][data-phone]) .lyrics-line.next-active-line:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full][data-phone]) .lyrics-line.lyrics-activest:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.74;
    filter: blur(1px);
  }

  :host([data-full][data-phone]) .lyrics-line.prev-2:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full][data-phone]) .lyrics-line.next-2:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.6;
    filter: blur(1px);
  }

  :host([data-full][data-phone]) .lyrics-line.prev-3:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full][data-phone]) .lyrics-line.next-3:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.48;
    filter: blur(1.7px);
  }

  :host([data-full][data-phone]) .lyrics-line.prev-4:not(.active):not(.pre-active):not(.lyrics-gap),
  :host([data-full][data-phone]) .lyrics-line.next-4:not(.active):not(.pre-active):not(.lyrics-gap) {
    opacity: 0.4;
    filter: blur(2.4px);
  }

  :host([data-full][data-phone]) .lyrics-line:not(.active):not(.pre-active):not(.lyrics-activest):not(.post-active-line):not(.next-active-line):not(.prev-2):not(.prev-3):not(.prev-4):not(.next-2):not(.next-3):not(.next-4):not(.lyrics-gap) {
    opacity: 0.34;
    filter: blur(2.4px);
  }

  /* Browsing dim 0.8 (PlayerLyrics.kt:402) */
  :host([data-full]) .lyrics-container.user-scrolling .lyrics-line {
    opacity: 0.8 !important;
    filter: none !important;
  }

  /* Carried word glow: 6px white @ 62% (PlayerLyrics.kt:230-248) */
  :host([data-full]) .lyrics-line.active .lyrics-syllable.highlight,
  :host([data-full]) .lyrics-line.active .lyrics-syllable.pre-highlight {
    text-shadow: 0 0 6px rgba(255, 255, 255, 0.62);
  }

  /* Backing vocals: 23px/29px @ 72%, 6px rise, 400/450ms (PlayerLyrics.kt:257-285) */
  :host([data-full]) .background-vocal-container {
    font-size: 23px;
    line-height: 29px;
    color: rgba(255, 255, 255, 0.72);
  }
  :host([data-full]) .background-vocal-wrap {
    --background-vocal-offset: 6px;
    transition:
      opacity 400ms cubic-bezier(0.41, 0, 0.12, 0.99),
      transform 400ms cubic-bezier(0.41, 0, 0.12, 0.99);
  }
  :host([data-full]) .lyrics-line.bg-collapsing .background-vocal-wrap {
    transition-duration: 450ms;
  }

  /* Duet lane 44px (PlayerLyrics.kt:339) */
  :host([data-full]) .lyrics-container.has-duet-lines .lyrics-line.singer-left {
    padding-inline-end: max(var(--lyplus-padding-line), 44px);
  }
  :host([data-full]) .lyrics-container.has-duet-lines .lyrics-line.singer-right {
    padding-inline-start: max(var(--lyplus-padding-line), 44px);
  }

  /* Translation / romanization 540ms slide (PlayerLyrics.kt:507) */
  :host([data-full]) .lyrics-translation-container,
  :host([data-full]) .lyrics-romanization-container {
    font-size: 20px;
    line-height: 25px;
    opacity: 0.85;
    transition:
      opacity 540ms cubic-bezier(0.41, 0, 0.12, 0.99),
      transform 540ms cubic-bezier(0.41, 0, 0.12, 0.99);
  }

  /* Instrumental dots: 13px, 5px gap, rest alpha .25, rest scale .76 (PlayerLyrics.kt:418-422) */
  :host([data-full]) .lyrics-gap .gap-dot {
    width: 13px;
    height: 13px;
    margin: 0 2.5px;
    opacity: 0.25;
    transform: scale(0.76);
  }

  /* Side panel keeps compact far-line floor */
  :host(:not([data-full])) .lyrics-line:not(.active):not(.pre-active):not(.lyrics-activest):not(.post-active-line):not(.next-active-line):not(.prev-2):not(.prev-3):not(.next-2):not(.next-3):not(.lyrics-gap) {
    opacity: 0.46;
  }
`;

function usePhoneLyrics(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 559px)') : null;
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => (typeof matchMedia === 'function' ? matchMedia('(max-width: 559px)').matches : false),
  );
}

/**
 * am-lyrics fed our TTML and steered clock (`LyricClock`), presented with the
 * Android `PlayerLyrics.kt` typography, falloff, glow, and scroll easing.
 */
function LyricsView({ ttml, full }: { ttml: string; full: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<AmLyricsElement | null>(null);
  const deck = usePlayer((s) => s.deck);
  const mixing = usePlayer((s) => s.mixing);
  const videoId = usePlayer((s) => s.nowPlaying?.videoId);
  const phone = usePhoneLyrics();

  useEffect(() => {
    const el = document.createElement('am-lyrics') as AmLyricsElement;
    el.ttml = ttml;
    el.interpolate = true;
    el.autoScroll = true;
    el.highlightColor = '#ffffff';
    el.fontFamily = LYRIC_FONT;
    el.className = 'block min-h-0 flex-1 overflow-hidden [--am-lyrics-highlight-color:#fff]';
    el.toggleAttribute('data-full', full);
    el.toggleAttribute('data-phone', full && phone);
    const onLineClick = (event: Event) => {
      const timestamp = (event as CustomEvent<{ timestamp: number }>).detail?.timestamp;
      if (typeof timestamp === 'number') usePlayer.getState().seek(timestamp / 1000);
    };
    el.addEventListener('line-click', onLineClick);
    host.current?.append(el);
    element.current = el;
    const unmounted = new AbortController();
    void Promise.resolve(el.updateComplete).then(() => {
      const root = el.shadowRoot;
      if (!root) return;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(HIDE_FOOTER + ANDROID_LYRICS_STYLE);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      const scroller = root.querySelector('.lyrics-container');
      const target = host.current;
      if (!full || !scroller || !target) return;
      const fade = () => target.style.setProperty('--lyrics-top-fade', `${Math.min(scroller.scrollTop, 80)}px`);
      fade();
      scroller.addEventListener('scroll', fade, { passive: true, signal: unmounted.signal });
    });
    return () => {
      unmounted.abort();
      el.removeEventListener('line-click', onLineClick);
      el.remove();
      element.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    element.current?.toggleAttribute('data-phone', full && phone);
  }, [full, phone]);

  useEffect(() => {
    if (element.current && element.current.ttml !== ttml) element.current.ttml = ttml;
  }, [ttml]);

  useEffect(() => {
    const audio = getAudio();
    const el = element.current;
    if (!audio || !el) return;
    if (mixing) {
      const start = getPlayhead()?.sec ?? audio.currentTime;
      const clock = new LyricClock(start * 1000);
      let discontinuity = 0;
      let last = start;
      let frame = 0;
      const tick = () => {
        const now = performance.now();
        const sec = getPlayhead()?.sec ?? last;
        if (sec < last - 0.15 || sec > last + 1) discontinuity++;
        last = sec;
        el.currentTime = clock.frame(now, Math.trunc(sec * 1000), now, discontinuity);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }
    const clock = new LyricClock(audio.currentTime * 1000);
    let discontinuity = 0;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      el.currentTime = clock.frame(now, Math.trunc(audio.currentTime * 1000), now, discontinuity);
      frame = requestAnimationFrame(tick);
    };
    const hold = () => {
      cancelAnimationFrame(frame);
      const ms = audio.currentTime * 1000;
      clock.hold(ms, performance.now());
      el.currentTime = ms;
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      clock.restart();
      frame = requestAnimationFrame(tick);
    };
    const onSeeking = () => {
      discontinuity++;
      if (audio.paused) hold();
    };
    audio.addEventListener('seeking', onSeeking);
    audio.addEventListener('seeked', onSeeking);
    audio.addEventListener('pause', hold);
    audio.addEventListener('play', resume);
    if (audio.paused) hold();
    else resume();
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('seeking', onSeeking);
      audio.removeEventListener('seeked', onSeeking);
      audio.removeEventListener('pause', hold);
      audio.removeEventListener('play', resume);
    };
  }, [deck, videoId, ttml, mixing]);

  return (
    <div
      ref={host}
      className={
        full
          ? 'flex min-h-0 flex-1 [mask-image:linear-gradient(180deg,transparent,#000_var(--lyrics-top-fade,0px),#000_62%,transparent)]'
          : 'flex min-h-0 flex-1'
      }
    />
  );
}

function useUngranted(): string[] {
  return useSyncExternalStore(onUngrantedChange, () => [...ungrantedOrigins].join(','), () => '')
    .split(',')
    .filter(Boolean);
}

const NO_STATES: Partial<Record<LyricsSourceId, SourceState>> = {};

function ProviderPicker({ current, full }: { current: LyricsSourceId | null; full: boolean }) {
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? '');
  const states = useLyricsUi((s) => s.states[videoId]) ?? NO_STATES;
  const picked = useLyricsUi((s) => s.picked[videoId]);
  const pick = useLyricsUi((s) => s.pick);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState(false);
  const close = useCallback(() => setAnchor(null), []);
  const label = current ? sourceById(current)?.label : 'Lyrics';

  return (
    <div
      className={
        full
          ? 'flex items-center justify-between pb-1 opacity-0 transition-opacity duration-200 group-hover/panel:opacity-100 focus-within:opacity-100'
          : 'flex items-center justify-between px-4 pt-4 pb-1'
      }
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-[8px] px-2 py-1 font-(family-name:--bc-font-family) text-[14px] font-semibold transition-colors ${
          full ? 'text-white/70 hover:bg-white/10' : 'text-(--bc-on-surface-variant) hover:bg-white/10'
        }`}
        aria-haspopup="menu"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className={`grid size-7 place-items-center rounded-[8px] transition-colors ${
          full ? 'text-white/70 hover:bg-white/10' : 'text-(--bc-on-surface-variant) hover:bg-white/10'
        }`}
        aria-label="Lyric settings"
        onClick={() => setSettings(true)}
      >
        <Settings2 size={16} />
      </button>
      {anchor && (
        <Menu anchor={anchor} placement="below-end" onClose={close} label="Lyrics provider">
          <MenuItem checked={!picked} onSelect={() => (close(), pick(videoId, null))}>
            Best available
          </MenuItem>
          <MenuSeparator />
          <MenuHeader>Providers</MenuHeader>
          {enabledSources().map((id) => {
            const state = states[id];
            return (
              <MenuItem
                key={id}
                checked={picked === id}
                trailing={
                  state === 'pending' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : state === 'found' ? (
                    <Check size={13} />
                  ) : state === 'missing' ? (
                    <Minus size={13} />
                  ) : undefined
                }
                onSelect={() => (close(), pick(videoId, id))}
              >
                {sourceById(id)?.label}
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <MenuItem onSelect={() => (close(), setSettings(true))}>Lyric Settings…</MenuItem>
        </Menu>
      )}
      {settings && <LyricsSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

function PermissionNotice({ origins }: { origins: string[] }) {
  const names = origins.map((o) => new URL(o).host.replace(/^www\./, ''));
  return (
    <div className="mx-4 my-1.5 flex items-center gap-2.5 rounded-[10px] bg-white/10 px-2.5 py-2 font-(family-name:--bc-font-family) text-[13px] text-white/75">
      <span>
        {names.slice(0, 2).join(', ')}
        {names.length > 2 ? ` and ${names.length - 2} more` : ''} need the server relay’s permission.
      </span>
      <button
        type="button"
        className="flex-none font-semibold text-(--bc-accent-red)"
        onClick={() => void getBridge()?.call('lyrics.requestPermissions', { origins })}
      >
        Allow
      </button>
    </div>
  );
}

const panel = 'group/panel relative isolate flex min-h-0 flex-1 flex-col overflow-hidden';

/**
 * The lyrics panel: keeps am-lyrics and our TTML/provider/LyricClock engine,
 * styled to the Android `PlayerLyrics.kt` presentation (spec §4.7).
 */
export function LyricsPanel({ variant = 'panel' }: { variant?: 'panel' | 'full' }) {
  const lyrics = useLyrics();
  const hasTrack = usePlayer((s) => s.nowPlaying !== null);
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? '');
  const picked = useLyricsUi((s) => s.picked[videoId]);
  const ungranted = useUngranted();
  const fontReady = useLyricFont();
  const result = lyrics.data;
  const full = variant === 'full';
  const empty = full
    ? 'flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center font-(family-name:--bc-font-family) text-[16px] text-white/70'
    : 'flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-20 text-center font-(family-name:--bc-font-family) text-[12px] text-(--bc-on-surface-variant)';
  const emptyTitle = full
    ? 'font-(family-name:--bc-font-family) text-[22px] font-bold tracking-(--bc-tracking-headline) text-white'
    : 'font-(family-name:--bc-font-family) text-[12px] font-semibold';

  return (
    <div className={panel}>
      <ProviderPicker current={result?.source ?? null} full={full} />
      {ungranted.length > 0 && !result && !lyrics.isFetching && <PermissionNotice origins={ungranted} />}
      {!hasTrack ? (
        <div className={empty}>
          <p className={emptyTitle}>No lyrics available</p>
          <p>Play a song to see its lyrics here.</p>
        </div>
      ) : (lyrics.isPending && lyrics.fetchStatus !== 'idle') || (result && !fontReady) ? (
        <div className={empty}>
          <Loader2 size={20} className="animate-spin text-white/75" />
        </div>
      ) : result ? (
        <LyricsView ttml={result.ttml} full={full} />
      ) : picked ? (
        <div className={empty}>
          <p className={emptyTitle}>Not on {sourceById(picked)?.label ?? 'this provider'}</p>
          <p>This provider hasn’t got this song. Pick another, or Best available, in the list above.</p>
        </div>
      ) : (
        <div className={empty}>
          <p className={emptyTitle}>No lyrics available</p>
          <p>None of the lyric providers has this song. Try another in the list above.</p>
        </div>
      )}
    </div>
  );
}
