// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE JOB RUNNER, AGAINST A REAL POSTGRES (ADR-0054, workplan 0167 §3).
 *
 * One `describe` per point the runner was proved on, numbered as the workplan
 * numbers them, and one for the schema version it refuses. Handed its
 * database as `TEST_DATABASE_URL` (the Testcontainers harness, or
 * `scripts/local-pg.sh`); the jobs run as a role of their own, provisioned
 * here, with no superuser rights and nothing outside its schema.
 *
 * Then one `describe` per production gap T5 closed (E2 to E8 in the
 * coordinator's plan): the producer, status and cancel by id, the run's own
 * time limit and lost claim, names that decide a retry, and the bounded
 * failures read.
 *
 * Point 7's PgBouncer half is this same file run with `TEST_DATABASE_URL`
 * pointing at a PgBouncer in transaction mode: every test then talks to
 * Postgres through it. The workplan records both runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  PgBossJobRunner,
  PgBossProducer,
  RunNotRetried,
  recentFailuresSql,
  type QueueSpec,
  type RunStatus,
} from './job-runner.ts';
import { ChildRunDied, runInChild } from './run-in-child.ts';
import { copyPass, prepareCopyTables, type CopyPassPayload } from './__testing__/copy-pass.ts';
import { prepareKeyHolderTable, type KeyHolderPayload } from './__testing__/key-holder-table.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run under the Testcontainers harness or scripts/local-pg.sh.');
}

/** Fixed, so a PgBouncer userlist can name it; the schema is fresh per run. */
const ROLE = 'ownpace_jobs_test';
const SCHEMA = `jobs_test_${randomBytes(4).toString('hex')}`;
const PASSWORD = randomBytes(18).toString('base64url');

function urlAs(user: string, password: string): string {
  const u = new URL(ADMIN_URL!);
  u.username = user;
  u.password = password;
  return u.toString();
}
const JOBS_URL = urlAs(ROLE, PASSWORD);

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
let jobsPool: pg.Pool;
let rlsBefore: Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;
let extensionsBefore: string[];
const EXTENSIONS = 'SELECT extname FROM pg_extension ORDER BY 1';
const runners: Array<PgBossJobRunner | PgBossProducer> = [];

function newRunner(): PgBossJobRunner {
  const r = new PgBossJobRunner({
    connectionString: JOBS_URL,
    schema: SCHEMA,
    pollingIntervalSeconds: 0.5,
    monitorIntervalSeconds: 1,
    superviseIntervalSeconds: 1,
    cronWorkerIntervalSeconds: 1,
  });
  runners.push(r);
  return r;
}

function newProducer(queues: readonly QueueSpec[], schema = SCHEMA): PgBossProducer {
  const p = new PgBossProducer({ connectionString: JOBS_URL, schema }, queues);
  runners.push(p);
  return p;
}

/** Read by the run's id alone, as `orchestrator_ref` holds it (E3); `queue` only names the wait. */
async function settled(
  r: PgBossJobRunner | PgBossProducer,
  queue: string,
  runId: string,
  timeoutMs = 60_000,
): Promise<RunStatus> {
  return until(
    `run ${runId} on ${queue} to settle`,
    async () => {
      const s = await r.status(runId);
      if (s) expect(s.queue).toBe(queue);
      return s && ['completed', 'failed', 'cancelled'].includes(s.state) ? s : null;
    },
    timeoutMs,
  );
}

const RLS_SNAPSHOT = `
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  rlsBefore = (await admin.query(RLS_SNAPSHOT)).rows;
  extensionsBefore = (await admin.query(EXTENSIONS)).rows.map((e: { extname: string }) => e.extname);
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  const verb = exists.rowCount ? 'ALTER' : 'CREATE';
  await admin.query(
    `${verb} ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${PASSWORD}'`,
  );
  await admin.query(`CREATE SCHEMA ${SCHEMA} AUTHORIZATION ${ROLE}`);
  jobsPool = new pg.Pool({ connectionString: JOBS_URL, max: 4 });
  await prepareCopyTables(jobsPool, SCHEMA);
  await prepareKeyHolderTable(jobsPool, SCHEMA);
});

afterAll(async () => {
  for (const r of runners) await r.stop({ graceful: false }).catch(() => undefined);
  await jobsPool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  }
});

