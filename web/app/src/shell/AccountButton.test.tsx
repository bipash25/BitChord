// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YtAuthState } from '@bitchord/shared/bridge';
import { AccountButton } from './AccountButton';

/**
 * The account control's contract (web/docs/private-deployment.md,
 * 2026-11-22): the session behind the app is functional but identity-free,
 * and nothing of it — name, avatar, email, or any other existence — may
 * appear in the frontend. Where the account's own control would render
 * there is the sign-in prompt, and tapping it makes the same ask a
 * signed-out app would: sign in on music.youtube.com, then come back.
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

// The words the standing rule bars from the ask: none of the account behind
// the app — not shared, not the server's, not the relay's — may surface.
const forbidden = ['shared', 'relay', 'server', 'fallback', 'throwaway', 'personal'];

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

/** The open prompt, which portals to the body rather than the sidebar. */
const prompt = () => document.body.querySelector('[role="dialog"]');

describe('AccountButton under the relay', () => {
  it('renders the sign-in prompt for the anonymous session — no name, no avatar', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    expect(text()).toContain('Sign in with YouTube');
    // The identity-free state: nothing pictorial, nothing named.
    expect(mount.querySelector('img')).toBeNull();
  });

  it('opens a plain sign-in ask on tap, with none of the account behind it', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    expect(prompt()).not.toBeNull();
    const asked = prompt()!.textContent ?? '';
    // A sign-in demand, the wording LibraryPage already carries.
    expect(asked).toContain('Sign in on music.youtube.com');
    // The link out in a new tab, as a signed-out app offers.
    const link = prompt()!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://music.youtube.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    for (const word of forbidden) expect(asked).not.toContain(word);
  });

  it('closes the ask on its own close button', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    const close = prompt()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    act(() => close!.click());
    expect(prompt()).toBeNull();
  });

  it('makes the same ask when no session is configured', () => {
    holder.auth = { state: 'ready', auth: signedOut };
    render();
    expect(text()).toContain('Sign In');
    act(() => mount.querySelector('button')!.click());
    const asked = prompt()!.textContent ?? '';
    expect(asked).toContain('Sign in on music.youtube.com');
    for (const word of forbidden) expect(asked).not.toContain(word);
  });
});
