// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORKER, ON A REAL POSTGRES (ADR-0054; workplan 0167 T6).
 *
 * The managed edition's jobs worked on pg-boss: the worker started in this
 * process, its runs forked from their entries, as production forks them. What
 * this holds, one `describe` each:
 *
 *  1. it starts on the jobs' own role and schema, declares the seventeen
 *     queues and the nine schedules, each sent `{}`, answers `/health`, and
 *     stops; `main.ts` stops on SIGTERM and exits 0;
 *  2. the sync tick's schedule fires on the minute, in its own process as the
 *     system role, and enqueues a pass for a due migration, keyed by the
 *     migration and filed under its tags;
 *  3. real jobs: a payload a job's schema refuses fails once, as Trigger.dev
 *     4.8.8 fails it; a real `run-discovery` ends completed and writes its row
 *     as `app_user`, against a source that cannot be reached and, when the
 *     harness has one, the harness's Nextcloud;
 *  4. what a run asks of its runner: a cutover's wait behind a pass already
 *     running on its migration; the purge's verdict for a live, a finished, a
 *     gone and a Trigger.dev ref;
 *  5. a run's process: killed with SIGKILL, retried and converged; past its
 *     time limit, killed before the next run on its key starts (never two on
 *     one key); cancelled, killed within a heartbeat; at a stop, given its
 *     grace, then killed and retried;
 *  6. the tick's interlock across runners, its pg-boss half: held under the
 *     other runner's beat, and under a shared beat somebody else wrote; not
 *     under its own; and two runners left running start nothing.
 *
 * THE JOBS ROLE is made by `deploy/compose/jobs-role.sql`, the bring-up's own
 * file (#2041), run here as it is; the password is set after, as the bring-up
 * sets `.env`'s. pg-boss's
 * schema `pgboss` is dropped before and after, so every run starts from none.
 *
 * Handed its database as `TEST_DATABASE_URL` (the Testcontainers harness, or
 * `scripts/local-pg.sh`), with both migration chains applied. Two entries are
 * stand-ins (`./__testing__/`): the pass and the cutover, which record what
 * each attempt saw; the rest are the real ones.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PURGED_TABLES } from '@openmig/managed';
import { JOB_CATALOG, PgBossProducer, type JobCatalogEntry, type RunStatus } from '@openmig/scheduler/pg-boss';
import type { JobRunnerPort, RunContext as JobRunContext } from '../jobs/run-context.ts';
import { JOBS_SCHEMA, pgBossRunner } from './pg-boss-context.ts';
import { JobWorker, RUN_ENTRIES } from './worker.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run under the Testcontainers harness or scripts/local-pg.sh.');
}

/** The jobs' role and schema, made as the bring-up makes them: `deploy/compose/jobs-role.sql`, run as it is (#2041). */
const JOBS_ROLE_SQL = readFileSync(fileURLToPath(new URL('../../../../deploy/compose/jobs-role.sql', import.meta.url)), 'utf8');

const JOBS_PASSWORD = randomBytes(18).toString('base64url');
const SYSTEM_PASSWORD = randomBytes(18).toString('hex');

function as(user: string, password: string): string {
  const u = new URL(ADMIN_URL!);
  u.username = user;
  u.password = password;
  return u.toString();
}
const JOBS_URL = as('ownpace_jobs', JOBS_PASSWORD);
const SYSTEM_URL = as('ownpace_system', SYSTEM_PASSWORD);
const APP_URL = as('app_user', 'app_password');

const STAND_IN_PASS = new URL('./__testing__/a-pass-stand-in.ts', import.meta.url);
const STAND_IN_CUTOVER = new URL('./__testing__/a-cutover-stand-in.ts', import.meta.url);
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const WORKER_TO_KILL = fileURLToPath(new URL('./__testing__/a-worker-to-kill.ts', import.meta.url));

const NEXTCLOUD_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USERNAME;
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD;

/** This file's rows: an organisation, its two migrations and their connections. */
const P = '0167f6a0-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const TICK_SOURCE = `${P}11`;
const TICK_BOX = `${P}12`;
const TICK_MAPPING = `${P}13`;
const FOUND_SOURCE = `${P}21`;
const FOUND_TARGET = `${P}22`;
const FOUND_SOURCE_BOX = `${P}23`;
const FOUND_TARGET_BOX = `${P}24`;
const FOUND_MAPPING = `${P}25`;
const CLOUD_SOURCE = `${P}31`;
const CLOUD_TARGET = `${P}32`;
const CLOUD_SOURCE_BOX = `${P}33`;
const CLOUD_TARGET_BOX = `${P}34`;
const CLOUD_MAPPING = `${P}35`;

const BEATS = ['managed-sync-tick', 'managed-sync-tick-trigger', 'managed-sync-tick-pg-boss'] as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await sleep(250);
  }
}

let admin: pg.Pool;
let producer: PgBossProducer;
const workers: JobWorker[] = [];
const ENV = [
  'JOBS_DATABASE_URL',
  'SYSTEM_DATABASE_URL',
  'APP_DATABASE_URL',
  'MAX_PASSES_IN_FLIGHT',
  'MAX_PASSES_PER_ORGANISATION',
  'WORKER_TEST_DATABASE_URL',
  'OWNPACE_REACHABLE_HOSTS',
] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

/** The queues a test works: the catalog's, those named, each with what the test changes. */
function catalogOf(names: readonly string[], change: Record<string, Partial<JobCatalogEntry>> = {}): JobCatalogEntry[] {
  return JOB_CATALOG.filter((job) => names.includes(job.name)).map(
    (job) => ({ ...job, ...change[job.name] }) as JobCatalogEntry,
  );
}

/** The tick, the pass and the cutover, and discovery: what most tests work. */
const WORKED = ['managed-sync-tick', 'run-delta-sync', 'run-cutover', 'run-discovery'];

