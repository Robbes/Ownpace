// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * END OR KEEP ONE DATA TYPE (workplan 0128 T3, T5 slice 7; the owner's D3 and
 * D8), on PGlite as `app_user`, through the one door both editions press.
 *
 * What it must always do: move only the data type pressed, write the
 * migration's status as its paths' roll-up (with every data type ended, the
 * migration is done), record each move, keep the lane after a cutover (from
 * before one, the cutover first), and let its own open failures hold End back
 * unless forced. What it must never do: write anything when it refuses, keep a
 * data type its owner stopped, or end the rest of a migration resumed by hand.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DiscoveryDomain } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { PATH_PHASE_ACTION } from './a-cutover-of-one-data-type.ts';
import { endOrKeepPath, pathEndingRefusalReason, type PathEnding } from './an-ending-per-data-type.ts';

// UUID family 0128e100-…, unused elsewhere in the repo.
const TENANT = '0128e100-e29b-41d4-a716-446655440001';
const CONNECTION = '0128e100-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0128e100-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0128e100-e29b-41d4-a716-446655440004';
const MAPPING = '0128e100-e29b-41d4-a716-446655440005';
const GONE = '0128e100-e29b-41d4-a716-446655440006';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    conn.release();
  }
}

const press = (
  domain: DiscoveryDomain,
  ending: PathEnding,
  { unresolvedFailures = 0, force = false, mapping = MAPPING }: { unresolvedFailures?: number; force?: boolean; mapping?: string } = {},
) =>
  withTenant(driver, TENANT, (db) =>
    endOrKeepPath(db, TENANT, { mappingId: mapping, domain, ending, actor: 'someone', unresolvedFailures, force }),
  );

const status = async () => (await query(`SELECT status FROM mailbox_mapping WHERE id = $1`, [MAPPING]))[0]?.status;

const paths = async () =>
  Object.fromEntries(
    (
      await query(
        `SELECT domain, state, stopped_at IS NOT NULL AS stopped, ended_at IS NOT NULL AS ended
           FROM path_lifecycle WHERE mapping_id = $1`,
        [MAPPING],
      )
    ).map((r) => [r.domain, { state: r.state, stopped: r.stopped, ended: r.ended }]),
  );

// One press is one transaction, and its rows share its time: a Keep from
// before the cutover writes the cutover first, and then the lane.
const phaseRecords = async () =>
  (
    await query(
      `SELECT detail FROM audit_log WHERE action = $1
        ORDER BY at, CASE detail ->> 'via' WHEN 'cutover' THEN 0 ELSE 1 END, id`,
      [PATH_PHASE_ACTION],
    )
  ).map((r) => {
    const d = r.detail as Record<string, string>;
    return [d.domain, d.from, d.to, d.via];
  });

const statusRecords = async () =>
  (await query(`SELECT detail FROM audit_log WHERE action = 'mapping.status' ORDER BY at, id`)).map((r) => {
    const d = r.detail as Record<string, string>;
    return [d.from, d.to, d.via];
  });

