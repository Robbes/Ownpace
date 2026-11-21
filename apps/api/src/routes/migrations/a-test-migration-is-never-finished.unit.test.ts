// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MIGRATION IS NEVER FINISHED OR SWITCHED OVER (workplan 0162 §2 (e),
 * T3), pressed at the managed API's own doors against a real database.
 *
 * A migration with a test marker (`mailbox_mapping.test_marker`, ledger
 * migration 0070) copies only the items whose title carries it. These doors
 * refuse it, and name the reason:
 *
 *  - Finish (`POST …/finish`), `finishTransition`'s refusal;
 *  - ending or keeping one data type (`POST …/domains/{domain}/end` and
 *    `…/keep`), `endOrKeepDataType`'s, in both languages, because the Finish
 *    page shows it;
 *  - the cutover's preparation (`POST …/cutover`), which by its own rule
 *    refuses what the job refuses, so nothing is enqueued.
 *
 * Each case presses the same door on a migration without a marker, which goes
 * through, and reads the rows directly, outside any route, to see that a
 * refusal wrote nothing. And delete stays open: a test migration is deleted
 * as any other, and then its account.
 *
 * Nothing writes the marker yet (T1), so the fixture inserts it, as a
 * migration's creation will.
 *
 * UUID family 01620003-…, unused elsewhere in the repository.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { A_TEST_IS_NOT_FINISHED, A_TEST_IS_NOT_SWITCHED_OVER } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '01620003-e29b-41d4-a716-446655440001';
const TEST_CONN = '01620003-e29b-41d4-a716-446655440011';
const TEST_BOX = '01620003-e29b-41d4-a716-446655440021';
const TEST = '01620003-e29b-41d4-a716-446655440031';
const PLAIN_CONN = '01620003-e29b-41d4-a716-446655440012';
const PLAIN_BOX = '01620003-e29b-41d4-a716-446655440022';
const PLAIN = '01620003-e29b-41d4-a716-446655440032';
const MARKER = '[Ownpace-test]';

let driver: LedgerDriver;

const { triggered } = vi.hoisted(() => ({ triggered: [] as string[] }));

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'an-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});
// Every enqueue is recorded by its task, and answers: the first pass on
// Start, and the cutover's preparation this file is about.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (task: string) => {
          triggered.push(task);
          return Promise.resolve({ id: `run-${triggered.length}` });
        },
      },
    }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');
const { default: connectionRoutes } = await import('../connections.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/connections', connectionRoutes);

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

/** A source account and its mailbox, in the one organisation. */
async function anAccount(connection: string, mailbox: string): Promise<void> {
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'source', 'imap', 'an account', '{}'::jsonb, 'connected', $3)`,
    [
      connection,
      TENANT,
      JSON.stringify(SecretStore.encryptCredentials({ username: 'a@example.invalid', password: 'p' }).encrypted),
    ],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
    [mailbox, TENANT, connection],
  );
}

/** A migration of mail from that mailbox, with the marker given (none when null). */
async function aMigration(id: string, mailbox: string, marker: string | null): Promise<void> {
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, test_marker)
     VALUES ($1, $2, $3, 'paused', $4)`,
    [id, TENANT, mailbox, marker],
  );
  await query(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'email', true)`,
    [TENANT, id],
  );
}

/** What the migration's own rows say, outside any route. */
async function rowsOf(id: string): Promise<{ status: string | undefined; paths: string[] }> {
  const [mapping] = await query<{ status: string }>(`SELECT status FROM mailbox_mapping WHERE id = $1`, [id]);
  const paths = await query<{ state: string }>(
    `SELECT state FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
    [id],
  );
  return { status: mapping?.status, paths: paths.map((p) => p.state) };
}

/** Started through the real door, so its data type has its path row. */
async function started(id: string): Promise<void> {
  const res = await request(app).post(`/api/migrations/${id}/start`).send({});
  expect(res.status).toBe(200);
  expect(await rowsOf(id)).toEqual({ status: 'active', paths: ['active'] });
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the doors here write the month's peak and read
  // the operator's hold, both managed-only tables.
  await runManagedMigrations({ driver, logger: () => {} });

  await query('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'a test organisation']);
  // Room for both migrations' paths (workplan 0109 T6): this file is not
  // about the tier.
  await query(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
    [TENANT],
  );
  await anAccount(TEST_CONN, TEST_BOX);
  await anAccount(PLAIN_CONN, PLAIN_BOX);
  await aMigration(TEST, TEST_BOX, MARKER);
  await aMigration(PLAIN, PLAIN_BOX, null);
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  triggered.length = 0;
  await query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id IN ($1, $2)`, [TEST, PLAIN]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id IN ($1, $2)`, [TEST, PLAIN]);
});

