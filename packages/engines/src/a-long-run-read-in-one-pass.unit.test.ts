// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A long run of slashes, read in one pass where the writers read an href a
 * server sent back. A pattern ending `\/+$` reads it in time quadratic in the
 * run, about a second at this size; it must take well under a quarter of one,
 * and answer as before.
 */

import { describe, it, expect } from 'vitest';
import { hrefRelativeTo } from './dav-multistatus.ts';

const ms = (f: () => unknown): number => {
  const start = performance.now();
  f();
  return performance.now() - start;
};

describe('a long run, read in one pass', () => {
  it('an href with a long run of slashes inside it', () => {
    const href = `/remote.php/dav/files/pat/x${'/'.repeat(50_000)}a`;
    expect(ms(() => hrefRelativeTo(href, 'https://cloud.example.test/remote.php/dav/files/pat/'))).toBeLessThan(250);
    expect(hrefRelativeTo('/remote.php/dav/files/pat/a/b/', 'https://cloud.example.test/remote.php/dav/files/pat/')).toBe('a/b');
  });
});
