# Android app vs web app: a component-by-component UI comparison

Read on 2026-11-22, branch `server-relay`. Every claim cites the file and line it was read from (paths are repo-root relative). Where a component does not exist on a side, that is said plainly rather than padded.

**Purpose.** The two apps share a catalogue and a playback engine but not a design language, and the web team should plan from the *feature and interaction* deltas, not the visual ones. This doc lists, per surface: what Android has, what the web has, what is missing on the web, what behaves differently, and what is web-only.

**The two design languages.**

- **Android** is Telegram-style frosted Material 3 with an Apple-Music accent: Haze/liquid-glass surfaces over the page (`app/src/main/java/com/music/bitchord/MainActivity.kt:533`, `app/src/main/java/com/music/bitchord/ui/components/LiquidGlass.kt:22`), a floating tab bar (`app/src/main/java/com/music/bitchord/ui/components/FloatingBottomBar.kt:178`), an iOS-26 folding nav bar (`app/src/main/java/com/music/bitchord/ui/components/GlassNavBar.kt:1`), SF Pro Display set one weight lighter than asked (`app/src/main/java/com/music/bitchord/ui/theme/Theme.kt:1`), iOS-rubber-band overscroll (`app/src/main/java/com/music/bitchord/ui/utils/IosOverscroll.kt:9`), haptics on every toggle, and artwork-derived page palettes (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/theme/ArtworkPalette.kt:1`).
- **Web** is a measured replica of Apple Music's web player: glass sidebar, floating player pill, side panels, shelves with hover arrows, DM Sans on Apple's type scale. The contract is `web/docs/apple-music-dom.md` (measurement report the tokens are written from, `web/docs/apple-music-dom.md:5`), applied in `web/app/src/styles/tokens.css`.

Both are deliberate. The comparison below treats the visual difference as context, not a defect.

---

## 1. Navigation shell

**Android** (`app/src/main/java/com/music/bitchord/MainActivity.kt:514`): four tabs — Home, Explore, Library, Search (`MainActivity.kt:1347-1353`) — held in a floating bottom bar with a spring selection pill that stretches in travel and deforms under drag (`FloatingBottomBar.kt:147`, `:283-287`, drag-to-switch `:295-335`), or, when liquid glass is on, the folding GlassNavBar where the mini player and the tabs are one component (`GlassNavBar.kt:1-10`). Pushed pages (Settings and its sections, History, Replay, Equalizer, Downloads, Sources, Listen Together, Spotify, Discord, Wear OS, Show-all grids) live on one back stack interleaved with release pages (`app/src/main/java/com/music/bitchord/ui/navigation/AppNavigator.kt:18-52`, `:79-157`). Tabs swap with no fade; pages crossfade (`MainActivity.kt:2882-2896`). Page state is saved per route while on the stack (`MainActivity.kt:1310-1321`).

**Web** (`web/app/src/pageRegistry.tsx:26-43`): react-router with lazy pages and per-route skeletons (`web/app/src/routes.tsx:5-13`). Navigation is a fixed 260px glass sidebar (`web/app/src/shell/Sidebar.tsx:135-177`): Search/Home/New, then Library sections and playlists, then Spotify playlists, an account control and a settings gear. Below 484px the sidebar becomes a drawer behind a 52px top bar (`Sidebar.tsx:144-147`, `web/app/src/shell/MobileTopBar.tsx:7-21`). Every link prefetches its chunk and first query on hover/focus (`web/app/src/components/PrefetchLink.tsx:9-24`, `pageRegistry.tsx:55-62`).

- **Missing on web:** no bottom tab bar at phone widths (phone users get the sidebar drawer only); no pushed-page stack semantics beyond the router (fine); no tab-content swap distinction.
- **Different:** Android's bar is a draggable tab switcher with haptics (`FloatingBottomBar.kt:328-331`); the web has no tab bar and no drag affordance.
- **Web-only:** chunk prefetching, route skeletons (`web/app/src/skeletons/PageSkeletons.tsx`), per-route lazy loading.

## 2. Home

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/screens/HomeScreen.kt:1-40`): YouTube Music's feed shelves, a Recents track shelf, plus **Top Picks** — 3:4 portrait animated cards (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/screens/TopPicksShelf.kt:1-10`, artwork motion gated by app foreground/player state at `MainActivity.kt:565-573`) — and **Find Your Mood** (`MainActivity.kt:2983-2988`, grid route `AppNavigator.kt:41-42`). Pull-to-refresh per feed (`MainActivity.kt:1238-1263`). Shelves can be hidden from Settings (`MainActivity.kt:852-855`; rows at `app/src/main/java/com/music/bitchord/ui/screens/SettingsSheet.kt:928`, `:942`, `:957`, `:971` — content preferences group at `SettingsSheet.kt:911`).

**Web** (`web/app/src/pages/HomePage.tsx:27-81`): the same feed shelves plus a Recently Played track shelf built from the library's `recent` query (`HomePage.tsx:19-24`), infinite shelves via IntersectionObserver (`HomePage.tsx:35-46`).

- **Missing on web:** Top Picks shelf, Find Your Mood, hide-shelf preferences, pull-to-refresh.
- **Different:** Android's Recents is a first-class shelf on the Library tab too; the web derives it from the same query either way (`HomePage.tsx:17-24`).
- **Web-only:** a failed *later* feed page shows under the loaded ones with a Try Again (`HomePage.tsx:78`).

