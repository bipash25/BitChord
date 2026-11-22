import { ListMusic, Settings } from 'lucide-react';
import { PrefetchLink, PrefetchNavLink } from '@/components/PrefetchLink';
import { LogoMark } from '@/components/icons/LogoMark';
import {
  AlbumsIcon,
  AllPlaylistsIcon,
  AndroidExploreIcon,
  AndroidHomeIcon,
  AndroidSearchIcon,
  ArtistsIcon,
  MadeForYouIcon,
  RecentlyAddedIcon,
  SongsIcon,
  type NavIconProps,
} from '@/components/icons/NavIcons';
import { hrefFor } from '@/components/music/links';
import { LIBRARY_SECTIONS, type LibrarySection } from '@/data/music/library';
import { useLibraryPlaylists, useSignedIn } from '@/data/music/queries';
import { useSpotifyPlaylists } from '@/data/spotify/queries';
import { useSpotifySignedIn } from '@/data/spotify/auth';
import { useUi } from '@/state/ui';
import { AccountButton } from './AccountButton';

interface NavItem {
  to: string;
  label: string;
  Icon: (props: NavIconProps) => React.ReactNode;
}

const PRIMARY: NavItem[] = [
  { to: '/home', label: 'Home', Icon: AndroidHomeIcon },
  { to: '/new', label: 'Explore', Icon: AndroidExploreIcon },
  { to: '/search', label: 'Search', Icon: AndroidSearchIcon },
];

const LIBRARY_ICONS: Record<Exclude<LibrarySection, 'playlists'>, NavItem['Icon']> = {
  recent: RecentlyAddedIcon,
  artists: ArtistsIcon,
  albums: AlbumsIcon,
  songs: SongsIcon,
  'made-for-you': MadeForYouIcon,
};

const LIBRARY: NavItem[] = (Object.keys(LIBRARY_ICONS) as (keyof typeof LIBRARY_ICONS)[]).map((section) => ({
  to: section === 'recent' ? '/history' : `/library/${section}`,
  label: section === 'recent' ? 'History' : LIBRARY_SECTIONS[section].title,
  Icon: LIBRARY_ICONS[section],
}));

// Android-ported rail row: SF Pro type, --bc-tab-pill-bg active fill, 16px outer gutter.
const item =
  'group flex h-9 items-center gap-2.5 mb-0.5 px-2.5 rounded-[12px] font-(family-name:--bc-font-family) text-[14px] leading-none font-normal tracking-(--bc-tracking-body) text-(--bc-on-surface) hover:bg-(--bc-surface-variant) aria-[current=page]:bg-(--bc-tab-pill-bg) aria-[current=page]:font-semibold';
const icon = 'inline-grid size-6 flex-none place-items-center text-(--bc-on-surface-variant) group-aria-[current=page]:text-(--bc-primary)';
const navLabel = 'min-w-0 truncate';
const sectionHeader =
  'mt-4 px-2.5 py-1 font-(family-name:--bc-font-family) text-[11px] leading-tight font-semibold tracking-(--bc-tracking-label-sm) uppercase text-(--bc-on-surface-variant)';
const list = 'flex flex-col';

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <ul className={list}>
      {items.map(({ to, label, Icon }) => (
        <li key={to}>
          <PrefetchNavLink to={to} className={item} onClick={onNavigate}>
            <Icon size={24} className={icon} />
            <span className={navLabel}>{label}</span>
          </PrefetchNavLink>
        </li>
      ))}
    </ul>
  );
}

