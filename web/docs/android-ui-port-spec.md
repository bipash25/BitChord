# Android → Web UI port specification

Written 2026-11-22, branch `server-relay`. This is the working spec for porting the Android app's
complete visual language and motion system to the web app, replacing the Apple Music web-replica
styling (`web/docs/apple-music-dom.md` and the token set written from it). The owner's decision:
the web app looks and animates **same-to-same like the Android app**.

Conventions used throughout:

- Paths are repo-root relative. `file:line` cites the exact place a value was read from.
- Every number in this spec is taken from code or is marked **not pinned in code**. Nothing here is
  invented to fill a gap; where the Android code delegates to a library (Haze materials), the gap is
  named and a pinned substitute is proposed.
- The Android side is the source of truth. Where the web cannot be same-to-same (§7), the substitute
  is specified and justified, never improvised.
- The feature-gap plan (what the web is missing as *functionality*) already lives in
  `web/docs/android-vs-web-ui.md` §25 — this spec is the **visual and motion** layer on top of it and
  uses that doc as its component inventory.

---

## 1. Design language overview

What the Android app's look *is*, from its own code:

- **Frosted Telegram/iOS-style Material 3.** Surfaces are glass over live content: a whole-page
  backdrop layer is recorded and sampled by runtime shaders (the vendored Kyant0 `backdrop` library,
  `app/src/main/java/com/music/bitchord/ui/components/LiquidGlass.kt:29`), or, more commonly, blurred
  through Haze (`dev.chrisbanes.haze`, `app/src/main/java/com/music/bitchord/MainActivity.kt:533`).
  Two material tiers exist: *liquid glass* (blur 8dp + lens refraction, `LiquidGlass.kt:64`, optional
  and off by default — `app/src/main/java/com/music/bitchord/data/settings/AppSettings.kt:500`) and
  *frost* (24dp blur everywhere the app pins a number: `TopFadeBlur.kt:39`, `IosMenu.kt:232`,
  `OptimizedHaze.kt:49`).
- **A floating pill tab bar**, not a docked bar: 62dp tall, 19dp gutters, a selection pill that
  travels on a spring and stretches in flight (`FloatingBottomBar.kt:79`, `:85`, `:125-127`, `:147`,
  `:163`). On scroll it can fold into the iOS-26 "glass nav bar" where the mini player and tabs are
  one component (`GlassNavBar.kt:72-90`) — that fold is a liquid-glass-only layout; the web ports the
  **expanded** shape.
- **SF Pro Display, set one weight lighter than asked** (`app/src/main/java/com/music/bitchord/ui/theme/Theme.kt:51-73`)
  with per-size letter spacing measured off Apple Music (`Theme.kt:75-93`).
