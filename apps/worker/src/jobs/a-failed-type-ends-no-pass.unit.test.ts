// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILED DATA TYPE ENDS NO PASS (workplan 0143 T5, 2026-11-19).
 *
 * Found on the test environment on 2026-11-19. The owner's migration into a new
 * destination had its calendars failing on every pass, and its mail never
 * arrived, although mail itself never failed. The managed pass takes its data
 * types in the pass order, contact, calendar, task, email, file (T5, "every data
 * type gets a turn"), and a data type's catch re-threw, which ended the pass:
 * the data types after a failing one never had their turn, pass after pass.
 *
 * Now a failure is recorded where it happens, as it always was (the run event,
 * the status row with its side and reference, the app event), and the pass goes
 * on. Once every data type has had its turn the pass still fails, so Trigger.dev
 * records it and retries it as before (hard rule 9), with every data type that
 * failed named in the pass order. A pass TOLD to stop still stops: only a
 * failure stopped being a stop.
 *
 * Driven, not read. The other tests of this pass read `run-delta-sync.ts` as
 * text, because its body needs a database, a runner and five connectors. Here
 * the task's own run runs, over a real ledger (PGlite, the ledger's migrations), with
 * only what it cannot have stood in: the run is the one the task file exports
 * for its runner (`runDeltaSyncRun`, workplan 0167 T6), called with a
 * context of its own; the task's pool
 * is the PGlite driver; the five passes and their builders are scripted; and the
 * first-copy email, which reads managed tables, is counted instead of sent.
 * Everything between them is the pass's own: the order, the shares of time, the
 * read before each data type, the status rows, the run row and its events, the
 * app events, and the error the plane is handed.
 *
 * It failed before the change: after calendar threw, task, email and file were
 * never called and their status rows never written.
 *
 * The folder names are invented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { RunNotRetried } from './what-a-run-leaves.ts';
import { PassAbortError, withFailureSide } from '@openmig/core';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { setAppEventSink, type AppEvent } from '@openmig/shared';
import type { JobRunnerPort, RunContext } from './run-context.ts';

/** What the stand-ins below see and do, shared with the hoisted mocks. */
const stand = vi.hoisted(() => {
  const s = {
    /** The PGlite driver, handed to the task as its tenant pool. */
    driver: undefined as unknown,
    /** Each data type's pass, as it was called: its share of the time, and when. */
    calls: [] as Array<{ domain: string; deadline: number | undefined; at: number }>,
    /** The error a data type's pass throws, made fresh for each call. */
    failing: {} as Record<string, () => unknown>,
    /** What a failing pass does first, besides throwing. */
    onFail: undefined as undefined | (() => Promise<void>),
    /** The data type before which the pass's read of its migration fails. */
    stepFailsBefore: undefined as string | undefined,
    /** How often the pass asked about the first copy. */
    firstCopyAsked: 0,
  };
  /** A scripted pass for one data type: noted, then failing as told, or finishing two items. */
  const pass =
    (domain: string) =>
    async (deps: { deadline?: number }): Promise<Record<string, number>> => {
      s.calls.push({ domain, deadline: deps.deadline, at: Date.now() });
      const failure = s.failing[domain];
      if (failure) {
        await s.onFail?.();
        throw failure();
      }
      return { collectionsListed: 1, scanned: 2, created: 2, updated: 0, adopted: 0, skipped: 0 };
    };
  return { s, pass };
});

// The task opens its pool at import (`openTaskPools`); here it is the ledger below.
vi.mock('./task-pools.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-pools.ts')>()),
  openTaskPools: () => ({ tenant: stand.s.driver, end: () => Promise.resolve() }),
}));

// The five passes, scripted. Everything else of core is its own.
vi.mock('@openmig/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/core')>()),
  runContactSync: stand.pass('contact'),
  runCalendarSync: stand.pass('calendar'),
  runTaskSync: stand.pass('task'),
  runShadowPass: stand.pass('email'),
  runFileSync: stand.pass('file'),
}));