/** Library and Playlists (report §1), once YouTube requests are made as the user. */
function LibraryNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useLibraryPlaylists();
  return (
    <>
      <h2 className={sectionHeader}>Library</h2>
      <NavList items={LIBRARY} onNavigate={onNavigate} />
      <h2 className={sectionHeader}>Playlists</h2>
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/library/playlists" className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={24} className={icon} />
            <span className={navLabel}>{LIBRARY_SECTIONS.playlists.title}</span>
          </PrefetchNavLink>
        </li>
        {playlists.data?.map((playlist) => (
          <li key={playlist.id}>
            <PrefetchNavLink to={hrefFor(playlist) ?? '/library/playlists'} className={item} onClick={onNavigate}>
              <span className={icon}>
                <ListMusic size={17} strokeWidth={1.8} />
              </span>
              <span className={navLabel}>{playlist.title}</span>
            </PrefetchNavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Spotify's playlists, once the page is signed in to Spotify as the user (prompt §7.1). */
function SpotifyNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useSpotifyPlaylists();
  return (
    <>
      <h2 className={sectionHeader}>Spotify</h2>
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/spotify" end className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={24} className={icon} />
            <span className={navLabel}>All Spotify Playlists</span>
          </PrefetchNavLink>
        </li>
        {playlists.data?.map((playlist) => (
          <li key={playlist.id}>
            <PrefetchNavLink to={`/spotify/playlist/${encodeURIComponent(playlist.id)}`} className={item} onClick={onNavigate}>
              <span className={icon}>
                <ListMusic size={17} strokeWidth={1.8} />
              </span>
              <span className={navLabel}>{playlist.name}</span>
            </PrefetchNavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The frosted desktop rail (>=1000px) and mobile secondary library drawer (<1000px). */
export function Sidebar() {
  const drawerOpen = useUi((s) => s.drawerOpen);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const signedIn = useSignedIn();
  const spotifySignedIn = useSpotifySignedIn();
  const close = () => setDrawerOpen(false);

  return (
    <>
      <nav
        className="bc-frost absolute inset-y-0 left-0 z-(--z-web-chrome) flex w-(--bc-sidebar-w) flex-col border-0 border-r-[0.5px] border-r-(--bc-glass-edge) max-lg:fixed max-lg:z-[calc(var(--z-web-chrome)+2)] max-lg:w-[min(300px,82vw)] max-lg:-translate-x-full max-lg:shadow-(--bc-shadow-menu) max-lg:transition-transform max-lg:duration-260 max-lg:ease-[cubic-bezier(0.2,0,0,1)] max-lg:data-[open=true]:translate-x-0"
        data-open={drawerOpen}
        aria-label="Main"
      >
        <div className="mt-2 flex h-16 items-center px-(--bc-page-gutter)">
          <PrefetchLink to="/home" className="inline-flex items-center gap-2 rounded-[8px]" aria-label="BitChord, Home" onClick={close}>
            <LogoMark size={22} className="text-(--bc-on-surface)" />
            <span className="font-(family-name:--bc-font-family) text-[20px] leading-tight font-bold tracking-(--bc-tracking-title) text-(--bc-on-surface)">BitChord</span>
          </PrefetchLink>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-(--bc-page-gutter) [scrollbar-width:none]">
          <NavList items={PRIMARY} onNavigate={close} />
          {signedIn ? (
            <LibraryNav onNavigate={close} />
          ) : (
            <>
              <h2 className={sectionHeader}>Library</h2>
              <ul className={list}>
                {LIBRARY.map(({ to, label, Icon }) => (
                  <li key={to}>
                    <PrefetchNavLink to={to} className={item} onClick={close}>
                      <Icon size={24} className={icon} />
                      <span className={navLabel}>{label}</span>
                    </PrefetchNavLink>
                  </li>
                ))}
                <li>
                  <PrefetchNavLink to="/library/playlists" className={item} onClick={close}>
                    <AllPlaylistsIcon size={24} className={icon} />
                    <span className={navLabel}>{LIBRARY_SECTIONS.playlists.title}</span>
                  </PrefetchNavLink>
                </li>
              </ul>
            </>
          )}
          {spotifySignedIn && <SpotifyNav onNavigate={close} />}
        </div>
        <div className="flex flex-col gap-2 px-(--bc-page-gutter) pt-3 pb-5">
          <AccountButton />
          <div className="flex justify-end">
            <PrefetchNavLink
              to="/settings"
              className="grid size-8 place-items-center rounded-[10px] text-(--bc-on-surface-variant) hover:bg-(--bc-surface-variant) hover:text-(--bc-on-surface) aria-[current=page]:bg-(--bc-tab-pill-bg) aria-[current=page]:text-(--bc-on-surface)"
              aria-label="Settings"
              title="Settings"
              onClick={close}
            >
              <Settings size={17} strokeWidth={1.9} />
            </PrefetchNavLink>
          </div>
        </div>
      </nav>
      {drawerOpen && <div className="fixed inset-0 z-[calc(var(--z-web-chrome)+1)] hidden bg-black/50 max-lg:block" onClick={close} aria-hidden="true" />}
    </>
  );
}
