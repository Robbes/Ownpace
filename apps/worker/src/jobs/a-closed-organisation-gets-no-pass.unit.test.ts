// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CLOSED ORGANISATION GETS NO PASS (workplan 0085 T2; the owner's report of
 * 2026-09-28, and their answer "Read tenant status (Recommended)").
 *
 * Closing an organisation sets `tenant.status` to `closed`, and nothing that
 * starts a pass read it. The tick chose each due migration by the migration's
 * own status, so an active migration, a continuous lane, a cutover in its
 * grace period and a data type kept in the lane got a pass every few minutes
 * until the purge, up to 90 days later. They ran on the stored access that the
 * alpha conditions say nothing uses after closing (`site/legal/alpha.md` §10).
 * A pass already queued, or a retry, read only the migration's own phases
 * between its data types, and went on copying.
 *
 * The close does not touch the migrations. The tick and the pass read the
 * organisation's status instead, so a reopen gives back what ran before, with
 * nothing to restore. This file runs the tick's own query and the pass's own
 * stop check on the same PGlite rows, and holds them to one answer:
 *
 *  1. open, each state the tick runs is chosen and its pass runs, so the cases
 *     below mean something;
 *  2. closed, or being purged, none is chosen, and a pass already under way
 *     stops before its next data type with `organisation_closed`, which comes
 *     before any credential is built;
 *  3. reopened, each is chosen and runs again;
 *  4. the pass's log and a cutover's final sync say that the close stopped it.
 *
 * It failed before the fix: closed, the tick chose all four states, the pass
 * ran, and the final sync said the migration was paused or finished.
 *
 * PGlite: real Postgres, the ledger chain, no container.
 */

import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import { FAILURE_WINDOW_MINUTES, SELF_HEALING_CATEGORIES } from '@openmig/orchestration/failing-backoff';
import { PASS_RUNNING_STATES, asMappingId, asTenantId } from '@openmig/shared';
import { passStepBefore, whyThePassStops } from './stopping-a-pass.ts';
import { finalSyncReport } from './final-sync.ts';

// UUID family 0085c105-…, unused elsewhere in the repo.
const TENANT = asTenantId('0085c105-e29b-41d4-a716-446655440001');
const CONNECTION = '0085c105-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0085c105-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0085c105-e29b-41d4-a716-446655440004';
const MAPPING = asMappingId('0085c105-e29b-41d4-a716-446655440005');

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

const pool = () => driver as unknown as Pool;
const theStop = () => whyThePassStops(pool(), TENANT, MAPPING);
const theStepBefore = (domain: string) => passStepBefore(pool(), TENANT, MAPPING, domain);

/** Set the organisation's status, as the close, the purge and the reopen do. */
const organisation = (status: 'active' | 'closed' | 'deleting') =>
  query(`UPDATE tenant SET status = $2 WHERE id = $1`, [TENANT, status]);

/**
 * The migration in one of the states the tick runs. Each data type has a path
 * row; a cutover's ledger row is open (in its grace period) or over.
 */
interface State {
  readonly name: string;
  readonly status: string;
  readonly windowOpen: boolean;
  readonly email: string;
  readonly calendar: string;
}

const STATES: readonly State[] = [
  { name: 'an active migration', status: 'active', windowOpen: false, email: 'active', calendar: 'active' },
  { name: 'a migration in the continuous lane', status: 'continuous', windowOpen: false, email: 'continuous', calendar: 'continuous' },
  { name: 'a cutover in its grace period', status: 'cutover', windowOpen: true, email: 'cutover', calendar: 'cutover' },
  { name: 'a data type kept in the lane past its cutover', status: 'cutover', windowOpen: false, email: 'cutover', calendar: 'continuous' },
];

async function place(state: State): Promise<void> {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, state.status]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  if (state.status === 'cutover') {
    await query(
      `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                  grace_period_started_at, updated_at)
       SELECT $1, $2, 'GRACE_PERIOD', 72, true, s, s
         FROM (SELECT now() - interval '72 hours' - ($3::int * interval '1 minute') AS s) t`,
      [TENANT, MAPPING, state.windowOpen ? -5 : 5],
    );
  }
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  for (const [domain, phase] of [
    ['email', state.email],
    ['calendar', state.calendar],
  ] as const) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [TENANT, MAPPING, domain, phase],
    );
  }
}

