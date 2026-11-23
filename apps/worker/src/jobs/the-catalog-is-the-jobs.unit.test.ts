// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CATALOG IS THE JOBS (ADR-0054; workplan 0167 T6, and T9).
 *
 * The pg-boss runner declares a queue for each job before it works one, from
 * the job catalog (`packages/scheduler/src/pg-boss/catalog.ts`). Until alpha.18
 * the jobs were Trigger.dev tasks too, each declared in its own file here, and
 * this guard held the catalog to those declarations, read from their source.
 * alpha.18 removed Trigger.dev (T9), so the catalog is the one declaration
 * left, and what this holds now is:
 *
 * 1. the seventeen queues and the seventeen entries the worker forks
 *    (`apps/worker/src/runner/runs/<name>.ts`), one for one, each entry
 *    serving its own job's run, which is wrapped in `leavesAReference` under
 *    the queue's name;
 * 2. what the catalog said when the tasks were removed, written out here: the
 *    nine schedules' crons, in UTC, the keys, the retries and the time limits
 *    (Trigger.dev 4.8.8's `trigger.config.ts`: three attempts, the first retry
 *    after 5 s, doubling, never longer than a minute, an hour a run; three
 *    for a cutover). A change to any is a change to the jobs, and is made here
 *    with the catalog, on purpose;
 * 3. what the runner adds besides, as the plan of 0167 T6 set it;
 * 4. the catalog is data: it imports nothing, so reading it loads no pg-boss,
 *    and each entry is what the runner's `start` takes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG, concurrencyOf, type JobCatalogEntry, type QueueSpec } from '@openmig/scheduler/pg-boss';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const RUNS = join(HERE, '..', 'runner', 'runs');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** Comments removed: a comment may name what the code does not. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const entry = (name: string): JobCatalogEntry => {
  const found = JOB_CATALOG.find((queue) => queue.name === name);
  expect(found, `no queue ${name} in the catalog`).toBeDefined();
  return found!;
};

/** What the catalog held when Trigger.dev was removed (alpha.18): the nine schedules, in UTC. */
const CRONS: Readonly<Record<string, string>> = {
  'managed-sync-tick': '* * * * *',
  'managed-cadence-email': '30 7 * * *',
  'managed-digest': '0 8 * * *',
  'managed-drift-detect': '0 7 * * *',
  'managed-group-discovery': '30 6 * * *',
  'managed-invoice-push': '41 * * * *',
  'managed-month-invoices': '23 * * * *',
  'managed-purge-closed': '23 * * * *',
  'managed-retention': '17 3 * * *',
};

/** The eight asked for, and how each is admitted. */
const ON_DEMAND: Readonly<Record<string, string>> = {
  'run-delta-sync': 'singleton <mappingId>',
  'run-discovery': 'singleton <mappingId>',
  'run-confirmation': 'singleton confirm:<mappingId>',
  'run-verification': 'standard',
  'run-apply-deletion': 'standard',
  'run-apply-relocation': 'standard',
  'run-cutover': 'standard',
  'run-rollback': 'standard',
};

const camel = (name: string): string => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

