// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * OF ABOUT HOW MANY, ON THE MANAGED API (workplan 0154 T2).
 *
 * The real `GET /api/migrations/:mappingId` over a real in-process ledger. Its
 * `domainStatus` rows said how many had arrived and not of how many; each now
 * carries what discovery found of it (`itemsFound`, `bytesFound`), read in the
 * same transaction as the counts it is set against. What a total means is the
 * shared test's business (`a-count-with-no-total.unit.test.ts`); here it is
 * what the route adds: the join, and the discovery route's own rule that only
 * the migration's own data types have a count.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 0154a200-…, unused elsewhere in the repo.
const TENANT = '0154a200-e29b-41d4-a716-446655440001';
const CONN = '0154a200-e29b-41d4-a716-446655440011';
const BOX = '0154a200-e29b-41d4-a716-446655440021';
const MAPPING = '0154a200-e29b-41d4-a716-446655440031';
const NEVER_DISCOVERED = '0154a200-e29b-41d4-a716-446655440041';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/** A migration carrying `domains`, with a status row for each of `running`. */
async function migration(id: string, domains: readonly string[], running: readonly string[]): Promise<void> {
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,'active')`,
    [id, TENANT, BOX],
  );
  for (const domain of domains) {
    await sql(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      id,
      domain,
    ]);
  }
  for (const domain of running) {
    await sql(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state) VALUES ($1,$2,$3,'in_progress')`,
      [TENANT, id, domain],
    );
  }
}

/** `count` items of `domain` copied, `size` bytes each. */
async function copied(domain: string, count: number, size: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await sql(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, size_bytes, status)
       VALUES ($1,$2,$3,'INBOX',$4,$5,$6,'copied')`,
      [TENANT, MAPPING, domain, `${domain}-${i}`, `${domain}-hash-${i}`, size],
    );
  }
}

async function discovered(
  domain: string,
  counts: { collections: number; items: number; bytes: number | null; lastError?: string },
): Promise<void> {
  await sql(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [TENANT, MAPPING, domain, counts.collections, counts.items, counts.bytes, counts.lastError ?? null],
  );
}

type Row = { domain: string; itemsSynced: number; itemsFound?: number; bytesFound?: number };

async function rows(id = MAPPING): Promise<Record<string, Row>> {
  const res = await request(app).get(`/api/migrations/${id}`);
  expect(res.status).toBe(200);
  return Object.fromEntries((res.body.domainStatus as Row[]).map((r) => [r.domain, r]));
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'totals']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','m@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  // Mail, contacts and files carried; tasks were carried once and are not now.
  await migration(MAPPING, ['email', 'contact', 'file'], ['email', 'contact', 'file', 'task']);
  await copied('email', 3, 1_000);
  await discovered('email', { collections: 2, items: 5, bytes: 9_000 });
  await discovered('contact', { collections: 1, items: 612, bytes: null });
  // Files: the first attempt failed, so discovery has zeros and an error.
  await discovered('file', { collections: 0, items: 0, bytes: 0, lastError: '403 insufficientPermissions' });
  // A count for a data type the migration does not carry.
  await discovered('task', { collections: 1, items: 40, bytes: null });
  await migration(NEVER_DISCOVERED, ['email'], ['email']);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('GET /api/migrations/:mappingId — of about how many', () => {
  it('sets each data type beside what discovery found of it, items and bytes', async () => {
    const { email } = await rows();
    expect(email).toMatchObject({ itemsSynced: 3, itemsFound: 5, bytesFound: 9_000 });
  });

  it('has no bytes where the source has no cheap sizes', async () => {
    const { contact } = await rows();
    expect(contact?.itemsFound).toBe(612);
    expect(contact && 'bytesFound' in contact).toBe(false);
  });

  /** Hard rule 9: a count nobody took is absent, never 0. */
  it('has no total where the only attempt to count failed', async () => {
    const { file } = await rows();
    expect(file && 'itemsFound' in file).toBe(false);
  });

  /** The discovery route's own rule: a count left by a type it does not carry is no row's total. */
  it('gives no total to a data type the migration does not carry', async () => {
    const { task } = await rows();
    expect(task).toBeDefined();
    expect(task && 'itemsFound' in task).toBe(false);
  });

  it('has no total anywhere when discovery never ran', async () => {
    const { email } = await rows(NEVER_DISCOVERED);
    expect(email).toBeDefined();
    expect(email && 'itemsFound' in email).toBe(false);
    expect(email && 'bytesFound' in email).toBe(false);
  });
});
