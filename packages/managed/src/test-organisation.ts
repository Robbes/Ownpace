// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION MARKED AS A TEST (workplan 0162 T1, §3; ADR-0053).
 *
 * The organisation's marker is a row of `test_organisation` (managed migration
 * 0062), and no row for an organisation that is not a test. The operator's two
 * doors write it (`POST` and `DELETE /api/support/tenants/{tenantId}/test`),
 * and `POST /api/migrations` reads it, in the transaction that creates the
 * migration, to copy it onto the migration's own row
 * (`mailbox_mapping.test_marker`, ledger migration 0070), where it never
 * changes (§2 (c)).
 *
 * Every function here runs inside the caller's own transaction, in the
 * organisation's context (`withTenant`): the table is under FORCE ROW LEVEL
 * SECURITY, so outside that context a read finds no marker and a write
 * matches nothing. Deciding WHETHER to write is the caller's: the doors refuse
 * while the organisation holds a migration (`migrationsHeldBy`), under the
 * organisation's migrations lock, which the create door takes too.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';

/** The audit action a marker set is recorded under (0162 T1). */
export const TEST_MARKER_SET_ACTION = 'tenant.test_marker_set';

/** The audit action a marker cleared is recorded under (0162 T1). */
export const TEST_MARKER_CLEARED_ACTION = 'tenant.test_marker_cleared';

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] } | null)?.rows ?? []) as Row[];

/** The organisation's marker, or undefined for an organisation that is not a test. */
export async function testMarkerOfOrganisation(db: PgDatabase, tenantId: string): Promise<string | undefined> {
  const [row] = rowsOf(
    await db.execute(sql`SELECT marker FROM test_organisation WHERE tenant_id = ${tenantId}::uuid`),
  );
  return row === undefined ? undefined : String(row.marker);
}

/**
 * How many migrations the organisation holds: every `mailbox_mapping` row that
 * names it, whatever its status, a draft and a finished one alike. The count
 * `support_tenants.migration_count` serves and `operator.sh clean
 * empty-tenant` reads: a finished migration is still the organisation's until
 * it is deleted, and so is a draft nobody started.
 */
export async function migrationsHeldBy(db: PgDatabase, tenantId: string): Promise<number> {
  const [row] = rowsOf(
    await db.execute(sql`SELECT count(*)::int AS n FROM mailbox_mapping WHERE tenant_id = ${tenantId}::uuid`),
  );
  return Number(row?.n ?? 0);
}

/**
 * Set the organisation's marker, or replace the one it had. Returns the marker
 * it replaced, if any. The marker is stored as given: the caller reads what
 * the operator typed first (`readTestMarker`, shared), and the table's CHECK
 * is the floor beneath it.
 */
export async function markTestOrganisation(
  db: PgDatabase,
  tenantId: string,
  marker: string,
  markedBy: string,
): Promise<{ readonly replaced: string | undefined }> {
  const replaced = await testMarkerOfOrganisation(db, tenantId);
  await db.execute(sql`
    INSERT INTO test_organisation (tenant_id, marker, marked_by, marked_at)
    VALUES (${tenantId}::uuid, ${marker}, ${markedBy}, now())
    ON CONFLICT (tenant_id) DO UPDATE
       SET marker = EXCLUDED.marker,
           marked_by = EXCLUDED.marked_by,
           marked_at = EXCLUDED.marked_at
  `);
  return { replaced };
}

/**
 * Clear the organisation's marker. Returns the marker it cleared, or undefined
 * when the organisation was not a test, which changes nothing.
 */
export async function unmarkTestOrganisation(
  db: PgDatabase,
  tenantId: string,
): Promise<{ readonly cleared: string | undefined }> {
  const [row] = rowsOf(
    await db.execute(sql`DELETE FROM test_organisation WHERE tenant_id = ${tenantId}::uuid RETURNING marker`),
  );
  return { cleared: row === undefined ? undefined : String(row.marker) };
}

/**
 * The refusal while the organisation holds migrations (§2 (b)), said for the
 * operator, who reads it on the Support screen as the API says it.
 */
export function holdsMigrationsSaid(held: number, door: 'mark' | 'unmark'): string {
  const migrations = held === 1 ? '1 migration' : `${held} migrations`;
  return door === 'mark'
    ? `It holds ${migrations}: an organisation becomes a test only while it holds none, ` +
        'so that every migration in a test organisation carries its marker. Delete them first.'
    : `It holds ${migrations}: an organisation stops being a test only while it holds none, ` +
        'and each test migration keeps its marker until it is deleted. Delete them first.';
}
