// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Which build the site serves now (workplan 0145; the owner's "build the
 * deploy check and the reload prompt", 2026-09-29): read from the file the
 * web build writes beside the page, never from a cache, and compared only on
 * the parts both sides know, so an unstamped build prompts nobody.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { askServedBuild, fetchServedBuild, onAskServedBuild, servesAnotherBuild } from './served-build.ts';

const PAGE = { version: '0.3.1', commit: 'aaaaaaa1111111' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whether the site serves another build than the page on screen', () => {
  it('does not, while it serves this one', () => {
    expect(servesAnotherBuild(PAGE, { ...PAGE })).toBe(false);
  });

  it('does, after a deploy moved the commit', () => {
    expect(servesAnotherBuild(PAGE, { ...PAGE, commit: 'bbbbbbb2222222' })).toBe(true);
  });

  it('does, after a release moved the version', () => {
    expect(servesAnotherBuild(PAGE, { ...PAGE, version: '0.3.2' })).toBe(true);
  });

  it('does not on a part either side does not know', () => {
    expect(servesAnotherBuild({ version: '', commit: '' }, { version: '0.3.2', commit: 'bbbbbbb' })).toBe(false);
    expect(servesAnotherBuild(PAGE, { version: '0.3.1', commit: '' })).toBe(false);
    expect(servesAnotherBuild(PAGE, { version: '0.3.1', commit: 'unknown' })).toBe(false);
  });

  it('does not when the site could not say', () => {
    expect(servesAnotherBuild(PAGE, null)).toBe(false);
  });
});

describe('the build the site serves', () => {
  it('is read from version.json beside the page, never from a cache', async () => {
    const asked = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ version: '0.3.2', commit: 'bbbbbbb' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', asked);

    expect(await fetchServedBuild()).toEqual({ version: '0.3.2', commit: 'bbbbbbb' });
    expect(asked).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('is unknown for a build from before the file, the page in its place, or no answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await fetchServedBuild()).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })));
    expect(await fetchServedBuild()).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 3 }), { status: 200 })));
    expect(await fetchServedBuild()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await fetchServedBuild()).toBeNull();
  });
});

describe('a reason to ask now', () => {
  it('reaches whoever listens, until they stop', () => {
    const ask = vi.fn();
    const stop = onAskServedBuild(ask);
    askServedBuild();
    stop();
    askServedBuild();

    expect(ask).toHaveBeenCalledTimes(1);
  });
});
