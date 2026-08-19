// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * When may the same two accounts be migrated between twice? (workplan 0071 T6,
 * owner decision 2026-08-18, migration 0022.)
 *
 * The owner's rule: *something needs to be difficult in the source/target
 * combination, like the optional folder — else it should not be allowed*,
 * because two mappings copying the same items to the same destination double
 * everything in the target.
 *
 * That is a database invariant, not a route convention: the appliance writes
 * `mailbox_mapping` rows too (`apps/selfhost/src/index.ts`), so a rule enforced
 * only in the managed create route would be a rule the appliance does not have
 * — which hard rule 5 forbids. So it is pinned HERE, against a real database
 * with the real migration chain applied, the same way the connection-kind CHECK
 * is: it cannot be satisfied by a comment or a matching string in a file.
 *
 * The subtle half is NULL. "Merge into the account root" is `NULL` and it is
 * the DEFAULT answer, so it is the case that matters most — and under
 * Postgres's default `NULLS DISTINCT` a plain three-column UNIQUE would let two
 * merges between the same pair both through, which is exactly the doubling the
 * rule exists to prevent. Migration 0022 folds NULL to '' for that reason, and
 * the third test below is the one that fails if somebody ever "simplifies" it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

let driver: LedgerDriver;
let conn: LedgerConnection;

const TENANT = 'aaaaaaaa-0000-4000-8000-00000000000a';
const SRC_CONN = 'bbbbbbbb-0000-4000-8000-00000000000b';
const TGT_CONN = 'cccccccc-0000-4000-8000-00000000000c';
let srcMailbox: string;
let tgtMailbox: string;

/** Insert a mapping between the fixed pair; returns the error, or null. */
async function addMapping(prefix: string | null): Promise<string | null> {
  try {
    await conn.query(
      `INSERT INTO mailbox_mapping
         (tenant_id, source_mailbox_id, target_mailbox_id, mode, status, target_folder_prefix)
       VALUES ($1, $2, $3, 'mirror', 'paused', $4)`,
      [TENANT, srcMailbox, tgtMailbox, prefix],
    );
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'acme')`, [TENANT]);
  for (const [id, role, kind] of [
    [SRC_CONN, 'source', 'imap'],
    [TGT_CONN, 'target', 'jmap'],
  ] as const) {
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name) VALUES ($1, $2, $3, $4, $5)`,
      [id, TENANT, role, kind, `${role} conn`],
    );
  }
  const src = await conn.query<{ id: string }>(
    `INSERT INTO mailbox (tenant_id, connection_id, external_id, kind) VALUES ($1, $2, 'primary', 'user') RETURNING id`,
    [TENANT, SRC_CONN],
  );
  const tgt = await conn.query<{ id: string }>(
    `INSERT INTO mailbox (tenant_id, connection_id, external_id, kind) VALUES ($1, $2, 'primary', 'user') RETURNING id`,
    [TENANT, TGT_CONN],
  );
  srcMailbox = src.rows[0]!.id;
  tgtMailbox = tgt.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

describe('two migrations between the same two accounts', () => {
  it('are allowed when the target folder keeps them apart', async () => {
    expect(await addMapping('Gmail'), 'the first one must simply work').toBeNull();
    // A different tree on the target: nothing either mapping writes can
    // collide with the other's, so there is nothing to refuse.
    expect(await addMapping('O365'), 'different prefixes do not overlap').toBeNull();
  });

  it('are refused when nothing distinguishes them', async () => {
    // Same pair, same folder: every item would be copied twice, into the same
    // place. This is the doubling the owner's rule exists to prevent.
    const err = await addMapping('Gmail');
    expect(err, 'a second identical mapping was accepted').not.toBeNull();
    expect(err).toMatch(/uk_mapping_source_target_prefix|unique/i);
  });

  it('are refused for two MERGES, which is the default and the whole point', async () => {
    // NULL = merge into the account root. Two of those are as duplicated as
    // two identical prefixes — and are the case a plain three-column UNIQUE
    // would wave through, because Postgres treats NULLs as distinct.
    expect(await addMapping(null), 'the first merge must work').toBeNull();

    const err = await addMapping(null);
    expect(
      err,
      'two merges into the same account were accepted — NULLS DISTINCT is back, and every item would land twice',
    ).not.toBeNull();
  });
});
