import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useReducedMotion } from '@/lib/motionPrefs';
import { springStep } from '@/lib/spring';
import { getAudio, getMixBeat, getPlayhead, usePlayer } from '@/state/player';
import {
  LOADING_MIN_MS,
  MIXING_LABEL_REST,
  SCRUBBER_LABEL_LIFT_PX,
  SCRUB_ACTIVE_COLOR,
  SCRUB_ACTIVE_HEIGHT_PX,
  SCRUB_IDLE_HEIGHT_PX,
  SCRUB_INACTIVE_COLOR,
  SCRUB_MORPH_MS,
  SCRUB_THICKNESS_SPRING,
  SCRUB_TOUCH_HEIGHT_PX,
  SHEEN_BAND_FRACTION,
  SHEEN_SWEEP_MS,
  WINDOW_FADE_MS,
  clampFraction,
  computeWindowFeatherStops,
  stepPulse,
  type Pulse,
} from './thinSliderMath';
import { clock } from './useScrubber';

export * from './thinSliderMath';

const FAST_OUT_SLOW_IN = 'cubic-bezier(0.4, 0, 0.2, 1)';

function buildFeatherGradient(spanPx: number): string {
  const stops = computeWindowFeatherStops(spanPx, 0.5);
  if (stops.length === 0) return 'none';
  return `linear-gradient(to right, ${stops
    .map((s) => `rgba(255, 255, 255, ${s.alpha.toFixed(4)}) ${(s.offset * 100).toFixed(2)}%`)
    .join(', ')})`;
}

export interface ThinSliderProps {
  /** Notifies parent when user starts/stops dragging (drives landscape artwork 0.94 pose). */
  onScrubDragChange?: (dragging: boolean) => void;
  /** Optional version-switch loading state to trigger the 1000ms ping-pong sheen. */
  loading?: boolean;
}

/**
 * Android-ported `ThinSlider` + `PlayerScrubber` (`ThinSlider.kt`, `PlayerControls.kt:195-318`):
 * 7px→12px bounce-sprung capsule, 34px hit target, 450ms sheen morph, feathered
 * Automix transition window, cos² beat pulse, and 9px-lifted 12px timestamps.
 */
