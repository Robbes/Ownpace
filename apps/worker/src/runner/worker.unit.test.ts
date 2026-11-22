// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORKER ON PG-BOSS, WITHOUT A DATABASE (ADR-0054; workplan 0167 T6).
 *
 * What can be held without Postgres: when the process refuses to start; how a
 * run's error settles it; what a job's ref and wait read as through the
 * pg-boss context; that a payload is parsed before the run and the producer
 * closed after it; that every queue of the catalog has exactly one entry and
 * every entry is a queue's, each loading its job statically; and the health
 * endpoint. The worker on a real Postgres is `worker.integration.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { z } from 'zod';
import {
  ChildRunDied,
  JOB_CATALOG,
  NOT_RETRIED_ERROR_NAMES,
  RunNotRetried,
  RunOutOfMemory,
  RunPossiblyOutOfMemory,
  RunTimedOut,
  settlementFor,
  type RunOutcome,
  type RunStatus,
} from '@openmig/scheduler/pg-boss';
import { log } from '@openmig/shared';
import type { RunContext as JobRunContext } from '../jobs/run-context.ts';
import { isPgBossRef, pgBossRunner, verdictOfStatus, WAIT_POLL_MS, type ProducerLike } from './pg-boss-context.ts';
import { onPgBoss } from './serve-job.ts';
import {
  DEFAULT_MAX_PASSES_IN_FLIGHT,
  RUN_ENTRIES,
  STOP_GRACE_MS,
  STOP_SETTLE_MS,
  passesInFlightFrom,
  refusalToStart,
  serveHealth,
} from './worker.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, 'runs');
const JOBS = join(HERE, '..', 'jobs');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the process refuses to start, in one sentence, unless the switch names pg-boss and the jobs URL is set', () => {
  const URL_SET = { JOBS_DATABASE_URL: 'postgresql://ownpace_jobs@pgbouncer:6432/ownpace' };

  it('starts only on pg-boss with the jobs URL', () => {
    expect(refusalToStart({ OWNPACE_JOB_RUNNER: 'pg-boss', ...URL_SET })).toBeNull();
    expect(refusalToStart({ OWNPACE_JOB_RUNNER: ' pg-boss ', ...URL_SET })).toBeNull();
  });

  it.each([
    [{}, /is "trigger", so the jobs run on Trigger.dev/],
    [{ OWNPACE_JOB_RUNNER: '' }, /is "trigger"/],
    [{ OWNPACE_JOB_RUNNER: 'trigger' }, /is "trigger"/],
    [{ OWNPACE_JOB_RUNNER: 'pgboss' }, /may only be "trigger" or "pg-boss"/],
    [{ OWNPACE_JOB_RUNNER: 'PG-BOSS' }, /may only be "trigger" or "pg-boss"/],
    [{ OWNPACE_JOB_RUNNER: 'pg-boss' }, /JOBS_DATABASE_URL is not set/],
    [{ OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: '  ' }, /JOBS_DATABASE_URL is not set/],
  ] as const)('refuses %j', (env, said) => {
    const refusal = refusalToStart({ ...env, ...('OWNPACE_JOB_RUNNER' in env ? {} : URL_SET) });
    expect(refusal).toMatch(said);
    // One sentence: one line, one full stop at its end.
    expect(refusal).not.toContain('\n');
    expect(refusal!.trim().endsWith('.')).toBe(true);
  });

  it('main.ts exits 1 with that one line on stderr, before it connects anywhere', () => {
    const main = join(HERE, 'main.ts');
    for (const env of [{}, { OWNPACE_JOB_RUNNER: 'pg-boss' }, { OWNPACE_JOB_RUNNER: 'x', JOBS_DATABASE_URL: 'y' }]) {
      const ran = spawnSync(process.execPath, [main], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 30_000 });
      expect(ran.status, ran.stderr).toBe(1);
      expect(ran.stdout).toBe('');
      expect(ran.stderr.trimEnd().split('\n')).toHaveLength(1);
      expect(ran.stderr).toMatch(/^\[worker\] not started: /);
    }
    const badCap = spawnSync(process.execPath, [main], {
      env: { PATH: process.env.PATH, OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: 'y', MAX_PASSES_IN_FLIGHT: 'many' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(badCap.status).toBe(1);
    expect(badCap.stderr.trimEnd().split('\n')).toEqual([expect.stringMatching(/MAX_PASSES_IN_FLIGHT must be a whole number/)]);
  });

  it('reads MAX_PASSES_IN_FLIGHT as the sync tick reads it, with its default', () => {
    expect(passesInFlightFrom(undefined)).toBe(DEFAULT_MAX_PASSES_IN_FLIGHT);
    expect(passesInFlightFrom(' ')).toBe(DEFAULT_MAX_PASSES_IN_FLIGHT);
    expect(passesInFlightFrom('7')).toBe(7);
    for (const bad of ['0', '-1', '2.5', 'x']) expect(() => passesInFlightFrom(bad)).toThrow(/whole number/);
    const tick = readFileSync(join(JOBS, 'managed-sync-tick.ts'), 'utf8');
    expect(tick).toContain(`export const DEFAULT_MAX_PASSES_IN_FLIGHT = ${DEFAULT_MAX_PASSES_IN_FLIGHT};`);
  });

  it('stops inside the compose service’s grace of 60 s', () => {
    expect(STOP_GRACE_MS + STOP_SETTLE_MS).toBeLessThan(60_000);
  });
});

describe("a run's error settles it by name, as Trigger.dev 4.8.8 settles it", () => {
  const zodError = (() => {
    try {
      z.strictObject({}).parse({ unexpected: true });
    } catch (err) {
      return err;
    }
    throw new Error('zod accepted what it should refuse');
  })();

  it.each([
    ['AbortTaskRunError, a deliberate stop', new AbortTaskRunError('stop'), 'deadletter'],
    ['RunNotRetried, the runner’s own', new RunNotRetried('stop'), 'deadletter'],
    ['ZodError, a payload its schema refused (TaskPayloadParsedError, skipped)', zodError, 'deadletter'],
    ['RunTimedOut, the time limit (MAX_DURATION_EXCEEDED)', new RunTimedOut('late'), 'deadletter'],
    ['RunOutOfMemory, the heap', new RunOutOfMemory(null, 'SIGABRT', 410), 'deadletter'],
    ['RunPossiblyOutOfMemory, a SIGKILL the runner did not send (TASK_PROCESS_MAYBE_OOM_KILLED)', new RunPossiblyOutOfMemory(null, 'SIGKILL', 410), 'deadletter'],
    ['a thrown error', new Error('a provider 500'), 'failed'],
    ['a process that exited before it answered', new ChildRunDied(1, null, 'exited', 410), 'failed'],
  ] as const)('%s: %s', (_what, err, settlement) => {
    expect(settlementFor(err)).toBe(settlement);
  });

  it('by the name alone, as it crosses from the run’s process', () => {
    for (const name of ['AbortTaskRunError', 'RunNotRetried', 'ZodError']) {
      const crossed = new Error('said');
      crossed.name = name;
      expect(settlementFor(crossed)).toBe('deadletter');
    }
    expect((zodError as Error).name).toBe('ZodError');
  });

  it('is one list, the runner’s: a deliberate stop, a refused payload, the limit, the heap, an outside kill', () => {
    expect([...NOT_RETRIED_ERROR_NAMES].sort()).toEqual(
      ['AbortTaskRunError', 'RunNotRetried', 'RunOutOfMemory', 'RunPossiblyOutOfMemory', 'RunTimedOut', 'ZodError'].sort(),
    );
  });
});

function status(state: RunStatus['state']): RunStatus {
  return {
    runId: '00000000-0000-4000-8000-000000000001',
    queue: 'run-delta-sync',
    state,
    attempt: 1,
    tags: [],
    createdAt: new Date(0),
    startedAt: null,
    completedAt: null,
    output: null,
  };
}

/** A producer that records what it is asked, and answers as told. */
function fakeProducer(answers: { status?: RunStatus | null; outcome?: RunOutcome<unknown>; startFails?: Error } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const producer: ProducerLike = {
    start: async () => {
      calls.push(['start']);
      if (answers.startFails) throw answers.startFails;
    },
    stop: async () => {
      calls.push(['stop']);
    },
    enqueue: async (queue, payload, opts) => {
      calls.push(['enqueue', queue, payload, opts]);
      return { runId: '00000000-0000-4000-8000-0000000000aa' };
    },
    enqueueAndWait: async <R>(queue: string, payload: unknown, opts: unknown) => {
      calls.push(['enqueueAndWait', queue, payload, opts]);
      return answers.outcome as RunOutcome<R>;
    },
    status: async (ref) => {
      calls.push(['status', ref]);
      return answers.status ?? null;
    },
    cancel: async (ref) => {
      calls.push(['cancel', ref]);
      return true;
    },
  };
  return { producer, calls };
}

describe('what a job asks of its runner, through the pg-boss context', () => {
  const REF = '0f1e2d3c-4b5a-4968-8776-655443322110';

  it('reads a run’s state as live or finished, and a gone run as finished', () => {
    expect(verdictOfStatus(status('queued'))).toBe('live');
    expect(verdictOfStatus(status('retrying'))).toBe('live');
    expect(verdictOfStatus(status('running'))).toBe('live');
    expect(verdictOfStatus(status('completed'))).toBe('finished');
    expect(verdictOfStatus(status('failed'))).toBe('finished');
    expect(verdictOfStatus(status('cancelled'))).toBe('finished');
    expect(verdictOfStatus(null)).toBe('finished');
    expect(verdictOfStatus({ ...status('queued'), state: 'paused' as never })).toBe('unknown');
  });

  it('never asks pg-boss about a Trigger.dev ref: unknown, without opening a producer', async () => {
    const { producer, calls } = fakeProducer();
    const runner = pgBossRunner(() => producer);
    expect(isPgBossRef('run_cm0123456789abcdefghij')).toBe(false);
    expect(isPgBossRef(REF)).toBe(true);
    expect(await runner.port.verdict('run_cm0123456789abcdefghij')).toBe('unknown');
    await expect(runner.port.cancel('run_cm0123456789abcdefghij')).rejects.toThrow(/not a pg-boss run's id/);
    await runner.close();
    expect(calls).toEqual([]);
  });

  it('says so in a line when a ref’s job is gone, and reads it as finished', async () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
    const { producer, calls } = fakeProducer({ status: null });
    const runner = pgBossRunner(() => producer);
    expect(await runner.port.verdict(REF)).toBe('finished');
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`run ${REF} is no longer in the jobs schema`));
    await runner.close();
    expect(calls).toEqual([['start'], ['status', REF], ['stop']]);
  });

  it('enqueues a pass keyed and tagged as the job asks, and cancels by id; one producer for the run', async () => {
    const { producer, calls } = fakeProducer({ status: status('running') });
    const runner = pgBossRunner(() => producer);
    const payload = { tenantId: 't', mappingId: 'm' };
    expect(await runner.port.enqueue('run-delta-sync', payload, { serializeBy: 'm', tags: ['tenant:t', 'mapping:m'] })).toEqual({
      runId: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(await runner.port.verdict(REF)).toBe('live');
    await runner.port.cancel(REF);
    await runner.close();
    expect(runner.port.name).toBe('pg-boss');
    expect(calls).toEqual([
      ['start'],
      ['enqueue', 'run-delta-sync', payload, { serializeBy: 'm', tags: ['tenant:t', 'mapping:m'] }],
      ['status', REF],
      ['cancel', REF],
      ['stop'],
    ]);
  });

  it('waits for a pass polling every second, and hands back what it settled', async () => {
    const ok = fakeProducer({ outcome: { ok: true, runId: REF, output: { copied: 3 } } });
    const okRunner = pgBossRunner(() => ok.producer);
    expect(await okRunner.port.enqueueAndWait('run-delta-sync', { tenantId: 't', mappingId: 'm' }, { serializeBy: 'm', tags: [] })).toEqual({
      ok: true,
      output: { copied: 3 },
    });
    expect(ok.calls[1]).toEqual(['enqueueAndWait', 'run-delta-sync', { tenantId: 't', mappingId: 'm' }, { serializeBy: 'm', tags: [], pollMs: WAIT_POLL_MS }]);
    expect(WAIT_POLL_MS).toBe(1000);
    await okRunner.close();

    const failed = fakeProducer({ outcome: { ok: false, runId: REF, state: 'failed', error: { name: 'Error', message: 'email sync failed' } } });
    const failedRunner = pgBossRunner(() => failed.producer);
    expect(await failedRunner.port.enqueueAndWait('run-delta-sync', { tenantId: 't', mappingId: 'm' }, { serializeBy: 'm', tags: [] })).toEqual({
      ok: false,
      error: { name: 'Error', message: 'email sync failed' },
    });
    await failedRunner.close();

    const cancelled = fakeProducer({ outcome: { ok: false, runId: REF, state: 'cancelled', error: null } });
    const cancelledRunner = pgBossRunner(() => cancelled.producer);
    const settled = await cancelledRunner.port.enqueueAndWait('run-delta-sync', { tenantId: 't', mappingId: 'm' }, { serializeBy: 'm', tags: [] });
    expect(settled).toEqual({ ok: false, error: { name: 'RunCancelled', message: 'The run ended cancelled.' } });
    await cancelledRunner.close();
  });

  it('a producer that fails to start is stopped, and its failure is the run’s', async () => {
    const { producer, calls } = fakeProducer({ startFails: new Error('the jobs schema is at version 47') });
    const runner = pgBossRunner(() => producer);
    await expect(runner.port.verdict(REF)).rejects.toThrow('version 47');
    await runner.close();
    expect(calls).toEqual([['start'], ['stop']]);
  });

  it('a run that asks nothing opens nothing', async () => {
    const open = vi.fn(() => fakeProducer().producer);
    await pgBossRunner(open).close();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("a run in its process: the payload parsed first, the context made, the producer closed", () => {
  const RUN = { queue: 'run-discovery', runId: '0f1e2d3c-4b5a-4968-8776-655443322110', attempt: 2 };
  const Schema = z.object({ tenantId: z.string().uuid() });

  it('refuses a payload its schema refuses before the run is called, with a ZodError', async () => {
    const run = vi.fn(async () => 'ran');
    await expect(onPgBoss(Schema, run)({ tenantId: 'x' }, RUN)).rejects.toMatchObject({ name: 'ZodError' });
    expect(run).not.toHaveBeenCalled();
  });

  it('hands the run its parsed payload, its pg-boss id and attempt, and the pg-boss runner; closes what it opened', async () => {
    const { producer, calls } = fakeProducer({ status: status('completed') });
    let seen: JobRunContext | undefined;
    const served = onPgBoss(
      Schema,
      async (payload, context) => {
        seen = context;
        await context.runner.verdict(RUN.runId);
        return payload;
      },
      () => producer,
    );
    const tenantId = '11111111-2222-4333-8444-555555555555';
    expect(await served({ tenantId, extra: 'dropped' }, RUN)).toEqual({ tenantId });
    expect(seen).toMatchObject({ runId: RUN.runId, attempt: 2 });
    expect(seen!.runner.name).toBe('pg-boss');
    expect(calls.at(-1)).toEqual(['stop']);
  });

  it('closes the producer when the run throws too, and the run’s error is what is thrown', async () => {
    const { producer, calls } = fakeProducer({ status: status('running') });
    const served = onPgBoss(
      Schema,
      async (_payload, context) => {
        await context.runner.verdict(RUN.runId);
        throw new RunNotRetried('a verdict');
      },
      () => producer,
    );
    await expect(served({ tenantId: '11111111-2222-4333-8444-555555555555' }, RUN)).rejects.toMatchObject({ name: 'RunNotRetried' });
    expect(calls.at(-1)).toEqual(['stop']);
  });

  it('refuses a run forked without its id and attempt', async () => {
    await expect(onPgBoss(Schema, async () => 'ran')({ tenantId: 'x' }, undefined)).rejects.toThrow(/without its run id/);
  });
});

describe('every queue has exactly one entry, and every entry is a queue’s', () => {
  const files = readdirSync(RUNS).filter((f) => f.endsWith('.ts'));
  const names = JOB_CATALOG.map((j) => j.name);

  it('one file per catalog id, and no file that is not one', () => {
    expect(files.map((f) => f.replace(/\.ts$/, '')).sort()).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('the worker forks each queue from its own file', () => {
    expect(Object.keys(RUN_ENTRIES).sort()).toEqual([...names].sort());
    for (const [name, url] of Object.entries(RUN_ENTRIES)) {
      expect(fileURLToPath(url)).toBe(join(RUNS, `${name}.ts`));
    }
  });

  for (const name of JOB_CATALOG.map((j) => j.name)) {
    it(`${name}: imports its job statically, and ends serving it through onPgBoss`, () => {
      const text = readFileSync(join(RUNS, `${name}.ts`), 'utf8');
      // No import() at all, of a computed name or any other: the entry's graph is what it says.
      expect(text).not.toMatch(/\bimport\s*\(/);
      expect(text).not.toMatch(/\brequire\s*\(/);
      const job = new RegExp(`^import \\{ (\\w+), (\\w+) \\} from '\\.\\./\\.\\./jobs/${name}\\.ts';$`, 'm').exec(text);
      expect(job, `${name}.ts imports its schema and run from ../../jobs/${name}.ts`).not.toBeNull();
      const [, schema, run] = job!;
      expect(text.trimEnd().split('\n').at(-1)).toBe(`serveRuns({ run: onPgBoss(${schema}, ${run}) });`);
      const source = readFileSync(join(JOBS, `${name}.ts`), 'utf8');
      expect(source).toMatch(new RegExp(`^export const ${schema} = z\\.`, 'm'));
      expect(source).toMatch(new RegExp(`^export const ${run} = leavesAReference\\(\\n  '${name}',`, 'm'));
    });
  }
});

describe('every entry loads under Node itself, no transpiler', () => {
  it('each of the seventeen, its job module and all it imports, loads and exits when not forked by the worker', async () => {
    // serveRuns arms itself only in a process runInChild forked, so loaded by hand each entry
    // loads its job (which opens its pools lazily, on these unreachable URLs) and exits 0.
    const env = {
      PATH: process.env.PATH,
      APP_DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
      SYSTEM_DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
    };
    const ran = await Promise.all(
      Object.entries(RUN_ENTRIES).map(
        ([name, url]) =>
          new Promise<[string, number | null, string]>((resolve) => {
            const child = spawn(process.execPath, [fileURLToPath(url)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
            child.once('exit', (code) => resolve([name, code, stderr]));
          }),
      ),
    );
    for (const [name, code, stderr] of ran) expect(code, `${name}: ${stderr}`).toBe(0);
  }, 120_000);
});

describe('/health', () => {
  it('200 while healthy, 503 while not, 404 for anything else; on the address it is given', async () => {
    let healthy = false;
    const server = await serveHealth('127.0.0.1', 0, () => healthy);
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
      healthy = true;
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/health`, { method: 'POST' })).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
