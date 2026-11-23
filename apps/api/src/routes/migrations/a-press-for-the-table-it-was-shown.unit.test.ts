// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PRESS FOR THE TABLE IT WAS SHOWN (workplan 0168 D5, the data-path
 * review's S5 (d)): the managed half.
 *
 * *Apply the new addresses here too* recorded whatever the organisation's
 * table was at the moment of the press, so a row added or changed after the
 * page rendered reached the person's live data unseen. The press now sends
 * the press digest of the table the page showed, and the route:
 *
 *  - records it when the table is still that table (200);
 *  - refuses with 409, in English and Dutch, when it moved since, and records
 *    nothing;
 *  - refuses with 400, in both languages, a press that names no table;
 *  - answers 404 for another organisation's migration, whatever it names.
 *
 * The real route over a real (in-process) ledger, both chains applied.
 * Addresses are `example.org` only.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { LedgerDriver } from '@openmig/ledger';
import { ADDRESS_TABLE_MOVED, addressKey, addressTablePressDigest } from '@openmig/shared';

// UUID family 0168d500-…, unused elsewhere in the repo.
const P = '0168d500-e29b-41d4-a716-4466554400';
const ORG = `${P}01`;
const OTHER = `${P}02`;
const MAPPING = `${P}11`;
const OTHERS_MAPPING = `${P}12`;

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: ORG, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

const ANA = { oldKey: addressKey('ana@old.example.org'), oldAddress: 'ana@old.example.org', newAddress: 'ana@example.org' };
const BEN = { oldKey: addressKey('ben@old.example.org'), oldAddress: 'ben@old.example.org', newAddress: 'ben@example.org' };

const confirm = (row: typeof ANA) =>
  sql(
    `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, state, set_by, confirmed_by, confirmed_at)
     VALUES ($1,$2,$3,$4,'confirmed','pat','pat',now())`,
    [ORG, row.oldKey, row.oldAddress, row.newAddress],
  );

const pressed = async (): Promise<string | null> =>
  (
    await sql<{ d: string | null }>('SELECT address_changes_applied_digest AS d FROM mailbox_mapping WHERE id = $1', [
      MAPPING,
    ])
  )[0]?.d ?? null;

const press = (mappingId: string, body?: unknown) => {
  const r = request(app).post(`/api/migrations/${mappingId}/address-changes/apply`);
  return body === undefined ? r : r.send(body as object);
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [tenantId, mappingId, n] of [
    [ORG, MAPPING, '1'],
    [OTHER, OTHERS_MAPPING, '2'],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenantId, `press ${n}`]);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'carddav', 'c', '{}'::jsonb, 'connected')`,
      [`${P}2${n}`, tenantId],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [`${P}3${n}`, tenantId, `${P}2${n}`],
    );
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1, $2, $3, 'cutover')`,
      [mappingId, tenantId, `${P}3${n}`],
    );
  }
  await confirm(ANA);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('a press for the table it was shown', () => {
  it('refuses a press that names no table, in both languages, and records nothing', async () => {
    const res = await press(MAPPING);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'digest_required' });
    expect(res.body.messageNl).toEqual(expect.any(String));
    expect(await pressed()).toBeNull();
  });

  it('refuses with 409, in both languages, a press for a table that moved since the page showed it', async () => {
    // The page showed Ana's row alone; Ben's was confirmed after it rendered.
    const shown = addressTablePressDigest([ANA]);
    await confirm(BEN);
    const res = await press(MAPPING, { digest: shown });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'address_table_moved',
      message: ADDRESS_TABLE_MOVED.en,
      messageNl: ADDRESS_TABLE_MOVED.nl,
      digest: addressTablePressDigest([ANA, BEN]),
      rows: 2,
    });
    expect(await pressed()).toBeNull();
  });

  it('records the press for the table as the page showed it', async () => {
    const shown = addressTablePressDigest([ANA, BEN]);
    const res = await press(MAPPING, { digest: shown });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: MAPPING, applied: true, digest: shown, rows: 2 });
    expect(await pressed()).toBe(shown);
  });

  it('answers 404 for another organisation’s migration, whatever it names', async () => {
    expect((await press(OTHERS_MAPPING, { digest: addressTablePressDigest([ANA, BEN]) })).status).toBe(404);
    expect((await press(OTHERS_MAPPING, { digest: 'a'.repeat(64) })).status).toBe(404);
  });
});
