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
import router from './operating-routes.ts';

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
        'GET /:mappingId/apply-deletions',
        // The completion report (workplan 0047) — served by both editions
        // from the same shared builder.
        'GET /:mappingId/completion-report',
        'GET /:mappingId/deletions',
        'GET /:mappingId/deletions/:hash/receipt',
        'GET /:mappingId/failures',
        'GET /:mappingId/moves',
        'GET /:mappingId/verify/report',
        'PATCH /:mappingId/apply-deletions',
        'POST /:mappingId/deletions/:hash/apply',
        'POST /:mappingId/deletions/:hash/keep',
        'POST /:mappingId/failures/:hash/:action',
        'GET /:mappingId/moves/:hash/receipt',
        'POST /:mappingId/finish',
        'POST /:mappingId/moves/:hash/apply',
        'POST /:mappingId/moves/:hash/keep',
        // The sharing checklist (ADR-0032, workplan 0052) — same three
        // verbs on both editions: read the queue, rescan the inventory,
        // settle one row (apply / done-by-hand / skip).
        'GET /:mappingId/sharing',
        'POST /:mappingId/sharing/:grantId/decision',
        'POST /:mappingId/sharing/rescan',
        'POST /:mappingId/verify/start',
      ].sort(),
    );
  });

  it('exposes apply ONLY as evaluate-then-queue — the removal itself never runs here', () => {
    // The one destructive operation (workplan 0017 T4). The POST answers the
    // ledger-side gates synchronously and QUEUES a permitted removal; the
    // target call lives in the worker behind Trigger.dev (ADR-0004), and the
    // receipt is what a poller reads. No route in this edition performs a
    // removal on the request thread.
    const got = routes().filter((r) => r.path.includes('apply') || r.path.includes('receipt'))
      .map((r) => `${r.method} ${r.path}`);
    expect(got.sort()).toEqual([
      // The flag pair (0019 T3) reads/flips gate 1 — it never removes anything.
      'GET /:mappingId/apply-deletions',
      'GET /:mappingId/deletions/:hash/receipt',
      // The relocation pair (ADR-0030, migration 0010): the same
      // evaluate-then-queue shape, on the relocation's OWN receipt.
      'GET /:mappingId/moves/:hash/receipt',
      'PATCH /:mappingId/apply-deletions',
      'POST /:mappingId/deletions/:hash/apply',
      'POST /:mappingId/moves/:hash/apply',
    ]);
  });

  it('exposes verify ONLY as start + poll — no synchronous scan endpoint', () => {
    // The appliance's GET /verify holds a request open for the whole scan;
    // here that would put connector credentials and minutes of target I/O on
    // an API thread. The pair is the contract (workplan 0017 T0): POST begins
    // work in the worker, GET reads a row.
    const got = routes().filter((r) => r.path.includes('verify')).map((r) => `${r.method} ${r.path}`);
    expect(got.sort()).toEqual(['GET /:mappingId/verify/report', 'POST /:mappingId/verify/start']);
  });

  it('takes the failure action as a plain parameter, not a regex', () => {
    // The specific shape of the Express 5 bug. `:action(retry|accept)` reads as
    // stricter and is simply invalid; validation moved into the handler.
    const failure = routes().find((r) => r.path.includes('/failures/:hash/'));
    expect(failure?.path).toBe('/:mappingId/failures/:hash/:action');
    expect(failure?.path).not.toContain('(');
  });
});
