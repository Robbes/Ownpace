// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE APPLIANCE CAN READ (workplan 0129 T2, the appliance's half; D5):
 * `readOperatorLog` serves the page the managed operator gets, from the
 * tables, under row security.
 *
 * The managed page's own tests (`a-log-the-operator-can-read` in managed and
 * the API) hold its view and route. This file asks the same questions of the
 * appliance's reader, which has no view to lean on:
 *
 *  - both tables, newest first, each row in the shape of the other;
 *  - metadata only: no `detail`, an action or actor that is not a name from
 *    code served as nothing readable, a migration id checked before it is one;
 *  - every filter the page sends, meaning what it means on managed;
 *  - a page continued from its cursor without skipping or repeating a row,
 *    among rows written in the same microsecond;
 *  - and the patterns that hold "metadata only" are the managed view's own.
 *
 * PGlite as the appliance runs it: a driver whose `withTenant` drops to
 * `app_user`, and whose own connections read as the owner.
 *
 * UUID family 0e2e0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOG_PAGE, type LogFilters, type OperatorLogPage } from '@openmig/shared';
import { runMigrations } from './migrate.ts';
import { createPgliteDb } from './pglite-driver.ts';
import {
  readOperatorLog,
  LOG_ACTION_NAME,
  LOG_ACTOR_NAME,
  LOG_MAPPING_ID,
} from './operator-log.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import { withTenant } from './db.ts';

const TENANT_A = '0e2e0000-e29b-41d4-a716-446655440001';
const TENANT_B = '0e2e0000-e29b-41d4-a716-446655440002';
const CONN_A = '0e2e0000-e29b-41d4-a716-446655440011';
const BOX_A = '0e2e0000-e29b-41d4-a716-446655440021';
const MAPPING_A = '0e2e0000-e29b-41d4-a716-446655440031';

/** In `detail`, which is never selected. It must not come out. */
const DETAIL_ADDRESS = 'finance@example.invalid';
const SAME_INSTANT = 150;
const INSTANT = '2026-09-22T00:00:00.123456Z';

let driver: LedgerDriver;
let conn: LedgerConnection;

const read = (filters: LogFilters = {}, tenantIds = [TENANT_A, TENANT_B]): Promise<OperatorLogPage> =>
  readOperatorLog({ driver, tenantIds }, filters);

beforeAll(async () => {
  const made = await createPgliteDb({ role: 'app_user' });
  driver = made.driver;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  const q = (text: string, p: unknown[] = []) => conn.query(text, p);
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1,'Alpha BV','active'), ($2,'Beta BV','active')`, [
    TENANT_A,
    TENANT_B,
  ]);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name) VALUES ($1,$2,'source','imap','fixture')`,
    [CONN_A, TENANT_A],
  );
  await q(`INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1,$2,$3,'s')`, [
    BOX_A,
    TENANT_A,
    CONN_A,
  ]);
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, mode, name)
     VALUES ($1,$2,$3,'active','mirror','Alpha migration')`,
    [MAPPING_A, TENANT_A, BOX_A],
  );

  const audit = (at: string, actor: string, action: string, detail: unknown) =>
    q(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, detail, at)
       VALUES ($1,$2,$3,'mapping',$4::jsonb,$5::timestamptz)`,
      [TENANT_A, actor, action, JSON.stringify(detail), at],
    );
  await audit('2026-09-23T10:00:00Z', 'operator', 'mapping.status', {
    mappingId: MAPPING_A,
    notifiedAddress: DETAIL_ADDRESS,
  });
  await audit('2026-09-23T10:01:00Z', 'system:digest', 'digest_sent_daily', { to: [DETAIL_ADDRESS] });
  await audit('2026-09-23T10:02:00Z', 'system:digest', 'digestxsent.weekly', { mappingId: 'not-an-id' });
  await audit('2026-09-23T10:03:00Z', 'Jan de Vries', 'Moved the Salaris folder for jan', {});

  await q(
    `INSERT INTO app_event (level, tenant_id, mapping_id, event, category, reference, at)
     VALUES ('error', $1, $2, 'sync.calendar.failed', 'auth_expired', '0a1b2c3d', '2026-09-23T10:04:00Z'),
            ('warn', $3, NULL, 'sync.email.keys-unreadable', NULL, '1b2c3d4e', '2026-09-23T10:05:00Z'),
            ('error', NULL, NULL, 'api.list_failed', NULL, '2c3d4e5f', '2026-09-23T10:06:00Z')`,
    [TENANT_A, MAPPING_A, TENANT_B],
  );
  await q(
    `INSERT INTO app_event (level, tenant_id, event, reference, at)
     SELECT 'warn', $1, 'bulk.tick', lpad(to_hex(n), 8, '0'), $2::timestamptz
       FROM generate_series(1, ${SAME_INSTANT}) AS n`,
    [TENANT_B, INSTANT],
  );
  await conn.release();
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the log, newest first', () => {
  it('serves both tables in one timeline, each row in the shape of the other', async () => {
    const page = await read();

    expect(page.limit).toBe(LOG_PAGE);
    expect(page.entries).toHaveLength(LOG_PAGE);
    expect(page.entries.slice(0, 7).map((e) => [e.source, e.level, e.event])).toEqual([
      ['app', 'error', 'api.list_failed'],
      ['app', 'warn', 'sync.email.keys-unreadable'],
      ['app', 'error', 'sync.calendar.failed'],
      ['audit', 'info', 'audit.unnamed'],
      ['audit', 'info', 'digestxsent.weekly'],
      ['audit', 'info', 'digest_sent_daily'],
      ['audit', 'info', 'mapping.status'],
    ]);
  });

  it('names the organisation and the migration', async () => {
    const failed = (await read()).entries.find((e) => e.event === 'sync.calendar.failed');

    expect(failed).toMatchObject({
      tenant_id: TENANT_A,
      tenant_name: 'Alpha BV',
      mapping_id: MAPPING_A,
      migration_name: 'Alpha migration',
      category: 'auth_expired',
      reference: '0a1b2c3d',
      actor: null,
    });
  });

  it("uses the deployment's own name for a migration when it has one", async () => {
    // The appliance's row holds its config slug; its screens say the mapping's `name`.
    const page = await readOperatorLog(
      { driver, tenantIds: [TENANT_A, TENANT_B], migrationNames: new Map([[MAPPING_A, 'Finance mail']]) },
      {},
    );

    expect(page.entries.find((e) => e.event === 'sync.calendar.failed')?.migration_name).toBe('Finance mail');
  });
});

