// Copyright 2026 The Ownpace authors (Apache-2.0)
import {
  type DiscoveryStore,
  type DiscoveryRecord,
  type DiscoveryDomain,
  type DomainDiscovery,
  type TenantId,
  type MappingId,
} from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import { eq, and, sql } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';

/**
 * PostgreSQL implementation of {@link DiscoveryStore} (workplan 0013 T2).
 * One row per (tenant, mapping, domain); re-discovery overwrites via upsert. Tenant-scoped by RLS
 * (migration 0014) — production callers run inside `withTenant` as the non-owner `app_user`.
 */
export class PgDiscoveryStore implements DiscoveryStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  async upsertDiscovery(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    discovery: DomainDiscovery,
  ): Promise<void> {
    const bytes = discovery.bytes ?? null;
    const perCollection = discovery.perCollection ?? null;
    const generatedIdItems = discovery.generatedIdItems ?? null;
    // `?? null`, never `?? 0`: an unreadable destination must not be recorded
    // as an empty one.
    const targetExisting = discovery.targetExisting ?? null;
    // `?? null` rather than `?? {}`: an absent tally means the source could not
    // count, and writing an empty object there would claim a look nobody took.
    const refusedNative = discovery.refusedNative ?? null;
    const targetColliding = discovery.targetColliding ?? null;
    await this.db
      .insert(schemaPg.migrationDiscovery)
      .values({
        tenantId,
        mappingId,
        domain,
        collections: discovery.collections,
        items: discovery.items,
        bytes,
        perCollection,
        generatedIdItems,
        targetExisting,
        refusedNative,
        targetColliding,
        lastError: null,
        discoveredAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          schemaPg.migrationDiscovery.tenantId,
          schemaPg.migrationDiscovery.mappingId,
          schemaPg.migrationDiscovery.domain,
        ],
        set: {
          collections: discovery.collections,
          items: discovery.items,
          bytes,
          perCollection,
          generatedIdItems,
          targetExisting,
          refusedNative,
          targetColliding,
          lastError: null,
          discoveredAt: sql`now()`,
        },
      });
  }

  async recordDiscoveryError(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    error: string,
  ): Promise<void> {
    await this.db
      .insert(schemaPg.migrationDiscovery)
      .values({
        tenantId,
        mappingId,
        domain,
        collections: 0,
        items: 0,
        bytes: null,
        perCollection: null,
        generatedIdItems: null,
        targetExisting: null,
        refusedNative: null,
        targetColliding: null,
        lastError: error,
        discoveredAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          schemaPg.migrationDiscovery.tenantId,
          schemaPg.migrationDiscovery.mappingId,
          schemaPg.migrationDiscovery.domain,
        ],
        // Keep whatever counts a prior successful pass recorded; stamp the
        // error and NOTHING ELSE.
        //
        // `discoveredAt` used to move here too, which quietly re-dated the
        // counts this branch exists to preserve: the row then said a failed
        // attempt's time above numbers that attempt never took. The confirm
        // screen prints that value as when the migration was last checked, so
        // an owner whose Files count came from an earlier day and whose latest
        // pass died on a rate-budget error was shown that older count under
        // today's date (2026-09-08). One field, two meanings — and the customer
        // had no way to tell which they were looking at.
        //
        // So it means one thing: WHEN THESE COUNTS WERE TAKEN. The insert
        // branch above stamps it with zero counts beside it, which is the
        // honest reading of a domain that has never been counted; the update
        // branch leaves the successful pass's time exactly where it was.
        set: {
          lastError: error,
        },
      });
  }

  async getDiscovery(tenantId: TenantId, mappingId: MappingId): Promise<DiscoveryRecord[]> {
    const rows = await this.db
      .select()
      .from(schemaPg.migrationDiscovery)
      .where(
        and(
          eq(schemaPg.migrationDiscovery.tenantId, tenantId),
          eq(schemaPg.migrationDiscovery.mappingId, mappingId),
        ),
      )
      .orderBy(schemaPg.migrationDiscovery.domain);

    return rows.map((row) => {
      const record: DiscoveryRecord = {
        domain: row.domain as DiscoveryDomain,
        collections: row.collections,
        items: row.items,
        discoveredAt:
          row.discoveredAt instanceof Date ? row.discoveredAt.toISOString() : String(row.discoveredAt),
        ...(row.bytes != null ? { bytes: Number(row.bytes) } : {}),
        ...(row.generatedIdItems != null
          ? { generatedIdItems: Number(row.generatedIdItems) }
          : {}),
        ...(row.targetExisting != null ? { targetExisting: Number(row.targetExisting) } : {}),
        // Left OUT when null rather than defaulted to `{}` — the read has to
        // preserve the same "did not look" / "found none" distinction the
        // column stores, or the screen cannot tell them apart either.
        ...(row.refusedNative != null
          ? { refusedNative: row.refusedNative as Readonly<Record<string, number>> }
          : {}),
        ...(row.targetColliding != null ? { targetColliding: Number(row.targetColliding) } : {}),
        ...(row.perCollection
          ? { perCollection: row.perCollection as DiscoveryRecord['perCollection'] }
          : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
      };
      return record;
    });
  }
}
