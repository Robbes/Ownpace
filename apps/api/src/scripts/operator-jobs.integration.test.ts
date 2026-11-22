// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh jobs`, AGAINST A REAL PG-BOSS (workplan 0167 T6): a worker of
 * the runner working the catalog's queues, and the commands reading and
 * steering them through the runner's producer-only client, as a role of their
 * own that owns its schema and nothing else, as `ownpace_jobs` does. The hold
 * is the ledger's own `platform_pause`, read as the API's doors read it.
 *
 * What it must show, and what a fake could not:
 *  - `jobs` counts what pg-boss counts, and names the migration a singleton
 *    run is active for;
 *  - `jobs failures` reads a failed run back with its error's name and
 *    message, its attempt and its tags, and nothing of its payload;
 *  - `jobs run` starts nothing while a real hold is open, and a run with
 *    `--despite-hold`; a payload the job's own schema would refuse fails once,
 *    not retried;
 *  - `jobs show` and `jobs cancel` find a run by its id alone, and a cancel
 *    stops a run that is going.
 *
 * Handed its database as `TEST_DATABASE_URL`, both migration chains applied
 * (the Testcontainers harness, or `scripts/local-pg.sh`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readOpenPause } from '@openmig/managed';
import { JOB_CATALOG, PgBossJobRunner, PgBossProducer, RunNotRetried } from '@openmig/scheduler/pg-boss';
import { parseJobsCommand, runJobsCommand, type JobsDeps, type JobsReport } from './operator-jobs.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const ROLE = 'ownpace_jobs_operator_test';
const SCHEMA = `jobs_operator_${randomBytes(4).toString('hex')}`;
const PASSWORD = randomBytes(18).toString('base64url');
const JOBS_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.username = ROLE;
  u.password = PASSWORD;
  return u.toString();
})();

const TENANT = '6c9d0000-e29b-41d4-a716-446655440001';
const MAPPING = '6c9d0000-e29b-41d4-a716-446655440002';
const HOLD = '6c9d0000-e29b-41d4-a716-4466554400ff';
const SECRET = 'words-a-tester-typed';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await sleep(250);
  }
}

let admin: pg.Pool;
let worker: PgBossJobRunner;
let producer: PgBossProducer;
let deps: JobsDeps;
/** Lets the pass that holds its migration's key go, once the test has looked. */
let releasePass: () => void = () => undefined;
const passStopped: string[] = [];

async function jobs(...args: string[]): Promise<JobsReport> {
  const command = parseJobsCommand(args);
  if ('error' in command) throw new Error(command.error);
  return runJobsCommand(command, deps);
}

const runIdOf = (report: JobsReport): string => {
  const m = /as run ([0-9a-f-]{36})\./.exec(report.lines.join('\n'));
  if (!m) throw new Error(`no run id in: ${report.lines.join('\n')}`);
  return m[1]!;
};

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  await admin.query('DELETE FROM platform_pause WHERE id = $1', [HOLD]);
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  await admin.query(
    `${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT ` +
      `NOREPLICATION NOBYPASSRLS PASSWORD '${PASSWORD}'`,
  );
  await admin.query(`CREATE SCHEMA ${SCHEMA} AUTHORIZATION ${ROLE}`);

  worker = new PgBossJobRunner({
    connectionString: JOBS_URL,
    schema: SCHEMA,
    pollingIntervalSeconds: 0.5,
    monitorIntervalSeconds: 1,
    superviseIntervalSeconds: 1,
    cronWorkerIntervalSeconds: 1,
    cronMonitorIntervalSeconds: 1,
  });
  await worker.start(JOB_CATALOG);
  // A rollback refuses as a job's own schema refuses a payload: by name, not retried.
  await worker.work('run-rollback', async (payload: { tenantId?: unknown }) => {
    if (typeof payload.tenantId !== 'string') {
      const refusal = new Error('tenantId: Required');
      refusal.name = 'ZodError';
      throw refusal;
    }
    throw new RunNotRetried('The rollback was refused: nothing to roll back to.');
  });
  // A pass that holds its migration's key until it is let go, or cancelled.
  await worker.work('run-delta-sync', (_payload, ctx) => {
    return new Promise<null>((resolve, reject) => {
      releasePass = () => resolve(null);
      ctx.signal.addEventListener('abort', () => {
        passStopped.push(ctx.runId);
        reject(new Error('stopped'));
      });
    });
  });

  producer = new PgBossProducer({ connectionString: JOBS_URL, schema: SCHEMA }, JOB_CATALOG);
  await producer.start();
  deps = { jobs: producer, readHold: () => readOpenPause(drizzle(admin)) };
}, 60_000);

afterAll(async () => {
  releasePass();
  await producer?.stop({ graceful: false }).catch(() => undefined);
  await worker?.stop({ graceful: false }).catch(() => undefined);
  if (admin) {
    await admin.query('DELETE FROM platform_pause WHERE id = $1', [HOLD]);
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  }
});

