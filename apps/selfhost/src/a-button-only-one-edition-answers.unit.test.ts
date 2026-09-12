// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BUTTON ONLY ONE EDITION ANSWERS (workplan 0117 T2; ADR-0026).
 *
 * The UI is one React app served by both editions, so an endpoint that exists
 * on one and not the other is a screen that works for managed customers and
 * silently does nothing on the appliance. That is the hazard
 * `operating-routes.unit.test.ts` exists to prevent, and it watches the MANAGED
 * side: it lists what `apps/api` answers and fails when that list changes.
 *
 * **Nothing watched this side**, and that is how the confirmation surface stayed
 * managed-only for a month behind a reason that turned out to be wrong. The
 * parity guard could only record the exception; it could not tell whether the
 * appliance had caught up, because it never read the appliance. So this is the
 * other half: the three URLs, asserted where they are actually served.
 *
 * Read as TEXT rather than started as a server, for the reason
 * `a-domain-the-fan-outs-forgot.unit.test.ts` gives about root-level guards:
 * booting the appliance needs a database, a config directory and a scheduler,
 * and the thing under test is whether the handler is THERE.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

/** The confirmation surface, in the appliance's flat spelling. */
const CONFIRMATION_ROUTES = [
  { method: 'POST', url: '/confirm' },
  { method: 'GET', url: '/confirmed-list' },
  { method: 'GET', url: '/confirmed-list/export' },
] as const;

describe('the appliance answers the confirmation surface too', () => {
  it.each(CONFIRMATION_ROUTES)('handles $method $url', ({ method, url }) => {
    expect(
      SOURCE,
      `apps/selfhost does not handle ${method} ${url}. The managed API does ` +
        "(operating-routes.unit.test.ts pins it), and the UI is one React app — so a " +
        'screen offering Confirm or the list would work for managed customers and do ' +
        'nothing here.',
    ).toContain(`req.method === '${method}' && req.url === '${url}'`);
  });

  it('is not passing vacuously — it reads a file with routes in it', () => {
    // Every assertion above is a substring check, and all of them would pass
    // over the wrong file only if it happened to contain these strings. This
    // asserts the file is the appliance's server.
    expect(SOURCE).toContain("req.url === '/verify/report'");
    expect(SOURCE.length).toBeGreaterThan(10_000);
  });
});

/**
 * The group press (2026-09-12). Its URL carries a mapping id, so it is matched
 * with a regex rather than an equality — which is exactly why it needs its own
 * assertion: the substring checks above would not see it, and "the appliance
 * answers the same paths" is only true of the paths somebody listed.
 */
describe('the appliance answers one decision over a group of failures', () => {
  it('handles POST /mappings/:id/failures', () => {
    expect(
      SOURCE,
      'apps/selfhost does not match POST /mappings/:id/failures. The managed API does, and ' +
        'the appliance is the edition whose owner cannot ask somebody to run SQL against ' +
        'the ledger for them.',
    ).toContain(String.raw`/^\/mappings\/([^/]+)\/failures$/`);
  });

  it('keeps it distinguishable from the per-item press', () => {
    // Anchored `$` after `failures`, so a four-segment per-item URL cannot
    // match it — and the per-item pattern still carries its own two segments.
    expect(SOURCE).toContain(String.raw`/^\/mappings\/([^/]+)\/failures\/([^/]+)\/(retry|accept)$/`);
  });

  it('does the BOTH halves of a retry, not just the ledger half', () => {
    // The live bug this feature answers was half-fixed by hand: an UPDATE that
    // zeroed attempt counts and left the cursors, so the source no longer
    // listed the items as changed and the retry copied nothing. Sliced to the
    // group handler alone — the per-item handler below it clears cursors too,
    // and a region-wide substring would be satisfied by the wrong code.
    const groupHandler = SOURCE.slice(
      SOURCE.indexOf('const failureGroupMatch ='),
      SOURCE.indexOf('const failureMatch ='),
    );
    expect(groupHandler).toContain('resolveFailureGroup');
    expect(groupHandler).toContain('cursorStore.clear');
    // And it must narrow: a press naming neither is refused, not widened.
    expect(groupHandler).toContain('a group decision has to say WHICH failures it is for');
  });
});

describe('both editions answer through the SAME read', () => {
  it('reads the list through the shared reader, not its own query', () => {
    // The appliance had its own copy of the five-domain fan-out until
    // 2026-09-11, and `build-reindexers.ts` records what that cost: a domain
    // added to one list and not the other, reported as an account with nothing
    // in it. The confirmed list is the same shape of risk on the document
    // somebody deletes their originals from, so both editions call one reader.
    expect(SOURCE).toContain('readConfirmedList');
    expect(SOURCE).toContain('streamConfirmedListCsv');
    expect(SOURCE).toContain('runConfirmationOver');
  });

  it('never assembles the headline itself', () => {
    // `countsAsVerified` is the one predicate that decides what the headline
    // sentence means. An edition that counted its own would be a second
    // opinion about somebody's data, on the page they act on.
    expect(SOURCE).not.toContain('countsAsVerified');
    expect(SOURCE).not.toContain('confirmedListOf');
  });

  it('answers ByMapping, like every other operating queue', () => {
    // `/failures`, `/moves` and `/deletions` are all `Record<mappingId, …>`
    // here, because the appliance serves every mapping in its config directory
    // from one flat URL. A confirmation surface that answered a bare body
    // would force the screen to hold two code paths — the asymmetry ADR-0026
    // exists to close.
    // Sliced to the LIST handler alone, not to the whole confirmation block.
    // The first version of this assertion spanned from `/confirm` to the
    // export, and the POST handler in between has its own
    // `for (const m of mappings)` — so a mutation that made the LIST answer for
    // one mapping went unnoticed, because the substring was still there from a
    // different handler. A guard that matches anywhere in a region is a guard
    // that can be satisfied by the wrong code.
    const listHandler = SOURCE.slice(
      SOURCE.indexOf("req.url === '/confirmed-list'"),
      SOURCE.indexOf("req.url === '/confirmed-list/export'"),
    );
    expect(listHandler).toContain('for (const m of mappings)');
    expect(listHandler).toContain('out[m.config.mappingId]');

    // And the same for the button, in its own slice.
    const startHandler = SOURCE.slice(
      SOURCE.indexOf("req.url === '/confirm'"),
      SOURCE.indexOf("req.url === '/confirmed-list'"),
    );
    expect(startHandler).toContain('for (const m of mappings)');
    expect(startHandler).toContain('out[m.config.mappingId]');
  });
});