let producerStarted = false;

/** The producer never migrates: it starts once a worker has installed the schema. */
async function producerReady(): Promise<void> {
  if (producerStarted) return;
  await producer.start();
  producerStarted = true;
}

async function startWorker(
  opts: {
    catalog?: readonly JobCatalogEntry[];
    stopGraceMs?: number;
    stopSettleMs?: number;
    realPass?: boolean;
    passesInFlight?: number;
  } = {},
): Promise<JobWorker> {
  const worker = new JobWorker({
    connectionString: JOBS_URL,
    passesInFlight: opts.passesInFlight ?? 2,
    catalog: opts.catalog ?? catalogOf(WORKED),
    entries: {
      ...RUN_ENTRIES,
      ...(opts.realPass ? {} : { 'run-delta-sync': STAND_IN_PASS }),
      'run-cutover': STAND_IN_CUTOVER,
    },
    tuning: {
      pollingIntervalSeconds: 0.5,
      monitorIntervalSeconds: 1,
      superviseIntervalSeconds: 1,
      cronWorkerIntervalSeconds: 1,
      cronMonitorIntervalSeconds: 1,
    },
    health: { host: '127.0.0.1', port: 0 },
    stopGraceMs: opts.stopGraceMs ?? 20_000,
    stopSettleMs: opts.stopSettleMs ?? 5_000,
  });
  workers.push(worker);
  await worker.start();
  await producerReady();
  return worker;
}

async function settled(runId: string, timeoutMs = 60_000): Promise<RunStatus> {
  return until(
    `run ${runId} to settle`,
    async () => {
      const s = await producer.status(runId);
      return s && ['completed', 'failed', 'cancelled'].includes(s.state) ? s : null;
    },
    timeoutMs,
  );
}

interface Attempt {
  run_id: string;
  attempt: number;
  pid: number;
  others_alive: number;
  started_at: Date;
  finished_at: Date | null;
}
async function attemptsOf(key: string): Promise<Attempt[]> {
  const { rows } = await admin.query<Attempt>(
    'SELECT run_id, attempt, pid, others_alive, started_at, finished_at FROM worker_test_run WHERE key = $1 ORDER BY started_at',
    [key],
  );
  return rows;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A process's peak resident memory so far, in MB (`VmHWM`), or null once it is gone. */
function peakMb(pid: number): number | null {
  try {
    const kb = /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
    return kb === undefined ? null : Number(kb) / 1024;
  } catch {
    return null;
  }
}

/**
 * Watch the runs this process forks: every 20 ms, each child's queue (from the
 * entry it runs) and its peak resident memory. Linux only, as the worker's
 * container is; the peaks are read, not guessed.
 */
function watchRunMemory(): { stop(): Map<string, number> } {
  const peaks = new Map<string, number>();
  const sample = (): void => {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        if (ppid !== process.pid) continue;
        const queue = /runs\/([a-z-]+)\.ts/.exec(readFileSync(`/proc/${entry}/cmdline`, 'utf8'))?.[1];
        const mb = peakMb(Number(entry));
        if (queue && mb !== null) peaks.set(queue, Math.max(peaks.get(queue) ?? 0, mb));
      } catch {
        // The process ended between the listing and the read: its last sample stands.
      }
    }
  };
  const timer = setInterval(sample, 20);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return peaks;
    },
  };
}

/** The pg-boss table a queue's jobs are kept in. */
async function jobTableOf(queue: string): Promise<string> {
  const { rows } = await admin.query<{ table_name: string }>(`SELECT table_name FROM ${JOBS_SCHEMA}.queue WHERE name = $1`, [
    queue,
  ]);
  const table = rows[0]?.table_name;
  if (!table || !/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`No job table for "${queue}".`);
  return `${JOBS_SCHEMA}.${table}`;
}

async function beatOf(task: string): Promise<Date | undefined> {
  const { rows } = await admin.query<{ at: Date }>('SELECT beat_at AS at FROM sync_tick_beat WHERE task = $1', [task]);
  return rows[0]?.at;
}
async function beat(task: string, ageSeconds = 0): Promise<void> {
  await admin.query(
    `INSERT INTO sync_tick_beat (task, beat_at) VALUES ($1, now() - ($2::int * interval '1 second'))
     ON CONFLICT (task) DO UPDATE SET beat_at = EXCLUDED.beat_at`,
    [task, ageSeconds],
  );
}
/** pg-boss's schedules, but `keep`'s: none before a worker has installed the schema. */
async function forgetSchedules(keep = ''): Promise<void> {
  const { rows } = await admin.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [`${JOBS_SCHEMA}.schedule`]);
  if (rows[0]?.t) await admin.query(`DELETE FROM ${JOBS_SCHEMA}.schedule WHERE name <> $1`, [keep]);
}

async function forgetBeats(): Promise<void> {
  await admin.query('DELETE FROM sync_tick_beat WHERE task = ANY($1::text[])', [[...BEATS]]);
}

/** Every row of this file's organisation, in every table the purge empties, in the purge's order. */
async function forgetThisFilesRows(): Promise<void> {
  await admin.query('DELETE FROM app_event WHERE tenant_id = $1', [TENANT]);
  for (const table of PURGED_TABLES) await admin.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
  await admin.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
}

