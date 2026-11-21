// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST ORGANISATION AND ITS MARKER (workplan 0162 T1, §3; the owner's §2
 * (b) and (c); ADR-0053), through the real routes, against PGlite as
 * `app_user` with both migration chains.
 *
 * - **The two doors.** `POST /api/support/tenants/{tenantId}/test` with
 *   `{ marker }` sets the organisation's marker, or replaces it, and `DELETE`
 *   clears it. An appointed operator only: anybody else, and an id that names
 *   nobody, get the same 404, and nothing is written. Each writes an audit
 *   row, under the operator, and a refused one writes none.
 * - **The marker's form.** Required, trimmed, 3 to 64 printable characters:
 *   400 `bad_marker` otherwise, before anything is read.
 * - **Only while it holds no migration.** 409 `holds_a_migration` with the
 *   sentence the screen shows, for a draft and a finished migration alike,
 *   and for a clear as for a set.
 * - **Each migration's own copy.** `POST /api/migrations` copies the
 *   organisation's marker onto the migration, in the transaction that creates
 *   it; an organisation that is not a test makes migrations with none. The
 *   list and the migration's own read carry it as `testMarker`, and its
 *   Finish page is offered neither End nor Keep for its data types.
 *
 * UUID family 0162b100-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

/** Marked and unmarked here; holds a migration only when a test made one. */
const TEST_ORG = '0162b100-e29b-41d4-a716-446655440001';
/** Never marked. */
const PLAIN = '0162b100-e29b-41d4-a716-446655440002';
/** A well-formed id that is not in the database. */
const ABSENT = '0162b100-e29b-41d4-a716-446655440099';

const OPERATOR = 'operator-subject-0162-t1';
const NOT_OPERATOR = 'ordinary-subject-0162-t1';

let driver: LedgerDriver;
/** The subject `authenticateSubject` pretends to have verified, for the support routes. */
let caller: string | undefined;
/** The organisation `authenticate` resolves, for the migration routes. */
let organisation = TEST_ORG;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (caller === undefined) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, { userId: caller });
      next();
    },
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: organisation, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: supportRoutes } = await import('./support.ts');
const { default: migrationRoutes } = await import('./migrations/index.ts');
const { markAsTestAsOperator, unmarkTestAsOperator } = await import('../test-organisation.ts');
const { NotAnAppointedOperator } = await import('../close-account.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);
app.use('/api/migrations', migrationRoutes);

/** One statement as the owner, outside any route: the witness no route can fake. */
async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as T[];
  } finally {
    conn.release();
  }
}

const markerOf = async (tenantId: string) =>
  (await q<{ marker: string }>(`SELECT marker FROM test_organisation WHERE tenant_id = $1`, [tenantId]))[0]?.marker;

const audit = async (tenantId: string) =>
  q<{ actor: string; action: string; detail: Record<string, unknown> }>(
    `SELECT actor, action, detail FROM audit_log
      WHERE tenant_id = $1 AND action LIKE 'tenant.test_marker_%' ORDER BY at, id`,
    [tenantId],
  );

const mark = (tenantId: string, body: unknown) =>
  request(app).post(`/api/support/tenants/${tenantId}/test`).set('Authorization', 'Bearer stub').send(body as object);
const unmark = (tenantId: string) =>
  request(app).delete(`/api/support/tenants/${tenantId}/test`).set('Authorization', 'Bearer stub');

let made = 0;
/** The wizard's create, for a new pair of accounts each time, in `organisation`. */
function create() {
  made += 1;
  const account = `tester-${made}@example.com`;
  return request(app)
    .post('/api/migrations')
    .send({
      name: `migration ${made}`,
      sourceType: 'imap',
      targetType: 'jmap',
      sourceConfig: { host: 'src.example.com', port: 993, username: account, password: 'p' },
      targetConfig: { host: 'dst.example.com', port: 443, username: account, password: 'p' },
      syncConfig: { domains: ['email'] },
    });
}

/** Take every migration out of an organisation, as its Delete would, so it holds none. */
async function emptied(tenantId: string): Promise<void> {
  await q(`DELETE FROM scope_selection WHERE tenant_id = $1`, [tenantId]);
  await q(`DELETE FROM path_lifecycle WHERE tenant_id = $1`, [tenantId]);
  await q(`DELETE FROM mailbox_mapping WHERE tenant_id = $1`, [tenantId]);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Test org', 'active'), ($2, 'Plain org', 'active')`, [
    TEST_ORG,
    PLAIN,
  ]);
  await q(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = OPERATOR;
  organisation = TEST_ORG;
  for (const tenant of [TEST_ORG, PLAIN]) await emptied(tenant);
  await q(`DELETE FROM test_organisation`);
  await q(`DELETE FROM audit_log WHERE action LIKE 'tenant.test_marker_%'`);
});

