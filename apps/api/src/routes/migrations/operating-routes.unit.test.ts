// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The managed edition's operating routes (ADR-0026).
 *
 * The first test here exists because of a real bug this file shipped with for
 * about ten minutes: `'/:mappingId/failures/:hash/:action(retry|accept)'`.
 * **Express 5 removed regex path parameters**, so that path throws at route
 * REGISTRATION — the API would not start at all — and neither `tsc` nor eslint
 * says a word about it, because it is a valid string in a valid function call.
 * Importing the router is the cheapest thing that reproduces API startup, so it
 * is worth doing in a unit test rather than finding out from a container that
 * exits.
 *
 * The rest assert the CONTRACT: that this edition answers the same paths the
 * appliance does, because the UI is one bundle served by both (ADR-0026) and a
 * path that differs by an edition is a screen that silently does nothing for
 * half the customers.
 */

import { describe, it, expect } from 'vitest';
import router from './operating-routes';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

function routes(): Array<{ method: string; path: string }> {
  const stack = (router as unknown as { stack: Layer[] }).stack;
  return stack
    .filter((l): l is Required<Layer> => Boolean(l.route))
    .flatMap((l) =>
      Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path })),
    );
}

describe('route registration', () => {
  it('registers without throwing — i.e. the API can start', () => {
    // If this file used a path syntax Express rejects, the import above would
    // already have thrown and this test would never run. Asserting a non-empty
    // set makes the intent explicit rather than relying on that side effect.
    expect(routes().length).toBeGreaterThan(0);
  });

  it('answers the same paths the appliance does', () => {
    // One React bundle serves both editions. These paths ARE the contract's
    // surface; the shapes they return are checked by the type system against
    // @openmig/shared, but nothing except this test checks that the URLs match.
    const got = routes().map((r) => `${r.method} ${r.path}`).sort();
    expect(got).toEqual(
      [
        'GET /:mappingId/deletions',
        'GET /:mappingId/failures',
        'GET /:mappingId/moves',
        'POST /:mappingId/deletions/:hash/keep',
        'POST /:mappingId/failures/:hash/:action',
        'POST /:mappingId/finish',
        'POST /:mappingId/moves/:hash/keep',
      ].sort(),
    );
  });

  it('does NOT expose apply or verify, which belong to the worker in this edition', () => {
    // Deliberate, not missing. Both touch the target — one removes a message,
    // the other counts and samples every domain — and target I/O in the managed
    // edition belongs behind Trigger.dev (ADR-0004), not on a request thread
    // holding connector credentials. A synchronous version bolted in here would
    // make the two editions differ in exactly the operation that destroys data.
    const paths = routes().map((r) => r.path);
    expect(paths.some((p) => p.includes('apply'))).toBe(false);
    expect(paths.some((p) => p.includes('verify'))).toBe(false);
  });

  it('takes the failure action as a plain parameter, not a regex', () => {
    // The specific shape of the Express 5 bug. `:action(retry|accept)` reads as
    // stricter and is simply invalid; validation moved into the handler.
    const failure = routes().find((r) => r.path.includes('/failures/:hash/'));
    expect(failure?.path).toBe('/:mappingId/failures/:hash/:action');
    expect(failure?.path).not.toContain('(');
  });
});
