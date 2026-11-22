import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/lib/motionPrefs';

/**
 * 25ms decorative frame interval (Common.kt:709): lands on vsync at ~30fps
 * without forcing glass bars beneath the page to re-blur on every 120Hz tick.
 */
const MOTION_FRAME_GAP_MS = 25;
const PLAYING_BAR_MINIMUMS = [0.38, 0.78, 0.52] as const;

export function playingBarHeight(index: number, ms: number): number {
  const minimum = PLAYING_BAR_MINIMUMS[index] ?? 0.4;
  const duration = 520 + index * 130;
  const peak = 260 + index * 50;
  let t = ms % (2 * duration);
  if (t > duration) t = 2 * duration - t;
  if (t <= peak) {
    return minimum + ((1 - minimum) * t) / peak;
  }
  return 1 - ((1 - minimum) * (t - peak)) / (duration - peak);
}

/**
 * Android's `SearchPlayingBars` (`Common.kt:741-782`, spec §4.10): 24px plate
 * (6px radius, black 52%) with 3 white 3px bars oscillating asynchronously.
 * Holds at rest under `prefers-reduced-motion`.
 */
export function PlayingBars({ className = '' }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (reducedMotion) {
      for (let i = 0; i < PLAYING_BAR_MINIMUMS.length; i++) {
        const el = barsRef.current[i];
        if (el) el.style.transform = `scaleY(${PLAYING_BAR_MINIMUMS[i]})`;
      }
      return;
    }

    let rafId = 0;
    let lastDraw = 0;
    const start = performance.now();

    const tick = (now: number) => {
      if (now - lastDraw >= MOTION_FRAME_GAP_MS) {
        lastDraw = now;
        const ms = now - start;
        for (let i = 0; i < PLAYING_BAR_MINIMUMS.length; i++) {
          const el = barsRef.current[i];
          if (el) el.style.transform = `scaleY(${playingBarHeight(i, ms).toFixed(3)})`;
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [reducedMotion]);

  return (
    <span
      className={`pointer-events-none grid size-6 place-items-center rounded-[6px] bg-black/52 ${className}`}
      aria-label="Playing"
    >
      <span className="flex h-[14px] w-[13px] items-end justify-between">
        {PLAYING_BAR_MINIMUMS.map((min, index) => (
          <span
            key={index}
            ref={(el) => {
              barsRef.current[index] = el;
            }}
            className="h-full w-[3px] origin-bottom rounded-[1.5px] bg-white"
            style={{ transform: `scaleY(${min})` }}
          />
        ))}
      </span>
    </span>
  );
}
