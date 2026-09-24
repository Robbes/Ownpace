// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRACE PERIOD THAT COPIES (workplan 0128 T2; the owner, 2026-09-24, D1
 * (a): "bounded by the grace period, and slotless").
 *
 * From a cutover's execute until its grace period ends, a migration that was
 * running keeps being copied, under the after-cutover rules. Before this, a
 * mapping in `cutover` was never scheduled, while the ledger beside it called
 * the grace period "both systems active": mail that reached the old server
 * while the MX record propagated was copied by nothing.
 *
 * The rule depends on the time, so no status word can say it, and it is said
 * twice: `CUTOVER_STILL_COPIES_WHERE` in SQL, for the tick that chooses what
 * to schedule in one statement, and `cutoverStillCopiesAt` in TypeScript.
 * This file holds the two in step over every cutover state, both sides of the
 * end, and a migration that was not running at execute. Then it drives the
 * real execute step to show where the answer comes from, and asks the tick's
 * own query and the pass's own re-read what they do with it.
 *
 * PGlite: real Postgres, the same migration chain, no container.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import {
  createPgliteDb,
  cutoverStillCopies,
  mappingLifecyclePort,
  runMigrations,
  tenantCutoverStore,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import { FAILURE_WINDOW_MINUTES, SELF_HEALING_CATEGORIES } from '@openmig/orchestration/failing-backoff';
import { closeCutover, cutoverWindowOf, enterCutover, type CutoverState, type CutoverStatus } from '@openmig/core';
import {
  PASS_RUNNING_STATES,
  asMappingId,
  asTenantId,
  cutoverStillCopiesAt,
  runsPassesNow,
} from '@openmig/shared';
import { whyThePassStops } from './stopping-a-pass.ts';

// UUID family 0128a000-…, unused elsewhere in the repo.
const TENANT = asTenantId('0128a000-e29b-41d4-a716-446655440001');
const CONNECTION = '0128a000-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0128a000-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0128a000-e29b-41d4-a716-446655440004';
const MAPPING = asMappingId('0128a000-e29b-41d4-a716-446655440005');

const STATES: readonly CutoverState[] = [
  'PREPARING',
  'READY_FOR_CUTOVER',
  'APPROVED',
  'CUTOVER_IN_PROGRESS',
  'GRACE_PERIOD',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
];

let driver: LedgerDriver;
let db: PgDatabase;
let ACTIVE_MAPPINGS_SQL: string;
let STALE_RUN_AFTER_MS: number;

const store = () => tenantCutoverStore(driver, TENANT);

/**
 * One statement, on a connection taken and given back. PGlite has one
 * connection, and the store and the pass's re-read each take it for their own
 * transaction: a test that held it would wait on itself.
 */
async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/** The mapping's lifecycle, as the row holds it. */
async function setMapping(status: string): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
}

/**
 * The cutover row, placed by hand: `state`, whether it copies, and where
 * `now()` sits against the end, in minutes (negative: before it). Both
 * clocks the rule reads are set, so the end is the same whichever the state
 * reads: `updated_at` for CUTOVER_IN_PROGRESS, `grace_period_started_at` for
 * GRACE_PERIOD.
 */
async function placeCutover(state: CutoverState, copies: boolean, minutesPastTheEnd: number): Promise<void> {
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  await query(
    `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                grace_period_started_at, updated_at)
     SELECT $1, $2, $3, 72, $4, s, s
       FROM (SELECT now() - interval '72 hours' - ($5::int * interval '1 minute') AS s) t`,
    [TENANT, MAPPING, state, copies, minutesPastTheEnd],
  );
}

/** What the SQL says, in the organisation's own transaction. */
async function sqlSays(): Promise<boolean> {
  return cutoverStillCopies(db, TENANT, MAPPING);
}

/** What the TypeScript says, from the row as the store loads it. */
async function typescriptSays(): Promise<boolean> {
  const loaded = await store().loadCutoverState(TENANT, MAPPING);
  return cutoverStillCopiesAt(loaded ? cutoverWindowOf(loaded) : undefined);
}

/** The tick's own query, with the tick's own parameters: is this mapping chosen? */
async function theTickConsidersIt(): Promise<boolean> {
  const rows = await query<{ id: string }>(ACTIVE_MAPPINGS_SQL, [
    STALE_RUN_AFTER_MS,
    [...SELF_HEALING_CATEGORIES],
    FAILURE_WINDOW_MINUTES,
    [...BILLABLE_RUN_KINDS],
    [...PASS_RUNNING_STATES],
  ]);
  return rows.some((r) => r.id === MAPPING);
}

