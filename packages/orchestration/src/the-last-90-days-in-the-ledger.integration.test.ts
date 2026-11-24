// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LAST 90 DAYS, IN THE LEDGER (workplan 0170 §3.3, §3.4, §5.1), against a
 * real Postgres: no table of its own, so the SQL it relies on is what this
 * proves.
 *
 *  1. a 90-day migration's setting is read back from its
 *     `source_config_override`, as the API stores it, and a migration of
 *     everything reads as none (`readRecentOnly`);
 *  2. the window record is written into the `cursor` table under the
 *     tenant's own scope, beside the content cursors, and read back as the
 *     migration's `window` (`runWithWindow`, `readWindowView`), `copying`
 *     while phase A stops short and `in` once it reaches the end;
 *  3. the operator's RETRY (`CursorStore.clear`) takes the record with the
 *     cursors, so the read says nothing is in until a pass says so again.
 *
 * The addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { PgCursorStore, createPgDb, withTenant } from '@openmig/ledger';
import { asMappingId, asTenantId, readWindowView, type PassWindow } from '@openmig/shared';
import { readRecentOnly } from './build-deps-from-mapping.ts';
import { runWithWindow } from './recent-window-pass.ts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 01700000-…, unused elsewhere in the repo.
const P = '01700000-e29b-41d4-a716-4466554490';
const TENANT = `${P}01`;
const SOURCE = `${P}11`;
const SOURCE_BOX = `${P}21`;
const RECENT = `${P}31`;
const EVERYTHING = `${P}32`;
const ANCHOR = '2026-11-24T10:00:00.000Z';

describe('the last 90 days, in the ledger', () => {
  let db: ReturnType<typeof createPgDb>;
  let pool: Pool;

  beforeAll(async () => {
    db = createPgDb(TEST_DATABASE_URL);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Example Care BV', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
        (${SOURCE}, ${TENANT}, 'source', 'caldav', 'calendars', '{}'::jsonb, 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
        (${SOURCE_BOX}, ${TENANT}, ${SOURCE}, 'user', 'pat@example.invalid')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, mode, status, source_config_override) VALUES
        (${RECENT}, ${TENANT}, ${SOURCE_BOX}, 'mirror', 'active',
         ${JSON.stringify({ rootPath: '/Projects', recentOnly: { days: 90, anchor: ANCHOR } })}::jsonb),
        (${EVERYTHING}, ${TENANT}, ${SOURCE_BOX}, 'mirror', 'active', NULL)
      ON CONFLICT (id) DO NOTHING`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM mailbox_mapping WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM mailbox WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM connection WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM tenant WHERE id = ${TENANT}`);
    await pool.end();
  });

  it('1. reads a 90-day setting from the override, and none for a migration of everything', async () => {
    expect(await readRecentOnly(pool, TENANT, RECENT)).toEqual({ days: 90, anchor: ANCHOR });
    expect(await readRecentOnly(pool, TENANT, EVERYTHING)).toBeUndefined();
  });

  it('2. keeps the window record beside the cursors, and reads it back as the window', async () => {
    const view = () =>
      withTenant(pool, TENANT, (tx) => readWindowView(new PgCursorStore(tx), asTenantId(TENANT), asMappingId(EVERYTHING), undefined));
    const plan: PassWindow = { since: new Date('2026-08-26T00:00:00.000Z'), only: false };
    const pass = (complete: boolean) =>
      withTenant(pool, TENANT, (tx) =>
        runWithWindow({
          tenantId: asTenantId(TENANT),
          mappingId: asMappingId(EVERYTHING),
          domain: 'calendar',
          cursors: new PgCursorStore(tx),
          plan,
          run: async (w) => (w ? { windowComplete: complete } : {}),
        }),
      );

    expect(await view()).toEqual({ recentOnly: false, since: null, in: [], copying: [] });
    await pass(false);
    expect(await view()).toEqual({ recentOnly: false, since: '2026-08-26T00:00:00.000Z', in: [], copying: ['calendar'] });
    await pass(true);
    expect(await view()).toEqual({ recentOnly: false, since: '2026-08-26T00:00:00.000Z', in: ['calendar'], copying: [] });

    const rows = await db.execute(sql`SELECT folder_path FROM cursor WHERE mapping_id = ${EVERYTHING}`);
    expect((rows.rows as Array<{ folder_path: string }>).map((r) => r.folder_path)).toEqual(['\u0001window-record\u0001calendar']);
  });

  it('3. a RETRY takes the record with the cursors', async () => {
    await withTenant(pool, TENANT, (tx) => new PgCursorStore(tx).clear(asTenantId(TENANT), asMappingId(EVERYTHING)));
    const view = await withTenant(pool, TENANT, (tx) =>
      readWindowView(new PgCursorStore(tx), asTenantId(TENANT), asMappingId(EVERYTHING), undefined),
    );
    expect(view).toEqual({ recentOnly: false, since: null, in: [], copying: [] });
  });

  it('reads a 90-day migration window from its own anchor', async () => {
    const view = await withTenant(pool, TENANT, (tx) =>
      readWindowView(new PgCursorStore(tx), asTenantId(TENANT), asMappingId(RECENT), { days: 90, anchor: ANCHOR }),
    );
    expect(view).toEqual({ recentOnly: true, since: '2026-08-26T00:00:00.000Z', in: [], copying: [] });
  });
});
