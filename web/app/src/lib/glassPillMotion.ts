import { springStep } from './spring';

/** How many pixels wider/taller than its resting slot the pill inflates while lifted (`GlassSelectionPill.kt:55`). */
export const PILL_GROW_PX = 9;

const TRAVEL_STIFFNESS = 280;
const TRAVEL_DAMPING = 31.4;

/** ζ 0.6 across, ζ 0.7 down so width overshoots slightly further (`GlassSelectionPill.kt:364-366`). */
const LIFT_STIFFNESS = 250;
const LIFT_DAMPING_X = 19.0;
const LIFT_DAMPING_Y = 22.1;

/** Critically damped & ~4× stiffer: glass material turns on long before size settles (`:369-370`). */
const MATERIAL_STIFFNESS = 1000;
const MATERIAL_DAMPING = 63.3;

const HANDOVER_START = 0.92;
const HANDOVER_TAU = 0.09;
const GLASS_RETURN_TAU = 0.05;
const FOLLOW_TAU = 0.05;
const SIGN_TAU = 0.25;

const SAMPLE_WINDOW = 0.3;
const SENSITIVITY = 0.00007;
const MAX_DEFORMATION = 0.12;
const RESPONSE_TIME = 0.18;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function stepLift(
  x: number,
  vel: number,
  target: number,
  dt: number,
  stiffness: number,
  damping: number,
): [number, number] {
  const [nx, nv] = springStep(x, vel, target, dt, stiffness, damping);
  if (Math.abs(nx - target) < 0.0008 && Math.abs(nv) < 0.01) return [target, 0];
  return [nx, nv];
}

class PillSquashModel {
  private history: Array<{ x: number; t: number }> = [];
  isTracking = false;
  private value = 0;

  start(): void {
    this.history = [];
    this.value = 0;
    this.isTracking = true;
  }

  stop(): void {
    this.isTracking = false;
    this.history = [];
    this.value = 0;
  }

  track(x: number, now: number, dt: number): number {
    if (!this.isTracking) return this.value;
    this.history.push({ x, t: now });
    const cutoff = now - SAMPLE_WINDOW;
    while (this.history.length > 0 && this.history[0]!.t < cutoff) {
      this.history.shift();
    }
    const raw = clamp(this.averageAcceleration() * SENSITIVITY, -MAX_DEFORMATION, MAX_DEFORMATION);
    const ease = clamp(dt / RESPONSE_TIME, 0, 1);
    this.value += (raw - this.value) * ease;
    return this.value;
  }

  private averageAcceleration(): number {
    if (this.history.length < 3) return 0;
    const velocities: Array<{ v: number; t: number }> = [];
    for (let i = 1; i < this.history.length; i++) {
      const a = this.history[i - 1]!;
      const b = this.history[i]!;
      const dt = b.t - a.t;
      if (dt <= 0) continue;
      velocities.push({ v: (b.x - a.x) / dt, t: (a.t + b.t) / 2 });
    }
    if (velocities.length < 2) return 0;
    let total = 0;
    let count = 0;
    for (let i = 1; i < velocities.length; i++) {
      const a = velocities[i - 1]!;
      const b = velocities[i]!;
      const dt = b.t - a.t;
      if (dt <= 0) continue;
      total += (b.v - a.v) / dt;
      count++;
    }
    return count === 0 ? 0 : total / count;
  }
}

/**
 * Android-ported `GlassPillMotion` (`GlassSelectionPill.kt:84-413`, spec §4.3):
 * drives the floating tab pill's travel spring (`280/31.4`), dual-axis lift
 * springs (`250/19.0` & `250/22.1`), critical material spring (`1000/63.3`),
 * acceleration squash (`±12%`), and exponential glass→flat handover (`τ 0.09/0.05`).
 */
