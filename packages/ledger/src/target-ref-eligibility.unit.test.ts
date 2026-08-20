// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What it means for a ledger item to have landed on the target.
 *
 * `smoke-managed.sh` picks the item its apply half acts on with
 * `status='copied' AND target_ref IS NOT NULL`. That reads like "copied, and it
 * landed somewhere on the target". It is not what it does: `target_ref` is
 * `jsonb NOT NULL DEFAULT '{}'`, so `IS NOT NULL` is true of every row the
 * ledger has ever written, and the second half of that predicate selected
 * nothing at all.
 *
 * It mattered because of what it hides. When the managed gate reported "no
 * eligible item" the obvious reading was "there are copied rows, but none has a
 * target reference" — a sync that half-worked. The truth was simpler and worse:
 * there were no copied rows. A predicate that cannot discriminate turns a
 * missing precondition into a plausible-looking partial failure, and that is
 * the more expensive of the two to chase.
 *
 * Run against real migrations rather than a hand-written table, because the
 * claim being pinned is about the COLUMN'S OWN DEFAULT — restate that default
 * in the test and the test proves only that I can type it twice.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

const TENANT = '7c1d0000-e29b-41d4-a716-4466554419a1';
const CONN = '7c1d0000-e29b-41d4-a716-4466554419a2';
const SRC = '7c1d0000-e29b-41d4-a716-4466554419a3';
const DST = '7c1d0000-e29b-41d4-a716-4466554419a4';
const MAPPING = '7c1d0000-e29b-41d4-a716-4466554419a5';

let driver: LedgerDriver;
let conn: LedgerConnection;

const item = async (hash: string, status: string, targetRef: string | null) =>
  conn.query(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status${
      targetRef === null ? '' : ', target_ref'
    })
     VALUES ($1,$2,'calendar','personal',$3,$3,$4${targetRef === null ? '' : ', $5::jsonb'})`,
    targetRef === null
      ? [TENANT, MAPPING, hash, status]
      : [TENANT, MAPPING, hash, status, targetRef],
  );

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'target-ref')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@tref.local'],
    [DST, 'dst@tref.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );

  // Deliberately inserted WITHOUT naming target_ref, because the default is the claim.
  await item('h-default', 'copied', null);
  await item('h-empty-id', 'copied', '{"id":""}');
  await item('h-real', 'copied', '{"id":"target-abc"}');
  await item('h-not-copied', 'pending', '{"id":"target-xyz"}');
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

const hashes = async (predicate: string) =>
  (
    await conn.query<{ natural_key_hash: string }>(
      `SELECT natural_key_hash FROM item
        WHERE tenant_id = $1 AND mapping_id = $2 AND status = 'copied' AND ${predicate}
        ORDER BY natural_key_hash`,
      [TENANT, MAPPING],
    )
  ).rows.map((r) => r.natural_key_hash);

describe('target_ref', () => {
  it("is NOT NULL with a '{}' default, so IS NOT NULL asks nothing", async () => {
    const { rows } = await conn.query<{
      is_nullable: string;
      column_default: string;
    }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'item' AND column_name = 'target_ref'`,
    );
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default).toContain('{}');
  });

  it('the old predicate matched every copied row, landed or not', async () => {
    expect(await hashes('target_ref IS NOT NULL')).toEqual(['h-default', 'h-empty-id', 'h-real']);
  });

  it('the id is what says it landed, and it discriminates', async () => {
    expect(await hashes(`coalesce(target_ref->>'id','') <> ''`)).toEqual(['h-real']);
  });
});

describe('the smoke asks the discriminating question', () => {
  // The two halves of this file are only worth anything together: the SQL above
  // is correct, and the script actually uses it.
  const smoke = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../deploy/compose/smoke-managed.sh'),
    'utf8',
  );

  it("selects the apply half's item on target_ref->>'id'", () => {
    expect(smoke).toContain(`coalesce(target_ref->>'id','') <> ''`);
  });

  it('no longer asks the question that could not fail', () => {
    // Scoped to the query, not the file: the script's comment names the old
    // form on purpose, to explain what it used to ask and why that was empty.
    //
    // The query used to sit inline on the `HASH=` line. It now has ONE
    // definition — `ELIGIBLE=` — interpolated into every item lookup, because
    // the apply half grew a second picker (it must not select a fixed demo
    // fixture, whose key its own deletion would tombstone forever). Two
    // hand-copied predicates could drift apart; one cannot, so this looks at
    // the definition and then checks that nothing bypasses it.
    const query = smoke.split('\n').find((l) => l.startsWith('ELIGIBLE='));
    expect(query, 'no ELIGIBLE= definition in smoke-managed.sh').toBeDefined();
    expect(query).not.toContain('target_ref IS NOT NULL');
    expect(query).toContain("target_ref->>'id'");

    // The definition only binds if it is the one in force.
    const selects = [...smoke.matchAll(/SELECT natural_key_hash FROM item[^"]*/g)];
    expect(selects.length).toBeGreaterThan(0);
    for (const m of selects) {
      expect(m[0], 'an item query that bypasses $ELIGIBLE').toContain('$ELIGIBLE');
    }
  });
});