describe('the operator marks an organisation as a test, and clears it', () => {
  it('sets the marker, trimmed, recorded under the operator; the organisation’s page serves it', async () => {
    const res = await mark(TEST_ORG, { marker: '  [Ownpace-test] ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ testMarker: '[Ownpace-test]' });
    expect(await markerOf(TEST_ORG)).toBe('[Ownpace-test]');
    expect(await audit(TEST_ORG)).toEqual([
      { actor: OPERATOR, action: 'tenant.test_marker_set', detail: { marker: '[Ownpace-test]', via: 'operator' } },
    ]);
    const page = await request(app).get(`/api/support/tenants/${TEST_ORG}`).set('Authorization', 'Bearer stub');
    expect(page.status).toBe(200);
    expect(page.body.tenant.test_marker).toBe('[Ownpace-test]');
  });

  it('replaces a marker, and records the one it replaced', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    const res = await mark(TEST_ORG, { marker: '[Other-test]' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ testMarker: '[Other-test]', replaced: '[Ownpace-test]' });
    expect(await markerOf(TEST_ORG)).toBe('[Other-test]');
    expect((await audit(TEST_ORG)).map((a) => a.detail)).toEqual([
      { marker: '[Ownpace-test]', via: 'operator' },
      { marker: '[Other-test]', via: 'operator', replaced: '[Ownpace-test]' },
    ]);
  });

  it('clears it, recorded; clearing an organisation that is not a test changes and records nothing', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    const res = await unmark(TEST_ORG);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ testMarker: null, cleared: '[Ownpace-test]' });
    expect(await markerOf(TEST_ORG)).toBeUndefined();
    const again = await unmark(TEST_ORG);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ testMarker: null, cleared: null });
    expect((await audit(TEST_ORG)).map((a) => [a.action, a.detail])).toEqual([
      ['tenant.test_marker_set', { marker: '[Ownpace-test]', via: 'operator' }],
      ['tenant.test_marker_cleared', { marker: '[Ownpace-test]', via: 'operator' }],
    ]);
  });
});

describe('anybody else gets a 404, as for reopen, and nothing is written', () => {
  it('a subject who is not an appointed operator, either door', async () => {
    caller = NOT_OPERATOR;
    const set = await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    expect(set.status).toBe(404);
    expect(set.body).toEqual({ error: 'Not found', message: 'No such organisation' });
    expect((await unmark(TEST_ORG)).status).toBe(404);
    expect(await markerOf(TEST_ORG)).toBeUndefined();
    expect(await audit(TEST_ORG)).toEqual([]);
  });

  it('a subject who is not an operator cannot clear an operator’s mark either', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    caller = NOT_OPERATOR;
    expect((await unmark(TEST_ORG)).status).toBe(404);
    expect(await markerOf(TEST_ORG)).toBe('[Ownpace-test]');
  });

  it('an organisation that does not exist, and an id that is not one', async () => {
    expect((await mark(ABSENT, { marker: '[Ownpace-test]' })).status).toBe(404);
    expect((await unmark(ABSENT)).status).toBe(404);
    expect((await mark('not-a-uuid', { marker: '[Ownpace-test]' })).status).toBe(400);
    expect(await q(`SELECT 1 FROM test_organisation`)).toEqual([]);
  });

  it('nobody signed in', async () => {
    caller = undefined;
    expect((await mark(TEST_ORG, { marker: '[Ownpace-test]' })).status).toBe(401);
  });

  // ASKED TWICE, AS THE CLOSE IS: the route asks the operator's view first,
  // and the doors ask `platform_operator` themselves, beneath it. Each is
  // held on its own, so that neither can be taken out because the other
  // still answers 404.
  it('beneath the route, the doors themselves mark and clear nothing for a subject who is no operator', async () => {
    await expect(
      markAsTestAsOperator(driver, { tenantId: TEST_ORG, by: NOT_OPERATOR, marker: '[Ownpace-test]' }),
    ).rejects.toBeInstanceOf(NotAnAppointedOperator);
    expect(await markerOf(TEST_ORG)).toBeUndefined();
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    await expect(unmarkTestAsOperator(driver, { tenantId: TEST_ORG, by: NOT_OPERATOR })).rejects.toBeInstanceOf(
      NotAnAppointedOperator,
    );
    expect(await markerOf(TEST_ORG)).toBe('[Ownpace-test]');
    expect((await audit(TEST_ORG)).map((a) => a.actor)).toEqual([OPERATOR]);
  });
});