export class GlassPillMotion {
  position: number;
  liftX = 0;
  liftY = 0;
  material = 0;
  deviation = 0;
  glassPresence = 0;
  isFlat = true;
  index: number;
  stepPx = 0;
  reduceMotion = false;

  private travelPos: number;
  private travelVel = 0;
  private travelTarget: number;
  private travelFrom: number;
  private travelActive = false;

  private lifted = false;
  private liftXPos = 0;
  private liftXVel = 0;
  private liftYPos = 0;
  private liftYVel = 0;
  private liftPos = 0;
  private liftVel = 0;

  private dragging = false;
  private dragTarget = 0;
  private dragFollow = 0;

  private travelSign = 0;
  private travelSignEased = 0;
  private handover = 1;
  private squash = 0;
  private readonly squashModel = new PillSquashModel();

  constructor(initialIndex: number) {
    this.index = initialIndex;
    this.position = initialIndex;
    this.travelPos = initialIndex;
    this.travelTarget = initialIndex;
    this.travelFrom = initialIndex;
  }

  /** Lifts the pill in place on pointer-down before travel/drag decides. */
  press(): void {
    if (this.reduceMotion) return;
    this.lifted = true;
    this.isFlat = false;
  }

  /** Releases a stationary press when no tab change or drag occurred. */
  releasePress(): void {
    if (!this.travelActive && !this.dragging) {
      this.lifted = false;
    }
  }

  animateTo(next: number): void {
    if (next === this.index) return;
    if (this.reduceMotion) {
      this.snapTo(next);
      return;
    }
    this.index = next;
    this.travelActive = true;
    this.lifted = true;
    this.travelFrom = this.travelPos;
    this.travelTarget = next;
    const span = this.travelTarget - this.travelFrom;
    this.travelSign = Math.abs(span) < 1e-6 ? 0 : Math.sign(span);
    this.isFlat = false;
  }

  snapTo(target: number): void {
    this.index = target;
    this.travelPos = target;
    this.travelTarget = target;
    this.travelFrom = target;
    this.travelVel = 0;
    this.travelActive = false;
    this.dragging = false;
    this.lifted = false;
    this.liftXPos = 0;
    this.liftXVel = 0;
    this.liftYPos = 0;
    this.liftYVel = 0;
    this.liftPos = 0;
    this.liftVel = 0;
    this.handover = 1;
    this.squash = 0;
    this.squashModel.stop();
    this.travelSign = 0;
    this.travelSignEased = 0;
    this.publish();
    this.isFlat = true;
  }

  startDrag(): void {
    this.dragging = true;
    this.travelActive = false;
    this.lifted = !this.reduceMotion;
    this.travelSign = 0;
    this.dragFollow = this.travelPos;
    this.dragTarget = this.travelPos;
    this.travelVel = 0;
    this.isFlat = false;
  }

  dragTo(position: number): void {
    if (this.dragging) this.dragTarget = position;
  }

  release(next: number): void {
    if (!this.dragging) return;
    const from = this.dragFollow;
    this.dragging = false;
    this.index = next;
    if (this.reduceMotion) {
      this.snapTo(next);
      return;
    }
    this.travelActive = true;
    this.travelPos = from;
    this.travelVel = 0;
    this.travelFrom = from;
    this.travelTarget = next;
    const span = this.travelTarget - this.travelFrom;
    this.travelSign = Math.abs(span) < 1e-6 ? 0 : Math.sign(span);
  }

