// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The cases migration 0070 is held to, written once and run twice: on PGlite in
 * `the-marker-a-test-copies-by.unit.test.ts`, which every pull request runs, and
 * on a real Postgres in `the-marker-a-test-copies-by.integration.test.ts`. The
 * appliance applies the ledger chain on either, so a CHECK or a trigger that one
 * of them reads differently is a refusal one edition has and the other has not.
 *
 * Each case makes its own organisation, with ids drawn fresh, so a database the
 * integration tier shares with other files is never read for someone else's rows.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { readPathPhases } from '../path-phases.ts';
import type { PgDatabase } from '../db-types.ts';
import { runAsHolder, type LedgerConnection } from '../driver.ts';

/** What the cases need from the database under test. */
export interface MarkerDatabase {
  /** A connection to run statements on; released by the case that took it. */
  acquire(): Promise<LedgerConnection>;
  /** A drizzle handle on the same database, for the reader. */
  db(): PgDatabase;
}

/** One organisation with a source mailbox, ready to hold migrations. */
async function anOrganisation(conn: LedgerConnection): Promise<{ tenant: string; mailbox: string }> {
  const tenant = randomUUID();
  const connection = randomUUID();
  await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'marker cases')`, [tenant]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name)
     VALUES ($1, $2, 'source', 'imap', 'source')`,
    [connection, tenant],
  );
  const mailbox = await conn.query<{ id: string }>(
    `INSERT INTO mailbox (tenant_id, connection_id, external_id, kind)
     VALUES ($1, $2, $3, 'user') RETURNING id`,
    [tenant, connection, `owner-${tenant}@example.test`],
  );
  return { tenant, mailbox: mailbox.rows[0]!.id };
}

