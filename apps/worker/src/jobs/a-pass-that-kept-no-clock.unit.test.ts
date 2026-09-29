// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASS THAT KEPT NO CLOCK (2026-09-28): the managed runner's half.
 *
 * `runDomainSync` measures where a pass spent its time (`PassMetrics`), and
 * since 2026-09-28 that includes the work done per collection (its own test,
 * `a-pass-that-kept-no-clock-for-its-collections`, in core). This runner
 * dropped all of it: `markCompleted` was called without it, so the status
 * row's `last_pass_metrics` stayed empty on managed, and the run row kept only
 * seconds per data type. So when the owner's Dropbox pass copied nothing for
 * 40 of its 50 minutes, there was nothing on either row to say where they
 * went.
 *
 * Read from the source, as this file's neighbours read the loop, because the
 * runner is a Trigger.dev task that needs the plane to run:
 *
 *  1. every data type's measurements ride into `run.stats`, beside
 *     `domainSeconds`, one set per data type per pass;
 *  2. they are kept for a pass that stopped at its deadline too, which is the
 *     pass they are wanted for;
 *  3. a completed data type's status row keeps them, as the appliance's does.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run-delta-sync.ts'), 'utf8');
const loop = src.slice(src.indexOf('for (const domain of domains) {'));

describe('where a pass spent its time, on managed', () => {
  it('rides into run.stats beside domainSeconds', () => {
    expect(src).toMatch(/finishRun\(runId, outcome, \{[^}]*domainSeconds, domainMetrics[^}]*\}\)/);
  });

  it('is kept before the pass decides whether it finished, so a stopped pass keeps it too', () => {
    const kept = loop.indexOf('if (result.metrics) domainMetrics[domain] = result.metrics;');
    // The decision asks two things since 0055 T3 (e): whether the pass paused,
    // and whether it left a folder unread. Either way it is not finished.
    const decided = loop.indexOf('if (!pause && unread.length === 0) {');
    expect(kept, 'the measurements are no longer kept').toBeGreaterThan(-1);
    expect(decided).toBeGreaterThan(-1);
    expect(kept, 'kept only on the completed branch, so a stopped pass loses them').toBeLessThan(decided);
  });

  it("is stored on a completed data type's status row, as the appliance stores it", () => {
    expect(loop).toContain('markCompleted(tenantId, mappingId, domain, result.metrics)');
  });
});
