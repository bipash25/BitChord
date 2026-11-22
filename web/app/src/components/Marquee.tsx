import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { horizontalEdgeFadeMask } from '@/lib/fadeCurve';
import { useReducedMotion } from '@/lib/motionPrefs';

export const MARQUEE_SPEED_PX_PER_SEC = 26;
export const MARQUEE_GAP_PX = 48;
export const MARQUEE_REST_MS = 5000;
export const MARQUEE_ARTIST_STAGGER_MS = 3000;
export const MARQUEE_FADE_PX = 16;

export interface MarqueeMetrics {
  overflowing: boolean;
  travelPx: number;
  scrollMs: number;
}

/**
 * Computes marquee travel distance and linear scroll duration
 * (`PlayerControls.kt:1390-1468`, spec §4.1, §4.10): 26px/s, 48px gap.
 */
export function computeMarqueeMetrics(
  contentWidth: number,
  containerWidth: number,
  gapPx = MARQUEE_GAP_PX,
  speedPxPerSec = MARQUEE_SPEED_PX_PER_SEC,
): MarqueeMetrics {
  if (containerWidth <= 0 || contentWidth <= containerWidth + 1) {
    return { overflowing: false, travelPx: 0, scrollMs: 0 };
  }
  const travelPx = contentWidth + gapPx;
  const scrollMs = Math.max(400, Math.round((travelPx / speedPxPerSec) * 1000));
  return { overflowing: true, travelPx, scrollMs };
}

export interface MarqueeProps {
  children: ReactNode;
  /** Re-measures whenever this key changes (usually track title/artist text). */
  measureKey?: string;
  className?: string;
  enabled?: boolean;
  startDelayMs?: number;
  onOverflowChange?: (overflowing: boolean) => void;
}

/**
 * Android-ported `MarqueeText` (`PlayerControls.kt:1428-1539`, spec §4.10):
 * rests at start, crawls one copy + 48px gap at 26px/s, rests 5s between
 * passes, supports 3s artist stagger, fades overflowing edges, and holds still
 * at offset 0 under `prefers-reduced-motion`.
 */
export function Marquee({
  children,
  measureKey,
  className = '',
  enabled = true,
  startDelayMs = 0,
  onOverflowChange,
}: MarqueeProps) {
  const reducedMotion = useReducedMotion();
  const boxRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState<MarqueeMetrics>({ overflowing: false, travelPx: 0, scrollMs: 0 });

  const measure = () => {
    const box = boxRef.current;
    const item = measureRef.current;
    if (!box || !item) return;
    const next = computeMarqueeMetrics(item.getBoundingClientRect().width, box.clientWidth);
    setMetrics((prev) =>
      prev.overflowing === next.overflowing && prev.travelPx === next.travelPx && prev.scrollMs === next.scrollMs
        ? prev
        : next,
    );
  };

  useLayoutEffect(() => {
    measure();
  }, [measureKey]);

  useEffect(() => {
    const box = boxRef.current;
    const item = measureRef.current;
    if (!box || !item || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(item);
    return () => ro.disconnect();
  }, []);

  const crawls = enabled && !reducedMotion && metrics.overflowing;

  useEffect(() => {
    onOverflowChange?.(crawls);
  }, [crawls, onOverflowChange]);

  useEffect(() => {
    const track = trackRef.current;
    const box = boxRef.current;
    if (!track || !box) return;

    const applyEndOnlyMask = () => {
      if (metrics.overflowing) {
        const mask = horizontalEdgeFadeMask(MARQUEE_FADE_PX, 0, 1);
        box.style.maskImage = mask;
        box.style.webkitMaskImage = mask;
      } else {
        box.style.maskImage = '';
        box.style.webkitMaskImage = '';
      }
    };

    track.style.transform = 'translate3d(0, 0, 0)';
    applyEndOnlyMask();

    if (!crawls || metrics.travelPx <= 0) return;

    let cancelled = false;
    let rafId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const setLeftFade = (moved: number) => {
      const startAlpha = Math.min(1, Math.max(0, Math.min(moved, metrics.travelPx - moved) / MARQUEE_FADE_PX));
      if (startAlpha <= 0.02) {
        applyEndOnlyMask();
        return;
      }
      const mask = horizontalEdgeFadeMask(MARQUEE_FADE_PX, startAlpha, 1);
      box.style.maskImage = mask;
      box.style.webkitMaskImage = mask;
    };

    const runPass = () => {
      if (cancelled) return;
      const startTime = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / metrics.scrollMs);
        const offset = t * metrics.travelPx;
        track.style.transform = `translate3d(${-offset}px, 0, 0)`;
        setLeftFade(offset);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          track.style.transform = 'translate3d(0, 0, 0)';
          applyEndOnlyMask();
          timerId = setTimeout(runPass, MARQUEE_REST_MS);
        }
      };
      rafId = requestAnimationFrame(tick);
    };

    timerId = setTimeout(runPass, Math.max(0, startDelayMs));

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
      track.style.transform = 'translate3d(0, 0, 0)';
      applyEndOnlyMask();
    };
  }, [crawls, metrics.overflowing, metrics.travelPx, metrics.scrollMs, startDelayMs]);

  return (
    <span ref={boxRef} className={`block min-w-0 max-w-full overflow-hidden ${className}`}>
      <span ref={trackRef} className="inline-flex w-max items-center whitespace-nowrap will-change-transform">
        <span ref={measureRef} className="inline-flex items-center whitespace-nowrap">
          {children}
        </span>
        {crawls && (
          <span
            aria-hidden="true"
            className="inline-flex items-center whitespace-nowrap"
            style={{ marginLeft: MARQUEE_GAP_PX }}
          >
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