describe('point 7a: the jobs role is not a superuser and reaches nothing of the ledger', () => {
  it('installs pg-boss as a plain role, inside its own schema, needing no extension', async () => {
    const r = newRunner();
    await r.start([{ name: 'p7-probe', policy: 'standard' }]);
    const role = (
      await admin.query(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
                has_database_privilege($1, current_database(), 'CREATE') AS can_create_schema
         FROM pg_roles WHERE rolname = $1`,
        [ROLE],
      )
    ).rows[0];
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      can_create_schema: false,
    });
    const outside = await admin.query(
      `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
         AND n.nspname NOT IN ($2, 'pg_toast')`,
      [ROLE, SCHEMA],
    );
    expect(outside.rows).toEqual([]);
    const readable = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege($1, c.oid, 'SELECT')`,
      [ROLE],
    );
    expect(readable.rows).toEqual([]);
    // pg-boss installed no extension (it could not have: the role may not).
    expect((await admin.query(EXTENSIONS)).rows.map((e: { extname: string }) => e.extname)).toEqual(extensionsBefore);
    const objects = await admin.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`, [SCHEMA]);
    expect(objects.rows[0].n).toBeGreaterThan(0);
    await r.stop();
  });
});

describe('point 1: a tick racing a manual start still runs one pass per mapping', () => {
  it('serializes per mapping across two workers, while two mappings run side by side', async () => {
    const queue = 'p1-delta-sync';
    const spec = [{ name: queue, policy: 'singleton' as const, heartbeatSeconds: 10 }];
    const a = newRunner();
    const b = newRunner();
    await a.start(spec);
    await b.start(spec);
    const active = new Map<string, number>();
    const maxActive = new Map<string, number>();
    let globalActive = 0;
    let globalMax = 0;
    const handler = async (p: { mappingId: string }): Promise<string> => {
      const now = (active.get(p.mappingId) ?? 0) + 1;
      active.set(p.mappingId, now);
      maxActive.set(p.mappingId, Math.max(maxActive.get(p.mappingId) ?? 0, now));
      globalActive++;
      globalMax = Math.max(globalMax, globalActive);
      await sleep(1200);
      active.set(p.mappingId, (active.get(p.mappingId) ?? 1) - 1);
      globalActive--;
      return p.mappingId;
    };
    await a.work(queue, handler, { concurrency: 4 });
    await b.work(queue, handler, { concurrency: 4 });

    // Six enqueues for m1 at once: the minute's tick and a Start pressed in the
    // same instant, three times over, from both "API" and "tick" sides.
    const m1 = Array.from({ length: 6 }, (_, i) =>
      (i % 2 ? a : b).enqueue(queue, { mappingId: 'm1' }, { serializeBy: 'm1', tags: ['mapping:m1', i % 2 ? 'manual' : 'tick'] }),
    );
    const m2 = Array.from({ length: 2 }, () => a.enqueue(queue, { mappingId: 'm2' }, { serializeBy: 'm2' }));
    const ids = (await Promise.all([...m1, ...m2])).map((e) => e.runId!);
    const finals = await Promise.all(ids.map((id) => settled(a, queue, id, 90_000)));

    expect(finals.map((s) => s.state)).toEqual(Array(8).fill('completed'));
    expect(maxActive.get('m1')).toBe(1);
    expect(maxActive.get('m2')).toBe(1);
    expect(globalMax).toBeGreaterThanOrEqual(2);
    const m1Runs = finals.slice(0, 6).sort((x, y) => x.startedAt!.getTime() - y.startedAt!.getTime());
    for (let i = 1; i < m1Runs.length; i++) {
      expect(m1Runs[i]!.startedAt!.getTime()).toBeGreaterThanOrEqual(m1Runs[i - 1]!.completedAt!.getTime());
    }
    await a.stop();
    await b.stop();
  }, 120_000);
});

describe('point 2: a pass killed with SIGKILL is picked up again and converges', () => {
  it('leaves exactly one row per item and two attempts, the second on another process', async () => {
    const queue = 'p2-delta-sync';
    const mappingId = `m-kill-${randomBytes(3).toString('hex')}`;
    const items = 40;
    const worker: ChildProcess = fork(
      fileURLToPath(new URL('./__testing__/worker-to-kill.ts', import.meta.url)),
      [JOBS_URL, SCHEMA, queue],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
    );
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('exit', (code) => reject(new Error(`The worker exited early with code ${String(code)}.`)));
    });
    const enqueuer = newRunner();
    await enqueuer.start([{ name: queue, policy: 'singleton', heartbeatSeconds: 10, retryDelaySeconds: 1 }]);
    const { runId } = await enqueuer.enqueue<CopyPassPayload>(queue, { mappingId, items, stepMs: 200 }, { serializeBy: mappingId });

    const count = async (): Promise<number> =>
      Number((await jobsPool.query(`SELECT count(*) FROM ${SCHEMA}.copied_item WHERE mapping_id = $1`, [mappingId])).rows[0].count);
    await until('the pass to be part-way', async () => (await count()) >= 10, 30_000);
    worker.kill('SIGKILL');
    await new Promise((r) => worker.once('exit', r));
    const atKill = await count();
    expect(atKill).toBeLessThan(items);
    expect((await enqueuer.status(queue, runId!))?.state).toBe('running');

    const killedAt = Date.now();
    await enqueuer.work<CopyPassPayload, { copied: number }>(queue, (p, ctx) => copyPass(jobsPool, SCHEMA, p, ctx));
    const final = await settled(enqueuer, queue, runId!, 90_000);

    expect(final.state).toBe('completed');
    expect(final.attempt).toBe(2);
    expect(await count()).toBe(items);
    const attempts = (
      await jobsPool.query(`SELECT attempt, pid FROM ${SCHEMA}.pass_attempt WHERE run_id = $1 ORDER BY at`, [runId])
    ).rows as Array<{ attempt: number; pid: number }>;
    expect(attempts.map((x) => x.attempt)).toEqual([1, 2]);
    expect(attempts[0]!.pid).toBe(worker.pid);
    expect(attempts[1]!.pid).toBe(process.pid);
    // The second attempt copied only what the first had not.
    expect((final.output as { value: { copied: number } }).value.copied).toBe(items - atKill);
    // Picked up within the heartbeat window (10 s) plus the sweep and the retry
    // delay, not at the run's one-hour expiry.
    const recoveredInMs = Date.now() - killedAt;
    console.log(`[point 2] killed at item ${atKill} of ${items}; settled ${recoveredInMs} ms after the kill`);
    expect(recoveredInMs).toBeLessThan(30_000);
    await enqueuer.stop();
  }, 150_000);
});

describe('point 3: a cancel reaches a running pass within one heartbeat', () => {
  it('aborts the handler signal and records the run as cancelled', async () => {
    const queue = 'p3-cancel';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'standard', heartbeatSeconds: 10 }]);
    let started = false;
    let abortedAt = 0;
    await r.work(queue, async (_p, ctx) => {
      started = true;
      await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
      abortedAt = Date.now();
      return 'stopped';
    });
    const { runId } = await r.enqueue(queue, {});
    await until('the run to start', async () => started, 20_000);
    const cancelledAt = Date.now();
    expect(await r.cancel(runId!)).toBe(true);
    await until('the handler to see the abort', async () => abortedAt > 0, 20_000);
    expect(abortedAt - cancelledAt).toBeLessThan(10_000);
    expect((await r.status(runId!))?.state).toBe('cancelled');
    await r.stop();
  }, 60_000);
});

describe("point 4: discovery's join window keeps its semantics", () => {
  it('joins the same count within the window, starts a new one after it, and queues a different count', async () => {
    const queue = 'p4-run-discovery';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'singleton', heartbeatSeconds: 10 }]);
    await r.work(queue, async () => {
      await sleep(1500);
      return 'counted';
    }, { concurrency: 4 });
    const key = 'discovery:m4:2026-11-22T12:00:00.000Z:its-own';
    const asks = await Promise.all(
      Array.from({ length: 10 }, () =>
        r.enqueue(queue, { mappingId: 'm4' }, { serializeBy: 'm4', idempotency: { key, ttlSeconds: 6 } }),
      ),
    );
    const distinct = new Set(asks.map((x) => x.runId));
    expect(distinct.size).toBe(1);
    expect(asks.filter((x) => x.joined)).toHaveLength(9);
    const first = asks[0]!.runId!;

    // A count that genuinely differs (the migration was edited) is a new run,
    // and the two never run at once. Which goes first is not promised: a
    // `singleton` queue limits a key to one active run, it does not keep the
    // key's runs in order (`key_strict_fifo` would, at a cost the workplan notes).
    const other = await r.enqueue(
      queue,
      { mappingId: 'm4' },
      { serializeBy: 'm4', idempotency: { key: `${key}:edited`, ttlSeconds: 6 }, tags: ['mapping:m4'] },
    );
    expect(other.joined).toBe(false);
    const firstDone = await settled(r, queue, first);
    const otherDone = await settled(r, queue, other.runId!);
    const [earlier, later_] = [firstDone, otherDone].sort((x, y) => x.startedAt!.getTime() - y.startedAt!.getTime());
    expect(later_!.startedAt!.getTime()).toBeGreaterThanOrEqual(earlier!.completedAt!.getTime());

    // Finished but inside the window: a reload still joins it.
    const reload = await r.enqueue(queue, { mappingId: 'm4' }, { serializeBy: 'm4', idempotency: { key, ttlSeconds: 6 } });
    expect(reload).toEqual({ runId: first, joined: true });

    // Past the window, measured from that run's creation: a new count.
    await until(
      'the window to pass',
      async () => Date.now() - (await r.status(queue, first))!.createdAt.getTime() > 6_500,
      20_000,
    );
    const later = await r.enqueue(queue, { mappingId: 'm4' }, { serializeBy: 'm4', idempotency: { key, ttlSeconds: 6 } });
    expect(later.joined).toBe(false);
    expect(later.runId).not.toBe(first);
    await settled(r, queue, later.runId!);
    await r.stop();
  }, 90_000);
});

describe("point 5: cutover waits for its final sync without an await primitive", () => {
  it('waits behind the pass already running, then hands back the child result or its failure verbatim', async () => {
    const delta = 'p5-delta-sync';
    const cutover = 'p5-run-cutover';
    const r = newRunner();
    await r.start([
      { name: delta, policy: 'singleton', heartbeatSeconds: 10, retryDelaySeconds: 1 },
      { name: cutover, policy: 'standard', heartbeatSeconds: 10 },
    ]);
    const attemptsSeen = new Map<string, number>();
    await r.work<{ mappingId: string; how: 'slow' | 'ok' | 'refuse' | 'flaky' }, string>(
      delta,
      async (p, ctx) => {
        attemptsSeen.set(`${p.mappingId}:${p.how}`, ctx.attempt);
        if (p.how === 'slow') await sleep(2500);
        if (p.how === 'refuse') throw new RunNotRetried('The source refused the final sync: quota exhausted for today.');
        if (p.how === 'flaky' && ctx.attempt < 3) throw new Error(`transient failure on attempt ${ctx.attempt}`);
        return `synced ${p.mappingId}`;
      },
      { concurrency: 4 },
    );
    await r.work<{ mappingId: string; how: 'ok' | 'refuse' | 'flaky' }, unknown>(
      cutover,
      async (p, ctx) =>
        r.enqueueAndWait(delta, { mappingId: p.mappingId, how: p.how }, {
          serializeBy: p.mappingId,
          tags: [`mapping:${p.mappingId}`, 'cutover-final-sync'],
          pollMs: 300,
          signal: ctx.signal,
        }),
      { concurrency: 4 },
    );

    const blocker = await r.enqueue(delta, { mappingId: 'm5', how: 'slow' }, { serializeBy: 'm5' });
    await until('the scheduled pass to be running', async () => (await r.status(delta, blocker.runId!))?.state === 'running', 20_000);
    const ok = await r.enqueue(cutover, { mappingId: 'm5', how: 'ok' });
    const okDone = await settled(r, cutover, ok.runId!);
    const blockerDone = await settled(r, delta, blocker.runId!);
    const outcome = (okDone.output as { value: { ok: boolean; runId: string; output: string } }).value;
    expect(outcome.ok).toBe(true);
    expect(outcome.output).toBe('synced m5');
    const child = (await r.status(delta, outcome.runId))!;
    expect(child.startedAt!.getTime()).toBeGreaterThanOrEqual(blockerDone.completedAt!.getTime());
    expect(child.tags).toEqual(['mapping:m5', 'cutover-final-sync']);

    const refused = await r.enqueue(cutover, { mappingId: 'm5b', how: 'refuse' });
    const refusedOutcome = ((await settled(r, cutover, refused.runId!)).output as {
      value: { ok: boolean; state: string; error: { name: string; message: string } };
    }).value;
    expect(refusedOutcome).toMatchObject({
      ok: false,
      state: 'failed',
      error: { name: 'RunNotRetried', message: 'The source refused the final sync: quota exhausted for today.' },
    });
    // Not retried: one attempt, whatever the queue's three allow.
    expect(attemptsSeen.get('m5b:refuse')).toBe(1);

    const flaky = await r.enqueue(cutover, { mappingId: 'm5c', how: 'flaky' });
    const flakyOutcome = ((await settled(r, cutover, flaky.runId!, 90_000)).output as { value: { ok: boolean } }).value;
    expect(flakyOutcome.ok).toBe(true);
    expect(attemptsSeen.get('m5c:flaky')).toBe(3);
    await r.stop();
  }, 150_000);
});

describe('point 6: the every-minute tick never overlaps itself', () => {
  it('keeps one tick running and at most one waiting, and the cron schedule fires it', async () => {
    const queue = 'p6-managed-sync-tick';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'stately', heartbeatSeconds: 10 }]);
    let running = 0;
    let maxRunning = 0;
    const fired: Array<{ fromCron: boolean }> = [];
    await r.work<{ fromCron?: boolean }, null>(queue, async (p) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      fired.push({ fromCron: p?.fromCron === true });
      await sleep(2500);
      running--;
      return null;
    }, { concurrency: 4 });

    // Six ticks offered in a burst, as a clock catching up would.
    const offers = [];
    for (let i = 0; i < 6; i++) {
      offers.push(await r.enqueue(queue, { fromCron: false }));
      await sleep(100);
    }
    const accepted = offers.filter((o) => o.runId !== null);
    expect(accepted.length).toBeLessThanOrEqual(2);
    for (const o of accepted) await settled(r, queue, o.runId!);

    await r.schedule(queue, '* * * * *', { fromCron: true });
    await until('the cron schedule to fire', async () => fired.some((f) => f.fromCron), 80_000);
    await until('the cron tick to finish', async () => running === 0, 20_000);
    await r.unschedule(queue);
    expect(maxRunning).toBe(1);
    await r.stop();
  }, 150_000);
});

describe('point 8: a runaway pass dies alone, and the worker goes on', () => {
  it('fails the runaway run after its attempts, then completes the next run on the same worker', async () => {
    const queue = 'p8-pass';
    const fixture = new URL('./__testing__/forked-passes.ts', import.meta.url).href;
    const r = newRunner();
    await r.start([{ name: queue, policy: 'standard', heartbeatSeconds: 10, attempts: 2, retryDelaySeconds: 1 }]);
    await r.work<{ call: string; items?: number }, unknown>(queue, (p, ctx) =>
      runInChild(fixture, p, { maxOldSpaceMb: 64, call: p.call, signal: ctx.signal }),
    );
    const bad = await r.enqueue(queue, { call: 'runaway' });
    const badDone = await settled(r, queue, bad.runId!, 90_000);
    expect(badDone.state).toBe('failed');
    expect(badDone.attempt).toBe(2);
    expect(badDone.output).toMatchObject({ name: ChildRunDied.name });
    expect((badDone.output as { message: string }).message).toMatch(/heap/i);

    const good = await r.enqueue(queue, { call: 'behaves', items: 3 });
    const goodDone = await settled(r, queue, good.runId!);
    expect(goodDone.state).toBe('completed');
    expect(goodDone.output).toEqual({ value: { copied: 3 } });
    await r.stop();
  }, 120_000);
});

describe('point 9 and 7b: what an operator can see, and what the runner left untouched', () => {
  it('lists queued, running and failed work per queue, with failures verbatim', async () => {
    const queue = 'p9-ops';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'singleton', heartbeatSeconds: 10, attempts: 1 }]);
    const release: Array<() => void> = [];
    await r.work<{ how: string }, string>(queue, async (p) => {
      if (p.how === 'fail') throw new Error('Graph answered 403 for the shared mailbox: the app has no Mail.Read on it.');
      await new Promise<void>((resolve) => release.push(resolve));
      return 'done';
    }, { concurrency: 4 });
    const failing = await r.enqueue(queue, { how: 'fail' }, { serializeBy: 'm9-a', tags: ['tenant:t9', 'mapping:m9-a'] });
    await settled(r, queue, failing.runId!);
    await r.enqueue(queue, { how: 'hold' }, { serializeBy: 'm9-b' });
    await r.enqueue(queue, { how: 'hold' }, { serializeBy: 'm9-b' });
    await until('one held run to be running', async () => release.length === 1, 20_000);
    await sleep(1500); // the queue's counters are refreshed by the monitor sweep

    const view = await until(
      'the overview to show the held and failed runs',
      async () => {
        const o = (await r.overview()).find((q) => q.queue === queue);
        return o && o.active === 1 && o.queued === 1 && o.failed === 1 ? o : null;
      },
      20_000,
    );
    expect(view).toMatchObject({ queue, policy: 'singleton', active: 1, queued: 1, failed: 1 });
    expect(view.activeKeys).toEqual(['m9-b']);
    const failures = await r.recentFailures(queue);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      runId: failing.runId,
      attempt: 1,
      tags: ['tenant:t9', 'mapping:m9-a'],
      error: { name: 'Error', message: 'Graph answered 403 for the shared mailbox: the app has no Mail.Read on it.' },
    });
    while (release.length) release.shift()!();
    await until('the held runs to finish', async () => {
      const o = (await r.overview()).find((q) => q.queue === queue);
      if (o && o.active === 0 && o.queued === 0) return true;
      while (release.length) release.shift()!();
      return false;
    }, 30_000);
    await r.stop();
  }, 90_000);

  it('left row security on the ledger exactly as it found it', async () => {
    expect((await admin.query(RLS_SNAPSHOT)).rows).toEqual(rlsBefore);
    expect(rlsBefore.filter((t) => t.relrowsecurity).length).toBeGreaterThan(0);
  });
});

describe('the jobs schema is the version the runner was proved on', () => {
  it('refuses a schema a later pg-boss migrated further, names both versions, and takes no work', async () => {
    const queue = 'v-probe';
    const first = newRunner();
    await first.start([{ name: queue, policy: 'standard' }]);
    await first.stop();
    // What a later release's migration leaves: pg-boss's own version row,
    // moved on (pg-boss writes it the same way, `plans.setVersion`).
    const { rows } = await jobsPool.query<{ version: number }>(`SELECT version FROM ${SCHEMA}.version`);
    const proved = Number(rows[0]!.version);
    await jobsPool.query(`UPDATE ${SCHEMA}.version SET version = $1`, [proved + 1]);
    try {
      const later = newRunner();
      await expect(later.start([{ name: queue, policy: 'standard' }])).rejects.toThrow(
        `"${SCHEMA}" is at pg-boss schema version ${proved + 1}, and this runner was proved on version ${proved} only`,
      );
      // Refused before any queue was declared, so it takes no work.
      await expect(later.enqueue(queue, {})).rejects.toThrow('was not declared');
      await later.stop();
      // A producer refuses it too, and never migrates it either way.
      const producer = newProducer([{ name: queue, policy: 'standard' }]);
      await expect(producer.start()).rejects.toThrow(`is not at pg-boss schema version ${proved}`);
      expect(Number((await jobsPool.query(`SELECT version FROM ${SCHEMA}.version`)).rows[0].version)).toBe(proved + 1);
      await producer.stop();
    } finally {
      await jobsPool.query(`UPDATE ${SCHEMA}.version SET version = $1`, [proved]);
    }
  }, 60_000);
});

const FORKED = new URL('./__testing__/forked-passes.ts', import.meta.url).href;
const KEY_HOLDER = new URL('./__testing__/key-holder.ts', import.meta.url).href;

async function jobCount(queue: string): Promise<number> {
  const { rows } = await jobsPool.query<{ n: string }>(`SELECT count(*) AS n FROM ${SCHEMA}.job WHERE name = $1`, [queue]);
  return Number(rows[0]!.n);
}

async function queueExists(schema: string, queue: string): Promise<boolean> {
  const { rows } = await admin.query(`SELECT 1 FROM ${schema}.queue WHERE name = $1`, [queue]);
  return rows.length > 0;
}

describe('E2: a producer enqueues, and never migrates, supervises, schedules or makes a queue', () => {
  it('refuses a jobs schema the worker never installed, and leaves it empty', async () => {
    const bare = `${SCHEMA}_bare`;
    await admin.query(`CREATE SCHEMA ${bare} AUTHORIZATION ${ROLE}`);
    try {
      const p = newProducer([{ name: 'e2-bare', policy: 'standard' }], bare);
      await expect(p.start()).rejects.toThrow(`The jobs schema "${bare}" is not at pg-boss schema version`);
      await p.stop();
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`, [bare]);
      expect(rows[0].n).toBe(0);
    } finally {
      await admin.query(`DROP SCHEMA ${bare} CASCADE`);
    }
  }, 30_000);

  it('fails to enqueue to a queue the worker has not made, by name, and makes none', async () => {
    // The schema is installed: point 7a's worker did it.
    const p = newProducer([{ name: 'e2-never-made', policy: 'singleton' }]);
    await p.start();
    await expect(p.enqueue('e2-never-made', { mappingId: 'm' }, { serializeBy: 'm' })).rejects.toThrow(
      `The queue "e2-never-made" does not exist in the jobs schema "${SCHEMA}". The worker creates every queue when it starts`,
    );
    await expect(
      p.enqueue('e2-never-made', { mappingId: 'm' }, { idempotency: { key: 'k', ttlSeconds: 60 } }),
    ).rejects.toThrow('does not exist in the jobs schema');
    expect(await queueExists(SCHEMA, 'e2-never-made')).toBe(false);
    await expect(p.enqueue('e2-undeclared', {})).rejects.toThrow('was not declared');
    await p.stop();
  }, 30_000);

  it("enqueues with the queue's spec from its constructor, and the worker's run is the producer's to read and join", async () => {
    const queue = 'e2-made';
    const spec: QueueSpec = { name: queue, policy: 'singleton', heartbeatSeconds: 10, attempts: 1 };
    const worker = newRunner();
    await worker.start([spec]);
    const release: Array<() => void> = [];
    await worker.work<{ n: number }, number>(queue, async (p) => {
      await new Promise<void>((resolve) => release.push(resolve));
      return p.n * 2;
    }, { concurrency: 2 });
    const p = newProducer([spec]);
    await p.start();
    const first = await p.enqueue(queue, { n: 21 }, { serializeBy: 'm-e2', tags: ['mapping:m-e2'], idempotency: { key: 'k-e2', ttlSeconds: 60 } });
    const joined = await p.enqueue(queue, { n: 21 }, { serializeBy: 'm-e2', idempotency: { key: 'k-e2', ttlSeconds: 60 } });
    expect(joined).toEqual({ runId: first.runId, joined: true });
    const second = await p.enqueue(queue, { n: 1 }, { serializeBy: 'm-e2' });
    await until('one run of the key to be running', async () => release.length === 1, 20_000);
    await sleep(1500);
    // The per-key limit came from the producer's spec: one active, the other waiting.
    expect((await p.status(second.runId!))?.state).toBe('queued');
    while (release.length) release.shift()!();
    const a = await until('both to finish', async () => {
      while (release.length) release.shift()!();
      const [x, y] = [await p.status(first.runId!), await p.status(second.runId!)];
      return x?.state === 'completed' && y?.state === 'completed' ? x : null;
    }, 30_000);
    expect(a).toMatchObject({ queue, output: { value: 42 }, tags: ['mapping:m-e2'] });
    await p.stop();
    await worker.stop();
  }, 60_000);

  it('fires no schedule, even one that is due every second, while the worker is stopped', async () => {
    const queue = 'e2-cron';
    const spec: QueueSpec = { name: queue, policy: 'stately' };
    const worker = newRunner();
    await worker.start([spec]);
    await worker.schedule(queue, '* * * * * *', {});
    // The control: a worker fires it.
    await until('the worker to fire the schedule', async () => (await jobCount(queue)) > 0, 20_000);
    await worker.stop();
    await jobsPool.query(`DELETE FROM ${SCHEMA}.job WHERE name = $1`, [queue]);
    const p = newProducer([spec]);
    await p.start();
    await sleep(8_000); // more than the cron worker's interval, many times over the schedule's
    expect(await jobCount(queue)).toBe(0);
    await p.stop();
    // Left as it found it, for any later run of this file against the same schema.
    const w2 = newRunner();
    await w2.start([spec]);
    await w2.unschedule(queue);
    await w2.stop();
  }, 60_000);
});

