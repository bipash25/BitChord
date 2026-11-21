import { describe, expect, it } from 'vitest';
import { CHROMIUM_USER_AGENT, isAddonUrl, isLyricOrigin, LYRIC_ORIGINS, sanitiseHeaders, ytImpersonationFor } from './hosts.js';

/** Every allowlist and impersonation decision of web/docs/relay.md's table. */

const url = (value: string) => new URL(value);

describe('ytImpersonationFor', () => {
  it('dresses music.youtube.com InnerTube as the music client', () => {
    expect(ytImpersonationFor(url('https://music.youtube.com/youtubei/v1/player?alt=json'))).toEqual({
      origin: 'https://music.youtube.com',
      referer: 'https://music.youtube.com/',
      'x-origin': 'https://music.youtube.com',
    });
  });

  it('dresses www.youtube.com InnerTube as the web client', () => {
    expect(ytImpersonationFor(url('https://www.youtube.com/youtubei/v1/player?alt=json'))).toEqual({
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
      'x-origin': 'https://www.youtube.com',
    });
  });

  it('leaves the session bootstrap endpoints plain', () => {
    for (const value of [
      'https://www.youtube.com/sw.js_data',
      'https://www.youtube.com/iframe_api',
      'https://www.youtube.com/s/player/abc12345/player_es6.vflset/en_US/base.js',
    ]) {
      expect(ytImpersonationFor(url(value)), value).toEqual({});
    }
  });

  it('dresses BotGuard with Origin and Referer only, as the extension fetch rule does', () => {
    expect(ytImpersonationFor(url('https://www.youtube.com/api/jnn/GenerateIT'))).toEqual({
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
    });
  });

  it('refuses everything the table does not name', () => {
    for (const value of [
      'https://googlevideo.com/videoplayback', // audio bytes never pass through the relay
      'https://www.googlevideo.com/videoplayback?c=VISIONOS',
      'https://youtube.com/youtubei/v1/player',
      'http://www.youtube.com/youtubei/v1/player', // https only
      'https://www.youtube.com/watch', // a page, not an API
      'https://music.youtube.com/sw.js_data', // music serves InnerTube only
      'https://s.youtube.com/api/stats/watchtime', // play reporting is the extension's signed work
      'https://accounts.google.com/',
    ]) {
      expect(ytImpersonationFor(url(value)), value).toBeNull();
    }
  });
});

describe('LYRIC_ORIGINS', () => {
  it('is all https origins', () => {
    for (const origin of LYRIC_ORIGINS) {
      expect(origin, origin).toMatch(/^https:\/\/[a-z0-9.-]+(?::\d+)?$/);
    }
  });

  it('matches whole origins only, not subdomains or paths', () => {
    expect(isLyricOrigin(url('https://lrclib.net/api/get'))).toBe(true);
    expect(isLyricOrigin(url('https://sub.lrclib.net/api/get'))).toBe(false);
    expect(isLyricOrigin(url('http://lrclib.net/api/get'))).toBe(false);
    expect(isLyricOrigin(url('https://evil.example/lrclib.net'))).toBe(false);
  });
});

describe('isAddonUrl', () => {
  it('allows any https URL and nothing else', () => {
    expect(isAddonUrl(url('https://example.com/manifest.json'))).toBe(true);
    expect(isAddonUrl(url('https://192.168.0.1/manifest.json'))).toBe(true); // the fence is the origin list, not the network
    expect(isAddonUrl(url('http://example.com/manifest.json'))).toBe(false);
    expect(isAddonUrl(url('ftp://example.com/manifest.json'))).toBe(false);
  });
});

describe('sanitiseHeaders', () => {
  it('drops identity and fetch-managed headers', () => {
    expect(
      sanitiseHeaders({
        accept: '*/*',
        cookie: 'SAPISID=x',
        authorization: 'Bearer x',
        'x-goog-authuser': '0',
        'x-goog-pageid': 'p',
        'x-goog-visitor-id': 'v',
        'user-agent': 'bot/1.0',
        host: 'example.com',
        'content-length': '999',
      }),
    ).toEqual({ accept: '*/*' });
  });

  it('lowercases what it keeps', () => {
    expect(sanitiseHeaders({ 'X-Youtube-Client-Name': '1' })).toEqual({ 'x-youtube-client-name': '1' });
  });

  it('drops what a browser fetch would refuse rather than throwing', () => {
    expect(sanitiseHeaders({ 'bad name': 'x' })).toEqual({});
    expect(sanitiseHeaders({ 'x-split': 'a\r\nb' })).toEqual({});
    // A JSON body can carry an own __proto__ key; assigning that name would set the prototype instead of a header.
    expect(sanitiseHeaders(JSON.parse('{"__proto__":"x","ok":"y"}'))).toEqual({ ok: 'y' });
  });
});

describe('CHROMIUM_USER_AGENT', () => {
  it('is a realistic recent Chromium, the relay being a browser to YouTube', () => {
    expect(CHROMIUM_USER_AGENT).toMatch(/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.\d+\.\d+\.\d+ Safari\/537\.36$/);
    // Not the string YouTube's heuristics were written to catch.
    expect(CHROMIUM_USER_AGENT).not.toContain('node');
  });
});
