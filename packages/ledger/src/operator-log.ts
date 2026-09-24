// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator's log, read from the tables (workplan 0129 T2, the appliance's
 * half; the owner's D5: "same page").
 *
 * The managed edition reads the log through `support_log` (managed migration
 * 0025), a view behind the `platform_operator` check. The appliance has
 * neither that check nor that view: its operator is its owner, and it runs the
 * ledger chain only. So it reads the same two tables here, into the same page
 * (`OperatorLogPage`), with the same filters (`parseLogFilters`), and holds
 * the same line on what a row may show.
 *
 * ## Metadata only, held here as the view holds it
 *
 * `audit_log.detail` is never selected. An action that is not a name from
 * code is served as `audit.unnamed`, an actor that is not an identifier as
 * nothing, and a migration id from `detail` only once it is checked to be a
 * uuid. The three patterns are the view's own, exported below so a test holds
 * the two in step.
 *
 * ## Row security is kept, not bypassed
 *
 * The audit log is read one organisation at a time inside `withTenant`, as
 * `app_user` under that organisation's policy, which is also how its name and
 * its migrations' names are read. The application's events are read as the
 * owner, on a connection taken from the same driver: `app_event` has no row
 * security, and `app_user` may not select it (ledger 0059). Each half is ordered and cut at a page and one row,
 * and the two are merged by (time, id), the order the cursor continues in.
 */

import { sql, type SQL } from 'drizzle-orm';
import {
  LOG_PAGE,
  logEventPattern,
  type LogFilters,
  type OperatorLogEntry,
  type OperatorLogPage,
} from '@openmig/shared';
import type { LedgerDriver } from './driver.ts';
import { withTenant } from './db.ts';

/** An action served as written only when it is a name from code (managed migration 0025). */
export const LOG_ACTION_NAME = '^[a-z][a-z0-9_.:-]{0,63}$';
/** An actor served only when it is an identifier (managed migration 0025). */
export const LOG_ACTOR_NAME = '^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$';
/** A migration id read out of `detail` only when it is one (managed migration 0025). */
export const LOG_MAPPING_ID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

type Row = Record<string, unknown>;

/** The conditions both halves share, on columns both halves name alike. */
function conditions(filters: LogFilters): SQL[] {
  return [
    sql`true`,
    ...(filters.mappingId ? [sql`mapping_id = ${filters.mappingId}::uuid`] : []),
    ...(filters.event ? [sql`event LIKE ${logEventPattern(filters.event)} ESCAPE '\\'`] : []),
    ...(filters.since ? [sql`at >= ${filters.since}::timestamptz`] : []),
    ...(filters.before
      ? [
          filters.beforeId
            ? sql`(at, id) < (${filters.before}::timestamptz, ${filters.beforeId}::uuid)`
            : sql`at < ${filters.before}::timestamptz`,
        ]
      : []),
  ];
}