describe('E3: status and cancel by the run id alone', () => {
  it('finds a run on whichever declared queue holds it, and reads a ref it never made as such', async () => {
    const specs: QueueSpec[] = ['e3-a', 'e3-b', 'e3-c'].map((name) => ({ name, policy: 'standard' as const }));
    const worker = newRunner();
    await worker.start(specs);
    const p = newProducer(specs);
    await p.start();
    const onB = await p.enqueue('e3-b', { id: 'b' }, { tags: ['t:b'] });
    expect(await p.status(onB.runId!)).toMatchObject({ runId: onB.runId, queue: 'e3-b', state: 'queued', tags: ['t:b'] });
    // A pg-boss id no queue holds (settled and deleted after its retention) is null, which the caller reads as finished.
    expect(await p.status('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await p.cancel('00000000-0000-4000-8000-000000000000')).toBe(false);
    // A ref of Trigger.dev's shape is never asked of pg-boss.
    await expect(p.status('run_cm1a2b3c4d5e6f')).rejects.toThrow('"run_cm1a2b3c4d5e6f" is not a pg-boss run id');
    await expect(p.cancel('run_cm1a2b3c4d5e6f')).rejects.toThrow('is not a pg-boss run id');
    expect(await p.cancel(onB.runId!)).toBe(true);
    expect((await p.status(onB.runId!))?.state).toBe('cancelled');
    expect(await p.cancel(onB.runId!)).toBe(false);
    await p.stop();
    await worker.stop();
  }, 30_000);
});

describe("E5: a run's process is killed at its time limit and on a lost claim, before any retry starts", () => {
  const payload: KeyHolderPayload = { connectionString: JOBS_URL, schema: SCHEMA };
  type Held = { attempt: number; pid: number; started_at: Date; last_beat: Date };
  const held = async (runId: string): Promise<Held[]> =>
    (
      await jobsPool.query<Held>(
        `SELECT attempt, pid, started_at, last_beat FROM ${SCHEMA}.key_holder WHERE run_id = $1 ORDER BY attempt`,
        [runId],
      )
    ).rows;
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('kills a run that outlives its limit, then lets the retry start, never both at once on one key', async () => {
    const queue = 'e5-limit';
    // 8 s: pg-boss's own limit. The worker's comes a margin earlier (killMarginSeconds: 1 s at this length).
    const r = newRunner();
    await r.start([{ name: queue, policy: 'singleton', maxDurationSeconds: 8, heartbeatSeconds: 10, attempts: 2, retryDelaySeconds: 0 }]);
    await r.workInChild(queue, KEY_HOLDER, { maxOldSpaceMb: 64, concurrency: 2 });
    const { runId } = await r.enqueue(queue, payload, { serializeBy: 'mapping-e5' });
    const done = await settled(r, queue, runId!, 60_000);
    expect(done.state).toBe('failed');
    expect(done.attempt).toBe(2);
    expect(done.output).toEqual({ name: 'RunTimedOut', message: `The run reached its time limit of 8 s on "${queue}" and was stopped.` });
    const [first, second] = await held(runId!);
    expect([first?.attempt, second?.attempt]).toEqual([1, 2]);
    expect(first!.pid).not.toBe(second!.pid);
    for (const h of [first!, second!]) {
      const ran = h.last_beat.getTime() - h.started_at.getTime();
      // Stopped by the worker, before pg-boss's 8 s: about 7 s less the child's start.
      expect(ran).toBeLessThan(8_000);
      expect(ran).toBeGreaterThan(5_000);
      expect(alive(h.pid)).toBe(false);
    }
    // The retry's process began only after the first one's last word.
    expect(second!.started_at.getTime()).toBeGreaterThan(first!.last_beat.getTime());
    await r.stop();
  }, 90_000);

  it('kills the run when its claim is lost to a cancel from the producer', async () => {
    const queue = 'e5-claim';
    const spec: QueueSpec = { name: queue, policy: 'singleton', heartbeatSeconds: 10, attempts: 1 };
    const r = newRunner();
    await r.start([spec]);
    await r.workInChild(queue, KEY_HOLDER, { maxOldSpaceMb: 64 });
    const p = newProducer([spec]);
    await p.start();
    const { runId } = await p.enqueue(queue, payload, { serializeBy: 'mapping-e5b' });
    const [h] = await until('the run to be holding its key', async () => {
      const rows = await held(runId!);
      return rows.length ? rows : null;
    }, 20_000);
    expect(alive(h!.pid)).toBe(true);
    const cancelledAt = Date.now();
    expect(await p.cancel(runId!)).toBe(true);
    // pg-boss sees the claim gone at its next heartbeat (half of 10 s); the process dies then.
    await until('the run process to be gone', async () => !alive(h!.pid), 15_000);
    expect(Date.now() - cancelledAt).toBeLessThan(10_000);
    const [after] = await held(runId!);
    await sleep(500);
    expect((await held(runId!))[0]!.last_beat).toEqual(after!.last_beat);
    expect((await p.status(runId!))?.state).toBe('cancelled');
    await p.stop();
    await r.stop();
  }, 60_000);
});

describe("E6: a forked run's error name decides whether it is tried again", () => {
  it('fails RunNotRetried, AbortTaskRunError and ZodError at once, and retries everything else', async () => {
    const queue = 'e6-names';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'standard', heartbeatSeconds: 10, attempts: 2, retryDelaySeconds: 1 }]);
    await r.workInChild(queue, FORKED, { maxOldSpaceMb: 64, call: 'throws', concurrency: 4 });
    const names: Array<[string, number]> = [
      ['RunNotRetried', 1],
      ['AbortTaskRunError', 1],
      ['ZodError', 1],
      ['Error', 2],
      ['TypeError', 2],
    ];
    const runs = await Promise.all(
      names.map(async ([name]) => ({ name, run: await r.enqueue(queue, { name, message: `the run threw ${name}` }) })),
    );
    for (const { name, run } of runs) {
      const done = await settled(r, queue, run.runId!, 60_000);
      const expected = names.find(([n]) => n === name)![1];
      expect({ name, state: done.state, attempt: done.attempt, output: done.output }).toEqual({
        name,
        state: 'failed',
        attempt: expected,
        output: { name, message: `the run threw ${name}` },
      });
    }
    await r.stop();
  }, 90_000);
});

