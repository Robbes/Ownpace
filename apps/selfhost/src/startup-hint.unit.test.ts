// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The one startup failure we have a hint for.
 *
 * The first PGlite e2e dispatch died with
 * `EACCES: permission denied, mkdir '/data/state/pglite'` — a message that
 * names the syscall and the path and still does not say what to do, because
 * the cause is outside the container: Docker seeds a fresh named volume with
 * the ownership of the image directory it covers, so a volume created by an
 * image that never made `/data/state` comes up owned by root while the
 * appliance runs as uid 10001. The Dockerfile now creates it; this covers the
 * deployments already carrying a volume from an older image.
 *
 * Tested as a pure function on purpose. Reproducing the real failure needs a
 * directory the test process cannot write to, and the test process here is
 * often root — for whom permission bits do not apply, so the "reproduction"
 * would quietly assert nothing.
 */

import { describe, it, expect } from 'vitest';
import { startupHint } from './index.ts';

describe('startupHint', () => {
  it('explains an EACCES on the state volume in terms an operator can act on', () => {
    const hint = startupHint(
      Object.assign(new Error("EACCES: permission denied, mkdir '/data/state/pglite'"), {
        code: 'EACCES',
        path: '/data/state/pglite',
      }),
    );
    expect(hint).toContain('/data/state/pglite');
    // The two things that make it actionable rather than merely descriptive:
    // who we are, and what to do about it.
    expect(hint).toContain('10001');
    expect(hint).toMatch(/down -v|chown/);
  });

  it('says nothing about errors it does not recognise', () => {
    // A hint for every error is a hint for none, and a confident wrong guess
    // next to a real stack trace is worse than silence.
    expect(startupHint(new Error('DATABASE_URL is required'))).toBeUndefined();
    expect(startupHint(Object.assign(new Error('nope'), { code: 'ENOENT', path: '/x' }))).toBeUndefined();
    // EACCES without a path: nothing useful to say, so say nothing.
    expect(startupHint(Object.assign(new Error('nope'), { code: 'EACCES' }))).toBeUndefined();
    expect(startupHint(undefined)).toBeUndefined();
    expect(startupHint(null)).toBeUndefined();
  });
});