/** A migration to count: a Nextcloud source, a Nextcloud target, its file data type chosen. */
async function seedDiscovery(ids: {
  source: string;
  target: string;
  sourceBox: string;
  targetBox: string;
  mapping: string;
  url: string;
  username: string;
  password: string;
}): Promise<void> {
  // Credentials in the config, which the builders accept for tests.
  const config = JSON.stringify({
    url: ids.url,
    credentials: { username: ids.username, password: ids.password },
  });
  await admin.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1, $3, 'source', 'nextcloud', 'src', $4::jsonb, 'connected'),
       ($2, $3, 'target', 'nextcloud', 'dst', $4::jsonb, 'connected')
     ON CONFLICT (id) DO NOTHING`,
    [ids.source, ids.target, TENANT, config],
  );
  await admin.query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id) VALUES
       ($1, $3, $4, 'user', 'source'), ($2, $3, $5, 'user', 'target')
     ON CONFLICT (id) DO NOTHING`,
    [ids.sourceBox, ids.targetBox, TENANT, ids.source, ids.target],
  );
  await admin.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1, $2, $3, $4, 'mirror', 'active') ON CONFLICT (id) DO NOTHING`,
    [ids.mapping, TENANT, ids.sourceBox, ids.targetBox],
  );
  await admin.query(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'file', true)
     ON CONFLICT DO NOTHING`,
    [TENANT, ids.mapping],
  );
}

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 3 });
  await admin.query(`DROP SCHEMA IF EXISTS ${JOBS_SCHEMA} CASCADE`);
  await admin.query(JOBS_ROLE_SQL);
  // As the bring-up sets .env's values, after the role was made with none.
  await admin.query(`ALTER ROLE ownpace_jobs PASSWORD '${JOBS_PASSWORD}'`);
  await admin.query(`ALTER ROLE ownpace_system PASSWORD '${SYSTEM_PASSWORD}'`);
  await admin.query('DROP TABLE IF EXISTS worker_test_run');
  await admin.query(`
    CREATE TABLE worker_test_run (
      run_id text NOT NULL, queue text NOT NULL, attempt int NOT NULL, key text NOT NULL, pid int NOT NULL,
      others_alive int NOT NULL, payload jsonb, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz)`);
  await forgetThisFilesRows();
  await forgetBeats();
  await admin.query("INSERT INTO tenant (id, name, status) VALUES ($1, 'The worker on pg-boss', 'active')", [TENANT]);

  for (const name of ENV) saved[name] = process.env[name];
  // What the worker's runs inherit: the jobs', the system role's and app_user's URLs. The harness
  // publishes the owner's as TEST_DATABASE_URL only, which no job reads.
  process.env.JOBS_DATABASE_URL = JOBS_URL;
  process.env.SYSTEM_DATABASE_URL = SYSTEM_URL;
  process.env.APP_DATABASE_URL = APP_URL;
  // Another file's due migrations may not take this one's place under the caps.
  process.env.MAX_PASSES_IN_FLIGHT = '100000';
  process.env.MAX_PASSES_PER_ORGANISATION = '100000';
  // The stand-ins' own table, which only they write.
  process.env.WORKER_TEST_DATABASE_URL = ADMIN_URL;
  if (NEXTCLOUD_URL) process.env.OWNPACE_REACHABLE_HOSTS = new URL(NEXTCLOUD_URL).hostname;

  producer = new PgBossProducer({ connectionString: JOBS_URL, schema: JOBS_SCHEMA }, JOB_CATALOG);
}, 120_000);

// A stop waits for the runs still going, up to the tests' grace of 20 s and 5 s to settle: past
// vitest's own 10 s for a hook, which the integration project leaves as it is.
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
}, 60_000);

afterAll(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  if (producerStarted) await producer.stop();
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  if (admin) {
    await forgetBeats();
    await forgetThisFilesRows();
    await admin.query('DROP TABLE IF EXISTS worker_test_run');
    await admin.query(`DROP SCHEMA IF EXISTS ${JOBS_SCHEMA} CASCADE`);
    await admin.end();
  }
}, 120_000);

