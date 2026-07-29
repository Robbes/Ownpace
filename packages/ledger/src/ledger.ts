import {
  MAX_ITEM_ATTEMPTS,
  type Ledger,
  type LedgerRecord,
  type ItemFailure,
  type FailureAction,
  type TenantId,
  type MappingId,
} from '@openmig/shared';
import type { PgDatabase } from './db';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as schemaPg from './schema-pg';

/**
 * SQL-backed idempotency ledger for PostgreSQL — workplan 0001, T0.
 * Backed by PostgreSQL via Drizzle; see
 * `packages/ledger/migrations/0001_init.sql` and schema-pg.ts.
 * Idempotency anchor: UNIQUE(tenant_id, mapping_id, natural_key_hash). Non-destructive.
 *
 * The ledger is a fast CACHE + audit log of a fact that ALSO lives on the target (the natural
 * key — Message-ID / iCal UID / vCard UID / file path). If it is ever lost (e.g. a fresh
 * reinstall with no backup) it is rebuilt by reindexing the target rather than re-copying
 * everything; correctness does not depend on it surviving. See ADR-0020 and workplan T9.
 */
export class PgLedger implements Ledger {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  async find(
    tenantId: TenantId,
    mappingId: MappingId,
    itemType: 'email' | 'calendar' | 'contact' | 'file',
    naturalKeyHash: string,
  ): Promise<LedgerRecord | undefined> {
    const result = await this.db
      .select()
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
          eq(schemaPg.item.domain, itemType),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const row = result[0]!;
    return this.mapRowToRecord(row);
  }

