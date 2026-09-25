// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE KEPT PAST A CUTOVER (workplan 0128 T5, slice 2b).
 *
 * Each data type's phase is its own path row's now, where the migration's rows
 * add up to its status. That gives the gates one case the status cannot see: a
 * migration in `cutover`, its grace period over, with one data type kept in the
 * lane (`continuous`). The migration's own answer is "no longer runs"; the kept
 * data type's is "runs".
 *
 * Three gates ask it, in code that cannot see each other:
 *
 *   the managed tick         `ACTIVE_MAPPINGS_SQL`, one statement over every
 *                            organisation (`A_PATH_KEPT_AFTER_A_CUTOVER_WHERE`)
 *   the pass, between types  `whyThePassStops`, by the reader's `anyRuns`
 *   the appliance            `passesRunNow`, by the reader's `anyRuns`
 *
 * A tick that starts a pass the pass stops at once is a migration that never
 * copies; one that does not start a pass the reader would run is a kept data
 * type that stands still. So this file runs the tick's own query and the
 * reader on the same rows, over every status, both sides of the grace period,
 * and every pair of path rows two data types can have, stopped by their owner
 * or not, and holds them to one answer. A third data type is named but switched off, with a row that would
 * run: it is not a path, for either.
 *
 * PGlite: real Postgres, the same migration chain, no container.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createPgliteDb, readPathPhases, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import { FAILURE_WINDOW_MINUTES, SELF_HEALING_CATEGORIES } from '@openmig/orchestration/failing-backoff';
import { PASS_RUNNING_STATES, asMappingId, asTenantId, pathRunsNow } from '@openmig/shared';
import { whyThePassStops } from './stopping-a-pass.ts';

// UUID family 0128d000-…, unused elsewhere in the repo.
const TENANT = asTenantId('0128d000-e29b-41d4-a716-446655440001');
const CONNECTION = '0128d000-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0128d000-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0128d000-e29b-41d4-a716-446655440004';
const MAPPING = asMappingId('0128d000-e29b-41d4-a716-446655440005');

const STATUSES = ['active', 'paused', 'cutover', 'done', 'continuous'] as const;
/**
 * A path row's state, or `null` for a data type with no row. ` (stopped)` is a
 * row its owner stopped (0128 T4): kept in the lane, or before its cutover.
 */
const ROWS = [
  null,
  'ready',
  'active',
  'active (stopped)',
  'paused',
  'cutover',
  'continuous',
  'continuous (stopped)',
  'done',
] as const;
type Row = (typeof ROWS)[number];

let driver: LedgerDriver;
let ACTIVE_MAPPINGS_SQL: string;
let STALE_RUN_AFTER_MS: number;

/** One statement, on a connection taken and given back (PGlite has one). */
async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/**
 * The migration as a test places it: its status, its cutover's window (open
 * or over), and the rows of its included data types: files have none unless
 * a test gives them one. The switched-off one keeps a `continuous` row
 * throughout.
 */
async function place(status: string, windowOpen: boolean, email: Row, calendar: Row, file: Row = null): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  await query(
    `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                grace_period_started_at, updated_at)
     SELECT $1, $2, 'GRACE_PERIOD', 72, true, s, s
       FROM (SELECT now() - interval '72 hours' - ($3::int * interval '1 minute') AS s) t`,
    [TENANT, MAPPING, windowOpen ? -5 : 5],
  );
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1 AND domain <> 'contact'`, [MAPPING]);
  for (const [domain, state] of [
    ['email', email],
    ['calendar', calendar],
    ['file', file],
  ] as const) {
    if (state === null) continue;
    const [phase, stopped] = state.endsWith(' (stopped)') ? [state.slice(0, -' (stopped)'.length), true] : [state, false];
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at)
       VALUES ($1, $2, $3, $4, now(), ${stopped ? 'now()' : 'NULL'})`,
      [TENANT, MAPPING, domain, phase],
    );
  }
}

/** The tick's own query, with the tick's own parameters: is this migration chosen? */
async function theTickStartsIt(): Promise<boolean> {
  const rows = await query<{ id: string }>(ACTIVE_MAPPINGS_SQL, [
    STALE_RUN_AFTER_MS,
    [...SELF_HEALING_CATEGORIES],
    FAILURE_WINDOW_MINUTES,
    [...BILLABLE_RUN_KINDS],
    [...PASS_RUNNING_STATES],
  ]);
  return rows.some((r) => r.id === MAPPING);
}

const read = () => withTenant(driver, TENANT, (db) => readPathPhases(db, TENANT, MAPPING));

