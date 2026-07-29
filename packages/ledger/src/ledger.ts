import {
  MAX_ITEM_ATTEMPTS,
  type Ledger,
  type LedgerRecord,
  type ItemFailure,
  type FailureAction,
  type ItemMove,
  type MoveAction,
  type ItemDeletion,
  type DeletionAction,
  DELETION_CONFIRMATIONS,
  type TenantId,
  type MappingId,
} from '@openmig/shared';
import type { PgDatabase } from './db';
import { eq, and, ne, gt, gte, isNull, isNotNull, desc, sql } from 'drizzle-orm';
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

  /**
   * The row a source href belongs to.
   *
   * `source_ref ->> 'href'` rather than a whole-object match: the column is
   * jsonb so a future connector can remember more than one thing about an item
   * (a Graph id, an IMAP UIDVALIDITY pair) without another migration, and the
   * expression index in 0025 matches this exact extraction.
   *
   * A blank href never matches. `{}` on a row means "not recorded" — every row
   * written before 0025 — and treating that as "the item whose href is the empty
   * string" would attach a removal report to an arbitrary old row.
   */
  async findBySourceRef(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    sourceRef: string,
  ): Promise<LedgerRecord | undefined> {
    if (sourceRef === '') return undefined;
    const result = await this.db
      .select()
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          sql`${schemaPg.item.sourceRef} ->> 'href' = ${sourceRef}`,
        ),
      )
      .limit(1);
    return result.length === 0 ? undefined : this.mapRowToRecord(result[0]!);
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
        collection: record.collection ?? '',
        naturalKey: '', // Will be set by caller if needed
        naturalKeyHash: record.naturalKeyHash,
        contentHash: record.contentHash,
        sizeBytes: record.sizeBytes !== undefined ? BigInt(record.sizeBytes) : null,
        status: record.status ?? 'copied',
        targetRef: JSON.stringify({ id: record.targetId }),
        sourceVersion: record.sourceVersion ?? null,
        targetVersion: record.targetVersion ?? null,
        // The source's own handle, so a later removal report can be matched back
        // to this item. `{}` when the source has none — the column is NOT NULL.
        ...(record.sourceRef !== undefined
          ? { sourceRef: JSON.stringify({ href: record.sourceRef }) }
          : {}),
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
        // Conditional for the same reason `collection` is below: a caller may
        // legitimately have nothing to say (a server that returns no ETag on
        // PUT), and blanking what we already knew would quietly retire the
        // item's overwrite protection.
        ...(record.targetVersion !== undefined ? { targetVersion: record.targetVersion } : {}),
        // Conditional, unlike `sourceVersion` above, because the column is NOT
        // NULL: the fallback is `''`, which the ledger reads as "never
        // recorded". Writing that whenever a caller happened not to supply one
        // would erase a collection we already knew and make the item's next
        // move undetectable. A caller that knows says so; one that does not
        // leaves the row alone.
        ...(record.collection !== undefined ? { collection: record.collection } : {}),
        // Conditional for the same reason: the column is NOT NULL with a `{}`
        // default that means "not recorded", so blanking it whenever a caller
        // had nothing to say would retire the item's removal-report link.
        ...(record.sourceRef !== undefined
          ? { sourceRef: JSON.stringify({ href: record.sourceRef }) }
          : {}),
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
        collection: record.collection ?? '',
        naturalKey: '',
        naturalKeyHash: record.naturalKeyHash,
        contentHash: record.contentHash,
        sizeBytes: record.sizeBytes !== undefined ? BigInt(record.sizeBytes) : null,
        status: 'failed',
        targetRef: JSON.stringify({ id: record.targetId }),
        sourceVersion: record.sourceVersion ?? null,
        // No `target_version`, deliberately, and for the same reason this path
        // leaves content_hash alone on an existing row: a failed attempt wrote
        // nothing, so there is no version of ours on the target to remember.
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

  async placedItems(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<Array<{ naturalKeyHash: string; contentHash: string; collection: string }>> {
    const rows = await this.db
      .select({
        naturalKeyHash: schemaPg.item.naturalKeyHash,
        contentHash: schemaPg.item.contentHash,
        collection: schemaPg.item.collection,
        movedToCollection: schemaPg.item.movedToCollection,
        moveAcknowledgedAt: schemaPg.item.moveAcknowledgedAt,
        absentPasses: schemaPg.item.absentPasses,
        deletionAcknowledgedAt: schemaPg.item.deletionAcknowledgedAt,
      })
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          // Only items we actually placed. A `failed` row is not on the target,
          // so its absence from a later listing says nothing about a move.
          ne(schemaPg.item.status, 'failed'),
          ne(schemaPg.item.status, 'left_behind'),
          // `''` is "collection never recorded", which is every row written
          // before the column was populated. Such a row cannot say where the
          // item came from, so it can neither move nor go missing as far as
          // this query is concerned — and including it would report a whole
          // legacy corpus as vanished on the first full scan after upgrading.
          ne(schemaPg.item.collection, ''),
        ),
      );
    return rows.map((r) => ({
      naturalKeyHash: r.naturalKeyHash,
      contentHash: r.contentHash ?? '',
      collection: r.collection,
      ...(r.movedToCollection ? { movedToCollection: r.movedToCollection } : {}),
      ...(r.moveAcknowledgedAt
        ? {
            moveAcknowledgedAt:
              r.moveAcknowledgedAt instanceof Date
                ? r.moveAcknowledgedAt.toISOString()
                : String(r.moveAcknowledgedAt),
          }
        : {}),
      absentPasses: r.absentPasses,
      ...(r.deletionAcknowledgedAt
        ? {
            deletionAcknowledgedAt:
              r.deletionAcknowledgedAt instanceof Date
                ? r.deletionAcknowledgedAt.toISOString()
                : String(r.deletionAcknowledgedAt),
          }
        : {}),
    }));
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

  async recordMove(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    naturalKeyHash: string,
    toCollection: string,
  ): Promise<void> {
    await this.db
      .update(schemaPg.item)
      .set({
        movedToCollection: toCollection,
        // Cleared only when the DESTINATION changed. A pass re-observing a move
        // somebody has already closed must not reopen it — that would make the
        // queue impossible to empty, and a queue that never empties is one
        // people stop reading. But a move to somewhere NEW is a new
        // arrangement, and consent to the old one says nothing about it.
        moveAcknowledgedAt: sql`CASE WHEN ${schemaPg.item.movedToCollection} IS DISTINCT FROM ${toCollection}
          THEN NULL ELSE ${schemaPg.item.moveAcknowledgedAt} END`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
        ),
      );
  }

  async clearMove(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    naturalKeyHash: string,
  ): Promise<void> {
    await this.db
      .update(schemaPg.item)
      .set({
        movedToCollection: null,
        // Goes with it. There is no longer anything to have agreed to, and a
        // stale acknowledgement would quietly suppress the NEXT move to the
        // same place.
        moveAcknowledgedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
        ),
      );
  }

  async listMoves(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<ItemMove[]> {
    const rows = await this.db
      .select({
        domain: schemaPg.item.domain,
        naturalKeyHash: schemaPg.item.naturalKeyHash,
        collection: schemaPg.item.collection,
        movedToCollection: schemaPg.item.movedToCollection,
        moveAcknowledgedAt: schemaPg.item.moveAcknowledgedAt,
      })
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          isNotNull(schemaPg.item.movedToCollection),
          ...(domain ? [eq(schemaPg.item.domain, domain)] : []),
        ),
      )
      // Open ones first: those are the ones somebody still has to look at.
      //
      // NULLS FIRST spelled out, because Postgres does the opposite by default
      // — ASC means NULLS LAST — so a bare ORDER BY put every already-decided
      // move at the top of the queue and buried the ones needing attention
      // underneath. The in-memory fake sorted the way the comment claimed, so
      // only the real database disagreed, which is how this was found.
      //
      // Then by natural key, so a list an operator is working through does not
      // reshuffle between reads.
      .orderBy(
        sql`${schemaPg.item.moveAcknowledgedAt} ASC NULLS FIRST, ${schemaPg.item.naturalKeyHash} ASC`,
      );

    return rows.map((r) => ({
      domain: r.domain as ItemMove['domain'],
      naturalKeyHash: r.naturalKeyHash,
      from: r.collection,
      to: r.movedToCollection ?? '',
      ...(r.moveAcknowledgedAt
        ? {
            acknowledgedAt:
              r.moveAcknowledgedAt instanceof Date
                ? r.moveAcknowledgedAt.toISOString()
                : String(r.moveAcknowledgedAt),
          }
        : {}),
    }));
  }

  async resolveMove(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: MoveAction,
  ): Promise<boolean> {
    // Only 'keep' exists, and it is deliberately inert on both sides: it
    // records that a person looked. Making the target match the source means
    // removing the copy from where it currently sits, which hard rule 2
    // forbids outright without its own explicitly destructive path.
    if (action !== 'keep') return false;

    const rows = await this.db
      .update(schemaPg.item)
      .set({ moveAcknowledgedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
          isNotNull(schemaPg.item.movedToCollection),
          // OPEN only. Re-stamping an already-decided move would report a
          // decision that did not happen and move its audit date forward.
          isNull(schemaPg.item.moveAcknowledgedAt),
        ),
      )
      .returning();

    return rows.length > 0;
  }

  async recordAbsent(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    naturalKeyHash: string,
  ): Promise<number> {
    const rows = await this.db
      .update(schemaPg.item)
      .set({ absentPasses: sql`${schemaPg.item.absentPasses} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
        ),
      )
      .returning({ absentPasses: schemaPg.item.absentPasses });
    return rows[0]?.absentPasses ?? 0;
  }

  async clearAbsent(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    naturalKeyHash: string,
  ): Promise<void> {
    await this.db
      .update(schemaPg.item)
      .set({
        absentPasses: 0,
        // The decision goes with the count. There is no longer anything to have
        // agreed to, and a stale acknowledgement would silently suppress the
        // report the NEXT time this item disappears.
        deletionAcknowledgedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.domain, domain),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
          // Only rows that actually have a count. On a healthy corpus this is
          // none of them, and the partial index makes the no-op free rather
          // than an UPDATE per item per pass.
          gt(schemaPg.item.absentPasses, 0),
        ),
      );
  }

  async listDeletions(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<ItemDeletion[]> {
    const rows = await this.db
      .select({
        domain: schemaPg.item.domain,
        naturalKeyHash: schemaPg.item.naturalKeyHash,
        collection: schemaPg.item.collection,
        absentPasses: schemaPg.item.absentPasses,
        deletionAcknowledgedAt: schemaPg.item.deletionAcknowledgedAt,
      })
      .from(schemaPg.item)
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          gt(schemaPg.item.absentPasses, 0),
          ...(domain ? [eq(schemaPg.item.domain, domain)] : []),
        ),
      )
      // Open first, then the ones missing longest — NULLS FIRST spelled out
      // because Postgres reads ASC as NULLS LAST, which would bury everything
      // still needing a decision under everything already decided (0022 shipped
      // that bug and only the real database noticed).
      .orderBy(
        sql`${schemaPg.item.deletionAcknowledgedAt} ASC NULLS FIRST, ${schemaPg.item.absentPasses} DESC, ${schemaPg.item.naturalKeyHash} ASC`,
      );

    return rows.map((r) => ({
      domain: r.domain as ItemDeletion['domain'],
      naturalKeyHash: r.naturalKeyHash,
      collection: r.collection,
      absentPasses: r.absentPasses,
      confirmed: r.absentPasses >= DELETION_CONFIRMATIONS,
      ...(r.deletionAcknowledgedAt
        ? {
            acknowledgedAt:
              r.deletionAcknowledgedAt instanceof Date
                ? r.deletionAcknowledgedAt.toISOString()
                : String(r.deletionAcknowledgedAt),
          }
        : {}),
    }));
  }

  async resolveDeletion(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: DeletionAction,
  ): Promise<boolean> {
    // Only 'keep' exists, and it is inert on both sides: it records that a
    // person looked. Removing the target's copy is the first destructive thing
    // this product would do and needs its own path.
    if (action !== 'keep') return false;

    const rows = await this.db
      .update(schemaPg.item)
      .set({ deletionAcknowledgedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(schemaPg.item.tenantId, tenantId),
          eq(schemaPg.item.mappingId, mappingId),
          eq(schemaPg.item.naturalKeyHash, naturalKeyHash),
          // CONFIRMED only. An absence seen once is being watched, not
          // reported, so there is nothing for anyone to have decided about yet
          // — and letting it be closed early would retire the very check that
          // makes the claim trustworthy.
          gte(schemaPg.item.absentPasses, DELETION_CONFIRMATIONS),
          isNull(schemaPg.item.deletionAcknowledgedAt),
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
      // Same treatment, and it matters more here: an absent target version
      // means "we cannot tell whether this copy is still ours", which the
      // writers read as "do not block the write". Mapping NULL to '' would
      // instead assert an ETag no server ever sent.
      ...(row.targetVersion !== null && row.targetVersion !== undefined
        ? { targetVersion: row.targetVersion }
        : {}),
      ...(row.collection ? { collection: row.collection } : {}),
      // Left off entirely when the jsonb has no href, so "not recorded" stays
      // distinguishable from "recorded as empty".
      ...((row.sourceRef as { href?: string } | null)?.href
        ? { sourceRef: (row.sourceRef as { href: string }).href }
        : {}),
      ...(row.movedToCollection ? { movedToCollection: row.movedToCollection } : {}),
      ...(row.moveAcknowledgedAt
        ? {
            moveAcknowledgedAt:
              row.moveAcknowledgedAt instanceof Date
                ? row.moveAcknowledgedAt.toISOString()
                : String(row.moveAcknowledgedAt),
          }
        : {}),
      // NOT NULL with a default, so mapped unconditionally — same as
      // attemptCount. `find` was the only reader left without it, which made
      // the row look like it had never gone missing however many times it had.
      absentPasses: row.absentPasses,
      ...(row.deletionAcknowledgedAt
        ? {
            deletionAcknowledgedAt:
              row.deletionAcknowledgedAt instanceof Date
                ? row.deletionAcknowledgedAt.toISOString()
                : String(row.deletionAcknowledgedAt),
          }
        : {}),
      attemptCount: row.attemptCount,
      ...(row.lastError !== null && row.lastError !== undefined
        ? { lastError: row.lastError }
        : {}),
    };
  }
}
