import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IosAlert, IosAlertAction, IosAlertRule } from '@/components/IosAlert';
import { IosSwitch } from '@/components/IosSwitch';
import { getBridge } from '@/extension/bridge';
import { LYRIC_EXTENSION_ORIGINS as EXTENSION_ORIGINS } from '@/lyrics/http';
import { useLyricsSettings } from '@/lyrics/settings';
import { sourceById } from '@/lyrics/sources';

const section = 'mx-1 mt-[18px] mb-1.5 bc-type-label-sm uppercase text-(--bc-on-surface-variant)';
const note = 'mx-1 mb-2 bc-type-body text-(--bc-on-surface-variant)';
const group = 'overflow-hidden rounded-(--bc-radius-group) bg-(--bc-surface-variant)';
const row = 'flex items-center gap-2 py-2.5 pr-3 pl-3.5';
const toggle = 'flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-3';
const moveButton =
  'grid size-7 place-items-center rounded-[8px] text-(--bc-on-surface-variant) enabled:hover:bg-(--bc-hover-fill) disabled:opacity-30';

/**
 * Lyric providers modal (`IosAlert` card + `IosSwitch` toggles): switch each
 * on or off, put them in order, prefer syllable timing, and the PaxSenix key.
 */
export function LyricsSettings({ onClose }: { onClose: () => void }) {
  const { order, disabled, preferSyllables, paxsenixKey, setEnabled, move, setPreferSyllables, setPaxsenixKey, reset } =
    useLyricsSettings();
  const [granted, setGranted] = useState<string[] | null>(null);
  const [key, setKey] = useState(paxsenixKey);

  useEffect(() => {
    const check = () =>
      void getBridge()
        ?.call('lyrics.permissions', { origins: EXTENSION_ORIGINS })
        .then((r) => setGranted(r.granted))
        .catch(() => setGranted(null));
    check();
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('focus', check);
    };
  }, []);

  const missing = granted ? EXTENSION_ORIGINS.filter((o) => !granted.includes(o)) : [];

  return (
    <IosAlert onClose={onClose} label="Lyric settings" size="wide">
      <header className="flex items-center justify-between px-5 pt-[18px] pb-2">
        <h2 className="bc-type-title text-(--bc-on-surface)">Lyrics</h2>
        <button
          type="button"
          className="grid size-[30px] place-items-center rounded-full bg-(--bc-surface-variant) text-(--bc-on-surface-variant) hover:bg-(--bc-hover-fill)"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="overflow-y-auto px-5 pb-5">
        <h3 className={section}>Providers</h3>
        <p className={note}>Asked all at once; the first in this order with word-timed lyrics wins.</p>
        <ol className={group}>
          {order.map((id, index) => {
            const source = sourceById(id)!;
            const on = !disabled.includes(id);
            return (
              <li key={id} className={`${row} [&+&]:border-t-[0.5px] [&+&]:border-t-(--bc-outline)`}>
                <label className={toggle}>
                  <span className="flex min-w-0 flex-col">
                    <span className="bc-type-title-md text-(--bc-on-surface)">{source.label}</span>
                    <span className="truncate bc-type-body text-(--bc-on-surface-variant)">{source.detail}</span>
                  </span>
                  <IosSwitch checked={on} onCheckedChange={(next) => setEnabled(id, next)} />
                </label>
                <span className="flex gap-0.5">
                  <button
                    type="button"
                    className={moveButton}
                    aria-label={`Move ${source.label} up`}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className={moveButton}
                    aria-label={`Move ${source.label} down`}
                    disabled={index === order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>

        <label className={`${group} ${toggle} mt-3 py-2.5 pr-3 pl-3.5`}>
          <span className="flex min-w-0 flex-col">
            <span className="bc-type-title-md text-(--bc-on-surface)">Prefer syllable timing</span>
            <span className="truncate bc-type-body text-(--bc-on-surface-variant)">
              Keep looking past a line-timed answer for a word-timed one.
            </span>
          </span>
          <IosSwitch checked={preferSyllables} onCheckedChange={setPreferSyllables} />
        </label>

        <h3 className={section}>Host access</h3>
        {granted === null ? (
          <p className={note}>KuGou, Musixmatch, Genius and PaxSenix don’t let web pages ask them directly.</p>
        ) : missing.length ? (
          <div className="flex items-center gap-3">
            <p className={note}>
              KuGou, Musixmatch, Genius and PaxSenix don’t let web pages ask them directly. The server relay fetches
              the ones it allows; the rest stay off.
            </p>
            <button
              type="button"
              className="flex-none rounded-full bg-(--bc-primary) px-3.5 py-1.5 bc-type-label text-(--bc-on-primary)"
              onClick={() => void getBridge()?.call('lyrics.requestPermissions', { origins: missing })}
            >
              Allow
            </button>
          </div>
        ) : (
          <p className={note}>All providers are reachable.</p>
        )}

        <h3 className={section}>PaxSenix key</h3>
        <input
          className="h-10 w-full rounded-(--bc-radius-field) border-0 bg-(--bc-surface-variant) px-3 bc-type-body text-(--bc-on-surface) placeholder:text-(--bc-on-surface-variant)"
          type="password"
          placeholder="For PaxSenix: Spotify and Musixmatch"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          onBlur={() => setPaxsenixKey(key)}
          autoComplete="off"
        />
      </div>

      <IosAlertRule />
      <IosAlertAction label="Restore Defaults" destructive onClick={reset} />
      <IosAlertRule />
      <IosAlertAction label="Done" emphasised onClick={onClose} />
    </IosAlert>
  );
}
