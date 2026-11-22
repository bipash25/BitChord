import { X } from 'lucide-react';
import { useState } from 'react';
import { BridgeCallError, type YtAuthState } from '@bitchord/shared/bridge';
import { IosAlert } from '@/components/IosAlert';
import { queryClient } from '@/lib/queryClient';
import { adoptYtAuth, useYtAuth, ytAuthQueryKey } from '@/extension/useYtAuth';
import { JAR_MAX_CHARS, clearUserJar, setUserJar, verifyUserJar } from '@/extension/userJar';

const pill =
  'self-start rounded-full bg-(--bc-primary) px-3.5 py-1.5 bc-type-label text-(--bc-on-primary) hover:opacity-90';
const action =
  'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full bg-(--bc-primary) px-4 bc-type-title-md text-(--bc-on-primary) hover:opacity-90';
const secondary =
  'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full bg-(--bc-tab-pill-bg) px-4 bc-type-title-md text-(--bc-on-surface) hover:opacity-85';
const avatar =
  'inline-grid flex-none place-items-center rounded-full bg-(--bc-surface-variant) object-cover bc-type-label-sm text-(--bc-on-surface-variant)';
const field =
  'w-full rounded-(--bc-radius-field) bg-(--bc-surface-variant) px-3 py-2 bc-type-body text-(--bc-on-surface) placeholder:text-(--bc-on-surface-variant) focus:outline-none';

/**
 * The sidebar's account control. Whichever session is live answers for the
 * account: the visitor's own when they've connected their YouTube session
 * (the recommended path — their library, likes, history and personalization,
 * their name and avatar here), and the anonymous session every visitor gets
 * otherwise — functional but nameless by design (web/docs/
 * private-deployment.md, 2026-11-22), so its control is the sign-in prompt
 * exactly where a name would have stood. The wording rule holds across both:
 * nothing about the machinery behind the app appears in any string.
 */
