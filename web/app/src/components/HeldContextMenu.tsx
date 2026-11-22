import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '@/lib/motionPrefs';
import { HELD_MENU_LIFT_SPRING, springStep } from '@/lib/spring';
import { IOS_MENU_WIDTH } from './Menu';

export const HELD_PLATE_RADIUS = 20;
export const HELD_PLATE_PADDING = 8;
export const HELD_MARGIN = 12;
export const HELD_GAP = 10;
export const HELD_LONG_PRESS_MS = 420;
export const HELD_MOVE_TOLERANCE_PX = 8;

export interface HeldBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HeldMenuLayout {
  plateW: number;
  plateH: number;
  liftScale: number;
  cardX: number;
  cardY: number;
  fromDx: number;
  fromDy: number;
  menuWidth: number;
  menuX: number;
  menuY: number;
  menuBelow: boolean;
  alignEnd: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** FastOutSlowInEasing approximation matching Compose `FastOutSlowInEasing` (cubic-bezier(0.4, 0, 0.2, 1)). */
function fastOutSlowIn(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/**
 * Pure geometry solver (`HeldContextMenu.kt:238-307`, spec §4.9):
 * fits the lifted plate inside 12px screen margins, places the 256px menu
 * 10px below by preference (or above when near the bottom, climbing only when
 * neither fits), and computes the opposite-corner transform origin and lift
 * translation offset back to the row's resting bounds.
 */
export function computeHeldMenuLayout(
  bounds: HeldBounds,
  viewport: { width: number; height: number },
  menuHeight: number,
): HeldMenuLayout {
  const width = viewport.width;
  const height = viewport.height;
  const top = 8;
  const bottom = height - 8;

  const itemCenterX = bounds.left + bounds.width / 2;
  const itemCenterY = bounds.top + bounds.height / 2;

  const plateW = Math.max(1, Math.round(bounds.width) + HELD_PLATE_PADDING * 2);
  const plateH = Math.max(1, Math.round(bounds.height) + HELD_PLATE_PADDING * 2);
  const liftScale = Math.min(1, Math.max(0.2, (width - HELD_MARGIN * 2) / plateW));
  const visualW = plateW * liftScale;
  const visualH = plateH * liftScale;

  const menuWidth = Math.max(0, Math.min(IOS_MENU_WIDTH, width - HELD_MARGIN * 2));
  const visualLeft = clamp(itemCenterX - visualW / 2, HELD_MARGIN, width - HELD_MARGIN - visualW);
  let visualTop = clamp(itemCenterY - visualH / 2, top, bottom - visualH);

  let menuBelow: boolean;
  if (visualTop + visualH + HELD_GAP + menuHeight <= bottom) {
    menuBelow = true;
  } else if (visualTop - HELD_GAP - menuHeight >= top) {
    menuBelow = false;
  } else {
    menuBelow = true;
    visualTop = Math.max(top, bottom - menuHeight - HELD_GAP - visualH);
  }

  const visualCenterX = visualLeft + visualW / 2;
  const visualCenterY = visualTop + visualH / 2;

  const alignEnd = visualCenterX > width / 2;
  const menuX = Math.round(
    clamp(alignEnd ? visualLeft + visualW - menuWidth : visualLeft, HELD_MARGIN, width - HELD_MARGIN - menuWidth),
  );
  const menuY = Math.round(menuBelow ? visualTop + visualH + HELD_GAP : visualTop - HELD_GAP - menuHeight);

  const cardX = Math.round(visualCenterX - plateW / 2);
  const cardY = Math.round(visualCenterY - plateH / 2);
  const fromDx = itemCenterX - visualCenterX;
  const fromDy = itemCenterY - visualCenterY;

  return {
    plateW,
    plateH,
    liftScale,
    cardX,
    cardY,
    fromDx,
    fromDy,
    menuWidth,
    menuX,
    menuY,
    menuBelow,
    alignEnd,
  };
}

export interface HeldContextMenuProps {
  open: boolean;
  bounds: HeldBounds;
  onDismiss: () => void;
  onExited: () => void;
  label: string;
  /** Preview of the held item rendered inside the lifted 20px plate (without trailing ⋮). */
  preview: ReactNode;
  /** Menu rows/quick actions rendered inside the matching frosted menu panel. */
  actions: ReactNode;
}

/**
 * Android-ported `HeldContextMenu` (`HeldContextMenu.kt:83-348`, spec §3.7, §4.9):
 * lifts the held row onto a frosted 20px plate on a ζ 0.72 / 420 spring,
 * blurs the page behind, and grows the 256px menu from the corner nearest
 * the item. Exits over 230ms (or 140ms/110ms linear fades under reduced motion).
 */
export function HeldContextMenu({
  open,
  bounds,
  onDismiss,
  onExited,
  label,
  preview,
  actions,
}: HeldContextMenuProps) {
  const reducedMotion = useReducedMotion();
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [layout, setLayout] = useState<HeldMenuLayout | null>(null);
  const animRef = useRef({ progress: 0, velocity: 0, raf: 0 });
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  const paintProgress = useCallback(
    (p: number, currentLayout: HeldMenuLayout) => {
      const backdrop = backdropRef.current;
      const card = cardRef.current;
      const menu = menuRef.current;
      const clamped = clamp(p, 0, 1);

      if (backdrop) {
        backdrop.style.opacity = String(clamped);
      }

      if (card) {
        if (reducedMotion) {
          card.style.transform = `scale(${currentLayout.liftScale})`;
          card.style.opacity = String(clamped);
        } else {
          const scale = lerp(1, currentLayout.liftScale, p);
          const tx = lerp(currentLayout.fromDx, 0, p);
          const ty = lerp(currentLayout.fromDy, 0, p);
          card.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
          card.style.opacity = String(clamp(p * 3, 0, 1));
        }
      }

      if (menu) {
        menu.style.opacity = String(clamp((p - 0.1) / 0.9, 0, 1));
        if (reducedMotion) {
          menu.style.transform = 'none';
        } else {
          const scale = lerp(0.55, 1, p);
          const tx = lerp(currentLayout.fromDx, 0, p);
          const ty = lerp(currentLayout.fromDy, 0, p);
          menu.style.transformOrigin = `${currentLayout.alignEnd ? '100%' : '0%'} ${currentLayout.menuBelow ? '0%' : '100%'}`;
          menu.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
        }
      }
    },
    [reducedMotion],
  );

  useLayoutEffect(() => {
    const menuEl = menuRef.current;
    const menuH = menuEl ? menuEl.scrollHeight : 180;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const maxMenuH = Math.max(120, viewport.height - 16 - (Math.round(bounds.height) + HELD_PLATE_PADDING * 2) - HELD_GAP);
    const next = computeHeldMenuLayout(bounds, viewport, Math.min(menuH, maxMenuH));
    setLayout(next);
  }, [bounds]);

  useEffect(() => {
    if (!layout) return;
    const state = animRef.current;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }

    if (open) {
      if (reducedMotion) {
        const startVal = state.progress;
        const startTime = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - startTime) / 140);
          state.progress = lerp(startVal, 1, t);
          paintProgress(state.progress, layout);
          if (t < 1) {
            state.raf = requestAnimationFrame(tick);
          } else {
            state.raf = 0;
          }
        };
        state.raf = requestAnimationFrame(tick);
      } else {
        let last = 0;
        const tick = (now: number) => {
          const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
          last = now;
          const [nextP, nextV] = springStep(
            state.progress,
            state.velocity,
            1,
            dt,
            HELD_MENU_LIFT_SPRING.stiffness,
            HELD_MENU_LIFT_SPRING.damping,
          );
          state.progress = nextP;
          state.velocity = nextV;
          const settled = Math.abs(1 - nextP) < 0.002 && Math.abs(nextV) < 0.002;
          if (settled) {
            state.progress = 1;
            state.velocity = 0;
          }
          paintProgress(state.progress, layout);
          if (!settled) {
            state.raf = requestAnimationFrame(tick);
          } else {
            state.raf = 0;
          }
        };
        state.raf = requestAnimationFrame(tick);
      }
    } else {
      const startVal = state.progress;
      const duration = reducedMotion ? 110 : 230;
      const startTime = performance.now();
      const tick = (now: number) => {
        const raw = Math.min(1, (now - startTime) / duration);
        const eased = reducedMotion ? raw : fastOutSlowIn(raw);
        state.progress = lerp(startVal, 0, eased);
        paintProgress(state.progress, layout);
        if (raw < 1) {
          state.raf = requestAnimationFrame(tick);
        } else {
          state.raf = 0;
          exitedRef.current();
        }
      };
      state.raf = requestAnimationFrame(tick);
    }

