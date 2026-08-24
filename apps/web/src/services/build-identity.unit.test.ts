// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The interesting decision here is not "what version is this" — it is WHEN TO
 * SAY TWO THINGS INSTEAD OF ONE.
 *
 * A bundle can only report what it was built from. On this stack the UI and
 * the API are separate containers with no mechanism making them move together,
 * so `docker compose up -d api` without `web` leaves a stale bundle in front of
 * a newer server. One number captioned "the version that is running" would be
 * a status that does not belong to the thing that happened (hard rule 10), and
 * a mismatch is the only way a stale bundle ever announces itself.
 *
 * `describeBuild` is separated from React precisely so that judgement can be
 * tested without rendering anything.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeBuild, shortCommit, fetchServerBuild } from './build-identity.ts';

const build = (version: string, commit = '') => ({ version, commit });

describe('describeBuild', () => {
  it('says it once when the two agree', () => {
    // The ordinary case, and it must stay quiet: saying it twice every time
    // trains the reader to stop looking, which is exactly when a mismatch
    // would slip past.
    const same = build('0.1.0-rc.1', 'a1b2c3d4e5');
    expect(describeBuild(same, same)).toBe('v0.1.0-rc.1 · a1b2c3d');
  });

  it('names both sides when the versions differ', () => {
    expect(describeBuild(build('0.1.0'), build('0.2.0'))).toBe('UI v0.1.0 · API v0.2.0');
  });

  it('names both sides when only the COMMIT differs', () => {
    // The likelier stale-bundle shape by far: same release, different build.
    // A version-only comparison would call these identical and hide it.
    expect(
      describeBuild(build('0.1.0', 'aaaaaaa1'), build('0.1.0', 'bbbbbbb2')),
    ).toBe('UI v0.1.0 · aaaaaaa · API v0.1.0 · bbbbbbb');
  });

  it('falls back to the UI alone when the server cannot be reached', () => {
    // null is a complete answer, not an error to surface: a version stamp that
    // could take the page down with it would be a poor trade.
    expect(describeBuild(build('0.1.0', 'a1b2c3d'), null)).toBe('v0.1.0 · a1b2c3d');
  });

  it('shows the server alone when the bundle was never stamped', () => {
    // A dev build, or an image built without GIT_SHA. The server still knows.
    expect(describeBuild(build('', ''), build('0.1.0'))).toBe('v0.1.0');
  });

  it('renders NOTHING when neither side knows', () => {
    // Not `v0.0.0`, not "unknown". A stamp that invents a number is a wrong
    // answer wearing the clothes of a right one; an empty one prompts the
    // question instead of answering it badly.
    expect(describeBuild(build('', ''), null)).toBe('');
    expect(describeBuild(build('', ''), build('', ''))).toBe('');
  });
});

describe('shortCommit', () => {
  it('shortens a real sha to seven', () => {
    expect(shortCommit('a1b2c3d4e5f6a7b8')).toBe('a1b2c3d');
  });

  it('treats the server-side "unknown" placeholder as no answer', () => {
    // buildIdentity() in @openmig/core answers `unknown` when OPENMIG_COMMIT
    // was never set. Rendering that word next to a version reads as a value.
    expect(shortCommit('unknown')).toBe('');
    expect(shortCommit('')).toBe('');
  });
});

describe('fetchServerBuild', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the base it was given, at /version', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.1.0', commit: 'abc1234' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    return fetchServerBuild('/api').then((got) => {
      expect(fetchMock.mock.calls[0]![0]).toBe('/api/version');
      expect(got).toEqual({ version: '0.1.0', commit: 'abc1234' });
    });
  });

  it('answers null rather than throwing when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchServerBuild('')).resolves.toBeNull();
  });

  it('answers null on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchServerBuild('')).resolves.toBeNull();
  });

  it('answers null on a body that is not the shape we asked for', async () => {
    // An HTML error page that happens to parse, a proxy's JSON, a future
    // version that renamed the field: none of those are a version, and
    // rendering whatever came back would put a stranger's string on screen.
    for (const body of [null, 'a string', { commit: 'abc' }, { version: 42 }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
      await expect(fetchServerBuild('')).resolves.toBeNull();
    }
  });

  it('accepts a version with no commit, which is what an unstamped server sends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.1.0' }) }));
    await expect(fetchServerBuild('')).resolves.toEqual({ version: '0.1.0', commit: '' });
  });
});