describe('the worker starts on the jobs role, declares the catalog, answers its health, and stops', () => {
  it('declares the seventeen queues and the nine schedules, each sent {} in UTC, and is healthy until it stops', async () => {
    // At live's cap on passes in flight, 7: the pass's queue worked eight at a time beside the sixteen others.
    const worker = await startWorker({ catalog: JOB_CATALOG, passesInFlight: 7 });
    try {
      expect(worker.state).toBe('running');
      const health = await fetch(`http://127.0.0.1:${worker.healthPort}/health`);
      expect(health.status).toBe(200);

      const { rows: queues } = await admin.query<{ name: string; policy: string }>(
        `SELECT name, policy FROM ${JOBS_SCHEMA}.queue WHERE name NOT LIKE '\\_\\_%' ORDER BY name`,
      );
      expect(queues.map((q) => q.name)).toEqual(JOB_CATALOG.map((j) => j.name).sort());
      for (const q of queues) expect(q.policy).toBe(JOB_CATALOG.find((j) => j.name === q.name)!.policy);

      const { rows: schedules } = await admin.query<{ name: string; cron: string; data: unknown; options: unknown }>(
        `SELECT name, cron, data, options FROM ${JOBS_SCHEMA}.schedule ORDER BY name`,
      );
      const scheduled = JOB_CATALOG.filter((j) => j.kind === 'schedule');
      expect(scheduled).toHaveLength(9);
      expect(schedules.map((s) => [s.name, s.cron])).toEqual(
        scheduled.map((j) => [j.name, j.kind === 'schedule' ? j.cron : '']).sort((a, b) => a[0]!.localeCompare(b[0]!)),
      );
      for (const s of schedules) {
        expect(s.data).toEqual({ payload: {} });
        expect(s.options).toMatchObject({ tz: 'UTC' });
      }

      // As the jobs role, which owns the schema and nothing else.
      const { rows: who } = await admin.query<{ usename: string }>(
        "SELECT DISTINCT usename FROM pg_stat_activity WHERE application_name LIKE 'ownpace-jobs%'",
      );
      expect(who.map((w) => w.usename)).toEqual(['ownpace_jobs']);
    } finally {
      const port = worker.healthPort;
      await worker.stop();
      expect(worker.state).toBe('stopped');
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
      // The schedules beyond the tick would fire in later tests, on queues no later worker works.
      await forgetSchedules('managed-sync-tick');
    }
  });

  it('a stop asked for while it starts: the start returns quietly, the worker never says it runs, and it stops', async () => {
    for (const after of [0, 50, 300]) {
      const worker = new JobWorker({
        connectionString: JOBS_URL,
        passesInFlight: 2,
        catalog: catalogOf(WORKED),
        entries: { ...RUN_ENTRIES, 'run-delta-sync': STAND_IN_PASS, 'run-cutover': STAND_IN_CUTOVER },
        health: null,
        stopGraceMs: 2_000,
        stopSettleMs: 2_000,
      });
      const starting = worker.start();
      await sleep(after);
      await worker.stop();
      await expect(starting, `a stop ${after} ms into the start`).resolves.toBeUndefined();
      expect(worker.state).toBe('stopped');
    }
  }, 120_000);

  it('main.ts: starts with the switch on pg-boss and the jobs URL, is healthy, and exits 0 on SIGTERM', async () => {
    const child = spawn(process.execPath, [MAIN], {
      env: { ...process.env, OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: JOBS_URL, MAX_PASSES_IN_FLIGHT: '7' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      await until(
        'the worker to answer /health with 200',
        async () => {
          if (child.exitCode !== null) throw new Error(`main.ts exited ${child.exitCode}:\n${output}`);
          const r = await fetch('http://127.0.0.1:3002/health').catch(() => null);
          return r?.status === 200;
        },
        60_000,
      );
      // The parent's own memory, started and idle: what the worker's limit keeps besides its runs.
      process.stdout.write(`[memory] the worker's parent process, started: ${Math.round(peakMb(child.pid!) ?? 0)} MB peak resident\n`);
      child.kill('SIGTERM');
      expect(await exited, output).toBe(0);
      expect(output).toContain('[worker] SIGTERM: stopping.');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await forgetSchedules('managed-sync-tick');
    }
  });
});

describe("the sync tick's schedule fires on pg-boss and enqueues a pass", () => {
  beforeAll(async () => {
    await admin.query(
      "INSERT INTO connection (id, tenant_id, role, kind, display_name, status) VALUES ($1, $2, 'source', 'imap', 'tick mail', 'connected') ON CONFLICT (id) DO NOTHING",
      [TICK_SOURCE, TENANT],
    );
    await admin.query(
      "INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'tick@worker.example.invalid') ON CONFLICT (id) DO NOTHING",
      [TICK_BOX, TENANT, TICK_SOURCE],
    );
    await admin.query(
      "INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, name, status) VALUES ($1, $2, $3, 'tick due', 'active') ON CONFLICT (id) DO NOTHING",
      [TICK_MAPPING, TENANT, TICK_BOX],
    );
    await admin.query(
      "INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'email', true) ON CONFLICT DO NOTHING",
      [TENANT, TICK_MAPPING],
    );
  }, 60_000);

  it('on the minute, as the system role: a pass keyed by the migration, filed under its tags, and both beats at once', async () => {
    await forgetBeats();
    await startWorker();
    const table = await jobTableOf('run-delta-sync');
    const pass = await until(
      'the tick to enqueue a pass for the due migration',
      async () =>
        (
          await admin.query<{ id: string; singleton_key: string | null; data: { payload: unknown; tags: string[] } }>(
            `SELECT id, singleton_key, data FROM ${table} WHERE name = 'run-delta-sync' AND singleton_key = $1`,
            [TICK_MAPPING],
          )
        ).rows[0],
      // The schedule is the minute's: up to a minute, and the tick's own run.
      90_000,
    );
    expect(pass.data.payload).toEqual({ tenantId: TENANT, mappingId: TICK_MAPPING, domains: ['email'] });
    expect(pass.data.tags).toEqual([`tenant:${TENANT}`, `mapping:${TICK_MAPPING}`]);
    expect((await settled(pass.id)).state).toBe('completed');
    const [attempt] = await attemptsOf(TICK_MAPPING);
    expect(attempt).toMatchObject({ run_id: pass.id, attempt: 1 });

    // The tick that enqueued it completed, and wrote both beats at one time.
    const tickTable = await jobTableOf('managed-sync-tick');
    const { rows: ticks } = await admin.query<{ state: string }>(
      `SELECT state FROM ${tickTable} WHERE name = 'managed-sync-tick' AND state = 'completed'`,
    );
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    const shared = await beatOf('managed-sync-tick');
    expect(shared).toBeDefined();
    expect((await beatOf('managed-sync-tick-pg-boss'))?.getTime()).toBe(shared!.getTime());
    expect(await beatOf('managed-sync-tick-trigger')).toBeUndefined();
  }, 180_000);
});

describe('real jobs, in their own processes', () => {
  it("a payload its schema refuses fails once, not retried: as Trigger.dev 4.8.8's TaskPayloadParsedError, skipped", async () => {
    await startWorker();
    const { runId } = await producer.enqueue('run-discovery', { tenantId: 'not-a-uuid' }, { serializeBy: randomUUID() });
    const s = await settled(runId!);
    expect(s.state).toBe('failed');
    expect(s.attempt).toBe(1);
    expect(s.output).toMatchObject({ name: 'ZodError' });
  });

  it('a real run-discovery against a source it cannot reach: completed, and the failure written on its row as app_user', async () => {
    await seedDiscovery({
      source: FOUND_SOURCE,
      target: FOUND_TARGET,
      sourceBox: FOUND_SOURCE_BOX,
      targetBox: FOUND_TARGET_BOX,
      mapping: FOUND_MAPPING,
      url: 'https://cloud.example.invalid/remote.php/dav',
      username: 'nobody',
      password: 'not-a-password',
    });
    await startWorker();
    const { runId } = await producer.enqueue(
      'run-discovery',
      { tenantId: TENANT, mappingId: FOUND_MAPPING, domains: ['file'] },
      { serializeBy: FOUND_MAPPING },
    );
    const s = await settled(runId!, 120_000);
    expect(s.state, JSON.stringify(s.output)).toBe('completed');
    expect(s.attempt).toBe(1);
    const outcomes = (s.output as { value: { outcomes: Array<{ domain: string; ok: boolean }> } }).value.outcomes;
    expect(outcomes).toMatchObject([{ domain: 'file', ok: false }]);
    // Written under row security, on app_user's pool, in the organisation's scope: read back as app_user.
    const app = new pg.Client({ connectionString: APP_URL });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.current_tenant', $1, true)", [TENANT]);
      const { rows } = await app.query<{ domain: string; error: string | null }>(
        'SELECT domain, last_error AS error FROM migration_discovery WHERE mapping_id = $1',
        [FOUND_MAPPING],
      );
      await app.query('COMMIT');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.domain).toBe('file');
      expect(rows[0]!.error).toBeTruthy();
    } finally {
      await app.end();
    }
  }, 180_000);

  it.skipIf(!NEXTCLOUD_URL || !NEXTCLOUD_USER || !NEXTCLOUD_PASSWORD)(
    "a real run-discovery against the harness's Nextcloud: completed, and its count written as app_user",
    async () => {
      await seedDiscovery({
        source: CLOUD_SOURCE,
        target: CLOUD_TARGET,
        sourceBox: CLOUD_SOURCE_BOX,
        targetBox: CLOUD_TARGET_BOX,
        mapping: CLOUD_MAPPING,
        url: NEXTCLOUD_URL!,
        username: NEXTCLOUD_USER!,
        password: NEXTCLOUD_PASSWORD!,
      });
      await startWorker();
      const { runId } = await producer.enqueue(
        'run-discovery',
        { tenantId: TENANT, mappingId: CLOUD_MAPPING, domains: ['file'] },
        { serializeBy: CLOUD_MAPPING },
      );
      const s = await settled(runId!, 300_000);
      expect(s.state, JSON.stringify(s.output)).toBe('completed');
      const outcomes = (s.output as { value: { outcomes: Array<{ domain: string; ok: boolean }> } }).value.outcomes;
      expect(outcomes).toEqual([{ domain: 'file', ok: true }]);
      const { rows } = await admin.query<{ error: string | null }>(
        'SELECT last_error AS error FROM migration_discovery WHERE mapping_id = $1 AND domain = $2',
        [CLOUD_MAPPING, 'file'],
      );
      expect(rows).toEqual([{ error: null }]);
    },
    360_000,
  );
});

