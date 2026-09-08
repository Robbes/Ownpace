// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Delete on a migration answered a 500, and the reason was a default nobody chose.
 *
 * On the live stack, Delete on a migration that had ever been verified came
 * back as "Something went wrong deleting this migration — this is a fault on
 * our side. Reference 81f9ee6d", with no way past it from the screen.
 * Underneath:
 *
 *     ERROR:  update or delete on table "mailbox_mapping" violates foreign
 *             key constraint "verification_run_mapping_id_fkey"
 *
 * Eighteen foreign keys reference `mailbox_mapping`. Sixteen said cascade,
 * one (`run`) said set null because a run is metered and outlives what it
 * measured, and TWO said nothing at all — `verification_run` and
 * `apply_receipt`. Postgres reads an omitted action as NO ACTION, so "nothing
 * written" became "refuse the delete", which is a decision the schema made by
 * accident.
 *
 * ## Two guards, because one of them is not enough
 *
 * The first is behavioural, against a real database with the real migration
 * chain applied: delete a mapping that has both dependants and assert they
 * went with it. That is the customer's bug, and it cannot be satisfied by a
 * comment or a matching string.
 *
 * The second reads the schema source and refuses ANY reference to
 * `mailboxMapping.id` that does not state an `onDelete`. That is the one that
 * stops this recurring: the next table to reference a mapping gets the same
 * silent default unless somebody is made to answer the question, and the
 * behavioural test above cannot know about a table nobody has written yet.
 *
 * ## Why apply_receipt cascades, which took the longest to answer
 *
 * It records a DESTRUCTIVE action, so deleting it is deleting the record that
 * we deleted somebody's mail. It cascades anyway: every read of the table in
 * the codebase is keyed by `mapping_id` (it is the managed poller's outcome
 * row plus per-item idempotency, 0017 T4), so a receipt kept without one is
 * unreachable rather than preserved. The record that outlives the mapping is
 * the `audit_log` row — no foreign key to a mapping, not pruned by retention
 * — and the change that made this defensible was writing that row on the path
 * a HUMAN presses, which until now only the automatic path did.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

let driver: LedgerDriver;
let conn: LedgerConnection;

const TENANT = 'aaaaaaaa-0000-4000-8000-0000000000de';
const SRC_CONN = 'bbbbbbbb-0000-4000-8000-0000000000de';
let srcMailbox: string;

/** A mapping with one verification run and one apply receipt hanging off it. */
async function mappingWithDependants(prefix: string): Promise<string> {
  const mapping = await conn.query<{ id: string }>(
    `INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, target_folder_prefix)
     VALUES ($1, $2, $3) RETURNING id`,
    [TENANT, srcMailbox, prefix],
  );
  const mappingId = mapping.rows[0]!.id;
  await conn.query(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at)
     VALUES ($1, $2, 'done', now())`,
    [TENANT, mappingId],
  );
  await conn.query(
    `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, action, state, finished_at)
     VALUES ($1, $2, 'a-hash', 'deletion', 'applied', now())`,
    [TENANT, mappingId],
  );
  return mappingId;
}

async function countFor(table: string, mappingId: string): Promise<number> {
  const rows = await conn.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE mapping_id = $1`,
    [mappingId],
  );
  return Number(rows.rows[0]!.n);
}

