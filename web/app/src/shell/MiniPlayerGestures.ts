import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { MINI_PLAYER_SETTLE_SPRING, springStep } from '@/lib/spring';

/** Horizontal drag distance to skip previous/next (MiniPlayer.kt:142). */
export const TRACK_SWIPE_THRESHOLD = 72;

/** Upward pull bias: |dx| < -dy * PULL_BIAS locks vertical pull (MiniPlayer.kt:151). */
export const PULL_BIAS = 1.5;

/** Finger distance over which bar rise slows (MiniPlayer.kt:159). */
export const PULL_LIFT_EASE = 72;

/** Initial bar rise per pixel of upward pull (MiniPlayer.kt:162). */
export const PULL_LIFT_RATE = 0.5;

/** Standard pointer slop before committing an axis lock. */
export const TOUCH_SLOP = 8;

export type GestureAxis = 'pending' | 'vertical-up' | 'horizontal' | 'ignore';

export interface PointerSample {
  y: number;
  t: number;
}

/**
 * Rubber-band rise of the mini player under an upward pull (MiniPlayer.kt:170-175):
 * starts at PULL_LIFT_RATE (0.5) and eases at rate 0.5 / sqrt(1 + p / 72).
 */
export function pullLift(pulled: number, ease = PULL_LIFT_EASE): number {
  if (pulled <= 0 || ease <= 0) return 0;
  return PULL_LIFT_RATE * 2 * ease * (Math.sqrt(1 + pulled / ease) - 1);
}

/**
 * Decides gesture axis once pointer travel passes touch slop (MiniPlayer.kt:249-255):
 * - upward within PULL_BIAS (1.5x) -> 'vertical-up' (hands off to PlayerSheetMotion)
 * - horizontal dominant -> 'horizontal' (72px track skip)
 * - downward -> 'ignore'
 */
export function decideGestureAxis(
  dx: number,
  dy: number,
  touchSlop = TOUCH_SLOP,
  pullBias = PULL_BIAS,
): GestureAxis {
  if (Math.hypot(dx, dy) < touchSlop) return 'pending';
  if (dy < 0 && Math.abs(dx) < -dy * pullBias) return 'vertical-up';
  if (Math.abs(dx) >= Math.abs(dy)) return 'horizontal';
  return 'ignore';
}

/** Resolves a completed horizontal drag to a track skip direction (MiniPlayer.kt:269-274). */
export function resolveHorizontalSwipe(
  draggedX: number,
  threshold = TRACK_SWIPE_THRESHOLD,
): 'next' | 'previous' | null {
  if (draggedX <= -threshold) return 'next';
  if (draggedX >= threshold) return 'previous';
  return null;
}

/** Estimates release velocity in px/s from recent pointer samples (last ~100ms). */
export function computeVelocityY(samples: readonly PointerSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]!;
    first = s;
    if (last.t - s.t >= 80) break;
  }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0.001) return 0;
  return (last.y - first.y) / dt;
}

export interface MiniPlayerGesturesOptions {
  enabled: boolean;
  canPull: boolean;
  reducedMotion: boolean;
  onPullDrag: (deltaY: number) => void;
  onPullRelease: (velocityY: number) => void;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Unified single-detector gesture controller for the mini player pill (`MiniPlayer.kt:212-315`):
 * - Upward pull: rubber-band lifts the pill (`pullLift`) + drives sheet 1:1, then springs
 *   the pill home on `MINI_PLAYER_SETTLE_SPRING` (ζ 0.65, stiffness 400).
 * - Horizontal drag: 72px swipe left = `next()`, 72px swipe right = `previous()` on release.
 */
export function useMiniPlayerGestures({
  enabled,
  canPull,
  reducedMotion,
  onPullDrag,
  onPullRelease,
  onNext,
  onPrevious,
}: MiniPlayerGesturesOptions) {
  const liftRef = useRef<HTMLDivElement>(null);
  const liftPx = useRef(0);
  const liftVel = useRef(0);
  const settleRaf = useRef(0);
  const suppressClick = useRef(false);

  const active = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    axis: GestureAxis;
    pulled: number;
    samples: PointerSample[];
  } | null>(null);

