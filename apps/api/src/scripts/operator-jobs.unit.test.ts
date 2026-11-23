// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh jobs`, WITHOUT A DATABASE (workplan 0167 T6): the switch, the
 * arguments, the connection, the hold, and what is printed. The reads against
 * a real pg-boss are `operator-jobs.integration.test.ts`'s.
 *
 * What each test stands for:
 *  - a switch that says `trigger` (Trigger.dev, removed in alpha.18) reaches
 *    nothing, and is refused in one sentence; so is any value but pg-boss;
 *  - the connection is the jobs role's, never the owner's, and no refusal
 *    quotes a URL, which holds a password;
 *  - `jobs run` starts nothing while the hold is open, unless told to;
 *  - nothing printed holds a payload's values or more of an error than its
 *    name and message;
 *  - this module loads no job module (each opens its pools when imported).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { PlatformPause } from '@openmig/managed';
import { JOB_CATALOG, type EnqueueOptions, type FailedRun, type QueueOverview, type RunStatus } from '@openmig/scheduler/pg-boss';
import {
  errorLine,
  jobRunnerOf,
  jobsConnectionString,
  parseJobsCommand,
  runJobsCommand,
  runJobsVerb,
  type JobsCommand,
  type JobsPort,
} from './operator-jobs.ts';
import { TRIGGER_REMOVED } from '../job-runner.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPPING = '5a1b0000-e29b-41d4-a716-446655440002';
const TENANT = '5a1b0000-e29b-41d4-a716-446655440001';
const RUN = '0b7d2f3e-6a1c-4f2e-9d55-1c2b3a4d5e6f';
const SECRET = 'a-word-a-tester-typed';

/** An owner pool that fails the test if anything is asked of it. */
const NO_POOL = new Proxy({}, {
  get: () => {
    throw new Error('the owner pool was touched');
  },
}) as unknown as Pool;

function parsed(args: string[]): JobsCommand {
  const c = parseJobsCommand(args);
  if ('error' in c) throw new Error(c.error);
  return c;
}

function refusalOf(args: string[]): string {
  const c = parseJobsCommand(args);
  if (!('error' in c)) throw new Error(`accepted ${args.join(' ')}`);
  return c.error;
}

/** A fake producer that records what it was asked. */
function fakeJobs(over: Partial<JobsPort> = {}) {
  const asked: Array<{ queue: string; payload: unknown; opts: EnqueueOptions | undefined }> = [];
  const jobs: JobsPort = {
    overview: async () => [],
    recentFailures: async () => [],
    status: (async () => null) as JobsPort['status'],
    cancel: (async () => false) as JobsPort['cancel'],
    enqueue: async (queue: string, payload: unknown, opts?: EnqueueOptions) => {
      asked.push({ queue, payload, opts });
      return { runId: RUN, joined: false };
    },
    ...over,
  };
  return { jobs, asked };
}

const OPEN_HOLD: PlatformPause = { id: 'h', startedAt: '2026-11-22T09:00:00.000Z', message: 'deploying' };

describe('the switch', () => {
  it('reads unset, empty and pg-boss as pg-boss', () => {
    expect(jobRunnerOf({})).toEqual({ runner: 'pg-boss' });
    expect(jobRunnerOf({ OWNPACE_JOB_RUNNER: '' })).toEqual({ runner: 'pg-boss' });
    expect(jobRunnerOf({ OWNPACE_JOB_RUNNER: 'pg-boss' })).toEqual({ runner: 'pg-boss' });
  });

  it('refuses any other value in one sentence', () => {
    const r = jobRunnerOf({ OWNPACE_JOB_RUNNER: 'pgboss' });
    // The API's own sentence (job-runner.ts's jobRunner), the one parser of the switch.
    expect('error' in r && r.error).toBe(
      'OWNPACE_JOB_RUNNER is "pgboss", and it may only be "pg-boss" (unset or empty means "pg-boss").',
    );
    // Trimmed as the API trims it.
    expect(jobRunnerOf({ OWNPACE_JOB_RUNNER: ' pg-boss ' })).toEqual({ runner: 'pg-boss' });
  });

  it.each([[[]], [['failures']], [['show', RUN]], [['cancel', RUN]], [['run', 'run-rollback', '{}']], [['nonsense']]])(
    'with an old .env that says trigger, `jobs %j` says Trigger.dev was removed in alpha.18 and exits 1, asking nothing',
    async (args) => {
      // A jobs URL is there to be used, and must not be: the switch comes first.
      const report = await runJobsVerb(
        args,
        { OWNPACE_JOB_RUNNER: 'trigger', JOBS_DATABASE_URL: 'postgresql://ownpace_jobs:x@nowhere.invalid/x' },
        NO_POOL,
      );
      expect(report.exitCode).toBe(1);
      expect(report.lines).toEqual([TRIGGER_REMOVED]);
    },
  );

  it("that answer is one sentence, and says to remove the key", () => {
    expect(TRIGGER_REMOVED.split(/[.!?](\s|$)/).filter((s) => s.trim() !== '').length).toBe(1);
    expect(TRIGGER_REMOVED).toMatch(/Trigger\.dev was removed in alpha\.18/);
    expect(TRIGGER_REMOVED).toMatch(/remove the key/);
  });

  it('a switch it cannot read is refused before anything else', async () => {
    const report = await runJobsVerb([], { OWNPACE_JOB_RUNNER: 'Trigger' }, NO_POOL);
    expect(report.exitCode).toBe(1);
    expect(report.lines[0]).toContain('OWNPACE_JOB_RUNNER is "Trigger"');
  });
});

