import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_SHEET_SPRING, springStep } from '@/lib/spring';
import {
  DOCK_FADE_FLOOR,
  DOCK_FADE_LEAD,
  PlayerSheetController,
  SHEET_FLICK_VELOCITY,
  SHEET_SETTLED_PX,
  decideSheetRelease,
  dockPlayerAlpha,
  dockRideProgress,
  lerpDockRect,
  resolveReleaseVelocity,
} from './PlayerSheetMotion';

describe('PlayerSheetMotion math', () => {
  it('pins the Android constants from PlayerSheetMotion.kt and NowPlayingScreen.kt', () => {
    expect(SHEET_SETTLED_PX).toBe(0.5);
    expect(SHEET_FLICK_VELOCITY).toBe(400);
    expect(DOCK_FADE_LEAD).toBe(0.15);
    expect(DOCK_FADE_FLOOR).toBeCloseTo(1 / 255, 6);
  });

  it('settles PLAYER_SHEET_SPRING (195, ζ=1) monotonically without overshoot from rest', () => {
    const travel = 844;
    let x = travel;
    let v = 0;
    for (let i = 0; i < 120; i++) {
      [x, v] = springStep(x, v, 0, 1 / 60, PLAYER_SHEET_SPRING.stiffness, PLAYER_SHEET_SPRING.damping);
      expect(x).toBeGreaterThanOrEqual(-0.001);
      expect(x).toBeLessThanOrEqual(travel);
    }
    expect(Math.abs(x)).toBeLessThanOrEqual(SHEET_SETTLED_PX);
  });

  it('decides sheet release by 400px/s flick velocity first, else half travel', () => {
    const travel = 800;
    // Fast upward flick below halfway still opens.
    expect(decideSheetRelease(700, travel, -450)).toBe(true);
    // Fast downward flick near top still dismisses.
    expect(decideSheetRelease(100, travel, 420)).toBe(false);
    // Slow release decides by half travel (400px).
    expect(decideSheetRelease(399, travel, 50)).toBe(true);
    expect(decideSheetRelease(401, travel, -50)).toBe(false);
  });

  it('picks whichever release velocity is larger in magnitude', () => {
    expect(resolveReleaseVelocity(-100, -500, 0.5)).toBe(-1000);
    expect(resolveReleaseVelocity(-1200, -300, 0.5)).toBe(-1200);
    expect(resolveReleaseVelocity(250, 0, 0)).toBe(250);
  });

  it('fades player body to DOCK_FADE_FLOOR with 15% travel left', () => {
    const travel = 1000;
    expect(dockPlayerAlpha(0, travel)).toBe(1);
    expect(dockPlayerAlpha(425, travel)).toBeCloseTo(0.5, 4);
    expect(dockPlayerAlpha(850, travel)).toBeCloseTo(DOCK_FADE_FLOOR, 6);
    expect(dockPlayerAlpha(950, travel)).toBeCloseTo(DOCK_FADE_FLOOR, 6);
    expect(dockRideProgress(500, travel)).toBe(0.5);
  });

  it('interpolates FLIP artwork rect and corner radius', () => {
    const open = { left: 30, top: 120, width: 330, height: 330, radius: 12 };
    const mini = { left: 28, top: 700, width: 40, height: 40, radius: 8 };
    expect(lerpDockRect(open, mini, 0)).toEqual(open);
    expect(lerpDockRect(open, mini, 1)).toEqual(mini);
    expect(lerpDockRect(open, mini, 0.5)).toEqual({
      left: 29,
      top: 410,
      width: 185,
      height: 185,
      radius: 10,
    });
  });
});

describe('PlayerSheetController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('snaps open and closed immediately under reduced motion', () => {
    const onShown = vi.fn();
    const ctrl = new PlayerSheetController(onShown);
    ctrl.setReducedMotion(true);

    ctrl.open();
    expect(onShown).toHaveBeenLastCalledWith(true);
    expect(ctrl.getSnapshot().phase).toBe('open');
    expect(ctrl.getSnapshot().offset).toBe(0);

    ctrl.close();
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(ctrl.getSnapshot().phase).toBe('closed');
  });

  it('opens on upward drag from closed and settles open past half travel', () => {
    const onShown = vi.fn();
    const ctrl = new PlayerSheetController(onShown);
    ctrl.setReducedMotion(true);

    // Downward drag while closed is ignored.
    ctrl.drag(20);
    expect(onShown).not.toHaveBeenCalled();

    // Upward drag opens the sheet and tracks finger 1:1.
    ctrl.setReducedMotion(false);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    ctrl.drag(-100);
    expect(onShown).toHaveBeenCalledWith(true);
    expect(ctrl.getSnapshot().phase).toBe('dragging');
    const travel = ctrl.getSnapshot().travel;
    expect(ctrl.getSnapshot().offset).toBe(travel - 100);

    // Drag past halfway, release slow -> settles open.
    ctrl.drag(-(travel / 2));
    ctrl.release(0);
    expect(ctrl.getSnapshot().phase).toBe('opening');
    ctrl.dispose();
  });

  it('waits for sheet layout registration before stepping the open spring', async () => {
    const rafCalls: number[] = [];
    vi.stubGlobal('requestAnimationFrame', () => {
      rafCalls.push(1);
      return rafCalls.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const ctrl = new PlayerSheetController();
    ctrl.open();
    // Before FullScreenPlayer mounts and registers sheetEl, spring rAF is held back.
    expect(ctrl.getSnapshot().phase).toBe('opening');
    expect(rafCalls.length).toBe(0);

    const sheetEl = { style: {} } as unknown as HTMLElement;
    const contentEl = { style: {} } as unknown as HTMLElement;
    ctrl.registerSheet(sheetEl, contentEl);
    await Promise.resolve();
    expect(rafCalls.length).toBe(1);
    ctrl.dispose();
  });
});
