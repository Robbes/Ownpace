// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARING LIST IS WRITTEN ONLY FOR A MIGRATION THAT IS STILL THERE (workplan
 * 0139 T6; privacy §4.6 and §9, the owner's privacy-sharing-list (b)).
 *
 * The list is `share_grant` (ADR-0032, workplan 0052), and its `mapping_id`
 * has no foreign key (migration 0016). Deleting a migration deletes its list in
 * the delete's own transaction (`DELETE /api/migrations/:mappingId`), but that
 * delete can only take the rows that exist when it runs. A sharing rescan
 * scans the source for seconds or minutes and then writes the list: when the
 * migration was deleted in between, the rows it wrote named a migration that
 * no longer existed, and nothing would ever delete them before the
 * organisation's erasure. The review of 2026-09-29 found it; the database took
 * such a row without a word.
 *
 * So the one writer of the list, `PgLedger.upsertShareGrants`, first holds the
 * migration's row (`FOR KEY SHARE`, until the caller's transaction ends) and
 * writes nothing, refusing with `ShareListWithoutMigration`, when there is no
 * such migration in this organisation. Held, the row cannot be deleted until
 * the list is committed, and the delete then sees the list and takes it; that
 * half, which needs two connections at once, is proved on Postgres by
 * `a-rescan-that-outlives-its-migration.integration.test.ts` in `apps/api`.
 *
 * Against PGlite as `app_user`, so row security is in force. Before the change
 * the two refusals below wrote their rows. The names and addresses are
 * invented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import { PgLedger } from './ledger.ts';
import type { LedgerDriver } from './driver.ts';
import { asMappingId, asTenantId } from '@openmig/shared';

// UUID family 0139c700-…, unused elsewhere in the repo.
const TENANT = '0139c700-e29b-41d4-a716-446655440001';
const ELSEWHERE = '0139c700-e29b-41d4-a716-446655440002';
const CONN = '0139c700-e29b-41d4-a716-446655440011';
const OTHERS_CONN = '0139c700-e29b-41d4-a716-446655440012';
const BOX = '0139c700-e29b-41d4-a716-446655440021';
const OTHERS_BOX = '0139c700-e29b-41d4-a716-446655440022';
/** Ours, and there. */
const HERE = '0139c700-e29b-41d4-a716-446655440031';
/** Never a migration: a delete took it before the rescan wrote. */
const GONE = '0139c700-e29b-41d4-a716-446655440032';
/** Another organisation's migration: not one of ours to write a list for. */
const OTHERS = '0139c700-e29b-41d4-a716-446655440033';

let driver: LedgerDriver;

/** As the database's owner: past row security, so every organisation's rows are seen. */
async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

const listOf = async (mappingId: string) =>
  (await sql('SELECT grant_hash FROM share_grant WHERE mapping_id = $1 ORDER BY grant_hash', [mappingId])).map(
    (r) => r.grant_hash,
  );

/** Two scanned grants, as a rescan hands them over. */
const scanned = [1, 2].map((n) => ({
  grantHash: `scan-${n}`,
  subject: 'drive_item',
  onLabel: `Holiday photos ${n}`,
  grantee: `friend-${n}@example.invalid`,
  role: 'writer',
  viaLink: false,
  raw: `{"grant": ${n}}`,
  verdict: 'clean' as const,
  verdictTarget: 'jmap',
}));

/** Write a list for `mappingId` as our organisation, in a transaction of its own, as the API does. */
const write = (mappingId: string) =>
  withTenant(driver, TENANT, (db) =>
    new PgLedger(db).upsertShareGrants(asTenantId(TENANT as never), asMappingId(mappingId as never), scanned),
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  for (const [tenant, conn, box, mapping] of [
    [TENANT, CONN, BOX, HERE],
    [ELSEWHERE, OTHERS_CONN, OTHERS_BOX, OTHERS],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, tenant === TENANT ? 'ours' : 'theirs']);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','Example Google','{}'::jsonb,'connected')`,
      [conn, tenant],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','pat@example.invalid')`,
      [box, tenant, conn],
    );
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1,$2,$3,'active','Pat')`,
      [mapping, tenant, box],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await sql('DELETE FROM share_grant');
});

describe('PgLedger.upsertShareGrants writes a list only for a migration that is still there', () => {
  it("writes the list of a migration that is there (the control: the scan's rows do arrive)", async () => {
    await expect(write(HERE)).resolves.toBe(2);
    expect(await listOf(HERE)).toEqual(['scan-1', 'scan-2']);
  });

  it('refuses, and writes nothing, for a migration that was deleted before the list was written', async () => {
    await expect(write(GONE), 'a list was written for a migration that is gone').rejects.toMatchObject({
      name: 'ShareListWithoutMigration',
    });
    expect(await listOf(GONE), 'rows naming a deleted migration, which no delete will ever take').toEqual([]);
  });

  it("refuses, and writes nothing, for another organisation's migration", async () => {
    await expect(write(OTHERS)).rejects.toMatchObject({ name: 'ShareListWithoutMigration' });
    expect(await listOf(OTHERS)).toEqual([]);
  });
});