## 3. Explore / New / categories

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/screens/ExploreScreen.kt:1-14`): moods & genres as duotone tiles — the category's cover multiplied/screened into its stripe colour (`ExploreScreen.kt:6-14`), with a New-releases/trending feed as shelves.

**Web** (`web/app/src/pages/NewPage.tsx:8-35`): Explore as shelves; the search landing shows the same mood/genre tiles with the same duotone treatment and left stripe (`web/app/src/components/music/CategoryTiles.tsx:40-104`), borrowing each category's first cover since the moods feed sends none (`CategoryTiles.tsx:109-114`).

- **Parity:** the duotone tile is faithfully ported; the moods grid is reachable only through search on the web, not as its own page (`AppNavigator.kt:41-42` on Android vs no `/moods` route in `pageRegistry.tsx:26-43`).

## 4. Search

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/screens/SearchScreen.kt:1-30`): result sections by kind (Songs/Artists/Albums/Playlists/More), a source filter (YouTube/Library/addons — `MainActivity.kt:901-903` holds `searchSource`/`addonResults`), YouTube filter pills via the app's segmented control (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/components/PillSegmentedControl.kt:9`), persistent search history (`app/src/main/java/com/music/bitchord/data/settings/SearchHistory.kt:1`), and Library-tab results searched in the same field.

**Web** (`web/app/src/pages/SearchPage.tsx:151-170`): a sticky glass scope bar with the centred pill field, browse-category landing, Top Results grid (`SearchPage.tsx:42-85`), and Apple's result shelves in Apple's order (`SearchPage.tsx:29-39`). Suggestions are a glass dropdown with keyboard selection (`web/app/src/components/music/SearchField.tsx:60-176`).

- **Missing on web:** search history, scope/filter pills, searching local/addon sources.
- **Different:** the web field navigates to `/search?q=`; Android keeps the query in a view model and refocuses on tab tap (`MainActivity.kt:781-784`).

## 5. Album detail

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/DetailScreen.kt:301`): release page tinted end-to-end from the sleeve (`DetailScreen.kt:436-439`), original track numbers preserved under re-sorting (`:378-386`), a per-page song sort and a filter box owned by the top bar (`:356`, `:441-465`), a whole-release download affordance where the source has one (`:931`, `:1125-1130`), animated cover art (Spotify Canvas) on album headers (`:487-509`), and reorder-in-place for playlists (`:364-369`, `app/src/main/java/com/music/bitchord/ui/components/ReorderPlaylistPage.kt:1`).

**Web** (`web/app/src/pages/AlbumPage.tsx:15-64`): page tint from the artwork (`AlbumPage.tsx:19`), Apple motion artwork over the cover (`AlbumPage.tsx:20`, `web/app/src/components/music/MotionArtwork.tsx:15-83`), numbered virtualized track list (`web/app/src/components/music/TrackList.tsx:15-17`, `:230-236`), detail footer and "more" shelves on the alternate background (`AlbumPage.tsx:51-61`), header with radiosity glow, Shuffle/Play/Add-to-Library and a three-line description with MORE (`web/app/src/components/music/DetailHeader.tsx:35-122`).

- **Missing on web:** per-page sort, in-page filter, whole-release download, playlist reorder.
- **Different:** Android plays straight from rows and swipes; the web uses double-click on rows (`TrackList.tsx:109`) and hover-revealed play buttons.
- **Web-only:** virtualization threshold, unavailable-row states for Spotify matching (`TrackList.tsx:41`, `:108`).

## 6. Artist detail

**Android** (`DetailScreen.kt:392-435`): Apple Music's photo, title logo, colour and video clip where Apple has the artist, confirmed by a cross-catalogue title match; a user-configured **artist-signature API** as a secondary logo source with bounded retries (`:405-435`; editor at `app/src/main/java/com/music/bitchord/ui/screens/SignatureApiEditor.kt:1`). The page dissolves the photo into the palette (`:540-575`), offers subscribe/unsubscribe (`:340-344`), shows artist stats chips (`:1800`), and draws each shelf in place with its own Show-all route (`AppNavigator.kt:35-39`).

**Web** (`web/app/src/pages/ArtistPage.tsx:60-155`): full-bleed hero at 1.93:1 with Apple's photo fading in over YouTube's (`:83-95`), masked blur melt into the page colour (`:96-100`), Apple's title logo with a name stand-in (`:25-52`), the 56px play circle taking Apple's key colour (`:104-119`), Top Songs shelf, shelves, About, and a relay-permission pill for Apple art (`:120-132`).

- **Missing on web:** the signature API (row at `SettingsSheet.kt:1219`, `:1235`), subscribe/unsubscribe, artist stats, per-shelf Show-all routes (the web links straight to `/browse/:id`).
- **Parity:** Apple art + logo + colour are on both.

## 7. Playlist detail

**Android**: same release template (`DetailScreen.kt:301`), with a description in the header, reorder (`DetailScreen.kt:364-369`), and per-playlist sort keyed by browse id (`MainActivity.kt:964-969`).

**Web** (`web/app/src/pages/PlaylistPage.tsx:14-48`): header + paginated track list loading on scroll (`:21-42`), tint from artwork. Spotify playlists additionally carry a two-tap Import-to-YouTube button with live matching counts (`web/app/src/pages/SpotifyPlaylistPage.tsx:46-52`, `:83-114`).

- **Missing on web:** reorder, per-playlist sort. **Web-only:** the matching-progress meta line and Import button (`SpotifyPlaylistPage.tsx:46-52`) — Android's counterpart is the paste-a-link import alert (`app/src/main/java/com/music/bitchord/ui/components/SpotifyImportAlert.kt:1`).

## 8. Library

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/screens/LibraryScreen.kt:1-14`): saved collections as shelves, deliberately withoutLiked/Songs rows; under the Replay cards sit the device folders — Downloads, Local Music, the song cache, WebDAV, SMB — and an "On device" shelf of whole downloaded releases (`app/src/main/java/com/music/bitchord/ui/screens/LibraryPhoneParts.kt:1-14`); a connected Spotify row opens `SpotifyLibraryScreen` (`LibraryPhoneParts.kt:26-27`, `app/src/main/java/com/music/bitchord/ui/screens/SpotifyLibraryScreen.kt:1`); Show-all grids as routes (`AppNavigator.kt:31-32`); a multi-select with batch download on folder pages (`app/src/main/java/com/music/bitchord/ui/screens/LocalFolder.kt:27-31`).

