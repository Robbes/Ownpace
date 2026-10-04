// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT WAS FOUND, IN THE REPORT (workplan 0154 T5).
 *
 * The report page says, per data type, what was found beside what arrived and
 * what was left as it was. The real `GET /api/migrations/:mappingId/completion-report`
 * over a real in-process ledger: each domain line carries discovery's count of
 * it, by the rule the migration's own page reads it by (only the migration's
 * own data types, and no count where the only attempt failed), and the
 * Markdown says the same in its last two columns.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 0154a500-…, unused elsewhere in the repo.
const TENANT = '0154a500-e29b-41d4-a716-446655440001';
const CONN = '0154a500-e29b-41d4-a716-446655440011';
const BOX = '0154a500-e29b-41d4-a716-446655440021';
const MAPPING = '0154a500-e29b-41d4-a716-446655440031';

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

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'report']);
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
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,'active')`,
    [MAPPING, TENANT, BOX],
  );
  for (const domain of ['email', 'file']) {
    await sql(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }
  for (const domain of ['email', 'file', 'task']) {
    await sql(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state) VALUES ($1,$2,$3,'in_progress')`,
      [TENANT, MAPPING, domain],
    );
  }
  for (let i = 0; i < 3; i++) {
    await sql(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, size_bytes, status)
       VALUES ($1,$2,'email','INBOX',$3,$4,1000,'copied')`,
      [TENANT, MAPPING, `m-${i}`, `m-hash-${i}`],
    );
  }
  const discovered = (domain: string, items: number, lastError: string | null) =>
    sql(
      `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes, last_error)
       VALUES ($1,$2,$3,1,$4,NULL,$5)`,
      [TENANT, MAPPING, domain, items, lastError],
    );
  await discovered('email', 5, null);
  // Files: the only attempt failed, which is no count.
  await sql(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes, last_error)
     VALUES ($1,$2,'file',0,0,0,'403 insufficientPermissions')`,
    [TENANT, MAPPING],
  );
  // Tasks: counted, but the migration no longer carries them.
  await discovered('task', 40, null);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

type Line = { domain: string; itemsSynced: number; itemsFound?: number };

describe('GET /api/migrations/:mappingId/completion-report — what was found', () => {
  it('sets each data type beside what discovery found of it, and the Markdown says so', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/completion-report`);
    expect(res.status).toBe(200);
    const lines = Object.fromEntries((res.body.report.domains as Line[]).map((d) => [d.domain, d]));
    expect(lines['email']).toMatchObject({ itemsSynced: 3, itemsFound: 5 });
    expect(res.body.markdown).toContain('| found | left as it was |');
    expect(res.body.markdown).toMatch(/\| email \| in_progress \| 3 \| .* \| 5 \| 0 \|/);
  });

  /** Hard rule 9: a count nobody made is absent, never 0. */
  it('carries no count where the only attempt failed, or for a data type the migration does not carry', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/completion-report`);
    const lines = Object.fromEntries((res.body.report.domains as Line[]).map((d) => [d.domain, d]));
    expect('itemsFound' in lines['file']!).toBe(false);
    expect('itemsFound' in lines['task']!).toBe(false);
  });
});
