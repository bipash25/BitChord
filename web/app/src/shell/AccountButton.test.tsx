// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YtAuthState } from '@bitchord/shared/bridge';
import { AccountButton } from './AccountButton';

/**
 * The account control and the connect flow (web/docs/private-deployment.md,
 * 2026-11-22): signing in with your own YouTube account is the recommended
 * path — the visitor's session, exported as cookies.txt in their browser,
 * verified against YouTube, then stored there and carried on the calls — and
 * the anonymous session everyone else gets stays invisible behind the
 * sign-in prompt. The wording rule is absolute across both: nothing about
 * the machinery behind the app — the shared account, anything server-side —
 * appears in any string the UI can show.
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
// The visitor's own session, as the verify call answers it.
const userSession: YtAuthState = {
  browserSignedIn: false,
  connected: true,
  signedIn: true,
  accounts: [
    {
      authUser: '0',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: 'https://yt3.ggpht.com/ada.png',
      channels: [{ id: '0:own', name: 'Ada Lovelace', handle: '@ada', avatarUrl: 'https://yt3.ggpht.com/ada.png', brand: false }],
    },
  ],
  active: { id: '0:own', name: 'Ada Lovelace', handle: '@ada', avatarUrl: 'https://yt3.ggpht.com/ada.png', brand: false, authUser: '0' },
  problem: null,
};
const refusedSession: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: 'YouTube refused the session: HTTP 403',
};

// The words the standing rule bars from every user-visible string: none of
// the account behind the app — not shared, not the server's, not the
// relay's — may surface, on any step of the flow.
const forbidden = ['shared', 'relay', 'server', 'fallback', 'throwaway', 'personal'];

const holder = vi.hoisted(() => ({ auth: { state: 'ready', auth: {} } as { state: 'ready'; auth: YtAuthState } }));
vi.mock('@/extension/useYtAuth', () => ({
  useYtAuth: () => holder.auth,
  adoptYtAuth: vi.fn(),
  ytAuthQueryKey: ['yt', 'auth'],
}));
const jar = vi.hoisted(() => ({ verify: vi.fn(), store: vi.fn(), clear: vi.fn() }));
vi.mock('@/extension/userJar', () => ({
  JAR_MAX_CHARS: 12_000,
  setUserJar: (text: string) => jar.store(text) ?? true,
  clearUserJar: () => jar.clear(),
  getUserJar: () => null,
  verifyUserJar: (text: string) => jar.verify(text),
}));
const queries = vi.hoisted(() => ({ invalidated: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: queries.invalidated },
}));

// act() wants the environment flagged, or every render warns.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = document.createElement('div');
beforeEach(() => {
  document.body.appendChild(mount);
  vi.clearAllMocks();
});
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

/** The open dialog, which portals to the body rather than the sidebar. */
const dialog = () => document.body.querySelector('[role="dialog"]');

/** The dialog's text, checked against the forbidden vocabulary. */
const dialogText = () => {
  const asked = dialog()?.textContent ?? '';
  for (const word of forbidden) expect(asked, asked).not.toContain(word);
  return asked;
};

/** Clicks the control (button or link) whose text contains [needle]. */
const clickText = (needle: string) => {
  const controls = [...(dialog()?.querySelectorAll('button, a') ?? [])] as HTMLElement[];
  const control = controls.find((c) => c.textContent?.includes(needle));
  if (!control) throw new Error(`no control "${needle}" in: ${dialog()?.textContent}`);
  act(() => control.click());
};

/** Types [value] into the paste step's textarea, the way a user's keystrokes land. */
const type = (value: string) => {
  const area = dialog()?.querySelector('textarea');
  if (!(area instanceof HTMLTextAreaElement)) throw new Error('no textarea in the dialog');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(area, value);
  act(() => area.dispatchEvent(new Event('input', { bubbles: true })));
};

const JAR_TEXT = 'Cookie: SID=user-sid; SAPISID=user-secret';

describe('the account control', () => {
  it('renders the sign-in prompt for the anonymous session — no name, no avatar', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    expect(text()).toContain('Sign in with YouTube');
    expect(mount.querySelector('img')).toBeNull();
  });

  it('renders the visitor’s own identity when their session is connected — name and avatar', () => {
    holder.auth = { state: 'ready', auth: userSession };
    render();
    expect(text()).toContain('Ada Lovelace');
    expect(text()).not.toContain('Sign in with YouTube');
    const avatar = mount.querySelector('img');
    expect(avatar?.getAttribute('src')).toBe('https://yt3.ggpht.com/ada.png');
  });
});

