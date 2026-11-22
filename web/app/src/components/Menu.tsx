import { Check } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '@/lib/motionPrefs';
import { IOS_MENU_OPEN_SPRING, springStep } from '@/lib/spring';

export type MenuPlacement = 'above-start' | 'above-end' | 'below-end';

export const IOS_MENU_WIDTH = 256;
export const IOS_MENU_MARGIN = 14;
export const IOS_MENU_GAP = 6;

export interface MenuRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

export interface ComputedMenuLayout {
  style: React.CSSProperties;
  originX: '0%' | '100%';
  originY: '0%' | '100%';
}

/**
 * Pure anchor-corner positioning helper (`IosMenu.kt:568-587`, spec §4.9):
 * aligns trailing edge to the trigger (or leading edge for `above-start`),
 * clamps within 14px viewport margins, and sets `transformOrigin` to the
 * corner nearest the button so the panel grows out of its anchor.
 */
export function computeMenuLayout(
  rect: MenuRect,
  viewport: { width: number; height: number },
  placement: MenuPlacement,
  matchWidth?: boolean,
): ComputedMenuLayout {
  const maxWidth = Math.max(0, viewport.width - IOS_MENU_MARGIN * 2);
  const width = matchWidth ? Math.min(maxWidth, Math.max(IOS_MENU_WIDTH, rect.width)) : Math.min(maxWidth, IOS_MENU_WIDTH);
  const anchorCenterY = (rect.top + rect.bottom) / 2;
  const openAbove =
    placement === 'above-start' ||
    placement === 'above-end' ||
    (anchorCenterY >= viewport.height / 2 && rect.top > viewport.height - rect.bottom);

  const originX: '0%' | '100%' = placement === 'above-start' ? '0%' : '100%';
  const originY: '0%' | '100%' = openAbove ? '100%' : '0%';

  const left =
    placement === 'above-start'
      ? Math.min(Math.max(IOS_MENU_MARGIN, rect.left), Math.max(IOS_MENU_MARGIN, viewport.width - IOS_MENU_MARGIN - width))
      : Math.min(
          Math.max(IOS_MENU_MARGIN, rect.right - width),
          Math.max(IOS_MENU_MARGIN, viewport.width - IOS_MENU_MARGIN - width),
        );

  const verticalStyle: React.CSSProperties = openAbove
    ? {
        bottom: Math.max(IOS_MENU_MARGIN, viewport.height - rect.top + IOS_MENU_GAP),
        maxHeight: Math.max(120, rect.top - IOS_MENU_MARGIN - IOS_MENU_GAP),
      }
    : {
        top: Math.max(IOS_MENU_MARGIN, rect.bottom + IOS_MENU_GAP),
        maxHeight: Math.max(120, viewport.height - rect.bottom - IOS_MENU_MARGIN - IOS_MENU_GAP),
      };

  return {
    style: {
      left,
      width,
      ...verticalStyle,
      transformOrigin: `${originX} ${originY}`,
    },
    originX,
    originY,
  };
}

interface MenuProps {
  /** The element the menu opens from. */
  anchor: HTMLElement;
  placement?: MenuPlacement;
  onClose: () => void;
  label: string;
  /** At least as wide as the anchor (a pop-up button's menu). */
  matchWidth?: boolean;
  children: ReactNode;
}

/**
 * Android-ported `IosMenuPopover` (`IosMenu.kt:142-612`, spec §3.7, §4.9):
 * 256px frosted panel with 30px continuous corners, fixed menu palette, 44px
 * rows, 66px quick-action tiles, and an anchor-corner spring entrance
 * (stiffness 600, critically damped; 120ms linear fade under reduced motion).
 */