  /** Advances one frame; returns `true` while motion remains, `false` when settled. */
  step(dt: number, nowSec: number): boolean {
    if (this.reduceMotion) {
      this.snapTo(this.index);
      return false;
    }

    let travelSettled = true;
    if (this.travelActive) {
      const [nx, nv] = springStep(this.travelPos, this.travelVel, this.travelTarget, dt, TRAVEL_STIFFNESS, TRAVEL_DAMPING);
      this.travelPos = nx;
      this.travelVel = nv;
      travelSettled = Math.abs(this.travelPos - this.travelTarget) < 0.003 && Math.abs(this.travelVel) < 0.05;
      if (travelSettled) {
        this.travelPos = this.travelTarget;
        this.travelVel = 0;
      }
    }

    if (this.dragging) {
      this.dragFollow += (this.dragTarget - this.dragFollow) * (1 - Math.exp(-dt / FOLLOW_TAU));
    }

    if (!this.dragging && this.travelActive && (travelSettled || this.travelProgress() >= HANDOVER_START)) {
      this.lifted = false;
    }

    const liftTarget = this.lifted ? 1 : 0;
    [this.liftXPos, this.liftXVel] = stepLift(this.liftXPos, this.liftXVel, liftTarget, dt, LIFT_STIFFNESS, LIFT_DAMPING_X);
    [this.liftYPos, this.liftYVel] = stepLift(this.liftYPos, this.liftYVel, liftTarget, dt, LIFT_STIFFNESS, LIFT_DAMPING_Y);
    [this.liftPos, this.liftVel] = stepLift(this.liftPos, this.liftVel, liftTarget, dt, MATERIAL_STIFFNESS, MATERIAL_DAMPING);
    const liftSettled = !this.lifted && this.liftXPos === 0 && this.liftYPos === 0 && this.liftPos === 0;

    if (this.travelActive && travelSettled && liftSettled && !this.dragging) {
      this.travelActive = false;
    }

    const frac = this.dragging ? this.dragFollow : this.travelPos;
    if (this.stepPx > 0) {
      if (!this.squashModel.isTracking) this.squashModel.start();
      this.squash = this.squashModel.track(frac * this.stepPx, nowSec, dt);
      if (this.travelSignEased === 0) {
        this.travelSignEased = this.travelSign;
      } else if (this.travelSignEased !== this.travelSign) {
        this.travelSignEased += (this.travelSign - this.travelSignEased) * (1 - Math.exp(-dt / SIGN_TAU));
        if (Math.abs(this.travelSign - this.travelSignEased) < 0.01) this.travelSignEased = this.travelSign;
      }
      const key = this.travelSignEased;
      if (key !== 0) {
        this.squash = this.squash * (1 - Math.abs(key)) - key * Math.abs(this.squash);
      }
    }

    const handoverTarget = this.lifted ? 0 : 1;
    const tau = handoverTarget > this.handover ? HANDOVER_TAU : GLASS_RETURN_TAU;
    this.handover += (handoverTarget - this.handover) * (1 - Math.exp(-dt / tau));
    if (Math.abs(handoverTarget - this.handover) < 0.002) this.handover = handoverTarget;

    const settled =
      !this.travelActive &&
      !this.dragging &&
      !this.lifted &&
      liftSettled &&
      Math.abs(this.squash) < 0.0005 &&
      this.handover >= 1;

    if (settled) {
      this.squashModel.stop();
      this.squash = 0;
      this.travelSign = 0;
      this.travelSignEased = 0;
    }
    this.publish();
    this.isFlat = settled;
    return !settled;
  }

  /** Rim & contact shadow fade out first on landing (`GlassSelectionPill.kt:555,585`). */
  rimAlpha(): number {
    const rim = clamp((this.glassPresence - 0.1) / 0.9, 0, 1);
    return this.material * rim;
  }

  private travelProgress(): number {
    const span = Math.abs(this.travelTarget - this.travelFrom);
    if (span < 1e-6) return 1;
    return clamp(1 - Math.abs(this.travelTarget - this.travelPos) / span, 0, 1);
  }

  private publish(): void {
    this.position = this.dragging ? this.dragFollow : this.travelPos;
    this.liftX = this.liftXPos;
    this.liftY = this.liftYPos;
    this.material = clamp(this.liftPos, 0, 1);
    this.deviation = this.squash;
    this.glassPresence = clamp(1 - this.handover, 0, 1);
  }
}
