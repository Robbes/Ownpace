// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every pass-running job flushes `firstCopyBytes` to the meter (0109 T3).
 *
 * SOURCE-LEVEL on purpose, the `mapping-updated-at` lesson: the bug this
 * guards against is an OMISSION, and an omission has no behaviour to assert
 * against — a job that forgets the flush returns exactly what a job that
 * remembers returns, and the trigger.dev harness gives these jobs no cheap
 * route-style press. The engine side of the statistic is behaviour-tested in
 * `reconcile.unit.test.ts` (byte-exact), the store side in
 * `bytes-moved-under-rls.unit.test.ts`; what is left to go wrong is the six
 * lines between them being deleted, which is what this file turns red.
 *
 * A NEW job that runs passes will not be caught here — the list below names
 * the jobs that do, and adding one means deciding about its meter flush,
 * which is exactly the decision this file exists to force.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The jobs that run sync passes today, and must therefore flush the meter. */
const PASS_RUNNING_JOBS = ['run-delta-sync.ts', 'run-full-sync.ts'];

describe('the meter flush is wired in every pass-running job', () => {
  for (const job of PASS_RUNNING_JOBS) {
    it(`${job} adds the pass's firstCopyBytes to PgBytesMovedStore`, () => {
      const source = readFileSync(join(here, job), 'utf8');
      expect(source).toMatch(/new PgBytesMovedStore\(db\)\.add\(tenantId, firstCopyBytes\)/);
      // The >0 gate: most delta passes copy nothing new, and a zero add must
      // not create a row (absence means nothing has ever moved).
      expect(source).toMatch(/firstCopyBytes > 0/);
    });
  }
});
