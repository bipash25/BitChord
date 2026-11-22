import { create } from 'zustand';
import { getAudio, setAfterTrackStopHook, usePlayer } from './player';
import { showToast } from './toast';

/** Android SleepTimer preset durations in minutes (`SongActionsMenu.kt:642-655`). */
export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;

interface SleepTimerState {
  minutes: number | null;
  deadlineMs: number | null;
  afterTrack: boolean;
  start: (minutes: number) => void;
  startAfterTrack: () => void;
  cancel: () => void;
}

let timerId: ReturnType<typeof setTimeout> | null = null;

function clearScheduledTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function pauseForSleepTimer() {
  clearScheduledTimer();
  setAfterTrackStopHook(null);
  const audio = getAudio();
  if (audio && !audio.paused) audio.pause();
  usePlayer.setState({ status: 'paused' });
  useSleepTimer.setState({ minutes: null, deadlineMs: null, afterTrack: false });
  showToast('Sleep timer paused playback');
}

/**
 * Web port of Android's `SleepTimer` (`SongActionsMenu.kt:599-670`, §25 #3):
 * supports timed presets (`15, 30, 45, 60 min`) and `afterTrack` (pauses when
 * the current track finishes).
 */
export const useSleepTimer = create<SleepTimerState>()((set) => ({
  minutes: null,
  deadlineMs: null,
  afterTrack: false,

  start(minutes) {
    clearScheduledTimer();
    setAfterTrackStopHook(null);
    const ms = Math.max(1, minutes) * 60_000;
    const deadlineMs = Date.now() + ms;
    timerId = setTimeout(pauseForSleepTimer, ms);
    set({ minutes, deadlineMs, afterTrack: false });
    showToast(`Sleep timer set for ${minutes === 60 ? '1 hour' : `${minutes} min`}`);
  },

  startAfterTrack() {
    clearScheduledTimer();
    setAfterTrackStopHook(() => {
      pauseForSleepTimer();
      return true;
    });
    set({ minutes: null, deadlineMs: null, afterTrack: true });
    showToast('Playback will pause after this song');
  },

  cancel() {
    clearScheduledTimer();
    setAfterTrackStopHook(null);
    set({ minutes: null, deadlineMs: null, afterTrack: false });
    showToast('Sleep timer turned off');
  },
}));

/** Formats remaining ms as `m:ss` (or `h:mm:ss` when >= 1 hour). */
export function formatSleepCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
