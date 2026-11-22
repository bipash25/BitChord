// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HELD_GAP,
  HELD_MARGIN,
  HELD_PLATE_PADDING,
  HeldContextMenu,
  computeHeldMenuLayout,
} from './HeldContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = document.createElement('div');

beforeEach(() => {
  document.body.appendChild(mount);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
});

describe('computeHeldMenuLayout', () => {
  it('scales down a full-width row plate to clear 12px margins and hangs menu below', () => {
    const layout = computeHeldMenuLayout(
      { left: 0, top: 180, width: 390, height: 60 },
      { width: 390, height: 844 },
      220,
    );
    expect(layout.plateW).toBe(390 + HELD_PLATE_PADDING * 2);
    expect(layout.liftScale).toBeCloseTo((390 - HELD_MARGIN * 2) / layout.plateW, 4);
    expect(layout.menuBelow).toBe(true);
    expect(layout.menuX).toBeGreaterThanOrEqual(HELD_MARGIN);
    expect(layout.menuY).toBeGreaterThan(180);
  });

  it('places menu above the held item when near the bottom of the viewport', () => {
    const layout = computeHeldMenuLayout(
      { left: 0, top: 720, width: 390, height: 60 },
      { width: 390, height: 844 },
      220,
    );
    expect(layout.menuBelow).toBe(false);
    expect(layout.menuY + 220).toBeLessThanOrEqual(720);
  });

  it('aligns menu to trailing edge for right-hand grid tiles', () => {
    const layout = computeHeldMenuLayout(
      { left: 210, top: 200, width: 160, height: 160 },
      { width: 390, height: 844 },
      180,
    );
    expect(layout.alignEnd).toBe(true);
    expect(layout.menuX).toBe(390 - HELD_MARGIN - layout.menuWidth);
    expect(layout.menuY).toBe(Math.round(200 - HELD_PLATE_PADDING + (160 + HELD_PLATE_PADDING * 2) + HELD_GAP));
  });
});

describe('HeldContextMenu', () => {
  it('renders lifted preview plate and menu, and calls onDismiss on backdrop click', () => {
    const onDismiss = vi.fn();
    const onExited = vi.fn();
    root = createRoot(mount);
    act(() =>
      root!.render(
        <HeldContextMenu
          open={true}
          bounds={{ left: 0, top: 160, width: 390, height: 60 }}
          onDismiss={onDismiss}
          onExited={onExited}
          label="Track actions"
          preview={<div>Song Title</div>}
          actions={<button role="menuitem">Play Next</button>}
        />,
      ),
    );

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Play Next');
    expect(document.body.textContent).toContain('Song Title');

    const backdrop = document.body.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    act(() => backdrop?.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
