// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
// am-lyrics is a Lit bundle; the sheet under test is plain CSS, so the element
// itself is not needed here.
vi.mock('@uimaxbai/am-lyrics/am-lyrics.js', () => ({}));
import { ANDROID_LYRICS_STYLE } from './LyricsPanel';

/** The `@media (prefers-reduced-motion: reduce)` block's body, if present. */
function reducedMotionBlock(css: string): string {
  return css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
}

describe('ANDROID_LYRICS_STYLE line-activation glow ramp (PlayerLyrics.kt:2274-2281)', () => {
  it('tweens the glow alpha over 420ms FastOutSlowIn when a line turns active', () => {
    expect(ANDROID_LYRICS_STYLE).toContain('--bc-lyric-glow: 1');
    expect(ANDROID_LYRICS_STYLE).toContain('--bc-lyric-glow 420ms cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('rides the ramp through the carried-word glow, keeping the 6px white@62% bloom', () => {
    expect(ANDROID_LYRICS_STYLE).toContain(
      'text-shadow: 0 0 6px rgba(255, 255, 255, calc(0.62 * var(--bc-lyric-glow, 0)))',
    );
  });

  it('keeps the 400ms line falloff timings the ramp was added to', () => {
    const activeRule = ANDROID_LYRICS_STYLE.match(
      /:host\(\[data-full\]\) \.lyrics-line\.active \{([^}]*)\}/,
    )?.[1];
    expect(activeRule).toContain('opacity 400ms cubic-bezier(0.41, 0, 0.12, 0.99)');
    expect(activeRule).toContain('filter 400ms cubic-bezier(0.41, 0, 0.12, 0.99)');
  });

  it('cuts the ramp under reduced motion so the glow still arrives with the line', () => {
    expect(reducedMotionBlock(ANDROID_LYRICS_STYLE)).not.toContain('--bc-lyric-glow');
  });

  it('leaves the exit alone: only the active state carries the glow timing', () => {
    // The pre-active rule must not grow a glow ramp of its own, or a line
    // arriving from pre-active would already be at full glow.
    const preActiveRule = ANDROID_LYRICS_STYLE.match(
      /:host\(\[data-full\]\) \.lyrics-line\.pre-active \{([^}]*)\}/,
    )?.[1];
    expect(preActiveRule).toBeDefined();
    expect(preActiveRule).not.toContain('transition');
  });
});