beforeAll(async () => {
  // Importing the tick opens a Pool at import; it is never used here.
  process.env.SYSTEM_DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/none';
  // And the pass it triggers, run-delta-sync, opens its pools at import through
  // openTaskPools, which refuses without APP_DATABASE_URL (0138 T1).
  process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
  const tick = await import('./managed-sync-tick.ts');
  ACTIVE_MAPPINGS_SQL = tick.ACTIVE_MAPPINGS_SQL;
  STALE_RUN_AFTER_MS = tick.STALE_RUN_AFTER_MS;

  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });

  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'closing', 'active')`, [TENANT]);
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
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  for (const domain of ['email', 'calendar']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe.each(STATES.map((s) => [s.name, s] as const))('%s', (_name, state) => {
  it('runs while the organisation is open', async () => {
    await organisation('active');
    await place(state);
    expect(await theTickStartsIt()).toBe(true);
    expect(await theStop()).toBeNull();
    expect(await theStepBefore('calendar')).toEqual({ run: true });
  });

  it('gets no pass from the tick once the organisation is closed, and a pass under way stops', async () => {
    await place(state);
    await organisation('closed');
    try {
      // The migration's own status is left as it was: the close is not a pause.
      expect((await query<{ status: string }>(`SELECT status FROM mailbox_mapping WHERE id = $1`, [MAPPING]))[0]?.status)
        .toBe(state.status);
      expect(await theTickStartsIt()).toBe(false);
      expect(await theStop()).toBe('organisation_closed');
      expect(await theStepBefore('email')).toEqual({ halt: 'organisation_closed' });
      expect(await theStepBefore('calendar')).toEqual({ halt: 'organisation_closed' });
    } finally {
      await organisation('active');
    }
  });

  it('gets none while its data is being purged either', async () => {
    await place(state);
    await organisation('deleting');
    try {
      expect(await theTickStartsIt()).toBe(false);
      expect(await theStop()).toBe('organisation_closed');
    } finally {
      await organisation('active');
    }
  });

  it('runs again once the organisation is reopened, with nothing restored by hand', async () => {
    await place(state);
    await organisation('closed');
    await organisation('active');
    expect(await theTickStartsIt()).toBe(true);
    expect(await theStop()).toBeNull();
    expect(await theStepBefore('calendar')).toEqual({ run: true });
  });
});

describe('a closed organisation whose migration is also paused', () => {
  it('says the close, which is what a Resume would not undo', async () => {
    await place({ name: 'paused', status: 'paused', windowOpen: false, email: 'paused', calendar: 'paused' });
    expect(await theStop()).toBe('no_longer_runs');
    await organisation('closed');
    try {
      expect(await theStop()).toBe('organisation_closed');
    } finally {
      await organisation('active');
    }
  });
});

describe('what the pass says when the close stopped it', () => {
  let source: string;
  beforeAll(async () => {
    source = await readFile(new URL('./run-delta-sync.ts', import.meta.url), 'utf8');
  });

  it('asks before each data type, before any credential is built', () => {
    const asks = source.indexOf('passStepBefore(pool, tenantId, mappingId, domain)');
    expect(asks).toBeGreaterThan(-1);
    expect(source.indexOf('buildDepsFromMapping(pool')).toBeGreaterThan(asks);
    expect(source.indexOf('buildDomainDepsFromMapping(pool')).toBeGreaterThan(asks);
  });

  it('writes a line of its own in the run log, naming the close', () => {
    expect(source).toMatch(/halt === 'organisation_closed'/);
    expect(source).toMatch(/pass stopped before \$\{domain\}: this organisation was closed/);
  });

  it('a cutover’s final sync names the close for the data types it did not reach', () => {
    const report = finalSyncReport({
      asked: ['email', 'calendar'],
      domains: { email: { created: 1, updated: 0, adopted: 0, skipped: 0 } },
      stoppedBefore: 'calendar',
      stoppedBecause: 'organisation_closed',
    });
    expect(report.notFinished).toEqual([
      'calendar was not reached, because the organisation was closed while the pass ran',
    ]);
  });
});