describe('what a run asks of its runner, on pg-boss', () => {
  it("a cutover's final sync waits behind a pass already running on its migration, then settles with its output", async () => {
    await startWorker();
    const mapping = randomUUID();
    const first = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 4000 }, {
      serializeBy: mapping,
    });
    await until('the first pass to start', async () => (await attemptsOf(mapping)).length === 1, 30_000);
    const cutover = await producer.enqueue('run-cutover', { tenantId: TENANT, mappingId: mapping }, {});
    const done = await settled(cutover.runId!, 60_000);
    expect(done.state, JSON.stringify(done.output)).toBe('completed');
    const passes = await attemptsOf(mapping);
    expect(passes).toHaveLength(2);
    const [running, finalSync] = passes as [Attempt, Attempt];
    expect(running.run_id).toBe(first.runId);
    // Behind it, never beside it: started only once the first had finished.
    expect(finalSync.started_at.getTime()).toBeGreaterThanOrEqual(running.finished_at!.getTime());
    expect(finalSync.others_alive).toBe(0);
    const { settled: waited } = (done.output as { value: { settled: { ok: boolean; output: { runId: string } } } }).value;
    expect(waited).toMatchObject({ ok: true, output: { runId: finalSync.run_id, attempt: 1 } });
  }, 120_000);

  it("a cutover whose final sync outlives the cutover's own limit: the wait gives up first, and the cutover hears a pass not settled", async () => {
    // A cutover's limit of 30 s here; its pass holds a minute. On Trigger.dev the wait did not
    // count and the pass's own failure came back; here the wait stops short of the kill, so the
    // cutover's catch still runs (run-cutover.ts: FinalSyncNotFinished) instead of a RunTimedOut.
    await startWorker({ catalog: catalogOf(WORKED, { 'run-cutover': { maxDurationSeconds: 30 } }) });
    const mapping = randomUUID();
    await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 60_000 }, { serializeBy: mapping });
    await until('the pass ahead to start', async () => (await attemptsOf(mapping)).length === 1, 30_000);
    const cutover = await producer.enqueue('run-cutover', { tenantId: TENANT, mappingId: mapping }, {});
    const done = await settled(cutover.runId!, 60_000);
    expect(done.state, JSON.stringify(done.output)).toBe('completed');
    expect(done.attempt).toBe(1);
    const { settled: waited } = (done.output as { value: { settled: { ok: boolean; error: { name: string } } } }).value;
    expect(waited).toMatchObject({ ok: false, error: { name: 'FinalSyncTimedOut' } });
  }, 120_000);

  it("the purge's verdict: live while it waits or runs, finished once it ended or is gone, unknown for a Trigger.dev ref", async () => {
    await startWorker();
    const runner = pgBossRunner();
    try {
      const port: JobRunnerPort = runner.port;
      const mapping = randomUUID();
      const holding = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 3000 }, {
        serializeBy: mapping,
      });
      // A singleton key promises one at a time, not an order: the second is sent once the first runs.
      await until('the first pass to start', async () => (await attemptsOf(mapping)).length === 1, 30_000);
      const waiting = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping }, { serializeBy: mapping });
      expect(await port.verdict(holding.runId!)).toBe('live');
      expect(await port.verdict(waiting.runId!)).toBe('live');
      await settled(waiting.runId!);
      expect(await port.verdict(holding.runId!)).toBe('finished');
      expect(await port.verdict(waiting.runId!)).toBe('finished');
      expect(await port.verdict(randomUUID())).toBe('finished');
      expect(await port.verdict('run_cm0123456789abcdefghij')).toBe('unknown');
      await expect(port.cancel('run_cm0123456789abcdefghij')).rejects.toThrow(/not a pg-boss run's id/);
    } finally {
      await runner.close();
    }
  }, 120_000);
});