const AT_TEXT = sql`to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface OperatorLogSource {
  /**
   * The serving driver. `withTenant` reads each organisation under its policy,
   * and a connection taken from it (as the owner) reads `app_event`.
   */
  readonly driver: LedgerDriver;
  /** The organisations this deployment serves. */
  readonly tenantIds: readonly string[];
  /**
   * What this deployment calls its migrations, by row id, over the row's own
   * `name`. The appliance's row holds its config slug (`ensureRecordsFor`),
   * and its screens name a migration by the mapping's `name`, so the log does
   * too.
   */
  readonly migrationNames?: ReadonlyMap<string, string>;
}

/** One page of the log, newest first. */
export async function readOperatorLog(
  source: OperatorLogSource,
  filters: LogFilters,
): Promise<OperatorLogPage> {
  const take = LOG_PAGE + 1;
  const tenants = filters.tenantId
    ? source.tenantIds.filter((t) => t === filters.tenantId)
    : [...new Set(source.tenantIds)];
  const tenantNames = new Map<string, string>();
  const migrationNames = new Map<string, string>();

  // An audit row is `info`, and has no category and no reference.
  const auditWanted =
    (filters.level === undefined || filters.level === 'info') &&
    filters.category === undefined &&
    filters.reference === undefined;
  const entries: OperatorLogEntry[] = [];

  for (const tenantId of tenants) {
    await withTenant(source.driver, tenantId, async (db) => {
      const named = (await db.execute(
        sql`SELECT id::text AS id, name FROM tenant WHERE id = ${tenantId}::uuid`,
      )) as unknown as { rows: Row[] };
      for (const r of named.rows) if (r.name) tenantNames.set(String(r.id), String(r.name));
      const migrations = (await db.execute(
        sql`SELECT id::text AS id, name FROM mailbox_mapping WHERE tenant_id = ${tenantId}::uuid`,
      )) as unknown as { rows: Row[] };
      for (const r of migrations.rows) if (r.name) migrationNames.set(String(r.id), String(r.name));

      if (!auditWanted) return;
      const audit = (await db.execute(sql`
        SELECT id::text AS id, ${AT_TEXT} AS at, tenant_id::text AS tenant_id,
               mapping_id::text AS mapping_id, event, actor
          FROM (
            SELECT a.id, a.at, a.tenant_id,
                   CASE WHEN (a.detail ->> 'mappingId') ~* ${LOG_MAPPING_ID}
                        THEN (a.detail ->> 'mappingId')::uuid END AS mapping_id,
                   CASE WHEN a.action ~ ${LOG_ACTION_NAME} THEN a.action
                        ELSE 'audit.unnamed' END AS event,
                   CASE WHEN a.actor ~ ${LOG_ACTOR_NAME} THEN a.actor END AS actor
              FROM audit_log a
             WHERE a.tenant_id = ${tenantId}::uuid
          ) audit
         WHERE ${sql.join(conditions(filters), sql` AND `)}
         ORDER BY audit.at DESC, audit.id DESC
         LIMIT ${take}
      `)) as unknown as { rows: Row[] };
      for (const r of audit.rows) {
        entries.push({
          id: String(r.id),
          at: String(r.at),
          source: 'audit',
          level: 'info',
          tenant_id: r.tenant_id ? String(r.tenant_id) : null,
          tenant_name: null,
          mapping_id: r.mapping_id ? String(r.mapping_id) : null,
          migration_name: null,
          event: String(r.event),
          category: null,
          reference: null,
          actor: r.actor ? String(r.actor) : null,
        });
      }
    });
  }

  // The application's events: every level but an audit row's.
  if (filters.level !== 'info') {
    const where = [
      ...conditions(filters),
      ...(filters.level ? [sql`level = ${filters.level}`] : []),
      ...(filters.tenantId ? [sql`tenant_id = ${filters.tenantId}::uuid`] : []),
      ...(filters.category ? [sql`category = ${filters.category}`] : []),
      ...(filters.reference ? [sql`reference = ${filters.reference}`] : []),
    ];
    // On a connection from the driver, never on a handle that skips its
    // queue. PGlite is one connection: a query that jumps the queue runs
    // inside whatever transaction a pass has open, as `app_user`, which may
    // not read `app_event`, and the page answered "permission denied"
    // whenever a pass was busy (the reproduction is in the test).
    const conn = await source.driver.acquire();
    let events: { rows: Row[] };
    try {
      events = (await conn.db.execute(sql`
        SELECT id::text AS id, ${AT_TEXT} AS at, level, tenant_id::text AS tenant_id,
               mapping_id::text AS mapping_id, event, category, reference
          FROM app_event
         WHERE ${sql.join(where, sql` AND `)}
         ORDER BY app_event.at DESC, app_event.id DESC
         LIMIT ${take}
      `)) as unknown as { rows: Row[] };
      conn.release();
    } catch (err) {
      conn.release(err as Error);
      throw err;
    }
    for (const r of events.rows) {
      entries.push({
        id: String(r.id),
        at: String(r.at),
        source: 'app',
        level: r.level === 'warn' ? 'warn' : 'error',
        tenant_id: r.tenant_id ? String(r.tenant_id) : null,
        tenant_name: null,
        mapping_id: r.mapping_id ? String(r.mapping_id) : null,
        migration_name: null,
        event: String(r.event),
        category: r.category ? String(r.category) : null,
        reference: r.reference ? String(r.reference) : null,
        actor: null,
      });
    }
  }

  // Newest first by (time, id): the time is fixed-width text to the
  // microsecond, and a uuid orders by its text as Postgres orders it, so this
  // is the order the cursor continues in.
  entries.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  const page = entries.slice(0, LOG_PAGE).map((e) => ({
    ...e,
    tenant_name: e.tenant_id ? (tenantNames.get(e.tenant_id) ?? null) : null,
    migration_name: e.mapping_id
      ? (source.migrationNames?.get(e.mapping_id) ?? migrationNames.get(e.mapping_id) ?? null)
      : null,
  }));
  const last = page[page.length - 1];
  return {
    entries: page,
    next: entries.length > LOG_PAGE && last ? { before: last.at, beforeId: last.id } : null,
    limit: LOG_PAGE,
  };
}