export function ThinSlider({ onScrubDragChange, loading = false }: ThinSliderProps) {
  const reducedMotion = useReducedMotion();
  const status = usePlayer((s) => s.status);
  const deck = usePlayer((s) => s.deck);
  const mixing = usePlayer((s) => s.mixing);
  const automix = usePlayer((s) => s.automix);
  const mixWindow = usePlayer((s) => s.automixState?.window ?? null);
  const startsIn = usePlayer((s) => s.automixState?.startsInSec ?? null);
  const videoId = usePlayer((s) => s.nowPlaying?.videoId);
  const durationSec = usePlayer((s) => s.nowPlaying?.durationSec ?? 0);
  const seek = usePlayer((s) => s.seek);

  const trackRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const mixLabelRef = useRef<HTMLSpanElement>(null);

  const [draggingFraction, setDraggingFraction] = useState<number | null>(null);
  const dragging = draggingFraction !== null;

  // Minimum 600ms sheen hold on version switch (`ThinSlider.kt:118-129`).
  const [shownLoading, setShownLoading] = useState(loading);
  const sheenStartRef = useRef(0);
  useEffect(() => {
    if (loading) {
      sheenStartRef.current = performance.now();
      setShownLoading(true);
      return;
    }
    const remaining = LOADING_MIN_MS - (performance.now() - sheenStartRef.current);
    if (remaining <= 0) {
      setShownLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShownLoading(false), remaining);
    return () => window.clearTimeout(id);
  }, [loading]);

  // Keep last transition window mounted during its 500ms fade-out.
  const [shownWindow, setShownWindow] = useState(mixWindow);
  useEffect(() => {
    if (mixWindow) setShownWindow(mixWindow);
  }, [mixWindow]);

  const pulseRef = useRef<Pulse>({ cover: 0, depth: 0, phase: 0, locked: false, last: performance.now() });
  const heightRef = useRef({ h: SCRUB_IDLE_HEIGHT_PX, v: 0, raf: 0 });
  const sheenPhaseRef = useRef({ start: performance.now(), raf: 0 });

  // Bounce spring for 7px <-> 12px thickness (`ThinSlider.kt:104-111`).
  useEffect(() => {
    const target = dragging ? SCRUB_ACTIVE_HEIGHT_PX : SCRUB_IDLE_HEIGHT_PX;
    const state = heightRef.current;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    if (reducedMotion) {
      state.h = target;
      state.v = 0;
      if (capsuleRef.current) capsuleRef.current.style.height = `${target}px`;
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const [nextH, nextV] = springStep(
        state.h,
        state.v,
        target,
        dt,
        SCRUB_THICKNESS_SPRING.stiffness,
        SCRUB_THICKNESS_SPRING.damping,
      );
      state.h = Math.max(2, nextH);
      state.v = nextV;
      if (capsuleRef.current) {
        capsuleRef.current.style.height = `${state.h.toFixed(2)}px`;
      }
      if (Math.abs(state.h - target) <= 0.05 && Math.abs(state.v) <= 0.5) {
        state.h = target;
        state.v = 0;
        state.raf = 0;
        if (capsuleRef.current) capsuleRef.current.style.height = `${target}px`;
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    return () => {
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
    };
  }, [dragging, reducedMotion]);

  const mixActive = Boolean(mixing);
  const sheenVisible = shownLoading || (status === 'loading' && !mixActive);

  // Travelling 34% sheen ping-pong (`ThinSlider.kt:453-491`: 1000ms linear Reverse).
  useEffect(() => {
    const state = sheenPhaseRef.current;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    const el = sheenRef.current;
    if (!sheenVisible || reducedMotion || !el) return;
    state.start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - state.start;
      const cycle = Math.floor(elapsed / SHEEN_SWEEP_MS);
      const raw = (elapsed % SHEEN_SWEEP_MS) / SHEEN_SWEEP_MS;
      const t = cycle % 2 === 0 ? raw : 1 - raw;
      const xPct = (-SHEEN_BAND_FRACTION + (1 + SHEEN_BAND_FRACTION) * t) * 100;
      el.style.transform = `translate3d(${xPct.toFixed(2)}%, 0, 0)`;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    return () => {
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
    };
  }, [sheenVisible, reducedMotion]);

  // Playhead + Automix cos² pulse clock driving bar width and timestamps at 60Hz with zero re-renders.
  useEffect(() => {
    const audio = getAudio();
    const fill = fillRef.current;
    if (!fill) return;
    let frame = 0;
    const draw = () => {
      const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationSec;
      const head = getPlayhead();
      const paused = head?.paused ?? audio?.paused ?? status !== 'playing';
      const currentTime =
        draggingFraction !== null && duration > 0
          ? draggingFraction * duration
          : (head?.sec ?? audio?.currentTime ?? 0);
      const base = clampFraction(duration > 0 ? currentTime / duration : 0);
      const beat = draggingFraction === null ? getMixBeat() : null;
      const mix = stepPulse(pulseRef.current, performance.now(), beat, paused, reducedMotion);

      const claimedFraction = base + (1 - base) * (draggingFraction !== null ? 0 : mix.cover);
      const fillFactor = sheenVisible ? 0 : 1;
      const widthScale = clampFraction(claimedFraction * fillFactor);
      fill.style.transform = `scaleX(${widthScale})`;
      fill.style.opacity = mix.active ? String(mix.alpha) : '1';

      if (elapsedRef.current) {
        elapsedRef.current.textContent = clock(currentTime);
        elapsedRef.current.style.opacity = mix.active ? String(1 - mix.cover) : '1';
      }
      if (remainingRef.current) {
        remainingRef.current.textContent = `-${clock(Math.max(0, duration - currentTime))}`;
        remainingRef.current.style.opacity = mix.active ? String(1 - mix.cover) : '1';
      }
      if (mixLabelRef.current) {
        const labelPulse = MIXING_LABEL_REST + (1 - MIXING_LABEL_REST) * ((mix.alpha - 0.1) / 0.9);
        mixLabelRef.current.style.opacity = mix.active ? String(mix.cover * Math.min(1, Math.max(0, labelPulse))) : '0';
      }

      if (!paused || draggingFraction !== null || mix.active || beat) {
        frame = requestAnimationFrame(draw);
      }
    };
    draw();
    const onSeeked = () => draw();
    audio?.addEventListener('seeked', onSeeked);
    return () => {
      cancelAnimationFrame(frame);
      audio?.removeEventListener('seeked', onSeeked);
    };
  }, [status, deck, draggingFraction, mixing, durationSec, sheenVisible, reducedMotion]);

  const fractionAt = (event: React.PointerEvent<HTMLElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clampFraction((event.clientX - rect.left) / rect.width);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!getAudio() && durationSec <= 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events.
    }
    const f = fractionAt(e);
    setDraggingFraction(f);
    onScrubDragChange?.(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (draggingFraction === null) return;
    e.stopPropagation();
    setDraggingFraction(fractionAt(e));
  };

  const finishScrub = (e: React.PointerEvent<HTMLElement>, commit: boolean) => {
    if (draggingFraction === null) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore.
    }
    if (commit) {
      const audio = getAudio();
      const dur = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationSec;
      if (dur > 0) seek(fractionAt(e) * dur);
    }
    setDraggingFraction(null);
    onScrubDragChange?.(false);
  };

  // Automix feathered transition window metrics (`ThinSlider.kt:200-229`).
  const windowVisible = automix && Boolean(mixWindow) && mixWindow?.videoId === videoId && durationSec > 0;
  const blending = startsIn !== null && startsIn <= 0;
  const wLeft = shownWindow && durationSec > 0 ? clampFraction(shownWindow.startSec / durationSec) : 0;
  const wRight = shownWindow && durationSec > 0 ? Math.max(wLeft, clampFraction(shownWindow.endSec / durationSec)) : 0;
  const trackWidth = trackRef.current?.clientWidth ?? 330;
  const windowSpanPx = (wRight - wLeft) * trackWidth;

  return (
    <div className="w-full select-none" data-dragging={dragging || undefined}>
      {/* Single tap+drag gesture target (`ThinSlider.kt:155`: activeHeight + 22dp = 34px). */}
      <div
        ref={trackRef}
        className="flex w-full cursor-pointer touch-none items-center"
        style={{ height: `${SCRUB_TOUCH_HEIGHT_PX}px` }}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishScrub(e, true)}
        onPointerCancel={(e) => finishScrub(e, false)}
      >
        <div
          ref={capsuleRef}
          className="relative w-full overflow-hidden rounded-full"
          style={{
            height: `${SCRUB_IDLE_HEIGHT_PX}px`,
            backgroundColor: SCRUB_INACTIVE_COLOR,
          }}
          aria-hidden="true"
        >
          {/* Feathered Automix upcoming window (`ThinSlider.kt:200-229`). */}
          {shownWindow && durationSec > 0 && wRight > wLeft && (
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{
                left: `${wLeft * 100}%`,
                width: `${(wRight - wLeft) * 100}%`,
                background: buildFeatherGradient(windowSpanPx),
                opacity: windowVisible && !blending ? 1 : 0,
                transition: `opacity ${WINDOW_FADE_MS}ms ${FAST_OUT_SLOW_IN}`,
              }}
            />
          )}

          {/* Played fill (`ThinSlider.kt:243-254`). */}
          <div
            ref={fillRef}
            className="relative size-full origin-left rounded-full"
            style={{
              backgroundColor: SCRUB_ACTIVE_COLOR,
              transform: 'scaleX(0)',
              transition: `background-color ${SCRUB_MORPH_MS}ms ${FAST_OUT_SLOW_IN}`,
            }}
          />

          {/* Version-switch travelling sheen (`ThinSlider.kt:258-274, :453-491`). */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
            style={{
              opacity: sheenVisible ? 1 : 0,
              transform: sheenVisible ? 'scaleX(1)' : 'scaleX(0)',
              transformOrigin: '0% 50%',
              transition: `opacity ${SCRUB_MORPH_MS}ms ${FAST_OUT_SLOW_IN}, transform ${SCRUB_MORPH_MS}ms ${FAST_OUT_SLOW_IN}`,
            }}
          >
            <div
              ref={sheenRef}
              className="absolute inset-y-0 left-0"
              style={{
                width: `${SHEEN_BAND_FRACTION * 100}%`,
                background: `linear-gradient(to right, transparent, ${SCRUB_ACTIVE_COLOR}, transparent)`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Time labels pulled 9px up under the capsule (`PlayerControls.kt:195`, `:245`). */}
      <div
        className="relative flex items-center justify-between font-(family-name:--bc-font-family) text-[12px] leading-[1.25] font-semibold tracking-(--bc-tracking-label) tabular-nums"
        style={{
          marginTop: `-${SCRUBBER_LABEL_LIFT_PX}px`,
          color: 'rgba(255, 255, 255, 0.55)',
        }}
      >
        <span ref={elapsedRef}>0:00</span>
        <span
          ref={mixLabelRef}
          className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium opacity-0"
          style={{ color: 'rgba(255, 255, 255, 0.85)' }}
          aria-hidden="true"
        >
          Mixing
        </span>
        <span ref={remainingRef}>-0:00</span>
      </div>
    </div>
  );
}
