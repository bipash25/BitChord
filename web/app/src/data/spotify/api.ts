import { best, type MatchCandidate } from '@/data/match/trackMatcher';
import { searchSongs } from '@/data/music/api';
import type { Track } from '@/data/music/types';
import { spotifyGet } from './auth';

/**
 * Spotify data through the official Web API (relay.md phase 2): the library's
 * playlists, a playlist's tracks and Liked Songs, mapped onto the shapes the
 * pages already read. Ports SpotifyLibrary.kt's paging and
 * SpotifyImporter.matchTrack; the matching to YouTube Music below is the part
 * the relay still carries (the search itself), as it always did.
 */

/** A playlist in the Spotify library; `id` is `liked` for the Liked Songs entry, which the API has no playlist for. */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: string | null;
  imageUrl: string | null;
}

export interface SpotifyTrack {
  /** The Spotify track id (base-62). */
  id: string;
  title: string;
  /** Credited artists, comma-separated. */
  artist: string;
  album: string | null;
  durationMs: number;
  imageUrl: string | null;
}

/** Liked Songs has no playlist id in the Web API; this stands in everywhere (SpotifyLibrary.LIKED_ID). */
export const LIKED_ID = 'liked';
/** Spotify's own artwork for the Liked Songs entry, which the API doesn't carry. */
const LIKED_COVER = 'https://misc.scdn.co/liked-songs/liked-songs-640.png';

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

type Json = Record<string, unknown>;

/** The widest image (SpotifyLibrary.largestSource): covers come 640 and smaller, in no fixed order. */
function imageOf(sources: unknown): string | null {
  let widest: { url: string; width: number } | null = null;
  for (const source of arr(sources)) {
    const url = str(obj(source)?.url);
    const width = num(obj(source)?.width);
    if (url && (!widest || width > widest.width)) widest = { url, width };
  }
  return widest?.url ?? null;
}

/** A saved-playlist row; rows without an id or a name (folders, removed playlists) are skipped. */
function playlistOf(item: unknown): SpotifyPlaylist[] {
  const data = obj(item);
  const id = str(data?.id);
  const name = str(data?.name);
  if (!id || !name.trim()) return [];
  return [{ id, name, owner: str(obj(data?.owner)?.display_name) || null, imageUrl: imageOf(data?.images) }];
}

/** A saved-track row: episodes and removed/local entries (a null `track`) are skipped. */
function trackOf(item: unknown): SpotifyTrack[] {
  const track = obj(obj(item)?.track);
  const id = str(track?.id);
  const title = str(track?.name);
  if (!track || !id || !title.trim()) return [];
  const album = obj(track.album);
  return [
    {
      id,
      title,
      artist: arr(track.artists)
        .map((a) => str(obj(a)?.name))
        .filter((name) => !!name.trim())
        .join(', '),
      album: str(album?.name) || null,
      durationMs: num(track.duration_ms),
      imageUrl: imageOf(album?.images),
    },
  ];
}

/** A page is the last one when Spotify says so: `next` is null after the final page, and an empty page is the safety stop. */
const lastPage = (page: Json, raw: unknown[]): boolean => !raw.length || page.next === null;

/** Every playlist in the library, Liked Songs first, however many pages it takes. */
export async function fetchSpotifyPlaylists(): Promise<SpotifyPlaylist[]> {
  // Liked Songs is not a playlist to the Web API; it always leads (SpotifyLibrary's order).
  const out: SpotifyPlaylist[] = [{ id: LIKED_ID, name: 'Liked Songs', owner: null, imageUrl: LIKED_COVER }];
  for (let offset = 0; ; ) {
    const page = await spotifyGet('/me/playlists', { limit: 50, offset });
    const raw = arr(page.items);
    out.push(...raw.flatMap(playlistOf));
    offset += raw.length;
    if (lastPage(page, raw)) break;
  }
  return out;
}

/** A playlist's name and cover at full size; Liked Songs answers from its own count. */
export async function fetchSpotifyPlaylistInfo(playlistId: string): Promise<{
  name: string;
  owner: string | null;
  imageUrl: string | null;
  total: number;
}> {
  if (playlistId === LIKED_ID) {
    const page = await spotifyGet('/me/tracks', { limit: 1, fields: 'total' });
    return { name: 'Liked Songs', owner: null, imageUrl: LIKED_COVER, total: num(page.total) };
  }
  // fields= trims off the whole first page of tracks the endpoint would otherwise return.
  const page = await spotifyGet(`/playlists/${encodeURIComponent(playlistId)}`, {
    fields: 'name,owner(display_name),images(url,width),tracks(total)',
  });
  return {
    name: str(page.name) || 'Playlist',
    owner: str(obj(page.owner)?.display_name) || null,
    imageUrl: imageOf(page.images),
    total: num(obj(page.tracks)?.total),
  };
}

/** Every track of a playlist; [onPage] gets the running list after each page, so a long one fills in. */
export async function fetchSpotifyTracks(playlistId: string, onPage: (soFar: SpotifyTrack[], total: number) => void): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  const path = playlistId === LIKED_ID ? '/me/tracks' : `/playlists/${encodeURIComponent(playlistId)}/tracks`;
  for (let offset = 0; ; ) {
    const page = await spotifyGet(path, { limit: 100, offset });
    const raw = arr(page.items);
    out.push(...raw.flatMap(trackOf));
    // The offset counts every row, including the ones filtered out above.
    offset += raw.length;
    onPage([...out], num(page.total) || out.length);
    if (lastPage(page, raw)) break;
  }
  return out;
}

/** A Spotify row as a list row, before its YouTube Music version is known. */
export function pendingTrack(track: SpotifyTrack, unavailable: 'matching' | 'missing' = 'matching'): Track {
  return {
    videoId: `spotify:${track.id}`,
    title: track.title,
    artists: track.artist ? track.artist.split(', ').map((name) => ({ name, id: null })) : [],
    album: track.album ? { name: track.album, id: null } : null,
    durationSec: track.durationMs > 0 ? Math.round(track.durationMs / 1000) : null,
    explicit: false,
    thumbnail: track.imageUrl,
    index: null,
    plays: null,
    unavailable,
  };
}

export function candidateOf(track: Track): MatchCandidate {
  return {
    title: track.title,
    artist: track.artists.map((a) => a.name).join(', '),
    durationSec: track.durationSec,
    album: track.album?.name ?? null,
    explicit: track.explicit,
  };
}

const matched = new Map<string, Track | null>();

/**
 * The YouTube Music song that is [track], or null if there is none: the best
 * candidate by title, artist, length and album, and failing that the search's
 * first hit (SpotifyImporter.matchTrack).
 */
export async function matchToYouTube(track: SpotifyTrack): Promise<Track | null> {
  if (matched.has(track.id)) return matched.get(track.id)!;
  const query = [track.title, track.artist].filter((s) => s.trim()).join(' ');
  const candidates = await searchSongs(query);
  const target = {
    title: track.title,
    artist: track.artist,
    durationSec: track.durationMs > 0 ? Math.round(track.durationMs / 1000) : null,
    album: track.album,
  };
  const scored = best(candidates.map((c) => ({ ...candidateOf(c), track: c })), target);
  const found = scored?.track ?? candidates[0] ?? null;
  const result = found && { ...found, thumbnail: found.thumbnail ?? track.imageUrl };
  matched.set(track.id, result);
  return result;
}