// Their builders, which would open a source and a target from stored access.
vi.mock('@openmig/orchestration/build-deps-from-mapping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/orchestration/build-deps-from-mapping')>()),
  buildDepsFromMapping: () => Promise.resolve({ close: () => Promise.resolve() }),
  buildDomainDepsFromMapping: () => Promise.resolve({ close: () => Promise.resolve() }),
}));

// The first-copy email reads managed tables this ledger does not carry: counted.
vi.mock('./the-first-copy-email.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./the-first-copy-email.ts')>()),
  announceFirstCopy: () => {
    stand.s.firstCopyAsked += 1;
    return Promise.resolve('not_yet');
  },
}));

// The read before each data type is the pass's own, unless a case breaks it.
vi.mock('./stopping-a-pass.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./stopping-a-pass.ts')>();
  return {
    ...real,
    passStepBefore: (...args: Parameters<typeof real.passStepBefore>) =>
      args[3] === stand.s.stepFailsBefore
        ? Promise.reject(new Error('the ledger could not be read'))
        : real.passStepBefore(...args),
  };
});

// UUID family 0143f5a0-…, unused elsewhere in the repo.
const P = '0143f5a0-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const CONNECTION = `${P}02`;
const SOURCE_MAILBOX = `${P}03`;
const TARGET_MAILBOX = `${P}04`;
const MAPPING = `${P}05`;

/** A provider's words, which the run log keeps and the plane's error must not. */
const CALENDAR_WORDS = 'HTTP 413 Payload Too Large: PUT /calendars/<mailbox>/Verjaardagen/feest.ics';
const EMAIL_WORDS = 'ETIMEDOUT while reading the folder Archief/Belastingen';

const calendarRefused = () => withFailureSide('target', new Error(CALENDAR_WORDS));
const emailTimedOut = () => withFailureSide('source', new Error(EMAIL_WORDS));

let driver: LedgerDriver;
let runPass: (payload: unknown, context: RunContext) => Promise<unknown>;

/** A pass asks nothing of the runner it runs on: each question it might ask fails the case. */
const NOTHING_ASKED: JobRunnerPort = {
  name: 'pg-boss',
  enqueue: () => Promise.reject(new Error('a pass enqueues nothing')),
  enqueueAndWait: () => Promise.reject(new Error('a pass waits for nothing')),
  verdict: () => Promise.reject(new Error('a pass asks after no run')),
  cancel: () => Promise.reject(new Error('a pass cancels no run')),
};
const events: AppEvent[] = [];

/** One statement, on a connection taken and given back (PGlite has one). */
async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/** One pass of the migration, as the tick starts it: what it threw, or null. */
async function aPass(): Promise<unknown> {
  try {
    await runPass({ tenantId: TENANT, mappingId: MAPPING }, { runId: 'run_stand_in', runner: NOTHING_ASKED });
    return null;
  } catch (error) {
    return error;
  }
}

interface StatusRow {
  readonly state: string;
  readonly last_error: string | null;
  readonly last_error_category: string | null;
  readonly failed_side: string | null;
  readonly last_error_reference: string | null;
}

/** Each data type's status row, by data type. */
async function statusRows(): Promise<Record<string, StatusRow>> {
  const rows = await query<StatusRow & { domain: string }>(
    `SELECT domain, state, last_error, last_error_category, failed_side, last_error_reference
       FROM migration_status WHERE mapping_id = $1`,
    [MAPPING],
  );
  return Object.fromEntries(rows.map(({ domain, ...row }) => [domain, row]));
}

