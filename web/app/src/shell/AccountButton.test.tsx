// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YtAuthState } from '@bitchord/shared/bridge';
import { AccountButton } from './AccountButton';

/**
 * The account control's corrected contract (web/docs/private-deployment.md,
 * 2026-11-22): the relay's session is functional but anonymous, so where the
 * account's name and avatar would have rendered there is a sign-in prompt
 * instead — and tapping it explains honestly rather than opening a sign-in
 * that would connect nothing.
 */

// The auth read the relay answers, as useYtAuth would hand it to the control.
const relaySession: YtAuthState = {
  browserSignedIn: false,
  connected: true,
  signedIn: true,
  accounts: [],
  active: { id: 'relay-session', name: '', handle: null, avatarUrl: null, brand: false, authUser: '0' },
  problem: null,
};
const signedOut: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

const holder = vi.hoisted(() => ({ auth: { state: 'ready', auth: {} } as { state: 'ready'; auth: YtAuthState } }));
vi.mock('@/extension/useYtAuth', () => ({ useYtAuth: () => holder.auth }));

// act() wants the environment flagged, or every render warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = document.createElement('div');
beforeEach(() => document.body.appendChild(mount));
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  mount.remove();
});

function render(): void {
  root = createRoot(mount);
  act(() => root!.render(<AccountButton />));
}

/** The control's whole text, for the assertions that read it as a user would. */
const text = () => mount.textContent ?? '';

describe('AccountButton under the relay', () => {
  it('renders the sign-in prompt for the anonymous shared session — no name, no avatar', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    expect(text()).toContain('Sign in with YouTube');
    // The identity-free state: nothing pictorial, nothing named.
    expect(mount.querySelector('img')).toBeNull();
  });

  it('explains the shared account on tap, honestly, and takes it back on a second tap', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    expect(text()).toContain('shared YouTube account');
    expect(text()).toContain('no personal sign-in');
    act(() => mount.querySelector('button')!.click());
    expect(text()).not.toContain('shared YouTube account');
  });

  it('renders the same prompt when no fallback is configured, saying why', () => {
    holder.auth = { state: 'ready', auth: signedOut };
    render();
    expect(text()).toContain('Sign In');
    act(() => mount.querySelector('button')!.click());
    expect(text()).toContain('no shared account');
  });
});
