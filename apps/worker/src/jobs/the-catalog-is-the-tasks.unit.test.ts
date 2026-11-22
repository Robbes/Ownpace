// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CATALOG IS THE TASKS (ADR-0054; workplan 0167 T6).
 *
 * The pg-boss runner declares a queue for each job before it works one, from
 * the job catalog (`packages/scheduler/src/pg-boss/catalog.ts`), and the jobs
 * are still Trigger.dev tasks, each declared in its own file here. Two lists of
 * the same seventeen jobs, with no compiler between them: a task added,
 * renamed or re-timed in one and not the other would run differently, or not
 * at all, the day the switch moves. So the catalog is held to the tasks, read
 * from their source:
 *
 * 1. the same seventeen names, each a task's id: nine on a cron, eight asked
 *    for;
 * 2. each schedule's cron, in UTC, as its task states it;
 * 3. the keys: one pass and one count per migration, on a `singleton` queue
 *    serialised by what every caller passes Trigger.dev as `concurrencyKey`,
 *    the migration's id, where Trigger.dev's queue has a limit of one; a
 *    confirmation by its route's `confirm:` and the id; a schedule that never
 *    overlaps itself;
 * 4. the retries and the time limit `trigger.config.ts` gives every task, none
 *    of which names its own;
 * 5. what the runner adds besides, as the plan of 0167 T6 set it;
 * 6. the catalog is data: it imports nothing, so reading it loads no pg-boss,
 *    and each entry is what the runner's `start` takes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG, concurrencyOf, type JobCatalogEntry, type QueueSpec } from '@openmig/scheduler/pg-boss';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** Comments removed: a comment may name what the code does not. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

interface Task {
  readonly file: string;
  readonly id: string;
  readonly kind: 'schedule' | 'on-demand' | 'neither';
  readonly cron: string | undefined;
  /** The task's own Trigger.dev queue, when it names one: its limit. */
  readonly queueLimit: number | undefined;
  /** What the definition sets beyond its run, its id, its schedule or schema, its queue and its machine. */
  readonly options: string;
}

/** Every task file under src/jobs, as Trigger.dev registers it. */
const TASKS: readonly Task[] = readdirSync(HERE)
  .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
  .flatMap((file): Task[] => {
    const text = code(readFileSync(join(HERE, file), 'utf8'));
    const id = /\n {2}id: '([a-z-]+)',/.exec(text)?.[1];
    if (id === undefined) return [];
    const definition = /\nexport const \w+ = (schedules\.task|schemaTask)\(\{\n([\s\S]*?)\n\}\);/.exec(text);
    const kind = definition?.[1] === 'schedules.task' ? 'schedule' : definition?.[1] === 'schemaTask' ? 'on-demand' : 'neither';
    const queueName = /\n {2}queue: (\w+),/.exec(text)?.[1];
    const limit =
      queueName === undefined
        ? undefined
        : new RegExp(`const ${queueName} = queue\\(\\{ name: '[a-z-]+', concurrencyLimit: (\\d+) \\}\\);`).exec(text)?.[1];
    return [
      {
        file,
        id,
        kind,
        cron: /\n {2}cron: '([^']+)',/.exec(text)?.[1],
        queueLimit: limit === undefined ? undefined : Number(limit),
        options: definition?.[2] ?? '',
      },
    ];
  });

const entry = (name: string): JobCatalogEntry => {
  const found = JOB_CATALOG.find((queue) => queue.name === name);
  expect(found, `the job catalog has no queue named ${name}`).toBeDefined();
  return found!;
};

describe('the catalog is the tasks: their names and their kinds', () => {
  it('finds the seventeen task files, each with its kind, so the rest is not vacuous', () => {
    expect(TASKS).toHaveLength(17);
    expect(TASKS.filter((task) => task.kind === 'neither').map((task) => task.file)).toEqual([]);
  });

  it('holds a queue for each task, named by its id, and for nothing else', () => {
    const names = JOB_CATALOG.map((queue) => queue.name);
    expect(new Set(names).size, 'a queue is named twice').toBe(names.length);
    expect([...names].sort()).toEqual(TASKS.map((task) => task.id).sort());
  });

  it('has the nine schedules and the eight asked for, each the kind its task is', () => {
    expect(JOB_CATALOG.filter((queue) => queue.kind === 'schedule')).toHaveLength(9);
    expect(JOB_CATALOG.filter((queue) => queue.kind === 'on-demand')).toHaveLength(8);
    for (const task of TASKS) expect(entry(task.id).kind, task.id).toBe(task.kind);
  });

  it('runs each schedule on its task’s cron, and gives a job asked for none', () => {
    for (const task of TASKS) {
      const queue = entry(task.id);
      if (task.kind === 'schedule') {
        expect(task.cron, `${task.file} names no cron`).toBeDefined();
        expect(queue.kind === 'schedule' ? queue.cron : undefined, task.id).toBe(task.cron);
      } else {
        expect(task.cron, `${task.file} is asked for and names a cron`).toBeUndefined();
        expect('cron' in queue, task.id).toBe(false);
      }
    }
  });
});