  async recordIfAbsent(record: LedgerRecord): Promise<LedgerRecord> {
    // Try to insert; if conflict, return existing row
    const inserted = await this.db
      .insert(schemaPg.item)
      .values({
        id: sql`gen_random_uuid()`,
        tenantId: record.tenantId,
        mappingId: record.mappingId,
        domain: record.itemType,
        collection: '', // Default for now
        naturalKey: '', // Will be set by caller if needed
        naturalKeyHash: record.naturalKeyHash,
        contentHash: record.contentHash,
        sizeBytes: record.sizeBytes !== undefined ? BigInt(record.sizeBytes) : null,
        status: record.status ?? 'copied',
        targetRef: JSON.stringify({ id: record.targetId }),
        sourceVersion: record.sourceVersion ?? null,
        firstSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .onConflictDoNothing()
      .returning();

    // If nothing was inserted, fetch the existing row
    if (inserted.length === 0) {
      const existing = await this.find(record.tenantId, record.mappingId, record.itemType, record.naturalKeyHash);
      if (!existing) {
        throw new Error(
          `Failed to insert or find record with naturalKeyHash: ${record.naturalKeyHash}`,
        );
      }
      return existing;
    }

    return this.mapRowToRecord(inserted[0]!);
  }

  /**
   * Overwrite an existing row's mutable state. Never inserts.
   *
   * The natural key is the WHERE clause, never a SET: it is the idempotency
   * anchor (hard rule 1), and a call that changed it would silently create a
   * second identity for the same item. Everything updated here is a fact about
   * the copy — where it landed, what it hashed to, how big it was, and which
   * source version it came from.
   *
   * A missing row throws instead of falling back to an insert. `recordIfAbsent`
   * is the only path that may create, and an update that quietly created would
   * hide a real bug: it would mean the caller decided an item had CHANGED
   * without ever having recorded copying it.
   */
  async recordUpdate(record: LedgerRecord): Promise<LedgerRecord> {
    const updated = await this.db
      .update(schemaPg.item)
      .set({
        contentHash: record.contentHash,
        sizeBytes: record.sizeBytes !== undefined ? BigInt(record.sizeBytes) : null,
        status: record.status ?? 'updated',
        targetRef: JSON.stringify({ id: record.targetId }),
        sourceVersion: record.sourceVersion ?? null,
        lastSyncedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.item.tenantId, record.tenantId),
          eq(schemaPg.item.mappingId, record.mappingId),
          eq(schemaPg.item.naturalKeyHash, record.naturalKeyHash),
          eq(schemaPg.item.domain, record.itemType),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw new Error(
        `recordUpdate found no ${record.itemType} row for naturalKeyHash ` +
          `${record.naturalKeyHash}. This method never inserts — a caller that ` +
          'decided an item changed must already have recorded copying it.',
      );
    }

    return this.mapRowToRecord(updated[0]!);
  }

  /**
   * Record that an item could not be migrated.
   *
   * Insert-or-update rather than `recordIfAbsent`, because the SECOND failure
   * of the same item is the interesting one. `recordIfAbsent` no-ops on
   * conflict, so a permanently broken item would sit at `attempt_count = 1`
   * forever and look exactly like one that failed once and then succeeded.
   * Counting attempts is what lets the loop stop retrying and hand the item to
   * a person instead.
   *
   * UPDATE-then-INSERT rather than `ON CONFLICT DO UPDATE`, because the table's
   * unique constraint is on `(tenant_id, mapping_id, item_type, natural_key_hash)`
   * and `item_type` is a column the Drizzle schema does not model — it sits
   * alongside `domain` and always takes its default. There is therefore no
   * conflict target this can name, and naming the wrong one fails at runtime
   * with "no unique or exclusion constraint matching the ON CONFLICT
   * specification" (which is exactly how this was found: against a real
   * database, after typecheck and the in-memory fake had both passed).
   *
   * The insert still carries `onConflictDoNothing`, so two workers failing the
   * same item at once cannot produce two rows; the loser re-runs the update.
   */
  async recordFailure(record: LedgerRecord, error: string): Promise<LedgerRecord> {
    const bump = () =>
      this.db
        .update(schemaPg.item)
        .set({
          status: 'failed',
          attemptCount: sql`${schemaPg.item.attemptCount} + 1`,
          lastError: error,
          updatedAt: sql`now()`,
          // Deliberately NOT content_hash or source_version: a failed attempt
          // wrote nothing, so both still describe what is actually on the
          // target. Overwriting them would make §20's checksum sampling
          // compare against content the target does not hold, and would tell
          // the next pass a failed update had landed.
        })
        .where(
          and(
            eq(schemaPg.item.tenantId, record.tenantId),
            eq(schemaPg.item.mappingId, record.mappingId),
            eq(schemaPg.item.naturalKeyHash, record.naturalKeyHash),
            eq(schemaPg.item.domain, record.itemType),
          ),
        )
        .returning();

    const bumped = await bump();
    if (bumped.length > 0) return this.mapRowToRecord(bumped[0]!);

    const rows = await this.db
      .insert(schemaPg.item)
      .values({
        id: sql`gen_random_uuid()`,
        tenantId: record.tenantId,
        mappingId: record.mappingId,
        domain: record.itemType,
        collection: '',
        naturalKey: '',
        naturalKeyHash: record.naturalKeyHash,
        contentHash: record.contentHash,
        sizeBytes: record.sizeBytes !== undefined ? BigInt(record.sizeBytes) : null,
        status: 'failed',
        targetRef: JSON.stringify({ id: record.targetId }),
        sourceVersion: record.sourceVersion ?? null,
        attemptCount: 1,
        lastError: error,
        firstSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .onConflictDoNothing()
      .returning();

    if (rows.length > 0) return this.mapRowToRecord(rows[0]!);

    // Lost the race with a concurrent worker that inserted first. Its row is
    // there now, so the attempt this call represents still has to be counted.
    const raced = await bump();
    if (raced.length === 0) {
      throw new Error(
        `recordFailure could neither insert nor update the ${record.itemType} row for ` +
          `naturalKeyHash ${record.naturalKeyHash}`,
      );
    }
    return this.mapRowToRecord(raced[0]!);
  }

  async listFailures(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<ItemFailure[]> {
    const where = [
      eq(schemaPg.item.tenantId, tenantId),
      eq(schemaPg.item.mappingId, mappingId),
      eq(schemaPg.item.status, 'failed'),
    ];
    if (domain) where.push(eq(schemaPg.item.domain, domain));

    const rows = await this.db
      .select()
      .from(schemaPg.item)
      .where(and(...where))
      .orderBy(desc(schemaPg.item.updatedAt));

    return rows.map((row) => ({
      domain: row.domain as ItemFailure['domain'],
      naturalKeyHash: row.naturalKeyHash,
      ...(row.collection ? { collection: row.collection } : {}),
      attempts: row.attemptCount,
      lastError: row.lastError ?? '(no error recorded)',
      ...(row.updatedAt
        ? {
            lastAttemptAt:
              row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
          }
        : {}),
      needsDecision: row.attemptCount >= MAX_ITEM_ATTEMPTS,
    }));
  }

  /**
   * Apply an owner decision to one failed item.
   *
   * Scoped to `status = 'failed'` on purpose: an item that has since succeeded,
   * or that someone else already accepted, must not be reopened by a stale
   * button click. Returns false in that case rather than reporting a decision
   * that did not apply.
   */
  async resolveFailure(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: FailureAction,
  ): Promise<boolean> {
    const rows = await this.db
      .update(schemaPg.item)
      .set(
        action === 'accept'
          ? // Terminal. The error stays on the row: the audit trail for a
            // decision is worthless without the reason it was made.
            { status: 'left_behind' as const, updatedAt: sql`now()` }
          : // Still 'failed' — the item has not succeeded, it has merely become
            // eligible again. Zeroing the count is the whole of "retry".
            { attemptCount: 0, updatedAt: sql`now()` },
      )
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
          eq(schemaPg.item.status, 'failed'),
        ),
      )
      .returning();

    return rows.length > 0;
  }

  private mapRowToRecord(row: typeof schemaPg.item.$inferSelect): LedgerRecord {
    return {
      tenantId: row.tenantId as TenantId,
      itemType: row.domain as 'email' | 'calendar' | 'contact' | 'file',
      mappingId: row.mappingId as MappingId,
      naturalKeyHash: row.naturalKeyHash,
      contentHash: row.contentHash ?? '',
      targetId: (row.targetRef as { id?: string })?.id ?? '',
      createdAt: row.firstSeenAt instanceof Date 
        ? row.firstSeenAt.toISOString() 
        : (row.firstSeenAt ?? ''),
      sizeBytes: row.sizeBytes !== null && row.sizeBytes !== undefined ? Number(row.sizeBytes) : undefined,
      status: row.status as LedgerRecord['status'],
      // Left off the record entirely when NULL rather than mapped to '', so
      // "never recorded" stays distinguishable from "the server sent an empty
      // ETag". The sync loop treats only the former as unknown.
      ...(row.sourceVersion !== null && row.sourceVersion !== undefined
        ? { sourceVersion: row.sourceVersion }
        : {}),
      attemptCount: row.attemptCount,
      ...(row.lastError !== null && row.lastError !== undefined
        ? { lastError: row.lastError }
        : {}),
    };
  }
}
