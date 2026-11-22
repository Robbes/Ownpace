// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SWITCH, THE PRODUCER AND THE CANCEL, WITH THE RUNNER MOCKED (workplan
 * 0167 T6; `job-runner.ts`, and the pg-boss half of `enqueue-unless-held.ts`).
 *
 * - `OWNPACE_JOB_RUNNER`: unset, empty or `trigger` is Trigger.dev, `pg-boss`
 *   is pg-boss, and anything else is refused in one sentence.
 * - The enqueue: on Trigger.dev the SDK's `tasks.trigger`, called as before; on
 *   pg-boss the producer's, with `concurrencyKey` as the singleton key, the
 *   idempotency key and its `'15m'` as 900 s, and the tags. A queue the worker
 *   never made fails the enqueue with the producer's sentence.
 * - One producer a process, on `JOBS_DATABASE_URL` and the schema `pgboss`,
 *   with the catalog's queues; refused in one sentence without the URL, which
 *   it never says; made again after a start that failed, and closed.
 * - The cancel: each runner cancels its own refs, refuses the other's, and a
 *   pg-boss run that is gone reads as finished, in a log line.
 *
 * The same against a real pg-boss is `a-job-on-pg-boss.integration.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '@openmig/shared';
import { DISCOVERY_JOIN_WINDOW, DISCOVERY_JOIN_WINDOW_SECONDS, discoveryTriggerOptions } from './routes/migrations/job-resolution.ts';

const { sdk, boss } = vi.hoisted(() => ({
  sdk: {
    trigger: vi.fn(async (..._args: unknown[]) => ({ id: 'run_cmtrigger0001' })),
    cancel: vi.fn(async (..._args: unknown[]) => ({ id: 'run_cmtrigger0001' })),
  },
  boss: {
    made: [] as Array<{ opts: unknown; queues: readonly { name: string }[] }>,
    start: vi.fn(async () => {}),
    stop: vi.fn(async (..._args: unknown[]) => {}),
    enqueue: vi.fn(async (..._args: unknown[]): Promise<{ runId: string | null; joined: boolean }> => ({
      runId: '00000000-0000-4000-8000-000000000001',
      joined: false,
    })),
    cancel: vi.fn(async (..._args: unknown[]) => true),
  },
}));

// A bare factory, as several of the API's tests write it.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: sdk.trigger }, runs: { cancel: sdk.cancel } }),
}));

vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/scheduler/pg-boss')>();
  class PgBossProducer {
    constructor(opts: unknown, queues: readonly { name: string }[]) {
      boss.made.push({ opts, queues });
    }
    start = boss.start;
    stop = boss.stop;
    enqueue = boss.enqueue;
    cancel = boss.cancel;
  }
  return { JOB_CATALOG: actual.JOB_CATALOG, PgBossProducer };
});

// The doors' own questions answer "nothing stops it", so the enqueue the doors
// are handed is what the tests below call: the pg-boss branch has no other way in.
vi.mock('@openmig/managed', () => ({
  readOrganisationClosure: async () => null,
  readOpenPause: async () => null,
}));
vi.mock('./middleware/auth.ts', () => ({
  withTenantDb: async (_tenantId: string, _source: unknown, fn: (db: unknown) => unknown) => fn({}),
}));

const { jobRunner, cancelRun, closeJobRunner, pgBossProducer, isPgBossRef, JOBS_SCHEMA, NO_JOBS_URL } = await import(
  './job-runner.ts'
);
const { enqueueIfFree, pgBossOptionsFor, durationSeconds, isUnreachable, QUEUE_UNREACHABLE } = await import(
  './enqueue-unless-held.ts'
);

/** The enqueue a door is handed when nothing holds it. */
async function enqueueOnPgBoss(...args: Parameters<import('./enqueue-unless-held.ts').Enqueue>) {
  const free = await enqueueIfFree('t-1', {} as never);
  if (!('enqueue' in free)) throw new Error(`stopped: ${free.stopped}`);
  return free.enqueue(...args);
}

const UUID = '6f1c2a9e-3b4d-4e5f-8a6b-7c8d9e0f1a2b';
const JOBS_URL = 'postgres://ownpace_jobs:not-a-real-password@pgbouncer:6432/ownpace';
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ['OWNPACE_JOB_RUNNER', 'JOBS_DATABASE_URL']) saved[k] = process.env[k];
  delete process.env.OWNPACE_JOB_RUNNER;
  delete process.env.JOBS_DATABASE_URL;
  boss.made.length = 0;
  for (const f of [sdk.trigger, sdk.cancel, boss.start, boss.stop, boss.enqueue, boss.cancel]) f.mockClear();
});

afterEach(async () => {
  await closeJobRunner();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe('the switch', () => {
  it.each([
    [undefined, 'trigger'],
    ['', 'trigger'],
    ['  ', 'trigger'],
    ['trigger', 'trigger'],
    ['pg-boss', 'pg-boss'],
  ] as const)('%j is %s', (value, runner) => {
    expect(jobRunner(value === undefined ? {} : { OWNPACE_JOB_RUNNER: value })).toBe(runner);
  });

  it.each(['pgboss', 'Trigger', 'in-process', 'pg-boss,trigger'])('%j is refused in one sentence', (value) => {
    expect(() => jobRunner({ OWNPACE_JOB_RUNNER: value })).toThrow(
      `OWNPACE_JOB_RUNNER is "${value}", and it may only be "trigger" or "pg-boss" (unset or empty means "trigger").`,
    );
  });

  it('a pg-boss ref is a UUID, and a Trigger.dev ref is not', () => {
    expect(isPgBossRef(UUID)).toBe(true);
    expect(isPgBossRef('run_cmabc123def456')).toBe(false);
    expect(isPgBossRef(`${UUID}x`)).toBe(false);
  });
});

describe('the pg-boss options are Trigger.dev’s, in the runner’s words', () => {
  it('the discovery join: singleton by the migration, the key for 900 s, the tags', () => {
    const asked = discoveryTriggerOptions('t-1', 'm-1', { updatedAt: new Date('2026-11-22T10:00:00Z') });
    expect(pgBossOptionsFor(asked)).toEqual({
      serializeBy: 'm-1',
      idempotency: { key: 'discovery:m-1:2026-11-22T10:00:00.000Z:its-own', ttlSeconds: 900 },
      tags: ['tenant:t-1', 'mapping:m-1'],
    });
  });

  it('the window as seconds is the window', () => {
    expect(durationSeconds(DISCOVERY_JOIN_WINDOW)).toBe(DISCOVERY_JOIN_WINDOW_SECONDS);
    expect(DISCOVERY_JOIN_WINDOW_SECONDS).toBe(900);
  });

  it('reads s, m, h and d, and refuses anything else', () => {
    expect([durationSeconds('30s'), durationSeconds('15m'), durationSeconds('2h'), durationSeconds('1d')]).toEqual([
      30, 900, 7200, 86_400,
    ]);
    for (const bad of ['15', '15min', '1.5h', 'm15', '']) expect(() => durationSeconds(bad)).toThrow(/not a duration/);
  });

  it('a pass: the singleton key and the tags, no idempotency', () => {
    expect(pgBossOptionsFor({ concurrencyKey: 'm-2', tags: ['tenant:t', 'mapping:m-2'] })).toEqual({
      serializeBy: 'm-2',
      tags: ['tenant:t', 'mapping:m-2'],
    });
    expect(pgBossOptionsFor({})).toEqual({});
  });

  it('a key with no window is refused, not held for ever', () => {
    expect(() => pgBossOptionsFor({ idempotencyKey: 'k' })).toThrow(/idempotencyKeyTTL/);
  });
});

describe('the enqueue on pg-boss', () => {
  beforeEach(() => {
    process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
    process.env.JOBS_DATABASE_URL = JOBS_URL;
  });

  it('enqueues on the task’s queue, through one producer made from the catalog, and never the SDK', async () => {
    const asked = discoveryTriggerOptions('t-1', 'm-1', { updatedAt: new Date('2026-11-22T10:00:00Z') });
    boss.enqueue.mockResolvedValueOnce({ runId: UUID, joined: false });
    boss.enqueue.mockResolvedValueOnce({ runId: UUID, joined: true });

    const first = await enqueueOnPgBoss('run-discovery', { tenantId: 't-1', mappingId: 'm-1' }, asked);
    const second = await enqueueOnPgBoss('run-discovery', { tenantId: 't-1', mappingId: 'm-1' }, asked);

    expect(first).toEqual({ id: UUID, joined: false });
    expect(second).toEqual({ id: UUID, joined: true });
    expect(boss.enqueue).toHaveBeenNthCalledWith(1, 'run-discovery', { tenantId: 't-1', mappingId: 'm-1' }, pgBossOptionsFor(asked));
    expect(boss.made).toHaveLength(1);
    expect(boss.start).toHaveBeenCalledTimes(1);
    expect(boss.made[0]!.opts).toEqual({ connectionString: JOBS_URL, schema: JOBS_SCHEMA, maxConnections: 2 });
    expect(JOBS_SCHEMA).toBe('pgboss');
    expect(boss.made[0]!.queues.map((q) => q.name)).toContain('run-discovery');
    expect(boss.made[0]!.queues).toHaveLength(17);
    expect(sdk.trigger).not.toHaveBeenCalled();
  });

  it('a queue the worker never made fails the enqueue, in the producer’s words', async () => {
    const said = 'The queue "run-delta-sync" does not exist in the jobs schema "pgboss". The worker creates every queue when it starts, so it has not started on this schema yet; nothing was enqueued.';
    boss.enqueue.mockRejectedValueOnce(new Error(said));
    await expect(enqueueOnPgBoss('run-delta-sync', {}, { concurrencyKey: 'm' })).rejects.toThrow(said);
  });

  it('a run turned away with no id is an error, never a run', async () => {
    boss.enqueue.mockResolvedValueOnce({ runId: null, joined: false });
    await expect(enqueueOnPgBoss('run-delta-sync', {})).rejects.toThrow(/turned the run on "run-delta-sync" away/);
  });

  it('without JOBS_DATABASE_URL: refused in one sentence that names no URL, and no producer made', async () => {
    delete process.env.JOBS_DATABASE_URL;
    await expect(enqueueOnPgBoss('run-delta-sync', {})).rejects.toThrow(NO_JOBS_URL);
    expect(NO_JOBS_URL).toBe(
      'OWNPACE_JOB_RUNNER is "pg-boss" and JOBS_DATABASE_URL is not set, so no job can be enqueued or cancelled.',
    );
    expect(boss.made).toHaveLength(0);
  });

  it('a producer whose start failed is closed, and the next press makes another', async () => {
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});
    boss.start.mockRejectedValueOnce(new Error('The jobs schema "pgboss" is not at pg-boss schema version 30.'));
    await expect(pgBossProducer()).rejects.toThrow(/not at pg-boss schema version/);
    expect(boss.stop).toHaveBeenCalledTimes(1);
    await pgBossProducer();
    expect(boss.made).toHaveLength(2);
    expect(boss.start).toHaveBeenCalledTimes(2);
    expect(warned).not.toHaveBeenCalled();
  });

  it('a start that fails late forgets only itself, never a newer producer', async () => {
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});
    let failFirst!: (err: Error) => void;
    boss.start.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (failFirst = reject)));
    const first = pgBossProducer();
    // A close, and a press after it, while the first start is still out.
    void closeJobRunner();
    const second = await pgBossProducer();
    failFirst(new Error('connect ECONNREFUSED 10.0.0.9:6432'));
    await expect(first).rejects.toThrow(/ECONNREFUSED/);
    // The newer producer is still the process's: no third is made, and the close stops it.
    expect(await pgBossProducer()).toBe(second);
    expect(boss.made).toHaveLength(2);
    boss.stop.mockClear();
    await closeJobRunner();
    expect(boss.stop).toHaveBeenCalledTimes(1);
    void warned;
  });

  it.each([
    ['refused', Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6432'), { code: 'ECONNREFUSED' })],
    ['a name that did not resolve', Object.assign(new Error('getaddrinfo ENOTFOUND pgbouncer.internal'), { code: 'ENOTFOUND' })],
    ['every address of a name', new AggregateError([Object.assign(new Error('connect ECONNREFUSED [fd00::9]:6432'), { code: 'ECONNREFUSED' })], '')],
    ['dropped', new Error('Connection terminated unexpectedly')],
    ['a login refused', Object.assign(new Error('password authentication failed for user "ownpace_jobs"'), { code: '28P01' })],
  ])('a connection that failed (%s): one sentence with no address, the original in the log only', async (_what, err) => {
    const logged = vi.spyOn(log, 'error').mockImplementation(() => {});
    boss.start.mockRejectedValueOnce(err);
    const thrown = await enqueueOnPgBoss('run-delta-sync', {}, { concurrencyKey: 'm' }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(QUEUE_UNREACHABLE);
    expect((thrown as Error).message).not.toMatch(/10\.0\.0\.9|fd00|pgbouncer|6432|ownpace_jobs/);
    // Kept for the server's log, never in the message the doors echo.
    expect((thrown as Error).cause).toBe(err);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toBe(err);
  });

  it('the same once the producer is up: a connection lost on the enqueue itself', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {});
    boss.enqueue.mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    await expect(enqueueOnPgBoss('run-delta-sync', {})).rejects.toThrow(QUEUE_UNREACHABLE);
  });

  it('an error that is not the connection is said as it was', () => {
    expect(isUnreachable(new Error('The queue "run-delta-sync" does not exist in the jobs schema "pgboss".'))).toBe(false);
    expect(isUnreachable(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
    expect(isUnreachable(new Error('pg-boss refused a run on "run-x" and gave no id.'))).toBe(false);
    expect(isUnreachable(new Error('outer', { cause: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }))).toBe(true);
  });

  it('closes the producer it made, once, and never logs the URL', async () => {
    const said = [vi.spyOn(log, 'info'), vi.spyOn(log, 'warn'), vi.spyOn(log, 'error')];
    await enqueueOnPgBoss('run-delta-sync', {});
    await closeJobRunner();
    await closeJobRunner();
    expect(boss.stop).toHaveBeenCalledTimes(1);
    for (const spy of said) expect(JSON.stringify(spy.mock.calls)).not.toContain('not-a-real-password');
  });
});

describe('the cancel', () => {
  it('on Trigger.dev: a run_ ref goes to the SDK, as before', async () => {
    await cancelRun('run_cmabc123def456');
    expect(sdk.cancel).toHaveBeenCalledWith('run_cmabc123def456');
    expect(boss.made).toHaveLength(0);
  });

  it('on Trigger.dev: a pg-boss ref is refused, and nothing is asked', async () => {
    await expect(cancelRun(UUID)).rejects.toThrow(
      `Run ${UUID} is a pg-boss job, and this API runs its jobs on Trigger.dev; it was not cancelled.`,
    );
    expect(sdk.cancel).not.toHaveBeenCalled();
  });

  it('on pg-boss: a UUID goes to the producer, by the id alone', async () => {
    process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
    process.env.JOBS_DATABASE_URL = JOBS_URL;
    await cancelRun(UUID);
    expect(boss.cancel).toHaveBeenCalledWith(UUID);
    expect(sdk.cancel).not.toHaveBeenCalled();
  });

  it('on pg-boss: a run_ ref is refused before pg-boss is asked', async () => {
    process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
    process.env.JOBS_DATABASE_URL = JOBS_URL;
    await expect(cancelRun('run_cmabc123def456')).rejects.toThrow(
      'Run run_cmabc123def456 is not a pg-boss job id, and this API runs its jobs on pg-boss; it was not cancelled.',
    );
    expect(boss.made).toHaveLength(0);
  });

  it('on pg-boss: a run that is gone or settled reads as finished, in a log line', async () => {
    process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
    process.env.JOBS_DATABASE_URL = JOBS_URL;
    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    boss.cancel.mockResolvedValueOnce(false);
    await expect(cancelRun(UUID)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith(`[jobs] run ${UUID} is no longer queued or running on pg-boss; read as finished.`);
  });

  it('a switch it cannot read is refused, and nothing is asked', async () => {
    process.env.OWNPACE_JOB_RUNNER = 'pgboss';
    await expect(cancelRun('run_x')).rejects.toThrow(/may only be "trigger" or "pg-boss"/);
    expect(sdk.cancel).not.toHaveBeenCalled();
  });
});