- **Artwork-derived colour everywhere**: release pages are tinted end-to-end from a palette decoded
  out of the sleeve (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/theme/ArtworkPalette.kt:35-70`),
  and the player stands on a 6×6 mesh of the artwork's own means
  (`sharedUi/src/jvmSharedMain/kotlin/com/music/bitchord/ui/player/ArtworkMeshBackdrop.kt:50-78`).
- **iOS-native furniture**: iOS 26 switch (`IosSwitch.kt:37-60`), iOS alert metrics
  (`UpdateAvailableDialog.kt:45-48`), iOS menus — 256dp panel, 30dp continuous corner
  (`IosMenu.kt:143-149`) — and a held-item context menu that lifts the row out over a blurred page
  (`HeldContextMenu.kt:58-80`).
- **Apple-spring motion**: the player sheet is a critically damped spring with ~0.45s response
  (`PlayerSheetMotion.kt:26-36`); the tab pill is an under-damped spring with travel squash
  (`FloatingBottomBar.kt:137-147`, `GlassSelectionPill.kt:59-81`).

**Porting philosophy.** Same-to-same where the web can: every colour, radius, spacing, type size,
blur radius, duration and spring constant below is portable verbatim (dp→px at 1:1; sp→px at 1:1 —
the web already measures in px, `web/app/src/styles/global.css:20`). Nearest-equivalent where it
can't, each substitution justified in §7: runtime shaders → `backdrop-filter` + gradients; the
continuous corner → `border-radius` (+ `corner-shape` where supported); haptics → omitted; native
sheet physics → a JS spring with the exact Android constants. What the Android app draws *is* the
web design now — the web's current Apple-report tokens (`web/app/src/styles/tokens.css:1-10`) are
retired, not blended.

---

## 2. Token tables — proposed `web/app/src/styles/android-tokens.css`

One new stylesheet, imported after `tokens.css` is deleted (the phases keep the old file until
Phase 3 retires it). Names use the `--bc-` prefix. Light values first, dark under
`prefers-color-scheme: dark` — matching how the web tokens are organized today
(`web/app/src/styles/tokens.css:68-69`).

### 2.1 Colour roles (Material scheme)

From `app/src/main/java/com/music/bitchord/ui/theme/Theme.kt` (dark `:26-36`, light `:38-48`) and
`AccentRed` (`:24`).

| Token | Light | Dark | Source |
|---|---|---|---|
| `--bc-bg` | `#ffffff` | `#000000` | Theme.kt:41 / :30 (`background`) |
| `--bc-surface` | `#f7f7f9` | `#0d0d0f` | Theme.kt:43 / :31 |
| `--bc-surface-variant` | `#f2f2f7` | `#1c1c1e` | Theme.kt:45 / :33 |
| `--bc-on-surface` | `#000000` | `#ffffff` | Theme.kt:39 (primary) / :27 |
| `--bc-on-surface-variant` | `#6e6e73` | `#8e8e93` | Theme.kt:46 / :34 |
| `--bc-outline` | `#e5e5ea` | `#2c2c2e` | Theme.kt:47 / :35 |
| `--bc-accent-red` | `#fa2d48` | `#fa2d48` | Theme.kt:24 |

Note the role mapping: Android's `primary` is pure black/white — it is the *selected tab tint*, not
a brand accent. The web's `--keyColor` (#d60017/#fa586a, `tokens.css:84`/`:167`) has no Android
counterpart and is dropped; Replay's rank badge is the only red consumer (Theme.kt:22-23).

Menu panels carry their own fixed colours, independent of theme (`IosMenu.kt:103-129`):

| Token | Value | Source |
|---|---|---|
| `--bc-menu-fill-dark` | `#1c1c1e` | IosMenu.kt:105 |
| `--bc-menu-rim-dark` | `rgba(255,255,255,.10)` | IosMenu.kt:106 |
| `--bc-menu-label-dark` | `rgba(255,255,255,.75)` | IosMenu.kt:109 |
| `--bc-menu-label2-dark` | `rgba(255,255,255,.60)` | IosMenu.kt:110 |
| `--bc-menu-sep-dark` | `rgba(255,255,255,.10)` | IosMenu.kt:111 |
| `--bc-menu-fill-light` | `#f6f6f7` | IosMenu.kt:123 |
| `--bc-menu-rim-light` | `rgba(0,0,0,.06)` | IosMenu.kt:124 |
| `--bc-menu-label-light` | `#1a1a1a` | IosMenu.kt:125 |
| `--bc-menu-label2-light` | `rgba(26,26,26,.55)` | IosMenu.kt:126 |
| `--bc-menu-sep-light` | `rgba(0,0,0,.09)` | IosMenu.kt:127 |

### 2.2 Glass / surface material values

| Token | Value | Source |
|---|---|---|
| `--bc-glass-blur` | `8px` | LiquidGlass.kt:64 (`BLUR_RADIUS_DP = 8f`) |
| `--bc-glass-saturate` | `1.5` | LiquidGlass.kt:63 + :246 (1 + 0.5 × VIBRANCY) |
| `--bc-glass-tint-light` | `rgba(250,250,250,.40)` | LiquidGlass.kt:235-240 (0xFFFAFAFA × `SURFACE_OPACITY` :68) |
| `--bc-glass-tint-dark` | `rgba(18,18,18,.40)` | LiquidGlass.kt:237-240 (0xFF121212 × 0.4) |
| `--bc-glass-edge` | `rgba(255,255,255,.10)` | LiquidGlass.kt:100-101 |
| `--bc-glass-edge-width` | `0.5px` | LiquidGlass.kt:100 |
| `--bc-frost-blur` | `24px` | TopFadeBlur.kt:39, IosMenu.kt:232, OptimizedHaze.kt:49 — every pinned frost |
| `--bc-frost-input-scale` | `0.33` | OptimizedHaze.kt:33 (sampling fraction; CSS has no equivalent — informational) |
| `--bc-menu-frost-fill` | `rgba(28,28,30,.80)` | OptimizedHaze.kt:69 + :72 (MENU_FROST_ALPHA over MenuFrostDark) |
| `--bc-menu-frost-blur` | `24px` | OptimizedHaze.kt:49 |
| `--bc-menu-frost-saturate` | `1.8` | IosMenu.kt:221 (`colorControls(saturation = 1.8f)`) |
| `--bc-indicator-alpha` | `.5` (light) / `.14` (dark) | LiquidGlass.kt:123-129, `DARK_INDICATOR_OPACITY` :132 |
| `--bc-glass-content-light` | `#000` | LiquidGlass.kt:111-113 (luminance rule) |
| `--bc-glass-content-dark` | `#fff` | LiquidGlass.kt:111-113 |
| `--bc-tab-unselected-alpha` | `.65` | GlassNavBar.kt:119, FloatingBottomBar.kt:352 |

**Not pinned in code:** the blur radius and tint of `HazeMaterials.regular(...)` and
`HazeMaterials.thin(...)` (used by `FloatingBottomBar.kt:264`, `MiniPlayer.kt:400`,
`FrostedTopBar.kt:506`, `TopFadeBlur.kt:141`) come from the Haze materials library, not this repo.
The web adopts the pinned menu-frost numbers (24px blur + `--bc-surface` tint) as the canonical
frost for all bar surfaces, so every frost the web draws traces to a repo-pinned value.

### 2.3 Corner radii

| Token | Value | Source |
|---|---|---|
| `--bc-radius-smooth` | `0.607` | ContinuousCornerShape.kt:143 (`GLASS_CORNER_SMOOTHING`) — smoothing *fraction*, used with `corner-shape` (§3.0) |
| `--bc-radius-menu` | `30px` (continuous) | IosMenu.kt:143 |
| `--bc-radius-alert` | `14px` | UpdateAvailableDialog.kt:47 |
| `--bc-radius-drawer` | `26px` (top corners) | PlayerDrawer.kt:64 |
| `--bc-radius-group` | `14px` | SettingsSheet.kt:2346 (`GroupShape`) |
| `--bc-radius-row-press` | `16px` | IosMenu.kt:344 (menu row press), PlayerDrawer.kt:79 (`ROW_SHAPE`) |
| `--bc-radius-art` | `8px` | MiniPlayer.kt:139 (`ART_CORNER`), Common.kt:560-561 (SongRow art) |
| `--bc-radius-sleeve` | `12px` | DetailScreen.kt:203 (`SLEEVE_SHAPE`) |
| `--bc-radius-pill-art` | `5.7px` | GlassNavBar.kt:517 (`ACCESSORY_ART_CORNER`) |
| `--bc-radius-held-card` | `20px` | HeldContextMenu.kt:348 |
| `--bc-radius-mood-card` | `18px` | ExploreScreen.kt:268 |
| `--bc-radius-mood-art` | `22px` | SettingsSheet.kt:1740 (app icon tile; also replay-card lineage) |
| `--bc-radius-field` | `11px` | Common.kt:981 (`PillTextField`) |
| `--bc-radius-signin` | `22px` | Common.kt:872 (`SignInBanner`) |
| `--bc-radius-track-row` | `6px` → **dropped** | Apple-only (`tokens.css:51`); Android rows are square | 
| `--bc-radius-pill` | `50%` height (capsule) | FloatingBottomBar.kt:185 `RoundedCornerShape(percent = 50)`; use `border-radius: 9999px` |

The continuous (squircle) treatment: Android's `ContinuousCornerShape` ramps curvature over
`smoothing = 0.607` of each corner's turn (ContinuousCornerShape.kt:37-46, :143); fully rounded
capsules instead use a superellipse of exponent 2.1 (`SquirclePillShape.kt:32`, `:97`). CSS:

```css
/* Progressive enhancement; Chrome 139+ and rising. Fallback: plain circular corner. */
.bc-continuous { border-radius: var(--r); corner-shape: superellipse(5); }
.bc-pill-squircle { border-radius: 9999px; corner-shape: superellipse(2.1); }
@supports not (corner-shape: round) { .bc-continuous, .bc-pill-squircle { corner-shape: round; } }
```

The `superellipse(5)` exponent is the Figma-construction equivalent of 60% iOS smoothing that
`ContinuousCornerShape.kt:143` documents ("Figma calls 60% 'iOS'; measured off Apple's own glass it
comes to a touch over that") — the exact exponent is **not pinned in code**; 5 is the standard
mapping of the same construction and is used only where `corner-shape` is supported.

### 2.4 Typography

Family: SF Pro Display with **each weight mapped one cut lighter** (Theme.kt:67-73): W400 and W500
both draw the Regular cut, W600 draws Medium, W700 draws Semibold, W800 draws Bold. On the web this
is done in `@font-face` weight declarations, not by asking CSS for a lighter weight — the web
already carries two SF Pro Display files with latin/greek/cyrillic subsets
(`web/app/src/styles/global.css:288-304`); the port adds the medium and semibold cuts and registers
them at the shifted weights:

```css
@font-face { font-family: 'BitChord SF Pro Display'; src: url('../assets/fonts/sf-pro-display-regular.woff2') format('woff2');
  font-weight: 400 500; }                       /* W400+W500 → regular  (Theme.kt:68-69)  */
@font-face { ... sf-pro-display-medium.woff2 ...   font-weight: 600; }   /* W600 → medium   (Theme.kt:70) */
@font-face { ... sf-pro-display-semibold.woff2 ... font-weight: 700; }   /* W700 → semibold (Theme.kt:71) */
@font-face { ... sf-pro-display-bold.woff2 ...     font-weight: 800; }   /* W800 → bold     (Theme.kt:72) */
```

The scale (`Theme.kt:84-93`; letter spacing in sp → px at 1:1):

| Token (CSS) | Compose role | Weight-asked | Size/line | Tracking | Source |
|---|---|---|---|---|---|
| `--bc-type-display` | displayLarge | 800 (draws Bold) | 34px | `-0.5px` | Theme.kt:85 |
| `--bc-type-headline-lg` | headlineLarge | 800 | 30px | `-0.4px` | Theme.kt:86 |
| `--bc-type-headline` | headlineMedium | 700 (draws Semibold) | 22px | `-0.25px` | Theme.kt:87 |
| `--bc-type-title` | titleLarge | 700 | 20px | `-0.2px` | Theme.kt:88 |
| `--bc-type-title-md` | titleMedium | 600 (draws Medium) | 16px | `0.05px` | Theme.kt:89 |
| `--bc-type-body-lg` | bodyLarge | 400 | 16px | `0.2px` | Theme.kt:90 |
| `--bc-type-body` | bodyMedium | 400 | 14px | `0.3px` | Theme.kt:91 |
| `--bc-type-label` | labelMedium | 600 | 12px | `0.25px` | Theme.kt:92 |
| `--bc-type-label-sm` | labelSmall | 600 | 11px | `0.3px` | Theme.kt:93 |

Two out-of-scale sizes that recur: the tab-bar label (10px, tracking +0.5px, W600 → Medium)
(`FloatingBottomBar.kt:131-133`) and the glass accessory title 13px/W700-tracked +0.15px over
artist 12px/+0.35px (`GlassNavBar.kt:503-513`). Compose line heights are defaults; the lyric panel
pins its own (§4.7).

DM Sans (`tokens.css:14`) and the Apple type scale (`tokens.css:17-35`) are removed. The existing
`--animate-*` and z-index token blocks (`global.css:38-105`, `tokens.css:61-66`) are re-derived in
§4.

### 2.5 Layout & dimensions

| Token | Value | Source |
|---|---|---|
| `--bc-page-gutter` | `16px` | Common.kt:117 (`PAGE_GUTTER`) |
| `--bc-bar-gutter` | `16px` | Common.kt:124 (`BAR_GUTTER`, = page gutter) |
| `--bc-topbar-h` | `52px` | FrostedTopBar.kt:91 (`TopBarContentHeight`) |
| `--bc-topbar-gap` | `12px` | FrostedTopBar.kt:97 (`TopBarContentGap`) |
| `--bc-top-control` | `44px` | FrostedTopBar.kt:666 (`TOP_CONTROL_SIZE` — back circle + actions pill) |
| `--bc-action-gap` | `10px` | FrostedTopBar.kt:673 |
| `--bc-avatar` | `28px` | FrostedTopBar.kt:688 |
| `--bc-tabbar-h` | `62px` | FloatingBottomBar.kt:125-127 (comment: 28dp glyph + padding above ⇒ 62dp) |
| `--bc-tabbar-gutter` | `19px` | FloatingBottomBar.kt:85 (`NAV_BAR_GUTTER`) |
| `--bc-tabbar-lift` | `6px` | FloatingBottomBar.kt:91 (`NAV_BAR_LIFT`) |
| `--bc-tabbar-gesture-floor` | `15px` | FloatingBottomBar.kt:106 (`GESTURE_BAR_FLOOR` — maps to `env(safe-area-inset-bottom)` floor) |
| `--bc-pill-inset` | `4px` | FloatingBottomBar.kt:79 (`PILL_INSET`) |
| `--bc-tab-vpad` | `6.5px` | FloatingBottomBar.kt:118 (`TAB_VERTICAL_PADDING`) |
| `--bc-tab-icon` | `28px` | FloatingBottomBar.kt:128 (`TAB_ICON_SIZE`) |
| `--bc-tab-gap` | `6px` | FloatingBottomBar.kt:336 |
| `--bc-tab-icon-label-gap` | `1px` | FloatingBottomBar.kt:121 |
| `--bc-inline-bar-h` | `48px` | GlassNavBar.kt:490-495 (collapsed row: 28dp glyph in 10dp padding; lift 7dp) |
| `--bc-inline-gutter` | `28px` | GlassNavBar.kt:487 |
| `--bc-inline-spacing` | `14px` | GlassNavBar.kt:488 |
| `--bc-miniplayer-h` | `56px` | MiniPlayer.kt:115-117 (40dp art + 2 × 8dp padding) |
| `--bc-miniplayer-radius` | `28px` (= h/2) | MiniPlayer.kt:115-117 |
| `--bc-miniplayer-glyph` | `32px` in 40px slot | MiniPlayer.kt:83/:94 |
| `--bc-miniplayer-art` | `40px`, 8px corner | MiniPlayer.kt:428, :139 |
| `--bc-miniplayer-transport-gap` | `8px` | MiniPlayer.kt:111 |
| `--bc-floating-bar-max` | `440px` | Common.kt:154 (`FLOATING_BAR_MAX_WIDTH`) |
| `--bc-player-gutter` | `30px` | NowPlayingScreen.kt:402 (`PLAYER_GUTTER`) |
| `--bc-player-max` | `560px` | NowPlayingScreen.kt:409 (`PLAYER_MAX_WIDTH`) |
| `--bc-player-landscape-min` | `560px` | NowPlayingScreen.kt:434 |
| `--bc-player-tablet-min` | `700px` | NowPlayingScreen.kt:420 |
| `--bc-player-thumb` | `54px` | NowPlayingScreen.kt:235 (`THUMB_SIZE`) |
| `--bc-player-header` | `60px` | NowPlayingScreen.kt:236 |
| `--bc-player-art-title-gap` | `20px` | NowPlayingScreen.kt:237 |
| `--bc-skip-icon` | `53px` (touch = icon), scaleY 0.85 | PlayerControls.kt:839-846 |
| `--bc-bottom-action` | `44px` slot / 26px icon | PlayerControls.kt:848-851 |
| `--bc-bottom-tile` | `35px`, 7px corner, α .62 | PlayerControls.kt:858-860 |
| `--bc-segment-width` | `64px` | PlayerControls.kt:868 |
| `--bc-scrubber-lift` | `9px` | PlayerControls.kt:195 |
| `--bc-volume-row-h` | `32px` | PlayerControls.kt:530 |
| `--bc-queue-divider-inset` | `84px` (16+68) | Common.kt:127 (`ROW_DIVIDER_INSET`) |
| `--bc-track-number-w` | `24px` | Common.kt:135 |
| `--bc-shelf-card-w` | `150px` | Common.kt:163 (`SHELF_CARD_WIDTH`) |
| `--bc-track-column` | `88%`, max 400px | Common.kt:185, :201 |
| `--bc-library-grid` | min card 140px, gap 12px, 2–5 columns | Common.kt:221-229 |
| `--bc-alert-w` | `270px` | UpdateAvailableDialog.kt:46 |
| `--bc-alert-action-h` | `44px` | UpdateAvailableDialog.kt:48 |
| `--bc-menu-w` | `256px` | IosMenu.kt:149 |
| `--bc-drawer-max-w` | `640px` | PlayerDrawer.kt:78 |
| `--bc-drawer-max-h` | `560px` | PlayerDrawer.kt:202 |
| `--bc-group-inset` | `16px` | SettingsSheet.kt:2347 (`GROUP_INSET`) |
| `--bc-sleeve-fraction` | `76%` of column width, max 50% of height, 12px corner, 18px shadow | DetailScreen.kt:198-204 |
| `--bc-fullbleed-max` | `62%` of height | DetailScreen.kt:212 |
| `--bc-artist-photo-ratio` | `0.95` | DetailScreen.kt:195 |
| `--bc-artist-play` | `70px` button, icon 56% | DetailScreen.kt:258-261 |
| `--bc-top-release-corner` | `24px` | DetailScreen.kt:2321 |

Retired web tokens: `--web-navigation-width: 260px` and `--body-gutter: 25px/40px`
(`tokens.css:38-39`, `:142-146`) — the Android shell has no sidebar at any width (§6.1);
`--player-pill-height: 56px` coincidentally matches `--bc-miniplayer-h` but is re-derived.

### 2.6 Elevation / shadow

| Token | Value | Source |
|---|---|---|
| `--bc-shadow-glass` | `0 4px 24px rgba(0,0,0,.10)` | Shadow.kt:24-28 (`radius 24dp`, `offset r/6`, `black α .1`) — the default every `drawBackdrop` surface casts (LiquidGlass.kt:258) |
| `--bc-shadow-menu` | blur ≈ 24px, `rgba(0,0,0,.30)` | IosMenu.kt:203-208 (elevation 24dp, black α .30) |
| `--bc-shadow-held-card` | blur ≈ 20px, `rgba(0,0,0,.30)` | HeldContextMenu.kt:200 (elevation 20dp; α from IosMenu.kt:207) |
| `--bc-shadow-pill` | `0 2px 12px rgba(0,0,0,.30)` | GlassSelectionPill.kt:572-576 (radius 12dp, offset (0,2), black α .3) |
| `--bc-shadow-thumb-switch` | blur ≈ 2px, `rgba(0,0,0,.25)` | IosSwitch.kt:135 (elevation 2dp; α **not pinned in code** — Compose default) |
| `--bc-shadow-sleeve` | blur ≈ 18px, α **not pinned in code** | DetailScreen.kt:204 (elevation 18dp; Compose default alphas) |
| `--bc-shadow-refresh-puck` | blur ≈ 6px, α **not pinned in code** | FrostedTopBar.kt:630 (elevation 6dp) |
| Highlight (glass rim) | white α .5, 45°, Plus blend, falloff 1 | HighlightStyle.kt:54-59 — see §3.1 for the CSS approximation |

The directional `Highlight.Default` is a runtime shader (§7); the pinning that matters: colour
`White.copy(alpha = 0.5f)`, angle 45°, falloff 1, blend `Plus` (HighlightStyle.kt:54-59).

Where the source is a Compose `Modifier.shadow(elevation)` rather than the backdrop `Shadow`
(radius, offset, colour all pinned), the table maps elevation to a CSS blur of the same number —
that mapping is approximate; elevation is not a blur radius, and the affected rows say so.

---

## 3. The glass recipes, as CSS

Every recipe is layered the same way Android layers it: a backdrop effect, a surface tint, an edge,
a shadow, and — where liquid glass is on — a highlight. The web renders the *frost* tier
backwards-compatible and the *glass* tier with `backdrop-filter`; the lens is out (§7).

### 3.1 The two canonical surfaces

```css
/* Frost — every pinned blur in the app is 24dp (TopFadeBlur.kt:39, IosMenu.kt:232,
   OptimizedHaze.kt:49). Input-scale 0.33 (OptimizedHaze.kt:33) has no CSS counterpart. */
.bc-frost {
  background-color: color-mix(in srgb, var(--bc-surface) 55%, transparent); /* tint α not pinned for
      HazeMaterials.regular/thin — this is the slab the pinned menu frost uses (OptimizedHaze.kt:69) */
  backdrop-filter: blur(24px) saturate(1.8);   /* 24px + iOS menu saturation (IosMenu.kt:221) */
  border: 0.5px solid var(--bc-glass-edge);    /* LiquidGlass.kt:100-101 */
}

/* Glass — the liquid-glass material with the lens dropped (§7): 8dp blur, vibrancy 1.5,
   tint 0xFFFAFAFA / 0xFF121212 at 40% (LiquidGlass.kt:63-68, :235-240). */
.bc-glass {
  background-color: var(--bc-glass-tint-light);            /* dark: --bc-glass-tint-dark */
  backdrop-filter: blur(8px) saturate(1.5);                 /* LiquidGlass.kt:64, :246 */
  border: 0.5px solid var(--bc-glass-edge);                  /* LiquidGlass.kt:100-101 */
  box-shadow: var(--bc-shadow-glass);                       /* Shadow.kt:24-28 */
  position: relative;
}
/* The rim highlight, nearest CSS for the 45° Plus-blend shader (HighlightStyle.kt:54-59):
   a 135° white wash, 5% flat, fading to nothing by 50% — visually the "light along the top-left
   edge" the shader produces. Not same-to-same; see §7. */
.bc-glass::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,.50), rgba(255,255,255,.05) 45%, transparent 55%);
  mix-blend-mode: plus-lighter;  /* the Plus blend (HighlightStyle.kt:58) */
  opacity: .22;                  /* shader falloff compresses the wash; tuned, not pinned */
}
```

`lightweightLiquidGlass` (`LiquidGlass.kt:134-171`) is the same recipe with
`backdrop-filter` omitted — use it for glass over flat colour.

### 3.2 Top fade blur (scroll-edge frost under the top bar)

Android: full-width strip of `topBarHeight + 16dp`, blur 24dp eased 1→0 vertically over its height
(EaseInOut), no tint, no noise, foot fading out from 60% of its height (8 EaseInOut stops)
(`TopFadeBlur.kt:33-57`, `:88-109`). CSS `backdrop-filter` cannot ramp blur along a gradient
(§7); the nearest same-to-same is a stack: one flat frost masked by the eased alpha ramp, which
produces the same "hardest at the top edge, gone below the controls" read:

```css
.bc-top-fade {
  position: fixed; inset: 0 0 auto 0; height: calc(var(--bc-topbar-h) + 16px); /* FADE_RUN :33 */
  -webkit-mask-image: linear-gradient(#000 62.5%, transparent);  /* whole to FOOT_FADE_START .6 (:45) */
  backdrop-filter: blur(24px);                                   /* BLUR_MAX :39 */
  /* no background — blur only, no tint, no scrim (TopFadeBlur.kt:65-67) */
}
```

The mask carries the eased foot (8-stop EaseInOut curve, `TopFadeBlur.kt:48-57`); a two-stop mask is
the approximation. `TopBarBlur` (the bounded uniform pane, `TopFadeBlur.kt:127-144`) is the same
frost at exactly `topBarHeight()` with no mask.

### 3.3 Bottom fade scrim

Not glass at all — a flat colour ramp the floating bars sit on: 180px tall (254px with the mini
player stacked), 16 stops of `EaseInCubic` alpha from 0→1, grown over 220ms
(`BottomFadeScrim.kt:28-46`, `:81-99`):

```css
.bc-bottom-scrim {
  position: fixed; inset: auto 0 0 0;
  height: calc(var(--bc-tabbar-h) + var(--bc-tabbar-lift) + var(--bc-tabbar-gesture-floor) + 66px);
  /* 180dp from bar foot upward (BottomFadeScrim.kt:28); the tab bar's own stack is above */
  background: linear-gradient(to bottom,
    transparent,                       /* 16 stops of EaseInCubic (BottomFadeScrim.kt:96-99) */
    color-mix(in srgb, var(--page-color) 40%, transparent) 40%,
    color-mix(in srgb, var(--page-color) 78%, transparent) 78%,
    var(--page-color) 100%);
  transition: height 220ms ease;       /* BottomFadeScrim.kt:84-87 */
}
```

(Generate the 16 stops literally in `android-tokens.css` with a small SCSS/PostCSS loop or a CSS
`@property` gradient — the stop count is the anti-banding measure, `BottomFadeScrim.kt:42-46`.)
`--page-color` is the page's own colour — theme background on tabs, the tint's wash on a detail page
(`BottomFadeScrim.kt:67-77`). `FloatingBarsTapGuard` (an 8px dead strip above the bars,
`BottomFadeScrim.kt:116`) becomes a `pointer-events: all` non-interactive element of the same height.

### 3.4 Floating tab bar (phone shell)

Android expanded bar: capsule (`border-radius: 9999px`), 19px screen gutters, 6px lift above the
safe-area floor, 4px inner inset, 62px tall, max width 440px, centred
(`FloatingBottomBar.kt:79-128`, `Common.kt:154`). Material: frost (Haze regular — §2.2) or glass;
content colour pure black/white by surface luminance, unselected at 65%
(`FloatingBottomBar.kt:340-352`, `LiquidGlass.kt:111-113`); hairline `0.5px rgba(255,255,255,.10)`
(`FloatingBottomBar.kt:268`); selection pill `primary.copy(alpha = 0.14f)` — i.e.
`rgba(0,0,0,.14)` light / `rgba(255,255,255,.14)` dark (`FloatingBottomBar.kt:287`).

```css
.bc-tabbar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--bc-tabbar-lift));
  width: min(calc(100vw - 2 * var(--bc-tabbar-gutter)), var(--bc-floating-bar-max));
  height: var(--bc-tabbar-h); padding: var(--bc-pill-inset);
  border-radius: 9999px;
  background: var(--bc-frost-bg); backdrop-filter: blur(24px) saturate(1.8);
  border: 0.5px solid var(--bc-glass-edge);
  color: var(--bc-glass-content-dark);          /* light theme: --bc-glass-content-light */
}
.bc-tabbar__pill {          /* selection indicator */
  position: absolute; top: var(--bc-pill-inset); bottom: var(--bc-pill-inset);
  border-radius: 9999px; background: rgba(255,255,255,.14);   /* dark; rgba(0,0,0,.14) light */
  transform-origin: 50% 50%; will-change: transform;
}
.bc-tabbar__item { padding: var(--bc-tab-vpad) 0; }
.bc-tabbar__icon { width: 28px; height: 28px; }
.bc-tabbar__label { font: 600 10px/1 'BitChord SF Pro Display'; letter-spacing: .5px; margin-top: 1px; }
```

Pill motion is JS (§4.3); the drag-to-switch gesture and per-tab haptic tick become drag + a visual
tick (no haptics, §7).

### 3.5 Mini player pill

Capsule above the tab bar: 56px tall, `BAR_GUTTER` (16px) side margins, frost *thin* material with
an explicit `0.5px white/10%` border (`MiniPlayer.kt:375-404`, `:115-117`, `Common.kt:124`). Row:
12px horizontal / 8px vertical padding, 40px art with 8px corner (16:9 at 71px wide for video),
10px gap, 32px glyphs in 40px slots, 8px transport gap (`MiniPlayer.kt:111-129`, `:346`, `:419`).

```css
.bc-miniplayer {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + var(--bc-tabbar-lift) + var(--bc-tabbar-h) + 8px);
  width: min(calc(100vw - 2 * var(--bc-bar-gutter)), var(--bc-floating-bar-max));
  height: var(--bc-miniplayer-h); border-radius: 9999px;
  background: var(--bc-frost-bg); backdrop-filter: blur(24px);
  border: 0.5px solid var(--bc-glass-edge);        /* MiniPlayer.kt:404 */
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center;
  padding: 8px 12px; gap: 10px;
}
```

(The 8px stack gap above the tab bar is BottomFadeScrim's arithmetic: 56dp bar + 8dp gap,
`BottomFadeScrim.kt:31-35`.) Gestures in §4.4.

### 3.6 Floating top-bar controls

Pushed/artwork pages put their controls on circles and pills of frost, not a full-width bar
(`FrostedTopBar.kt:155-156`, `:348-513`): back button = 44px circle; actions = a pill that grows
with `animateContentSize` on a no-bouncy spring (`FrostedTopBar.kt:392-397`), 44px slots, 10px gaps,
1.5px end inset once >1 action (`FrostedTopBar.kt:666-674`, `:473-484`). CSS: `.bc-glass` on
`border-radius: 9999px` (or `border-radius: 44px` for a single action), `transition: padding 300ms
cubic-bezier(.05,.7,.1,1)` — the Compose no-bouncy/MediumLow spring (StiffnessMediumLow = 400) as a
curve. The full-width bounded bar draws the hairline divider at 0.6 alpha animated over 220ms
(`FrostedTopBar.kt:194-203`, `:343`).

### 3.7 Menus, and the held-item plate

Panel: 256px wide, 30px continuous corner, shadow `--bc-shadow-menu`, frost with
`color-mix` slab at the dark/light fill alpha table (`IosMenu.kt:181-199`):

```css
.bc-menu {
  width: var(--bc-menu-w); border-radius: 30px; corner-shape: superellipse(5);
  background: color-mix(in srgb, #1c1c1e 60%, transparent);   /* dark blended slab (IosMenu.kt:184) */
  /* plain rows: 80% (IosMenu.kt:184); light theme 72% (IosMenu.kt:184) */
  backdrop-filter: blur(24px) saturate(1.8);                  /* IosMenu.kt:221-222, OptimizedHaze.kt:49 */
  border: 0.5px solid var(--bc-menu-rim-dark);
  box-shadow: var(--bc-shadow-menu);
  padding: 8px 4px;
}
.bc-menu__row { min-height: 44px; border-radius: 14px; padding: 11px 14px 11px 12px; }
/* IosMenu.kt:358-359, :344 */
.bc-menu__sep { height: 17px; padding: 0 18px; }               /* IosMenu.kt:244-245 */
.bc-menu__sep::before { height: 1px; background: var(--bc-menu-sep-dark); }
.bc-menu__quick { height: 66px; gap: 4px; padding: 0 10px; }   /* IosMenu.kt:263-265 */
```

Held-item plate (context menu): 20px radius, 8px inner padding, fill white/black at 50% (85% under
reduced blur), hairline white/10% dark or black/6% light, 20px shadow; page behind is frosted
`ultraThin` under a black scrim at 30% dark / 10% light (0.62% / 36% without blur)
(`HeldContextMenu.kt:141-156`, `:200-204`, `:348`). Menu hangs 10px off the lifted item, 12px screen
margins, opposite-corner growth (`HeldContextMenu.kt:241-242`, `:330-341`) — geometry in §4.9.

### 3.8 Player drawer (bottom sheet family)

26px top corners, max 640px wide / 560px tall, scrim black 50%, grab handle 36×4px white/25%,
title 19px Bold, content padding 16px sides, 10px top, 20px bottom; frost = menu frost over the
player (`PlayerDrawer.kt:64-80`, `:202`, `:241-264`):

```css
.bc-drawer {
  border-radius: 26px 26px 0 0; max-width: var(--bc-drawer-max-w); max-height: var(--bc-drawer-max-h);
  background: var(--bc-menu-frost-fill); backdrop-filter: blur(24px) saturate(1.8);
  padding: 10px 16px 20px;
}
.bc-drawer__scrim { background: rgba(0,0,0,.5); }              /* PlayerDrawer.kt:80 */
.bc-drawer__handle { width: 36px; height: 4px; border-radius: 9999px;
  background: rgba(255,255,255,.25); margin-bottom: 12px; }    /* PlayerDrawer.kt:248-253 */
```

### 3.9 Alert card

270px wide, 14px corner, scrim black 28%, rows 44px (`UpdateAvailableDialog.kt:46-55`); card
material is frost over the page with hairline dividers. The web's current modal (14px card, 30px
close circle, `web/docs/android-vs-web-ui.md:200`) keeps its geometry hooks but re-skins to this.

---

## 4. Motion spec

Android motion is mostly springs; CSS cannot express a spring. The port therefore ships one small
JS spring utility used everywhere a spring appears, plus CSS transitions where a tween appears.
Proposed `web/app/src/lib/spring.ts` — the same semi-implicit-Euler integrator Android uses
(`GlassSelectionPill.kt:379-397`), in 1/240s substeps:

```ts
export function springStep(x: number, v: number, target: number, dt: number,
                           stiffness: number, damping: number): [number, number] {
  let t = dt, px = x, pv = v;
  while (t > 0) { const step = Math.min(t, 1 / 240);
    pv += (-stiffness * (px - target) - damping * pv) * step; px += pv * step; t -= step; }
  return [px, pv];
}
```

### 4.1 The constants table (single source for the web)

| Motion | Type | Constants | Source |
|---|---|---|---|
| Player sheet open/close | spring | stiffness 195, ζ=1 (no bounce), settle 0.5px | PlayerSheetMotion.kt:33-36, :339-343 |
| Tab pill travel (plain bar) | spring | ζ 0.72, stiffness 320 | FloatingBottomBar.kt:147 |
| Tab glyph pop | spring | ζ 0.72, stiffness 320, target scale 1.08 | FloatingBottomBar.kt:147, :374-377 |
| Pill stretch in travel | function | scaleX 1 + lag×0.16, scaleY 1 − lag×0.08 (lag = distance/step) | FloatingBottomBar.kt:163, :174, :236-240, :281-287 |
| Glass pill travel (liquid bar) | spring | stiffness 280, damping 31.4 (≈ζ .94) | GlassSelectionPill.kt:360-361 |
| Glass pill lift | spring ×2 | stiffness 250; damping X 19.0 (ζ .6), Y 22.1 (ζ .7) | GlassSelectionPill.kt:364-366 |
| Glass material fade | spring | stiffness 1000, damping 63.3 (critical) | GlassSelectionPill.kt:369-370 |
| Glass→flat handover | exp ease | start 92% of travel; τ 0.09s in, 0.05s out | GlassSelectionPill.kt:372-374, :567 |
| Pill acceleration squash | derivative | window 0.3s, sensitivity 0.00007, clamp ±12%, response 0.18s | GlassSelectionPill.kt:473-478 |
| Mini-player pull lift | rubber band | rate 0.5/sqrt(1+p/72px) (formula) | MiniPlayer.kt:159-175 |
| Mini-player release settle | spring | ζ 0.65, stiffness 400 (MediumLow) | MiniPlayer.kt:303-311 |
| Skip swipe threshold | gesture | 72px; pull bias 1.5×; flick 400dp/s (sheet), 450px/s (queue) | MiniPlayer.kt:142, :151; MainActivity.kt:6243; NowPlayingScreen.kt:263 |
| Page transitions | tween | crossfade in/out 180ms; tab swap none | MainActivity.kt:2882-2896 |
| Top-bar title/divider | tween | 220ms | FrostedTopBar.kt:187-203 |
| Bottom scrim growth | tween | 220ms | BottomFadeScrim.kt:84-87 |
| Tab tint | tween | 200ms | FloatingBottomBar.kt:380-388 |
| Actions pill resize | spring | no-bouncy, stiffness 400 | FrostedTopBar.kt:392-397 |
| Scrub bar thickness | spring | ζ 0.5 (MediumBouncy), stiffness 400 | ThinSlider.kt:104-111 |
| Scrub morph (sheen⇄fill) | tween | 450ms FastOutSlowIn; sheen sweep 1000ms linear ping-pong, band 34% | ThinSlider.kt:431, :453-491, :278 |
| Automix pulse | tween/clock | cover 700ms, pulse depth 900ms, rest 10%, beat cos², breath 1.8s | ThinSlider.kt:403-428 |
| Automix window fade | tween | 500ms FastOutSlowIn | ThinSlider.kt:293 |
| Artwork pause/scrub scale (landscape) | tween | 500ms cubic-bezier(.215,.61,.355,1); scales 1 / .88 / .94 | NowPlayingScreen.kt:442-457 |
| Artwork dock fade | function | fully faded with 15% of travel left; floor 1/255 | NowPlayingScreen.kt:492-495 |
| Queue sleeve travel | tween | 420ms pro-rata; carry 30%; flick 450px/s | NowPlayingScreen.kt:246-263 |
| Deck/canvas slide | tween | 420ms; deck fade-in 700ms; idle 5s | NowPlayingScreen.kt:624-630 |
| Lyrics scroll | tween | cubic-bezier(.41,0,.12,.99), settle 400ms, lead 350–500ms | PlayerLyrics.kt:425-436 |
| Lyrics line falloff | table | alphas 1/.8/.7/.58/.46 (phone: +.34 tail), blur 0/1/1/1.7/2.4px | PlayerLyrics.kt:361-372 |
| Lyric word wipe | drawing | feather 30px, word rise 2px | PlayerLyrics.kt:309, :318 |
| Backing vocal | tween | open 400ms, close 450ms, lead 250ms, rise 6px, rest scale .94 | PlayerLyrics.kt:265-285 |
| Translation slide | tween | 540ms | PlayerLyrics.kt:507 |
| Mesh colour fade | tween | 900ms (player), 1400ms (legacy), 320ms (full-cover blur crossfade) | ArtworkMeshBackdrop.kt:571; MeshGradient.kt:114; ArtworkMeshBackdrop.kt:150 |
| Mesh drift | clock | settle 0.45π rad over 8s (legacy), amplitude 0.16 | MeshGradient.kt:328, :198-199 |
| Held menu lift | spring | ζ 0.72, stiffness 420; exit 230ms FastOutSlowIn (reduced: 140/110 linear) | HeldContextMenu.kt:112-131 |
| Menu growth | function | scale .55→1 from nearest corner; alpha (p−.1)/.9 | HeldContextMenu.kt:329-341 |
| Drawer enter/exit | tween | slide 260ms FastOutSlowIn / 180ms; drag spring stiffness 400; dismiss ≥25% | PlayerDrawer.kt:195-196, :117-121, :87 |
| Page-tint crossfade | tween | 260ms (snap when known up-front or reduced-motion) | ArtworkPalette.kt:127-131, :194 |
| Switch thumb | spring | ζ 0.78, stiffness 700; stretch 1.18 (ζ .7, 900) | IosSwitch.kt:73-82 |
| Queue swipe commit | gesture | commits at 45% width, positional 50%, hysteresis 0.8 | Common.kt:390-398, :420 |
| Marquee | clock | 26px/s, 48px gap, 5s rest, artist stagger 3s | PlayerControls.kt:1390-1399 |
| Playing bars | clock | 25ms frame gap; periods 520/650/780ms, peaks 260/310/360ms, minimums .38/.78/.52 | Common.kt:709, :728-738 |
| Top Picks motion | clock | clip start 400ms, release 1000ms, station period 9s | TopPicksShelf.kt:570-649 |
| Sign-in banner press | spring | scale .98, stiffness 900 | Common.kt:863 |
| Refresh puck | function | eased travel f≤1 else 1+(f−1)×0.35; alpha f×3; spin 180°×f | FrostedTopBar.kt:622-653 |

Where a plain CSS transition suffices, encode the tween rows directly (`transition: … 180ms`,
`220ms`, `cubic-bezier(.215,.61,.355,1)` for the artwork scale, `cubic-bezier(.41,0,.12,.99)` for
lyrics). Where a spring appears, call `springStep` from a `requestAnimationFrame` loop and write
`transform` (the web already does rAF-driven animation in `MeshBackdrop.tsx:249-260`).

### 4.2 Player sheet presentation

The web's full-screen player (`web/app/src/shell/FullScreenPlayer.tsx:137`) becomes a bottom sheet
in the Android image: fully open = full-screen takeover on every window size
(`MainActivity.kt:555-560`), opened by mini-player tap or vertical pull, closed by drag-down, back,
or scrim — everything on the one spring:

- **Open:** `held = travel` then slide `travel → 0` on the sheet spring (stiffness 195, critical,
  0.5px settle), initial velocity 0 (`PlayerSheetMotion.kt:188-199`).
- **Close:** slide from current position to full travel with the release velocity fed into the
  spring; dismiss at the end (`PlayerSheetMotion.kt:256-272`).
- **Pull:** finger 1:1 the whole way (the *player* follows exactly; `MiniPlayer.kt:283-287`), while
  the mini player itself rises at `0.5×sqrt`-easing rate (`MiniPlayer.kt:159-175`); release decides
  by flick (≥400px/s, `MainActivity.kt:6243`) else by half-travel position; the release velocity
  seeds the settle spring (`PlayerSheetMotion.kt:295-318`).
- **Artwork docking:** the sleeve flies between the mini-player cover and the player for the whole
  travel, fully faded with 15% of travel left (`NowPlayingScreen.kt:492-495`); the web implements
  this with a fixed-position clone of the art `<img>` driven by the same spring value
  (FLIP-style), fading per `DOCK_FADE_LEAD`.

Web equivalent: keep the overlay mounted as a `position: fixed` sheet whose `transform:
translateY(px)` is written by the spring loop; pointer events via `PointerEvent` capture on the
artwork/header strip (32px dismiss strip, `NowPlayingScreen.kt:271`).

### 4.3 Tab-bar pill

Web JS on the `.bc-tabbar__pill`:

1. Target = `selectedIndex × step` where `step = (rowWidth + 6px)/n` (`FloatingBottomBar.kt:205-212`).
2. Animate target on the GlassSpring (ζ .72, stiffness 320) — `snap()` when reduced motion
   (`FloatingBottomBar.kt:189-193`).
3. Each frame: `lag = |target − pos| / step` clamped 0–1; `transform: translateX(pos)
   scaleX(1 + lag×0.16) scaleY(1 − lag×0.08)` (`FloatingBottomBar.kt:281-287`).
4. Horizontal drag retargets continuously (`dragOffset`), snapping to the nearest index on release
   with a haptic tick per crossing (`FloatingBottomBar.kt:295-335`) — web: visual tick only (§7).
5. Selected glyph scales 1.08 on the same spring; tint tweens 200ms (`FloatingBottomBar.kt:374-388`).

The *glass* pill (lift + squash + lens handover) is the liquid-glass-only upgrade
(`GlassSelectionPill.kt:54-81`). Web nearest-equivalent, Phase 4 polish: the lift (grow 9px, springs
at §4.1 rows 5-6) and the acceleration squash are portable with the same constants; the lens is not
(§7). The flat pill with stretch/squash is the baseline.

### 4.4 Mini-player gestures

One pointer-detector, axis decided once at touch-slop (`MiniPlayer.kt:211-315`):

- **Horizontal:** accumulate; at ≥72px (`TRACK_SWIPE_THRESHOLD`) at release, skip prev/next
  (`MiniPlayer.kt:262-275`).
- **Vertical:** only upward, only when |dx| < |dy|×1.5 (`PULL_BIAS`) — hand to the sheet pull
  (§4.2); the bar lifts by `pullLift` (`MiniPlayer.kt:159-175`) and springs home on release
  (ζ .65, stiffness 400).

### 4.5 Screen transitions

- **Tabs swap with no animation** (`MainActivity.kt:2891-2892`).
- **Every push/pop crossfades 180ms in and out** (`MainActivity.kt:2894`).
- Web: route changes wrap in a keyed 180ms opacity transition; tab switches render instantly
  (the current `--animate-enter: 0.3s`, `global.css:44`, becomes 180ms fade, applied per the
  destination table).

### 4.6 Scrub bar (ThinSlider)

Web port replaces the current `useScrubber` bar with the Android drawing (`ThinSlider.kt:59-276`):

- Idle 7px capsule, drag 12px on the bounce spring (§4.1); colours: played `rgba(255,255,255,.92)`,
  unplayed `rgba(255,255,255,.26)`, automix marker `rgba(255,255,255,.5)` (`ThinSlider.kt:96-101`).
- Touch target = bar height + 22px (`ThinSlider.kt:155`); one gesture loop for tap+drag
  (`ThinSlider.kt:159-181`).
- Version-switch sheen: full-thickness band, 34% of width, 1000ms linear ping-pong, fill retracts
  450ms and returns when done, minimum 600ms hold (`ThinSlider.kt:278`, `:431`, `:434`, `:453-491`).
- Automix: window marker feathered 40% each end (min 6px, max 40px, 6 smoothstep stops,
  `ThinSlider.kt:281-290`), fades 500ms; blend pulses with cos² beat shape, cover 700ms, rest 10%
  (`ThinSlider.kt:293`, `:403-428`). (The web already has the beat pulse in
  `web/app/src/shell/useScrubber.ts:10-24` — realign its constants to these.)
- Labels lifted 9px above the bar (`PlayerControls.kt:195`, `:237-242`), `labelMedium` 12px at
  `rgba(255,255,255,.55)`; "Mixing" swaps with the centre badge breathing on the same clock
  (`PlayerControls.kt:245-276`, `:287-309`).

### 4.7 Lyrics

Type: synced 34px/41px ExtraBold, unsynced 30px/38px (`PlayerLyrics.kt:2228-2241`); the web
already pins `BitChord SF Pro Display` for lyrics (`global.css:288-304`) — re-register at the
shifted weights (§2.4). Behaviour:

- Unswept part of the playing line at 45% alpha (strip variant 55%) (`PlayerLyrics.kt:210-211`).
- Glow bloom on held words: white at 62% max, 6px radius, 10px room (`PlayerLyrics.kt:230-248`) —
  web: `text-shadow: 0 0 6px rgba(255,255,255,.62)` per word, drawn only on carried words.
- Distance falloff down the list: alpha 1/.8/.7/.58/.46 with blur 0/1/1/1.7/2.4px on a phone
  (`PlayerLyrics.kt:361-372`) — web: per-line `opacity` + `filter: blur()` from scroll position.
- Line travel: `cubic-bezier(.41,0,.12,.99)`, 400ms settle, scroll lead 350–500ms by distance
  (`PlayerLyrics.kt:425-436`); stagger 3 steps × 6% (`PlayerLyrics.kt:452-453`).
- Pressed line 0.96, inactive 0.98, browsing dim 0.8 (`PlayerLyrics.kt:402-408`).
- Backing vocals 23px/29px at 72%, rise 6px, open 400ms/close 450ms with 250ms lead
  (`PlayerLyrics.kt:257-285`); duet lane 44px (`PlayerLyrics.kt:339`); translation slide 540ms
  (`PlayerLyrics.kt:507`); instrumental dots 13px/5px gaps, rest alpha 25% scale 76%
  (`PlayerLyrics.kt:418-422`).
- The current web panel (`web/app/src/shell/LyricsPanel.tsx`) keeps its provider machinery
  (`web/docs/android-vs-web-ui.md:136-139`); the presentation layer re-skins to this table.

### 4.8 Artwork mesh motion

Default player theme = the anchored 6×6 mesh (`ArtworkMeshBackdrop.kt:294-367`): the web's
`MeshBackdrop.tsx` (4×4 blob mesh, `web/app/src/lib/meshPalette.ts:6`) is re-aligned:

- Grid 6×6 (`MESH_GRID`, ArtworkMeshBackdrop.kt:536), decode at 120px (`:512`), per-cell mean with
  saturation ×1.12 and lightness floor 0.045 (`:637`, `:747-755`) — replace `meshPalette`'s
  `shape()` (×1.3 saturation, 0.38 luminance clamp, `meshPalette.ts:15-21`) with these numbers.
- One seeded rotation below the seam row, mirrored half the time (`:677-691`) — the web already
  quarters its grid for the same reason (`MeshBackdrop.tsx:28-32`); keep the quarter-turn but seed
  it from the artwork URL so it is stable like Android's `Random(seed)` (`:679`).
- Colour change crossfades 900ms (`MESH_FADE_MS`, :571) — the web's 1200ms (`MeshBackdrop.tsx:12`)
  becomes 900ms.
- Seam: mesh row 0 = sleeve's bottom edge, anchored under the artwork, seam glides 320ms
  (`ArtworkMeshBackdrop.kt:374-403`, `NowPlayingScreen.kt:305`); scrim black 6%→30%
  (`ArtworkMeshBackdrop.kt:358-365`). On the web portrait player the mesh anchors to the artwork
  column's bottom edge; the drift animation itself stops (Android's backdrop is *still* except for
  colour changes — the drift lives only in the legacy/welcome mesh, `MeshGradient.kt:66-75`).