describe('the arguments', () => {
  it('reads each command', () => {
    expect(parsed([])).toEqual({ kind: 'overview' });
    expect(parsed(['failures'])).toEqual({ kind: 'failures', task: null, limit: 20 });
    expect(parsed(['failures', 'run-delta-sync', '--limit', '5'])).toEqual({
      kind: 'failures',
      task: 'run-delta-sync',
      limit: 5,
    });
    expect(parsed(['failures', '--limit', '1000'])).toEqual({ kind: 'failures', task: null, limit: 1000 });
    expect(parsed(['show', RUN.toUpperCase()])).toEqual({ kind: 'show', runId: RUN });
    expect(parsed(['cancel', RUN])).toEqual({ kind: 'cancel', runId: RUN });
    expect(parsed(['run', 'managed-digest', '{}'])).toEqual({
      kind: 'run',
      task: 'managed-digest',
      payload: {},
      despiteHold: false,
    });
    expect(parsed(['run', '--despite-hold', 'run-rollback', '{"tenantId":"t"}'])).toMatchObject({
      kind: 'run',
      task: 'run-rollback',
      despiteHold: true,
    });
  });

  it.each([
    [['failures', '--limit', '0'], '--limit takes a whole number from 1 to 1000.'],
    [['failures', '--limit', '1001'], '--limit takes a whole number from 1 to 1000.'],
    [['failures', '--limit', '2.5'], '--limit takes a whole number from 1 to 1000.'],
    [['failures', '--limit'], '--limit takes a whole number from 1 to 1000.'],
    [['failures', 'run-everything'], '"run-everything" is not one of the jobs\' queues'],
    [['failures', 'run-delta-sync', 'run-discovery'], 'jobs failures does not take "run-discovery"'],
    [['show'], 'jobs show takes one run\'s id.'],
    [['cancel', RUN, RUN], 'jobs cancel takes one run\'s id.'],
    [['show', 'run_cm0abcdefg'], 'is a Trigger.dev run\'s ref, from before alpha.16, not a pg-boss run\'s id'],
    [['cancel', 'run_cm0abcdefg'], 'is a Trigger.dev run\'s ref, from before alpha.16, not a pg-boss run\'s id'],
    [['show', '12345'], 'is not a run\'s id: a pg-boss run\'s id is a UUID.'],
    [['run', 'run-rollback'], 'jobs run takes a task and its payload as one JSON object.'],
    [['run', 'run-everything', '{}'], '"run-everything" is not one of the jobs\' queues'],
    [['run', 'run-rollback', '[1]'], 'The payload for run-rollback must be a JSON object.'],
    [['run', 'run-rollback', 'null'], 'The payload for run-rollback must be a JSON object.'],
    [['run', 'run-rollback', '"x"'], 'The payload for run-rollback must be a JSON object.'],
    [['run', 'managed-digest', '{"tenantId":"t"}'], 'managed-digest is a schedule, and a schedule\'s run takes {} and nothing else.'],
    [['run', 'run-delta-sync', '{"tenantId":"t"}'], 'run-delta-sync runs one at a time per migration'],
    [['run', 'run-confirmation', '{"mappingId":1}'], 'run-confirmation runs one at a time per migration'],
    [['run', 'run-discovery', '{"mappingId":"m-1"}'], 'must name the migration by its id, a UUID, as "mappingId".'],
    [['run', 'run-delta-sync', '{"mappingId":"$&"}'], 'must name the migration by its id, a UUID, as "mappingId".'],
    [['jobs'], 'jobs does not know "jobs"'],
  ])('refuses %j', (args, said) => {
    expect(refusalOf(args)).toContain(said);
  });

  it('a payload that is not JSON is refused without quoting it', () => {
    const said = refusalOf(['run', 'run-rollback', `{"note": "${SECRET}"`]);
    expect(said).toBe('The payload for run-rollback is not JSON. Give it as one JSON object, in single quotes.');
    expect(said).not.toContain(SECRET);
  });
});

