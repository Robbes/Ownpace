// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TWO RULES ABOUT STOPPING A PASS (live findings 2026-09-11).
 *
 * Both were learnt the same afternoon, on one migration: a pass that would not
 * stop when it should, and a pass that stopped and would not stay stopped.
 * The second rule is `planeErrorFor`'s now (`what-a-run-leaves.ts`), because
 * every task's error goes through it on its way out (workplan 0134, open
 * question 3 (a)). The first is here.
 *
 * They live HERE, and not in `run-delta-sync.ts` where they are used, for a
 * reason the guard `an-integration-test-is-handed-its-database.unit.test.ts`
 * makes concrete: that module opens its pools at import (`openTaskPools`,
 * from `APP_DATABASE_URL` and, for the audit key, `DATABASE_URL`) and throws
 * without them. A test that has been handed a database — which is the only
 * kind this repository allows — then cannot import it without setting both
 * itself, and "the fix is always to pass the handle, never to set
 * `DATABASE_URL` from a test". So the rules sit in a module with
 * no import side effects at all: `mappingStillRuns` takes the pool it should
 * use, and the tests hand it one.
 */

import type { Pool } from 'pg';
import { haltFrom, stepFrom, stopReasonOf } from '@openmig/shared';
import type { TenantId, MappingId, PassHalt, PassStep, PassStopReason } from '@openmig/shared';
import { organisationIsOpen, readPathPhases, withTenant } from '@openmig/ledger';

/**
 * The decision itself lives in `@openmig/shared` (`path-phase.ts`) since
 * 2026-09-29, beside `pathRunsNow`, because the appliance asks it too now and
 * cannot import this worker; a second copy written out for it is the second
 * reading of the lifecycle this file's comments refuse. Re-exported so every
 * caller here (`final-sync.ts`, `run-delta-sync.ts`, the tests) reads it
 * where it always did.
 */
export { haltFrom, stepFrom, type PassHalt, type PassSkip, type PassStep } from '@openmig/shared';

/**
 * Is this mapping still one a pass may run for?
 *
 * Read BETWEEN DOMAINS, because the tick's answer is only current at the
 * moment it enqueued: a run already in the queue — or already copying — knows
 * nothing of the PATCH that paused it. And, since 2026-09-29, from INSIDE one
 * too, through `whyThisDataTypeStops` below: between domains alone let a
 * Pause pressed during a file pass wait for that pass's own deadline.
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
 * `mappingStillRuns`, saying which of the three it is, because the run log and
 * the cutover's refusal owe the owner different sentences: *paused* is
 * something they did, *withdrawn* is something somebody else did, and it needs
 * a new grant rather than a press of Resume, and *closed* is undone only by a
 * reopen.
 *
 * The close is asked FIRST, in the same transaction as the migration's phases:
 * it is the organisation's, it stops every one of its migrations whatever
 * their own state, and a Resume would not lift it. A pass the tick enqueued in
 * the minute before the close has no run row for the close to cancel, and a
 * retry has none either; this is where both stop, before anything is built.
 * A withdrawal is checked AFTER the lifecycle: a paused migration whose grant
 * was also withdrawn is stopped either way, and the pause is the older fact.
 */
export async function whyThePassStops(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
): Promise<PassHalt | null> {
  return withTenant(db, tenantId, async (tx) => {
    if (!(await organisationIsOpen(tx, tenantId))) return 'organisation_closed';
    return haltFrom(await readPathPhases(tx, tenantId, mappingId));
  });
}

/**
 * What a pass does before one data type (workplan 0128 T5): `stepFrom`, from
 * the organisation's status and the migration's phases read in one
 * transaction. See `PassStep` (shared) for the three answers.
 */
export async function passStepBefore(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: string,
): Promise<PassStep> {
  return withTenant(db, tenantId, async (tx) => {
    // The organisation first, as `whyThePassStops` asks it (0085 T2).
    if (!(await organisationIsOpen(tx, tenantId))) return { halt: 'organisation_closed' };
    return stepFrom(await readPathPhases(tx, tenantId, mappingId), domain);
  });
}

/**
 * THE QUESTION A DATA TYPE'S PASS ASKS FROM INSIDE (2026-09-29): has it been
 * told to stop, and why? `passStepBefore`'s answer, said as the one reason the
 * loop needs, or null to go on.
 *
 * The owner pressed Pause while a file pass was writing into a Nextcloud
 * target, and the writes went on for most of an hour: this file's re-read ran
 * between data types only, and inside one the pass stopped for nothing short
 * of its own deadline. `run-delta-sync` now hands each data type's pass this
 * question beside its deadline (`PassClock.whyItStops`), and the loop asks it
 * at most once every `PASS_REREAD_EVERY_MS`. So all four doors that stop a
 * pass between data types — a Pause, a grant taken back, a closed
 * organisation, a data type its owner stopped — stop it inside one too, the
 * way its deadline does.
 *
 * The same read as `passStepBefore`, deliberately, rather than a narrower one:
 * one reading of the lifecycle, asked from two places, cannot disagree with
 * itself. Handed its pool like everything here, so
 * `a-pause-nobody-could-press.integration.test.ts` runs it against real rows.
 */
export async function whyThisDataTypeStops(
  db: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: string,
): Promise<PassStopReason | null> {
  return stopReasonOf(await passStepBefore(db, tenantId, mappingId, domain));
}