/** A migration in that organisation, with the marker given (NULL when none). */
async function aMigration(
  conn: LedgerConnection,
  at: { tenant: string; mailbox: string },
  marker: string | null,
): Promise<string> {
  // A prefix of its own, so two migrations between the same mailboxes are
  // allowed (`uk_mapping_source_target_prefix`, migration 0022).
  const made = await conn.query<{ id: string }>(
    `INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, target_folder_prefix, test_marker)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [at.tenant, at.mailbox, `prefix-${randomUUID()}`, marker],
  );
  return made.rows[0]!.id;
}

async function markerOf(conn: LedgerConnection, mapping: string): Promise<string | null> {
  const rows = await conn.query<{ test_marker: string | null }>(
    `SELECT test_marker FROM mailbox_mapping WHERE id = $1`,
    [mapping],
  );
  return rows.rows[0]!.test_marker;
}

/** The CHECK's refusal, by name: Postgres and PGlite both say which constraint. */
const CHECK_REFUSAL = /mailbox_mapping_test_marker_check/;
/** The trigger's refusal, in its own words. */
const TRIGGER_REFUSAL = /test marker is written when the migration is created and never changed or removed/;

export function theMarkerColumn(database: MarkerDatabase): void {
  async function withConnection<T>(work: (conn: LedgerConnection) => Promise<T>): Promise<T> {
    const conn = await database.acquire();
    try {
      // As the holder: the reader below goes through `database.db()`, which on
      // PGlite waits for the one connection this case is holding.
      return await runAsHolder(conn, () => work(conn));
    } finally {
      conn.release();
    }
  }

  describe('a migration that is not a test', () => {
    it('reads NULL, and the reader says no marker at all', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        const mapping = await aMigration(conn, at, null);

        expect(await markerOf(conn, mapping)).toBeNull();
        const phases = await readPathPhases(database.db(), at.tenant, mapping);
        expect(phases).not.toBeNull();
        expect(phases!).not.toHaveProperty('testMarker');
      }));
  });

  describe('a test migration', () => {
    it('keeps a marker of three to sixty-four characters as it was written, and the reader carries it', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        // Counted in characters, not bytes: 64 of a two-byte letter is 128 bytes.
        for (const marker of ['[Ownpace-test]', 'abc', 'x'.repeat(64), 'é'.repeat(64), '[Test ñ ✓]']) {
          const mapping = await aMigration(conn, at, marker);
          expect(await markerOf(conn, mapping)).toBe(marker);
          const phases = await readPathPhases(database.db(), at.tenant, mapping);
          expect(phases?.testMarker).toBe(marker);
        }
      }));

    it.each([
      ['empty', ''],
      ['two characters', 'ab'],
      ['sixty-five characters', 'x'.repeat(65)],
      ['sixty-five two-byte characters', 'é'.repeat(65)],
      ['a tab (C0)', '[Own\tpace]'],
      ['a line feed (C0)', '[Ownpace-test]\n'],
      ['U+0001 (C0)', '\u0001abc'],
      ['DEL', 'abc\u007f'],
      ['U+0085, next line (C1)', 'ab\u0085c'],
      ['U+009F (C1)', '\u009fabc'],
    ])('refuses a marker that is %s, at the CHECK', (_what, marker) =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        await expect(aMigration(conn, at, marker)).rejects.toThrow(CHECK_REFUSAL);
      }));
  });

  describe('the marker is written once', () => {
    it('refuses a change, a removal and a marker set later, for the owner of the database', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        const marked = await aMigration(conn, at, '[Ownpace-test]');
        const plain = await aMigration(conn, at, null);

        await expect(
          conn.query(`UPDATE mailbox_mapping SET test_marker = '[Other-test]' WHERE id = $1`, [marked]),
        ).rejects.toThrow(TRIGGER_REFUSAL);
        await expect(
          conn.query(`UPDATE mailbox_mapping SET test_marker = NULL WHERE id = $1`, [marked]),
        ).rejects.toThrow(TRIGGER_REFUSAL);
        await expect(
          conn.query(`UPDATE mailbox_mapping SET test_marker = '[Ownpace-test]' WHERE id = $1`, [plain]),
        ).rejects.toThrow(TRIGGER_REFUSAL);

        expect(await markerOf(conn, marked)).toBe('[Ownpace-test]');
        expect(await markerOf(conn, plain)).toBeNull();
      }));

    it('refuses it for the request path too, in the organisation’s own scope', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        const marked = await aMigration(conn, at, '[Ownpace-test]');
        await conn.query('BEGIN');
        try {
          await conn.query('SET LOCAL ROLE app_user');
          await conn.query("SELECT set_config('app.current_tenant', $1, true)", [at.tenant]);
          // The role can update the row at all: a status change goes through.
          await conn.query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [marked]);
          await expect(
            conn.query(`UPDATE mailbox_mapping SET test_marker = NULL WHERE id = $1`, [marked]),
          ).rejects.toThrow(TRIGGER_REFUSAL);
        } finally {
          await conn.query('ROLLBACK');
        }
        expect(await markerOf(conn, marked)).toBe('[Ownpace-test]');
      }));

    it('lets every other update of the row through, and one that sets the marker to itself', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        const marked = await aMigration(conn, at, '[Ownpace-test]');

        await conn.query(
          `UPDATE mailbox_mapping
              SET status = 'paused', name = 'renamed', schedule = '0 * * * *',
                  allow_apply_deletions = true, updated_at = now()
            WHERE id = $1`,
          [marked],
        );
        await conn.query(`UPDATE mailbox_mapping SET test_marker = test_marker WHERE id = $1`, [marked]);
        await conn.query(`UPDATE mailbox_mapping SET test_marker = '[Ownpace-test]' WHERE id = $1`, [marked]);

        const row = await conn.query<{ status: string; name: string; test_marker: string }>(
          `SELECT status, name, test_marker FROM mailbox_mapping WHERE id = $1`,
          [marked],
        );
        expect(row.rows[0]).toEqual({ status: 'paused', name: 'renamed', test_marker: '[Ownpace-test]' });
      }));

    it('leaves deleting the migration open: a test migration ends by being deleted', () =>
      withConnection(async (conn) => {
        const at = await anOrganisation(conn);
        const marked = await aMigration(conn, at, '[Ownpace-test]');
        await conn.query(`DELETE FROM mailbox_mapping WHERE id = $1`, [marked]);
        const left = await conn.query(`SELECT 1 FROM mailbox_mapping WHERE id = $1`, [marked]);
        expect(left.rows).toHaveLength(0);
      }));
  });
}
