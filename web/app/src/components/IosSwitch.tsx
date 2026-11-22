import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/motionPrefs';
import { IOS_SWITCH_STRETCH_SPRING, IOS_SWITCH_THUMB_SPRING, springStep } from '@/lib/spring';

export const SWITCH_TRACK_WIDTH = 64;
export const SWITCH_TRACK_HEIGHT = 28;
export const SWITCH_THUMB_WIDTH = 40;
export const SWITCH_THUMB_HEIGHT = 24;
export const SWITCH_THUMB_PADDING = 2;
export const SWITCH_THUMB_TRAVEL = SWITCH_TRACK_WIDTH - SWITCH_THUMB_WIDTH - SWITCH_THUMB_PADDING * 2;
export const SWITCH_PRESS_STRETCH = 1.18;

export interface IosSwitchProps {
  checked: boolean;
  onCheckedChange?: ((checked: boolean) => void) | null;
  enabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Pure step helper for `IosSwitch` thumb travel (`ζ 0.78 / 700`) and press
 * stretch (`ζ 0.7 / 900` toward 1.18), used by both rAF and unit tests.
 */
export function stepSwitchState(
  state: { pos: number; posVel: number; stretch: number; stretchVel: number },
  targetPos: number,
  targetStretch: number,
  dt: number,
): { pos: number; posVel: number; stretch: number; stretchVel: number; settled: boolean } {
  const [pos, posVel] = springStep(
    state.pos,
    state.posVel,
    targetPos,
    dt,
    IOS_SWITCH_THUMB_SPRING.stiffness,
    IOS_SWITCH_THUMB_SPRING.damping,
  );
  const [stretch, stretchVel] = springStep(
    state.stretch,
    state.stretchVel,
    targetStretch,
    dt,
    IOS_SWITCH_STRETCH_SPRING.stiffness,
    IOS_SWITCH_STRETCH_SPRING.damping,
  );
  const posDone = Math.abs(targetPos - pos) < 0.002 && Math.abs(posVel) < 0.002;
  const stretchDone = Math.abs(targetStretch - stretch) < 0.002 && Math.abs(stretchVel) < 0.002;
  return {
    pos: posDone ? targetPos : pos,
    posVel: posDone ? 0 : posVel,
    stretch: stretchDone ? targetStretch : stretch,
    stretchVel: stretchDone ? 0 : stretchVel,
    settled: posDone && stretchDone,
  };
}

/**
 * Android-ported iOS 26 switch (`IosSwitch.kt:61-145`, spec §4.10):
 * 64×28px capsule track, 40×24px white thumb on a ζ 0.78 / 700 travel spring,
 * and a 1.18× press stretch on a ζ 0.7 / 900 spring anchored to the edge the
 * thumb is leaving.
 */
export function IosSwitch({
  checked,
  onCheckedChange,
  enabled = true,
  id,
  ariaLabel,
  className = '',
}: IosSwitchProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const thumbRef = useRef<HTMLSpanElement>(null);

  const animRef = useRef({
    pos: checked ? 1 : 0,
    posVel: 0,
    stretch: 1,
    stretchVel: 0,
    targetPos: checked ? 1 : 0,
    targetStretch: 1,
    rafId: 0,
    lastTime: 0,
  });

  const paintThumb = (pos: number, stretch: number, isChecked: boolean) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const x = SWITCH_THUMB_PADDING + SWITCH_THUMB_TRAVEL * pos;
    thumb.style.transformOrigin = isChecked ? '100% 50%' : '0% 50%';
    thumb.style.transform = `translate3d(${x}px, 0, 0) scaleX(${stretch})`;
  };

  useEffect(() => {
    const s = animRef.current;
    const targetPos = checked ? 1 : 0;
    const targetStretch = pressed && enabled && !reducedMotion ? SWITCH_PRESS_STRETCH : 1;
    s.targetPos = targetPos;
    s.targetStretch = targetStretch;

    if (reducedMotion) {
      if (s.rafId) {
        cancelAnimationFrame(s.rafId);
        s.rafId = 0;
      }
      s.pos = targetPos;
      s.posVel = 0;
      s.stretch = 1;
      s.stretchVel = 0;
      paintThumb(targetPos, 1, checked);
      return;
    }

    if (s.rafId) return;
    s.lastTime = 0;
    const tick = (now: number) => {
      const dt = s.lastTime ? Math.min((now - s.lastTime) / 1000, 0.05) : 1 / 60;
      s.lastTime = now;

      const next = stepSwitchState(s, s.targetPos, s.targetStretch, dt);
      s.pos = next.pos;
      s.posVel = next.posVel;
      s.stretch = next.stretch;
      s.stretchVel = next.stretchVel;
      paintThumb(s.pos, s.stretch, s.targetPos >= 0.5);

      if (next.settled) {
        s.rafId = 0;
      } else {
        s.rafId = requestAnimationFrame(tick);
      }
    };
    s.rafId = requestAnimationFrame(tick);
  }, [checked, pressed, enabled, reducedMotion]);

  useEffect(() => {
    return () => {
      if (animRef.current.rafId) cancelAnimationFrame(animRef.current.rafId);
    };
  }, []);

  const interactive = onCheckedChange != null;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center select-none ${
        interactive ? 'min-h-12 cursor-pointer' : ''
      } ${enabled ? '' : 'pointer-events-none opacity-45'} ${className}`}
      onPointerDown={() => {
        if (interactive && enabled) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {interactive && (
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={ariaLabel}
          className="peer sr-only"
          checked={checked}
          disabled={!enabled}
          onChange={(e) => onCheckedChange(e.currentTarget.checked)}
        />
      )}
      <span
        aria-hidden="true"
        className="relative inline-flex items-center rounded-full transition-[background-color] duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-(--bc-primary) peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-(--bc-surface)"
        style={{
          width: SWITCH_TRACK_WIDTH,
          height: SWITCH_TRACK_HEIGHT,
          backgroundColor: checked ? 'var(--bc-green)' : 'var(--bc-switch-off-bg)',
        }}
      >
        <span
          ref={thumbRef}
          className="block rounded-full bg-white shadow-(--bc-shadow-thumb-switch) will-change-transform"
          style={{
            width: SWITCH_THUMB_WIDTH,
            height: SWITCH_THUMB_HEIGHT,
            transformOrigin: checked ? '100% 50%' : '0% 50%',
            transform: `translate3d(${SWITCH_THUMB_PADDING + SWITCH_THUMB_TRAVEL * (checked ? 1 : 0)}px, 0, 0) scaleX(1)`,
          }}
        />
      </span>
    </span>
  );
}
