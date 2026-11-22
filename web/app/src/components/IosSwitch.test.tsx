// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosSwitch, SWITCH_PRESS_STRETCH, stepSwitchState } from './IosSwitch';

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

describe('stepSwitchState', () => {
  it('advances thumb position on ζ 0.78 / 700 spring and settles at 1', () => {
    let state = { pos: 0, posVel: 0, stretch: 1, stretchVel: 0, settled: false };
    for (let i = 0; i < 60; i++) {
      state = stepSwitchState(state, 1, 1, 1 / 60);
    }
    expect(state.pos).toBe(1);
    expect(state.posVel).toBe(0);
    expect(state.settled).toBe(true);
  });

  it('stretches thumb toward 1.18 while pressed on ζ 0.7 / 900 spring', () => {
    let state = { pos: 0, posVel: 0, stretch: 1, stretchVel: 0, settled: false };
    for (let i = 0; i < 5; i++) {
      state = stepSwitchState(state, 0, SWITCH_PRESS_STRETCH, 1 / 60);
    }
    expect(state.stretch).toBeGreaterThan(1.05);
    for (let i = 0; i < 60; i++) {
      state = stepSwitchState(state, 0, SWITCH_PRESS_STRETCH, 1 / 60);
    }
    expect(state.stretch).toBe(SWITCH_PRESS_STRETCH);
  });
});

describe('IosSwitch', () => {
  it('renders a switch input with checked state and notifies on toggle', () => {
    const onChange = vi.fn();
    root = createRoot(mount);
    act(() => root!.render(<IosSwitch checked={false} onCheckedChange={onChange} ariaLabel="AutoPlay" />));

    const input = mount.querySelector<HTMLInputElement>('input[role="switch"]');
    expect(input).not.toBeNull();
    expect(input?.checked).toBe(false);
    expect(input?.getAttribute('aria-label')).toBe('AutoPlay');

    act(() => input!.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('acts as a read-only indicator when onCheckedChange is null', () => {
    root = createRoot(mount);
    act(() => root!.render(<IosSwitch checked={true} onCheckedChange={null} />));
    expect(mount.querySelector('input[role="switch"]')).toBeNull();
  });
});
