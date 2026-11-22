import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  AndroidExploreIcon,
  AndroidHomeIcon,
  AndroidLibraryIcon,
  AndroidSearchIcon,
  type NavIconProps,
} from '@/components/icons/NavIcons';
import { useReducedMotion } from '@/lib/motionPrefs';
import { TAB_PILL_SPRING, TAB_PILL_SQUASH, TAB_PILL_STRETCH, springStep } from '@/lib/spring';
import { preloadRoute } from '@/pageRegistry';

export interface FloatingTab {
  readonly id: 'home' | 'explore' | 'library' | 'search';
  readonly label: string;
  readonly to: string;
  readonly Icon: (props: NavIconProps) => React.ReactNode;
}

export const FLOATING_TABS: readonly FloatingTab[] = [
  { id: 'home', label: 'Home', to: '/home', Icon: AndroidHomeIcon },
  { id: 'explore', label: 'Explore', to: '/new', Icon: AndroidExploreIcon },
  { id: 'library', label: 'Library', to: '/library/playlists', Icon: AndroidLibraryIcon },
  { id: 'search', label: 'Search', to: '/search', Icon: AndroidSearchIcon },
];

const TAB_GAP = 6;
const DRAG_SLOP_PX = 6;
const SETTLE_EPSILON = 0.02;

/** Returns the tab index matching [pathname], or null when on a pushed detail/settings route. */
export function tabIndexForPath(pathname: string): number | null {
  if (pathname === '/' || pathname.startsWith('/home')) return 0;
  if (pathname.startsWith('/new')) return 1;
  if (pathname.startsWith('/library')) return 2;
  if (pathname.startsWith('/search')) return 3;
  return null;
}

export function isRootTabPath(pathname: string): boolean {
  return tabIndexForPath(pathname) !== null;
}

/**
 * Android-ported floating bottom tab bar (FloatingBottomBar.kt + spec §3.4, §4.3).
 *
 * Shown below 1000px (lg:hidden). 62px capsule with 19px screen gutters (capped
 * at 440px), frosted 24px material, and a JS-spring selection pill that stretches
 * horizontally in flight and supports drag-to-switch across tabs.
 */
