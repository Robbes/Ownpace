// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * BOTH EDITIONS RECORD THE SIDE THE PASS TAGGED (workplan 0094 T5, second
 * slice).
 *
 * The seam that tags a failure with its side is one function in `core`
 * (`withSides`, over the shared domain pass), and the column it lands in is
 * one column. Between them sit two catch sites — `runOneDomain` here and the
 * managed worker's `run-delta-sync` — and each has to hand the tag on to
 * `markFailed`, or the column stays NULL and the page keeps saying "one of
 * the two" for a failure the pass could name.
 *
 * Pinned by reading the source, the way this repo pins database-bound call
 * sites: the two catches are the whole of what matters, and hard rule 5 is
 * that an edition split here is invisible until somebody is on the phone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const orchestration = readFileSync(join(HERE, 'orchestration.ts'), 'utf8');
const worker = readFileSync(
  join(HERE, '../../../apps/worker/src/jobs/run-delta-sync.ts'),
  'utf8',
);

const MARK_FAILED_WITH_SIDE = /markFailed\([\s\S]{0,200}?failureSideOf\((err|error)\)/;

describe('the side a pass tagged reaches markFailed', () => {
  it('in the appliance and CLI path (orchestration.runOneDomain)', () => {
    expect(orchestration).toMatch(MARK_FAILED_WITH_SIDE);
    expect(orchestration).not.toMatch(/markFailed\(tenantId, mappingId, domain, error\.message\)/);
  });

  it('in the managed worker (run-delta-sync)', () => {
    expect(worker).toMatch(MARK_FAILED_WITH_SIDE);
    expect(worker).not.toMatch(/markFailed\(tenantId, mappingId, domain, errorMessage\)/);
  });
});
