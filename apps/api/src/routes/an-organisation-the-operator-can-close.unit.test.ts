// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION THE OPERATOR CAN CLOSE (workplan 0139 T7 (b)): the support
 * page's Close and Reopen, and the list that shows which organisations nobody
 * uses (managed migration 0060), against a REAL database.
 *
 * The close is a write in the organisation's own context, where row security
 * lets the organisation's rows through to anybody. So the questions are the
 * ones a view cannot answer by itself:
 *
 *  - does a subject who is not an operator close or reopen NOTHING, and hear
 *    the same 404 as for an id that names nobody?
 *  - is it the close `operator.sh close` makes: the same row in
 *    `tenant_closure`, the same audit row, with the operator and the reference?
 *  - is every refusal made before anything is written?
 *  - does a reopen happen only while the window is open, and get recorded?
 *  - does the list say what the migration says it says: active members only,
 *    the connections, the latest pass, and the two dates of a close?
 *
 * PGlite as `app_user`, both migration chains, and only `authenticateSubject`
 * stubbed, as `support-routes.unit.test.ts` does. The orchestrator is a fake
 * that records what it was asked to cancel.
 *
 * UUID family c105e000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

/** Used: an owner signed in, a connection, a migration and a pass. */
const USED = 'c105e000-e29b-41d4-a716-446655440001';
/** Granted and never claimed: one invitation, nothing else (0139's Status, 2026-11-16). */
const UNUSED = 'c105e000-e29b-41d4-a716-446655440002';
/** A third, for the window of 0. */
const AT_ONCE = 'c105e000-e29b-41d4-a716-446655440003';
/** One whose erasure has begun. */
const ERASING = 'c105e000-e29b-41d4-a716-446655440004';
const CONN = 'c105e000-e29b-41d4-a716-446655440011';
const BOX = 'c105e000-e29b-41d4-a716-446655440021';
const MAPPING = 'c105e000-e29b-41d4-a716-446655440031';
/** A well-formed id that is not in the database. */
const ABSENT = 'c105e000-e29b-41d4-a716-446655440099';

const OPERATOR = 'operator-subject-0139-t7b';
const NOT_OPERATOR = 'ordinary-subject-0139-t7b';
const REFERENCE = 'their mail of 17 November';
/** The orchestrator's reference of the pass in flight when USED is closed. */
const PASS_IN_FLIGHT = 'run_c105e_in_flight';

let driver: LedgerDriver;
/** Set per test: the subject `authenticateSubject` pretends to have verified. */
let caller: string | undefined;
/** What the fake orchestrator was asked to cancel. */
const cancelled: string[] = [];

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

vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({
    runs: {
      cancel: async (ref: string) => {
        cancelled.push(ref);
      },
    },
  }),
}));

