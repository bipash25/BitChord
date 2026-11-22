// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingTabBar, tabIndexForPath } from './FloatingTabBar';

vi.mock('@/pageRegistry', () => ({ preloadRoute: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function PathProbe() {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

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

function renderAt(initialPath: string) {
  root = createRoot(mount);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <FloatingTabBar />
        <PathProbe />
      </MemoryRouter>,
    ),
  );
}

describe('tabIndexForPath', () => {
  it('maps the four Android tabs and leaves pushed routes null', () => {
    expect(tabIndexForPath('/home')).toBe(0);
    expect(tabIndexForPath('/new')).toBe(1);
    expect(tabIndexForPath('/library/playlists')).toBe(2);
    expect(tabIndexForPath('/library/artists')).toBe(2);
    expect(tabIndexForPath('/search')).toBe(3);
    expect(tabIndexForPath('/album/123')).toBeNull();
    expect(tabIndexForPath('/settings')).toBeNull();
  });
});

describe('FloatingTabBar', () => {
  it('renders Home, Explore, Library and Search with the active tab marked', () => {
    renderAt('/new');
    const tabs = [...mount.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Explore', 'Library', 'Search']);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('navigates when a tab is clicked and preserves tab selection on pushed routes', () => {
    renderAt('/search');
    const tabs = [...mount.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[3]?.getAttribute('aria-selected')).toBe('true');
    act(() => tabs[2]!.click());
    expect(mount.querySelector('[data-testid="path"]')?.textContent).toBe('/library/playlists');
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
  });
});