- Full-cover blur fallback (`FullArtworkBlurBackdrop`, scrim 0.34/0.48/0.64, `:406-413`): used on
  the web for the lyrics/queue columns and under theatre video.

### 4.9 Menus, sheets, dialogs, held menu

- Menu popover entrance: scale 0.55→1 from the corner nearest its anchor, alpha from
  (p−0.1)/0.9, riding the item's motion; geometry — 12px screen margins, 10px gap, below by
  preference, hung off the item's nearer edge (`HeldContextMenu.kt:241-297`, `:329-341`).
  The web's current `menu-in 0.12s` (`global.css:39`, `:50-55`) is replaced by this transform.
- Held-item lift: spring ζ 0.72 / 420 (Android: `HeldContextMenu.kt:121`), scale from 1 at the
  item to `liftScale` at the plate, alpha ×3 fast-in, translation lerp from the item's origin
  (`:310-325`); exit 230ms FastOutSlowIn. Plate/scrim values in §3.7.
- Drawer: slide-up 260ms FastOutSlowIn in, 180ms out, drag follows finger 1:1, dismiss past 25% of
  height, scrim alpha tied to drag fraction (`PlayerDrawer.kt:117-124`, `:195-196`, `:87`).
- Alert: fade+scale in — geometry fixed at §3.9; **not pinned in code** for its entrance duration
  (the Compose `AlertDialog` default is used); spec: 220ms FastOutSlowIn scale .96→1.