/** The migration in `status`, carrying calendars and files (contacts not), with rows as given. */
async function place(status: string, rows: Record<string, string> = { calendar: status, file: status }) {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM audit_log`);
  for (const [domain, state] of Object.entries(rows)) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, ended_at)
       VALUES ($1, $2, $3, $4, now(), CASE WHEN $4 IN ('cutover', 'done') THEN now() END)`,
      [TENANT, MAPPING, domain, state],
    );
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'endings', 'active')`, [TENANT]);
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
  for (const [domain, included] of [
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
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await place('active');
});

describe('each data type ended or kept on its own, and the migration its roll-up', () => {
  it('calendars ended, files kept in the lane (their cutover first), then files ended: the migration ends with the last', async () => {
    expect(await press('calendar', 'end')).toEqual({ changed: true, from: 'active', to: 'done', slotsTaken: false });
    expect(await status()).toBe('active');

    expect(await press('file', 'keep')).toEqual({
      changed: true,
      from: 'active',
      to: 'continuous',
      migration: { from: 'active', to: 'continuous' },
      slotsTaken: false,
    });

    expect(await press('file', 'end')).toEqual({
      changed: true,
      from: 'continuous',
      to: 'done',
      migration: { from: 'continuous', to: 'done' },
      slotsTaken: false,
    });
    expect(await status()).toBe('done');
    expect(await paths()).toEqual({
      calendar: { state: 'done', stopped: false, ended: true },
      file: { state: 'done', stopped: false, ended: true },
    });

    expect(await phaseRecords()).toEqual([
      ['calendar', 'active', 'done', 'finish'],
      ['file', 'active', 'cutover', 'cutover'],
      ['file', 'cutover', 'continuous', 'update'],
      ['file', 'continuous', 'done', 'finish'],
    ]);
    expect(await statusRecords()).toEqual([
      ['active', 'continuous', 'update'],
      ['continuous', 'done', 'finish'],
    ]);
  });

  it('a data type kept after it ended takes its slot again, and the finished migration is in the lane', async () => {
    await place('done');
    expect(await press('calendar', 'keep')).toEqual({
      changed: true,
      from: 'done',
      to: 'continuous',
      migration: { from: 'done', to: 'continuous' },
      slotsTaken: true,
    });
    expect(await paths()).toMatchObject({ calendar: { state: 'continuous', ended: false }, file: { state: 'done' } });
  });

  it('after the whole migration’s cutover: one data type kept, one ended, and the rest still in its cutover', async () => {
    await place('cutover');
    expect(await press('file', 'keep')).toMatchObject({ changed: true, from: 'cutover', to: 'continuous', slotsTaken: true });
    expect(await status()).toBe('cutover');
    expect(await press('calendar', 'end')).toMatchObject({ migration: { from: 'cutover', to: 'continuous' } });
    expect(await phaseRecords()).toEqual([
      ['file', 'cutover', 'continuous', 'update'],
      ['calendar', 'cutover', 'done', 'finish'],
    ]);
  });

  it('asked for again, it changes nothing and records nothing', async () => {
    await place('continuous', { calendar: 'continuous', file: 'done' });
    expect(await press('calendar', 'keep')).toEqual({ changed: false, phase: 'continuous' });
    expect(await press('file', 'end')).toEqual({ changed: false, phase: 'done' });
    expect(await phaseRecords()).toEqual([]);
  });
});

describe('what holds a data type back', () => {
  it('its own open failures hold End back, and a forced End goes through, recorded as forced', async () => {
    // Forced with nothing open is no force: nothing is recorded as forced.
    expect(await press('file', 'end', { force: true })).toMatchObject({ changed: true, to: 'done' });

    const refused = await press('calendar', 'end', { unresolvedFailures: 2 });
    expect(refused).toEqual({ refused: 'unresolved_failures', count: 2 });
    expect(pathEndingRefusalReason(refused as { refused: 'unresolved_failures'; count: number }, 'calendar')).toMatch(
      /^2 item\(s\) of calendar could not be migrated and are awaiting a decision\./,
    );
    expect(await paths()).toMatchObject({ calendar: { state: 'active' } });

    expect(await press('calendar', 'end', { unresolvedFailures: 2, force: true })).toMatchObject({
      changed: true,
      to: 'done',
      migration: { from: 'active', to: 'done' },
    });
    // The data type's own record and the migration's both say so, as Finish's does.
    expect(
      await query(
        `SELECT action, detail ->> 'domain' AS domain FROM audit_log WHERE detail ->> 'forced' = 'true' ORDER BY action`,
      ),
    ).toEqual([
      { action: 'mapping.status', domain: null },
      { action: PATH_PHASE_ACTION, domain: 'calendar' },
    ]);
  });

  it('they do not hold Keep back: the lane goes on retrying them (D3)', async () => {
    expect(await press('calendar', 'keep', { unresolvedFailures: 2 })).toMatchObject({ changed: true, to: 'continuous' });
  });

  it('a data type its owner stopped is not kept, but it can be ended, which clears its stop and no other', async () => {
    await query(`UPDATE path_lifecycle SET stopped_at = now() WHERE mapping_id = $1`, [MAPPING]);
    expect(await press('file', 'keep')).toEqual({ refused: 'stopped' });
    expect(await press('file', 'end')).toMatchObject({ changed: true, to: 'done' });
    expect(await paths()).toMatchObject({
      file: { state: 'done', stopped: false, ended: true },
      calendar: { state: 'active', stopped: true },
    });
    expect(await press('file', 'keep')).toMatchObject({ changed: true, to: 'continuous' });
  });

  it('not while the migration is paused or never started, not a data type it does not carry or that never ran, and not one that is gone', async () => {
    await place('paused');
    expect(await press('calendar', 'end')).toEqual({ refused: 'not_running', status: 'paused' });
    expect(await press('calendar', 'keep')).toEqual({ refused: 'not_running', status: 'paused' });
    // The pause holds all of it: a data type that ended is not kept under it either.
    await place('paused', { calendar: 'done', file: 'paused' });
    expect(await press('calendar', 'keep')).toEqual({ refused: 'not_running', status: 'paused' });
    expect(await phaseRecords()).toEqual([]);

    await place('active', { calendar: 'active', file: 'ready' });
    expect(await press('file', 'end')).toEqual({ refused: 'not_running', status: 'ready' });
    expect(await paths()).toMatchObject({ file: { state: 'ready' } });

    await place('active');
    expect(await press('contact', 'end')).toEqual({ refused: 'not_a_path' });
    expect(await press('calendar', 'end', { mapping: GONE })).toEqual({ refused: 'not_found' });
    expect(await phaseRecords()).toEqual([]);
    expect(await paths()).toMatchObject({ calendar: { state: 'active' }, file: { state: 'active' } });
  });
});

describe('a migration whose status was written alone', () => {
  it('resumed by hand after its finish: ending one data type ends that one, not the rest with it', async () => {
    // The operator set the status back to `active`; the rows still say `done`.
    await place('active', { calendar: 'done', file: 'done' });
    expect(await press('calendar', 'end')).toEqual({ changed: true, from: 'active', to: 'done', slotsTaken: false });
    expect(await status()).toBe('active');
    expect(await paths()).toMatchObject({ calendar: { state: 'done' }, file: { state: 'active', ended: false } });
  });

  it('a data type that never ran is brought to it through the start, which stamps its first run', async () => {
    await place('active', { calendar: 'done', file: 'ready' });
    await query(`UPDATE path_lifecycle SET first_activated_at = NULL WHERE mapping_id = $1 AND domain = 'file'`, [MAPPING]);
    expect(await press('calendar', 'end')).toMatchObject({ changed: true, to: 'done' });
    expect(
      await query(
        `SELECT state, first_activated_at IS NOT NULL AS stamped FROM path_lifecycle WHERE mapping_id = $1 AND domain = 'file'`,
        [MAPPING],
      ),
    ).toEqual([{ state: 'active', stamped: true }]);
  });
});
