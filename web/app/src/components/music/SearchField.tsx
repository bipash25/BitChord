import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSuggestions } from '@/data/music/queries';
import type { MusicItem } from '@/data/music/types';
import { Artwork } from './Artwork';
import { hrefFor } from './links';
import { playTrack, toTrack } from './play';
import { TrackMenu } from './TrackMenu';

type Option = { kind: 'query'; text: string; typed: string; rest: string } | { kind: 'item'; item: MusicItem };

/**
 * Android `PillTextField` search box (`Common.kt:957-1010`, spec §2.5 & §6.4):
 * 40px height, 11px radius, flat `--bc-surface-variant` fill with no border,
 * 15px body text, and frosted suggestion list.
 */
export function SearchField({ initial, onSearch }: { initial: string; onSearch: (query: string) => void }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const suggestions = useSuggestions(open ? value : '');
  const menuOpen = useRef(false);
  const onMenuOpenChange = useCallback((isOpen: boolean) => {
    const wasOpen = menuOpen.current;
    menuOpen.current = isOpen;
    if (!isOpen && wasOpen) setOpen(false);
  }, []);

  useEffect(() => setValue(initial), [initial]);

  const options: Option[] = [
    ...(suggestions.data?.queries ?? []).map((q) => ({ kind: 'query' as const, ...q })),
    ...(suggestions.data?.items ?? []).map((item) => ({ kind: 'item' as const, item })),
  ];
  const showList = open && value.trim().length > 0 && options.length > 0;

  const pick = (option: Option | undefined) => {
    if (menuOpen.current) return;
    setOpen(false);
    setActive(-1);
    if (!option) return onSearch(value.trim());
    if (option.kind === 'query') {
      setValue(option.text);
      return onSearch(option.text);
    }
    const href = hrefFor(option.item);
    if (href) navigate(href);
    else playTrack(option.item);
  };

  return (
    <div className="relative w-full max-w-[640px]">
      <form
        className="relative flex h-10 items-center rounded-(--bc-radius-field) bg-(--bc-surface-variant) px-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          pick(active >= 0 ? options[active] : undefined);
        }}
      >
        <Search size={18} strokeWidth={2.1} className="mr-2.5 shrink-0 text-(--bc-on-surface-variant)" aria-hidden="true" />
        <input
          ref={input}
          className="h-full min-w-0 flex-1 border-0 bg-transparent font-(family-name:--bc-font-family) text-[15px] leading-tight text-(--bc-on-surface) placeholder:text-(--bc-on-surface-variant) [&::-webkit-search-cancel-button]:hidden"
          type="search"
          value={value}
          placeholder="Songs, albums, artists"
          aria-label="Search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { if (!menuOpen.current) setOpen(false); }, 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, -1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="ml-2 grid size-5 shrink-0 place-items-center rounded-full bg-(--bc-on-surface-variant)/30 text-(--bc-on-surface)"
            aria-label="Clear"
            onClick={() => {
              setValue('');
              input.current?.focus();
            }}
          >
            <X size={12} strokeWidth={2.6} />
          </button>
        )}
      </form>
      {showList && (
        <ul
          id={listId}
          className="bc-frost bc-continuous absolute top-[calc(100%+6px)] right-0 left-0 z-(--z-contextual-menus) max-h-[min(520px,65vh)] overflow-y-auto rounded-[18px] p-1.5 shadow-(--bc-shadow-menu)"
          role="listbox"
        >
          {options.map((option, i) => {
            const item = option.kind === 'item' ? option.item : null;
            const playable = item !== null && (item.kind === 'song' || item.kind === 'video');
            return (
              <li
                key={option.kind === 'query' ? `q-${option.text}` : `i-${option.item.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={option.kind === 'query' ? hint : `${lockup} ${playable ? lockupMenuCols : lockupCols}`}
                data-active={i === active || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
              >
                {option.kind === 'query' ? (
                  <>
                    <Search size={15} strokeWidth={2.2} className="text-(--bc-on-surface-variant)" aria-hidden="true" />
                    <span className="truncate">
                      <span className="font-semibold text-(--bc-on-surface)">{option.typed}</span>
                      <span className="text-(--bc-on-surface-variant)">{option.rest}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-[46px]">
                      <Artwork
                        src={option.item.thumbnail}
                        displayWidth={46}
                        radius={option.item.kind === 'artist' ? '50%' : 'var(--bc-radius-art)'}
                      />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate bc-type-title-md text-(--bc-on-surface)">{option.item.title}</span>
                      <span className="mt-0.5 truncate bc-type-body text-(--bc-on-surface-variant)">
                        {option.item.subtitle || kindLabel(option.item.kind)}
                      </span>
                    </div>
                    {playable && item && (
                      <TrackMenu
                        track={toTrack(item)}
                        onOpenChange={onMenuOpenChange}
                        className="grid size-8 place-items-center rounded-full text-(--bc-on-surface-variant) hover:bg-(--bc-hover-fill)"
                      />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const optionRow =
  'group/option cursor-pointer rounded-[12px] data-active:bg-(--bc-tab-pill-bg) hover:bg-(--bc-hover-fill)';
const hint = `${optionRow} grid grid-cols-[20px_minmax(0,1fr)] items-center gap-x-2.5 px-3 py-2.5 bc-type-body`;
const lockup = `${optionRow} grid items-center gap-x-3 px-2.5 py-1.5`;
const lockupCols = 'grid-cols-[46px_minmax(0,1fr)]';
const lockupMenuCols = 'grid-cols-[46px_minmax(0,1fr)_auto]';

function kindLabel(kind: MusicItem['kind']): string {
  return {
    song: 'Song',
    video: 'Video',
    album: 'Album',
    playlist: 'Playlist',
    'spotify-playlist': 'Spotify Playlist',
    artist: 'Artist',
    episode: 'Episode',
    podcast: 'Podcast',
    unknown: '',
  }[kind];
}