describe('operator.sh jobs, on a real pg-boss', () => {
  it('lists every queue of the catalog, each made by the worker, with nothing in it yet', async () => {
    const report = await jobs();
    expect(report.exitCode).toBe(0);
    for (const job of JOB_CATALOG) {
      expect(report.lines.find((l) => l.startsWith(`${job.name} `))).toMatch(new RegExp(`^${job.name} +0 +0 +0  -$`));
    }
    expect(report.lines.join('\n')).not.toContain('not made yet');
  });

  it('starts nothing while the hold is open, and starts the run with --despite-hold', async () => {
    await admin.query(`INSERT INTO platform_pause (id, message, started_by) VALUES ($1, 'deploying', 'operator:test')`, [HOLD]);
    try {
      const held = await jobs('run', 'run-rollback', JSON.stringify({ tenantId: TENANT, note: SECRET }));
      expect(held.exitCode).toBe(1);
      expect(held.lines[0]).toContain("The operator's hold is open since");
      const rows = await admin.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.job WHERE name = 'run-rollback'`);
      expect(rows.rows[0].n).toBe(0);

      const despite = await jobs('run', 'run-rollback', JSON.stringify({ tenantId: TENANT, note: SECRET }), '--despite-hold');
      expect(despite.exitCode).toBe(0);
      const runId = runIdOf(despite);
      const shown = await until('the rollback to fail', async () => {
        const r = await jobs('show', runId);
        return r.lines[0]?.endsWith('failed, attempt 1') ? r : null;
      });
      expect(shown.lines).toEqual([
        `${runId} on run-rollback: failed, attempt 1`,
        expect.stringMatching(/^ {2}created \S+Z, started \S+Z, settled \S+Z$/),
        `  tags: operator tenant:${TENANT}`,
        '  error: RunNotRetried: The rollback was refused: nothing to roll back to.',
      ]);
    } finally {
      await admin.query(`UPDATE platform_pause SET ended_at = now(), ended_by = 'operator:test' WHERE id = $1`, [HOLD]);
    }
  }, 60_000);

  it("a payload the job's schema refuses fails once, not retried, and failures reads it back without the payload", async () => {
    const runId = runIdOf(await jobs('run', 'run-rollback', JSON.stringify({ note: SECRET })));
    const report = await until('the failure to be read back', async () => {
      const r = await jobs('failures', 'run-rollback', '--limit', '5');
      return r.lines.some((l) => l.includes(runId)) ? r : null;
    });
    const at = report.lines.findIndex((l) => l.includes(runId));
    expect(report.lines[0]).toBe('The 2 most recent failed run(s) on run-rollback, newest first (at most 5):');
    expect(report.lines[at]).toMatch(new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ  run-rollback  ${runId}  attempt 1  operator$`));
    expect(report.lines[at + 1]).toBe('    ZodError: tenantId: Required');
    expect(report.lines.join('\n')).not.toContain(SECRET);
    // Across every queue too, and cut at the limit.
    const any = await jobs('failures', '--limit', '1');
    expect(any.lines).toHaveLength(3);
    expect(any.lines[1]).toContain(runId);
    // Not retried: one attempt, and settled.
    const status = await producer.status(runId);
    expect(status).toMatchObject({ state: 'failed', attempt: 1 });
  }, 60_000);

  it('counts the failures and names the migration a pass is active for, then cancels it by its id alone', async () => {
    const queued = await jobs('run', 'run-delta-sync', JSON.stringify({ tenantId: TENANT, mappingId: MAPPING }));
    const runId = runIdOf(queued);
    const view = await until('the monitor to count the pass and the failures', async () => {
      const r = await jobs();
      const pass = r.lines.find((l) => l.startsWith('run-delta-sync '));
      const rollback = r.lines.find((l) => l.startsWith('run-rollback '));
      return pass?.endsWith(`  ${MAPPING}`) && /^run-rollback +0 +0 +2 {2}-$/.test(rollback ?? '') ? r : null;
    });
    expect(view.lines.find((l) => l.startsWith('run-delta-sync '))).toMatch(
      new RegExp(`^run-delta-sync +0 +1 +0  ${MAPPING}$`),
    );

    const cancelled = await jobs('cancel', runId);
    expect(cancelled).toEqual({
      lines: [`Run ${runId} is cancelled. A run already going stops at its next heartbeat, within 30 s.`],
      exitCode: 0,
    });
    await until('the pass to see its cancel', async () => passStopped.includes(runId), 45_000);
    expect((await jobs('show', runId)).lines[0]).toBe(`${runId} on run-delta-sync: cancelled, attempt 1`);
    expect(await jobs('cancel', runId)).toMatchObject({ exitCode: 1 });
  }, 90_000);

  it('a run no queue holds is said to be gone, and exits 1', async () => {
    const report = await jobs('show', '6c9d0000-e29b-41d4-a716-446655440099');
    expect(report.exitCode).toBe(1);
    expect(report.lines[0]).toContain('No queue holds a run 6c9d0000-e29b-41d4-a716-446655440099');
  });
});
