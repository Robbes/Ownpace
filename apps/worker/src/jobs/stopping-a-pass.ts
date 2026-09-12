// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TWO RULES ABOUT STOPPING A PASS (live findings 2026-09-11).
 *
 * Both were learnt the same afternoon, on one migration: a pass that would not
 * stop when it should, and a pass that stopped and would not stay stopped.
 *
 * They live HERE, and not in `run-delta-sync.ts` where they are used, for a
 * reason the guard `an-integration-test-is-handed-its-database.unit.test.ts`
 * makes concrete: that module builds a `Pool` from `DATABASE_URL` at import
 * and throws without one. A test that has been handed a database — which is
 * the only kind this repository allows — then cannot import it without
 * setting `DATABASE_URL` itself, and "the fix is always to pass the handle,
 * never to set `DATABASE_URL` from a test". So the rules sit in a module with
 * no import side effects at all: `mappingStillRuns` takes the pool it should
 * use, and the tests hand it one.
 */

import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError } from '@openmig/core';
import { runsPasses } from '@openmig/shared';
import type { TenantId, MappingId } from '@openmig/shared';
import { withTenant } from '@openmig/ledger';
import * as schemaPg from '@openmig/ledger/schema-pg';

/**
 * Is this mapping still one a pass may run for?
 *
 * Read BETWEEN DOMAINS, because the tick's answer is only current at the
 * moment it enqueued: a run already in the queue — or already copying — knows
 * nothing of the PATCH that paused it.
 *
 * The predicate is `runsPasses`, the same function the lifecycle module
 * defines for every other caller, so the pass stops exactly when the tick
 * would not have started it. `PASS_RUNNING_STATES` is the same two states as
 * a VALUE, and that form exists for `managed-sync-tick`'s SQL, "the query
 * that cannot call a function" — this is TypeScript and can, so it does.
 * Reaching for the array here would make a second reading of the lifecycle
 * that nothing keeps in step with the first.
 *
 * A mapping that is GONE answers false: no row is not a running row.
 *
 * Exported because it is the whole condition on which a pass abandons work it
 * was asked to do, and `a-pause-nobody-could-press.integration.test.ts` runs
 * it against real rows.
 */
export async function mappingStillRuns(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
): Promise<boolean> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: schemaPg.mailboxMapping.status })
      .from(schemaPg.mailboxMapping)
      .where(eq(schemaPg.mailboxMapping.id, mappingId));
    return row !== undefined && runsPasses(row.status);
  });
}

/**
 * The error this task should fail with, given the one the pass threw.
 *
 * A DELIBERATE STOP IS NOT RETRIED. `PassAbortError` is the pass saying "25
 * items failed in a row, the world is broken, stop". Rethrown as an ordinary
 * error it went through `trigger.config.ts`'s default retry — three attempts,
 * 5s/10s/20s apart — so ONE tick produced three failed runs inside a minute
 * against a target that had already said no (live, 2026-09-11: four failed
 * passes inside 13:01, and the only way to halt them was `docker stop` on the
 * worker). Retrying was pointless by construction: the pass had just proven
 * the same thing 25 times.
 *
 * `AbortTaskRunError` fails the run ONCE. The sync tick's failing-backoff
 * ladder then spaces the next attempts out, which is the layer designed to.
 *
 * Everything else is returned UNCHANGED, and that half matters as much: a
 * thrown pool error, an OOM, a provider 500 are all worth another go, and a
 * blanket abort here would turn one bad minute into a migration that never
 * resumes on its own.
 */
export function taskErrorFor(error: unknown): unknown {
  return error instanceof PassAbortError ? new AbortTaskRunError(error.message) : error;
}