  const writeLift = useCallback((y: number) => {
    liftPx.current = y;
    const el = liftRef.current;
    if (!el) return;
    el.style.transform = y > 0.05 ? `translate3d(0, ${-y}px, 0)` : '';
  }, []);

  const stopSettle = useCallback(() => {
    if (settleRaf.current) {
      cancelAnimationFrame(settleRaf.current);
      settleRaf.current = 0;
    }
  }, []);

  const settleLiftHome = useCallback(() => {
    stopSettle();
    if (reducedMotion || liftPx.current <= 0.5) {
      liftVel.current = 0;
      writeLift(0);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const [nextX, nextV] = springStep(
        liftPx.current,
        liftVel.current,
        0,
        dt,
        MINI_PLAYER_SETTLE_SPRING.stiffness,
        MINI_PLAYER_SETTLE_SPRING.damping,
      );
      liftVel.current = nextV;
      writeLift(Math.max(0, nextX));
      if (Math.abs(nextX) <= 0.5 && Math.abs(nextV) <= 5) {
        settleRaf.current = 0;
        liftVel.current = 0;
        writeLift(0);
        return;
      }
      settleRaf.current = requestAnimationFrame(tick);
    };
    settleRaf.current = requestAnimationFrame(tick);
  }, [reducedMotion, stopSettle, writeLift]);

  useEffect(() => () => stopSettle(), [stopSettle]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      suppressClick.current = false;
      active.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        axis: 'pending',
        pulled: 0,
        samples: [{ y: e.clientY, t: e.timeStamp || performance.now() }],
      };
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const g = active.current;
      if (!g || g.pointerId !== e.pointerId) return;

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const t = e.timeStamp || performance.now();

      if (g.axis === 'pending') {
        const nextAxis = decideGestureAxis(dx, dy);
        if (nextAxis === 'pending') return;
        if (nextAxis === 'ignore' || (nextAxis === 'vertical-up' && !canPull)) {
          active.current = null;
          return;
        }
        g.axis = nextAxis;
        suppressClick.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore if synthetic event has no active pointer.
        }
        if (nextAxis === 'vertical-up') {
          stopSettle();
          // Player receives full displacement from touch-down (MiniPlayer.kt:287); bar lift starts at 0.
          onPullDrag(dy);
          g.lastX = e.clientX;
          g.lastY = e.clientY;
          g.samples.push({ y: e.clientY, t });
          return;
        }
      }

      if (g.axis === 'vertical-up') {
        const deltaY = e.clientY - g.lastY;
        g.lastY = e.clientY;
        g.pulled = Math.max(0, g.pulled - deltaY);
        g.samples.push({ y: e.clientY, t });
        if (g.samples.length > 12) g.samples.shift();
        onPullDrag(deltaY);
        writeLift(pullLift(g.pulled));
      } else if (g.axis === 'horizontal') {
        g.lastX = e.clientX;
      }
    },
    [canPull, onPullDrag, stopSettle, writeLift],
  );

  const finishGesture = useCallback(
    (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
      const g = active.current;
      if (!g || g.pointerId !== e.pointerId) return;
      active.current = null;

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore.
      }

      if (g.axis === 'vertical-up') {
        const velY = cancelled ? 0 : computeVelocityY(g.samples);
        onPullRelease(velY);
        settleLiftHome();
      } else if (g.axis === 'horizontal' && !cancelled) {
        const action = resolveHorizontalSwipe(e.clientX - g.startX);
        if (action === 'next') onNext();
        else if (action === 'previous') onPrevious();
      }
    },
    [onNext, onPrevious, onPullRelease, settleLiftHome],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finishGesture(e, false),
    [finishGesture],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finishGesture(e, true),
    [finishGesture],
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    liftRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
