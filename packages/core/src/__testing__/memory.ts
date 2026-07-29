import type {
  CursorStore,
  FailureAction,
  ItemFailure,
  ItemMove,
  ItemDeletion,
  DeletionAction,
  Ledger,
  LedgerRecord,
  MailFolder,
  MoveAction,
  MailItem,
  MailKeyword,
  RawMessage,
  SourceConnector,
  SyncCursor,
  TargetEntry,
  TargetReindexer,
  TargetWriter,
  UpsertResult,
} from '@openmig/shared';
import { readMessageId, MAX_ITEM_ATTEMPTS, DELETION_CONFIRMATIONS } from '@openmig/shared';

/** Seed shape for {@link MemorySource}. */
export interface SeedMessage {
  readonly folderPath: string;
  readonly messageId: string;
  readonly rfc822: string;
  readonly keywords?: ReadonlyArray<MailKeyword>;
}

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${(idCounter += 1)}`;

/** In-memory, read-only source connector. */
export class MemorySource implements SourceConnector {
  private readonly byFolder = new Map<string, MailItem[]>();
  private readonly raw = new Map<string, Uint8Array>();
  private readonly folders = new Map<string, MailFolder>();
  /** Stands in for the IMAP UID: unique per message, independent of Message-ID. */
  private nextSeq = 1;

  add(seed: SeedMessage): void {
    const specialUse: MailFolder['specialUse'] =
      seed.folderPath.toUpperCase() === 'INBOX'
        ? 'inbox'
        : seed.folderPath.toLowerCase() === 'sent'
          ? 'sent'
          : 'normal';
    const folder: MailFolder = this.folders.get(seed.folderPath) ?? {
      path: seed.folderPath,
      specialUse,
    };
    this.folders.set(seed.folderPath, folder);

    // Unique per added message, mirroring the real IMAP source, whose
    // sourceRef is `${folder.path}:${uid}`. Keying it by messageId instead
    // collides for messages that arrive WITHOUT one (they all share ''), so the
    // second would silently overwrite the first's bytes — the double would then
    // "prove" a deduplication that the real source never performs.
    const sourceRef = `${seed.folderPath}:${this.nextSeq++}`;
    const item: MailItem = {
      messageId: seed.messageId,
      folder,
      keywords: seed.keywords ?? [],
      receivedAt: new Date(0).toISOString(),
      sourceRef,
    };
    const list = this.byFolder.get(seed.folderPath) ?? [];
    list.push(item);
    this.byFolder.set(seed.folderPath, list);
    this.raw.set(sourceRef, new TextEncoder().encode(seed.rfc822));
  }

  listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return Promise.resolve([...this.folders.values()]);
  }

  listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor }> {
    const all = this.byFolder.get(folder.path) ?? [];
    // Cursor = "items already seen" offset; malformed/absent -> full scan (non-authoritative, ADR-0020).
    const start = cursor ? Math.max(0, Number(cursor.value) || 0) : 0;
    return Promise.resolve({ items: all.slice(start), nextCursor: { value: String(all.length) } });
  }

  fetch(item: MailItem): Promise<RawMessage> {
    const bytes = this.raw.get(item.sourceRef);
    if (!bytes) throw new Error(`MemorySource: no bytes for ${item.sourceRef}`);
    return Promise.resolve({ item, rfc822: bytes });
  }
}

interface StoredEmail {
  readonly targetId: string;
  readonly mailboxId: string;
  readonly messageId: string;
  readonly keywords: ReadonlyArray<MailKeyword>;
}

/** In-memory create-if-absent target, keyed by (mailboxId, messageId). Also a reindexer. */
export class MemoryTarget implements TargetWriter, TargetReindexer {
  private readonly mailboxes = new Map<string, string>();
  private readonly store = new Map<string, StoredEmail>();

  private key(mailboxId: string, messageId: string): string {
    return `${mailboxId}\u0000${messageId}`;
  }

  ensureMailbox(folder: MailFolder): Promise<string> {
    const existing = this.mailboxes.get(folder.path);
    if (existing) return Promise.resolve(existing);
    const id = nextId('mbox');
    this.mailboxes.set(folder.path, id);
    return Promise.resolve(id);
  }

  upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult> {
    // Keyed off the RFC822 BYTES, exactly as the real writers do
    // (`JmapTargetWriter.extractMessageIdFromRfc822`). Reading
    // `raw.item.messageId` instead would miss a Message-ID the sync generated
    // and wrote into the message, so every such message would collide on the
    // empty string — and this double would "prove" an idempotency the real
    // targets do not have.
    const messageId = readMessageId(raw.rfc822) ?? raw.item.messageId;
    const k = this.key(mailboxId, messageId);
    const existing = this.store.get(k);
    // `adopted: true`, as every real writer reports for this branch. Without it
    // the double could not tell "the target already had it" from "our ledger
    // already had it" — the very distinction under test — and would silently
    // prove that adoptions are counted when they are not.
    if (existing) return Promise.resolve({ targetId: existing.targetId, created: false, adopted: true });
    const targetId = nextId('email');
    this.store.set(k, { targetId, mailboxId, messageId, keywords });
    return Promise.resolve({ targetId, created: true });
  }

  findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined> {
    return Promise.resolve(this.store.get(this.key(mailboxId, naturalKey))?.targetId);
  }

  async *listEntries(_mailboxId?: string): AsyncIterable<TargetEntry> {
    for (const v of this.store.values()) {
      const entry: TargetEntry = { naturalKey: v.messageId, targetId: v.targetId, mailboxId: v.mailboxId };
      yield entry;
    }
  }

  /** Test helper: number of stored messages. */
  size(): number {
    return this.store.size;
  }
}

/** In-memory idempotency ledger. */
export class MemoryLedger implements Ledger {
  private readonly rows = new Map<string, LedgerRecord>();

  private key(r: Pick<LedgerRecord, 'tenantId' | 'mappingId' | 'itemType' | 'naturalKeyHash'>): string {
    return `${r.tenantId}\u0000${r.mappingId}\u0000${r.itemType}\u0000${r.naturalKeyHash}`;
  }

  find(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    itemType: LedgerRecord['itemType'],
    naturalKeyHash: string,
  ): Promise<LedgerRecord | undefined> {
    const row = this.rows.get(this.key({ tenantId, mappingId, itemType, naturalKeyHash }));
    if (!row) return Promise.resolve(undefined);
    // `absent_passes` is NOT NULL DEFAULT 0 in Postgres, so a row always has a
    // number here — never undefined. A fake that answered undefined would let a
    // caller write `row.absentPasses === undefined` and mean "never checked",
    // which is a distinction the real column cannot make.
    return Promise.resolve({ absentPasses: 0, ...row });
  }

  /**
   * Mirrors `PgLedger.findBySourceRef`, INCLUDING refusing a blank href.
   *
   * A fake that matched `''` would pair a removal report with whichever
   * pre-0025 row came first — which is exactly the wrong item, reported as
   * deleted.
   */
  findBySourceRef(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
    sourceRef: string,
  ): Promise<LedgerRecord | undefined> {
    if (sourceRef === '') return Promise.resolve(undefined);
    for (const r of this.rows.values()) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.itemType !== domain) continue;
      if (r.sourceRef !== sourceRef) continue;
      return Promise.resolve(r);
    }
    return Promise.resolve(undefined);
  }

  recordIfAbsent(record: LedgerRecord): Promise<LedgerRecord> {
    const k = this.key(record);
    const existing = this.rows.get(k);
    if (existing) return Promise.resolve(existing);
    this.rows.set(k, record);
    return Promise.resolve(record);
  }

  /**
   * Overwrite an existing row. Throws when there is none — same contract as
   * `PgLedger.recordUpdate`, deliberately: a fake that silently inserted would
   * let a caller bug pass here and fail only against Postgres.
   */
  recordUpdate(record: LedgerRecord): Promise<LedgerRecord> {
    const k = this.key(record);
    if (!this.rows.has(k)) {
      return Promise.reject(
        new Error(
          `recordUpdate found no ${record.itemType} row for naturalKeyHash ${record.naturalKeyHash}`,
        ),
      );
    }
    // createdAt is a fact about the ORIGINAL copy and must survive the update;
    // Postgres keeps it because first_seen_at is simply not in the SET clause.
    //
    // `collection` survives for a different reason: PgLedger sets it only when
    // the caller supplied one, because the column is NOT NULL and blanking it
    // would erase a collection we already knew and make the item's next move
    // undetectable. A fake that dropped it would hide exactly that.
    const existing = this.rows.get(k)!;
    const merged: LedgerRecord = {
      ...record,
      createdAt: existing.createdAt,
      ...(record.collection === undefined && existing.collection !== undefined
        ? { collection: existing.collection }
        : {}),
      // Same conditional survival as `collection`, and for the same reason: a
      // caller with nothing to say must not erase the removal-report link.
      ...(record.sourceRef === undefined && existing.sourceRef !== undefined
        ? { sourceRef: existing.sourceRef }
        : {}),
    };
    this.rows.set(k, merged);
    return Promise.resolve(merged);
  }

  /**
   * Insert-or-update on failure, matching `PgLedger.recordFailure`.
   *
   * The attempt COUNT is the point: a fake that no-opped on the second failure
   * would let the loop's "park after N attempts" logic look correct while
   * never parking anything.
   */
  recordFailure(record: LedgerRecord, error: string): Promise<LedgerRecord> {
    const k = this.key(record);
    const existing = this.rows.get(k);
    // Mirrors PgLedger's ON CONFLICT set EXACTLY: on an existing row only the
    // status, the attempt count and the error change.
    //
    // Everything else still describes what is actually on the target, and a
    // failed attempt put nothing there. Overwriting `contentHash` with the
    // hash of bytes we failed to write would make §20's checksum sampling
    // compare the target against content it does not hold; overwriting
    // `sourceVersion` would tell the next pass the update had landed.
    const merged: LedgerRecord = existing
      ? {
          ...existing,
          status: 'failed',
          attemptCount: (existing.attemptCount ?? 0) + 1,
          lastError: error,
        }
      : { ...record, status: 'failed', attemptCount: 1, lastError: error };
    this.rows.set(k, merged);
    return Promise.resolve(merged);
  }

  /**
   * Mirrors `PgLedger.placedItems`, INCLUDING both exclusions.
   *
   * A fake that returned `failed` or `left_behind` rows would report an item as
   * "was here last pass" when nothing was ever placed for it, and the move
   * detector would read its disappearance as a move. One that returned rows
   * with no recorded collection would report every pre-upgrade row as vanished.
   */
  placedItems(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
  ): Promise<
    Array<{
      naturalKeyHash: string;
      contentHash: string;
      collection: string;
      movedToCollection?: string;
      moveAcknowledgedAt?: string;
      absentPasses?: number;
      deletionAcknowledgedAt?: string;
    }>
  > {
    const out: Array<{
      naturalKeyHash: string;
      contentHash: string;
      collection: string;
      movedToCollection?: string;
      moveAcknowledgedAt?: string;
      absentPasses?: number;
      deletionAcknowledgedAt?: string;
    }> = [];
    for (const r of this.rows.values()) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.itemType !== domain) continue;
      if (r.status === 'failed' || r.status === 'left_behind') continue;
      if (!r.collection) continue;
      out.push({
        naturalKeyHash: r.naturalKeyHash,
        contentHash: r.contentHash ?? '',
        collection: r.collection,
        ...(r.movedToCollection ? { movedToCollection: r.movedToCollection } : {}),
        ...(r.moveAcknowledgedAt ? { moveAcknowledgedAt: r.moveAcknowledgedAt } : {}),
        ...(r.absentPasses ? { absentPasses: r.absentPasses } : {}),
        ...(r.deletionAcknowledgedAt
          ? { deletionAcknowledgedAt: r.deletionAcknowledgedAt }
          : {}),
      });
    }
    return Promise.resolve(out);
  }

  /**
   * Mirrors `PgLedger.recordMove`, INCLUDING the conditional clear.
   *
   * The condition is the whole behaviour: re-observing a move somebody has
   * already closed must leave the decision standing, or the queue can never be
   * emptied — while a move somewhere NEW must reopen it, because agreeing to
   * one arrangement is not agreeing to every later one. A fake that always
   * cleared, or never did, would prove the opposite of whichever is true.
   */
  recordMove(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
    naturalKeyHash: string,
    toCollection: string,
  ): Promise<void> {
    const k = this.key({ tenantId, mappingId, itemType: domain, naturalKeyHash });
    const existing = this.rows.get(k);
    if (!existing) return Promise.resolve();
    const destinationChanged = existing.movedToCollection !== toCollection;
    this.rows.set(k, {
      ...existing,
      movedToCollection: toCollection,
      ...(destinationChanged
        ? { moveAcknowledgedAt: undefined }
        : existing.moveAcknowledgedAt !== undefined
          ? { moveAcknowledgedAt: existing.moveAcknowledgedAt }
          : {}),
    });
    return Promise.resolve();
  }

  clearMove(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
    naturalKeyHash: string,
  ): Promise<void> {
    const k = this.key({ tenantId, mappingId, itemType: domain, naturalKeyHash });
    const existing = this.rows.get(k);
    if (!existing) return Promise.resolve();
    this.rows.set(k, {
      ...existing,
      movedToCollection: undefined,
      moveAcknowledgedAt: undefined,
    });
    return Promise.resolve();
  }

  listMoves(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain?: LedgerRecord['itemType'],
  ): Promise<ItemMove[]> {
    const out: ItemMove[] = [];
    for (const r of this.rows.values()) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (domain && r.itemType !== domain) continue;
      if (!r.movedToCollection) continue;
      out.push({
        domain: r.itemType,
        naturalKeyHash: r.naturalKeyHash,
        from: r.collection ?? '',
        to: r.movedToCollection,
        ...(r.moveAcknowledgedAt ? { acknowledgedAt: r.moveAcknowledgedAt } : {}),
      });
    }
    // Open first, then by natural key — matching PgLedger's ORDER BY exactly,
    // including the tie-break. When these two disagreed, the fake sorted the
    // way the SQL's COMMENT claimed rather than the way the SQL behaved
    // (Postgres puts NULLs LAST on ASC), so only the real database noticed.
    return Promise.resolve(
      out.sort(
        (a, b) =>
          Number(a.acknowledgedAt !== undefined) - Number(b.acknowledgedAt !== undefined) ||
          a.naturalKeyHash.localeCompare(b.naturalKeyHash),
      ),
    );
  }

  resolveMove(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    naturalKeyHash: string,
    action: MoveAction,
  ): Promise<boolean> {
    if (action !== 'keep') return Promise.resolve(false);
    for (const [k, r] of this.rows) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.naturalKeyHash !== naturalKeyHash) continue;
      // OPEN only, as in Postgres: re-stamping a decided move would report a
      // decision that did not happen.
      if (!r.movedToCollection || r.moveAcknowledgedAt) continue;
      this.rows.set(k, { ...r, moveAcknowledgedAt: new Date().toISOString() });
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  listFailures(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain?: LedgerRecord['itemType'],
  ): Promise<ItemFailure[]> {
    const out: ItemFailure[] = [];
    for (const r of this.rows.values()) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.status !== 'failed') continue;
      if (domain && r.itemType !== domain) continue;
      out.push({
        domain: r.itemType,
        naturalKeyHash: r.naturalKeyHash,
        attempts: r.attemptCount ?? 0,
        lastError: r.lastError ?? '(no error recorded)',
        needsDecision: (r.attemptCount ?? 0) >= MAX_ITEM_ATTEMPTS,
      });
    }
    return Promise.resolve(out);
  }

  resolveFailure(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    naturalKeyHash: string,
    action: FailureAction,
  ): Promise<boolean> {
    for (const [k, r] of this.rows) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.naturalKeyHash !== naturalKeyHash || r.status !== 'failed') continue;
      this.rows.set(
        k,
        action === 'accept' ? { ...r, status: 'left_behind' } : { ...r, attemptCount: 0 },
      );
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  recordAbsent(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
    naturalKeyHash: string,
  ): Promise<number> {
    const k = this.key({ tenantId, mappingId, itemType: domain, naturalKeyHash });
    const existing = this.rows.get(k);
    if (!existing) return Promise.resolve(0);
    const absentPasses = (existing.absentPasses ?? 0) + 1;
    this.rows.set(k, { ...existing, absentPasses });
    return Promise.resolve(absentPasses);
  }

  /**
   * Mirrors `PgLedger.clearAbsent`, INCLUDING dropping the decision.
   *
   * A fake that reset only the count would leave a stale acknowledgement in
   * place, which silently suppresses the report the NEXT time the item goes
   * missing — the one case where the queue most needs to speak up.
   */
  clearAbsent(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain: LedgerRecord['itemType'],
    naturalKeyHash: string,
  ): Promise<void> {
    const k = this.key({ tenantId, mappingId, itemType: domain, naturalKeyHash });
    const existing = this.rows.get(k);
    if (!existing || !existing.absentPasses) return Promise.resolve();
    this.rows.set(k, { ...existing, absentPasses: 0, deletionAcknowledgedAt: undefined });
    return Promise.resolve();
  }

  listDeletions(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    domain?: LedgerRecord['itemType'],
  ): Promise<ItemDeletion[]> {
    const out: ItemDeletion[] = [];
    for (const r of this.rows.values()) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (domain && r.itemType !== domain) continue;
      if (!r.absentPasses) continue;
      out.push({
        domain: r.itemType,
        naturalKeyHash: r.naturalKeyHash,
        collection: r.collection ?? '',
        absentPasses: r.absentPasses,
        confirmed: r.absentPasses >= DELETION_CONFIRMATIONS,
        ...(r.deletionAcknowledgedAt ? { acknowledgedAt: r.deletionAcknowledgedAt } : {}),
      });
    }
    // Open first, then missing longest, then by key — PgLedger's ORDER BY
    // exactly, tie-break included.
    return Promise.resolve(
      out.sort(
        (a, b) =>
          Number(a.acknowledgedAt !== undefined) - Number(b.acknowledgedAt !== undefined) ||
          b.absentPasses - a.absentPasses ||
          a.naturalKeyHash.localeCompare(b.naturalKeyHash),
      ),
    );
  }

  resolveDeletion(
    tenantId: LedgerRecord['tenantId'],
    mappingId: LedgerRecord['mappingId'],
    naturalKeyHash: string,
    action: DeletionAction,
  ): Promise<boolean> {
    if (action !== 'keep') return Promise.resolve(false);
    for (const [k, r] of this.rows) {
      if (r.tenantId !== tenantId || r.mappingId !== mappingId) continue;
      if (r.naturalKeyHash !== naturalKeyHash) continue;
      // CONFIRMED and open only, as in Postgres.
      if ((r.absentPasses ?? 0) < DELETION_CONFIRMATIONS) continue;
      if (r.deletionAcknowledgedAt) continue;
      this.rows.set(k, { ...r, deletionAcknowledgedAt: new Date().toISOString() });
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  /** Test helper: number of rows. */
  size(): number {
    return this.rows.size;
  }

  /** Test helper: wipe the ledger (simulate a fresh reinstall). */
  clear(): void {
    this.rows.clear();
  }
}

/** In-memory per-folder cursor store. */
export class MemoryCursorStore implements CursorStore {
  private readonly m = new Map<string, { readonly value: string }>();

  private key(tenantId: string, mappingId: string, folderPath: string): string {
    return `${tenantId}\u0000${mappingId}\u0000${folderPath}`;
  }

  get(
    tenantId: Parameters<CursorStore['get']>[0],
    mappingId: Parameters<CursorStore['get']>[1],
    folderPath: string,
  ): ReturnType<CursorStore['get']> {
    return Promise.resolve(this.m.get(this.key(tenantId, mappingId, folderPath)));
  }

  set(
    tenantId: Parameters<CursorStore['set']>[0],
    mappingId: Parameters<CursorStore['set']>[1],
    folderPath: string,
    cursor: { readonly value: string },
  ): Promise<void> {
    this.m.set(this.key(tenantId, mappingId, folderPath), cursor);
    return Promise.resolve();
  }

  /**
   * Drop cursors. Scoped to a mapping when told which — the operator RETRY
   * path — and everything when not, which is the older test helper for
   * simulating a lost cursor store.
   */
  clear(tenantId?: string, mappingId?: string): Promise<void> {
    if (tenantId === undefined || mappingId === undefined) {
      this.m.clear();
      return Promise.resolve();
    }
    const prefix = `${tenantId}\u0000${mappingId}\u0000`;
    for (const k of [...this.m.keys()]) {
      if (k.startsWith(prefix)) this.m.delete(k);
    }
    return Promise.resolve();
  }
}