describe('the seventeen queues, and the entry the worker forks for each', () => {
  const runs = readdirSync(RUNS).filter((file) => file.endsWith('.ts')).map((file) => file.replace(/\.ts$/, ''));

  it('has the nine schedules and the eight asked for, and nothing else', () => {
    expect(JOB_CATALOG.map((queue) => queue.name).sort()).toEqual([...Object.keys(CRONS), ...Object.keys(ON_DEMAND)].sort());
    for (const queue of JOB_CATALOG) expect(queue.kind, queue.name).toBe(queue.name in CRONS ? 'schedule' : 'on-demand');
  });

  it('forks one entry for each queue, and none for a queue the catalog does not hold', () => {
    expect(runs.sort()).toEqual(JOB_CATALOG.map((queue) => queue.name).sort());
  });

  it('serves each queue the run of its own job, which records a failure under the queue’s name', () => {
    for (const name of runs) {
      const entryText = code(readFileSync(join(RUNS, `${name}.ts`), 'utf8'));
      const run = `${camel(name)}Run`;
      expect(entryText, name).toMatch(new RegExp(`import \\{[^}]*\\b${run}\\b[^}]*\\} from '\\.\\./\\.\\./jobs/${name}\\.ts';`));
      expect(entryText, name).toMatch(new RegExp(`serveRuns\\(\\{ run: onPgBoss\\(\\w+, ${run}(, [^)]*)?\\) \\}\\);`));
      const job = code(readFileSync(join(HERE, `${name}.ts`), 'utf8'));
      expect(job, name).toMatch(new RegExp(`export const ${run} = leavesAReference\\(\\n\\s+'${name}',`));
    }
  });

  it('declares no Trigger.dev task any more, and loads no Trigger.dev SDK (workplan 0167 T9)', () => {
    for (const file of readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
      const text = code(readFileSync(join(HERE, file), 'utf8'));
      expect(text, file).not.toMatch(/@trigger\.dev\//);
      expect(text, file).not.toMatch(/\b(schemaTask|schedules\.task)\(/);
    }
  });
});

describe('what the catalog said when Trigger.dev was removed', () => {
  it('runs each schedule on its cron, in UTC, and gives a job asked for none', () => {
    for (const queue of JOB_CATALOG) {
      if (queue.kind === 'schedule') expect(queue.cron, queue.name).toBe(CRONS[queue.name]);
      else expect(Object.keys(queue), queue.name).not.toContain('cron');
    }
  });

  it('never lets a schedule overlap itself: one waiting and one running at most', () => {
    for (const queue of JOB_CATALOG.filter((q) => q.kind === 'schedule')) expect(queue.policy, queue.name).toBe('stately');
  });

  it('admits each job asked for as it always was: one pass, one count and one confirmation per migration', () => {
    for (const queue of JOB_CATALOG.filter((q) => q.kind === 'on-demand')) {
      const said = queue.policy === 'singleton' ? `singleton ${(queue as { serializedBy?: string }).serializedBy}` : queue.policy;
      expect(said, queue.name).toBe(ON_DEMAND[queue.name]);
    }
  });

  it('tries every run three times, from 5 s, doubling, at most a minute', () => {
    for (const queue of JOB_CATALOG) {
      expect([queue.attempts, queue.retryDelaySeconds, queue.retryDelayMaxSeconds], queue.name).toEqual([3, 5, 60]);
    }
    // pg-boss doubles a retry's delay when its queue backs off, which the runner always asks for.
    expect(read('packages/scheduler/src/pg-boss/job-runner.ts')).toContain('retryBackoff: true,');
  });

  it('gives every run an hour, but the cutover three, whose waits Trigger.dev’s hour never counted', () => {
    for (const queue of JOB_CATALOG) {
      expect(queue.maxDurationSeconds, queue.name).toBe(queue.name === 'run-cutover' ? 3 * 3600 : 3600);
    }
  });
});

describe('what the runner adds to each queue (workplan 0167 T6)', () => {
  it('beats every 30 s, so a run whose worker died is picked up again (0167, point 2)', () => {
    for (const queue of JOB_CATALOG) expect(queue.heartbeatSeconds, queue.name).toBe(30);
  });

  it('says nothing of how often a queue is asked for work: the runner asks every queue at one interval', () => {
    // `PgBossJobRunner#work` takes a concurrency and no interval of its own (0167 T6).
    for (const queue of JOB_CATALOG) expect(Object.keys(queue), queue.name).not.toContain('pollingIntervalSeconds');
  });

  it('works one run at a time, but the pass: the tick’s cap and one more, for the pass a cutover waits on', () => {
    expect(concurrencyOf(entry('run-delta-sync'), 3)).toBe(4);
    expect(concurrencyOf(entry('run-delta-sync'), 6)).toBe(7);
    for (const queue of JOB_CATALOG.filter((q) => q.name !== 'run-delta-sync')) {
      expect(concurrencyOf(queue, 6), queue.name).toBe(1);
    }
    for (const cap of [0, -1, 2.5, Number.NaN]) {
      expect(() => concurrencyOf(entry('run-delta-sync'), cap)).toThrow(/MAX_PASSES_IN_FLIGHT must be a whole number, at least 1/);
    }
  });
});

describe('the catalog is data', () => {
  it('imports nothing, so whoever reads it loads no pg-boss', () => {
    const text = code(read('packages/scheduler/src/pg-boss/catalog.ts'));
    expect(text).not.toMatch(/^\s*(?:import|export)\b[^\n]*\bfrom\s*['"]/m);
    expect(text).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*import\s*['"]/m);
  });

  it('is exported from the runner’s subpath, and each entry is what the runner’s start takes', () => {
    // Checked by the compiler: an entry the runner could not declare fails the typecheck here.
    const specs: readonly QueueSpec[] = JOB_CATALOG;
    expect(specs).toHaveLength(17);
    expect(read('packages/scheduler/src/pg-boss/index.ts')).toContain("export * from './catalog.ts';");
  });
});