export function FloatingTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const matchedTab = tabIndexForPath(pathname);
  const [rememberedTab, setRememberedTab] = useState(() => matchedTab ?? 0);
  useEffect(() => {
    if (matchedTab !== null) setRememberedTab(matchedTab);
  }, [matchedTab]);
  const selectedIndex = matchedTab ?? rememberedTab;

  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);
  const visualIndex = dragHoverIndex ?? selectedIndex;

  const rowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [rowWidth, setRowWidth] = useState(0);

  // Spring state lives in refs so 60/120fps rAF steps never trigger React re-renders.
  const animRef = useRef({
    pillPos: 0,
    pillVel: 0,
    glyphScales: FLOATING_TABS.map((_, i): number => (i === selectedIndex ? 1.08 : 1)),
    glyphVels: FLOATING_TABS.map((): number => 0),
    targetIndex: selectedIndex,
    activeVisualIndex: selectedIndex,
    dragOffset: 0,
    rowWidth: 0,
    initialized: false,
    rafId: 0,
    lastTime: 0,
  });

  const dragRef = useRef<{
    active: boolean;
    dragging: boolean;
    pointerId: number;
    startX: number;
    startIndex: number;
    totalDx: number;
    suppressClick: boolean;
  }>({
    active: false,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startIndex: 0,
    totalDx: 0,
    suppressClick: false,
  });

  const stepPx = rowWidth > 0 ? (rowWidth + TAB_GAP) / FLOATING_TABS.length : 0;
  const tabWidthPx = rowWidth > 0 ? (rowWidth - TAB_GAP * (FLOATING_TABS.length - 1)) / FLOATING_TABS.length : 0;

  const paintFrame = (pillPos: number, lag: number, glyphScales: number[]) => {
    if (pillRef.current && animRef.current.rowWidth > 0) {
      const sx = 1 + lag * TAB_PILL_STRETCH;
      const sy = 1 - lag * TAB_PILL_STRETCH * TAB_PILL_SQUASH;
      pillRef.current.style.transform = `translate3d(${pillPos}px, 0, 0) scaleX(${sx}) scaleY(${sy})`;
    }
    for (let i = 0; i < FLOATING_TABS.length; i++) {
      const el = iconRefs.current[i];
      if (el) el.style.transform = `scale(${glyphScales[i]})`;
    }
  };

  const startLoop = () => {
    const s = animRef.current;
    if (s.rafId) return;
    s.lastTime = 0;
    const tick = (now: number) => {
      const dt = s.lastTime ? Math.min((now - s.lastTime) / 1000, 0.05) : 1 / 60;
      s.lastTime = now;

      const step = s.rowWidth > 0 ? (s.rowWidth + TAB_GAP) / FLOATING_TABS.length : 0;
      const pillTarget = s.targetIndex * step + s.dragOffset;
      let settled = true;

      if (step > 0) {
        const [nx, nv] = springStep(s.pillPos, s.pillVel, pillTarget, dt, TAB_PILL_SPRING.stiffness, TAB_PILL_SPRING.damping);
        s.pillPos = nx;
        s.pillVel = nv;
        if (Math.abs(pillTarget - nx) > SETTLE_EPSILON || Math.abs(nv) > SETTLE_EPSILON) {
          settled = false;
        } else {
          s.pillPos = pillTarget;
          s.pillVel = 0;
        }
      }

      const activeIdx = s.activeVisualIndex;
      for (let i = 0; i < FLOATING_TABS.length; i++) {
        const gTarget = i === activeIdx ? 1.08 : 1;
        const [gx, gv] = springStep(s.glyphScales[i]!, s.glyphVels[i]!, gTarget, dt, TAB_PILL_SPRING.stiffness, TAB_PILL_SPRING.damping);
        s.glyphScales[i] = gx;
        s.glyphVels[i] = gv;
        if (Math.abs(gTarget - gx) > 0.002 || Math.abs(gv) > 0.002) {
          settled = false;
        } else {
          s.glyphScales[i] = gTarget;
          s.glyphVels[i] = 0;
        }
      }

      const lag = step > 0 ? Math.min(1, Math.max(0, Math.abs(pillTarget - s.pillPos) / step)) : 0;
      paintFrame(s.pillPos, lag, s.glyphScales);

      if (settled && s.dragOffset === 0) {
        s.rafId = 0;
      } else {
        s.rafId = requestAnimationFrame(tick);
      }
    };
    s.rafId = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const node = rowRef.current;
    if (!node || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setRowWidth(width);
      const s = animRef.current;
      s.rowWidth = width;
      const step = width > 0 ? (width + TAB_GAP) / FLOATING_TABS.length : 0;
      if (!s.initialized && width > 0) {
        s.initialized = true;
        s.pillPos = s.targetIndex * step;
        s.pillVel = 0;
        paintFrame(s.pillPos, 0, s.glyphScales);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const s = animRef.current;
    s.targetIndex = selectedIndex;
    s.activeVisualIndex = selectedIndex;
    s.dragOffset = 0;
    const step = s.rowWidth > 0 ? (s.rowWidth + TAB_GAP) / FLOATING_TABS.length : 0;
    if (reduceMotion || !s.initialized) {
      if (s.rafId) {
        cancelAnimationFrame(s.rafId);
        s.rafId = 0;
      }
      s.pillPos = selectedIndex * step;
      s.pillVel = 0;
      s.glyphScales = FLOATING_TABS.map((_, i) => (i === selectedIndex ? 1.08 : 1));
      s.glyphVels = FLOATING_TABS.map(() => 0);
      paintFrame(s.pillPos, 0, s.glyphScales);
      return;
    }
    startLoop();
  }, [selectedIndex, reduceMotion]);

  useEffect(() => {
    return () => {
      if (animRef.current.rafId) cancelAnimationFrame(animRef.current.rafId);
    };
  }, []);

  const selectTab = (index: number) => {
    const tab = FLOATING_TABS[index];
    if (!tab) return;
    setRememberedTab(index);
    if (pathname !== tab.to) navigate(tab.to);
  };

  return (
    <nav
      aria-label="Primary"
      className="bc-frost bc-pill-squircle fixed left-1/2 z-(--z-web-chrome) h-(--bc-tabbar-h) w-[min(calc(100vw-2*var(--bc-tabbar-gutter)),var(--bc-floating-bar-max))] -translate-x-1/2 p-(--bc-pill-inset) text-(--bc-glass-content) shadow-(--bc-shadow-glass) select-none lg:hidden"
      style={{
        bottom: 'calc(var(--bc-bottom-inset) + var(--bc-tabbar-lift))',
      }}
    >
      <div
        ref={rowRef}
        className="relative grid h-full w-full grid-cols-4 items-center gap-[6px] touch-pan-y"
        onPointerDown={(e) => {
          if (e.button !== 0 || stepPx <= 0) return;
          dragRef.current = {
            active: true,
            dragging: false,
            pointerId: e.pointerId,
            startX: e.clientX,
            startIndex: selectedIndex,
            totalDx: 0,
            suppressClick: false,
          };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d.active || e.pointerId !== d.pointerId || stepPx <= 0) return;
          const dx = e.clientX - d.startX;
          d.totalDx = dx;
          if (!d.dragging && Math.abs(dx) > DRAG_SLOP_PX) {
            d.dragging = true;
            d.suppressClick = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }
          if (!d.dragging) return;
          const absoluteFloat = Math.min(FLOATING_TABS.length - 1, Math.max(0, d.startIndex + dx / stepPx));
          const nextHover = Math.round(absoluteFloat);
          if (nextHover !== dragHoverIndex) setDragHoverIndex(nextHover);
          animRef.current.activeVisualIndex = nextHover;
          animRef.current.dragOffset = absoluteFloat * stepPx - selectedIndex * stepPx;
          if (reduceMotion) {
            const snapped = absoluteFloat * stepPx;
            animRef.current.pillPos = snapped;
            paintFrame(snapped, 0, FLOATING_TABS.map((_, i) => (i === nextHover ? 1.08 : 1)));
          } else {
            startLoop();
          }
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          if (!d.active || e.pointerId !== d.pointerId) return;
          const wasDragging = d.dragging;
          d.active = false;
          d.dragging = false;
          setDragHoverIndex(null);
          animRef.current.activeVisualIndex = selectedIndex;
          animRef.current.dragOffset = 0;
          if (wasDragging && stepPx > 0) {
            const absoluteFloat = Math.min(FLOATING_TABS.length - 1, Math.max(0, d.startIndex + d.totalDx / stepPx));
            const targetIdx = Math.round(absoluteFloat);
            if (targetIdx !== selectedIndex) {
              animRef.current.activeVisualIndex = targetIdx;
              selectTab(targetIdx);
            } else if (!reduceMotion) {
              startLoop();
            } else {
              paintFrame(selectedIndex * stepPx, 0, FLOATING_TABS.map((_, i) => (i === selectedIndex ? 1.08 : 1)));
            }
          }
        }}
        onPointerCancel={() => {
          const d = dragRef.current;
          d.active = false;
          d.dragging = false;
          setDragHoverIndex(null);
          animRef.current.activeVisualIndex = selectedIndex;
          animRef.current.dragOffset = 0;
          if (!reduceMotion) startLoop();
        }}
      >
        <div
          ref={pillRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 rounded-full bg-(--bc-tab-pill-bg) will-change-transform"
          style={
            tabWidthPx > 0
              ? { left: 0, width: `${tabWidthPx}px`, transformOrigin: '50% 50%' }
              : {
                  left: `calc(${selectedIndex} * (100% + ${TAB_GAP}px) / ${FLOATING_TABS.length})`,
                  width: `calc((100% - ${TAB_GAP * (FLOATING_TABS.length - 1)}px) / ${FLOATING_TABS.length})`,
                  transformOrigin: '50% 50%',
                }
          }
        />
        {FLOATING_TABS.map((tab, index) => {
          const active = index === visualIndex;
          const { Icon } = tab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={index === selectedIndex}
              aria-current={index === selectedIndex ? 'page' : undefined}
              className="relative z-1 flex h-full min-w-0 flex-col items-center justify-center rounded-full py-(--bc-tab-vpad) transition-colors duration-200"
              style={{
                color: active
                  ? 'var(--bc-glass-content)'
                  : 'color-mix(in srgb, var(--bc-glass-content) 65%, transparent)',
              }}
              onPointerEnter={() => preloadRoute(tab.to)}
              onFocus={() => preloadRoute(tab.to)}
              onClick={() => {
                if (dragRef.current.suppressClick) {
                  dragRef.current.suppressClick = false;
                  return;
                }
                selectTab(index);
              }}
            >
              <span
                ref={(el) => {
                  iconRefs.current[index] = el;
                }}
                className="inline-grid size-(--bc-tab-icon) place-items-center"
                style={{ transform: `scale(${active ? 1.08 : 1})` }}
              >
                <Icon size={28} />
              </span>
              <span
                className="mt-(--bc-tab-icon-label-gap) max-w-full truncate font-(family-name:--bc-font-family) text-[10px] leading-none font-semibold tracking-(--bc-tracking-tab-label)"
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
