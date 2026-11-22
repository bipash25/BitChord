// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IOS_MENU_MARGIN,
  IOS_MENU_WIDTH,
  Menu,
  MenuHeader,
  MenuItem,
  MenuQuickAction,
  MenuQuickActions,
  MenuSeparator,
  computeMenuLayout,
} from './Menu';

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

describe('computeMenuLayout', () => {
  it('opens below-end with top-right origin when anchor is in upper half', () => {
    const layout = computeMenuLayout(
      { left: 320, right: 360, top: 80, bottom: 116, width: 40 },
      { width: 390, height: 844 },
      'below-end',
    );
    expect(layout.originX).toBe('100%');
    expect(layout.originY).toBe('0%');
    expect(layout.style.width).toBe(IOS_MENU_WIDTH);
    expect(layout.style.left).toBe(360 - IOS_MENU_WIDTH);
    expect(layout.style.top).toBe(122);
  });

  it('flips upward with bottom-right origin when anchor is in lower half', () => {
    const layout = computeMenuLayout(
      { left: 320, right: 360, top: 700, bottom: 736, width: 40 },
      { width: 390, height: 844 },
      'below-end',
    );
    expect(layout.originX).toBe('100%');
    expect(layout.originY).toBe('100%');
    expect(layout.style.bottom).toBe(844 - 700 + 6);
  });

  it('clamps to 14px viewport margin and respects above-start placement', () => {
    const layout = computeMenuLayout(
      { left: 4, right: 44, top: 700, bottom: 736, width: 40 },
      { width: 390, height: 844 },
      'above-start',
    );
    expect(layout.originX).toBe('0%');
    expect(layout.originY).toBe('100%');
    expect(layout.style.left).toBe(IOS_MENU_MARGIN);
  });
});

describe('Menu', () => {
  it('renders quick-action tiles, rows, separators and closes on Escape', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () =>
      ({ left: 330, right: 366, top: 100, bottom: 136, width: 36, height: 36, x: 330, y: 100, toJSON: () => {} }) as DOMRect;
    const onClose = vi.fn();
    const onPlayNext = vi.fn();

    root = createRoot(mount);
    act(() =>
      root!.render(
        <Menu anchor={anchor} onClose={onClose} label="Track actions">
          <MenuQuickActions>
            <MenuQuickAction icon={<span>+</span>} label="Play Next" onSelect={onPlayNext} />
          </MenuQuickActions>
          <MenuSeparator />
          <MenuHeader>More</MenuHeader>
          <MenuItem checked={true} onSelect={() => {}}>
            Add to Queue
          </MenuItem>
          <MenuItem destructive onSelect={() => {}}>
            Remove
          </MenuItem>
        </Menu>,
      ),
    );

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('[role^="menuitem"]').length).toBe(3);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    anchor.remove();
  });
});
