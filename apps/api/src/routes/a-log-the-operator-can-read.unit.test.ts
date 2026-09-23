// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE OPERATOR CAN READ (workplan 0129 T2): `GET /api/support/log`,
 * against a real database.
 *
 * `a-log-the-operator-can-read.unit.test.ts` in `@openmig/managed` holds the
 * view to "metadata only". This file asks what only the route can get wrong:
 *
 *  - each filter reaches the query, and one of the wrong shape is a 400 that
 *    names it rather than an empty page;
 *  - a page continues from its cursor without skipping or repeating a row,
 *    among rows written in the same microsecond too;
 *  - every page served is recorded as a search, under the customer it was
 *    filtered to, and a non-operator's request records nothing;
 *  - nothing from `audit_log.detail` comes back out.
 *
 * The same harness as `support-routes.unit.test.ts`: PGlite as `app_user`,
 * both migration chains, and only `authenticateSubject` stubbed.
 *
 * UUID family 0e2a0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { FAILURE_CATEGORIES } from '@openmig/shared';

const TENANT_A = '0e2a0000-e29b-41d4-a716-446655440001';
const TENANT_B = '0e2a0000-e29b-41d4-a716-446655440002';
const CONN_A = '0e2a0000-e29b-41d4-a716-446655440011';
const BOX_A = '0e2a0000-e29b-41d4-a716-446655440021';
const MAPPING_A = '0e2a0000-e29b-41d4-a716-446655440031';
const OPERATOR = 'operator-subject-0129-route';
const NOT_OPERATOR = 'ordinary-subject-0129-route';

/** In `detail`, which the view does not select. It must not come back out. */
const DETAIL_ADDRESS = 'finance@example.invalid';
/** How many events share one instant, to the microsecond, across a page's end. */
const SAME_INSTANT = 150;
const INSTANT = '2026-09-22T00:00:00.123456Z';

let driver: LedgerDriver;
let caller: string | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (caller === undefined) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, { userId: caller });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: supportRoutes, LOG_PAGE } = await import('./support.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(sql, params);
    return r.rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const reads = () =>
  rows('SELECT view_name, tenant_id, query, result_count FROM support_read ORDER BY at');

interface Entry {
  id: string;
  at: string;
  source: string;
  level: string;
  tenant_id: string | null;
  mapping_id: string | null;
  event: string;
  category: string | null;
  reference: string | null;
  actor: string | null;
}

interface LogPage {
  entries: Entry[];
  next: { before: string; beforeId: string } | null;
  limit: number;
}

const readLog = async (query: Record<string, string> = {}): Promise<LogPage> => {
  const res = await request(app).get('/api/support/log').query(query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LogPage;
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2), ($3,$4)', [
      TENANT_A,
      'Alpha BV',
      TENANT_B,
      'Beta BV',
    ]);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','Alpha mail','{}'::jsonb,'connected','ref')`,
      [CONN_A, TENANT_A],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','someone@example.invalid')`,
      [BOX_A, TENANT_A, CONN_A],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1,$2,$3,'active','Alpha migration')`,
      [MAPPING_A, TENANT_A, BOX_A],
    );
    await q(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1,'sub-jan','jan@alpha.invalid','owner','active',now())`,
      [TENANT_A],
    );
    await q('INSERT INTO platform_operator (user_id, email) VALUES ($1,$2)', [
      OPERATOR,
      'operator@example.invalid',
    ]);

    const audit = (at: string, actor: string, action: string, detail: unknown) =>
      q(
        `INSERT INTO audit_log (tenant_id, actor, action, entity, detail, at)
         VALUES ($1, $2, $3, 'mapping', $4::jsonb, $5::timestamptz)`,
        [TENANT_A, actor, action, JSON.stringify(detail), at],
      );
    await audit('2026-09-23T10:00:00Z', 'sub-jan', 'mapping.status', {
      mappingId: MAPPING_A,
      notifiedAddress: DETAIL_ADDRESS,
    });
    await audit('2026-09-23T10:01:00Z', 'system:digest', 'digest_sent_daily', {
      recipients: [DETAIL_ADDRESS],
    });
    // One letter away from the name above where `_` stands: a LIKE that did
    // not escape `_` would take it for a match.
    await audit('2026-09-23T10:02:00Z', 'system:digest', 'digestxsent.weekly', {});

    await q(
      `INSERT INTO app_event (level, tenant_id, mapping_id, event, category, reference, at)
       VALUES ('error', $1, $2, 'sync.calendar.failed', 'auth_expired', '0a1b2c3d', '2026-09-23T10:04:00Z'),
              ('warn', $3, NULL, 'sync.email.keys-unreadable', NULL, '1b2c3d4e', '2026-09-23T10:05:00Z'),
              ('error', NULL, NULL, 'api.list_failed', NULL, '2c3d4e5f', '2026-09-23T10:06:00Z')`,
      [TENANT_A, MAPPING_A, TENANT_B],
    );
    // Many events in one instant, older than everything above, so a page ends
    // among them and only the row id can say where the next one starts.
    await q(
      `INSERT INTO app_event (level, tenant_id, event, reference, at)
       SELECT 'warn', $1, 'bulk.tick', lpad(to_hex(n), 8, '0'), $2::timestamptz
         FROM generate_series(1, ${SAME_INSTANT}) AS n`,
      [TENANT_B, INSTANT],
    );
  } finally {
    await conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  caller = OPERATOR;
  await rows('DELETE FROM support_read');
});

