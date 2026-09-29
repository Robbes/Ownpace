// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELETED MIGRATION TAKES ITS SHARING LIST WITH IT (workplan 0139 T6; the
 * owner's privacy-sharing-list (b), 2026-09-28).
 *
 * Privacy §9 says what each migration keeps beside its ledger, *such as the
 * list of what was shared* (§4.6), is kept *until you delete the migration;
 * then deleted with it*. The list is `share_grant` (ADR-0032, workplan 0052):
 * who had access to what at the old provider, with their addresses. Its
 * `mapping_id` has no foreign key (migration 0016), so the cascade that takes
 * the ledger never reached it, and `DELETE /api/migrations/:mappingId` left
 * every row behind until the organisation was erased.
 *
 * Against a real database, PGlite as `app_user`, through the real route:
 *
 *  - deleting one migration deletes every row of its list, whatever the row's
 *    state, and leaves the other migration's list exactly as it was;
 *  - the list goes in the migration's own transaction: when its rows cannot be
 *    deleted, the migration is not deleted either, and nothing is revoked;
 *  - a migration that is not there, or is another organisation's, deletes no
 *    list, not even rows that name its id.
 *
 * It fails today: the route deletes the migration and no row of its list. The
 * names and addresses are invented.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 0139c600-…, unused elsewhere in the repo.
const TENANT = '0139c600-e29b-41d4-a716-446655440001';
const ELSEWHERE = '0139c600-e29b-41d4-a716-446655440002';
const CONN = '0139c600-e29b-41d4-a716-446655440011';
const OTHERS_CONN = '0139c600-e29b-41d4-a716-446655440012';
const BOX = '0139c600-e29b-41d4-a716-446655440021';
const OTHERS_BOX = '0139c600-e29b-41d4-a716-446655440022';
/** Deleted in the first case; its list goes with it. */
const GOING = '0139c600-e29b-41d4-a716-446655440031';
/** Kept in every case; its list stays as it was. */
const STAYING = '0139c600-e29b-41d4-a716-446655440032';
/** Its list cannot be deleted in the second case, so neither can it. Holds a granted token. */
const HELD = '0139c600-e29b-41d4-a716-446655440033';
/** Never a migration: only rows a delete from before this change left behind name it. */
const NEVER_THERE = '0139c600-e29b-41d4-a716-446655440034';
/** Another organisation's migration, with a list of its own. */
const OTHERS = '0139c600-e29b-41d4-a716-446655440035';

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

/** As the database's owner: past row security, so every organisation's rows are seen. */
async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/** Google's revocation endpoint: a call is only recorded, never needed here but by HELD. */
const googleCalls: string[] = [];
vi.stubGlobal('fetch', async (_url: string | URL, init?: { body?: unknown }) => {
  googleCalls.push(new URLSearchParams(String(init?.body ?? '')).get('token') ?? '');
  return new Response('', { status: 200 });
});

const remove = (mappingId: string) => request(app).delete(`/api/migrations/${mappingId}`).send();

const exists = async (mappingId: string) =>
  (await sql('SELECT id FROM mailbox_mapping WHERE id = $1', [mappingId])).length > 0;

/** A migration's list, every column, in a stable order: what "as it was" is compared on. */
const listOf = (mappingId: string) =>
  sql('SELECT * FROM share_grant WHERE mapping_id = $1 ORDER BY grant_hash', [mappingId]);