describe('E8: recentFailures reads only as many rows as it hands back', () => {
  it('gives the newest failures first, at most the limit, on an index read stopped at the limit', async () => {
    const queue = 'e8-failures';
    const r = newRunner();
    await r.start([{ name: queue, policy: 'standard', attempts: 1, heartbeatSeconds: 10 }]);
    await r.work<{ n: number }, number>(queue, async (p) => {
      if (p.n % 2 === 0) throw new Error(`failure ${p.n}`);
      return p.n;
    });
    for (let n = 0; n < 8; n++) {
      const { runId } = await r.enqueue(queue, { n }, { tags: [`n:${n}`] });
      await settled(r, queue, runId!);
    }
    const three = await r.recentFailures(queue, 3);
    expect(three.map((f) => f.error)).toEqual([
      { name: 'Error', message: 'failure 6' },
      { name: 'Error', message: 'failure 4' },
      { name: 'Error', message: 'failure 2' },
    ]);
    expect(three[0]).toMatchObject({ queue, attempt: 1, tags: ['n:6'] });
    expect((await r.recentFailures(queue)).length).toBe(4);

    // The table pg-boss keeps this queue's rows in (`job_common` unless the queue is partitioned).
    const table = (await jobsPool.query<{ t: string }>(`SELECT table_name AS t FROM ${SCHEMA}.queue WHERE name = $1`, [queue]))
      .rows[0]!.t;
    const client = await jobsPool.connect();
    try {
      await client.query('BEGIN');
      // On a handful of rows the planner may scan; with that off, it must be able to read the index in order.
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_sort = off');
      const plan = (
        await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${recentFailuresSql(SCHEMA, table)}`, [queue, 3])
      ).rows.map((row) => row['QUERY PLAN']).join('\n');
      await client.query('ROLLBACK');
      expect(plan).toMatch(/^Limit/);
      expect(plan).toMatch(new RegExp(`Index Scan Backward using ${table}_i16 on ${table}`));
      expect(plan).not.toMatch(/Sort/);
    } finally {
      client.release();
    }
    await r.stop();
  }, 60_000);
});
