import { ChevronRight, Users } from 'lucide-react';
import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { SiApplemusic, SiSpotify, SiYoutubemusic } from 'react-icons/si';
import { PageHeader } from '@/components/PageHeader';
import { PrefetchLink } from '@/components/PrefetchLink';
import { useExtension } from '@/extension/useExtension';
import { useYtAuth } from '@/extension/useYtAuth';
import { getUserJar } from '@/extension/userJar';
import { useParty } from '@/party/useParty';
import { useHistorySettings } from '@/playback/historyReporting';
import { Select } from '@/components/Select';
import { AUTOMIX_BARS } from '@/playback/automix/choices';
import { CROSSFADE_CHOICES, usePlayer } from '@/state/player';
import { AppleMusicIntegration, AppleMusicToggles, LyricSourcesAccess, SpotifyIntegration, Toggle } from './IntegrationSettings';
import { settingsUi } from './settingsStyles';

const LyricsSettings = lazy(() => import('@/shell/LyricsSettings').then((m) => ({ default: m.LyricsSettings })));

/** An integration's coloured glyph, as on the Extension page. */
function Glyph({ Icon, color, ink }: { Icon: ComponentType<{ size?: number }>; color: string; ink?: string }) {
  return (
    <span className={settingsUi.integrationIcon} style={{ backgroundColor: color, ...(ink && { color: ink }) }}>
      <Icon size={15} />
    </span>
  );
}

/** A row that opens a page of its own. */
function LinkRow({ to, icon, title, value }: { to: string; icon?: ReactNode; title: string; value?: string | null }) {
  return (
    <PrefetchLink to={to} className={`${icon ? settingsUi.integration : settingsUi.integrationPlain} ${settingsUi.linkRow}`}>
      {icon}
      <span className={settingsUi.integrationName}>{title}</span>
      <span className={settingsUi.value}>
        {value}
        <ChevronRight size={16} />
      </span>
    </PrefetchLink>
  );
}

function youtubeText(auth: ReturnType<typeof useYtAuth>): string {
  if (auth.state === 'checking') return 'Checking…';
  // No way to sign at all: no session behind the app and no jar of the
  // visitor's own — anonymous-only.
  if (auth.state === 'unavailable') return 'Not signed in';
  const { browserSignedIn, connected, signedIn, active } = auth.auth;
  // The account row answers for whichever session is live (web/docs/
  // private-deployment.md, 2026-11-22): the visitor's own, when they've
  // connected their YouTube session — then their name stands here, as it
  // should — or the anonymous session every visitor gets, whose identity is
  // deliberately empty (the invisibility ruling) so this row carries the
  // sign-in prompt where a name would have been. The browser holds no
  // session of its own in any relay shape, so browserSignedIn paths are dead
  // here but kept honest for any future transport that does hold one.
  if (signedIn && !browserSignedIn) return active?.name || 'Sign in with YouTube';
  if (!browserSignedIn) return 'Not signed in';
  if (!connected) return 'Disconnected';
  return active ? active.name : 'Signed in';
}

/**
 * Settings (SettingsSheet on the phone): the account and its integrations,
 * Listen Together, playback and lyrics, in the same grouped rows.
 */
