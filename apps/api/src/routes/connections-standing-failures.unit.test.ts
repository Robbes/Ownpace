// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CONNECTION CARD SAYS WHAT IS STANDING AGAINST IT (workplan 0094 T5),
 * against a real database.
 *
 * A sync pass that fails writes a category onto the migration's status row
 * (0110 T3) and nothing carried it back to the page where the credential
 * lives: `connection.status` is what the last Test said, and a pass failing
 * afterwards left it `connected`. `GET /api/connections` now folds those
 * categories per connection, and this file asks the questions that matter
 * about the fold:
 *
 *  - does the line land on BOTH connections a migration signs in with,
 *    since the category does not say which side failed?
 *  - is it one entry per migration and category, the domains gathered and
 *    the newest as-of kept, latest first?
 *  - does a retry in flight (`in_progress`, category still set) still stand,
 *    and a clean pass (category cleared) not?
 *  - is a finished migration left out, and another tenant's never seen?
 *  - does the prose — `last_error`, which carries an address — ever leave?
 *  - is a category this build has no sentence for skipped rather than served?
 *  - when the pass NAMED the side (second slice), does the entry land on that
 *    one card only, and say so?
 *
 * PGlite as `app_user` through the route's own `withTenantDb`; only
 * `authenticate` is stubbed. UUID family 5f940000-…, unused elsewhere.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { DISCOVERY_DOMAINS, FAILURE_CATEGORIES, FAILURE_SIDES } from '@openmig/shared';

const TENANT_A = '5f940000-e29b-41d4-a716-446655440901';
const TENANT_B = '5f940000-e29b-41d4-a716-446655440902';
const SRC = '5f940000-e29b-41d4-a716-446655440911';
const TGT = '5f940000-e29b-41d4-a716-446655440912';
const SPARE = '5f940000-e29b-41d4-a716-446655440913';
const SRC_B = '5f940000-e29b-41d4-a716-446655440914';
const BOX_S = '5f940000-e29b-41d4-a716-446655440921';
const BOX_S2 = '5f940000-e29b-41d4-a716-446655440922';
const BOX_S3 = '5f940000-e29b-41d4-a716-446655440925';
const BOX_T = '5f940000-e29b-41d4-a716-446655440923';
const BOX_B = '5f940000-e29b-41d4-a716-446655440924';
const MAPPING = '5f940000-e29b-41d4-a716-446655440931';
const MAPPING_DONE = '5f940000-e29b-41d4-a716-446655440932';
const MAPPING_B = '5f940000-e29b-41d4-a716-446655440933';
/** A migration whose failures the pass could place on a side (0094 T5, second slice). */
const MAPPING_SIDED = '5f940000-e29b-41d4-a716-446655440934';

/** Prose with an address in it — exactly what `last_error` holds. */
const ERROR_PROSE = 'IMAP LOGIN failed for someone@example.invalid in folder Salaris 2025';
/** A category written by a build that is not this one. */
const FOREIGN_CATEGORY = 'from_the_future';

let driver: LedgerDriver;
let tenant = TENANT_A;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: tenant, userId: 'rob', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

interface Listed {
  id: string;
  standingFailures: Array<{
    mappingId: string;
    mappingName: string | null;
    category: string;
    domains: string[];
    asOf: string;
  }>;
}

