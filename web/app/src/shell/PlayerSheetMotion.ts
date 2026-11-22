import { createContext, useContext } from 'react';
import { PLAYER_SHEET_SPRING, springStep } from '@/lib/spring';

/** Settle threshold in pixels (PlayerSheetMotion.kt:36). */
export const SHEET_SETTLED_PX = 0.5;

/** Velocity threshold in px/s that commits an open/close flick regardless of position (MainActivity.kt:6243). */
export const SHEET_FLICK_VELOCITY = 400;

/** Share of sheet travel remaining when the player body reaches full fade (NowPlayingScreen.kt:492). */
export const DOCK_FADE_LEAD = 0.15;

/** Minimum opacity floor while docking (NowPlayingScreen.kt:495). */
export const DOCK_FADE_FLOOR = 1 / 255;

/** Top drag-to-dismiss handle strip height (NowPlayingScreen.kt:271). */
export const DISMISS_STRIP_HEIGHT = 32;

export type SheetPhase = 'closed' | 'opening' | 'open' | 'dragging' | 'closing';

export interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

export interface SheetSnapshot {
  shown: boolean;
  phase: SheetPhase;
  offset: number;
  travel: number;
  docking: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Picks whichever release speed is faster: the instantaneous lift velocity or
 * the whole-pull average, so a quick short swipe never stalls on a zero last sample
 * (PlayerSheetMotion.kt:295-297).
 */
export function resolveReleaseVelocity(
  instantVelocity: number,
  pulledDelta: number,
  durationSec: number,
): number {
  const average = durationSec > 0 ? pulledDelta / durationSec : 0;
  return Math.abs(average) > Math.abs(instantVelocity) ? average : instantVelocity;
}

/**
 * Decides whether a released drag settles open (true) or dismisses (false):
 * a flick >= 400px/s decides on direction; otherwise past half-travel wins
 * (PlayerSheetMotion.kt:298-301, MainActivity.kt:6243).
 */
export function decideSheetRelease(
  offset: number,
  travel: number,
  velocity: number,
  flickVelocity = SHEET_FLICK_VELOCITY,
): boolean {
  const flick = Math.abs(velocity) >= flickVelocity;
  return flick ? velocity < 0 : offset < travel / 2;
}

/** Normalized docking progress: 0 = fully open, 1 = docked at mini player. */
export function dockRideProgress(offset: number, travel: number): number {
  if (travel <= 0) return 0;
  return clamp(offset / travel, 0, 1);
}

/**
 * Player surface/chrome alpha during sheet travel (NowPlayingScreen.kt:492-495):
 * reaches DOCK_FADE_FLOOR with DOCK_FADE_LEAD (15%) of travel still remaining.
 */
export function dockPlayerAlpha(offset: number, travel: number): number {
  if (travel <= 0 || offset <= 0) return 1;
  const fadeTravel = travel * (1 - DOCK_FADE_LEAD);
  if (fadeTravel <= 0) return DOCK_FADE_FLOOR;
  const t = clamp(offset / fadeTravel, 0, 1);
  return Math.max(DOCK_FADE_FLOOR, 1 - t);
}

/** Linearly interpolates the FLIP artwork rect between open sleeve and mini-player cover. */
export function lerpDockRect(openRect: DockRect, miniRect: DockRect, progress: number): DockRect {
  const p = clamp(progress, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    left: lerp(openRect.left, miniRect.left),
    top: lerp(openRect.top, miniRect.top),
    width: lerp(openRect.width, miniRect.width),
    height: lerp(openRect.height, miniRect.height),
    radius: lerp(openRect.radius, miniRect.radius),
  };
}

function measureRect(el: HTMLElement | null, radius: number, offsetAdjustment = 0): DockRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    left: r.left,
    top: r.top - offsetAdjustment,
    width: r.width,
    height: r.height,
    radius,
  };
}

/**
 * Spring-driven controller for the FullScreenPlayer fixed bottom sheet and its
 * FLIP artwork docking flight (`PlayerSheetMotion.kt`).
 *
 * Writes `transform` and `opacity` directly to DOM elements on every rAF tick so
 * 60/120Hz sheet travel and artwork flight incur zero React re-renders.
 */
export class PlayerSheetController {
  private offset = 0;
  private velocity = 0;
  private travel = 844;
  private phase: SheetPhase = 'closed';
  private shown = false;
  private reducedMotion = false;
  private raf = 0;
  private lastTick = 0;

  private pullStartAt = 0;
  private pullStartMs = 0;

  private sheetEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private miniArtEl: HTMLElement | null = null;
  private miniArtRadius = 8;
  private openArtEl: HTMLElement | null = null;
  private openArtRadius = 12;
  private dockCloneEl: HTMLElement | null = null;

  private cachedMiniRect: DockRect | null = null;
  private cachedOpenRect: DockRect | null = null;
  private artworkUrl: string | null = null;