describe('the connect flow', () => {
  it('asks for a sign-in first, links out, and never names the machinery', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    const asked = dialogText();
    expect(asked).toContain('signing in on music.youtube.com');
    const link = dialog()!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://music.youtube.com');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('walks sign-in → export → paste, each step saying only what the visitor does', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    clickText('I’ve signed in — continue');
    const exportStep = dialogText();
    expect(exportStep).toContain('cookies.txt');
    expect(exportStep).toContain('extension');
    clickText('Continue');
    const pasteStep = dialogText();
    expect(pasteStep).toContain('Paste');
    expect(dialog()!.querySelector('textarea')).not.toBeNull();
  });

  it('verifies with YouTube, shows the account it read, and stores only once confirmed', async () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    clickText('I’ve signed in — continue');
    clickText('Continue');
    type(JAR_TEXT);
    jar.verify.mockResolvedValue(userSession);
    await act(async () => {
      clickText('Connect');
    });
    // The verified step names the account the session belongs to — and
    // nothing is stored yet: a paste is never a promise.
    const verified = dialogText();
    expect(verified).toContain('Ada Lovelace');
    expect(verified).toContain('ada@example.com');
    expect(verified).toContain('Use this account');
    expect(jar.verify).toHaveBeenCalledWith(JAR_TEXT);
    expect(jar.store).not.toHaveBeenCalled();
    await act(async () => {
      clickText('Use this account');
    });
    const connected = dialogText();
    expect(connected).toContain('Ada Lovelace');
    expect(jar.store).toHaveBeenCalledWith(JAR_TEXT);
  });

  it('stores nothing when YouTube refuses the session — the refusal is shown, not swallowed', async () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    clickText('I’ve signed in — continue');
    clickText('Continue');
    type(JAR_TEXT);
    jar.verify.mockResolvedValue(refusedSession);
    await act(async () => {
      clickText('Connect');
    });
    const failed = dialogText();
    expect(failed).toContain("Couldn’t connect");
    expect(failed).toContain('HTTP 403');
    expect(jar.store).not.toHaveBeenCalled();
    // And the way back is offered.
    expect(failed).toContain('Try again');
  });

  it('says something clean when the verification call itself fails', async () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    clickText('I’ve signed in — continue');
    clickText('Continue');
    type(JAR_TEXT);
    jar.verify.mockRejectedValue(new Error('the transport exploded with details that must not show'));
    await act(async () => {
      clickText('Connect');
    });
    const failed = dialogText();
    expect(failed).toContain("Couldn’t connect");
    expect(failed).not.toContain('exploded');
    expect(jar.store).not.toHaveBeenCalled();
  });

  it('refuses a paste that is empty or too large to carry, without calling anyone', async () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    clickText('I’ve signed in — continue');
    clickText('Continue');
    await act(async () => {
      clickText('Connect');
    });
    expect(dialogText()).toContain('Nothing to connect');
    // Back to the paste step for the size guard: the failed step has no field.
    clickText('Try again');
    type('x'.repeat(12_001));
    await act(async () => {
      clickText('Connect');
    });
    const tooLarge = dialogText();
    expect(tooLarge).toContain('KB');
    expect(jar.verify).not.toHaveBeenCalled();
  });

  it('makes the same ask when no session is configured at all', () => {
    holder.auth = { state: 'ready', auth: signedOut };
    render();
    expect(text()).toContain('Sign In');
    act(() => mount.querySelector('button')!.click());
    expect(dialogText()).toContain('signing in on music.youtube.com');
  });
});

describe('disconnect', () => {
  it('clears the stored session, re-reads the auth, and closes on the account view', () => {
    holder.auth = { state: 'ready', auth: userSession };
    render();
    act(() => mount.querySelector('button')!.click());
    const account = dialogText();
    expect(account).toContain('Ada Lovelace');
    expect(account).toContain('Disconnect');
    clickText('Disconnect');
    expect(jar.clear).toHaveBeenCalled();
    expect(queries.invalidated).toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('closes on the dialog’s own close button', () => {
    holder.auth = { state: 'ready', auth: relaySession };
    render();
    act(() => mount.querySelector('button')!.click());
    const close = dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    act(() => close!.click());
    expect(dialog()).toBeNull();
  });
});