describe('the connection, as the jobs role', () => {
  const OWNER = 'postgresql://openmigrate:owner-secret@localhost:55432/openmigrate';

  it('takes JOBS_DATABASE_URL as it is, for the jobs role', () => {
    const url = 'postgresql://ownpace_jobs:jobs-secret@pgbouncer:6432/openmigrate';
    expect(jobsConnectionString({ JOBS_DATABASE_URL: url, DATABASE_URL: OWNER })).toEqual({ url });
  });

  it("puts the jobs role and JOBS_DB_PASSWORD in place of the owner on operator.sh's own URL", () => {
    const r = jobsConnectionString({ DATABASE_URL: OWNER, JOBS_DB_PASSWORD: 'p/w@:x' });
    if (!('url' in r)) throw new Error(r.error);
    const u = new URL(r.url);
    expect(decodeURIComponent(u.username)).toBe('ownpace_jobs');
    expect(decodeURIComponent(u.password)).toBe('p/w@:x');
    expect(`${u.host}${u.pathname}`).toBe('localhost:55432/openmigrate');
    expect(r.url).not.toContain('owner-secret');
  });

  it('refuses a JOBS_DATABASE_URL for any other role, the owner above all, without quoting it', () => {
    const r = jobsConnectionString({ JOBS_DATABASE_URL: OWNER });
    expect(r).toEqual({
      error: 'JOBS_DATABASE_URL connects as "openmigrate", and the jobs are read and steered as ownpace_jobs only.',
    });
  });

  it('refuses when there is nothing to connect as the jobs role with', () => {
    for (const env of [{ DATABASE_URL: OWNER }, { DATABASE_URL: OWNER, JOBS_DB_PASSWORD: '' }]) {
      const r = jobsConnectionString(env);
      expect('error' in r && r.error).toContain('Neither JOBS_DATABASE_URL nor JOBS_DB_PASSWORD is set');
      expect('error' in r && r.error).not.toContain('owner-secret');
    }
    expect(jobsConnectionString({ JOBS_DB_PASSWORD: 'x' })).toEqual({
      error: 'DATABASE_URL is not set: run this through ./deploy/compose/operator.sh, which composes it.',
    });
  });

  it('in pg-boss mode a refused connection is said, and exits 1, before pg-boss is asked', async () => {
    const report = await runJobsVerb([], { OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: OWNER }, NO_POOL);
    expect(report.exitCode).toBe(1);
    expect(report.lines.join('\n')).not.toContain('owner-secret');
  });
});

