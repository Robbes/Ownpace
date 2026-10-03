// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE POOLS A TASK OPENS FOR ONE ORGANISATION'S ROWS (workplan 0138 T1 parts
 * 1 and 5, and T2).
 *
 * The one place a task's database pools are built for tenant data: the eight
 * per-tenant jobs (`run-delta-sync`, `run-discovery`, `run-verification`,
 * `run-confirmation`, `run-apply-deletion`, `run-apply-relocation`,
 * `run-cutover`, `run-rollback`), the standalone worker (`src/index.ts`) and,
 * since T2, the three jobs split in two (`managed-digest`,
 * `managed-drift-detect`, `managed-group-discovery`) call `openTaskPools` and
 * build none of their own.
 *
 * THE SPLIT JOBS' ONE QUESTION ACROSS ORGANISATIONS (T2, open question 3
 * answered 2026-09-28, "split them"). The digest, the drift detector and group
 * discovery each need to know which organisations to visit, and nothing else
 * across them. `activeOrganisations` answers that, and only that: the ids of
 * the active organisations, read on the system role's URL
 * (`SYSTEM_DATABASE_URL`, `ownpace_system`, 0138 T3 step 2; the owner's
 * `DATABASE_URL` until then) on a pool of one that is closed before it
 * answers. Everything the job then reads or writes for one
 * organisation (its row, members, migrations, queues, sources, decisions,
 * groups, audit rows) goes through that organisation's scope on the tenant
 * pool below. The list is read where it can be read: on `app_user`, with no
 * organisation set, `tenant` answers no row, and a job handed that empty list
 * would visit nobody and report a quiet morning. So it first asks whether its
 * connection sees every organisation (a superuser, or `BYPASSRLS`, which the
 * system role has and nothing else it holds), and refuses when it does not.
 * It never reads `APP_DATABASE_URL`, and it never falls back to it, nor to
 * `DATABASE_URL`, the owner, which no run holds since T3 step 2.
 *
 * WHAT THIS HANDS OUT, AND NOTHING MORE (0138 T2's review). Review added one
 * export here that asked the role question and then handed its caller the
 * list's pool, `acrossOrganisations(work)`, and read every organisation on it
 * from a split job's run and from a per-tenant job, with every guard green.
 * `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` (rule 7) now holds
 * this module to three values, `openTaskPools`, `activeOrganisations` and
 * `ACTIVE_ORGANISATIONS_SQL`, and types; to its own short list of imports, so
 * no query builder and no schema; to naming each pool it builds on the system
 * role's URL (the key's and the list's) only to ask it one of its two
 * statements by name, end it, hear its errors or, the key's, hand it to the
 * audit sink; and
 * `activeOrganisations` to answering `rows.map((row) => row.id)`, declared
 * `Promise<string[]>`. And it holds each file that imports this to what its
 * kind may take: a per-tenant job and the standalone worker `openTaskPools`, a
 * split job that and `activeOrganisations`.
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
 *   - the audit key's, on `SYSTEM_DATABASE_URL`: the system role,
 *     `ownpace_system`, ONE connection, closed a second after its last use,
 *     for the one read `app_user` may not make: the deployment's pseudonym key
 *     in `deployment_key` (ledger 0062). The audit export reads it the first
 *     time a line is written. On the tenant pool the read is refused, and the
 *     event is kept while its line is lost, every line. It is the API's
 *     `auditKeyPool` (`apps/api/src/index.ts`), in a task, on a role that is
 *     not a superuser: managed migration 0033 grants it `deployment_key`, and
 *     it reads no organisation's rows here. Until 0138 T3 step 2 this was the
 *     owner, `DATABASE_URL`, a superuser, in every run.
 *
 * THE JOB GETS THE TENANT POOL ALONE. The key's pool goes to the audit sink
 * and nowhere else: it is the system role, which reads past row security on
 * every table it is granted, and a job handed it could read tenant data on it
 * in one token (the owner, until T3 step 2, could read and write all of it). Until 0138 T1
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
 * until this one counted every end. It reads each job's own file, so it does
 * not see an end inside a function in another file that the pool is handed
 * to; none has one.
 *
 * NO FALLBACK. `APP_DATABASE_URL` unset or empty refuses; `DATABASE_URL` is
 * never used in its place. The API's `getDbPool` falls back to `DATABASE_URL`
 * for the appliance's sake; a task that did would quietly be back on the owner,
 * and every scope in it would change nothing again, with nothing to say so.
 * `SYSTEM_DATABASE_URL` unset refuses too: every audit line the task writes
 * would be lost, and that is not a state to start in (hard rule 9). Nor does
 * it fall back to `DATABASE_URL`, the owner, which `set-task-env.sh` stopped
 * uploading and deletes from the store (0138 T3 step 2):
 * `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` (rule 8) fails
 * if this module reads that name at all.
 *
 * NOTHING AT IMPORT. A job imports this at its top, and a test imports the
 * job's helpers from the job. Building a pool or pointing a sink is what
 * `openTaskPools` does when it is CALLED, and reading the list is what
 * `activeOrganisations` does when it is called; loading this module does
 * neither.
 * `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` checks both that
 * every per-tenant job calls it and that no top-level statement here runs
 * anything; `a-task-pool-that-fell-back-to-the-owner.unit.test.ts` (beside
 * this file) checks the refusals and the pools, and
 * `a-pass-under-row-security.integration.test.ts` asks Postgres who they are.
 *
 * THE POOLER. Every pool here goes through PgBouncer in transaction mode, the
 * tenant pool as `app_user`, and shares that user's server connections with
 * the API's request path since T1's second step (docs/rls-guide.md, "Where
 * row security holds today"; 0138 Status, 2026-09-28, for the sizing), and
 * the key's and the list's as `ownpace_system`, whose own pair serves the
 * three jobs that span organisations as well (T3 step 2). Every
 * scope here is one transaction, so a server connection is held for the scope
 * and not for the pass. The three split jobs run once a day each, at 06:30,
 * 07:00 and 08:00 UTC, one organisation and one scope at a time: one more of
 * `app_user`'s server connections at most while one runs.
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
 * without `SYSTEM_DATABASE_URL` (the key's; never `DATABASE_URL` in its place
 * either). See the file header.
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
  const systemUrl = env.SYSTEM_DATABASE_URL?.trim();
  if (!systemUrl) {
    throw new Error(
      "SYSTEM_DATABASE_URL is required, for the audit key's pool alone: app_user may not read deployment_key " +
        '(ledger migration 0062), so without it every audit line this task writes would be lost ' +
        '(workplan 0138 T1 part 5). It is the system role, ownpace_system, never DATABASE_URL, the database ' +
        'owner, which no run holds (workplan 0138 T3 step 2). deploy/compose/set-task-env.sh uploads it.',
    );
  }

  const tenant = new Pool({ connectionString: appUrl });
  // One connection, closed a second after its last use, whose error handler
  // keeps a dropped idle connection from ending the process: the API's.
  const auditKey = new Pool({ connectionString: systemUrl, max: 1, idleTimeoutMillis: 1_000 });
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

/**
 * The one statement a split job sends across organisations: which ones are
 * active, by id. No name, no settings, no other table: what the job needs of
 * an organisation beyond its id it reads in that organisation's own scope
 * (0138 T2). `a-pass-that-opened-the-owners-pool` holds this module to this
 * statement and the role question below, and nothing else.
 */
export const ACTIVE_ORGANISATIONS_SQL = "SELECT id FROM tenant WHERE status = 'active' ORDER BY id";

/** Whether the connection sees every organisation: a superuser, or a role with `BYPASSRLS`. */
const SEES_EVERY_ORGANISATION_SQL =
  'SELECT rolsuper OR rolbypassrls AS sees_every_organisation FROM pg_roles WHERE rolname = current_user';

/**
 * The organisations a split job visits: the ids of the active ones, read on
 * the system role's URL (`SYSTEM_DATABASE_URL`) on a pool of one, closed
 * before this returns. Refuses without `SYSTEM_DATABASE_URL` (never
 * `APP_DATABASE_URL` in its place, and never `DATABASE_URL`, the owner), and
 * refuses on a connection row security binds, where the list would come back
 * empty and read as nothing to do. See the file header.
 */
export async function activeOrganisations(env: TaskEnv = process.env): Promise<string[]> {
  const systemUrl = env.SYSTEM_DATABASE_URL?.trim();
  if (!systemUrl) {
    throw new Error(
      'SYSTEM_DATABASE_URL is required, for the list of organisations alone: a job split in two asks which ' +
        'organisations are active on the connection that sees them all, the system role ownpace_system, and ' +
        'reads each one on APP_DATABASE_URL in its own scope; never APP_DATABASE_URL for the list, where it ' +
        'would find none, and never DATABASE_URL, the database owner, which no run holds (workplan 0138 T2, ' +
        'T3 step 2).',
    );
  }
  const list = new Pool({ connectionString: systemUrl, max: 1 });
  list.on('error', (err) => log.warn(`[organisations] the list's connection closed: ${err.message}`));
  try {
    const seen = await list.query<{ sees_every_organisation: boolean }>(SEES_EVERY_ORGANISATION_SQL);
    if (seen.rows[0]?.sees_every_organisation !== true) {
      throw new Error(
        "The list of organisations was asked on a connection that row security binds: with no " +
          'organisation set it would find none, and the job would visit nobody and call that ' +
          "nothing to do. It is read on the system role's connection, SYSTEM_DATABASE_URL, whose " +
          'role has BYPASSRLS (workplan 0138 T2, T3 step 2).',
      );
    }
    const { rows } = await list.query<{ id: string }>(ACTIVE_ORGANISATIONS_SQL);
    return rows.map((row) => row.id);
  } finally {
    await list.end();
  }
}
