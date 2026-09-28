// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN THAT KEPT A TESTER'S WORDS (workplan 0134, open question 3, answered
 * (a) on 2026-09-27).
 *
 * Trigger.dev keeps every run's error, output and logs in its own database,
 * with no limit, and every dump of that database carries them (0134 T1 (c)).
 * Three doors let a tester's words in: a failed run's error (the last item's
 * "Last error: …" names a file), discovery's output (each failed data type's
 * error, verbatim), and the run's logs (`log.*` names folders and files on
 * ordinary paths). The owner chose to keep the words out, not to stop the
 * dumps or prune them: each door lets through a reference and a category, and
 * the words go to the container's output under the same reference.
 *
 * Run where it can be: the error, the event and the log line of a failure;
 * discovery's outcomes. Read where it cannot: each task file, which builds a
 * database pool when it is imported, and `trigger.config.ts`, which sits outside
 * `src` and is read by the Trigger.dev CLI, not by this runtime.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError } from '@openmig/core';
import { setAppEventSink, type AppEvent } from '@openmig/shared';
import { leavesAReference, outcomesForThePlane, planeErrorFor } from './what-a-run-leaves.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A tester's words, as a provider would hand them back. Invented. */
const FOLDER = 'Privé/Belastingdienst 2025';
const ADDRESS = 'jan.jansen@example.test';
const WORDS = `NO [NONEXISTENT] Folder '${FOLDER}' does not exist for ${ADDRESS}`;
const TENANT = '0f2b6a4e-6d4e-4c8e-9a51-7c3d2e1f0a01';
const MAPPING = '5b9c1d2e-3f4a-4b6c-8d7e-9f0a1b2c3d02';

const SAID = /^(.+) (failed|stopped itself after items failed in a row|ended, and is not retried) \(([a-z_]+)\)\. Reference ([0-9a-f]{8})\.$/;