beforeAll(async () => {
  driver = pgliteDriver();
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'acme')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name)
     VALUES ($1, $2, 'source', 'imap', 'source conn')`,
    [SRC_CONN, TENANT],
  );
  const src = await conn.query<{ id: string }>(
    `INSERT INTO mailbox (tenant_id, connection_id, external_id, kind)
     VALUES ($1, $2, 'primary', 'user') RETURNING id`,
    [TENANT, SRC_CONN],
  );
  srcMailbox = src.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

describe('deleting a migration that has been verified and has applied removals', () => {
  it('succeeds, where it used to answer a 500', async () => {
    const mappingId = await mappingWithDependants('verified');
    expect(await countFor('verification_run', mappingId)).toBe(1);
    expect(await countFor('apply_receipt', mappingId)).toBe(1);

    // The route's own statement, near enough: DELETE ... WHERE id AND tenant.
    let refusal: string | null = null;
    try {
      await conn.query(`DELETE FROM mailbox_mapping WHERE id = $1 AND tenant_id = $2`, [
        mappingId,
        TENANT,
      ]);
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }

    expect(
      refusal,
      'A foreign key refused the delete. That reaches the customer as an opaque 500 with a\n' +
        'reference number and no way forward — the migration cannot be deleted at all.',
    ).toBeNull();
  });

  it('takes both dependants with it, rather than leaving rows nothing can reach', async () => {
    const mappingId = await mappingWithDependants('cascade');
    await conn.query(`DELETE FROM mailbox_mapping WHERE id = $1`, [mappingId]);

    expect(await countFor('verification_run', mappingId)).toBe(0);
    expect(
      await countFor('apply_receipt', mappingId),
      'Every read of apply_receipt is keyed by mapping_id, so a receipt whose mapping is\n' +
        'gone is unreachable rather than preserved. What survives a mapping delete is the\n' +
        'audit_log row both apply routes write — that one has no foreign key to a mapping.',
    ).toBe(0);
  });

  it('leaves the audit row, which is what the receipt was never the durable half of', async () => {
    const mappingId = await mappingWithDependants('audited');
    await conn.query(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
       VALUES ($1, 'user-42', 'apply_deletion.ordered', 'item',
               jsonb_build_object('mappingId', $2::text, 'naturalKeyHash', 'a-hash'))`,
      [TENANT, mappingId],
    );

    await conn.query(`DELETE FROM mailbox_mapping WHERE id = $1`, [mappingId]);

    const kept = await conn.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE tenant_id = $1 AND detail ->> 'mappingId' = $2`,
      [TENANT, mappingId],
    );
    expect(
      Number(kept.rows[0]!.n),
      'audit_log holds the mapping id INSIDE its jsonb detail rather than as a foreign key,\n' +
        'and retention does not prune the table. That is the whole reason the receipt may\n' +
        'cascade: who ordered a destructive action survives the migration being deleted.\n' +
        'A foreign key added here would quietly take that away.',
    ).toBe(1);
  });

  it('leaves the run row, because a run is metered and outlives what it measured', async () => {
    const mappingId = await mappingWithDependants('metered');
    await conn.query(
      `INSERT INTO run (tenant_id, mapping_id, kind, status) VALUES ($1, $2, 'incremental', 'succeeded')`,
      [TENANT, mappingId],
    );
    await conn.query(`DELETE FROM mailbox_mapping WHERE id = $1`, [mappingId]);

    const orphans = await conn.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM run WHERE tenant_id = $1 AND mapping_id IS NULL`,
      [TENANT],
    );
    expect(
      Number(orphans.rows[0]!.n),
      'run.mapping_id is SET NULL on purpose: the row is what compute is billed from, so\n' +
        'it must survive the mapping. Cascading it would delete a customer invoice line.',
    ).toBe(1);
  });
});

describe('the schema states what happens to every reference to a mapping', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./schema-pg.ts', import.meta.url)),
    'utf8',
  );

  it('has no reference to mailboxMapping.id that leaves the question unanswered', () => {
    // `.references(() => mailboxMapping.id)` with nothing after it — the exact
    // shape both of these had. Drizzle omits the clause, Postgres defaults to
    // NO ACTION, and a delete the product offers starts refusing.
    const unstated = source.match(/\.references\(\(\)\s*=>\s*mailboxMapping\.id\s*\)/g) ?? [];

    expect(
      unstated,
      'A reference to mailboxMapping.id with no onDelete. Postgres reads that as NO ACTION,\n' +
        'so deleting a migration will refuse — as an opaque 500 on the customer\'s screen,\n' +
        'because nothing in the delete route turns a constraint violation into a sentence.\n' +
        'Say cascade (the row is mapping-scoped) or set null (the row outlives the mapping,\n' +
        'like a metered run), and make the column nullable if you choose set null.',
    ).toEqual([]);
  });

  it('finds every reference, so the guard above is looking at something', () => {
    const all = source.match(/\.references\(\(\)\s*=>\s*mailboxMapping\.id/g) ?? [];
    expect(
      all.length,
      'No references found at all — the pattern stopped matching the schema, and the\n' +
        'guard above is passing because it sees nothing rather than because all is well.',
    ).toBeGreaterThanOrEqual(18);
  });
});