describe("a run's process", () => {
  it('killed by a SIGKILL the worker did not send: failed on its first attempt, not retried, as on Trigger.dev', async () => {
    // Trigger.dev 4.8.8 reads a task process killed by SIGKILL or SIGABRT as
    // TASK_PROCESS_MAYBE_OOM_KILLED, which it does not retry: the kernel's OOM
    // killer, once the container has a limit, or a person.
    await startWorker();
    const mapping = randomUUID();
    const { runId } = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 60_000 }, {
      serializeBy: mapping,
    });
    const [first] = await until('the first attempt to start', async () => {
      const a = await attemptsOf(mapping);
      return a.length === 1 ? a : null;
    }, 30_000);
    process.kill(first!.pid, 'SIGKILL');
    const s = await settled(runId!, 60_000);
    expect(s.state).toBe('failed');
    expect(s.attempt).toBe(1);
    await sleep(8_000);
    expect(await attemptsOf(mapping)).toHaveLength(1);
  }, 120_000);

  it('on a worker that dies mid-run: retried by the next worker once its claim lapses, never two on one key', async () => {
    const mapping = randomUUID();
    const dying = spawn(process.execPath, [WORKER_TO_KILL], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
    let said = '';
    dying.stdout.on('data', (d: Buffer) => (said += d.toString()));
    try {
      await until('the worker to kill to be working', async () => {
        if (dying.exitCode !== null) throw new Error(`the worker to kill exited ${dying.exitCode}:\n${said}`);
        return said.includes('[a-worker-to-kill] working');
      }, 60_000);
      await producerReady();
      const { runId } = await producer.enqueue(
        'run-delta-sync',
        { tenantId: TENANT, mappingId: mapping, holdMs: 60_000, holdOnAttempt: 1 },
        { serializeBy: mapping },
      );
      const [first] = await until('the first attempt to start', async () => {
        const a = await attemptsOf(mapping);
        return a.length === 1 ? a : null;
      }, 30_000);
      // The worker dies outright; its run's process follows it, as its IPC closes.
      dying.kill('SIGKILL');
      await until('the dead worker’s run process to be gone', async () => !alive(first!.pid), 10_000);
      await startWorker();
      const s = await settled(runId!, 90_000);
      expect(s.state).toBe('completed');
      expect(s.attempt).toBe(2);
      const attempts = await attemptsOf(mapping);
      expect(attempts.map((a) => [a.attempt, a.others_alive])).toEqual([
        [1, 0],
        [2, 0],
      ]);
    } finally {
      if (dying.exitCode === null) dying.kill('SIGKILL');
    }
  }, 180_000);

  it('past its time limit: killed before the next run on its key starts, and failed as timed out, not retried', async () => {
    // A limit of 12 s: the worker kills the run 1 s before pg-boss's own limit (killMarginSeconds).
    await startWorker({ catalog: catalogOf(WORKED, { 'run-delta-sync': { maxDurationSeconds: 12 } }) });
    const mapping = randomUUID();
    const hung = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 120_000 }, {
      serializeBy: mapping,
    });
    // A singleton key promises one at a time, not an order: the second is sent once the first runs.
    await until('the hung run to start', async () => (await attemptsOf(mapping)).length === 1, 30_000);
    const next = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping }, { serializeBy: mapping });
    const s = await settled(hung.runId!, 60_000);
    expect(s.state).toBe('failed');
    expect(s.attempt).toBe(1);
    expect(s.output).toMatchObject({ name: 'RunTimedOut' });
    expect((await settled(next.runId!, 60_000)).state).toBe('completed');
    const attempts = await attemptsOf(mapping);
    expect(attempts.map((a) => [a.run_id, a.attempt])).toEqual([
      [hung.runId, 1],
      [next.runId, 1],
    ]);
    // The second started with no other process on its key alive: never two writers on one migration.
    expect(attempts[1]!.others_alive).toBe(0);
    expect(alive(attempts[0]!.pid)).toBe(false);
  }, 120_000);

  it('cancelled: its process is killed within a heartbeat', async () => {
    await startWorker({ catalog: catalogOf(WORKED, { 'run-delta-sync': { heartbeatSeconds: 10 } }) });
    const mapping = randomUUID();
    const { runId } = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: mapping, holdMs: 120_000 }, {
      serializeBy: mapping,
    });
    const [first] = await until('the run to start', async () => {
      const a = await attemptsOf(mapping);
      return a.length === 1 ? a : null;
    }, 30_000);
    const asked = Date.now();
    expect(await producer.cancel(runId!)).toBe(true);
    await until('the cancelled run’s process to be gone', async () => !alive(first!.pid), 15_000);
    expect(Date.now() - asked).toBeLessThan(15_000);
    expect((await producer.status(runId!))?.state).toBe('cancelled');
    expect(await attemptsOf(mapping)).toHaveLength(1);
  }, 120_000);

  it('at a stop: a run that finishes within the grace completes; one that does not is killed, and retried by the next worker', async () => {
    // pg-boss's own stop waits grace and settle, 23 s, before it fails what is left: the worker's kill comes at 3 s.
    const worker = await startWorker({ stopGraceMs: 3000, stopSettleMs: 20_000 });
    const quick = randomUUID();
    const slow = randomUUID();
    const finishes = await producer.enqueue('run-delta-sync', { tenantId: TENANT, mappingId: quick, holdMs: 1000 }, {
      serializeBy: quick,
    });
    const outlives = await producer.enqueue(
      'run-delta-sync',
      { tenantId: TENANT, mappingId: slow, holdMs: 60_000, holdOnAttempt: 1 },
      { serializeBy: slow },
    );
    await until('both runs to start', async () => (await attemptsOf(quick)).length + (await attemptsOf(slow)).length === 2, 30_000);
    const [slowFirst] = await attemptsOf(slow);
    const stopping = Date.now();
    await worker.stop();
    expect(Date.now() - stopping).toBeGreaterThanOrEqual(2_900);
    expect(Date.now() - stopping).toBeLessThan(10_000);
    expect(alive(slowFirst!.pid)).toBe(false);
    expect((await producer.status(finishes.runId!))?.state).toBe('completed');
    expect((await producer.status(outlives.runId!))?.state).toBe('retrying');

    await startWorker();
    const s = await settled(outlives.runId!, 60_000);
    expect(s.state).toBe('completed');
    expect(s.attempt).toBe(2);
  }, 120_000);
});