/** What a failure recorded and wrote, around one call. */
function watch() {
  const events: AppEvent[] = [];
  setAppEventSink({ record: async (event) => void events.push(event) });
  const lines: string[] = [];
  const keep = (...args: unknown[]) =>
    void lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
  vi.spyOn(console, 'error').mockImplementation(keep);
  vi.spyOn(console, 'warn').mockImplementation(keep);
  return { events, lines };
}

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('a failed run’s error', () => {
  it('leaves with what was being done, a category and a reference, and none of the words', async () => {
    watch();
    const error = await planeErrorFor(new Error(WORDS), { task: 'run-discovery', tenantId: TENANT, mappingId: MAPPING });
    expect(error.message).toMatch(SAID);
    expect(error.message.startsWith('run-discovery failed (')).toBe(true);
    for (const text of [error.message, error.stack ?? '', JSON.stringify(error)]) {
      expect(text).not.toContain('Belastingdienst');
      expect(text).not.toContain(ADDRESS);
    }
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  it('writes the words to the container’s output, and records the event, under the same reference', async () => {
    const { events, lines } = watch();
    const error = await planeErrorFor(new Error(WORDS), { task: 'run-verification', tenantId: TENANT, mappingId: MAPPING });
    const [, , , category, reference] = SAID.exec(error.message)!;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`[ref ${reference}]`);
    expect(lines[0]).toContain(FOLDER);
    expect(events).toEqual([
      {
        level: 'error',
        event: 'task.run-verification.failed',
        reference,
        tenantId: TENANT,
        mappingId: MAPPING,
        category,
      },
    ]);
  });

  it('carries the reference a pass’s own catch recorded, and records nothing twice', async () => {
    const { events, lines } = watch();
    const error = await planeErrorFor(
      new Error(WORDS),
      { task: 'run-delta-sync', tenantId: TENANT, mappingId: MAPPING },
      { doing: 'email sync', reference: 'a1b2c3d4', category: 'source_refused' },
    );
    expect(error.message).toBe('email sync failed (source_refused). Reference a1b2c3d4.');
    expect(events).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('keeps a task’s own verdict a verdict: not retried, recorded as a warning, and without its words', async () => {
    const { events } = watch();
    const error = await planeErrorFor(new AbortTaskRunError(`Cutover refused for ${ADDRESS}`), {
      task: 'run-cutover',
    });
    expect(error).toBeInstanceOf(AbortTaskRunError);
    expect(error.message).toMatch(/^run-cutover ended, and is not retried \([a-z_]+\)\. Reference [0-9a-f]{8}\.$/);
    expect(events.map((e) => [e.level, e.event])).toEqual([['warn', 'task.run-cutover.failed']]);
  });

  it('keeps a refusal from Trigger.dev’s own API unretried, as its executor would, and records it as an error', async () => {
    const { events } = watch();
    const refusal = Object.assign(new Error(`Task not found for ${ADDRESS}`), { name: 'TriggerApiError', status: 404 });
    const error = await planeErrorFor(refusal, { task: 'run-cutover' });
    expect(error).toBeInstanceOf(AbortTaskRunError);
    expect(error.message).not.toContain(ADDRESS);
    expect(events.map((e) => e.level)).toEqual(['error']);
    const busy = Object.assign(new Error('Too many requests'), { name: 'TriggerApiError', status: 429 });
    expect(await planeErrorFor(busy, { task: 'run-cutover' })).not.toBeInstanceOf(AbortTaskRunError);
  });

  it('keeps a pass that stopped itself from being retried, and says so without the last item’s words', async () => {
    watch();
    const error = await planeErrorFor(new PassAbortError(`email: 25 items failed in a row. Last error: ${WORDS}`), {
      task: 'run-delta-sync',
    });
    expect(error).toBeInstanceOf(AbortTaskRunError);
    expect(error.message).toMatch(/^run-delta-sync stopped itself after items failed in a row /);
    expect(error.message).not.toContain('Belastingdienst');
  });
});

describe('a task’s run', () => {
  it('lets nothing it throws leave but the plane’s error, with the payload’s ids', async () => {
    const { events } = watch();
    const run = leavesAReference('run-apply-deletion', async (_payload: unknown, _context: unknown) => {
      throw new Error(WORDS);
    });
    const thrown = await run({ tenantId: TENANT, mappingId: MAPPING, other: 'x' }, {}).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/^run-apply-deletion failed \([a-z_]+\)\. Reference [0-9a-f]{8}\.$/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'task.run-apply-deletion.failed', tenantId: TENANT, mappingId: MAPPING });
  });

  it('hands back what a run returns, untouched', async () => {
    const output = { success: true, counts: { created: 3 } };
    const run = leavesAReference('run-verification', async (_payload: unknown, _context: unknown) => output);
    expect(await run({}, {})).toBe(output);
  });
});

describe('discovery’s output', () => {
  it('keeps a failed data type’s category and a reference, and not its words', async () => {
    const { events, lines } = watch();
    const kept = await outcomesForThePlane(
      [
        { domain: 'email', ok: true },
        { domain: 'calendar', ok: false, error: `401 Unauthorized for ${ADDRESS} at /calendars/jan/${FOLDER}` },
      ],
      { task: 'run-discovery', tenantId: TENANT, mappingId: MAPPING },
    );
    expect(kept[0]).toEqual({ domain: 'email', ok: true });
    expect(kept[1]).toMatchObject({ domain: 'calendar', ok: false });
    const failed = kept[1] as { category: string; reference: string };
    expect(failed.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(kept)).not.toContain(ADDRESS);
    expect(JSON.stringify(kept)).not.toContain('Belastingdienst');
    expect(events).toEqual([
      {
        level: 'error',
        event: 'discovery.calendar.failed',
        reference: failed.reference,
        tenantId: TENANT,
        mappingId: MAPPING,
        category: failed.category,
      },
    ]);
    expect(lines.join('\n')).toContain(`[ref ${failed.reference}]`);
    expect(lines.join('\n')).toContain(ADDRESS);
  });
});

describe('the run’s logs', () => {
  it('stay in the container’s output: the config turns Trigger.dev’s console interceptor off', () => {
    const config = readFileSync(join(HERE, '../../trigger.config.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    expect(config).toMatch(/^ {2}disableConsoleInterceptor: true,$/m);
  });
});

/** Every task file under src/jobs, without its comment lines. */
function taskFiles(): Array<{ file: string; code: string }> {
  return readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .map((file) => ({
      file,
      code: readFileSync(join(HERE, file), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n'),
    }))
    .filter(({ code }) => /\n {2}id: '[a-z-]+',/.test(code));
}

describe('every task', () => {
  const tasks = taskFiles();

  it('is found, all fourteen of them', () => {
    expect(tasks.map((t) => t.file).sort()).toHaveLength(14);
  });

  it.each(tasks.map((t) => [t.file, t.code] as const))('%s runs inside leavesAReference, under its own id', (_file, code) => {
    const id = /\n {2}id: '([a-z-]+)',/.exec(code)![1];
    const runs = code.match(/\n {2}run: /g) ?? [];
    expect(runs).toHaveLength(1);
    expect(code).toContain(`\n  run: leavesAReference('${id}', async (`);
  });

  it.each(tasks.map((t) => [t.file, t.code] as const))('%s does not use the SDK’s logger', (_file, code) => {
    for (const statement of code.match(/import \{[^}]*\} from '@trigger\.dev\/sdk';/g) ?? []) {
      expect(statement).not.toMatch(/\blogger\b/);
    }
    expect(code).not.toMatch(/\blogger\.(log|info|warn|error|debug)\(/);
  });

  it.each(tasks.map((t) => [t.file, t.code] as const))('%s points its errors at the operator’s log page', (_file, code) => {
    // Itself, on its own pool (a job that spans organisations), or through
    // openTaskPools (a per-tenant one, 0138 T1), which points it at the
    // tenant pool: the case below.
    expect(
      code.includes('setAppEventSink(appEventSinkOn(pgDriver(pool)));') || code.includes('openTaskPools()'),
    ).toBe(true);
  });

  it('openTaskPools points a per-tenant task’s errors at its tenant pool, where app_user may insert them', () => {
    const code = readFileSync(join(HERE, 'task-pools.ts'), 'utf8');
    expect(code).toContain('setAppEventSink(appEventSinkOn(pgDriver(tenant)));');
  });
});

describe('the two tasks that hand words on themselves', () => {
  it('run-discovery returns what outcomesForThePlane kept', () => {
    const code = readFileSync(join(HERE, 'run-discovery.ts'), 'utf8');
    expect(code).toMatch(/const outcomes = await outcomesForThePlane\(\s*await discoverDomains\(/);
    expect(code).toMatch(/return \{ outcomes \};/);
  });

  it('run-delta-sync’s data type fails with the reference its catch recorded', () => {
    const code = readFileSync(join(HERE, 'run-delta-sync.ts'), 'utf8');
    expect(code).toMatch(
      /await recordAppEvent\(failed\);[\s\S]{0,400}?throw await planeErrorFor\(\s*error,[\s\S]{0,120}?\{ doing: `\$\{domain\} sync`, reference: failed\.reference,/,
    );
    expect(code).not.toMatch(/^\s*throw error;/m);
  });
});