describe('jobs run and the hold', () => {
  const rollback = parsed(['run', 'run-rollback', JSON.stringify({ tenantId: TENANT, mappingId: MAPPING, note: SECRET })]);

  it('starts nothing while the hold is open', async () => {
    const { jobs, asked } = fakeJobs();
    const report = await runJobsCommand(rollback, { jobs, readHold: async () => OPEN_HOLD });
    expect(asked).toEqual([]);
    expect(report).toEqual({
      lines: [
        "The operator's hold is open since 2026-11-22T09:00:00Z, so nothing was started: lift the hold, or give --despite-hold to start this run anyway.",
      ],
      exitCode: 1,
    });
  });

  it('starts the run despite the hold when told to, and says so', async () => {
    const { jobs, asked } = fakeJobs();
    const despite = parsed(['run', 'run-rollback', '{}', '--despite-hold']);
    const report = await runJobsCommand(despite, { jobs, readHold: async () => OPEN_HOLD });
    expect(asked).toHaveLength(1);
    expect(report.exitCode).toBe(0);
    expect(report.lines[0]).toBe("The operator's hold is open; started anyway, as --despite-hold asked.");
  });

  it('a hold that could not be read is not "no hold"', async () => {
    const { jobs, asked } = fakeJobs();
    await expect(
      runJobsCommand(rollback, {
        jobs,
        readHold: async () => {
          throw new Error('connection refused');
        },
      }),
    ).rejects.toThrow('connection refused');
    expect(asked).toEqual([]);
  });

  it('enqueues the payload as given, tagged with its ids, and prints the run id and no value of it', async () => {
    const { jobs, asked } = fakeJobs();
    const report = await runJobsCommand(rollback, { jobs, readHold: async () => null });
    expect(asked).toEqual([
      {
        queue: 'run-rollback',
        payload: { tenantId: TENANT, mappingId: MAPPING, note: SECRET },
        opts: { tags: ['operator', `tenant:${TENANT}`, `mapping:${MAPPING}`] },
      },
    ]);
    expect(report.lines).toEqual([`Queued run-rollback as run ${RUN}. Follow it with \`jobs show ${RUN}\`.`]);
  });

  it('an upper-case migration id keys the run as the tick and the API do, in lower case, in the payload too', async () => {
    const { jobs, asked } = fakeJobs();
    const upper = MAPPING.toUpperCase();
    await runJobsCommand(parsed(['run', 'run-confirmation', JSON.stringify({ tenantId: TENANT, mappingId: upper })]), {
      jobs,
      readHold: async () => null,
    });
    expect(asked[0]!.opts?.serializeBy).toBe(`confirm:${MAPPING}`);
    expect(asked[0]!.payload).toEqual({ tenantId: TENANT, mappingId: MAPPING });
    expect(asked[0]!.opts?.tags).toEqual(['operator', `tenant:${TENANT}`, `mapping:${MAPPING}`]);
  });

  it("serialises a singleton queue's run by the catalog's key", async () => {
    for (const [task, key] of [
      ['run-delta-sync', MAPPING],
      ['run-discovery', MAPPING],
      ['run-confirmation', `confirm:${MAPPING}`],
    ] as const) {
      const { jobs, asked } = fakeJobs();
      await runJobsCommand(parsed(['run', task, JSON.stringify({ tenantId: TENANT, mappingId: MAPPING })]), {
        jobs,
        readHold: async () => null,
      });
      expect(asked[0]!.opts?.serializeBy).toBe(key);
    }
  });

  it('a schedule that already has a run waiting, under the hold and --despite-hold, says only that nothing was queued', async () => {
    const { jobs } = fakeJobs({ enqueue: async () => ({ runId: null, joined: false }) });
    const report = await runJobsCommand(parsed(['run', 'managed-digest', '{}', '--despite-hold']), {
      jobs,
      readHold: async () => OPEN_HOLD,
    });
    expect(report).toEqual({
      lines: ['managed-digest already has a run waiting, so no other was queued: it runs next.'],
      exitCode: 0,
    });
  });

  it('a schedule that already has a run waiting queues no other, and says so', async () => {
    const { jobs } = fakeJobs({ enqueue: async () => ({ runId: null, joined: false }) });
    const report = await runJobsCommand(parsed(['run', 'managed-digest', '{}']), { jobs, readHold: async () => null });
    expect(report).toEqual({
      lines: ['managed-digest already has a run waiting, so no other was queued: it runs next.'],
      exitCode: 0,
    });
  });

  it('only `run` reads the hold', async () => {
    const { jobs } = fakeJobs();
    const readHold = async (): Promise<PlatformPause | null> => {
      throw new Error('read the hold');
    };
    for (const args of [[], ['failures'], ['show', RUN], ['cancel', RUN]]) {
      await runJobsCommand(parsed(args), { jobs, readHold });
    }
  });
});