describe('the marker is required, and its form is held before anything is read', () => {
  it.each([
    ['absent', {}],
    ['empty', { marker: '' }],
    ['spaces', { marker: '   ' }],
    ['too short', { marker: 'ab' }],
    ['too long', { marker: 'a'.repeat(65) }],
    ['a control character', { marker: '[Own\u0007pace]' }],
    ['a character that prints nothing', { marker: '[Own\u200bpace]' }],
    ['not text', { marker: 42 }],
  ])('%s: 400 bad_marker, and nothing written', async (_what, body) => {
    const res = await mark(TEST_ORG, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_marker');
    expect(typeof res.body.message).toBe('string');
    expect(await markerOf(TEST_ORG)).toBeUndefined();
    expect(await audit(TEST_ORG)).toEqual([]);
  });
});

describe('each migration carries its own copy, made with it', () => {
  it('a test organisation’s migration copies the marker; the list and its page carry it, and Finish offers it no ending', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.testMarker).toBe('[Ownpace-test]');
    const id = res.body.id as string;
    expect(await q(`SELECT test_marker FROM mailbox_mapping WHERE id = $1`, [id])).toEqual([
      { test_marker: '[Ownpace-test]' },
    ]);

    const list = await request(app).get('/api/migrations');
    expect(list.status).toBe(200);
    expect(list.body.mappings.find((m: { id: string }) => m.id === id).testMarker).toBe('[Ownpace-test]');

    // Started, as `…/start` leaves it, so its data types would be offered an ending.
    await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [id]);
    await q(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at) VALUES ($1, $2, 'email', 'active', now())`,
      [TEST_ORG, id],
    );
    const page = await request(app).get(`/api/migrations/${id}`);
    expect(page.status).toBe(200);
    expect(page.body.testMarker).toBe('[Ownpace-test]');
    expect(page.body.endingChoices).toEqual([{ domain: 'email', phase: 'active', stopped: false, offers: [] }]);
  });

  it('an organisation that is not a test makes migrations with none, and its Finish offers both', async () => {
    organisation = PLAIN;
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('testMarker');
    const id = res.body.id as string;
    expect(await q(`SELECT test_marker FROM mailbox_mapping WHERE id = $1`, [id])).toEqual([{ test_marker: null }]);
    const list = await request(app).get('/api/migrations');
    expect(list.body.mappings.find((m: { id: string }) => m.id === id)).not.toHaveProperty('testMarker');
    await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [id]);
    await q(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at) VALUES ($1, $2, 'email', 'active', now())`,
      [PLAIN, id],
    );
    const page = await request(app).get(`/api/migrations/${id}`);
    expect(page.body).not.toHaveProperty('testMarker');
    expect(page.body.endingChoices[0].offers).toEqual(['end', 'keep']);
  });

  it('another organisation’s mark is not copied', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    organisation = PLAIN;
    const res = await create();
    expect(await q(`SELECT test_marker FROM mailbox_mapping WHERE id = $1`, [res.body.id])).toEqual([{ test_marker: null }]);
  });
});

describe('only while the organisation holds no migration', () => {
  it.each(['paused', 'done'])('holding one that is %s: neither door writes, and each says why', async (status) => {
    const made = await create();
    expect(made.status).toBe(201);
    await q(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [made.body.id, status]);

    const set = await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    expect(set.status).toBe(409);
    expect(set.body).toEqual({
      error: 'holds_a_migration',
      held: 1,
      message: expect.stringMatching(/^It holds 1 migration: an organisation becomes a test only while it holds none/),
    });
    expect(await markerOf(TEST_ORG)).toBeUndefined();
    expect(await audit(TEST_ORG)).toEqual([]);
  });

  it('a test organisation holding its test migration cannot be cleared, and can once it is deleted', async () => {
    await mark(TEST_ORG, { marker: '[Ownpace-test]' });
    const made = await create();
    expect(made.body.testMarker).toBe('[Ownpace-test]');

    const refused = await unmark(TEST_ORG);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: 'holds_a_migration',
      held: 1,
      message: expect.stringMatching(/^It holds 1 migration: an organisation stops being a test only while it holds none/),
    });
    // Nor can its marker be changed under it.
    expect((await mark(TEST_ORG, { marker: '[Other-test]' })).status).toBe(409);
    expect(await markerOf(TEST_ORG)).toBe('[Ownpace-test]');
    expect((await audit(TEST_ORG)).map((a) => a.action)).toEqual(['tenant.test_marker_set']);

    await emptied(TEST_ORG);
    expect((await unmark(TEST_ORG)).status).toBe(200);
    const after = await create();
    expect(after.body).not.toHaveProperty('testMarker');
  });
});