/** One row of a list, in the state given; a settled one says who settled it and when. */
async function grant(tenant: string, mappingId: string, n: number, state: 'open' | 'applied' | 'done_manual' | 'skipped') {
  await sql(
    `INSERT INTO share_grant (tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, via_link, raw,
                              verdict, verdict_target, state, decided_by, decided_at)
     VALUES ($1,$2,$3,'owner@example.invalid',$4,$5,'writer',false,$6,'clean','jmap',$7,$8,$9)`,
    [
      tenant,
      mappingId,
      `hash-${mappingId.slice(-4)}-${n}`,
      `Holiday photos ${n}`,
      `friend-${n}@example.invalid`,
      `{"grant": ${n}}`,
      state,
      state === 'open' ? null : 'pat',
      state === 'open' ? null : new Date('2026-09-20T10:00:00Z'),
    ],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  for (const [tenant, conn, box, account] of [
    [TENANT, CONN, BOX, 'pat@example.invalid'],
    [ELSEWHERE, OTHERS_CONN, OTHERS_BOX, 'sam@example.invalid'],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, tenant === TENANT ? 'ours' : 'theirs']);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','Example Google','{}'::jsonb,'connected')`,
      [conn, tenant],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user',$4)`,
      [box, tenant, conn, account],
    );
  }
  for (const [id, tenant, box] of [
    [GOING, TENANT, BOX],
    [STAYING, TENANT, BOX],
    [HELD, TENANT, BOX],
    [OTHERS, ELSEWHERE, OTHERS_BOX],
  ] as const) {
    const token = id === HELD ? JSON.stringify(SecretStore.encryptCredentials({ refreshToken: 'granted' }).encrypted) : null;
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name, source_secret_ref)
       VALUES ($1,$2,$3,'active','Pat',$4)`,
      [id, tenant, box, token],
    );
  }
  await grant(TENANT, GOING, 1, 'open');
  await grant(TENANT, GOING, 2, 'applied');
  await grant(TENANT, GOING, 3, 'done_manual');
  await grant(TENANT, GOING, 4, 'skipped');
  await grant(TENANT, STAYING, 1, 'open');
  await grant(TENANT, STAYING, 2, 'skipped');
  await grant(TENANT, HELD, 1, 'open');
  await grant(TENANT, HELD, 2, 'applied');
  await grant(TENANT, NEVER_THERE, 1, 'open');
  await grant(ELSEWHERE, OTHERS, 1, 'open');
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  googleCalls.length = 0;
});

describe('DELETE /api/migrations/:mappingId deletes that migration\'s sharing list, and no other', () => {
  it("deletes every row of its list, whatever the row's state, and leaves the other migration's list as it was", async () => {
    expect(await listOf(GOING)).toHaveLength(4);
    const staying = await listOf(STAYING);
    expect(staying).toHaveLength(2);

    const res = await remove(GOING);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Mapping deleted successfully' });
    expect(await exists(GOING)).toBe(false);
    expect(await listOf(GOING), "the deleted migration's sharing list is still there").toEqual([]);
    expect(await listOf(STAYING)).toEqual(staying);
    expect(await exists(STAYING)).toBe(true);
  });

  it('deletes the list in the migration\'s own transaction: a list that cannot go keeps the migration, and revokes nothing', async () => {
    const held = await listOf(HELD);
    expect(held).toHaveLength(2);
    // Stands in for any failure of the list's delete: the database refuses it.
    await sql(`CREATE FUNCTION refuse_a_sharing_list_delete() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'this sharing list cannot be deleted'; END $$`);
    await sql(`CREATE TRIGGER refuse_a_sharing_list_delete BEFORE DELETE ON share_grant
               FOR EACH ROW EXECUTE FUNCTION refuse_a_sharing_list_delete()`);
    try {
      const res = await remove(HELD);

      expect(res.status).toBe(500);
      expect(await exists(HELD), 'the migration went while its sharing list stayed').toBe(true);
      expect(await listOf(HELD)).toEqual(held);
      expect(googleCalls, 'a grant was revoked for a migration that was not deleted').toEqual([]);
    } finally {
      await sql('DROP TRIGGER refuse_a_sharing_list_delete ON share_grant');
      await sql('DROP FUNCTION refuse_a_sharing_list_delete()');
    }

    // Once the list can go, both go, and the grant is revoked after.
    const res = await remove(HELD);
    expect(res.status).toBe(200);
    expect(await exists(HELD)).toBe(false);
    expect(await listOf(HELD)).toEqual([]);
    expect(googleCalls).toEqual(['granted']);
  });

  it("a migration that is not there, or is another organisation's, deletes no list, not even rows that name its id", async () => {
    const orphaned = await listOf(NEVER_THERE);
    const theirs = await listOf(OTHERS);
    expect(orphaned).toHaveLength(1);
    expect(theirs).toHaveLength(1);

    expect((await remove(NEVER_THERE)).status).toBe(404);
    expect((await remove(OTHERS)).status).toBe(404);

    expect(await listOf(NEVER_THERE)).toEqual(orphaned);
    expect(await listOf(OTHERS)).toEqual(theirs);
    expect(await exists(OTHERS)).toBe(true);
    expect(await listOf(STAYING)).toHaveLength(2);
  });
});
