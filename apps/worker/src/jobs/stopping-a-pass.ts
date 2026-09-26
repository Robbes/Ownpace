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

import type { Pool } from 'pg';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError } from '@openmig/core';
import { pathRunsNow } from '@openmig/shared';
import type { TenantId, MappingId } from '@openmig/shared';
import { readPathPhases, withTenant, type MigrationPhases } from '@openmig/ledger';

/**
 * Is this mapping still one a pass may run for?
 *
 * Read BETWEEN DOMAINS, because the tick's answer is only current at the
 * moment it enqueued: a run already in the queue — or already copying — knows
 * nothing of the PATCH that paused it.
 *
 * The predicate is the reader's `anyRuns` (0128 T5, slice 2b): `runsPassesNow`,
 * the same function the lifecycle module defines for every other caller, asked
 * with the cutover's windows (0128 T2), any of which will do (one per data
 * type since slice 4), or of a path kept in the lane when its rows add up to
 * the migration's status. So the pass stops exactly when the tick would not
 * have started it: a cutover's pass runs until its last grace period ends,
 * and not after, unless a data type of it is kept.
 * `PASS_RUNNING_STATES` is the same two states as
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
  return (await whyThePassStops(db, tenantId, mappingId)) === null;
}

/**
 * Why a pass stops before its next data type: the migration no longer runs
 * (paused, finished or gone), or the person who granted it access took the
 * grant back (workplan 0108 T8 (c), ledger migration 0063).
 */
export type PassHalt = 'no_longer_runs' | 'grant_withdrawn';

/**
 * `mappingStillRuns`, saying which of the two it is, because the run log and
 * the cutover's refusal owe the owner different sentences: *paused* is
 * something they did, *withdrawn* is something somebody else did, and it needs
 * a new grant rather than a press of Resume.
 *
 * A withdrawal is checked AFTER the lifecycle: a paused migration whose grant
 * was also withdrawn is stopped either way, and the pause is the older fact.
 */
export async function whyThePassStops(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
): Promise<PassHalt | null> {
  return withTenant(db, tenantId, async (tx) => haltFrom(await readPathPhases(tx, tenantId, mappingId)));
}

/**
 * The migration's answer, from its phases: gone, or no longer running (paused,
 * finished, or a cutover past its grace period, 0128 T2), or its grant taken
 * back. Null when the pass may go on.
 */
export function haltFrom(phases: MigrationPhases | null): PassHalt | null {
  if (phases === null) return 'no_longer_runs';
  // No data type of it runs any more (0128 T5, slice 2b): the migration's own
  // answer, or a path kept in the lane while another is past its cutover.
  if (!phases.anyRuns) return 'no_longer_runs';
  return phases.grantWithdrawnAt ? 'grant_withdrawn' : null;
}

/**
 * What a pass does before one data type (workplan 0128 T5): stop, when the
 * migration itself no longer runs or its grant was withdrawn; move on past this
 * data type, when the migration still runs and this data type does not (its own
 * cutover past its grace period, ended, or stopped by its owner, 0128 T4), so the
 * next one still gets its turn; and otherwise run it.
 *
 * A data type's phase is its own path row's (slice 2b), its stop its owner's
 * (0128 T4), and its grace window its own cutover ledger's, or the whole
 * migration's where it has none (slice 4). So once mail is cut over on its own
 * (slice 5), a pass moves on past it when its window closes, and the files
 * after it keep their turn.
 */
export type PassStep =
  | { readonly run: true }
  | { readonly skip: 'data_type_no_longer_runs' | 'stopped_by_its_owner' }
  | { readonly halt: PassHalt };

export async function passStepBefore(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: string,
): Promise<PassStep> {
  return withTenant(db, tenantId, async (tx) => stepFrom(await readPathPhases(tx, tenantId, mappingId), domain));
}

/** `passStepBefore`'s decision, from the phases already read. */
export function stepFrom(phases: MigrationPhases | null, domain: string): PassStep {
  const halt = haltFrom(phases);
  if (halt) return { halt };
  const path = phases!.phaseOf(domain);
  // Its owner stopped it (0128 T4): said as such, not as an ending.
  if (path.stopped === true) return { skip: 'stopped_by_its_owner' };
  if (!pathRunsNow(path)) return { skip: 'data_type_no_longer_runs' };
  return { run: true };
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