describe('the catalog is the tasks: their keys', () => {
  /** The tick's and a cutover's enqueue, which the run hands its runner (run-context.ts). */
  const tick = code(read('apps/worker/src/jobs/managed-sync-tick.ts'));
  const cutover = code(read('apps/worker/src/jobs/run-cutover.ts'));
  /** The API's doors, each of which passes Trigger.dev the key its queue is serialised by. */
  const syncNow = code(read('apps/api/src/routes/migrations/sync-now.ts'));
  const discovery = code(read('apps/api/src/routes/migrations/job-resolution.ts'));
  const confirmation = code(read('apps/api/src/routes/migrations/operating-routes.ts'));

  it('never lets a schedule overlap itself: one waiting and one running at most', () => {
    for (const queue of JOB_CATALOG.filter((q) => q.kind === 'schedule')) expect(queue.policy, queue.name).toBe('stately');
  });

  it('runs one pass per migration, by the key the tick, a cutover and Sync now pass, on a queue of one', () => {
    const pass = entry('run-delta-sync');
    expect(pass.kind === 'on-demand' && [pass.policy, pass.serializedBy]).toEqual(['singleton', '<mappingId>']);
    expect(TASKS.find((task) => task.id === 'run-delta-sync')!.queueLimit).toBe(1);
    expect(tick).toMatch(
      /context\.runner\.enqueue\(\s*'run-delta-sync',\s*\{ tenantId: m\.tenant_id, mappingId: m\.id, domains: m\.domains \},\s*\{\s*serializeBy: m\.id,/,
    );
    expect(cutover).toMatch(
      /context\.runner\.enqueueAndWait\(\s*'run-delta-sync',\s*\{ tenantId, mappingId, [^\n]*\},\s*\{\s*serializeBy: mappingId,/,
    );
    expect(syncNow).toMatch(/concurrencyKey: mappingId,/);
  });

  it('runs one count per migration, by the key the API passes, on a queue of one', () => {
    const count = entry('run-discovery');
    expect(count.kind === 'on-demand' && [count.policy, count.serializedBy]).toEqual(['singleton', '<mappingId>']);
    expect(TASKS.find((task) => task.id === 'run-discovery')!.queueLimit).toBe(1);
    const from = discovery.indexOf('export function discoveryTriggerOptions(');
    expect(from, 'job-resolution.ts no longer defines discoveryTriggerOptions').toBeGreaterThan(-1);
    const options = discovery.slice(from, discovery.indexOf('\n}\n', from));
    expect(options).toMatch(/\n\s+concurrencyKey: mappingId,\n/);
  });

  it('runs one confirmation per migration, by the key its route passes, which no queue on Trigger.dev bounds', () => {
    const confirm = entry('run-confirmation');
    expect(confirm.kind === 'on-demand' && [confirm.policy, confirm.serializedBy]).toEqual([
      'singleton',
      'confirm:<mappingId>',
    ]);
    expect(TASKS.find((task) => task.id === 'run-confirmation')!.queueLimit).toBeUndefined();
    expect(confirmation).toContain('concurrencyKey: `confirm:${s.mappingId}`,');
  });

  it('serialises nothing else: every other job asked for runs as it is asked', () => {
    const keyed = ['run-delta-sync', 'run-discovery', 'run-confirmation'];
    const asked: readonly JobCatalogEntry[] = JOB_CATALOG.filter((q) => q.kind === 'on-demand' && !keyed.includes(q.name));
    for (const queue of asked) {
      expect(queue.kind === 'on-demand' && [queue.policy, queue.serializedBy], queue.name).toEqual(['standard', undefined]);
      expect(TASKS.find((task) => task.id === queue.name)!.queueLimit, queue.name).toBeUndefined();
    }
  });
});

describe('the catalog is the tasks: their retries and their time', () => {
  const config = read('apps/worker/trigger.config.ts');
  const retries = /\n\s+default: \{ maxAttempts: (\d+), minTimeoutInMs: ([\d_]+), maxTimeoutInMs: ([\d_]+), factor: (\d+) \},\n/.exec(
    config,
  );
  const maxDuration = /\n\s+maxDuration: (\d+),\n/.exec(config);
  const ms = (digits: string): number => Number(digits.replace(/_/g, ''));

  it('reads the config’s defaults, which no task overrides', () => {
    expect(retries, 'trigger.config.ts no longer states its default retries on one line').not.toBeNull();
    expect(maxDuration, 'trigger.config.ts no longer states its maxDuration').not.toBeNull();
    for (const task of TASKS) expect(task.options, task.file).not.toMatch(/(?:^|\n) {2}(?:retry|maxDuration):/);
  });

  it('tries every run as often, and waits as long between, as the config: from 5 s, doubling, at most a minute', () => {
    const [, attempts, firstMs, mostMs, factor] = retries!;
    for (const queue of JOB_CATALOG) {
      expect(
        [queue.attempts, queue.retryDelaySeconds * 1000, queue.retryDelayMaxSeconds * 1000],
        queue.name,
      ).toEqual([Number(attempts), ms(firstMs!), ms(mostMs!)]);
    }
    // pg-boss doubles a retry's delay when its queue backs off, which the runner always asks for.
    expect(Number(factor)).toBe(2);
    expect(read('packages/scheduler/src/pg-boss/job-runner.ts')).toContain('retryBackoff: true,');
  });

  it('gives every run the hour the config gives every task', () => {
    for (const queue of JOB_CATALOG) expect(queue.maxDurationSeconds, queue.name).toBe(Number(maxDuration![1]));
  });
});

describe('what the runner adds to each queue (workplan 0167 T6)', () => {
  it('beats every 30 s, so a run whose worker died is picked up again (0167, point 2)', () => {
    for (const queue of JOB_CATALOG) expect(queue.heartbeatSeconds, queue.name).toBe(30);
  });

  it('asks for work every 2 s where somebody waits, every 10 s for the minute’s tick and 30 s for the rest', () => {
    for (const queue of JOB_CATALOG) {
      const every = queue.kind === 'on-demand' ? 2 : queue.name === 'managed-sync-tick' ? 10 : 30;
      expect(queue.pollingIntervalSeconds, queue.name).toBe(every);
    }
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
