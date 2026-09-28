// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE POOLS A PER-TENANT TASK OPENS (workplan 0138 T1 parts 1 and 5).
 *
 * The one place a per-tenant task's database pools are built: the eight
 * per-tenant jobs (`run-delta-sync`, `run-discovery`, `run-verification`,
 * `run-confirmation`, `run-apply-deletion`, `run-apply-relocation`,
 * `run-cutover`, `run-rollback`) and the standalone worker (`src/index.ts`)
 * call `openTaskPools` and build none of their own.
 *
 * TWO POOLS.
 *
 *   - `tenant`, on `APP_DATABASE_URL`: `app_user`, whom row security binds.
 *     Every read and write a pass makes about an organisation goes through it,
 *     inside that organisation's scope (`withTenant`, or `tenantScopedDb` for a
 *     store that lives for the whole pass; T1 step 1), so the database itself
 *     keeps one organisation's rows from another's, as it does on the API's
 *     request path. The rate and byte budgets use it too, on a plain handle,
 *     their tables having no row security (ledger 0024, 0030), and so do the
 *     operator's log page's events, which `app_user` may insert (ledger 0059).
 *     Until 0138 T1's second step every job built its pool from `DATABASE_URL`,
 *     the owner, a superuser on the managed stack, whom Postgres never binds.
 *   - the audit key's, on `DATABASE_URL`: the owner, ONE connection, closed a
 *     second after its last use, for the one read `app_user` may not make: the
 *     deployment's pseudonym key in `deployment_key` (ledger 0062). The audit
 *     export reads it the first time a line is written. On the tenant pool the
 *     read is refused, and the event is kept while its line is lost, every
 *     line. It is the API's `auditKeyPool` (`apps/api/src/index.ts`), in a
 *     task. It reads no organisation's rows. T3 step 2 moves it to the system
 *     role, which is granted `deployment_key`.
 *
 * THE JOB GETS THE TENANT POOL ALONE. The key's pool goes to the audit sink
 * and nowhere else: it is the owner, whom row security never binds, and a job
 * handed it could read and write tenant data on it in one token. Until 0138 T1
 * step 2's review it was handed back, as `auditKey`, and three such one-token
 * changes to three jobs left all 486 tests of every guard green. The
 * `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` guard now holds
 * each per-tenant job, and the standalone worker, to taking `tenant` and `end`
 * from what this hands back and nothing else, and every file but this one to
 * never naming `auditKey`.
 *
 * ENDED AFTER THE FAILURE IS RECORDED. A job that opens its pools per run
 * (run-cutover, run-rollback) ends them in `afterwards(() => pools.end())`,
 * which `leavesAReference` runs once a failure is on the operator's log page,
 * whose sink is on the tenant pool. Ended in the run's own `finally`, the pool
 * was gone before the failure's event was written, and the event was lost.
 * The same guard fails when one of those files names an `end`, on any name,
 * anywhere but in a function it hands to `afterwards`: `pool.end()` on
 * `const pool = pools.tenant` ends this same pool, and when 0138 T1 step 2's
 * re-review put that in run-cutover's `finally`, every guard stayed green
 * until this one counted every end. It reads each job's own file; an end in
 * another file's function that the pool is handed to it does not see, and
 * none has one.
 *
 * NO FALLBACK. `APP_DATABASE_URL` unset or empty refuses; `DATABASE_URL` is
 * never used in its place. The API's `getDbPool` falls back to `DATABASE_URL`
 * for the appliance's sake; a task that did would quietly be back on the owner,
 * and every scope in it would change nothing again, with nothing to say so.
 * `DATABASE_URL` unset refuses too: every audit line the task writes would be
 * lost, and that is not a state to start in (hard rule 9).
 *
 * NOTHING AT IMPORT. A job imports this at its top, and a test imports the
 * job's helpers from the job. Building a pool or pointing a sink is what
 * `openTaskPools` does when it is CALLED; loading this module does neither.
 * `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` checks both that
 * every per-tenant job calls it and that no top-level statement here runs
 * anything; `a-task-pool-that-fell-back-to-the-owner.unit.test.ts` (beside
 * this file) checks the refusals and the pools, and
 * `a-pass-under-row-security.integration.test.ts` asks Postgres who they are.
 *
 * THE POOLER. Both pools go through PgBouncer in transaction mode, the tenant
 * pool as `app_user`, and share that user's server connections with the API's
 * request path since this step (docs/rls-guide.md, "Where row security holds
 * today"; 0138 Status, 2026-09-28, for the sizing). Every scope here is one
 * transaction, so a server connection is held for the scope and not for the
 * pass.
 */

import { Pool } from 'pg';
import { appEventSinkOn, auditExportOn, pgDriver } from '@openmig/ledger';
import { log, setAppEventSink, setAuditExportSink } from '@openmig/shared';

/** The environment a task reads its two URLs from: `process.env`, or a test's own. */
export type TaskEnv = Readonly<Record<string, string | undefined>>;

/**
 * What a job gets: the tenant pool, and its end. Not the key's pool, which the
 * audit sink holds and nothing else (see the file header).
 */
export interface TaskPools {
  /** `app_user`, on `APP_DATABASE_URL`: every tenant read and write, inside its scope. */
  readonly tenant: Pool;
  /**
   * End the tenant pool: in `afterwards`, so a failure is recorded on it first.
   * The key's pool is left to close its own connection a second after its
   * last read, as the API's does: ending it here could cut off a line whose
   * key read is still under way as a run finishes.
   */
  end(): Promise<void>;
}

export interface TaskPoolOptions {
  /** Where an audit line goes. The process's output, unless a test says otherwise. */
  readonly write?: (line: string) => void;
}

/**
 * Build a per-tenant task's two pools and point this process's sinks at them:
 * the operator's log page at the tenant pool, the audit export at the key's.
 * Refuses without `APP_DATABASE_URL` (never `DATABASE_URL` in its place) and
 * without `DATABASE_URL` (the key's). See the file header.
 */
export function openTaskPools(env: TaskEnv = process.env, options: TaskPoolOptions = {}): TaskPools {
  const appUrl = env.APP_DATABASE_URL?.trim();
  if (!appUrl) {
    throw new Error(
      'APP_DATABASE_URL is required: a per-tenant task reads and writes tenant data as app_user, under ' +
        'row security, and never DATABASE_URL in its place, which is the database owner. ' +
        'deploy/compose/set-task-env.sh uploads it (workplan 0138 T1).',
    );
  }
  const ownerUrl = env.DATABASE_URL?.trim();
  if (!ownerUrl) {
    throw new Error(
      "DATABASE_URL is required, for the audit key's pool alone: app_user may not read deployment_key " +
        '(ledger migration 0062), so without it every audit line this task writes would be lost ' +
        '(workplan 0138 T1 part 5).',
    );
  }

  const tenant = new Pool({ connectionString: appUrl });
  // One connection, closed a second after its last use, whose error handler
  // keeps a dropped idle connection from ending the process: the API's.
  const auditKey = new Pool({ connectionString: ownerUrl, max: 1, idleTimeoutMillis: 1_000 });
  auditKey.on('error', (err) => log.warn(`[audit-export] the key's connection closed: ${err.message}`));

  // This process's errors and warnings go to the operator's log page (0129
  // T1), under the reference a failure carries in the plane (0134, open
  // question 3 (a)). app_user may insert an event and read none (ledger 0059).
  setAppEventSink(appEventSinkOn(pgDriver(tenant)));
  // Each audit event also as one JSON line on the process's output (0129 T4),
  // its pseudonyms made with the key read on the key's own pool.
  setAuditExportSink(auditExportOn(pgDriver(auditKey), { 'service.name': 'ownpace-worker' }, options.write));

  // The tenant pool alone: the key's stays with its sink.
  return {
    tenant,
    end: () => tenant.end(),
  };
}