describe("what a run's process holds in memory, for the worker's limit (0167, design point 8)", () => {
  /** Measured here and said in the pull request, against `(MAX_PASSES_IN_FLIGHT + 3) × 512 MB + 256 MB`. */
  const measured: Record<string, number> = {};
  afterAll(() => {
    process.stdout.write(`[memory] peak resident MB by queue: ${JSON.stringify(measured)}\n`);
  });

  it('a small job in its process: the tick, and a real count, each within a run’s 512 MB', async () => {
    await seedDiscovery({
      source: FOUND_SOURCE,
      target: FOUND_TARGET,
      sourceBox: FOUND_SOURCE_BOX,
      targetBox: FOUND_TARGET_BOX,
      mapping: FOUND_MAPPING,
      url: 'https://cloud.example.invalid/remote.php/dav',
      username: 'nobody',
      password: 'not-a-password',
    });
    await forgetSchedules();
    await startWorker({
      catalog: catalogOf(WORKED, { 'managed-sync-tick': { kind: 'on-demand' } as Partial<JobCatalogEntry> }),
    });
    const watch = watchRunMemory();
    const tick = await producer.enqueue('managed-sync-tick', {}, {});
    const count = await producer.enqueue(
      'run-discovery',
      { tenantId: TENANT, mappingId: FOUND_MAPPING, domains: ['file'] },
      { serializeBy: FOUND_MAPPING },
    );
    expect((await settled(tick.runId!, 120_000)).state).toBe('completed');
    expect((await settled(count.runId!, 120_000)).state).toBe('completed');
    const peaks = watch.stop();
    for (const queue of ['managed-sync-tick', 'run-discovery']) {
      expect(peaks.get(queue), `no sample of ${queue}'s process`).toBeGreaterThan(0);
      measured[queue] = Math.round(peaks.get(queue)!);
      expect(peaks.get(queue)!, queue).toBeLessThan(512);
    }
  }, 240_000);

  it('a real pass in its process, its module and pools loaded, within a run’s 512 MB', async () => {
    // A real pass over a source it cannot reach: everything a pass loads, and no copy. The
    // peak of a copy is the pass's own measurement on Trigger.dev's small-1x (0150): V8's
    // heap is capped at 410 MB here as it was there.
    await startWorker({ catalog: catalogOf(['run-delta-sync']), realPass: true });
    const watch = watchRunMemory();
    const { runId } = await producer.enqueue(
      'run-delta-sync',
      { tenantId: TENANT, mappingId: FOUND_MAPPING, domains: ['file'] },
      { serializeBy: FOUND_MAPPING },
    );
    await until(
      'the pass’s first attempt to end',
      async () => {
        const s = await producer.status(runId!);
        return s !== null && (s.state !== 'running' && s.state !== 'queued' ? s : null);
      },
      120_000,
    );
    await producer.cancel(runId!);
    const peaks = watch.stop();
    expect(peaks.get('run-delta-sync'), "no sample of the pass's process").toBeGreaterThan(0);
    measured['run-delta-sync'] = Math.round(peaks.get('run-delta-sync')!);
    expect(peaks.get('run-delta-sync')!).toBeLessThan(512);
  }, 240_000);
});

