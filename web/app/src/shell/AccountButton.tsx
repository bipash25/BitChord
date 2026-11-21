import { useRefreshYtAuth, useYtAuth } from '@/extension/useYtAuth';

// The relay-account marker: the shared fallback identity, not a personal session.
const relayTag = 'flex-none rounded-[4px] bg-quinary px-1 type-[600_10px/14px] text-secondary';
const avatar = 'inline-grid flex-none place-items-center rounded-full bg-quinary object-cover type-[600_11px/1] text-secondary';
const pill =
  'self-start rounded-[16px] bg-key px-3.5 py-[5px] type-[600_13px/18px] text-white hover:brightness-[1.08] disabled:opacity-60';

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  return src ? (
    <img className={avatar} src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" />
  ) : (
    <span className={avatar} style={{ width: size, height: size }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The sidebar's account control. The relay is the only transport, and its one
 * identity is the fallback account (web/docs/private-deployment.md): a
 * throwaway the relay's operator holds, whose cookie jar signs playback for
 * listeners without a session of their own. The browser itself holds nothing
 * — browserSignedIn is false while signedIn is true — so the control names
 * whose account is playing instead of whose browser is connected.
 *
 * There is deliberately no sign-in here: the relay never reads this browser's
 * cookies, so a Google sign-in would connect nothing, and there is no
 * cookieless sign-in to offer (relay.md's phase-2 record: the TV OAuth
 * bearer authenticates and opens nothing). It is the fallback or anonymous,
 * and only the fallback makes this control appear at all.
 */
export function AccountButton() {
  const status = useYtAuth();
  const refresh = useRefreshYtAuth();

  if (status.state !== 'ready') return null;
  const { auth } = status;

  // Signed in without the account being readable: playback still works (the
  // jar signs regardless); the reason sits in the tooltip and a retry re-reads it.
  if (!auth.active) {
    return (
      <button
        className={pill}
        title={auth.problem ?? undefined}
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
      >
        {refresh.isPending ? 'Reading account…' : 'Retry Account Read'}
      </button>
    );
  }

  const active = auth.active;
  return (
    <div
      className="flex w-full min-w-0 items-center gap-2 rounded-nav px-1 py-1.5 type-body-reduced text-primary"
      title="Playback is signed by the relay's shared account"
    >
      <Avatar src={active.avatarUrl} name={active.name} size={24} />
      <span className="min-w-0 flex-1 truncate">{active.name}</span>
      <span className={relayTag}>relay</span>
    </div>
  );
}
