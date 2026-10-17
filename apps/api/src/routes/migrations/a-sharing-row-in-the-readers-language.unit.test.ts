// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARING ROW IN THE READER'S LANGUAGE (UX sweep, 2026-10-17).
 *
 * A Dutch tester read an English line under every row of the *Deel-checklist*:
 * the queue stores `mapGrant`'s English target with its developer note glued
 * on, and the sharing GET handed that to the screen as it was. The GET now
 * says each row's line in Dutch beside it, as `verdictTargetNl`, built from
 * the row's own facts and without the note; the screen picks the half in its
 * language.
 *
 * WHAT THIS HOLDS, through the real route over a real in-process ledger:
 *
 * - every row carries `verdictTargetNl`, in Dutch, with no developer note;
 * - the stored English `verdictTarget` reaches the answer unchanged, because
 *   the manual-only refusal quotes it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 0159d5a0-…, unused elsewhere in the repo.
const TENANT = '0159d5a0-e29b-41d4-a716-446655440001';
const SOURCE = '0159d5a0-e29b-41d4-a716-446655440011';
const TARGET = '0159d5a0-e29b-41d4-a716-446655440012';
const SOURCE_BOX = '0159d5a0-e29b-41d4-a716-446655440021';
const TARGET_BOX = '0159d5a0-e29b-41d4-a716-446655440022';
const MAPPING = '0159d5a0-e29b-41d4-a716-446655440031';
const PERSON = '0159d5a0-e29b-41d4-a716-446655440041';
const LINK = '0159d5a0-e29b-41d4-a716-446655440042';

/** What the queue stores today: the English target, with the note glued on. */
const STORED_PERSON = 'a Nextcloud share, read-only — A per-person file or folder share exists on both sides.';
const STORED_LINK =
  'decide whether this link should exist at all after the move — Not a right held by a person, so there is nothing to translate.';

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

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'a sharing row in Dutch']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$3,'source','imap','source','{"host":"mail.example.invalid"}'::jsonb,'connected'),
       ($2,$3,'target','webdav','target','{"baseUrl":"http://127.0.0.1:1"}'::jsonb,'connected')`,
    [SOURCE, TARGET, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
       ($1,$3,$4,'user','m@example.invalid'),
       ($2,$3,$5,'user','t@example.invalid')`,
    [SOURCE_BOX, TARGET_BOX, TENANT, SOURCE, TARGET],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status)
     VALUES ($1,$2,$3,$4,'active')`,
    [MAPPING, TENANT, SOURCE_BOX, TARGET_BOX],
  );
  await sql(
    `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, via_link, raw,
       verdict, verdict_target) VALUES
       ($1,$3,$4,'0159d5-person','drive_item','Projects/budget.xlsx','anna@example.invalid','reader',false,'{}','clean',$5),
       ($2,$3,$4,'0159d5-link','drive_item','Projects/plan.docx',NULL,'reader',true,'{}','manual',$6)`,
    [PERSON, LINK, TENANT, MAPPING, STORED_PERSON, STORED_LINK],
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('GET /api/migrations/:mappingId/sharing says each row in Dutch beside the English', () => {
  it('carries verdictTargetNl, without the developer note, and the stored English unchanged', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING}/sharing`);
    expect(res.status).toBe(200);
    const rows = res.body.grants as Array<{ id: string; verdictTarget: string; verdictTargetNl?: string }>;
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(PERSON)).toMatchObject({
      verdictTarget: STORED_PERSON,
      verdictTargetNl: 'een Nextcloud-deling, alleen lezen',
    });
    expect(byId.get(LINK)!.verdictTarget).toBe(STORED_LINK);
    expect(byId.get(LINK)!.verdictTargetNl).toMatch(/^beslis of deze link na de migratie nog moet bestaan/);
    for (const row of rows) expect(row.verdictTargetNl).not.toContain(' — ');
  });
});