export default function SettingsPage() {
  const extension = useExtension();
  const yt = useYtAuth();
  const party = useParty();
  const autoplay = usePlayer((s) => s.autoplay);
  const crossfadeSec = usePlayer((s) => s.crossfadeSec);
  const automix = usePlayer((s) => s.automix);
  const automixBars = usePlayer((s) => s.automixBars);
  const showNerdStats = usePlayer((s) => s.showNerdStats);
  const shareHistory = useHistorySettings((s) => s.share);
  const setShareHistory = useHistorySettings((s) => s.setShare);
  const { setAutoplay, setCrossfade, setAutomix, setAutomixBars, setShowNerdStats } = usePlayer.getState();
  const [lyrics, setLyrics] = useState(false);
  const present = extension.state === 'present';
  // The relay is the only transport, so this is just "did it answer". AutoMix's
  // Web Audio graph would be silent over it, so the setting says so (relay.md §5).
  const relay = present && extension.extension.info.browser === 'server';
  // Whether plays can be reported to a real account's YouTube Music history:
  // the transport must be able to sign the stats pings — its own session (the
  // relay reports `yt.stats` when it holds one) or the visitor's connected
  // jar, whose history the plays then land in.
  const historyReporting =
    present && (extension.extension.info.capabilities.includes('yt.stats') || getUserJar() !== null);

  return (
    <div className={settingsUi.centered}>
      <PageHeader title="Settings" />
      <div className={settingsUi.body}>
        <h2 className={settingsUi.sectionHeader}>Account & Integrations</h2>
        <section className={settingsUi.group}>
          <div className={settingsUi.integration}>
            <Glyph Icon={SiYoutubemusic} color="#ffffff" ink="#ff0033" />
            <span className={settingsUi.integrationName}>YouTube Music</span>
            <span className={settingsUi.value}>{youtubeText(yt)}</span>
          </div>
          <div className={settingsUi.integration}>
            <Glyph Icon={SiSpotify} color="#1ed760" />
            <span className={settingsUi.integrationName}>Spotify</span>
            {/* Signed in or not is between this browser and Spotify alone (PKCE);
              the row says which, with no relay involvement either way. */}
            <SpotifyIntegration />
          </div>
        </section>
        {historyReporting && (
          <section className={`${settingsUi.group} mt-3 empty:hidden`}>
            <Toggle
              label="Share Listening Activity to YouTube"
              detail="Songs you play here go to the YouTube Music history of the account playing them, and shape its recommendations."
              checked={shareHistory}
              onChange={setShareHistory}
            />
          </section>
        )}

        <h2 className={settingsUi.sectionHeader}>Apple Music</h2>
        <section className={settingsUi.group}>
          <div className={settingsUi.integration}>
            <Glyph Icon={SiApplemusic} color="#fa2d48" />
            <span className={settingsUi.integrationName}>Relay Access</span>
            {present ? <AppleMusicIntegration /> : <span className={settingsUi.value}>Relay unreachable</span>}
          </div>
          <AppleMusicToggles />
        </section>
        <p className={settingsUi.footer}>From Apple Music’s public pages. No Apple Music account or sign-in needed.</p>

        <h2 className={settingsUi.sectionHeader}>Listen Together</h2>
        <section className={settingsUi.group}>
          <LinkRow
            to="/settings/listen-together"
            icon={<Glyph Icon={Users} color="#fa2d48" />}
            title="Listen Together"
            value={party.code ? `In party ${party.code}` : 'Listen in sync with friends'}
          />
        </section>

        <h2 className={settingsUi.sectionHeader}>Playback</h2>
        <section className={settingsUi.group}>
          <Toggle
            label="AutoPlay"
            detail="When the queue ends, keep playing similar music."
            checked={autoplay}
            onChange={setAutoplay}
          />
          <label className={settingsUi.controlRow}>
            <span className={settingsUi.rowText}>
              <span>Crossfade</span>
              {relay && (
                <span className={settingsUi.rowDetail}>
                  AutoMix can’t run over the server relay; only the timed volume crossfade plays.
                </span>
              )}
            </span>
            <Select<number | 'automix'>
              label="Crossfade"
              value={automix ? 'automix' : crossfadeSec}
              options={[
                ...CROSSFADE_CHOICES.map((seconds) => ({ value: seconds, label: seconds === 0 ? 'Off' : `${seconds} seconds` })),
                { value: 'automix', label: 'Automix' },
              ]}
              onChange={(value) => (value === 'automix' ? setAutomix(true) : setCrossfade(value))}
            />
          </label>
          {automix && (
            <label className={settingsUi.controlRow}>
              <span>Blend Length</span>
              <Select
                label="Blend Length"
                value={automixBars}
                options={AUTOMIX_BARS.map((bars) => ({ value: bars, label: `Up to ${bars} bars` }))}
                onChange={setAutomixBars}
              />
            </label>
          )}
          <Toggle
            label="Show Stats for Nerds"
            detail="Codec, bitrate and sample rate under the artist in the full-screen player, and what Automix is doing."
            checked={showNerdStats}
            onChange={setShowNerdStats}
          />
        </section>
        {automix && (
          <p className={settingsUi.footer}>
            Automix finds each song’s tempo, key and phrases, then blends on the beat: the next song is time-stretched to match, and
            the bass swaps over halfway. Where it can, it loops a few instrumental bars of each song and ramps the tempo between
            them. Songs it can’t read in time play to the end and crossfade. Based on AutoMix by David Finnegan (AGPL-3.0).
          </p>
        )}

        <h2 className={settingsUi.sectionHeader}>Lyrics</h2>
        <section className={settingsUi.group}>
          <button className={`${settingsUi.integrationPlain} ${settingsUi.linkRow}`} onClick={() => setLyrics(true)}>
            <span className={settingsUi.integrationName}>Lyric Sources</span>
            <span className={settingsUi.value}>
              Order, sources, syllable timing
              <ChevronRight size={16} />
            </span>
          </button>
          <div className={settingsUi.integrationPlain}>
            <span className={settingsUi.integrationName}>Lyric Sources Access</span>
            {present ? <LyricSourcesAccess /> : <span className={settingsUi.value}>Relay unreachable</span>}
          </div>
        </section>
      </div>
      {lyrics && (
        <Suspense fallback={null}>
          <LyricsSettings onClose={() => setLyrics(false)} />
        </Suspense>
      )}
    </div>
  );
}