describe('metadata only', () => {
  it('serves who acted when it is an identifier, and nothing when it is a name', async () => {
    const entries = (await read({ level: 'info' })).entries;

    expect(entries.find((e) => e.event === 'mapping.status')?.actor).toBe('operator');
    expect(entries.find((e) => e.event === 'digest_sent_daily')?.actor).toBe('system:digest');
    expect(entries.find((e) => e.event === 'audit.unnamed')?.actor).toBeNull();
  });

  it('never serves the detail, a sentence for an action, or a migration id that is not one', async () => {
    const page = await read({ level: 'info' });
    const body = JSON.stringify(page);

    expect(body).not.toContain(DETAIL_ADDRESS);
    expect(body).not.toContain('Salaris');
    expect(body).not.toContain('Jan de Vries');
    expect(page.entries.find((e) => e.event === 'digestxsent.weekly')?.mapping_id).toBeNull();
    expect(page.entries.find((e) => e.event === 'mapping.status')?.mapping_id).toBe(MAPPING_A);
  });

  it("holds the line with the managed view's own patterns", () => {
    const view = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../managed/migrations/0025_a_log_the_operator_can_read.sql'),
      'utf8',
    );
    for (const pattern of [LOG_ACTION_NAME, LOG_ACTOR_NAME, LOG_MAPPING_ID]) {
      expect(view).toContain(`'${pattern}'`);
    }
  });
});

describe('each filter means what it means on managed', () => {
  it.each([
    ['level', { level: 'info' }, ['audit.unnamed', 'digestxsent.weekly', 'digest_sent_daily', 'mapping.status']],
    ['organisation', { tenantId: TENANT_A, level: 'error' }, ['sync.calendar.failed']],
    ['migration', { mappingId: MAPPING_A }, ['sync.calendar.failed', 'mapping.status']],
    ['the start of an event', { event: 'sync.' }, ['sync.email.keys-unreadable', 'sync.calendar.failed']],
    ['an event with _ in it, as a letter', { event: 'digest_sent' }, ['digest_sent_daily']],
    ['category', { category: 'auth_expired' }, ['sync.calendar.failed']],
    ['reference', { reference: '0a1b2c3d' }, ['sync.calendar.failed']],
    [
      'time',
      { since: '2026-09-23T10:01:00Z', before: '2026-09-23T10:05:00Z' },
      ['sync.calendar.failed', 'audit.unnamed', 'digestxsent.weekly', 'digest_sent_daily'],
    ],
  ] as const)('%s', async (_what, filters, events) => {
    const page = await read(filters as LogFilters);

    expect(page.entries.map((e) => e.event)).toEqual(events);
    expect(page.next).toBeNull();
  });

  it("reads only the organisations the appliance serves, for the audit log", async () => {
    const page = await read({ level: 'info' }, [TENANT_B]);

    expect(page.entries).toEqual([]);
  });
});

describe('paging', () => {
  it('continues from its cursor without skipping or repeating a row written in the same instant', async () => {
    const first = await read({ event: 'bulk.' });
    expect(first.entries).toHaveLength(LOG_PAGE);
    expect(first.next?.before).toBe(INSTANT);

    const second = await read({ event: 'bulk.', ...first.next! });
    expect(second.entries).toHaveLength(SAME_INSTANT - LOG_PAGE);
    expect(second.next).toBeNull();

    const ids = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(SAME_INSTANT);
  });

  it('pages across both tables in one order', async () => {
    const first = await read({ before: '2026-09-23T10:06:00Z' });
    const second = await read({ ...first.next! });
    const all = [...first.entries, ...second.entries];

    // Newest first, all the way down, whichever table a row came from.
    const keys = all.map((e) => `${e.at}|${e.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });
});

describe('beside a pass that holds the database', () => {
  it("waits for another organisation's transaction instead of reading inside it", async () => {
    // PGlite is one connection. A query on a handle that skips the driver's
    // queue runs INSIDE whatever transaction is open on it, and a pass's
    // `withTenant` has dropped to `app_user`, which may not read `app_event`.
    // The page would then answer "permission denied" whenever a pass was busy.
    let release!: () => void;
    let opened!: () => void;
    const open = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const held = withTenant(driver, TENANT_B, async () => {
      opened();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await open;

    const reading = read({ level: 'error' }, []);
    setTimeout(() => release(), 50);

    const page = await reading;
    await held;
    expect(page.entries.map((e) => e.event)).toEqual(['api.list_failed', 'sync.calendar.failed']);
  });
});
