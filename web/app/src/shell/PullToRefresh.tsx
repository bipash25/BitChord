import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/motionPrefs';

export const REFRESH_PUCK_SIZE = 40;
export const REFRESH_PUCK_TRAVEL = 56;
export const REFRESH_PULL_THRESHOLD_PX = 84;

export interface RefreshPuckState {
  eased: number;
  translateY: number;
  alpha: number;
  rotationDeg: number;
  progress: number;
}

/**
 * Pure pull-to-refresh puck kinematics (`FrostedTopBar.kt:622-653`, spec §4.1):
 * eases reluctantly past 1 (`1 + (f - 1) × 0.35`), fades in over `f × 3`, and
 * spins the 22px progress arc `180° × f` up to 80% circumference.
 */
export function computeRefreshPuckState(fraction: number): RefreshPuckState {
  const f = Math.min(2, Math.max(0, fraction));
  const eased = f <= 1 ? f : 1 + (f - 1) * 0.35;
  return {
    eased,
    translateY: REFRESH_PUCK_TRAVEL * eased - REFRESH_PUCK_SIZE,
    alpha: Math.min(1, f * 3),
    rotationDeg: f * 180,
    progress: Math.min(0.8, Math.max(0, f * 0.8)),
  };
}

const ARC_RADIUS = 8.5;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;

/**
 * Mobile pull-to-refresh puck (`FrostedTopBar.kt:602-658`, spec §4.1, §4.10):
 * watches `#scrollable-page` at `scrollTop <= 0` for downward pull gestures and
 * refreshes active queries when pulled past `REFRESH_PULL_THRESHOLD_PX`.
 */
export function PullToRefresh({
  scrollContainerRef,
  onRefresh,
}: {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  onRefresh: () => Promise<void> | void;
}) {
  const reducedMotion = useReducedMotion();
  const [fraction, setFraction] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const dragRef = useRef({
    active: false,
    pulling: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    fraction: 0,
  });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || e.button !== 0 || refreshing) return;
      if (el.scrollTop > 1) return;
      dragRef.current = {
        active: true,
        pulling: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        fraction: 0,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.active || e.pointerId !== d.pointerId) return;
      if (el.scrollTop > 1 && !d.pulling) {
        d.active = false;
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.pulling) {
        if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
        if (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.2) {
          d.active = false;
          return;
        }
        d.pulling = true;
      }
      const nextFraction = Math.min(2, Math.max(0, dy / REFRESH_PULL_THRESHOLD_PX));
      d.fraction = nextFraction;
      setFraction(nextFraction);
    };

    const finish = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.active || e.pointerId !== d.pointerId) return;
      const committed = d.pulling && d.fraction >= 1;
      d.active = false;
      d.pulling = false;
      d.fraction = 0;

      if (!committed) {
        setFraction(0);
        return;
      }

      setRefreshing(true);
      setFraction(1);
      const minSpin = new Promise((r) => setTimeout(r, 600));
      void Promise.allSettled([Promise.resolve(onRefreshRef.current()), minSpin]).then(() => {
        setRefreshing(false);
        setFraction(0);
      });
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
    };
  }, [scrollContainerRef, refreshing]);

  if (!refreshing && fraction <= 0) return null;

  const state = computeRefreshPuckState(refreshing ? 1 : fraction);
  const dashOffset = ARC_CIRCUMFERENCE * (1 - (refreshing ? 0.72 : state.progress));

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+var(--bc-topbar-h))] z-(--z-web-chrome) flex justify-center overflow-hidden lg:hidden"
      style={{ height: REFRESH_PUCK_TRAVEL + REFRESH_PUCK_SIZE }}
      aria-hidden="true"
    >
      <div
        className="grid size-10 place-items-center rounded-full bg-(--bc-surface-variant) text-(--bc-primary) shadow-(--bc-shadow-refresh-puck)"
        style={{
          transform: `translate3d(0, ${state.translateY}px, 0)`,
          opacity: state.alpha,
        }}
      >
        <svg
          width={22}
          height={22}
          viewBox="0 0 22 22"
          className={refreshing && !reducedMotion ? 'animate-spin' : undefined}
          style={!refreshing && !reducedMotion ? { transform: `rotate(${state.rotationDeg}deg)` } : undefined}
        >
          <circle
            cx={11}
            cy={11}
            r={ARC_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={ARC_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
      </div>
    </div>
  );
}