- Track swipe-to-queue: commits at 45% of width, haptic tick at the crossing (web: 2px visual
  nudge), reveal background `primary @ 18%` (`Common.kt:390-398`, `:453`).

### 4.10 Switches and pressed states

- Switch: 64×28px track, 40×24px white thumb, travel spring ζ 0.78/700, press stretch 1.18
  toward the destination edge (ζ .7/900), colours — on `#34c759` (light) / `#30d158` (dark),
  off `#8e8e93` at 22%/36% alpha, thumb shadow 2px (`IosSwitch.kt:73-88`, `:129-136`, `:141-145`).
  The web's `Select`/toggle surfaces adopt it; it is a new component (`web/app/src/pages/SettingsPage.tsx`
  toggles today are native inputs, `web/docs/android-vs-web-ui.md:109`).
- Marquee title at 26px/s after 5s rest, 48px gap, artist line 3s behind
  (`PlayerControls.kt:1390-1399`) — CSS `@keyframes` translate loop.
- Playing bars (search rows): 24px plate, 3px bars on 25ms frame gaps with per-bar periods/minimums
  from §4.1 (`Common.kt:721-779`).

### 4.11 Reduced motion

Android honours a "reduce animation" setting (`AppSettings.kt:431`) — the web already nukes all
durations under `prefers-reduced-motion` (`global.css:394-403`). Spec keeps that kill-switch but
adds the Android semantics where they differ:

- Sheet open/close become instant position changes (M3's own slide, `MainActivity.kt:598-604`);
  no docking flight.
- Tab pill snaps; no lift, no squash (`GlassSelectionPill.kt:157-160`, `FloatingBottomBar.kt:193`).
- Tint crossfades cut (`ArtworkPalette.kt:127-131`); mesh colour snaps (`MeshGradient.kt:131`).
- Held menu becomes a 140ms linear fade (`HeldContextMenu.kt:116-118`).
- Pulsing/scanning motions hold at rest (`Common.kt:710-718`).

---

## 5. Dynamic colour system

**Android.** `rememberArtworkPalette` decodes the artwork at 128px (`ArtworkPalette.kt:191`),
quantises to 24 swatches (`:249`), picks dominant = max population and vibrant = max
`saturation × √population` (`:221-228`), reads the bottom-edge mean over an 18% band (`:259-281`)
and a top-band luminance over 10% (`:288-295`), then builds seven theme-aware roles by HSL
transforms (dark: background L .13 sat .20–.62; wash L .14–.24; elevated L .22; accent L .62–.78
sat ≥.55; onBackground white; onBackgroundVariant L .80; divider white@12% — light: L .91/.78–.90/
.83/.30–.44/black/L .34/black@10%, `ArtworkPalette.kt:326-388`). Neutral artwork stays neutral
below 12% saturation (`:399-409`). The palette crossfades 260ms unless already known
(`:127-131`, `:194`). Status scrim alpha maps from top-band luminance .16→.65 (`:317-324`).

**Web today.** `web/app/src/lib/artworkColor.ts` measures an 8×8 average of a 60px decode and
returns `{background, dark}` (with a darkening heuristic, `artworkColor.ts:42-46`);
`usePageTint.ts` sets `--page-tint` + `data-tint` on the page (`usePageTint.ts:14-18`), and
`tokens.css` re-derives label colours from the tint (`tokens.css:240-265`).

**Port.** Keep the plumbing, replace the measurement with the Android algorithm — one new
`web/app/src/lib/artworkPalette.ts`:

1. Reuse `artworkAtPixels(url, 120)` (existing helper, `web/app/src/lib/artwork.ts`), draw to a
   120px canvas, compute per-cell means exactly as `meshPalette.ts:30-59` does today, plus:
   - dominant = highest-population cell cluster (the 6×6 mean grid already encodes population by
     area — dominant is the grid's dominant colour by cell count);
   - vibrant = max `saturation × √cellCount-weighted population` over the grid
     (`ArtworkPalette.kt:222-228`);
   - edge = mean of the bottom 18% rows (`ArtworkPalette.kt:259-281`).
2. Emit the seven roles as HSL transforms copied verbatim from `ArtworkPalette.kt:326-388`
   (dark/light picked from the page's appearance, and the 12% chromatic threshold from
   `:399-409`).
3. `usePageTint` sets them as `--bc-page-background`, `--bc-page-wash`, `--bc-page-elevated`,
   `--bc-page-accent`, `--bc-page-on`, `--bc-page-on-variant`, `--bc-page-divider` on
   `#scrollable-page`; the label/divider roles in `android-tokens.css` reference these before
   falling back to the flat scheme (same override pattern as today's `data-tint` blocks,
   `tokens.css:240-265`).
4. Fade: a 260ms crossfade on first unknown palette, an instant set when cached — same rule as
   `ArtworkPalette.kt:114-131`. Cache keyed by URL (today's `cache` map, `artworkColor.ts:11`).
5. Glass surfaces on tinted pages take `surfaceTint` = `--bc-page-elevated` in place of the theme
   tint (the `surfaceTint` parameter Android threads through, `LiquidGlass.kt:217-218`,
   used by `DetailScreen.kt:436-439`).
6. The player backdrop keeps its own path (§4.8) — mesh from the artwork, not from this palette.

---

## 6. Component-by-component port map

Keyed to `web/docs/android-vs-web-ui.md`'s sections. "Web component" files are under
`web/app/src/`. S/M/L per that doc's scale (S < a day, M ~ days, L ~ a week+). **[new]** marks a
component the web does not have and must be built.

| § | Surface | Android source | Web component | Changes | Size |
|---|---|---|---|---|---|
| 1 | Navigation shell | `MainActivity.kt:514`, `FloatingBottomBar.kt:176` | **[new]** `shell/FloatingTabBar.tsx` replacing the phone sidebar drawer | 4 tabs (Home/Explore/Library/Search) in the §3.4 bar at <1000px; sidebar removed at phone widths, kept for pointer/large screens as a re-skinned rail; pill motion §4.3; drag-to-switch | **L** |
| 1 | Sidebar (desktop) | no Android counterpart at wide widths — the bar stays floating (Common.kt:154 caps width 440dp) | `shell/Sidebar.tsx:135-177` | Keep the tree structure (it is the library browser), re-skin: frost panel (`--bc-frost-*`), 16px gutter, SF Pro type, selected row = `--bc-indicator-alpha` fill; phone widths switch to the tab bar | M |
| 1 | Mobile top bar | `FrostedTopBar.kt:91` (52dp) | `shell/MobileTopBar.tsx:7-21` | 52px, transparent with the §3.2 top fade beneath, wordmark per Android (no bar pane on root tabs) | S |
| 2 | Home shelves | `HomeScreen.kt:1-40` (sharedUi) | `pages/HomePage.tsx:27-81` | Shelf card width 150px (`Common.kt:163`), row gutters 16px, playing-row/bar treatment §4.10; skeleton styling from `Skeletons.kt` lineage | S–M |
| 2 | Top Picks shelf | `TopPicksShelf.kt:134-140` | **[new]** home shelf | 3:4 cards at 60% of row (max 280px), motion gated to foreground+not-player, loops at 9s (`:134-149`, `:570-649`) — a new visual shelf; feature-side already ranked M in inventory §25 #24 | M |
| 3 | Explore / mood tiles | `ExploreScreen.kt:164-285` | `components/music/CategoryTiles.tsx:40-104` | Already a faithful duotone port (inventory §3 parity); re-token: 18px corner, 12px gap, 28% stripe, min card 220px, ≤6 columns | S |
| 4 | Search | `SearchScreen.kt:1-30` (sharedUi), `PillSegmentedControl.kt:9` | `pages/SearchPage.tsx`, `components/music/SearchField.tsx` | Field becomes the Android `PillTextField` geometry (40px, 11px radius, §2.5); scope bar = segmented control per `PillSegmentedControl.kt`; result rows = `SongRow` spec §6.9 | M |
| 5 | Album detail | `DetailScreen.kt:190-282` | `pages/AlbumPage.tsx:15-64`, `components/music/DetailHeader.tsx`, `TrackList.tsx` | End-to-end artwork palette (§5); sleeve 76%/12px/18px-shadow; full-bleed 62% option; track rows: 52px art, 8px corner, 24px number column, dividers 0.5px at 84px inset; sort/filter chips 12px pill | M |
| 6 | Artist detail | `DetailScreen.kt:392-435`, `:195`, `:258-273` | `pages/ArtistPage.tsx:60-155` | Keep Apple art pipeline (parity, inventory §6); re-skin: photo ratio 0.95, dissolve into palette wash, play button 70px/56% icon, logo width 82%, stats chips | M |
| 7 | Playlist detail | `DetailScreen.kt:301-386` | `pages/PlaylistPage.tsx:14-48` | Same template as album; description in header; per-playlist sort | M |
| 8 | Library | `LibraryScreen.kt:1-14` (sharedUi), `Common.kt:221-257` | `pages/LibraryPage.tsx:29-97` | Grid: min card 140px, 12px gaps, 2–5 columns; shelf rows 150px cards; sections rest on `--bc-surface-variant` group cards | M |
| 9 | History | `HistoryScreen.kt:35-91` | **[new]** `/history` route + page | Plain `SongRow` list, 0.5px dividers at 84px inset, plays-as-queue (feature gap #1 in inventory §25 — build with the Android page's look from day one) | S–M |
| 10 | Listen Together | `ListenTogetherScreen.kt:1-16` | `pages/ListenTogetherPage.tsx:40-303` | Re-skin to group cards (14px radius, 16px inset); member rows keep crown/dots; **[new]** QR invite card — Android draws modules rounded in theme colours, EC level M (`QrCode.kt:36-58`) — any MIT QR painter + rounded modules (inventory #5) | S (reskin) + S (QR) |
| 11 | Settings | `SettingsSheet.kt:2346-2506`, `:189` | `pages/SettingsPage.tsx:59-205` | iOS-grouped list: 14px group cards on `--bc-surface-variant`, 16px inset, 44px rows, hairline between rows, section headers labelSmall/primary uppercase (`SettingsSheet.kt:2686-2691`); **[new]** `components/IosSwitch.tsx` (§4.10) replacing native checkboxes; selects become iOS pop-up menus (§3.7) | M |
| 12 | Account | `AccountAndScrobblingScreen.kt:1` | `shell/AccountButton.tsx:19-66` | Re-skin only (relay model unchanged — inventory §12) | S |
| 13 | Player (now playing) | `NowPlayingScreen.kt:200-660`, `PlayerControls.kt`, `ThinSlider.kt` | `shell/FullScreenPlayer.tsx:137-423` | Portrait column: 30px gutter, max 560px, 54px thumb, 60px header, 20px art-title gap; scrubber §4.6; transport: 53px skips scaleY .85, 44px bottom actions, 35px active tiles; sheet motion §4.2; mesh §4.8; **[new]** `shell/PlayerSheetMotion.ts` (the spring+gesture controller) | **L** |
| 13 | Queue in player | `PlayerQueue.kt:1-14` (sharedUi) | `shell/UpNext.tsx:106-207` | Drawer in the `PlayerDrawer` shell (§3.8) on the player; keep the side panel on desktop but re-skin to frost; queue-history section when settings exist | M |
| 13 | MixView popup | `MixViewPopup.kt:1-10` (sharedUi) | **[new]** optional | Automix deck popup — defer (feature-side inventory §13: web has stats line + highlight only). Marked here so the frost token covers it when built | — (defer) |
| 13 | Audio output sheet | `AudioOutputSheet.kt:1-10` | — | `setSinkId` picker deferred per inventory §17; if built, it takes the `PlayerDrawer` shell | — (defer) |
| 14 | Lyrics | `PlayerLyrics.kt:200-460`, `:2228-2241` | `shell/LyricsPanel.tsx:340-385` | Presentation table §4.7; keep am-lyrics engine and provider sheets; offset control (inventory #4) lands in this skin | M |
| 15 | Up Next (side) | `PlayerQueue.kt`, `NowPlayingScreen.kt:812-822` | `shell/UpNext.tsx` | Rows re-skinned: 16px press radius, 44px touch, drag-reorder kept (already parity, inventory §15) | S |
| 16 | Mini player | `MiniPlayer.kt:79-315` | `shell/MobilePlayerBar.tsx:19-76` (phone) + `shell/PlayerBar.tsx:30-114` (desktop) | Phone bar = Android pill §3.5 with swipe/pull gestures §4.4 (**[new]** `shell/MiniPlayerGestures.ts`); desktop pill re-skins to the same 56px capsule + frost (LCD idiom retired) | M |
| 17–19 | Equalizer / outputs / downloads | `EqualizerScreen.kt`, hardware sheets | — | No visual port; native-only per inventory §17/§19. If the Web-Audio equalizer is ever built (inventory §17 "feasible"), it uses the Settings group + `PlayerDrawer` skins | — (native-only) |
| 20 | Onboarding / festive | `OnboardingScreen.kt:130` | — | None on web by decision (inventory §20) | — |
| 21 | Track menu | `SongActionsMenu.kt:103-414`, `IosMenu.kt` | `components/music/TrackMenu.tsx:103-144`, `components/Menu.tsx:23-72` | Menu panel = §3.7 (256px, 30px continuous corner, frost, 44px rows, quick-action tiles 66px); keyboard nav kept; **[new]** long-press/held context menu (§4.9) — inventory gap #8 — as `components/HeldContextMenu.tsx` | M |
| 21 | Playlist picker | `PlaylistPickerSheet.kt:1-10` | `TrackMenu` add-to-playlist inline list | Multi-tick picker in the `PlayerDrawer` shell when built (inventory §21) | S |
| 22 | Dialogs | `UpdateAvailableDialog.kt:45-60` | `shell/LyricsSettings.tsx:47-60` (the one modal idiom) | Alert family §3.9: 270px, 14px, 44px rows, scrim 28%; all modals (Lyrics settings, song info, party server) share it | S–M |
| 23 | Banners/notices | `QueueActionNotice.kt:6-10` | `shell/Banner.tsx:11-21` | Android has no red banner band; relay-unreachable states become an iOS-alert (§3.9) or a toast in the menu frost; **[new]** toast store (inventory #19) styled as the QueueActionNotice strip above the mini player | S |
| 24 | Theming & motion settings | `AppSettings.kt:412-515`, `SettingsSheet.kt:1003-1104` | — | The web ships one appearance (Android defaults: theme follows system where the web uses `prefers-color-scheme`, reduceAnimation/reduceDynamicBlur follow the OS reduce/preference queries §4.11/§7); no settings page needed | — |

### 6.9 The row system (one spec for all lists)

`SongRow` (`Common.kt:269-649`) is the atomic list item and ports once: 16px side padding, 4px
vertical padding, 52px art (16:9 for video at the same height), 8px art corner + 0.5px inner hairline
(`Common.kt:560-562`), 14px art-to-title gap (12px for numbered rows + 24px number column,
`Common.kt:135`, `:572`), title `titleMedium` (16px Medium), artist `bodyMedium` (14px) at
on-surface-variant, 2px title gap (`Common.kt:579`), current-row title tinted accent + background
accent@14% (`Common.kt:504-506`), trailing ⋮ in a 36px box with a 14px gutter overhang
(`Common.kt:684`), duration `labelMedium`, dividers 0.5px starting at 84px inset (`HistoryScreen.kt:81-85`).
Search playing bars §4.10. This replaces the Apple `TrackList` styling
(`web/app/src/components/music/TrackList.tsx:15-230`) while keeping its virtualization.

---

## 7. What cannot be same-to-same on the web

Each item: what Android does, why the web can't, the substitute, and the fallback tier.

1. **Runtime-shader lens refraction** (liquid glass). Android records the page into a layer and
   bends it through a lens shader with chromatic aberration (`LiquidGlass.kt:242-264`,
   `GlassSelectionPill.kt:544-553`; radius/amount 24dp scaled ×0.33, `LiquidGlass.kt:65-67`,
   `:233-234`; pill lens 12/14dp, `GlassSelectionPill.kt:569-570`). CSS has no refraction.
   **Substitute:** the frost tier (§3.1) — which is exactly what Android itself falls back to
   everywhere outside the optional Liquid Glass setting (off by default, `AppSettings.kt:500`), so
   the *default* Android look is portable whole. The directional rim highlight is approximated with
   the 135° `plus-lighter` gradient (§3.1).
2. **The Default highlight shader.** A 45°, falloff-1, Plus-blended white shader
   (`HighlightStyle.kt:54-80`). **Substitute:** §3.1's gradient overlay; the *values* (white .5,
   45°) are pinned and reused; the falloff curve is not expressible. Visual difference is
   confined to glass surfaces' rim.
3. **Haptics.** Every toggle, tab crossing, and skip buzzes (`Haptic.*`, e.g.
   `FloatingBottomBar.kt:330`, `IosSwitch.kt:96-98`). No web equivalent (Web Vibration API is not a
   haptic engine and is Android-Chrome only). **Substitute:** none — the motions alone. Do not fake
   it with flashes.
4. **iOS rubber-band overscroll.** A custom overscroll with rubber-band constant 0.55 and
   rebound springs 247/130 stiffness by velocity (`IosOverscroll.kt:37-42`). Browsers own
   overscroll; the web already disables it (`global.css:327`). **Substitute:** leave native scroll
   rubber-banding (iOS Safari/Mac) as-is; Android-like bounce is not worth a JS scroll-jacking
   overlay. The *mini-player pull's* rubber band (`MiniPlayer.kt:159-175`) — which is in-app, not
   scroll — ports exactly.
5. **Live backdrop sampling cost.** Android samples at 0.33 (or 0.25 frost) resolution and gates
   everything behind a "reduce dynamic blur" switch (`LiquidGlass.kt:81-90`, `AppSettings.kt:491`).
   `backdrop-filter` is per-surface full-res with no input scale; a fixed tab bar + mini player +
   top fade = three live blurs repainting on every scroll frame — fine on desktop, the known cost on
   low-end phones (`TopFadeBlur.kt:73-77` documents the same problem at 5ms/frame).
   **Substitute/fallbacks, in order:** (a) blur radii kept at the pinned 24px/8px — no inflation;
   (b) `@media (prefers-reduced-transparency: reduce)` drops every `backdrop-filter` and fills
   surfaces opaque — the exact contract of Android's "reduce dynamic blur"
   (`LiquidGlass.kt:221-225`, `FrostedTopBar.kt:209-212`): `background: var(--bc-surface)`,
   hairline kept; (c) a runtime class (`data-reduced-blur`) applied when
   `requestVideoFrameCallback`-style jank or a `navigator.hardwareConcurrency ≤ 4` heuristic fires —
   mirroring the Android performance tier (`glassPerformance`, `LiquidGlass.kt:89-90`: double blur,
   no lens — web: single 24px blur, no gradients).
6. **Progressive blur ramp.** Haze's `HazeProgressive.verticalGradient` eases the *radius* along
   the strip (`TopFadeBlur.kt:104-108`); CSS blur is isotropic. **Substitute:** the masked flat frost
   (§3.2) — same visual contract (hardest at the top edge, invisible below the controls), which is
   also how Android describes the intent (`TopFadeBlur.kt:29-32`).
7. **Sheet window animations and status-bar control.** Android suppresses the window's own
   exit animation and drives the sheet itself (`PlayerSheetMotion.kt:44-49`, `:212-231`); the web
   overlay has no window. **Substitute:** the sheet *is* the window — nothing to suppress; the
   scrim/`pointer-events` behaviours port directly.
8. **Font weight aliasing.** Android remaps asked weights to one-cut-lighter files
   (`Theme.kt:67-73`). CSS `@font-face` registration achieves exactly this (§2.4) — same-to-same,
   listed here only because it requires the two extra font files (medium, semibold) as new assets.
9. **`animateContentSize`-style layout springs.** Compose can spring *layout* (e.g. the actions pill,
   `FrostedTopBar.kt:392-397`). **Substitute:** FLIP — measure, transition width/padding via the
   spring-driven `transform` in the §4.1 utility; or a CSS transition with the curve noted in §3.6
   for the low-frequency cases.
10. **Spotify Canvas / picture-in-cover / DAC HUD / Cast / Wear.** Native media paths — no visual
    port (inventory §13/§17/§32). The web keeps Apple motion artwork (already parity on both
    sides, inventory §5/§13).

---

## 8. Implementation phasing

Each phase ends with the app working and verifiable: no half-rethemed screens ship.

**Phase 1 — tokens, glass, tab bar, shell (M–L, ~1 week).**
`android-tokens.css` (§2) + the `BitChord SF Pro Display` weight remap (§2.4, new font assets);
`@utility` glass/frost/scrim classes (§3.1-3.3); the floating tab bar at phone widths (§3.4) with
pill spring (§4.3); mobile top bar + top fade (§3.2, §3.6); bottom scrim + tap guard (§3.3);
`spring.ts` (§4.0). Old `tokens.css` still feeds untouched pages.
*Verify:* shell on phone + desktop breakpoints — bar geometry, pill travel, frost over scrolling
feeds, dark/light, `prefers-reduced-transparency`, `prefers-reduced-motion`.

**Phase 2 — player, mini player, motion (L, ~1.5-2 weeks).**
`PlayerSheetMotion.ts` + pull/swipe gestures (§4.2, §4.4); mini player pill re-skin on phone +
desktop (§3.5); `ThinSlider` port (§4.6); transport layout (§2.5); mesh 6×6 re-alignment + seam +
900ms fade (§4.8); lyrics presentation (§4.7); artwork docking flight.
*Verify:* open/close/pull/flick against the spring numbers; scrub bar drag thickness; skip beats
line up with the bar pulse; mesh crossfade timing; lyrics scroll easing on a synced TTML track.

**Phase 3 — screens (L, ~1.5 weeks).**
`artworkPalette.ts` + `usePageTint` roles (§5); album/playlist/artist re-skins on the row system
(§6.5-6.9); Library/Home/Explore/New/Search re-skins (§6.2-6.4, §6.8); Settings groups (§6.11);
History page (§6.9); delete `tokens.css` Apple values + `apple-music-dom.md` as the design
reference (keep the file as history).
*Verify:* palette crossfade on first-viewed sleeves in both appearances; every page's gutters,
corners and type against §2; feature parity unchanged (no behaviour regressions outside visuals).

**Phase 4 — micro-components and polish (M, ~1 week).**
`IosSwitch` (§4.10); menu panel + entrances (§3.7, §4.9); held context menu (§4.9);
alert family (§3.9); QR card (§6.10); toasts (§6.23); marquee, playing bars, refresh puck (§4.10);
glass pill lift/squash polish (§4.3); reduced-motion semantics audit (§4.11).
*Verify:* every menu/switch/dialog against §3/§4 tables on touch + pointer + keyboard; the long-press
lift on a grid tile and a list row; haptic-free interaction audit (nothing feels missing without
buzz).

Out of scope, unchanged from the inventory's decisions: downloads, local libraries, bit-perfect/
DAC/Cast/Wear (native-only, `web/docs/android-vs-web-ui.md:253-257`); addon management, Discord,
multi-account (by decision, `:258-260`); Replay and equalizer are feature decisions ranked in
`web/docs/android-vs-web-ui.md` §25 — if taken, they build on this spec's tokens and drawer/menu
shells.