  private listeners = new Set<() => void>();
  private onShownChange?: (shown: boolean) => void;
  private snapshot: SheetSnapshot = { shown: false, phase: 'closed', offset: 0, travel: 844, docking: false };

  constructor(onShownChange?: (shown: boolean) => void) {
    this.onShownChange = onShownChange;
  }

  setOnShownChange(cb: (shown: boolean) => void) {
    this.onShownChange = cb;
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  setArtworkUrl(url: string | null) {
    this.artworkUrl = url;
  }

  private viewportTravel(): number {
    if (typeof window !== 'undefined' && window.innerHeight > 0) {
      this.travel = window.innerHeight;
    }
    return this.travel;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SheetSnapshot => this.snapshot;

  private emit() {
    const docking = this.isDocking();
    if (
      this.snapshot.shown !== this.shown ||
      this.snapshot.phase !== this.phase ||
      this.snapshot.offset !== this.offset ||
      this.snapshot.travel !== this.travel ||
      this.snapshot.docking !== docking
    ) {
      this.snapshot = {
        shown: this.shown,
        phase: this.phase,
        offset: this.offset,
        travel: this.travel,
        docking,
      };
      for (const l of this.listeners) l();
    }
  }

  private isDocking(): boolean {
    return (
      !this.reducedMotion &&
      this.shown &&
      this.offset > 0.5 &&
      this.offset < this.travel - 0.5 &&
      this.cachedMiniRect !== null &&
      this.cachedOpenRect !== null &&
      this.artworkUrl !== null
    );
  }

  registerSheet(el: HTMLElement | null, contentEl: HTMLElement | null) {
    this.sheetEl = el;
    this.contentEl = contentEl;
    this.applyDom();
  }

  registerMiniArt(el: HTMLElement | null, radius = 8) {
    this.miniArtEl = el;
    this.miniArtRadius = radius;
    if (el) {
      const r = measureRect(el, radius);
      if (r) this.cachedMiniRect = r;
    }
    this.applyDom();
  }

  registerOpenArt(el: HTMLElement | null, radius = 12) {
    this.openArtEl = el;
    this.openArtRadius = radius;
    if (el) {
      const r = measureRect(el, radius, this.offset);
      if (r) this.cachedOpenRect = r;
    }
    this.applyDom();
  }

  registerDockClone(el: HTMLElement | null) {
    this.dockCloneEl = el;
    this.applyDom();
  }

  private refreshRects() {
    if (this.miniArtEl) {
      const mini = measureRect(this.miniArtEl, this.miniArtRadius);
      if (mini) this.cachedMiniRect = mini;
    }
    if (this.openArtEl) {
      const open = measureRect(this.openArtEl, this.openArtRadius, this.offset);
      if (open) this.cachedOpenRect = open;
    }
  }

  private setShown(next: boolean) {
    if (this.shown === next) return;
    this.shown = next;
    this.onShownChange?.(next);
  }

  private stopSpring() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /**
   * Opens the player sheet on PLAYER_SHEET_SPRING (195, ζ=1), or reverses an in-flight
   * close from its current offset (PlayerSheetMotion.kt:172-199).
   */
  open() {
    const travel = this.viewportTravel();
    if (this.shown) {
      if (this.phase === 'closing' || this.phase === 'opening' || this.phase === 'dragging') {
        this.stopSpring();
        this.phase = 'opening';
        this.applyDom();
        if (this.reducedMotion) {
          this.finishOpen();
        } else {
          this.animateTo(0);
        }
      }
      return;
    }

    this.refreshRects();
    this.stopSpring();
    if (this.reducedMotion) {
      this.offset = 0;
      this.velocity = 0;
      this.phase = 'open';
      this.setShown(true);
      this.applyDom();
      this.emit();
      return;
    }

    this.offset = travel;
    this.velocity = 0;
    this.phase = 'opening';
    this.setShown(true);
    this.applyDom();
    this.emit();
    this.animateTo(0);
  }

  /**
   * Closes the sheet from its current position to full travel (PlayerSheetMotion.kt:256-272).
   * Pointer pass-through begins immediately so touches hit the app beneath.
   */
  close(initialVelocity = 0) {
    if (!this.shown || this.phase === 'closing') return;
    const travel = this.viewportTravel();
    this.refreshRects();
    this.stopSpring();

    if (this.reducedMotion) {
      this.finishClose();
      return;
    }

    this.phase = 'closing';
    this.velocity = Math.max(0, initialVelocity);
    this.applyDom();
    this.emit();
    this.animateTo(travel);
  }

  /** Immediate tear-down without spring (e.g., track queue ended or route changed). */
  dismissImmediately() {
    this.stopSpring();
    this.offset = this.viewportTravel();
    this.velocity = 0;
    this.phase = 'closed';
    this.cachedOpenRect = null;
    this.setShown(false);
    this.applyDom();
    this.emit();
  }

  /**
   * 1:1 finger drag (`deltaY < 0` pulls upward from closed; `deltaY > 0` pulls downward
   * from open) (PlayerSheetMotion.kt:274-288).
   */
  drag(deltaY: number) {
    const travel = this.viewportTravel();
    if (!this.shown) {
      if (deltaY >= 0) return;
      this.refreshRects();
      this.stopSpring();
      this.offset = travel;
      this.velocity = 0;
      this.pullStartAt = travel;
      this.pullStartMs = performance.now();
      this.phase = 'dragging';
      this.setShown(true);
    } else if (this.phase !== 'dragging') {
      this.refreshRects();
      this.stopSpring();
      this.pullStartAt = this.offset;
      this.pullStartMs = performance.now();
      this.phase = 'dragging';
    }

    this.offset = clamp(this.offset + deltaY, 0, travel);
    this.applyDom();
    this.emit();
  }

  /**
   * Releases an active drag and hands velocity into PLAYER_SHEET_SPRING
   * (PlayerSheetMotion.kt:290-318).
   */
  release(velocityY: number) {
    if (this.phase !== 'dragging') return;
    const travel = this.viewportTravel();
    const durationSec = (performance.now() - this.pullStartMs) / 1000;
    const speed = resolveReleaseVelocity(velocityY, this.offset - this.pullStartAt, durationSec);
    const shouldOpen = decideSheetRelease(this.offset, travel, speed);

    if (this.reducedMotion) {
      if (shouldOpen) this.finishOpen();
      else this.finishClose();
      return;
    }

    this.velocity = speed;
    this.phase = shouldOpen ? 'opening' : 'closing';
    this.applyDom();
    this.emit();
    this.animateTo(shouldOpen ? 0 : travel);
  }

  private animateTo(target: number) {
    this.stopSpring();
    this.lastTick = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTick) / 1000));
      this.lastTick = now;

