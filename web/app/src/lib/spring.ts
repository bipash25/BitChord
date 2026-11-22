/**
 * Semi-implicit Euler spring integrator matching Android's GlassSelectionPill.kt:379-397.
 * Stepped in 1/240s substeps so spring behaviour stays frame-rate independent and
 * a long frame or tab switch never blows up the integration.
 */
export interface SpringSpec {
  readonly stiffness: number;
  readonly damping: number;
}

/** Converts a Compose-style damping ratio ζ and stiffness into viscous damping. */
export function dampingFromRatio(stiffness: number, dampingRatio: number): number {
  return 2 * dampingRatio * Math.sqrt(stiffness);
}

/** Plain frosted tab bar pill & glyph pop (FloatingBottomBar.kt:147 — ζ 0.72, stiffness 320). */
export const TAB_PILL_SPRING: SpringSpec = {
  stiffness: 320,
  damping: dampingFromRatio(320, 0.72),
};

/** Liquid-glass selection pill travel (GlassSelectionPill.kt:360-361 — stiffness 280, damping 31.4). */
export const GLASS_PILL_SPRING: SpringSpec = {
  stiffness: 280,
  damping: 31.4,
};

/** Tab pill travel deformation (FloatingBottomBar.kt:163, :174). */
export const TAB_PILL_STRETCH = 0.16;
export const TAB_PILL_SQUASH = 0.5;

/** Player sheet open/close spring (PlayerSheetMotion.kt:33-36 — stiffness 195, ζ 1). */
export const PLAYER_SHEET_SPRING: SpringSpec = {
  stiffness: 195,
  damping: dampingFromRatio(195, 1),
};

/** Mini-player pull-release settle spring (MiniPlayer.kt:303-311 — stiffness 400, ζ 0.65). */
export const MINI_PLAYER_SETTLE_SPRING: SpringSpec = {
  stiffness: 400,
  damping: dampingFromRatio(400, 0.65),
};

/** iOS 26 switch thumb travel spring (IosSwitch.kt:75 — ζ 0.78, stiffness 700). */
export const IOS_SWITCH_THUMB_SPRING: SpringSpec = {
  stiffness: 700,
  damping: dampingFromRatio(700, 0.78),
};

/** iOS 26 switch press stretch spring (IosSwitch.kt:80 — ζ 0.7, stiffness 900). */
export const IOS_SWITCH_STRETCH_SPRING: SpringSpec = {
  stiffness: 900,
  damping: dampingFromRatio(900, 0.7),
};

/** iOS menu popover open spring (IosMenu.kt:482 — critically damped, stiffness 600). */
export const IOS_MENU_OPEN_SPRING: SpringSpec = {
  stiffness: 600,
  damping: dampingFromRatio(600, 1),
};

/** Held context menu lift spring (HeldContextMenu.kt:121 — ζ 0.72, stiffness 420). */
export const HELD_MENU_LIFT_SPRING: SpringSpec = {
  stiffness: 420,
  damping: dampingFromRatio(420, 0.72),
};

const SUBSTEP = 1 / 240;

export function springStep(
  x: number,
  v: number,
  target: number,
  dt: number,
  stiffness: number,
  damping: number,
): [number, number] {
  let t = dt;
  let px = x;
  let pv = v;
  while (t > 0) {
    const step = Math.min(t, SUBSTEP);
    pv += (-stiffness * (px - target) - damping * pv) * step;
    px += pv * step;
    t -= step;
  }
  return [px, pv];
}