describe('what is printed', () => {
  it('every queue of the catalog, with its counts and active keys, and the ones not made yet', async () => {
    const found: QueueOverview[] = [
      { queue: 'run-delta-sync', policy: 'singleton', queued: 2, active: 1, failed: 3, total: 9, activeKeys: [MAPPING] },
      { queue: 'managed-sync-tick', policy: 'stately', queued: 0, active: 0, failed: 0, total: 0, activeKeys: [] },
      // pg-boss's array_agg(singleton_key) for a stately queue's running run, which has no key.
      { queue: 'managed-digest', policy: 'stately', queued: 0, active: 1, failed: 0, total: 1, activeKeys: [null as unknown as string] },
    ];
    const { jobs } = fakeJobs({ overview: async () => found });
    const report = await runJobsCommand({ kind: 'overview' }, { jobs, readHold: async () => null });
    expect(report.exitCode).toBe(0);
    expect(report.lines).toHaveLength(1 + 17 + 2);
    expect(report.lines[0]).toMatch(/^queue +queued +active +failed +active keys$/);
    expect(report.lines.find((l) => l.startsWith('run-delta-sync '))).toMatch(
      new RegExp(`^run-delta-sync +2 +1 +3  ${MAPPING}$`),
    );
    expect(report.lines.find((l) => l.startsWith('managed-sync-tick '))).toMatch(/^managed-sync-tick +0 +0 +0 {2}-$/);
    expect(report.lines.find((l) => l.startsWith('managed-digest '))).toMatch(/^managed-digest +0 +1 +0 {2}-$/);
    expect(report.lines.find((l) => l.startsWith('run-rollback '))).toMatch(/^run-rollback +not made yet$/);
    expect(report.lines.at(-1)).toBe(
      '14 queue(s) not made yet: the worker makes every queue when it starts, so it has not started on this schema.',
    );
  });

  it('with every queue made, says the counts are as the worker last counted them', async () => {
    const all: QueueOverview[] = JOB_CATALOG.map((j) => ({
      queue: j.name,
      policy: j.policy,
      queued: 0,
      active: 0,
      failed: 0,
      total: 0,
      activeKeys: [],
    }));
    const { jobs } = fakeJobs({ overview: async () => all });
    const report = await runJobsCommand({ kind: 'overview' }, { jobs, readHold: async () => null });
    expect(report.lines.at(-1)).toBe(
      "Counts are as the worker last counted them, every 15 s while it runs; failed counts the runs pg-boss still keeps.",
    );
  });

  it("an error's name and message, and nothing else of it, on one line", () => {
    expect(errorLine({ name: 'ZodError', message: 'mappingId:\n  Required', stack: 'at x', payload: SECRET })).toBe(
      'ZodError: mappingId: Required',
    );
    expect(errorLine(null)).toBe('(no error recorded)');
    expect(errorLine({ value: { other: SECRET } })).toBe('(no error recorded)');
    expect(errorLine({ value: 7 })).toBe('(no error recorded)');
    expect(errorLine({ name: 'E', message: 'x'.repeat(400) })).toHaveLength(300);
  });

  it.each([
    // pg-boss 12.38.2's own words, as it writes them (plans.js; manager.js, failWip and mapCompletionDataArg).
    [{ value: { message: 'job heartbeat timeout' } }, 'job heartbeat timeout'],
    [{ value: { message: 'job timed out' } }, 'job timed out'],
    [{ value: 'pg-boss shut down while active' }, 'pg-boss shut down while active'],
  ])("pg-boss's own failure %j reads as its sentence", (stored, said) => {
    expect(errorLine(stored)).toBe(said);
  });

  it('failures on every queue, newest first, cut at the limit, with attempt, tags and UTC time', async () => {
    const failure = (queue: string, at: string, n: number): FailedRun => ({
      runId: `0b7d2f3e-6a1c-4f2e-9d55-00000000000${n}`,
      queue,
      attempt: 3,
      failedAt: new Date(at),
      error: { name: 'Error', message: `boom ${n}`, stack: SECRET },
      tags: [`mapping:${MAPPING}`],
    });
    const asked: Array<[string, number]> = [];
    const { jobs } = fakeJobs({
      recentFailures: async (queue: string, limit?: number) => {
        asked.push([queue, limit ?? -1]);
        if (queue === 'run-delta-sync') return [failure(queue, '2026-11-22T10:00:00.123Z', 1), failure(queue, '2026-11-22T08:00:00Z', 2)];
        if (queue === 'managed-digest') return [failure(queue, '2026-11-22T09:00:00Z', 3)];
        return [];
      },
    });
    const report = await runJobsCommand(parsed(['failures', '--limit', '2']), { jobs, readHold: async () => null });
    expect(asked).toHaveLength(17);
    expect(asked.every(([, limit]) => limit === 2)).toBe(true);
    expect(report.lines).toEqual([
      'The 2 most recent failed run(s) on any queue, newest first (at most 2):',
      `2026-11-22T10:00:00Z  run-delta-sync  0b7d2f3e-6a1c-4f2e-9d55-000000000001  attempt 3  mapping:${MAPPING}`,
      '    Error: boom 1',
      `2026-11-22T09:00:00Z  managed-digest  0b7d2f3e-6a1c-4f2e-9d55-000000000003  attempt 3  mapping:${MAPPING}`,
      '    Error: boom 3',
    ]);
  });

  it('a run by its id, its error for a failed one, and no output', async () => {
    const failed: RunStatus = {
      runId: RUN,
      queue: 'run-rollback',
      state: 'failed',
      attempt: 1,
      tags: ['operator'],
      createdAt: new Date('2026-11-22T09:00:00Z'),
      startedAt: new Date('2026-11-22T09:00:01Z'),
      completedAt: new Date('2026-11-22T09:00:02Z'),
      output: { name: 'ZodError', message: 'tenantId: Required', input: SECRET },
    };
    const { jobs } = fakeJobs({ status: (async () => failed) as JobsPort['status'] });
    const report = await runJobsCommand(parsed(['show', RUN]), { jobs, readHold: async () => null });
    expect(report.lines).toEqual([
      `${RUN} on run-rollback: failed, attempt 1`,
      '  created 2026-11-22T09:00:00Z, started 2026-11-22T09:00:01Z, settled 2026-11-22T09:00:02Z',
      '  tags: operator',
      '  error: ZodError: tenantId: Required',
    ]);
    const done: RunStatus = { ...failed, state: 'completed', output: { value: { secret: SECRET } } };
    const { jobs: j2 } = fakeJobs({ status: (async () => done) as JobsPort['status'] });
    const shown = await runJobsCommand(parsed(['show', RUN]), { jobs: j2, readHold: async () => null });
    expect(shown.lines.join('\n')).not.toContain(SECRET);
  });

  it('a run no queue holds, and a cancel that cancelled nothing, exit 1', async () => {
    const { jobs } = fakeJobs();
    expect((await runJobsCommand(parsed(['show', RUN]), { jobs, readHold: async () => null })).exitCode).toBe(1);
    expect((await runJobsCommand(parsed(['cancel', RUN]), { jobs, readHold: async () => null })).exitCode).toBe(1);
    const { jobs: yes } = fakeJobs({ cancel: (async () => true) as JobsPort['cancel'] });
    expect(await runJobsCommand(parsed(['cancel', RUN]), { jobs: yes, readHold: async () => null })).toEqual({
      lines: [`Run ${RUN} is cancelled. A run already going stops at its next heartbeat, within 30 s.`],
      exitCode: 0,
    });
  });
});

