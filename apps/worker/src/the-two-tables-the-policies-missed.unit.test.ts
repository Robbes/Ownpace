// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two tables the policies missed — the callers' half.
 *
 * `cutover_state` and `cutover_event` are row-secured since migration 0055,
 * FORCEd like every tenant table: a session that is not a superuser sees them
 * only inside a tenant context. The cutover job, the rollback job and the
 * operator CLI used to hand a bare `drizzle(pool)` to `CutoverStore`, which
 * read fine only because the bundled deployments connect as a superuser; on
 * hard rule 5's shape — an operator's own Postgres with an ordinary owner —
 * that store would now read nothing and write nothing, and the CLI is the
 * self-host door. So the three go through `tenantCutoverStore`, every call
 * inside `withTenant`.
 *
 * A source guard, because no test drives these entry points against a
 * non-superuser: the integration suites inject a store, and the task wrapper
 * needs a Trigger.dev runtime. The property is "which store is constructed",
 * and the source says it plainly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENTRY_POINTS = {
  'jobs/run-cutover.ts': 'the cutover preparation job',
  'jobs/run-rollback.ts': 'the rollback job',
  'cli/index.ts': 'the operator CLI',
} as const;

describe('every reader of the cutover ledger runs inside a tenant context', () => {
  for (const [file, what] of Object.entries(ENTRY_POINTS)) {
    const source = readFileSync(join(import.meta.dirname, file), 'utf-8');

    it(`${what} (${file}) constructs tenantCutoverStore, never a bare CutoverStore`, () => {
      expect(source).toContain('tenantCutoverStore(pool,');
      expect(source).not.toContain('new CutoverStore(');
    });
  }
});