const { default: supportRoutes } = await import('./support.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

/** Read as the owner, to see what really exists. */
async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** A timestamp as ISO text, from a Date (a direct read) or text (JSON), keeping the milliseconds. */
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

const statusOf = async (tenantId: string) =>
  (await rows('SELECT status FROM tenant WHERE id = $1', [tenantId]))[0]?.status;

const closureOf = async (tenantId: string) =>
  (await rows('SELECT closed_by, closed_at, purge_after FROM tenant_closure WHERE tenant_id = $1', [tenantId]))[0];

const auditOf = async (tenantId: string) =>
  rows(
    `SELECT actor, action, detail FROM audit_log
      WHERE tenant_id = $1 AND action IN ('tenant.closed', 'tenant.reopened')
      ORDER BY at, action`,
    [tenantId],
  );

const post = (path: string, body: unknown) =>
  request(app).post(path).set('Authorization', 'Bearer stub').send(body as object);

const close = (tenantId: string, body: unknown) => post(`/api/support/tenants/${tenantId}/close`, body);
const reopen = (tenantId: string, body: unknown) => post(`/api/support/tenants/${tenantId}/reopen`, body);

type ListedTenant = Record<string, unknown> & { tenant_id: string };
async function listed(tenantId: string): Promise<ListedTenant | undefined> {
  const res = await request(app).get('/api/support/tenants').set('Authorization', 'Bearer stub');
  expect(res.status).toBe(200);
  return (res.body.tenants as ListedTenant[]).find((t) => t.tenant_id === tenantId);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    for (const [id, name] of [
      [USED, 'Used BV'],
      [UNUSED, 'Unused BV'],
      [AT_ONCE, 'At Once BV'],
      [ERASING, 'Erasing BV'],
    ] as const) {
      await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [id, name]);
    }
    await q("UPDATE tenant SET status = 'deleting' WHERE id = $1", [ERASING]);
    // USED: an owner who signed in, and one who left (not counted).
    await q(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, 'sub-owner', 'owner@used.test', 'owner', 'active', now()),
              ($1, 'sub-gone', 'gone@used.test', 'member', 'removed', now())`,
      [USED],
    );
    // UNUSED: the owner invitation a granted request makes, never claimed.
    await q(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
       VALUES ($1, 'pending:invite', 'invitee@unused.test', 'owner', 'invited', 'requested', now())`,
      [UNUSED],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1, $2, 'source', 'imap', 'Used mail', '{}'::jsonb, 'connected', 'ref')`,
      [CONN, USED],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'someone@used.test')`,
      [BOX, USED, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1, $2, $3, 'active', 'Used migration')`,
      [MAPPING, USED, BOX],
    );
    // Two passes: an old one that finished, and one still running, which the
    // close must ask the orchestrator to stop.
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, status, created_at)
       VALUES ($1, $2, 'incremental', 'succeeded', TIMESTAMPTZ '2026-11-01T08:00:00Z')`,
      [USED, MAPPING],
    );
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, status, orchestrator_ref, created_at)
       VALUES ($1, $2, 'incremental', 'running', $3, TIMESTAMPTZ '2026-11-17T09:00:00Z')`,
      [USED, MAPPING, PASS_IN_FLIGHT],
    );
    await q(`INSERT INTO platform_operator (user_id, email, note) VALUES ($1, 'operator@ownpace.eu', '0139 T7 (b) fixture')`, [
      OPERATOR,
    ]);
  } finally {
    await conn.release();
  }
},
  // Both migration chains in an in-memory Postgres, the cost
  // `support-routes.unit.test.ts` states.
  60_000,
);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  caller = undefined;
});

describe('the list says who is using it, and when a closed one goes', () => {
  it('counts ACTIVE members, the connections, and the latest pass', async () => {
    caller = OPERATOR;
    const used = await listed(USED);
    expect(Number(used?.member_count)).toBe(1);
    expect(Number(used?.connection_count)).toBe(1);
    expect(Number(used?.migration_count)).toBe(1);
    expect(iso(used?.last_pass_at)).toBe('2026-11-17T09:00:00.000Z');
    expect(used?.closed_at).toBeNull();
    expect(used?.purge_after).toBeNull();

    // The invitation nobody claimed is nobody: the shape of an organisation
    // nobody uses.
    const unused = await listed(UNUSED);
    expect(Number(unused?.member_count)).toBe(0);
    expect(Number(unused?.connection_count)).toBe(0);
    expect(Number(unused?.migration_count)).toBe(0);
    expect(unused?.last_pass_at).toBeNull();
  });

  it('serves nobody else any of it', async () => {
    caller = NOT_OPERATOR;
    const res = await request(app).get('/api/support/tenants').set('Authorization', 'Bearer stub');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual([]);
  });
});

describe('a close is refused before anything is written', () => {
  it('without a subject: 401', async () => {
    const res = await close(UNUSED, { windowDays: 30, reference: REFERENCE });
    expect(res.status).toBe(401);
    expect(await statusOf(UNUSED)).toBe('active');
  });

  it('for a subject who is not an operator: the 404 an absent id gets, and nothing closed', async () => {
    caller = NOT_OPERATOR;
    const res = await close(UNUSED, { windowDays: 30, reference: REFERENCE });
    expect(res.status).toBe(404);
    caller = OPERATOR;
    const absent = await close(ABSENT, { windowDays: 30, reference: REFERENCE });
    expect(absent.status).toBe(404);
    expect(res.body).toEqual(absent.body);
    expect(await statusOf(UNUSED)).toBe('active');
    expect(await closureOf(UNUSED)).toBeUndefined();
    expect(await auditOf(UNUSED)).toEqual([]);
  });

  it.each([
    ['a window not on the list', { windowDays: 1, reference: REFERENCE }, 'bad_window'],
    ['a window as text', { windowDays: '30', reference: REFERENCE }, 'bad_window'],
    ['no window', { reference: REFERENCE }, 'bad_window'],
    ['no reference', { windowDays: 30 }, 'bad_reference'],
    ['a blank reference', { windowDays: 30, reference: '   ' }, 'bad_reference'],
    ['a reference past 200 characters', { windowDays: 30, reference: 'x'.repeat(201) }, 'bad_reference'],
  ])('%s: 400, and nothing closed', async (_name, body, error) => {
    caller = OPERATOR;
    const res = await close(UNUSED, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(await statusOf(UNUSED)).toBe('active');
    expect(await closureOf(UNUSED)).toBeUndefined();
  });

  it('a malformed id: 400', async () => {
    caller = OPERATOR;
    const res = await close('not-a-uuid', { windowDays: 30, reference: REFERENCE });
    expect(res.status).toBe(400);
  });

  it('an organisation being erased: 409, and nothing written', async () => {
    caller = OPERATOR;
    const res = await close(ERASING, { windowDays: 30, reference: REFERENCE });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_open');
    expect(await statusOf(ERASING)).toBe('deleting');
    expect(await closureOf(ERASING)).toBeUndefined();
  });
});

describe('the operator closes an organisation, as operator.sh close does', () => {
  it('closes it, answers the dates and both languages, and records who and why', async () => {
    caller = OPERATOR;
    const before = Date.now();
    const res = await close(USED, { windowDays: 30, reference: `  ${REFERENCE}  ` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The close's own answer: the one `operator.sh close` prints from.
    expect(res.body.status).toBe('closed');
    expect(res.body.windowDays).toBe(30);
    const purgeAfter = Date.parse(res.body.purgeAfter);
    expect(purgeAfter - before).toBeGreaterThanOrEqual(30 * 86_400_000 - 5_000);
    expect(purgeAfter - before).toBeLessThanOrEqual(30 * 86_400_000 + 60_000);
    expect(res.body.canReopenUntil).toBe(res.body.purgeAfter);
    expect(typeof res.body.erasureCompletesText.en).toBe('string');
    expect(typeof res.body.erasureCompletesText.nl).toBe('string');
    expect(res.body.erasureCompletesText.nl).not.toBe(res.body.erasureCompletesText.en);
    expect(Array.isArray(res.body.outlivingAccess.en)).toBe(true);
    expect(Array.isArray(res.body.outlivingAccess.nl)).toBe(true);

    // The pass in flight was asked to stop, and only that one.
    expect(cancelled).toEqual([PASS_IN_FLIGHT]);
    expect(res.body.passesStopped).toBe(1);

    expect(await statusOf(USED)).toBe('closed');
    const closure = await closureOf(USED);
    expect(closure?.closed_by).toBe(OPERATOR);
    expect(iso(closure?.purge_after)).toBe(res.body.purgeAfter);
    // Trimmed, as `operator.sh close` keeps `--reference`.
    expect(await auditOf(USED)).toEqual([
      {
        actor: OPERATOR,
        action: 'tenant.closed',
        detail: { windowDays: 30, via: 'operator', reference: REFERENCE },
      },
    ]);
  });

  it('the list then says when, and until when it can be reopened', async () => {
    caller = OPERATOR;
    const used = await listed(USED);
    expect(used?.tenant_status).toBe('closed');
    expect(used?.closed_at).not.toBeNull();
    const closure = await closureOf(USED);
    expect(iso(used?.purge_after)).toBe(iso(closure?.purge_after));
  });

  it('a second close is refused: the window stands until a reopen', async () => {
    caller = OPERATOR;
    const purgeBefore = (await closureOf(USED))?.purge_after;
    const res = await close(USED, { windowDays: 0, reference: REFERENCE });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_open');
    expect((await closureOf(USED))?.purge_after).toEqual(purgeBefore);
    expect((await auditOf(USED)).length).toBe(1);
  });
});

describe('the operator reopens it while the window is open', () => {
  it('for a subject who is not an operator: 404, and it stays closed', async () => {
    caller = NOT_OPERATOR;
    const res = await reopen(USED, { reference: REFERENCE });
    expect(res.status).toBe(404);
    expect(await statusOf(USED)).toBe('closed');
  });

  it('without a reference: 400, and it stays closed', async () => {
    caller = OPERATOR;
    const res = await reopen(USED, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_reference');
    expect(await statusOf(USED)).toBe('closed');
  });

  it('reopens it, and records who and why', async () => {
    caller = OPERATOR;
    const res = await reopen(USED, { reference: 'closed by mistake' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: 'active' });
    expect(await statusOf(USED)).toBe('active');
    expect(await closureOf(USED)).toBeUndefined();
    const audit = await auditOf(USED);
    expect(audit.at(-1)).toEqual({
      actor: OPERATOR,
      action: 'tenant.reopened',
      detail: { via: 'operator', reference: 'closed by mistake' },
    });
  });

  it('an open organisation: 409', async () => {
    caller = OPERATOR;
    const res = await reopen(USED, { reference: REFERENCE });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('cannot_reopen');
  });
});

describe('a window of 0 erases at the next purge, and cannot be undone', () => {
  it('closes with nothing to reopen until, and a reopen is refused and unrecorded', async () => {
    caller = OPERATOR;
    const res = await close(AT_ONCE, { windowDays: 0, reference: REFERENCE });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.canReopenUntil).toBeNull();
    expect(await statusOf(AT_ONCE)).toBe('closed');

    const again = await reopen(AT_ONCE, { reference: REFERENCE });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('cannot_reopen');
    expect(await statusOf(AT_ONCE)).toBe('closed');
    expect((await auditOf(AT_ONCE)).map((r) => r.action)).toEqual(['tenant.closed']);
  });
});