describe('what it loads', () => {
  it('imports no job module, and pg-boss only through the runner', () => {
    const source = readFileSync(join(HERE, 'operator-jobs.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*? from '([^']+)';$/gms)].map((m) => m[1]);
    // ../job-runner.ts: the API's one parser of the switch and its JOBS_SCHEMA, which loads no pg-boss.
    expect(imports.sort()).toEqual(['../job-runner.ts', '@openmig/managed', '@openmig/scheduler/pg-boss', 'drizzle-orm/node-postgres', 'pg']);
  });

  it('operator.ts loads it only for `jobs`', () => {
    const operator = readFileSync(join(HERE, 'operator.ts'), 'utf8');
    expect(operator).not.toMatch(/^import[^;]*from '\.\/operator-jobs\.ts';$/m);
    expect(operator).not.toMatch(/^import[^;]*from '@openmig\/scheduler\/pg-boss';$/m);
    expect(operator).toContain("await import('./operator-jobs.ts')");
    // And the close's cancel loads it on pg-boss only, dynamically (operator-close.ts).
    const close = readFileSync(join(HERE, 'operator-close.ts'), 'utf8');
    expect(close).not.toMatch(/^import[^;]*from '\.\/operator-jobs\.ts';$/m);
    expect(close).toContain("await import('./operator-jobs.ts')");
  });
});
