// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The audit log, read back for the export's download (workplan 0129 T4; the
 * owner's D4: "a download endpoint that resumes where the last one stopped,
 * for backfill").
 *
 * In the order a log store keeps it, by time and then id, from a cursor, a page
 * at a time. Each organisation is read under its own policy (`withTenant`), as
 * the log page reads it, and the pages are merged.
 *
 * ## Only what has settled
 *
 * A row's `at` is its transaction's start (`now()`), not its commit. A
 * transaction that began before another and commits after it leaves an earlier
 * time behind a later one already visible, and a download that had read past
 * that time would never see it. So the download serves an event only once it
 * is older than any transaction that writes an audit event runs for
 * (`AUDIT_EXPORT_SETTLE_SECONDS`). The newest events are the stream's
 * (`exportAuditEvent`, printed as each commits); the download is for what a
 * collector missed.
 */

import { sql } from 'drizzle-orm';
import type { AuditExportCursor, AuditExportEvent } from '@openmig/shared';
import type { LedgerDriver } from './driver.ts';
import { withTenant } from './db.ts';

/** How old an event must be before the download serves it. */
export const AUDIT_EXPORT_SETTLE_SECONDS = 300;
/** A page, unless the caller asks for another size. */
export const AUDIT_EXPORT_PAGE = 1000;
/** The largest page a caller may ask for. */
export const AUDIT_EXPORT_PAGE_MAX = 10_000;

export interface AuditExportSource {
  /** The serving driver: each organisation is read under its own policy. */
  readonly driver: LedgerDriver;
  /** The organisations this deployment serves. */
  readonly tenantIds: readonly string[];
}

export interface AuditExportRead {
  /** Start after this event; from the first when absent. */
  readonly after?: AuditExportCursor;
  readonly limit?: number;
  /** Tests only: the settle interval is the download's, not the caller's. */
  readonly settleSeconds?: number;
}

type Row = Record<string, unknown>;

/** The events after the cursor, oldest first, as the rows hold them. */
export async function readAuditExport(
  source: AuditExportSource,
  read: AuditExportRead = {},
): Promise<AuditExportEvent[]> {
  const limit = read.limit ?? AUDIT_EXPORT_PAGE;
  const settle = read.settleSeconds ?? AUDIT_EXPORT_SETTLE_SECONDS;
  const events: AuditExportEvent[] = [];
  for (const tenantId of new Set(source.tenantIds)) {
    await withTenant(source.driver, tenantId, async (db) => {
      const found = (await db.execute(sql`
        SELECT id::text AS id,
               to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
               tenant_id::text AS tenant_id, actor, action, entity, detail
          FROM audit_log
         WHERE tenant_id = ${tenantId}::uuid
           AND at < now() - make_interval(secs => ${settle}::double precision)
           ${read.after ? sql`AND (at, id) > (${read.after.at}::timestamptz, ${read.after.id}::uuid)` : sql``}
         ORDER BY at, id
         LIMIT ${limit}
      `)) as unknown as { rows: Row[] };
      for (const r of found.rows) {
        events.push({
          id: String(r.id),
          at: String(r.at),
          tenantId: String(r.tenant_id),
          actor: r.actor === null || r.actor === undefined ? '' : String(r.actor),
          action: String(r.action),
          ...(r.entity ? { entity: String(r.entity) } : {}),
          ...(r.detail && typeof r.detail === 'object' ? { detail: r.detail as Record<string, unknown> } : {}),
        });
      }
    });
  }
  // One order across the organisations: the times are the same fixed-width
  // text, and a uuid's text sorts as its bytes do.
  events.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return events.slice(0, limit);
}