describe('Finish', () => {
  it('refuses a test migration, names the reason, and writes nothing', async () => {
    await started(TEST);

    const res = await request(app).post(`/api/migrations/${TEST}/finish`).send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: A_TEST_IS_NOT_FINISHED.en, hint: 'Nothing was changed.', code: 'test_migration' });
    expect(await rowsOf(TEST)).toEqual({ status: 'active', paths: ['active'] });
  });

  it('is not gone over by force', async () => {
    await started(TEST);

    const res = await request(app).post(`/api/migrations/${TEST}/finish?force=true`).send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('test_migration');
    expect(await rowsOf(TEST)).toEqual({ status: 'active', paths: ['active'] });
  });

  it('finishes the same migration without a marker', async () => {
    await started(PLAIN);

    const res = await request(app).post(`/api/migrations/${PLAIN}/finish`).send({});

    expect(res.status).toBe(200);
    expect(await rowsOf(PLAIN)).toEqual({ status: 'done', paths: ['done'] });
  });
});

describe('ending or keeping one data type', () => {
  it.each(['end', 'keep'] as const)(
    'refuses to %s a test migration’s data type, in both languages, and writes nothing',
    async (ending) => {
      await started(TEST);

      const res = await request(app).post(`/api/migrations/${TEST}/domains/email/${ending}`).send({});

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: `${ending}_refused`,
        refused: 'test_migration',
        message: A_TEST_IS_NOT_FINISHED.en,
        messageNl: A_TEST_IS_NOT_FINISHED.nl,
        reason: A_TEST_IS_NOT_FINISHED.en,
        reasonNl: A_TEST_IS_NOT_FINISHED.nl,
      });
      expect(await rowsOf(TEST)).toEqual({ status: 'active', paths: ['active'] });
    },
  );

  it('ends the same data type of a migration without a marker', async () => {
    await started(PLAIN);

    const res = await request(app).post(`/api/migrations/${PLAIN}/domains/email/end`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, to: 'done' });
    expect(await rowsOf(PLAIN)).toEqual({ status: 'done', paths: ['done'] });
  });

  it('keeps it copying, for a migration without a marker', async () => {
    await started(PLAIN);

    const res = await request(app).post(`/api/migrations/${PLAIN}/domains/email/keep`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, to: 'continuous' });
    expect(await rowsOf(PLAIN)).toEqual({ status: 'continuous', paths: ['continuous'] });
  });
});

describe("the cutover's preparation", () => {
  it('refuses a test migration before it asks the ledger, and enqueues nothing', async () => {
    await started(TEST);
    triggered.length = 0;

    const res = await request(app).post(`/api/migrations/${TEST}/cutover`).send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'cutover_refused',
      message: A_TEST_IS_NOT_SWITCHED_OVER.en,
      hint: 'Nothing was changed.',
      code: 'test_migration',
    });
    expect(triggered).toEqual([]);
    expect(
      await query(`SELECT 1 FROM audit_log WHERE action = 'cutover.preparation_requested' AND detail->>'mappingId' = $1`, [
        TEST,
      ]),
    ).toHaveLength(0);
  });

  it('enqueues the preparation of a migration without a marker', async () => {
    await started(PLAIN);
    triggered.length = 0;

    const res = await request(app).post(`/api/migrations/${PLAIN}/cutover`).send({});

    expect(res.status).toBe(202);
    expect(triggered).toEqual(['run-cutover']);
  });
});

describe('delete stays open', () => {
  const ACCOUNT = '01620003-e29b-41d4-a716-446655440013';
  const BOX = '01620003-e29b-41d4-a716-446655440023';
  const DELETED = '01620003-e29b-41d4-a716-446655440033';

  it('deletes a test migration as any other, and then its account', async () => {
    await anAccount(ACCOUNT, BOX);
    await aMigration(DELETED, BOX, MARKER);
    await started(DELETED);

    // Its account is refused while the migration uses it, as any account is.
    expect((await request(app).delete(`/api/connections/${ACCOUNT}`)).status).toBe(409);

    const deleted = await request(app).delete(`/api/migrations/${DELETED}`);
    expect(deleted.status).toBe(200);
    expect(await query(`SELECT 1 FROM mailbox_mapping WHERE id = $1`, [DELETED])).toHaveLength(0);

    const account = await request(app).delete(`/api/connections/${ACCOUNT}`);
    expect(account.status).toBe(200);
    expect(await query(`SELECT 1 FROM connection WHERE id = $1`, [ACCOUNT])).toHaveLength(0);
  });
});
