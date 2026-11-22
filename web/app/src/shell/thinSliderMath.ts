import { dampingFromRatio } from '@/lib/spring';

/** Idle and pressed capsule heights (ThinSlider.kt:96-97). */
export const SCRUB_IDLE_HEIGHT_PX = 7;
export const SCRUB_ACTIVE_HEIGHT_PX = 12;
/** Touch hit target height: activeHeight + 22dp (ThinSlider.kt:155). */
export const SCRUB_TOUCH_HEIGHT_PX = SCRUB_ACTIVE_HEIGHT_PX + 22;

/** Bounce spring for scrub bar thickness: ζ 0.5, stiffness 400 (ThinSlider.kt:107-108). */
export const SCRUB_THICKNESS_SPRING = {
  stiffness: 400,
  damping: dampingFromRatio(400, 0.5),
} as const;

/** Bar palette (ThinSlider.kt:98-101). */
export const SCRUB_ACTIVE_COLOR = 'rgba(255, 255, 255, 0.92)';
export const SCRUB_INACTIVE_COLOR = 'rgba(255, 255, 255, 0.26)';
export const SCRUB_MARKER_COLOR = 'rgba(255, 255, 255, 0.5)';

/** Sheen & morph constants (ThinSlider.kt:278, :431, :434). */
export const SHEEN_BAND_FRACTION = 0.34;
export const SHEEN_SWEEP_MS = 1000;
export const SCRUB_MORPH_MS = 450;
export const LOADING_MIN_MS = 600;

/** Automix window feather constants (ThinSlider.kt:281-293). */
export const WINDOW_FEATHER_SHARE = 0.4;
export const WINDOW_FEATHER_MIN_PX = 6;
export const WINDOW_FEATHER_MAX_PX = 40;
export const WINDOW_FEATHER_STEPS = 6;
export const WINDOW_FADE_MS = 500;

/** Scrubber label lift above bottom of hit box (PlayerControls.kt:195). */
export const SCRUBBER_LABEL_LIFT_PX = 9;
/** Mixing label minimum opacity share between beats (PlayerControls.kt:318). */
export const MIXING_LABEL_REST = 0.5;

/** Automix beat pulse constants (ThinSlider.kt:403-428). */
export const COVER_SEC = 0.7;
export const PULSE_FADE_SEC = 0.9;
export const PULSE_REST = 0.1;
export const PHASE_PULL = 0.06;
export const BREATH_SEC = 1.8;

export function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export interface FeatherStop {
  offset: number;
  alpha: number;
}

/**
 * Computes the 6-step smoothstep feather stops at both ends of an Automix transition
 * window (`ThinSlider.kt:205-224`, `WINDOW_FEATHER_SHARE` 0.4, 6..40px clamp).
 */
export function computeWindowFeatherStops(spanPx: number, baseAlpha = 0.5): FeatherStop[] {
  if (spanPx <= 0) return [];
  const feather = Math.min(
    spanPx / 2,
    Math.min(WINDOW_FEATHER_MAX_PX, Math.max(WINDOW_FEATHER_MIN_PX, spanPx * WINDOW_FEATHER_SHARE)),
  );
  const f = feather / spanPx;
  const ramp: FeatherStop[] = [];
  for (let step = 0; step <= WINDOW_FEATHER_STEPS; step++) {
    const t = step / WINDOW_FEATHER_STEPS;
    ramp.push({ offset: f * t, alpha: baseAlpha * t * t * (3 - 2 * t) });
  }
  for (let step = WINDOW_FEATHER_STEPS; step >= 0; step--) {
    const t = step / WINDOW_FEATHER_STEPS;
    ramp.push({ offset: 1 - f * t, alpha: baseAlpha * t * t * (3 - 2 * t) });
  }
  return ramp;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** Raised cosine squared peaking at phase 0/1 (ThinSlider.kt:425-428). */
export function beatShape(phase: number): number {
  const c = 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
  return c * c;
}

export interface Pulse {
  cover: number;
  depth: number;
  phase: number;
  locked: boolean;
  last: number;
}

/** One frame of the Automix pulse (ThinSlider.kt:370-397). */
export function stepPulse(
  p: Pulse,
  now: number,
  beat: { phase: number | null } | null,
  paused: boolean,
  reducedMotion = false,
) {
  const dt = Math.min(0.1, Math.max(0, (now - p.last) / 1000));
  p.last = now;
  if (reducedMotion) {
    p.cover = beat ? 1 : 0;
    p.depth = 0;
    return { cover: p.cover, alpha: 1, active: p.cover > 0 };
  }
  p.cover = Math.min(1, Math.max(0, p.cover + (beat ? dt : -dt) / COVER_SEC));
  p.depth = Math.min(1, Math.max(0, p.depth + (beat && !paused ? dt : -dt) / PULSE_FADE_SEC));
  if (beat?.phase != null) {
    const error = ((((beat.phase - p.phase) % 1) + 1.5) % 1) - 0.5;
    p.phase += p.locked ? error * PHASE_PULL : error;
    p.locked = true;
  } else {
    p.phase += dt / BREATH_SEC;
    if (beat) p.locked = false;
  }
  p.phase -= Math.floor(p.phase);
  const cover = ease(p.cover);
  const depth = ease(p.depth);
  const pulsed = PULSE_REST + (1 - PULSE_REST) * beatShape(p.phase);
  return { cover, alpha: 1 + (pulsed - 1) * depth, active: p.cover > 0 || p.depth > 0 };
}