describe('the log, newest first, a page at a time', () => {
  it('serves a full page and a cursor when there is more, with the actor and never the detail', async () => {
    const page = await readLog();

    expect(page.limit).toBe(LOG_PAGE);
    expect(page.entries).toHaveLength(LOG_PAGE);
    expect(page.next).not.toBeNull();
    expect(page.entries.slice(0, 6).map((e) => e.event)).toEqual([
      'api.list_failed',
      'sync.email.keys-unreadable',
      'sync.calendar.failed',
      'digestxsent.weekly',
      'digest_sent_daily',
      'mapping.status',
    ]);
    expect(page.entries.find((e) => e.event === 'mapping.status')?.actor).toBe('jan@alpha.invalid');
    expect(JSON.stringify(page)).not.toContain(DETAIL_ADDRESS);
  });

  it('continues from its cursor without skipping or repeating a row written in the same instant', async () => {
    const first = await readLog({ event: 'bulk.' });
    expect(first.entries).toHaveLength(LOG_PAGE);
    // To the microsecond: a cursor cut to milliseconds would start the next
    // page after every one of these rows.
    expect(first.next?.before).toBe(INSTANT);

    const second = await readLog({ event: 'bulk.', ...first.next! });
    expect(second.entries).toHaveLength(SAME_INSTANT - LOG_PAGE);
    expect(second.next).toBeNull();

    const ids = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(SAME_INSTANT);
    const all = await rows(`SELECT id FROM app_event WHERE event = 'bulk.tick'`);
    expect(new Set(ids)).toEqual(new Set(all.map((r) => r.id)));
  });
});

describe('each filter reaches the query', () => {
  it.each([
    ['level', { level: 'info' }, ['digestxsent.weekly', 'digest_sent_daily', 'mapping.status']],
    ['customer', { tenantId: TENANT_A, level: 'error' }, ['sync.calendar.failed']],
    ['migration', { mappingId: MAPPING_A }, ['sync.calendar.failed', 'mapping.status']],
    ['the start of an event', { event: 'sync.' }, ['sync.email.keys-unreadable', 'sync.calendar.failed']],
    ['an event with _ in it, as a letter', { event: 'digest_sent' }, ['digest_sent_daily']],
    ['category', { category: 'auth_expired' }, ['sync.calendar.failed']],
    ['reference, in capitals too', { reference: '0A1B2C3D' }, ['sync.calendar.failed']],
    [
      'time',
      { since: '2026-09-23T10:01:00Z', before: '2026-09-23T10:05:00Z' },
      ['sync.calendar.failed', 'digestxsent.weekly', 'digest_sent_daily'],
    ],
  ] as const)('%s', async (_what, query, events) => {
    const page = await readLog(query);

    expect(page.entries.map((e) => e.event)).toEqual(events);
    expect(page.next).toBeNull();
  });
});

describe('every page is recorded as a search', () => {
  it('with its filters and how many rows came back', async () => {
    await readLog({ level: 'error', event: 'sync.' });
    await readLog();

    expect(await reads()).toEqual([
      { view_name: 'log', tenant_id: null, query: 'level=error event=sync.', result_count: 1 },
      { view_name: 'log', tenant_id: null, query: '', result_count: LOG_PAGE },
    ]);
  });

  it('under the customer it was filtered to, or whose migration it was filtered to', async () => {
    await readLog({ tenantId: TENANT_A });
    await readLog({ mappingId: MAPPING_A });

    expect(await reads()).toEqual([
      { view_name: 'log', tenant_id: TENANT_A, query: '', result_count: 4 },
      { view_name: 'log', tenant_id: TENANT_A, query: `mappingId=${MAPPING_A}`, result_count: 2 },
    ]);
  });

  it('and not at all for somebody who is not an operator, who sees nothing', async () => {
    caller = NOT_OPERATOR;

    const page = await readLog();

    expect(page.entries).toEqual([]);
    expect(page.next).toBeNull();
    expect(await reads()).toEqual([]);
  });
});

describe('a filter of the wrong shape', () => {
  it.each([
    ['level', { level: 'debug' }],
    ['tenantId', { tenantId: 'Alpha BV' }],
    ['mappingId', { mappingId: '42' }],
    ['event', { event: 'Sync failed for jan' }],
    ['category', { category: 'broken' }],
    ['reference', { reference: 'xyz' }],
    ['since', { since: 'yesterday' }],
    ['before', { before: '2026-02-30T00:00:00Z' }],
    ['beforeId', { beforeId: MAPPING_A }],
  ] as const)('%s is refused by name, and nothing is recorded', async (field, query) => {
    const res = await request(app).get('/api/support/log').query(query);

    expect(res.status).toBe(400);
    expect(res.body.field).toBe(field);
    expect(await reads()).toEqual([]);
  });
});

describe('the spec', () => {
  it('offers every failure category as a filter, and only those', () => {
    // The enum in `openapi.yaml` is a copy, held to the source as
    // `support-routes.unit.test.ts` holds the category the migration screen
    // serves.
    const spec = parseYaml(
      readFileSync(join(import.meta.dirname, '../../docs/openapi.yaml'), 'utf-8'),
    ) as {
      paths: Record<string, { get: { parameters: Array<{ name: string; schema: { enum?: string[] } }> } }>;
    };
    const category = spec.paths['/api/support/log']!.get.parameters.find((p) => p.name === 'category');
    expect([...(category?.schema.enum ?? [])].sort()).toEqual([...FAILURE_CATEGORIES].sort());
  });
});