      // Refresh open/mini rects once the sheet has painted at least one frame.
      if (!this.cachedOpenRect && this.openArtEl) {
        this.cachedOpenRect = measureRect(this.openArtEl, this.openArtRadius, this.offset);
      }

      const [nextX, nextV] = springStep(
        this.offset,
        this.velocity,
        target,
        dt,
        PLAYER_SHEET_SPRING.stiffness,
        PLAYER_SHEET_SPRING.damping,
      );
      this.offset = clamp(nextX, 0, this.travel);
      this.velocity = nextV;
      this.applyDom();

      const settled =
        Math.abs(this.offset - target) <= SHEET_SETTLED_PX &&
        Math.abs(this.velocity) <= 8;

      if (settled) {
        this.raf = 0;
        if (target === 0) this.finishOpen();
        else this.finishClose();
        return;
      }

      this.raf = requestAnimationFrame(step);
    };

    this.raf = requestAnimationFrame(step);
  }

  private finishOpen() {
    this.stopSpring();
    this.offset = 0;
    this.velocity = 0;
    this.phase = 'open';
    this.applyDom();
    this.emit();
  }

  private finishClose() {
    this.stopSpring();
    this.offset = this.travel;
    this.velocity = 0;
    this.phase = 'closed';
    this.cachedOpenRect = null;
    this.setShown(false);
    this.applyDom();
    this.emit();
  }

  private applyDom() {
    const travel = this.travel;
    if (this.sheetEl) {
      this.sheetEl.style.transform = `translate3d(0, ${this.offset}px, 0)`;
      // Let touches fall through immediately once closing (PlayerSheetMotion.kt:239-246).
      this.sheetEl.style.pointerEvents = this.phase === 'closing' ? 'none' : '';
    }

    const alpha = this.reducedMotion ? 1 : dockPlayerAlpha(this.offset, travel);
    if (this.contentEl) {
      this.contentEl.style.opacity = this.phase === 'open' ? '' : String(alpha);
    }

    const docking = this.isDocking();
    if (this.miniArtEl) {
      this.miniArtEl.style.opacity = docking ? '0' : '';
    }
    if (this.openArtEl) {
      this.openArtEl.style.opacity = docking ? '0' : '';
    }
    if (this.dockCloneEl) {
      if (docking && this.cachedOpenRect && this.cachedMiniRect) {
        const progress = dockRideProgress(this.offset, travel);
        const rect = lerpDockRect(this.cachedOpenRect, this.cachedMiniRect, progress);
        this.dockCloneEl.style.display = 'block';
        this.dockCloneEl.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
        this.dockCloneEl.style.width = `${rect.width}px`;
        this.dockCloneEl.style.height = `${rect.height}px`;
        this.dockCloneEl.style.borderRadius = `${rect.radius}px`;
      } else {
        this.dockCloneEl.style.display = 'none';
      }
    }
  }

  dispose() {
    this.stopSpring();
    this.listeners.clear();
  }
}

export const PlayerSheetContext = createContext<PlayerSheetController | null>(null);

export function usePlayerSheet(): PlayerSheetController | null {
  return useContext(PlayerSheetContext);
}