beforeAll(async () => {
  // Importing the tick opens a Pool at import; it is never used here.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  const tick = await import('./managed-sync-tick.ts');
  ACTIVE_MAPPINGS_SQL = tick.ACTIVE_MAPPINGS_SQL;
  STALE_RUN_AFTER_MS = tick.STALE_RUN_AFTER_MS;

  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'kept', 'active')`, [TENANT]);
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
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'cutover', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  for (const [domain, included] of [
    ['email', true],
    ['calendar', true],
    ['file', true],
    ['contact', false],
  ] as const) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, $4)`, [
      TENANT,
      MAPPING,
      domain,
      included,
    ]);
  }
  await query(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
     VALUES ($1, $2, 'contact', 'continuous', now())`,
    [TENANT, MAPPING],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('a data type kept in the lane after its cutover', () => {
  it('runs, while the migration and its other data type are past their grace period', async () => {
    await place('cutover', false, 'cutover', 'continuous');

    const phases = await read();
    expect(phases!.anyRuns).toBe(true);
    expect(pathRunsNow(phases!.phaseOf('calendar'))).toBe(true);
    expect(pathRunsNow(phases!.phaseOf('email'))).toBe(false);
    expect(await theTickStartsIt()).toBe(true);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBeNull();
  });

  it('does not run when the rows do not add up to the status: the status is believed', async () => {
    // A data type still before its cutover under a migration in `cutover`:
    // something wrote the status alone (the appliance's operator, by hand).
    await place('cutover', false, 'active', 'continuous');

    const phases = await read();
    expect(phases!.anyRuns).toBe(false);
    expect(phases!.phaseOf('calendar')).toEqual({ phase: 'cutover', stillCopies: false });
    expect(await theTickStartsIt()).toBe(false);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBe('no_longer_runs');
  });

  it('does not run while the migration is held, whatever its rows say', async () => {
    await place('paused', false, 'cutover', 'continuous');
    expect((await read())!.anyRuns).toBe(false);
    expect(await theTickStartsIt()).toBe(false);
  });

  it('is only a path when it is switched on: a switched-off data type kept in the lane runs nothing', async () => {
    await place('cutover', false, 'cutover', 'cutover');
    const phases = await read();
    expect(phases!.anyRuns).toBe(false);
    // Its row is ignored: it has the migration's phase, like a data type with none.
    expect(phases!.phaseOf('contact')).toEqual({ phase: 'cutover', stillCopies: false });
    expect(await theTickStartsIt()).toBe(false);
  });
});

describe('a data type kept in the lane, and stopped by its owner (0128 T4)', () => {
  it('runs nothing once the migration is past its grace period, in the tick and the reader alike', async () => {
    await place('cutover', false, 'cutover', 'continuous (stopped)');
    const phases = await read();
    expect(phases!.anyRuns).toBe(false);
    expect(phases!.phaseOf('calendar')).toEqual({ phase: 'continuous', stillCopies: false, stopped: true });
    expect(await theTickStartsIt()).toBe(false);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBe('no_longer_runs');
  });
});

describe('a third data type beside the kept one', () => {
  it('takes the kept one\'s passes away while it is before its cutover, in the tick and the reader alike', async () => {
    // Before its cutover under a migration in `cutover`, the rows do not add
    // up to the status. After it, or with no row, they do.
    const runs: Record<string, boolean> = {};
    for (const file of ROWS) {
      await place('cutover', false, 'cutover', 'continuous', file);
      const reader = (await read())!.anyRuns;
      expect(await theTickStartsIt(), `files ${file}`).toBe(reader);
      runs[String(file)] = reader;
    }
    expect(runs).toEqual({
      null: true,
      ready: false,
      active: false,
      'active (stopped)': false,
      paused: false,
      cutover: true,
      continuous: true,
      'continuous (stopped)': true,
      done: true,
    });
  });
});

describe('the tick, the pass and the appliance give one answer, for every combination', () => {
  it('over every status, both sides of the grace period, and every pair of rows', async () => {
    const disagreements: string[] = [];
    let keptDecides = 0;
    let cases = 0;
    for (const status of STATUSES) {
      for (const windowOpen of [true, false]) {
        for (const email of ROWS) {
          for (const calendar of ROWS) {
            cases += 1;
            await place(status, windowOpen, email, calendar);
            const reader = (await read())!.anyRuns;
            const tick = await theTickStartsIt();
            const pass = (await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)) === null;
            if (reader !== tick || reader !== pass) {
              disagreements.push(
                `${status}, window ${windowOpen ? 'open' : 'over'}, email ${email}, calendar ${calendar}: ` +
                  `reader ${reader}, tick ${tick}, pass ${pass}`,
              );
            }
            // The cases only a path's row can answer: its migration alone does not run.
            if (reader && status === 'cutover' && !windowOpen) keptDecides += 1;
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(cases).toBe(STATUSES.length * 2 * ROWS.length * ROWS.length);
    // One data type kept, beside one in its cutover, in both orders. Kept beside
    // a data type with no row, or with both kept, the rows add up to
    // `continuous`, which is not the status: the status is believed. Kept but
    // stopped by its owner, it runs nothing.
    expect(keptDecides).toBe(2);
  }, 120_000);
});