**Web** (`web/app/src/pages/LibraryPage.tsx:29-97`): Recently Played / Artists / Albums / Songs / Made for You / All Playlists as sections with grids and track lists, sign-in gate, load-more observer.

- **Missing on web:** device folders, On-device shelf, multi-select downloads (all native-only — see §19), Replay cards and folders on the page, Show-all routes.

## 9. History

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/HistoryScreen.kt:1-10`): a route-pushed plain list of the account's listening history, newest first; tapping plays it as a queue; rows support the held track menu with **Remove from listening history** (`SongActionsMenu.kt:341-348`, gate `:129-134`).

**Web**: no history page exists (`pageRegistry.tsx:26-43`). The only history surfaces are the Home "Recently Played" shelf (a library feed query, `HomePage.tsx:19-24`) and the optional *outbound* share of plays to the YouTube account (`web/app/src/playback/historyReporting.ts`, wired at `web/app/src/shell/AppShell.tsx:36`).

- **Missing on web:** the page, per-row removal, history-as-queue. The underlying YouTube data is already reachable through the same repository the `recent` library section uses, so this is the cheapest headline gap (see §25).

## 10. Listen Together

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/ListenTogetherScreen.kt:1-16` + sheets `app/src/main/java/com/music/bitchord/ui/screens/ListenTogetherSheets.kt:1-40`): start/join screens with the avatar glow, the party's live position readout under "Now playing" as the sync proof, member rows with host crown and connection dots, QR invite codes drawn to the theme (`app/src/main/java/com/music/bitchord/ui/components/QrCode.kt:1-10`), a custom party-server editor (`app/src/main/java/com/music/bitchord/ui/screens/PartyServerEditor.kt:1-13`), a server-health line before anything else (`ListenTogetherScreen.kt:18-22`), invite links handled in-app (`MainActivity.kt:913-935`), host-only control, and queue-drag coordination with party sync (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/NowPlayingScreen.kt:813-821`).

**Web** (`web/app/src/pages/ListenTogetherPage.tsx:40-303`): start/join, `/invite/:code` route that previews the party and joins on tap for audio autoplay reasons (`:37-39`, `:154-186`), members with crown/dot/kick (`:238-256`), AutoPlay + host-only toggles (`:259-275`), an activity feed (last 8, `:278-295`), custom server + nickname (`:126-148`), copy-invite-link (`:226-233`), connection status with round-trip ms (`:211-218`). The player stays in step via `startPartySync` (`AppShell.tsx:31-34`), and AutoPlay defers to the party's setting in the Up Next panel (`web/app/src/shell/UpNext.tsx:110-113`).

- **Missing on web:** the QR code (copy-link only), the party position readout, the server-health line, the start-a-party-carries-current-playback behaviour is only implied (`:93-95`).
- **Different:** the web page doubles as the Settings sub-page; Android keeps a dedicated screen plus player-side party capsule (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/PlayerControls.kt:956-1018`).

## 11. Settings

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/SettingsSheet.kt:189`): a searchable page — typed on the main page it lays out matching rows from every category at once (`:416-425`); categories are pages of their own (`:2820-2831`: Downloads, Playback, Content preferences, Appearance, Performance, Local music, Storage, Your data, Miscellaneous, Language), choices with long option lists get their own pages (`:2849-2856`, `:2880`). Representative rows: audio quality per network (`:535-554`), Dolby Atmos (`:566`), download quality (`:611`), output precision / USB DAC / bit-perfect (`:658`, `:680`, `:689`), loudness normalization (`:758`), crossfade (`:789`), Automix (`:805`), skip silence (`:838`), spatial audio (`:866`), equalizer (`:899`), theme/font/glass/performance (`:1003`, `:1013`, `:1038-1104`, `:1328`, `:1360`), player options (`:1118-1198`), synced lyrics + sources + blur + translation language (`:1260-1307`), cache limits (`:1428-1473`), Replay genre weighting (`:1510`), backup export/import (`:1529`, `:1538`), queue/history/swipe/misc toggles (`:1552-1706`), app icon (`:1706`), app language (`:1770`). iOS-style switches throughout (`app/src/main/java/com/music/bitchord/ui/components/IosSwitch.kt:1-12`).

**Web** (`web/app/src/pages/SettingsPage.tsx:59-205`): Account & Integrations (relay account text, Spotify PKCE row, share-history toggle `:96-107`), Apple Music section (relay access + artist art + animated artwork toggles, `web/app/src/pages/IntegrationSettings.tsx:29-47`), Listen Together link row, Playback (AutoPlay, Crossfade *with an Automix option in the same Select*, Blend length, Stats for nerds `:130-181`), Lyrics (Lyric Sources modal + relay host-access row `:183-196`). The pop-up button is Apple's idiom (`web/app/src/components/Select.tsx:18-26`).