    return () => {
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
    };
  }, [open, layout, reducedMotion, paintProgress]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        const next = index < 0 ? 0 : index + delta;
        items[(next + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onDismiss]);

  return createPortal(
    <div
      className={`fixed inset-0 z-(--z-contextual-menus) ${open ? '' : 'pointer-events-none'}`}
      role="presentation"
    >
      {/* Blurred scrim pushing the page back */}
      <div
        ref={backdropRef}
        className="fixed inset-0 bg-(--bc-held-scrim) [backdrop-filter:var(--bc-frost-backdrop)] will-change-opacity"
        style={{ opacity: 0 }}
        onClick={open ? onDismiss : undefined}
        aria-hidden="true"
      />

      {/* Lifted item plate (20px continuous corner, 8px inner padding) */}
      <div
        ref={cardRef}
        className={`bc-continuous fixed overflow-hidden rounded-(--bc-radius-held-card) border-[0.5px] border-(--bc-held-plate-rim) bg-(--bc-held-plate-bg) p-2 [backdrop-filter:var(--bc-frost-backdrop)] will-change-[transform,opacity] ${
          reducedMotion ? '' : 'shadow-(--bc-shadow-held-card)'
        }`}
        style={
          layout
            ? {
                left: layout.cardX,
                top: layout.cardY,
                width: layout.plateW,
                height: layout.plateH,
                opacity: 0,
              }
            : { visibility: 'hidden' }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="size-full overflow-hidden rounded-[12px]">{preview}</div>
      </div>

      {/* Matching frosted menu panel hanging 10px off the lifted plate */}
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className="bc-continuous fixed overflow-x-hidden overflow-y-auto rounded-(--bc-radius-menu) border-[0.5px] border-(--bc-held-plate-rim) bg-(--bc-held-plate-bg) py-2 text-(--bc-on-surface) [backdrop-filter:var(--bc-frost-backdrop)] [--bc-menu-label:var(--bc-on-surface)] [--bc-menu-label2:var(--bc-on-surface-variant)] shadow-(--bc-shadow-menu) will-change-[transform,opacity]"
        style={
          layout
            ? {
                left: layout.menuX,
                top: layout.menuY,
                width: layout.menuWidth,
                maxHeight: Math.max(120, window.innerHeight - 16 - layout.plateH - HELD_GAP),
                opacity: 0,
              }
            : { visibility: 'hidden', width: IOS_MENU_WIDTH }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </div>
    </div>,
    document.body,
  );
}
