// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD TRIED ON A LINK, AND WHOSE DESTINATION IT IS, UNDER ROW SECURITY
 * (workplan 0174 T1, §4.3, §5.5, §9; managed migration 0064).
 *
 * The two tables apply on both chains, as a managed deployment runs them, and
 * hold:
 *  - each organisation sees and writes only its own rows; an unset tenant
 *    reads nothing and raises nothing (the NULL-safe policies);
 *  - a read under `app.current_link` sees exactly the presented link's tries,
 *    and an unset link nothing (`link_sees_itself`'s twin);
 *  - a granted connection must be a connection of the organisation the row is
 *    written in, and one person's at most;
 *  - the tries count by `refused = refused + 1 … RETURNING`, never below zero;
 *  - deleting the link deletes its tries and only forgets which link a
 *    granted connection came through; deleting the person or the connection
 *    deletes its granted row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withMappingLink, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 01740064-…, unused elsewhere in the repo.
const U = (n: string) => `01740064-e29b-41d4-a716-4466554400${n}`;
const OURS = U('01');
const THEIRS = U('02');
const ANNA = U('11');
const BRAM = U('12');
const THEIR_PERSON = U('13');
const OUR_LINK = U('21');
const OTHER_LINK = U('22');
const THEIR_LINK = U('23');
const OUR_SOVERIN = U('31');
const THEIR_SOVERIN = U('32');

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Rows a statement returns as `app_user` in this organisation. */
const asTenant = (tenantId: string, statement: string) =>
  withTenant(driver, tenantId, async (db) => (await db.execute(sql.raw(statement))).rows as Array<Record<string, unknown>>);

/** What the statement's refusal says, or null when it went through. */
async function refusal(tenantId: string, statement: string): Promise<string | null> {
  return withTenant(driver, tenantId, (db) => db.execute(sql.raw(statement))).then(
    () => null,
    (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ''}`,
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [OURS, 'Ours', THEIRS, 'Theirs']);
  await owner(
    `INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$4,'Anna'), ($2,$4,'Bram'), ($3,$5,'Carl')`,
    [ANNA, BRAM, THEIR_PERSON, OURS, THEIRS],
  );
  await owner(
    `INSERT INTO person_link (id, tenant_id, person_id, purpose, secret_hash, created_by, expires_at) VALUES
       ($1,$4,$6,'grant','h1','pat', now() + interval '7 days'),
       ($2,$4,$6,'grant','h2','pat', now() + interval '7 days'),
       ($3,$5,$7,'grant','h3','pat', now() + interval '7 days')`,
    [OUR_LINK, OTHER_LINK, THEIR_LINK, OURS, THEIRS, ANNA, THEIR_PERSON],
  );
  await owner(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$3,'target','soverin','s','{}'::jsonb,'connected'),
       ($2,$4,'target','soverin','s','{}'::jsonb,'connected')`,
    [OUR_SOVERIN, THEIR_SOVERIN, OURS, THEIRS],
  );
  await owner(
    `INSERT INTO person_link_try (link_id, tenant_id, account_ref, refused) VALUES
       ($1,$4,'ref-a',1), ($2,$4,'ref-a',0), ($3,$5,'ref-c',3)`,
    [OUR_LINK, OTHER_LINK, THEIR_LINK, OURS, THEIRS],
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('person_link_try under row security', () => {
  it('shows each organisation its own tries only, and an unset tenant none', async () => {
    expect((await asTenant(OURS, 'SELECT link_id FROM person_link_try ORDER BY link_id')).map((r) => r.link_id)).toEqual([
      OUR_LINK,
      OTHER_LINK,
    ]);
    expect((await asTenant(THEIRS, 'SELECT account_ref FROM person_link_try')).map((r) => r.account_ref)).toEqual(['ref-c']);
    expect(await asTenant('', 'SELECT 1 FROM person_link_try')).toEqual([]);
  });

  it('refuses a try written for another organisation', async () => {
    expect(
      await refusal(OURS, `INSERT INTO person_link_try (link_id, tenant_id, account_ref) VALUES ('${THEIR_LINK}','${THEIRS}','x')`),
    ).toMatch(/row-level security/);
  });

  it('lets a link’s own read see exactly its tries, and an unset link none', async () => {
    const seen = await withMappingLink(driver, OUR_LINK, (db) => db.execute(sql`SELECT link_id, refused FROM person_link_try`));
    expect(seen.rows).toEqual([{ link_id: OUR_LINK, refused: 1 }]);
    const none = await withMappingLink(driver, '', (db) => db.execute(sql`SELECT 1 FROM person_link_try`));
    expect(none.rows).toEqual([]);
  });

  it('counts by one in the statement that reads it back, and never below zero', async () => {
    const counted = await asTenant(
      OURS,
      `UPDATE person_link_try SET refused = refused + 1, last_at = now()
        WHERE link_id = '${OUR_LINK}' AND account_ref = 'ref-a' RETURNING refused`,
    );
    expect(counted).toEqual([{ refused: 2 }]);
    expect(
      await refusal(OURS, `UPDATE person_link_try SET refused = -1 WHERE link_id = '${OUR_LINK}'`),
    ).toMatch(/person_link_try_refused_check/);
  });
});

describe('person_granted_connection under row security', () => {
  it('takes a connection of the organisation it is written in, one person at most', async () => {
    expect(
      await refusal(
        OURS,
        `INSERT INTO person_granted_connection (connection_id, tenant_id, person_id, link_id) VALUES ('${OUR_SOVERIN}','${OURS}','${ANNA}','${OUR_LINK}')`,
      ),
    ).toBeNull();
    // Another organisation's connection, written as ours: refused.
    expect(
      await refusal(
        OURS,
        `INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ('${THEIR_SOVERIN}','${OURS}','${BRAM}')`,
      ),
    ).toMatch(/row-level security/);
    // Another person on the same connection: one person per connection.
    expect(
      await refusal(
        OURS,
        `INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ('${OUR_SOVERIN}','${OURS}','${BRAM}')`,
      ),
    ).toMatch(/person_granted_connection_pkey/);
    // Another organisation's person, named on ours: the person's key refuses it.
    expect(
      await refusal(
        THEIRS,
        `INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ('${THEIR_SOVERIN}','${THEIRS}','${ANNA}')`,
      ),
    ).toMatch(/person_granted_connection_person_fkey/);
    expect(await asTenant(THEIRS, 'SELECT 1 FROM person_granted_connection')).toEqual([]);
    expect(await asTenant('', 'SELECT 1 FROM person_granted_connection')).toEqual([]);
  });

  it('forgets the link when the link goes, and goes with the person or the connection', async () => {
    await owner('DELETE FROM person_link WHERE id = $1', [OUR_LINK]);
    expect(await owner('SELECT link_id FROM person_granted_connection')).toEqual([{ link_id: null }]);
    expect(await owner('SELECT 1 FROM person_link_try WHERE link_id = $1', [OUR_LINK])).toEqual([]);

    await owner('DELETE FROM person WHERE id = $1', [ANNA]);
    expect(await owner('SELECT 1 FROM person_granted_connection')).toEqual([]);

    await owner(
      `INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)`,
      [OUR_SOVERIN, OURS, BRAM],
    );
    await owner('DELETE FROM connection WHERE id = $1', [OUR_SOVERIN]);
    expect(await owner('SELECT 1 FROM person_granted_connection')).toEqual([]);
  });
});