- **Missing on web** (grouped by feasibility): settings search; per-network audio quality; skip silence; loudness normalization; equalizer/spatial audio (see §17); download settings (native-only); appearance/performance options (glass is native); storage/cache management (native); backup export/import; app language / translation language; content-preference toggles; in-player toggles (queue history, swipe, status bar).
- **Different:** the web explains Automix's unavailability over the relay inline (`SettingsPage.tsx:141-146`); Android has no such split because its engine is local.

## 12. Account & scrobbling

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/AccountAndScrobblingScreen.kt:1`, row from `SettingsSheet.kt:461-499`): the signed-in Google account, channel/profile selection (`app/src/main/java/com/music/bitchord/ui/components/AccountProfileSelector.kt:5`, `AccountChannelDialog.kt:1`), **Last.fm** and **ListenBrainz** scrobbling with login alerts, now-playing toggle and scrobble thresholds (`SettingsSheet.kt:318-327`, `AccountAndScrobblingScreen.kt:152-232`; login alerts in `app/src/main/java/com/music/bitchord/ui/components/AccountAlerts.kt:1-8`).

**Web** (`web/app/src/shell/AccountButton.tsx:19-66`): deliberately account-less — the relay's shared fallback identity is named, never signed into (`AccountButton.tsx:19-31`); the sidebar bottom row links out to the Android app (`Sidebar.tsx:165-168`).

- **Missing on web:** scrobbling entirely (Last.fm/ListenBrainz); channel/profile switching is a relay-model consequence, not a gap. Note Discord Rich Presence is likewise Android-only now: it existed on the web behind an extension-era build flag (`web/docs/spotify-and-discord.md:51-60`) and has no row in the relay-era `SettingsPage.tsx`.

## 13. Player (now playing)

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/NowPlayingScreen.kt:755`): a modal sheet with Apple-spring motion (`app/src/main/java/com/music/bitchord/ui/player/PlayerSheetMotion.kt:1-9`), shared-element artwork flying to/from the mini player (`MainActivity.kt:574-589`), artwork palette background or artwork-derived mesh (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/ArtworkMeshBackdrop.kt:1-10`, legacy mesh `NowPlayingScreen.kt:355-370`), **swipe-on-artwork to skip** with a hint nudge (`NowPlayingScreen.kt:1610-1640`, `:2141-2148`), Spotify Canvas full-screen with auto-hide (`NowPlayingScreen.kt:932-944`), music video picture held to the audio clock (`app/src/main/java/com/music/bitchord/ui/player/MusicVideoPlayer.kt:1-14`), landscape two-column player (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/LandscapePlayer.kt:1-10`) and a tablet side-by-side player (`MainActivity.kt:2838-2852`, `NowPlayingScreen.kt:603-620`), queue drawer with drag (`PlayerQueue.kt:1-14`), DJ **MixView popup** for Automix (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/MixViewPopup.kt:1-10`), audio output sheet with Cast and watch output (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/AudioOutputSheet.kt:1-10`, `app/src/main/java/com/music/bitchord/ui/player/AndroidPlayerHost.kt:137-170`), the output/party capsule in the action row (`PlayerControls.kt:956-1058`), DAC hardware volume with a HUD (`AndroidPlayerHost.kt:290-322`, `app/src/main/java/com/music/bitchord/ui/components/DacVolumeHud.kt:1-8`), audio-pipeline readout (`app/src/main/java/com/music/bitchord/ui/components/AudioPipelineDialog.kt:1-16`), nerd stats on the sleeve (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/PlayerControls.kt:370`), playback origin caption (`:164-165`), and hide-status-bar/immersive options (`SettingsSheet.kt:1631`).

**Web** (`web/app/src/shell/FullScreenPlayer.tsx:137-423`): fixed overlay with animated mesh backdrop of the artwork's colours (`web/app/src/shell/MeshBackdrop.tsx:198-291`), theatre mode for music videos with idle-hidden controls (`FullScreenPlayer.tsx:124`, `:227-231`, `:246`), browser fullscreen toggle (`:210-220`), **video quality picker** (`web/app/src/shell/VideoQuality.tsx:16-72`), scrubber with Automix beat pulse and "Mixing" label (`web/app/src/shell/useScrubber.ts:45-141`), Automix window highlight on the bar (`web/app/src/shell/NerdStats.tsx:128-160`), stats-for-nerds stream + Automix lines (`NerdStats.tsx:13-99`), favorite + track menu beside the names (`FullScreenPlayer.tsx:360-371`), lyrics/queue columns (`:378-391`), volume with wheel steps (`web/app/src/shell/VolumeControl.tsx:50-67`), Apple motion artwork (`FullScreenPlayer.tsx:321-328`).

- **Missing on web:** artwork swipe-to-skip, Canvas artwork (web uses Apple motion instead), queue drawer + Automix *deck* popup in the player (the web has the stats line and the bar highlight but no deck view), output switching/Cast, party capsule, DAC volume, landscape/two-pane player, playback-origin caption, immersive options, square-video-thumbnails option (`SettingsSheet.kt:985`; web always uses its own layout).
- **Parity worth noting:** Automix exists on both; the web's scrubber pulse is a port of the phone's MixPulse (`useScrubber.ts:10-24`).
- **Web-only:** browser fullscreen, keyboard shortcuts (`web/app/src/shell/useKeyboardShortcuts.ts:27-31`), video-quality picker (Android's music-video quality lives in `MusicVideoEngine`, surfaced in the player rather than as this glass chip).

## 14. Lyrics

**Android** (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/PlayerLyrics.kt:1-100`): word/line-synced display with swept fill and glow bloom (`:786-928`), **romanization and translation** modes (`:505`), per-track provider sheet (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/LyricsProviderSheet.kt:1-6`), an **offset sheet** driven by the player's thin slider (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/LyricsOffsetSheet.kt:1`, row at `SongActionsMenu.kt:403-410`), optional lyric blur (`SettingsSheet.kt:1279`), lower-half tap-to-seek disambiguation (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/LyricsControlsGesture.kt:1-10`), and **pick-mode share**: select lines, render a 9:16 card with sleeve + mark, save or share (`app/src/main/java/com/music/bitchord/ui/player/LyricsShareCard.kt:1-13`, sheet `app/src/main/java/com/music/bitchord/ui/player/AndroidLyricsShareSheet.kt:1-10`, availability gate `AndroidPlayerHost.kt:246`). Sources dialog with drag-order and syllable preference (`app/src/main/java/com/music/bitchord/ui/components/LyricsSourcesDialog.kt:1-10`); translation language picker (`app/src/main/java/com/music/bitchord/ui/components/TranslationLanguageDialog.kt:1-10`).

**Web** (`web/app/src/shell/LyricsPanel.tsx:340-385`): am-lyrics fed a steered TTML clock (`:95-228`), provider picker with per-provider found/missing states (`:239-308`), settings modal with provider order, syllable preference, PaxSenix key and relay host-access (`web/app/src/shell/LyricsSettings.tsx:22-135`), line-click seek (`LyricsPanel.tsx:115-118`), full-screen sizing steps (`:330-332`), named empty states (`:372-382`).

- **Missing on web:** offset control, translation/romanization (am-lyrics' own toolbar is deliberately suppressed, `LyricsPanel.tsx:26-32`), lyric blur toggle, pick-and-share card.
- **Parity:** provider ordering, syllable preference and provider status exist on both — the web settings modal is a faithful port (`LyricsSettings.tsx:17-21`).

## 15. Queue / Up Next

**Android** (`PlayerQueue.kt:1-14`, `NowPlayingScreen.kt:812-822`): drag-to-reorder that coordinates with party sync, remove, clear, jump-to, an optional **queue history** section under the queue (`SettingsSheet.kt:1646`), AutoPlay toggle, and rows that animate placement on reorder (`PlayerQueue.kt:8-14`). Outside the player, queue confirmations surface as a strip above the mini player (`app/src/main/java/com/music/bitchord/ui/components/QueueActionNotice.kt:6-10`) — also the host-only notice (`MainActivity.kt:1115-1146`).

**Web** (`web/app/src/shell/UpNext.tsx:106-207`): three-tier list (user queue then AutoPlay's radio section, `:122-127`), drag reorder with a key-colour drop line (`:36-53`), per-row remove ✕ / ⋯ menu with Play Now / Play Next / Remove (`:59-99`), Clear, AutoPlay toggle, crossfade/automix options menu (`:163-178`), "Playing from" caption (`:180`), double-click jump (`:54`).

- **Missing on web:** the queue-history section; queue confirmations as toasts (the web relies on the visible list itself).
- **Parity:** drag, remove, clear, AutoPlay and the crossfade menu are all present.

## 16. Mini player

**Android** (`app/src/main/java/com/music/bitchord/ui/components/MiniPlayer.kt:351`): frosted pill above the tab bar with **horizontal swipe to skip** and **vertical pull to open the player** with rubber-band lift (`:141-175`, `:212-315`), haptics, music video at 16:9 in the cover (`:345-451`), or folded into the GlassNavBar accessory (`GlassNavBar.kt:11-16`); artwork flies between bar and player (`MiniPlayer.kt:317-343`).

**Web** (`web/app/src/shell/MobilePlayerBar.tsx:19-76`): a docked mini player for phones only (the desktop pill is the PlayerBar), artwork + title + play/next, tap opens the full-screen player, errors named in place (`:28-31`). The desktop `PlayerBar` is the Apple pill (`web/app/src/shell/PlayerBar.tsx:30-114`) with the LCD as its centre (`web/app/src/shell/Lcd.tsx:96-179`) — the LCD artwork itself opens the full-screen player (`Lcd.tsx:122-127`).

- **Missing on web:** swipe gestures on the mini player (both mobile and desktop); the desktop pill opens the player only via artwork/LCD, not by tapping the bar body.
- **Parity:** the mobile bar was explicitly built to unblock phone use over the relay (`MobilePlayerBar.tsx:9-17`).

## 17. Equalizer & audio output

**Android** (`app/src/main/java/com/music/bitchord/ui/screens/EqualizerScreen.kt:71-80`): an equalizer in two modes — **Dynamic** (a puck over a dot grid: tilt the spectrum, shape the middle) and **Manual** (seven-band graphic with a preset list) — both driving the same filters (`:71-80`, modes at `:161`, `:192`); presets as their own page (`:801-861`): Flat, Acoustic, Bass boost, Electronic, Rock, Hip-hop, Jazz, Classical, Small speakers, Late night, Custom. Plus spatial audio (`SettingsSheet.kt:866`), skip silence (`:838`), loudness normalization (`:758`), output precision/bit-perfect/USB DAC settings (`:658-689`), live audio-pipeline readout (`AudioPipelineDialog.kt:1-16`), output device sheet (`AudioOutputSheet.kt:1-10`), Cast receivers dialog (`app/src/main/java/com/music/bitchord/ui/components/CastDialog.kt:1-7`), DAC volume HUD (`DacVolumeHud.kt:1-8`).

**Web**: none of this exists. The web's audio controls are crossfade/automix (`SettingsPage.tsx:130-167`, `UpNext.tsx:163-178`) and volume (`VolumeControl.tsx`). Chromium's `setSinkId` could power an output picker, and a Web-Audio equalizer is technically feasible over the element decks, but both are unbuilt; Cast would be a sender-SDK project.

- **Missing on web (native-leaning):** bit-perfect/DAC/Cast/watch output are hardware paths — mark native-only. **Feasible on web:** equalizer + presets (M), loudness normalization (M), output device via `setSinkId` (M), skip silence (M).

## 18. Replay / stats

**Android** (`app/src/main/java/com/music/bitchord/ui/replay/ReplayScreen.kt:3-10`): a Replay page (four headline cards, four charts, play/share everything) washed in the top song's colours; the same page as a run of **full-screen story cards** (`app/src/main/java/com/music/bitchord/ui/replay/ReplayStories.kt:1-16`) with period selection (`app/src/main/java/com/music/bitchord/ui/replay/ReplayModel.kt:1-10`); a **drawn poster** rendered to a bitmap for sharing (`app/src/main/java/com/music/bitchord/ui/replay/ReplayPoster.kt:1-12`) and a share sheet with app row (`app/src/main/java/com/music/bitchord/ui/replay/ReplayShareSheet.kt:1-10`); entry points from Library cards and Settings (`SettingsSheet.kt:1501`, `:1510`).

**Web**: no Replay, no stats page; the nearest surface is the Debug page's track log (`web/app/src/pages/DebugPage.tsx:51-136`) and stats-for-nerds.

- **Missing on web:** the whole feature. The listening data partially exists via the YouTube history/library queries; the stories/poster are presentation work. Rank L (see §25).

## 19. Downloads & offline (native-only)

**Android**: per-track download row with live state and cancel/delete (`SongActionsMenu.kt:477-549`), batch download indicator + manager sheet (`app/src/main/java/com/music/bitchord/ui/components/DownloadManagerSheet.kt:1-14`), download-quality and Wi-Fi-only settings (`SettingsSheet.kt:611`, `:624`), whole-release saves from a release page (`DetailScreen.kt:931`), downloaded releases as an On-device shelf (`LibraryPhoneParts.kt:9-14`), and local/SMB/WebDAV libraries (`app/src/main/java/com/music/bitchord/ui/screens/LocalFolder.kt:1-14`, SourcesScreen sections at `app/src/main/java/com/music/bitchord/ui/screens/SourcesScreen.kt:24-30`; WebDAV upload row `SongActionsMenu.kt:560-595`).

**Web**: nothing, and a browser page cannot put files in a device Music folder. Mark **native-only**: downloads, local-folder/SMB/WebDAV libraries, cache management. (A PWA with OPFS is a different product shape, not a port.)

## 20. Onboarding & festive

**Android** (`app/src/main/java/com/music/bitchord/ui/onboarding/OnboardingScreen.kt:1-8`): a two-page welcome (Listen Together name, then YouTube sign-in, skipped when already signed in), always dark. A Diwali greeting for India-by-timezone once per year (`app/src/main/java/com/music/bitchord/ui/festive/DiwaliGate.kt:1-6`, `MainActivity.kt:802-817`) and a golden home wordmark for the day (`MainActivity.kt:803`).

**Web**: no onboarding (the sign-in model differs — `AccountButton.tsx:19-31`); no festive layer.

## 21. Contextual menus

**Android** (`app/src/main/java/com/music/bitchord/ui/components/SongActionsMenu.kt:103`): the track menu leads with like/dislike/share quick actions (`:213-238`), then version rows — **Revert to original / Upgrade quality**, **Convert to audio/video** (`:249-285`) — playlist add/remove (`:291-307`), Start radio / Play next / Add to queue (`:312-330`), the live download row (`:331`), remove-from-cache (`:332-339`), WebDAV upload (`:340`), remove-from-history (`:341-348`), Open album/artist with loading placeholders (`:350-373`), Song info dialog (`:374-376`, `app/src/main/java/com/music/bitchord/ui/components/SongInfoDialog.kt:1-6`), and the player-only group: sleep timer with presets + custom slider (`:380-389`, `:599-781`), Automix overview (`:392-399`), lyrics offset (`:403-410`), copy log (`:412-414`). The same menu is a *held* context menu — the item lifts out of its list over a blurred page (`app/src/main/java/com/music/bitchord/ui/components/HeldContextMenu.kt:1-14`) — or hangs off a ⋮ (`IosMenu.kt:1-10`); album/playlist cards get their own collection menu (`app/src/main/java/com/music/bitchord/ui/components/BrowseActionsMenu.kt:1-14`). The playlist picker ticks multiple playlists at once (`app/src/main/java/com/music/bitchord/ui/components/PlaylistPickerSheet.kt:1-10`).

**Web** (`web/app/src/components/music/TrackMenu.tsx:103-144`): Play Next, Add to Queue, then signed-in Favorite and Add to Playlist (one playlist per add, `:54-77`); Up Next rows add Play Now/Remove (`web/app/src/shell/UpNext.tsx:84-99`); Apple's glass panel with keyboard nav and scroll-close (`web/app/src/components/Menu.tsx:23-72`). Lockups and search results carry the same menu (`web/app/src/components/music/Lockups.tsx:76-81`).

- **Missing on web:** dislike, Start radio, Download row, Song info, Sleep timer, Lyrics offset, Automix overview, Copy log, Remove-from-cache/history, version switching, WebDAV (native), the held-menu gesture, multi-tick playlist picker. On touch devices the web currently has *no* track context menu at all outside Up Next (its menus are hover/⋯-driven).
- **Different:** Android's menu opens before it knows album/artist ids and shows loading rows (`SongActionsMenu.kt:352-373`); the web resolves those as navigation instead (`web/app/src/shell/nowPlayingLinks.ts:23-49`).

## 22. Dialogs & sheets

**Android**: iOS-alert lineage throughout — 270dp card, 14dp corner, 44dp rows (`app/src/main/java/com/music/bitchord/ui/components/UpdateAvailableDialog.kt:3-5`), used for update notices (`:20-30`), lyric sources, languages, account/channel, song info, Last.fm/ListenBrainz tokens, Discord fields (`AccountAlerts.kt:1-8`), source/addon editors (`app/src/main/java/com/music/bitchord/ui/screens/SourcesScreen.kt:1-22`), party/signature editors. Sheets are the player's own drawer built for nesting (`app/src/main/java/com/music/bitchord/ui/player/PlayerDrawer.kt:1-12`).

**Web**: one modal idiom — scrim, 14px card, fade/zoom, 30px close circle (`web/app/src/shell/LyricsSettings.tsx:47-60`); menus portal above everything (`Menu.tsx:74-89`); z-scale and focus rings from the Apple report (`Menu.tsx:19-22`).

- **Parity:** both use one alert/card family consistently. The web's modal system is smaller because the web has fewer features, not a different pattern.

## 23. Banners, updates & notices

**Android**: an in-app update check with a once-per-launch iOS-style dialog and a persistent top-bar icon, deliberately gated as one piece of news (`MainActivity.kt:874-892`, `UpdateAvailableDialog.kt:20-30`); queue/host-only notices above the mini player (`QueueActionNotice.kt:6-10`).

**Web**: the Apple red banner band (`web/app/src/shell/Banner.tsx:11-21`) used only for relay-unreachable states, with a mobile variant that points at the app (`web/app/src/shell/AppShell.tsx:44-77`); "NeedsExtension"-named but relay-worded page states are extension-era leftovers that remain in use (`web/app/src/components/music/States.tsx:9-24`). No update dialog — the web updates itself by reloading.

- **Web-only:** live presence ("listening now" tab count, `AppShell.tsx:38`); the Android-app banner and sidebar link.

## 24. Theming & motion

**Android**: theme modes, app font choice, player theme (mesh/legacy/simple), glass toggles, progressive blur, blend-effects disable, full-bleed artwork options (`SettingsSheet.kt:1003-1152`); artwork palettes that re-derive per theme (`ArtworkPalette.kt:1-10`); status-bar icon control per surface (`MainActivity.kt:847-849`, `NowPlayingScreen.kt:872-878`); performance modes and refresh-rate pinning (`SettingsSheet.kt:1328`, `:1360`).

**Web**: tokens with light/dark and increased-contrast variants (`web/docs/apple-music-dom.md:237-276`), page tint from artwork (`AlbumPage.tsx:19`, `ArtistPage.tsx:64-70`), reduced-motion honoured in the mesh and player (`MeshBackdrop.tsx:16-25`, `FullScreenPlayer.tsx:237`).

- **Missing on web:** user-facing theme/font/player-skin options (by design — the web is one Apple-Music look). Not a defect.

## 25. Ranked gap table

Every feature/interaction Android has that the web lacks, ranked by expected impact for web users. "Where" names the web file that would grow. Complexity: S < a day-ish, M ~ days, L ~ a week+. **[native-only]** marks things a browser page cannot meaningfully do; "by decision" marks deliberate relay-era cuts.

| # | Gap | Note | Where it would land | Size |
|---|---|---|---|---|
| 1 | Listening history page | Highest impact per effort: the data path already exists (`HomePage.tsx:19-24`) | new `/history` route + rows; menu gains "Remove from history" | S–M |
| 2 | Track menu depth: Start radio, Dislike, Song info | The menu is the web's thinnest surface vs `SongActionsMenu.kt:202-416` | `web/app/src/components/music/TrackMenu.tsx:79-97` | S–M |
| 3 | Sleep timer | Player-menu row + presets; Android's shape at `SongActionsMenu.kt:599-781` | TrackMenu (full-screen player only, as Android does) + a tiny engine in `state/player.ts` | S |
| 4 | Lyrics offset control | The clock already supports steering (`LyricsPanel.tsx:150-215`) | offset stepper in `LyricsPanel`/`LyricsSettings` | S |
| 5 | QR party invite | Android draws it themed (`QrCode.kt:1-10`); web has copy-link only (`ListenTogetherPage.tsx:226-233`) | ListenTogetherPage + any MIT QR painter | S |
| 6 | Queue "previously played" section | `SettingsSheet.kt:1646`; needs the finished tracks, which the web player has | `web/app/src/shell/UpNext.tsx:182-204` | S |
| 7 | Start radio (button or menu) | Web autoplay covers queue-end radio but nothing starts a station *from* an item | `TrackMenu` + `play.ts` (radio search endpoint) | M |
| 8 | Long-press/held context menus on touch | Mobile web currently has no track menu at all outside Up Next; Android's lift is `HeldContextMenu.kt:1-14` | Menu.tsx + a hold detector in TrackList/Lockups | M |
| 9 | Mini-player swipe gestures | Skip-on-swipe + pull-to-open (`MiniPlayer.kt:212-315`) | MobilePlayerBar.tsx | M |
| 10 | Playlist reorder page | `ReorderPlaylistPage.kt:1`; the web's drag code exists in UpNext to borrow | new `/playlist/:id` inline mode | M |
| 11 | Per-network audio quality ceiling | Android `SettingsSheet.kt:535-554`; web would pass a ceiling to the relay | SettingsPage + relay request param | M |
| 12 | Scrobbling (Last.fm/ListenBrainz) | Android `AccountAndScrobblingScreen.kt:152-232`; needs tokens + a relay-side or client-side submitter | new Settings section + `playback/` reporter | M |
| 13 | Equalizer + presets | Android `EqualizerScreen.kt:71-861`; feasible over the web's Web Audio decks | new WebAudio insert + Settings section | M–L |
| 14 | Lyrics translation/romanization | Android `PlayerLyrics.kt:505`; am-lyrics supports both but the toolbar is suppressed (`LyricsPanel.tsx:26-32`) | relay translate endpoint + toggle UI | M |
| 15 | In-page track filter + per-page sort | `DetailScreen.kt:356`, `:441-465` | TrackList header controls | M |
| 16 | Version switching (revert/upgrade, audio↔video) | Android `SongActionsMenu.kt:249-285`; web would need relay-side support for alternate itags | TrackMenu + player store | M–L |
| 17 | Settings search | `SettingsSheet.kt:416-425` | SettingsPage row registry + filter | S–M |
| 18 | Replay (stats/wrapped) | Android §18; stories + poster are presentation-heavy | new page + charts; data partially via history | L |
| 19 | Toast confirmations for queue actions | `QueueActionNotice.kt:6-10` | shell-level toast store | S |
| 20 | Pull-to-refresh on feeds | Android `MainActivity.kt:1238-1263` | HomePage/LibraryPage scroll wiring | S–M |
| 21 | Output device picker (`setSinkId`) | Android `AudioOutputSheet.kt:1-10`; Chromium-only | VolumeControl long-press or settings | M |
| 22 | Search history + filter pills | `SearchHistory.kt:1`, `SearchScreen.kt:1-30` | SearchPage/SearchField | M |
| 23 | Backup export/import | `SettingsSheet.kt:1529`, `:1538`; web state is localStorage + server library | SettingsPage + JSON download/upload | M |
| 24 | Find Your Mood page + Top Picks shelf | `AppNavigator.kt:41-42`, `TopPicksShelf.kt:1-10` | new shelves on Home | M |
| 25 | Hide-shelf content preferences | `SettingsSheet.kt:916-949` | SettingsPage toggles + HomePage filter | S |
| 26 | Loudness normalization / skip silence | `SettingsSheet.kt:758`, `:838`; Web Audio gain/analysis | automix graph or per-deck node | M |
| 27 | Share sheet for track links | Android `SongActionsMenu.kt:234-236` | `navigator.share` + copy fallback in TrackMenu | S |
| 28 | Downloads / offline | §19 — a browser cannot write to the Music folder; OPFS/PWA is a different product | — | **native-only** |
| 29 | Local/SMB/WebDAV libraries, cache management | §19 | — | **native-only** |
| 30 | Bit-perfect / USB DAC / Dolby Atmos / spatial audio / audio-pipeline readout | §17 hardware paths | — | **native-only** |
| 31 | Cast (Chromecast) | `CastDialog.kt:1-7`; possible via sender SDK but a project | — | L (lean native) |
| 32 | Wear OS | `WearOsSettings.kt:1-10` | — | **native-only** |
| 33 | Addon/sources management (order, per-addon quality, direct source stream) | `SourcesScreen.kt:1-22`; the web is relay-only by decision (`web/docs/relay.md:8-13`) | — | **by decision** |
| 34 | Discord Rich Presence | extension-era flag only (`web/docs/spotify-and-discord.md:51-60`) | — | **by decision** |
| 35 | Multi-account/channel selection | relay holds one identity (`AccountButton.tsx:19-31`) | — | **by decision** |
| 36 | Onboarding, festive layers, update dialog, app icon/language/font, performance/glass settings | §20, §23, §24 | — | **native-only / by design** |
| 37 | Playback speed, engine-level | Android engine applies it (`app/src/main/java/com/music/bitchord/data/settings/AppSettings.kt:411`, `app/src/main/java/com/music/bitchord/playback/PlaybackService.kt:6905`) with no settings row on either side | — | parity gap only if a UI is ever added |

## 26. Adoptable next

The five gaps with the best impact-per-effort on the web, in order:

1. **Listening history page** (#1) — the data is one library query away; it also unlocks "remove from history" and gives Replay a data foundation later.
2. **Track menu depth** (#2) — Start radio, Dislike and Song Info close the biggest behavioural distance in the app's most-used control, all inside one existing file.
3. **Sleep timer** (#3) — a small, self-contained win that bedroom listeners notice immediately; ship it in the full-screen player's menu exactly where Android puts it (`SongActionsMenu.kt:90-93`).
4. **Lyrics offset** (#4) — the steered clock already exists; a ± stepper completes the lyric experience without touching providers.
5. **QR party invite + queue "previously played"** (#5, #6) — two small Listen Together/queue polish items that make the web party feel like the phone's.

Deferred by nature: downloads, local libraries, bit-perfect audio, Cast, Wear OS (native-only); addons, Discord, multi-account (relay-era decisions).