beforeAll(async () => {
  // Importing the tick opens a Pool at import; it is never used here.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  const tick = await import('./managed-sync-tick.ts');
  ACTIVE_MAPPINGS_SQL = tick.ACTIVE_MAPPINGS_SQL;
  STALE_RUN_AFTER_MS = tick.STALE_RUN_AFTER_MS;

  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'grace', 'active')`, [TENANT]);
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
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the rule, said in SQL and in TypeScript, says one thing', () => {
  const cases = STATES.flatMap((state) =>
    [true, false].flatMap((copies) =>
      [-5, 5].map((minutesPastTheEnd) => ({
        state,
        copies,
        minutesPastTheEnd,
        // Copying, in one of the two states that copy, before the end.
        expected: copies && (state === 'CUTOVER_IN_PROGRESS' || state === 'GRACE_PERIOD') && minutesPastTheEnd < 0,
      })),
    ),
  );

  it('covers every state, both answers of execute, and both sides of the end', () => {
    expect(cases).toHaveLength(STATES.length * 2 * 2);
    expect(cases.filter((c) => c.expected)).toHaveLength(2);
  });

  it.each(cases)(
    '$state, copying $copies, $minutesPastTheEnd minutes past the end: $expected',
    async ({ state, copies, minutesPastTheEnd, expected }) => {
      await placeCutover(state, copies, minutesPastTheEnd);

      expect(await sqlSays(), 'CUTOVER_STILL_COPIES_WHERE').toBe(expected);
      expect(await typescriptSays(), 'cutoverStillCopiesAt').toBe(expected);
    },
  );

  it('a grace period with no start recorded copies nothing, in either', async () => {
    await placeCutover('GRACE_PERIOD', true, -5);
    await query(`UPDATE cutover_state SET grace_period_started_at = NULL WHERE mapping_id = $1`, [MAPPING]);

    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
  });

  it('reads the hours the row holds, not 72 written anywhere else', async () => {
    // Started 30 hours ago: inside a 72-hour period, past a 24-hour one.
    await placeCutover('GRACE_PERIOD', true, -42 * 60);
    expect(await sqlSays()).toBe(true);
    expect(await typescriptSays()).toBe(true);

    await query(`UPDATE cutover_state SET grace_period_hours = 24 WHERE mapping_id = $1`, [MAPPING]);
    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
  });

  it('a cutover executed before migration 0064 copies nothing, as it did: the column defaults to false', async () => {
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
    await query(
      `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, grace_period_started_at)
       VALUES ($1, $2, 'GRACE_PERIOD', 72, now() - interval '1 hour')`,
      [TENANT, MAPPING],
    );

    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
  });

  it('no cutover row at all copies nothing, in either', async () => {
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);

    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
  });
});

describe('execute decides it, from the status the migration had', () => {
  /** A fresh cutover, driven to APPROVED the way the CLI's commands move it. */
  async function approvedCutover(mappingStatus: string): Promise<void> {
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
    await query(`DELETE FROM cutover_event WHERE mapping_id = $1`, [MAPPING]);
    await setMapping(mappingStatus);
    await store().initializeCutover({ tenantId: TENANT, mappingId: MAPPING, startedBy: 'test' });
    await store().transitionState(TENANT, MAPPING, 'READY_FOR_CUTOVER', { verifiedBy: 'test' });
    await store().transitionState(TENANT, MAPPING, 'APPROVED', { approvedBy: 'test' });
  }

  const deps = () => ({
    tenantId: TENANT,
    mappingId: MAPPING,
    cutoverStore: store(),
    mapping: mappingLifecyclePort(driver, TENANT, MAPPING, 'test'),
    by: 'test',
    log: () => {},
  });

  async function copiesThroughGrace(): Promise<boolean> {
    const rows = await query<{ copies_through_grace: boolean }>(
      `SELECT copies_through_grace FROM cutover_state WHERE mapping_id = $1`,
      [MAPPING],
    );
    return rows[0]!.copies_through_grace;
  }

  it('a running migration keeps copying from execute, through the grace period, and not past it', async () => {
    await approvedCutover('active');

    const entered = await enterCutover(deps());
    expect(entered.copiesThroughGrace).toBe(true);
    expect(entered.mapping).toEqual({ from: 'active', to: 'cutover', changed: true });
    expect(await copiesThroughGrace()).toBe(true);
    // While execute waits for the MX record: copying.
    expect(await sqlSays()).toBe(true);
    expect(await theTickConsidersIt()).toBe(true);

    // The CLI's next write, on propagation. Every save after execute's
    // starts from the row as loaded, so the answer is carried, not lost.
    await store().transitionState(TENANT, MAPPING, 'GRACE_PERIOD', {
      gracePeriodStartedAt: new Date().toISOString(),
    });
    expect(await copiesThroughGrace()).toBe(true);
    expect(await sqlSays()).toBe(true);
    expect(await typescriptSays()).toBe(true);
    expect(await theTickConsidersIt()).toBe(true);

    // And the end is the end.
    await query(
      `UPDATE cutover_state SET grace_period_started_at = now() - interval '73 hours' WHERE mapping_id = $1`,
      [MAPPING],
    );
    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
    expect(await theTickConsidersIt()).toBe(false);
  });

  it('a paused migration stays stopped: the operator stopped it, and a cutover does not undo that', async () => {
    await approvedCutover('paused');

    const entered = await enterCutover(deps());
    // ADR-0048: a paused migration becomes `cutover` too, so Start cannot
    // later resume it with the deletion detectors present.
    expect(entered.mapping).toEqual({ from: 'paused', to: 'cutover', changed: true });
    expect(entered.copiesThroughGrace).toBe(false);
    expect(await copiesThroughGrace()).toBe(false);

    await store().transitionState(TENANT, MAPPING, 'GRACE_PERIOD', {
      gracePeriodStartedAt: new Date().toISOString(),
    });
    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
    expect(await theTickConsidersIt()).toBe(false);
  });

  it('a migration already in cutover when execute runs is left stopped, as it was', async () => {
    // A cutover declared before execute, or a re-run whose first run already
    // moved the mapping: neither can be told from the other here, and the
    // side that copies nothing nobody asked for is the one taken.
    await approvedCutover('cutover');

    const entered = await enterCutover(deps());
    expect(entered.mapping.changed).toBe(false);
    expect(entered.copiesThroughGrace).toBe(false);
    expect(await copiesThroughGrace()).toBe(false);
  });

  it('complete closes it: COMPLETED copies nothing, whatever execute recorded', async () => {
    await approvedCutover('active');
    await enterCutover(deps());
    await store().transitionState(TENANT, MAPPING, 'GRACE_PERIOD', {
      gracePeriodStartedAt: new Date().toISOString(),
    });

    const closed = await closeCutover(deps());
    expect(closed.copiesThroughGrace).toBe(false);
    expect(await sqlSays()).toBe(false);
    expect(await typescriptSays()).toBe(false);
    expect(await theTickConsidersIt()).toBe(false);
  });

  it('a rollback ends it: ROLLED_BACK copies nothing, and the migration runs as active again', async () => {
    await approvedCutover('active');
    await enterCutover(deps());
    await store().transitionState(TENANT, MAPPING, 'ROLLED_BACK', { rollbackReason: 'test' });
    expect(await sqlSays()).toBe(false);

    await setMapping('active');
    // Considered as an active migration, by the status, not by the cutover.
    expect(await theTickConsidersIt()).toBe(true);
  });

  it('the store writes what a status says, on a row it creates and on one it updates', async () => {
    // Execute updates a row that exists; a save with no row yet inserts one.
    // Either way the answer is the status's, as for every other column.
    await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
    const now = new Date().toISOString();
    const status: CutoverStatus = {
      tenantId: TENANT,
      mappingId: MAPPING,
      state: 'GRACE_PERIOD',
      phase: 'GRACE',
      startedAt: now,
      updatedAt: now,
      verificationStatus: 'PASS',
      totalItemsMigrated: 0,
      itemsVerified: 0,
      discrepanciesFound: 0,
      rollbackAvailable: true,
      gracePeriodStartedAt: now,
      copiesThroughGrace: true,
    };

    await store().saveCutoverState(status);
    expect(await copiesThroughGrace()).toBe(true);
    expect(await sqlSays()).toBe(true);

    await store().saveCutoverState({ ...status, copiesThroughGrace: false });
    expect(await copiesThroughGrace()).toBe(false);
    expect(await sqlSays()).toBe(false);
  });

  it('records the answer in the event execute leaves, where the operator reads the trail', async () => {
    await approvedCutover('active');
    await enterCutover(deps());

    const events = await store().getEventHistory(TENANT, MAPPING);
    const entered = events.find((e) => e.toState === 'CUTOVER_IN_PROGRESS');
    expect(entered?.metadata).toMatchObject({ stoppedSync: true, mappingStatus: 'cutover', copiesThroughGrace: true });
  });
});

describe('a pass already running keeps going through the grace period, and stops at its end', () => {
  it('asks the same rule between data types', async () => {
    await setMapping('cutover');
    await placeCutover('GRACE_PERIOD', true, -5);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBeNull();

    await placeCutover('GRACE_PERIOD', true, 5);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBe('no_longer_runs');

    await placeCutover('GRACE_PERIOD', false, -5);
    expect(await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING)).toBe('no_longer_runs');
  });

  it('and the tick agrees with it on every one of those', async () => {
    await setMapping('cutover');
    for (const [copies, minutesPastTheEnd] of [
      [true, -5],
      [true, 5],
      [false, -5],
    ] as const) {
      await placeCutover('GRACE_PERIOD', copies, minutesPastTheEnd);
      const halt = await whyThePassStops(driver as unknown as Pool, TENANT, MAPPING);
      expect(await theTickConsidersIt(), `${copies} ${minutesPastTheEnd}`).toBe(halt === null);
      expect(runsPassesNow('cutover', await sqlSays())).toBe(halt === null);
    }
  });
});