async function list(): Promise<{ status: number; text: string; byId: Map<string, Listed> }> {
  const res = await request(app).get('/api/connections');
  const body = res.body as { connections?: Listed[] };
  return {
    status: res.status,
    text: res.text,
    byId: new Map((body.connections ?? []).map((c) => [c.id, c])),
  };
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

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
       VALUES ($1,$5,'source','imap','Alpha mail source','{"host":"mail.example.invalid"}'::jsonb,'connected','ref-src'),
              ($2,$5,'target','jmap','Alpha target','{}'::jsonb,'connected','ref-tgt'),
              ($3,$5,'source','imap','Spare','{"host":"spare.example.invalid"}'::jsonb,'connected','ref-spare'),
              ($4,$6,'source','imap','Beta source','{"host":"beta.example.invalid"}'::jsonb,'connected','ref-b')`,
      [SRC, TGT, SPARE, SRC_B, TENANT_A, TENANT_B],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id, primary_address)
       VALUES ($1,$5,$6,'user','s','s@example.invalid'),
              ($2,$5,$6,'user','s2','s2@example.invalid'),
              ($3,$5,$7,'user','t','t@example.invalid'),
              ($4,$8,$9,'user','b','b@example.invalid'),
              ($10,$5,$6,'user','s3','s3@example.invalid')`,
      [BOX_S, BOX_S2, BOX_T, BOX_B, TENANT_A, SRC, TGT, TENANT_B, SRC_B, BOX_S3],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, name)
       VALUES ($1,$4,$6,$8,'paused','Alpha mail'),
              ($2,$4,$7,$8,'done','Alpha mail, finished'),
              ($3,$5,$9,NULL,'active','Beta mail'),
              ($10,$4,$11,$8,'active','Alpha files')`,
      [MAPPING, MAPPING_DONE, MAPPING_B, TENANT_A, TENANT_B, BOX_S, BOX_S2, BOX_T, BOX_B, MAPPING_SIDED, BOX_S3],
    );
    const status = (
      mappingId: string,
      tenantId: string,
      domain: string,
      state: string,
      category: string | null,
      updatedAt: string,
      lastError: string | null = null,
      failedSide: string | null = null,
    ) =>
      q(
        `INSERT INTO migration_status
           (id, tenant_id, mapping_id, domain, state, last_error, last_error_category, updated_at, failed_side)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::timestamptz, $8)`,
        [tenantId, mappingId, domain, state, lastError, category, updatedAt, failedSide],
      );
    // The migration that stands: two domains on one category, at different
    // times (the newest as-of must win), a retry in flight on a third, a
    // clean fourth, and a fifth carrying a category this build cannot name.
    await status(MAPPING, TENANT_A, 'email', 'failed', 'auth_expired', '2026-09-05T08:00:00Z', ERROR_PROSE);
    await status(MAPPING, TENANT_A, 'calendar', 'failed', 'auth_expired', '2026-09-05T09:00:00Z', ERROR_PROSE);
    await status(MAPPING, TENANT_A, 'file', 'in_progress', 'network', '2026-09-05T07:00:00Z', 'ECONNRESET');
    await status(MAPPING, TENANT_A, 'contact', 'completed', null, '2026-09-05T10:00:00Z');
    await status(MAPPING, TENANT_A, 'task', 'failed', FOREIGN_CATEGORY, '2026-09-05T11:00:00Z', 'later');
    // The pass NAMED the side on these two (second slice): the source could
    // not be read, and separately the target refused a write.
    await status(MAPPING_SIDED, TENANT_A, 'calendar', 'failed', 'auth_expired', '2026-09-05T11:00:00Z', 'invalid_grant', 'source');
    await status(MAPPING_SIDED, TENANT_A, 'file', 'failed', 'target_refused', '2026-09-05T10:00:00Z', '507', 'target');
    // Over. Its failure is history and a rotation would fix nothing.
    await status(MAPPING_DONE, TENANT_A, 'email', 'failed', 'target_refused', '2026-09-05T06:00:00Z', 'refused');
    // Somebody else's.
    await status(MAPPING_B, TENANT_B, 'email', 'failed', 'auth_expired', '2026-09-05T05:00:00Z', 'beta');
  } finally {
    await conn.release();
  }
});

afterAll(async () => {
  await driver.end?.();
});

describe('GET /api/connections — what is standing against each connection (0094 T5)', () => {
  it('lands the line on both connections the migration signs in with, one entry per category, latest first', async () => {
    tenant = TENANT_A;
    const { status, byId } = await list();
    expect(status).toBe(200);

    // The pass could not name a side on these, so they are on both cards.
    const unsided = [
      {
        mappingId: MAPPING,
        mappingName: 'Alpha mail',
        category: 'auth_expired',
        // DISCOVERY_DOMAINS order, not insertion or alphabetical order.
        domains: ['email', 'calendar'],
        // The newest of the two rows.
        asOf: '2026-09-05T09:00:00.000Z',
        side: null,
      },
      {
        mappingId: MAPPING,
        mappingName: 'Alpha mail',
        category: 'network',
        domains: ['file'],
        asOf: '2026-09-05T07:00:00.000Z',
        side: null,
      },
    ];
    expect(byId.get(SRC)?.standingFailures.filter((f) => f.mappingId === MAPPING)).toEqual(unsided);
    expect(byId.get(TGT)?.standingFailures.filter((f) => f.mappingId === MAPPING)).toEqual(unsided);
  });

  it('lands a failure the pass placed on one card only, and says which side (second slice)', async () => {
    tenant = TENANT_A;
    const { byId } = await list();
    const onSource = byId.get(SRC)?.standingFailures.filter((f) => f.mappingId === MAPPING_SIDED);
    const onTarget = byId.get(TGT)?.standingFailures.filter((f) => f.mappingId === MAPPING_SIDED);
    expect(onSource).toEqual([
      {
        mappingId: MAPPING_SIDED,
        mappingName: 'Alpha files',
        category: 'auth_expired',
        domains: ['calendar'],
        asOf: '2026-09-05T11:00:00.000Z',
        side: 'source',
      },
    ]);
    expect(onTarget).toEqual([
      {
        mappingId: MAPPING_SIDED,
        mappingName: 'Alpha files',
        category: 'target_refused',
        domains: ['file'],
        asOf: '2026-09-05T10:00:00.000Z',
        side: 'target',
      },
    ]);
    // Latest first still holds across the two migrations on one card.
    const asOfs = byId.get(SRC)?.standingFailures.map((f) => f.asOf) ?? [];
    expect(asOfs).toEqual([...asOfs].sort().reverse());
  });

  it('answers an empty array — not an absence — for a connection nothing stands against', async () => {
    tenant = TENANT_A;
    const { byId } = await list();
    expect(byId.get(SPARE)?.standingFailures).toEqual([]);
  });

  it('leaves out the finished migration, the cleared domain, the foreign category and the prose', async () => {
    tenant = TENANT_A;
    const { text, byId } = await list();
    const all = [...byId.values()].flatMap((c) => c.standingFailures);
    expect(all.some((f) => f.mappingId === MAPPING_DONE)).toBe(false);
    expect(all.some((f) => f.domains.includes('contact'))).toBe(false);
    expect(all.some((f) => f.domains.includes('task'))).toBe(false);
    expect(text).not.toContain(FOREIGN_CATEGORY);
    // `last_error` carries an address. It lives on the migration's page,
    // never on this list.
    expect(text).not.toContain(ERROR_PROSE);
    expect(text).not.toContain('example.invalid in folder');
    expect(text).not.toContain('ECONNRESET');
    expect(text).not.toContain('invalid_grant');
  });

  it("never shows another tenant's migration, in either direction", async () => {
    tenant = TENANT_A;
    const a = await list();
    expect(a.text).not.toContain(MAPPING_B);
    expect(a.byId.has(SRC_B)).toBe(false);

    tenant = TENANT_B;
    const b = await list();
    expect(b.status).toBe(200);
    expect(b.byId.get(SRC_B)?.standingFailures).toEqual([
      {
        mappingId: MAPPING_B,
        mappingName: 'Beta mail',
        category: 'auth_expired',
        domains: ['email'],
        asOf: '2026-09-05T05:00:00.000Z',
        side: null,
      },
    ]);
    expect(b.text).not.toContain(MAPPING);
    expect(b.byId.has(SRC)).toBe(false);
  });

  it('documents the field with the same six categories and five domains the code has', () => {
    // The enums in `openapi.yaml` are copies, and a copy rots. Asserted
    // against the single source, the way the support routes do.
    const spec: unknown = parseYaml(
      readFileSync(join(import.meta.dirname, '../../docs/openapi.yaml'), 'utf-8'),
    );
    const dig = (from: unknown, ...keys: string[]): unknown =>
      keys.reduce<unknown>((cur, key) => (cur as Record<string, unknown> | undefined)?.[key], from);
    const props = dig(
      spec,
      'paths',
      '/api/connections',
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
      'connections',
      'items',
      'properties',
      'standingFailures',
      'items',
      'properties',
    );
    expect(dig(props, 'category', 'enum')).toEqual([...FAILURE_CATEGORIES]);
    expect(dig(props, 'domains', 'items', 'enum')).toEqual([...DISCOVERY_DOMAINS]);
    expect(dig(props, 'side', 'enum')).toEqual([...FAILURE_SIDES]);
  });
});
