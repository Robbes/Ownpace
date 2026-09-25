// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MONTH'S PEAK, AT THE LEDGER'S OWN DOOR (workplan 0109 T2).
 *
 * The API's doors raise the month's high-water mark of slot-holding paths in
 * the same transaction as the slots they take. A rollback takes slots too: it
 * puts a migration back to `active`. It goes through the ledger's own door,
 * `applyMappingStatusChange`, from the cutover CLI and from the `run-rollback`
 * job, and the ledger may not write the managed edition's `occupancy_peak`
 * (hard rule 5). So both hand it this, as `onSlotsTaken`, and the mark rises
 * with the slots in one transaction. Until 2026-09-24 neither did, and a
 * rollback's slots were in no month's peak.
 *
 * The CLI is also the self-hosted operator's door, on a database with no
 * managed chain. So the table is looked for first, and the managed package is
 * loaded only where it is there.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';

/** Raise this tenant's peak for the month, where the database keeps one. */
export function raiseThePeakWhereThereIsOne(tenantId: TenantId): (db: PgDatabase) => Promise<void> {
  return async (db) => {
    const found = await db.execute(sql`SELECT to_regclass('public.occupancy_peak') IS NOT NULL AS kept`);
    if ((found.rows[0] as { kept?: boolean } | undefined)?.kept !== true) return;
    const { PgOccupancyPeakStore } = await import('@openmig/managed');
    await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId);
  };
}