export function Menu({ anchor, placement = 'below-end', onClose, label, matchWidth, children }: MenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [layout, setLayout] = useState<ComputedMenuLayout | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    setLayout(
      computeMenuLayout(
        { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        matchWidth,
      ),
    );
  }, [anchor, placement, matchWidth]);

  useEffect(() => {
    if (!layout) return;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel) return;

    if (reducedMotion) {
      panel.style.opacity = '0';
      panel.style.transform = 'none';
      if (scrim) scrim.style.opacity = '0';
      const start = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 120);
        panel.style.opacity = String(p);
        if (scrim) scrim.style.opacity = String(p);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    let progress = 0;
    let velocity = 0;
    let last = 0;
    let raf = 0;
    panel.style.opacity = '0';
    panel.style.transform = 'scale(0.3)';
    if (scrim) scrim.style.opacity = '0';

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      [progress, velocity] = springStep(
        progress,
        velocity,
        1,
        dt,
        IOS_MENU_OPEN_SPRING.stiffness,
        IOS_MENU_OPEN_SPRING.damping,
      );
      const settled = Math.abs(1 - progress) < 0.002 && Math.abs(velocity) < 0.002;
      const p = settled ? 1 : progress;
      const scale = 0.3 + 0.7 * p;
      const alpha = Math.min(1, Math.max(0, p * 2.5));
      panel.style.opacity = String(alpha);
      panel.style.transform = `scale(${scale})`;
      if (scrim) scrim.style.opacity = String(Math.min(1, Math.max(0, p)));
      if (!settled) {
        raf = requestAnimationFrame(tick);
      } else {
        panel.style.transform = 'scale(1)';
        panel.style.opacity = '1';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, reducedMotion]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        anchor.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        const next = index < 0 ? 0 : index + delta;
        items[(next + items.length) % items.length]?.focus();
      }
    };
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <>
      <div
        ref={scrimRef}
        className="fixed inset-0 z-[calc(var(--z-contextual-menus)-1)] bg-(--bc-menu-scrim)"
        onPointerDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="bc-menu-surface bc-continuous fixed z-(--z-contextual-menus) overflow-x-hidden overflow-y-auto rounded-(--bc-radius-menu) py-2 text-(--bc-menu-label) shadow-(--bc-shadow-menu) will-change-[transform,opacity]"
        style={layout ? layout.style : { visibility: 'hidden' }}
        role="menu"
        aria-label={label}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * Top quick-action tile bar (`IosMenuQuickActions`, `IosMenu.kt:258-268`):
 * 66px tall, 10px side padding, 4px gap between equal-width tiles.
 */
export function MenuQuickActions({ children }: { children: ReactNode }) {
  return <div className="grid h-[66px] auto-cols-fr grid-flow-col gap-1 px-2.5">{children}</div>;
}

/** Single tile in `MenuQuickActions` (`IosMenu.kt:272-311`). */
export function MenuQuickAction({
  icon,
  label,
  onSelect,
  tint,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  tint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex h-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-(--bc-radius-row-press) px-1 py-2 text-(--bc-menu-label) enabled:hover:bg-(--bc-menu-pressed) enabled:active:bg-(--bc-menu-pressed) focus-visible:bg-(--bc-menu-pressed) disabled:opacity-40"
    >
      <span className="inline-grid size-[23px] place-items-center" style={tint ? { color: tint } : undefined}>
        {icon}
      </span>
      <span className="max-w-full truncate font-(family-name:--bc-font-family) text-[12px] leading-[15px] font-semibold">
        {label}
      </span>
    </button>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** Optional subtitle line under the primary label. */
  description?: string;
  /** Shows a checkmark (a radio-style choice); null leaves the space empty. */
  checked?: boolean | null;
  destructive?: boolean;
  disabled?: boolean;
  /** Extra text or chevron at the trailing edge. */
  trailing?: ReactNode;
  children: ReactNode;
}

/** Single row of an `IosMenu` (`IosMenuRow`, `IosMenu.kt:321-407`). */
export function MenuItem({
  onSelect,
  icon,
  description,
  checked,
  destructive,
  disabled,
  trailing,
  children,
}: MenuItemProps) {
  return (
    <button
      type="button"
      className="mx-2 flex min-h-11 w-[calc(100%-16px)] items-center rounded-[14px] py-[11px] pr-3.5 pl-3 text-start text-(--bc-menu-label) enabled:hover:bg-(--bc-menu-pressed) enabled:active:bg-(--bc-menu-pressed) focus-visible:bg-(--bc-menu-pressed) disabled:opacity-40 data-destructive:text-(--bc-accent-red)"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked === undefined ? undefined : !!checked}
      data-destructive={destructive || undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {checked !== undefined && (
        <span className="mr-2 inline-grid w-4 flex-none place-items-center text-(--bc-primary)">
          {checked && <Check size={15} strokeWidth={2.5} />}
        </span>
      )}
      {icon !== undefined && (
        <span className="mr-2.5 inline-grid w-7 flex-none place-items-center text-current">{icon}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="line-clamp-2 font-(family-name:--bc-font-family) text-[17px] leading-[21px] font-normal tracking-[-0.3px]">
          {children}
        </span>
        {description && (
          <span className="truncate font-(family-name:--bc-font-family) text-[14px] leading-[17px] text-(--bc-menu-label2)">
            {description}
          </span>
        )}
      </span>
      {trailing && (
        <span className="ml-2.5 flex-none font-(family-name:--bc-font-family) text-[15px] text-(--bc-menu-label2)">
          {trailing}
        </span>
      )}
    </button>
  );
}

/** Group separator (`IosMenuSeparator`, `IosMenu.kt:239-255`). */
export function MenuSeparator() {
  return (
    <div className="flex h-[17px] items-center px-[18px]" role="separator">
      <div className="h-px w-full bg-(--bc-menu-sep)" />
    </div>
  );
}

/** A non-interactive heading inside a menu. */
export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 pt-1.5 pb-1 bc-type-label-sm uppercase text-(--bc-menu-label2)">{children}</div>
  );
}