/** The pass's run row, and its events in the order they were written. */
async function theRun(): Promise<{
  status: string;
  stats: { errors?: number; itemsProcessed?: number };
  events: Array<{ level: string; message: string }>;
}> {
  const runs = await query<{ id: string; status: string; stats: { errors?: number; itemsProcessed?: number } }>(
    `SELECT id, status, stats FROM run WHERE mapping_id = $1`,
    [MAPPING],
  );
  expect(runs, 'one pass, one run row').toHaveLength(1);
  const run = runs[0]!;
  const logged = await query<{ level: string; message: string }>(
    `SELECT level, message FROM run_event WHERE run_id = $1 ORDER BY at`,
    [run.id],
  );
  return { status: run.status, stats: run.stats, events: logged };
}

/** The data types whose passes were called, in order. */
const called = (): string[] => stand.s.calls.map((c) => c.domain);

beforeAll(async () => {
  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'every type a turn', 'active')`, [TENANT]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, '<mailbox>')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
     VALUES ($1, $2, $3, $4, 'active', 'mirror')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  // Selected in an order that is not the pass's: the pass sorts them itself.
  for (const domain of ['file', 'email', 'task', 'calendar', 'contact']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }

  // Imported only now: the task takes its pool when it is imported.
  stand.s.driver = driver;
  ({ runDeltaSyncRun: runPass } = await import('./run-delta-sync.ts'));
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  stand.s.calls = [];
  stand.s.failing = {};
  stand.s.onFail = undefined;
  stand.s.stepFailsBefore = undefined;
  stand.s.firstCopyAsked = 0;
  events.length = 0;
  setAppEventSink({ record: async (event) => void events.push(event) });
  // No data ceiling to read: the alpha's stage, as the tests of the first copy set it.
  vi.stubEnv('OWNPACE_STAGE', 'alpha');
  await query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
  await query(`DELETE FROM migration_status WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM run WHERE mapping_id = $1`, [MAPPING]);
});

afterEach(() => {
  setAppEventSink(undefined);
  vi.unstubAllEnvs();
});

describe('a pass whose calendar fails', () => {
  it('runs task, email and file after it, in order, and still fails, naming calendar', async () => {
    stand.s.failing = { calendar: calendarRefused };

    const thrown = await aPass();

    // Every data type had its turn, in the pass order, the ones after the failure too.
    expect(called()).toEqual(['contact', 'calendar', 'task', 'email', 'file']);

    // Each status row says what happened to its own data type.
    const rows = await statusRows();
    expect(Object.fromEntries(Object.entries(rows).map(([d, r]) => [d, r.state]))).toEqual({
      contact: 'completed',
      calendar: 'failed',
      task: 'completed',
      email: 'completed',
      file: 'completed',
    });
    const calendar = rows.calendar!;
    expect(calendar.last_error).toBe(CALENDAR_WORDS);
    expect(calendar.failed_side).toBe('target');
    expect(calendar.last_error_category).toBe('target_refused');
    expect(calendar.last_error_reference).toMatch(/^[0-9a-f]{8}$/);

    // The app event, under the same reference and category.
    expect(events).toEqual([
      {
        level: 'error',
        event: 'sync.calendar.failed',
        reference: calendar.last_error_reference,
        tenantId: TENANT,
        mappingId: MAPPING,
        category: 'target_refused',
      },
    ]);

    // The pass failed, so the plane retries it as it always did: an ordinary
    // error, naming calendar with that reference, and none of the words.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RunNotRetried);
    expect((thrown as Error).message).toBe(
      `calendar sync failed (target_refused). Reference ${calendar.last_error_reference}.`,
    );
    expect((thrown as Error).message).not.toContain('Verjaardagen');

    // The run closed failed, with one error, and what the others copied counted.
    const run = await theRun();
    expect(run.status).toBe('failed');
    expect(run.stats.errors).toBe(1);
    expect(run.stats.itemsProcessed).toBe(8);
    const failedAt = run.events.findIndex((e) => e.message === `calendar sync failed: ${CALENDAR_WORDS}`);
    expect(failedAt, 'the failure is in the run log, verbatim').toBeGreaterThan(-1);
    expect(run.events[failedAt]!.level).toBe('error');
    for (const domain of ['task', 'email', 'file']) {
      const at = run.events.findIndex((e) => e.message === `${domain}: 2 created, 0 updated, 0 skipped`);
      expect(at, `${domain} says what it did`).toBeGreaterThan(failedAt);
    }

    // The first copy this pass finished is asked about once, on the way out.
    expect(stand.s.firstCopyAsked).toBe(1);

    // The runner's own id for the run, from its context, is the row's handle
    // (workplan 0167 T6): what the erasure's quiesce asks the runner about.
    const [ref] = await query<{ orchestrator_ref: string | null }>(
      'SELECT orchestrator_ref FROM run WHERE mapping_id = $1',
      [MAPPING],
    );
    expect(ref!.orchestrator_ref).toBe('run_stand_in');
  });

  it('hands the time calendar did not use to the data types after it', async () => {
    stand.s.failing = { calendar: calendarRefused };
    await aPass();

    // The last data type is handed what is left of the pass: the pass's own deadline.
    const passDeadline = stand.s.calls.at(-1)!.deadline!;
    stand.s.calls.forEach(({ domain, deadline, at }, i) => {
      const typesLeft = stand.s.calls.length - i;
      // Its share of what was left when it started: never the whole pass but
      // for the last, and asked afresh, so time not used flows on.
      expect(Math.abs(deadline! - at - (passDeadline - at) / typesLeft), domain).toBeLessThan(2_000);
    });
    // Calendar failed at once, so task, after it, has a third of nearly all
    // that calendar had a quarter of.
    const [, calendar, task] = stand.s.calls;
    expect(task!.deadline! - task!.at).toBeGreaterThan(calendar!.deadline! - calendar!.at);
  });
});

describe('a pass in which two data types fail', () => {
  it('names both, in the pass order, each under its own reference, and is still retried', async () => {
    stand.s.failing = { email: emailTimedOut, calendar: calendarRefused };

    const thrown = await aPass();

    expect(called()).toEqual(['contact', 'calendar', 'task', 'email', 'file']);
    const rows = await statusRows();
    expect(Object.fromEntries(Object.entries(rows).map(([d, r]) => [d, r.state]))).toEqual({
      contact: 'completed',
      calendar: 'failed',
      task: 'completed',
      email: 'failed',
      file: 'completed',
    });
    expect(rows.email!.failed_side).toBe('source');
    expect(rows.email!.last_error_category).toBe('network');
    const [calendarRef, emailRef] = [rows.calendar!.last_error_reference, rows.email!.last_error_reference];
    expect(calendarRef).not.toBe(emailRef);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RunNotRetried);
    expect((thrown as Error).message).toBe(
      `calendar sync failed (target_refused). Reference ${calendarRef}. ` +
        `email sync failed (network). Reference ${emailRef}.`,
    );
    for (const words of ['Verjaardagen', 'Archief', 'ETIMEDOUT']) expect((thrown as Error).message).not.toContain(words);

    expect(events.map((e) => [e.event, e.reference])).toEqual([
      ['sync.calendar.failed', calendarRef],
      ['sync.email.failed', emailRef],
    ]);
    const run = await theRun();
    expect(run.status).toBe('failed');
    // The run page reads "2 errors", not the "1 error" a pass could only have had before.
    expect(run.stats.errors).toBe(2);
    expect(run.events.filter((e) => e.level === 'error').map((e) => e.message)).toEqual([
      `calendar sync failed: ${CALENDAR_WORDS}`,
      `email sync failed: ${EMAIL_WORDS}`,
    ]);
    // Said once for the pass, not once per failure.
    expect(stand.s.firstCopyAsked).toBe(1);
  });

  it('is not retried when one of them stopped itself after items failed in a row, and names the other all the same', async () => {
    stand.s.failing = {
      calendar: () => withFailureSide('target', new PassAbortError(`calendar: 25 items failed in a row. Last error: ${CALENDAR_WORDS}`)),
      email: emailTimedOut,
    };

    const thrown = await aPass();

    expect(called()).toEqual(['contact', 'calendar', 'task', 'email', 'file']);
    const rows = await statusRows();
    expect(thrown).toBeInstanceOf(RunNotRetried);
    expect((thrown as Error).message).toBe(
      `calendar sync stopped itself after items failed in a row (${rows.calendar!.last_error_category}). ` +
        `Reference ${rows.calendar!.last_error_reference}. ` +
        `email sync failed (network). Reference ${rows.email!.last_error_reference}.`,
    );
  });
});

describe('a pass told to stop', () => {
  it('still stops after a failure: a pause heard after calendar failed takes no new data type', async () => {
    // Paused while calendar was failing: the read before task hears it.
    stand.s.failing = { calendar: calendarRefused };
    stand.s.onFail = async () => {
      await query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    };

    const thrown = await aPass();

    expect(called()).toEqual(['contact', 'calendar']);
    // Nothing was started for the data types after the stop: no status rows.
    const rows = await statusRows();
    expect(Object.fromEntries(Object.entries(rows).map(([d, r]) => [d, r.state]))).toEqual({
      contact: 'completed',
      calendar: 'failed',
    });
    // The failure still fails the pass, and is the only one named.
    expect((thrown as Error).message).toBe(
      `calendar sync failed (target_refused). Reference ${rows.calendar!.last_error_reference}.`,
    );
    // It stopped once, before task, and asked about no data type after it. The
    // stop says it is not a failure, and no longer that nothing failed.
    const run = await theRun();
    const stops = run.events.filter((e) => e.message.startsWith('pass stopped before'));
    expect(stops.map((e) => e.message.slice(0, e.message.indexOf(':')))).toEqual(['pass stopped before task']);
    expect(stops[0]!.message).toContain('the stop itself is not a failure (failed before it: calendar)');
    expect(stops[0]!.message).not.toContain('nothing failed');
  });

  it('still stops where it always did when nothing failed, and still says so', async () => {
    // Paused before the first data type, with nothing failing at all.
    await query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);

    const output = await runPass({ tenantId: TENANT, mappingId: MAPPING }, { runner: NOTHING_ASKED });

    // Not a failure, so nothing to retry: the pass returns, and says where it stopped.
    expect(output).toMatchObject({
      success: true,
      asked: ['contact', 'calendar', 'task', 'email', 'file'],
      domains: {},
      stoppedBefore: 'contact',
      stoppedBecause: 'no_longer_runs',
    });
    expect(called()).toEqual([]);
    const run = await theRun();
    expect(run.status).toBe('succeeded');
    // A runner that gave no id leaves the row without a handle, never a guessed one.
    const [ref] = await query<{ orchestrator_ref: string | null }>(
      'SELECT orchestrator_ref FROM run WHERE mapping_id = $1',
      [MAPPING],
    );
    expect(ref!.orchestrator_ref).toBeNull();
    const stops = run.events.filter((e) => e.message.startsWith('pass stopped before'));
    expect(stops).toHaveLength(1);
    expect(stops[0]!.message).toMatch(/^pass stopped before contact: .* — nothing failed, /);
  });
});

describe('a pass that something else ends after a data type failed', () => {
  it('names the failed data type first, then what ended it, and counts both', async () => {
    stand.s.failing = { calendar: calendarRefused };
    stand.s.stepFailsBefore = 'task';

    const thrown = await aPass();

    expect(called()).toEqual(['contact', 'calendar']);
    const rows = await statusRows();
    const ended = events.find((e) => e.event === 'task.run-delta-sync.failed');
    expect(ended, 'what ended the pass is recorded under a reference of its own').toBeDefined();
    expect((thrown as Error).message).toBe(
      `calendar sync failed (target_refused). Reference ${rows.calendar!.last_error_reference}. ` +
        `run-delta-sync failed (${ended!.category}). Reference ${ended!.reference}.`,
    );
    const run = await theRun();
    expect(run.status).toBe('failed');
    expect(run.stats.errors).toBe(2);
  });
});