export function AccountButton() {
  const status = useYtAuth();
  const [open, setOpen] = useState(false);

  if (status.state !== 'ready') return null;
  const { auth } = status;
  const identity = auth.signedIn && auth.active && auth.active.name ? auth.active : null;

  return (
    <div>
      {identity ? (
        <button
          className="flex w-full min-w-0 items-center gap-2 rounded-[12px] px-1 py-1.5 bc-type-body text-(--bc-on-surface) hover:bg-(--bc-surface-variant)"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Avatar src={identity.avatarUrl} name={identity.name} size={24} />
          <span className="min-w-0 flex-1 truncate">{identity.name}</span>
        </button>
      ) : (
        <button className={pill} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {auth.signedIn ? 'Sign in with YouTube' : 'Sign In'}
        </button>
      )}
      {open && <SignInDialog auth={auth} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  return src ? (
    <img className={avatar} src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" />
  ) : (
    <span className={avatar} style={{ width: size, height: size }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The connect flow, one step at a time; 'verified', 'connected' and 'failed' are outcomes. */
type Step =
  | { kind: 'intro' }
  | { kind: 'export' }
  | { kind: 'paste' }
  | { kind: 'verifying' }
  | { kind: 'verified'; state: YtAuthState }
  | { kind: 'connected'; state: YtAuthState }
  | { kind: 'failed'; message: string };

/**
 * The sign-in dialog, in the app's modal idiom (LyricsSettings' scrim and
 * card). Opened from the identity row it starts at the account it manages;
 * opened from the prompt it walks the connect flow: sign in at
 * music.youtube.com, export that session as cookies.txt, paste it here, and
 * a verification call reads who it belongs to before anything is stored.
 */
function SignInDialog({ auth, onClose }: { auth: YtAuthState; onClose: () => void }) {
  // The account row's own channel, when the dialog opens already connected.
  const connected = auth.signedIn && auth.active && auth.active.name ? auth : null;
  const [step, setStep] = useState<Step>(connected ? { kind: 'connected', state: connected } : { kind: 'intro' });
  const [text, setText] = useState('');

  /** Disconnect: the stored session is dropped and the anonymous one takes over. */
  const disconnect = () => {
    clearUserJar();
    onClose();
    // The next auth read carries no session of the visitor's, so it adopts
    // the anonymous answer: the prompt returns, and everything read as the
    // visitor resets behind the identity change.
    void queryClient.invalidateQueries({ queryKey: ytAuthQueryKey });
  };

  /**
   * Step 4: verify with YouTube before anything is stored. Success stops at
   * the 'verified' step — the account the session belongs to is shown, and
   * nothing is written until the visitor says that account is the one they
   * meant (the app's hardest-won rule: a capture persisted on trust became a
   * durable broken account; a paste is never a promise).
   */
  const connect = async () => {
    const jar = text.trim();
    if (!jar) {
      setStep({ kind: 'failed', message: 'Nothing to connect yet — paste the cookies.txt contents, or choose the file.' });
      return;
    }
    if (jar.length > JAR_MAX_CHARS) {
      setStep({
        kind: 'failed',
        message:
          `That export is ${Math.round(jar.length / 1000)} KB, and the sign-in carries at most ${JAR_MAX_CHARS / 1000} KB. ` +
          'Export only youtube.com cookies, or paste the single Cookie line.',
      });
      return;
    }
    setStep({ kind: 'verifying' });
    try {
      const state = await verifyUserJar(jar);
      if (!state.signedIn || !state.active) {
        // YouTube's own sentence about the session, or a plain refusal.
        setStep({ kind: 'failed', message: state.problem ?? 'YouTube did not accept that session — export it again and retry.' });
        return;
      }
      setStep({ kind: 'verified', state });
    } catch (error) {
      setStep({ kind: 'failed', message: failureText(error) });
    }
  };

  /** Step 5: the visitor confirmed the account — now, and only now, it is stored. */
  const useAccount = (state: YtAuthState) => {
    if (!setUserJar(text.trim())) {
      setStep({ kind: 'failed', message: 'This browser would not store the sign-in (private browsing?). Playing continues without it.' });
      return;
    }
    adoptYtAuth(state);
    setStep({ kind: 'connected', state });
  };

  return (
    <IosAlert onClose={onClose} label="Sign in with YouTube" size="dialog">
      <div className="flex flex-col overflow-y-auto">
        <header className="flex items-center justify-between px-5 pt-[18px] pb-1">
          <h2 className="bc-type-title text-(--bc-on-surface)">
            {step.kind === 'connected' ? 'YouTube Music' : step.kind === 'failed' ? 'Couldn’t connect' : 'Sign in with YouTube'}
          </h2>
          <button
            className="grid size-[30px] place-items-center rounded-full bg-(--bc-surface-variant) text-(--bc-on-surface-variant) hover:bg-(--bc-hover-fill)"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {step.kind === 'intro' && (
          <section className="flex flex-col gap-4 px-5 pt-2 pb-5">
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">
              Your library, likes, history and recommendations play here when you connect your YouTube Music account.
              Start by signing in on music.youtube.com, then come back.
            </p>
            <a className={action} href="https://music.youtube.com" target="_blank" rel="noreferrer">
              Open music.youtube.com
            </a>
            <button className={secondary} onClick={() => setStep({ kind: 'export' })}>
              I’ve signed in — continue
            </button>
          </section>
        )}

        {step.kind === 'export' && (
          <section className="flex flex-col gap-3 px-5 pt-2 pb-5">
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">
              BitChord reads your YouTube session from this browser, and the browser keeps it from web pages — so the
              one thing it can’t do quietly is hand it over. Export it yourself:
            </p>
            <ol className="flex list-decimal flex-col gap-2 pl-4 bc-type-body text-(--bc-on-surface)">
              <li>
                In the browser you signed in with, add a cookies.txt export extension — search the extension store for
                “Get cookies.txt”.
              </li>
              <li>Open music.youtube.com, click the extension, and export. You get a small cookies.txt file.</li>
              <li>Keep that file to yourself: it is your YouTube sign-in. BitChord stores it in this browser only and forgets it when you disconnect.</li>
            </ol>
            <button className={action} onClick={() => setStep({ kind: 'paste' })}>
              Continue
            </button>
          </section>
        )}

        {step.kind === 'paste' && (
          <section className="flex flex-col gap-3 px-5 pt-2 pb-5">
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">
              Paste the cookies.txt contents, or choose the file. Either shape works — the whole file, or one raw
              Cookie line.
            </p>
            <textarea
              className={`${field} min-h-[96px] resize-y`}
              placeholder="Paste cookies.txt contents here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label className={secondary + ' w-fit cursor-pointer'}>
              Choose file
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setText(await file.text());
                }}
              />
            </label>
            <button className={action} onClick={() => void connect()}>
              Connect
            </button>
          </section>
        )}

        {step.kind === 'verifying' && (
          <section className="px-5 pt-2 pb-5">
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">Checking with YouTube who this session belongs to…</p>
          </section>
        )}

        {step.kind === 'verified' && (
          <section className="flex flex-col gap-4 px-5 pt-2 pb-5">
            <div className="flex items-center gap-3">
              <Avatar src={step.state.active?.avatarUrl ?? null} name={step.state.active?.name ?? 'You'} size={44} />
              <div className="min-w-0">
                <p className="truncate bc-type-title-md text-(--bc-on-surface)">{step.state.active?.name}</p>
                <p className="truncate bc-type-body text-(--bc-on-surface-variant)">
                  {step.state.accounts[0]?.email ?? step.state.active?.handle ?? null}
                </p>
              </div>
            </div>
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">
              This is the account the session you pasted belongs to. Use it here?
            </p>
            <div className="flex gap-2">
              <button className={action} onClick={() => useAccount(step.state)}>
                Use this account
              </button>
              <button className={secondary} onClick={() => setStep({ kind: 'paste' })}>
                Back
              </button>
            </div>
          </section>
        )}

        {step.kind === 'connected' && <Connected state={step.state} onDone={onClose} onDisconnect={disconnect} />}

        {step.kind === 'failed' && (
          <section className="flex flex-col gap-4 px-5 pt-2 pb-5">
            <p className="bc-type-body-lg text-(--bc-on-surface-variant)">{step.message}</p>
            <button className={action} onClick={() => setStep({ kind: 'paste' })}>
              Try again
            </button>
          </section>
        )}
      </div>
    </IosAlert>
  );
}

/** The account view: their identity, and the way out. */
function Connected({ state, onDone, onDisconnect }: { state: YtAuthState; onDone: () => void; onDisconnect: () => void }) {
  const active = state.active;
  const email = state.accounts[0]?.email ?? null;
  return (
    <section className="flex flex-col gap-4 px-5 pt-2 pb-5">
      <div className="flex items-center gap-3">
        <Avatar src={active?.avatarUrl ?? null} name={active?.name ?? 'You'} size={44} />
        <div className="min-w-0">
          <p className="truncate bc-type-title-md text-(--bc-on-surface)">{active?.name}</p>
          <p className="truncate bc-type-body text-(--bc-on-surface-variant)">{email ?? active?.handle ?? null}</p>
        </div>
      </div>
      <p className="bc-type-body-lg text-(--bc-on-surface-variant)">
        Your library, likes, history and recommendations play as yours from here on.
      </p>
      <div className="flex gap-2">
        <button className={action} onClick={onDone}>
          Done
        </button>
        <button className={secondary} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </section>
  );
}

/**
 * What a failed verification says, by failure class — the messages the
 * plumbing produces name the machinery, which no screen here may, so they are
 * translated rather than shown. YouTube's own answer (the problem path) is
 * the one string shown as spoken.
 */
function failureText(error: unknown): string {
  if (error instanceof BridgeCallError) {
    switch (error.code) {
      case 'network':
      case 'timeout':
      case 'unavailable':
        return 'BitChord couldn’t reach YouTube just now — check the connection and try again.';
      case 'unauthenticated':
        return 'Signing in isn’t available on this site.';
      case 'protocol':
        return 'This page and the site speak different versions — reload and try again.';
      default:
        return 'YouTube refused that session — export it again and retry.';
    }
  }
  return 'Something failed while checking — try again.';
}