describe("the tick's interlock across runners, its pg-boss half", () => {
  /** A runner port that records what the tick asks of it, named as either runner. */
  function recordingPort(name: 'trigger' | 'pg-boss'): { port: JobRunnerPort; enqueued: string[] } {
    const enqueued: string[] = [];
    return {
      enqueued,
      port: {
        name,
        enqueue: async (_queue, payload) => {
          enqueued.push(payload.mappingId);
          return { runId: randomUUID() };
        },
        enqueueAndWait: () => Promise.reject(new Error('the tick does not wait')),
        verdict: () => Promise.reject(new Error('the tick does not ask')),
        cancel: () => Promise.reject(new Error('the tick does not cancel')),
      },
    };
  }

  type TickRun = (payload: unknown, context: JobRunContext) => Promise<Record<string, unknown>>;
  let tick: TickRun;
  beforeAll(async () => {
    // Imported once its environment is set: it opens its pools as the system role when imported.
    tick = (await import('../jobs/managed-sync-tick.ts')).managedSyncTickRun as TickRun;
  }, 60_000);

  it("holds under the other runner's own beat: starts nothing, beats as pg-boss alone, the shared beat left", async () => {
    await forgetBeats();
    await beat('managed-sync-tick', 5);
    await beat('managed-sync-tick-trigger', 5);
    const shared = await beatOf('managed-sync-tick');
    const { port, enqueued } = recordingPort('pg-boss');
    const summary = await tick({}, { runner: port });
    expect(summary).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
    expect(enqueued).toEqual([]);
    expect((await beatOf('managed-sync-tick'))?.getTime()).toBe(shared!.getTime());
    expect((await beatOf('managed-sync-tick-pg-boss'))!.getTime()).toBeGreaterThan(shared!.getTime());
  });

  it('holds under a shared beat that differs from its own, newer here, which a Trigger.dev tick from before the interlock wrote', async () => {
    await forgetBeats();
    await beat('managed-sync-tick-pg-boss', 60);
    await beat('managed-sync-tick', 10);
    const { port, enqueued } = recordingPort('pg-boss');
    expect(await tick({}, { runner: port })).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
    expect(enqueued).toEqual([]);
    // And with no beat of its own yet: the first pg-boss tick beside a running alpha.15 plane.
    await forgetBeats();
    await beat('managed-sync-tick', 10);
    expect(await tick({}, { runner: port })).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
    expect(enqueued).toEqual([]);
  });

  it('beside a Trigger.dev tick from before the interlock, in either order from minute to minute, never starts a pass', async () => {
    // alpha.14's and alpha.15's tick writes the shared beat and nothing else. The two ticks'
    // order within a minute is jitter, so the pg-boss tick sometimes reads a shared beat that
    // is older than its own hold: it must hold then too (the review of #2048).
    await forgetBeats();
    const oldTick = () => beat('managed-sync-tick');
    const { port, enqueued } = recordingPort('pg-boss');
    const pgBossTick = async (): Promise<void> => {
      expect(await tick({}, { runner: port })).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
    };
    // Minute 1: the old tick first; minute 2: the pg-boss tick first, 35 ms after its hold; and so on.
    await oldTick();
    await pgBossTick();
    await sleep(35);
    await pgBossTick();
    await oldTick();
    await pgBossTick();
    await sleep(35);
    await pgBossTick();
    expect(enqueued).toEqual([]);
    // The shared beat is the old tick's alone: two runners read as a stopped tick only if neither writes it.
    expect((await beatOf('managed-sync-tick-pg-boss'))!.getTime()).toBeGreaterThan((await beatOf('managed-sync-tick'))!.getTime());
  });

  it('runs under a shared beat it wrote itself, or one older than 90 s, and writes both at one time', async () => {
    for (const [own, shared] of [
      [20, 20],
      [200, 100],
    ] as const) {
      await forgetBeats();
      await admin.query(
        `INSERT INTO sync_tick_beat (task, beat_at) VALUES
           ('managed-sync-tick', now() - ($1::int * interval '1 second')),
           ('managed-sync-tick-pg-boss', now() - ($2::int * interval '1 second'))`,
        [shared, own],
      );
      if (own === shared) {
        // One moment for both, as the tick writes them.
        await admin.query(
          "UPDATE sync_tick_beat SET beat_at = (SELECT beat_at FROM sync_tick_beat WHERE task = 'managed-sync-tick') WHERE task = 'managed-sync-tick-pg-boss'",
        );
      }
      const before = (await beatOf('managed-sync-tick'))!.getTime();
      const { port } = recordingPort('pg-boss');
      const summary = await tick({}, { runner: port });
      expect(summary.anotherRunner, `own ${own} s, shared ${shared} s ago`).toBeUndefined();
      const after = (await beatOf('managed-sync-tick'))!.getTime();
      expect(after).toBeGreaterThan(before);
      expect((await beatOf('managed-sync-tick-pg-boss'))!.getTime()).toBe(after);
    }
  });

  it('two runners left running start nothing, and nobody writes the shared beat', async () => {
    await forgetBeats();
    await beat('managed-sync-tick', 200);
    const shared = await beatOf('managed-sync-tick');
    const onTrigger = recordingPort('trigger');
    const onPgBoss = recordingPort('pg-boss');
    // Trigger.dev's tick runs first and writes both of its beats.
    const first = await tick({}, { runner: onTrigger.port });
    expect(first.anotherRunner).toBeUndefined();
    // Then they alternate, as two schedules on one minute do.
    for (let i = 0; i < 2; i++) {
      expect(await tick({}, { runner: onPgBoss.port })).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
      expect(await tick({}, { runner: onTrigger.port })).toMatchObject({ anotherRunner: 'pg-boss', triggered: 0 });
    }
    expect(onPgBoss.enqueued).toEqual([]);
    const sharedAfterFirst = await beatOf('managed-sync-tick');
    expect(sharedAfterFirst!.getTime()).toBeGreaterThan(shared!.getTime());
    // Since the first tick, nobody: the status page's Scheduled syncs goes red.
    expect((await beatOf('managed-sync-tick-pg-boss'))!.getTime()).toBeGreaterThan(sharedAfterFirst!.getTime());
    expect((await beatOf('managed-sync-tick-trigger'))!.getTime()).toBeGreaterThan(sharedAfterFirst!.getTime());
  });

  it("the pg-boss tick in its own process, under the worker, holds under a shared beat somebody else wrote", async () => {
    await forgetBeats();
    await beat('managed-sync-tick', 5);
    // Enqueued here, not on the minute: the schedule is taken away for this one, so the queue's one waiting run is this.
    await forgetSchedules();
    await startWorker({
      catalog: catalogOf(['managed-sync-tick', 'run-delta-sync'], {
        'managed-sync-tick': { kind: 'on-demand' } as Partial<JobCatalogEntry>,
      }),
    });
    const { runId } = await producer.enqueue('managed-sync-tick', {}, {});
    const s = await settled(runId!, 60_000);
    expect(s.state).toBe('completed');
    expect((s.output as { value: Record<string, unknown> }).value).toMatchObject({ anotherRunner: 'trigger', triggered: 0 });
  }, 120_000);
});
