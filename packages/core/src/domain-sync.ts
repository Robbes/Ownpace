// Copyright 2026 OpenHands Agent (Apache-2.0)
/**
 * Generalized domain sync loop - mirrors the proven reconcile.ts pattern.
 * 
 * This is NOT a generic item type abstraction. Each wrapper operates on REAL
 * domain-typed sources/targets (CalendarSource/CalendarTargetWriter, etc.).
 * The abstraction is at the function level, parameterizing the loop with
 * domain-specific injected functions.
 */

import {
  mapWithConcurrency,
  type Ledger,
  type CursorStore,
  type UpsertResult,
  type TenantId,
  type MappingId,
} from '@openmig/shared';
import { log, isLevelEnabled, type PassMetrics } from '@openmig/shared';

export type { PassMetrics };

/**
 * Items processed in parallel per collection.
 *
 * See the note on `DEFAULT_CONCURRENCY` in `reconcile.ts`: 8 made a ~500-item
 * run rate-limit itself into failures against Stalwart. Kept at 4, the value
 * that has actually completed runs; raise it per mapping or per domain in the
 * config for a target known to tolerate more.
 */
const DEFAULT_CONCURRENCY = 4;

/**
 * Wall-clock breakdown of one domain pass.
 *
 * ALWAYS COLLECTED, printed only at LOG_LEVEL=debug. It was collected only at
 * debug when it was purely a diagnostic; telemetry changed that — §19 wants
 * throughput on a dashboard, and a number that exists only when someone has
 * already suspected a problem is not a dashboard, it is a debugger.
 *
 * The cost of collecting is two `performance.now()` calls per phase per item:
 * tens of nanoseconds against per-item work measured in hundreds of
 * MILLIseconds. Measured on a real corpus that is ~16 microseconds across 1582
 * files. Gating it was over-cautious.
 *
 * Three rounds of reasoning from run logs produced two confident wrong answers
 * about where the file domain's time goes (a container-network theory and an
 * eager-decode theory, both measured and both dead). The logs cannot settle it
 * because they report only the total.
 *
 * A CPU profile would not settle it either: if the time is spent AWAITING a
 * socket, `--cpu-prof` shows an idle process. What is needed is wall time per
 * phase, plus one derived number:
 *
 *   overlap = (sum of all phases) / (domain wall time)
 *
 * With `concurrency: 4`, overlap should approach 4. If it comes back near 1,
 * the pass is effectively serial no matter what the pool says, and THAT is the
 * bug — not any individual phase being slow.
 *
 * Costs one level check per domain pass when debug is off, so a production run
 * pays nothing. This used to be its own OPENMIG_PHASE_TIMING env var — a
 * bespoke switch invented because there was no level to hang it on. Now there
 * is one, and a second mechanism for "show me more" is worse than none.
 */
interface PhaseTiming {
  fetchMs: number;
  upsertMs: number;
  ledgerReadMs: number;
  ledgerWriteMs: number;
  hashMs: number;
  startedAt: number;
}

function startPhaseTiming(): PhaseTiming {
  return { fetchMs: 0, upsertMs: 0, ledgerReadMs: 0, ledgerWriteMs: 0, hashMs: 0, startedAt: Date.now() };
}

/** Time `fn` into `bucket` when timing is on; call it untouched when off. */
async function timed<T>(
  phases: PhaseTiming,
  bucket: 'fetchMs' | 'upsertMs' | 'ledgerReadMs' | 'ledgerWriteMs' | 'hashMs',
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    phases[bucket] += performance.now() - t0;
  }
}

function summarise(phases: PhaseTiming, scanned: number): PassMetrics {
  const wallMs = Math.max(Date.now() - phases.startedAt, 1);
  const busy =
    phases.fetchMs + phases.upsertMs + phases.ledgerReadMs + phases.ledgerWriteMs + phases.hashMs;
  return {
    items: scanned,
    wallMs,
    sourceFetchMs: phases.fetchMs,
    targetWriteMs: phases.upsertMs,
    ledgerMs: phases.ledgerReadMs + phases.ledgerWriteMs,
    hashMs: phases.hashMs,
    overlap: busy / wallMs,
  };
}

function reportPhases(phases: PhaseTiming, domain: string, scanned: number): void {
  if (!isLevelEnabled('debug')) return;
  const wallMs = Date.now() - phases.startedAt;
  const busy = phases.fetchMs + phases.upsertMs + phases.ledgerReadMs + phases.ledgerWriteMs + phases.hashMs;
  const per = (ms: number) => (scanned ? (ms / scanned).toFixed(1) : '0');
  log.debug(
    `[timing] ${domain}: ${scanned} items in ${(wallMs / 1000).toFixed(1)}s | ` +
      `source-fetch ${(phases.fetchMs / 1000).toFixed(1)}s (${per(phases.fetchMs)}ms/item) | ` +
      `target-write ${(phases.upsertMs / 1000).toFixed(1)}s (${per(phases.upsertMs)}ms/item) | ` +
      `ledger-read ${(phases.ledgerReadMs / 1000).toFixed(1)}s | ` +
      `ledger-write ${(phases.ledgerWriteMs / 1000).toFixed(1)}s | ` +
      `hash ${(phases.hashMs / 1000).toFixed(1)}s | ` +
      // The number that matters most: how much work was actually in flight at
      // once. Near `concurrency` means the pool is working and some phase is
      // genuinely slow; near 1 means we are serial and the pool is a lie.
      `overlap ${(busy / Math.max(wallMs, 1)).toFixed(2)}x`,
  );
}

/** Minimal folder interface - all domain folders have at least a path. */
export interface FolderLike {
  readonly path?: string;
  readonly name?: string;
}

/**
 * Dependency bundle for a domain sync operation.
 * Domain-specific functions are injected to keep the loop generic.
 */
export interface DomainSyncDeps<Source, Target, Item, Folder extends FolderLike = FolderLike> {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: 'email' | 'calendar' | 'contact' | 'file';
  readonly source: Source;
  readonly target: Target;
  readonly ledger: Ledger;
  readonly cursors?: CursorStore;
  readonly concurrency?: number;
  /** List folders on the source */
  readonly listFolders: () => Promise<ReadonlyArray<Folder>>;
  /** List items in a folder since a cursor */
  readonly listSince: (folder: Folder, cursor?: { readonly value: string }) => Promise<{ items: ReadonlyArray<Item>; nextCursor: { readonly value: string } }>;
  /** Fetch raw data for an item */
  readonly fetchRaw: (item: Item) => Promise<{ raw: unknown; sizeBytes: number }>;
  /** Upsert item on target */
  readonly upsert: (targetId: string, raw: unknown, ...args: unknown[]) => Promise<UpsertResult>;
  /** Extract natural key from item */
  /**
   * The item's natural-key hash, or undefined when it cannot be known from the
   * listing alone — mail with no Message-ID, whose key has to be derived from
   * the body. Those items fall through to `naturalKeyFromRaw` after the fetch.
   */
  readonly naturalKey: (item: Item) => string | undefined;
  /**
   * Derive the natural-key hash once the raw item is in hand. Required if
   * `naturalKey` can return undefined.
   *
   * Costs those items the pre-fetch ledger fast-path — their key IS their
   * content, so it cannot be known before reading them — but NOT idempotency:
   * the ledger is checked again with the derived key before anything is
   * written, so a re-run re-reads the message and still creates nothing.
   */
  readonly naturalKeyFromRaw?: (item: Item, raw: unknown) => string;
  /** Compute content hash from raw data */
  readonly contentHash: (raw: unknown) => string;
  /**
   * What to do when the target already holds an item under our natural key.
   * `'skip'` (default) adopts it; `'fail'` aborts this domain's pass.
   *
   * Enforced HERE rather than in each writer: this is the one place that
   * already learns the outcome of every upsert, so all four domains get the
   * same behaviour from one implementation instead of five.
   */
  readonly onCollision?: 'skip' | 'fail';
  /** Ensure target collection exists */
  readonly ensureCollection: (folder: Folder) => Promise<string>;
}

/** Summary of a domain sync pass. */
export interface DomainSyncResult {
  readonly scanned: number;
  readonly created: number;
  /** Not created because OUR LEDGER already had the item. */
  readonly skipped: number;
  /**
   * Not created because the TARGET already had it under our natural key —
   * i.e. the destination account was not empty and we left those items alone.
   * Non-destructive by design (hard rule 2), but a fact the operator has to see
   * before cutover, which is why it is counted apart from `skipped`.
   */
  readonly adopted: number;
  readonly failed: number;
  /** Source items absent on a later pass (potential deletions). */
  readonly drift: number;
  /**
   * Where this pass's wall time went. Always present — the caller persists it
   * for §19's dashboards and feeds it to the metrics registry.
   */
  readonly metrics?: PassMetrics;
}

/**
 * Generalized domain sync loop - mirrors the proven reconcile.ts pattern.
 * 
 * Idempotent (run twice -> second pass creates 0) and non-destructive (never deletes
 * or overwrites on the target). Anchored on natural key via ledger fast-path.
 * 
 * Throughput/memory: folders run sequentially; within a folder, items processed with
 * BOUNDED CONCURRENCY. Cursor persisted ONLY AFTER folder fully succeeds.
 */
export async function runDomainSync<Source, Target, Item, Folder extends FolderLike>(
  deps: DomainSyncDeps<Source, Target, Item, Folder>
): Promise<DomainSyncResult> {
  const {
    tenantId,
    mappingId,
    domain,
    ledger,
    cursors,
    concurrency = DEFAULT_CONCURRENCY,
    listFolders,
    listSince,
    fetchRaw,
    upsert,
    naturalKey,
    naturalKeyFromRaw,
    contentHash,
    onCollision,
    ensureCollection,
  } = deps;

  const phases = startPhaseTiming();

  let scanned = 0;
  let created = 0;
  let skipped = 0;
  // Items the target ALREADY had under our natural key, which we therefore did
  // not write. Counted apart from `skipped` (our own ledger already had them):
  // both mean "not created", but only one of them means the destination account
  // was not empty, and that is a fact the operator needs before cutover.
  let adopted = 0;
  let failed = 0;

  const folders = await listFolders();
  
  for (const folder of folders) {
    const collectionId = await ensureCollection(folder);
    const prev = cursors ? await cursors.get(tenantId, mappingId, folder.path ?? folder.name ?? '') : undefined;
    const { items, nextCursor } = await listSince(folder, prev);

    await mapWithConcurrency(items, concurrency, async (item) => {
      scanned += 1;
      let naturalKeyHash = naturalKey(item);

      // Ledger fast-path: already migrated -> skip without fetching.
      if (naturalKeyHash !== undefined) {
        // Captured so the closure keeps the narrowing from the guard above.
        const key = naturalKeyHash;
        const known = await timed(phases, 'ledgerReadMs', () =>
          ledger.find(tenantId, mappingId, domain, key),
        );
        if (known) {
          skipped += 1;
          return;
        }
      }

      // Fetch raw data
      const { raw, sizeBytes } = await timed(phases, 'fetchMs', () => fetchRaw(item));

      if (naturalKeyHash === undefined) {
        // The key could not be known from the listing, so derive it now. Mail
        // with no Message-ID is keyed by a hash of its own bytes; that is only
        // available once the message has been read.
        if (!naturalKeyFromRaw) {
          throw new Error(
            `naturalKey returned undefined for a ${domain} item but no naturalKeyFromRaw was ` +
              `supplied; refusing to write an item with no idempotency anchor.`,
          );
        }
        naturalKeyHash = naturalKeyFromRaw(item, raw);

        // Second fast-path check, now that we have a key. This is what keeps
        // these items idempotent: a re-run pays the fetch again (unavoidable —
        // the key is the content) but must not create a duplicate.
        const derivedKey = naturalKeyHash;
        const knownAfterFetch = await timed(phases, 'ledgerReadMs', () =>
          ledger.find(tenantId, mappingId, domain, derivedKey),
        );
        if (knownAfterFetch) {
          skipped += 1;
          return;
        }
      }

      // Hashed AFTER any key derivation, so for a message we rewrote this is
      // the hash of the bytes we will actually write. The target stores what we
      // wrote, and §20 checksum sampling compares against it.
      const hashStart = phases ? performance.now() : 0;
      const ch = contentHash(raw);
      if (phases) phases.hashMs += performance.now() - hashStart;

      try {
        // Upsert on target (pass item for domain-specific metadata like keywords)
        const result = await timed(phases, 'upsertMs', () => upsert(collectionId, raw, item));

        // Record in ledger with honest status
        await timed(phases, 'ledgerWriteMs', () => ledger.recordIfAbsent({
          tenantId,
          itemType: domain,
          mappingId,
          naturalKeyHash,
          contentHash: ch,
          targetId: result.targetId,
          createdAt: new Date().toISOString(),
          sizeBytes,
          status: result.created ? 'copied' : result.adopted ? 'adopted' : 'updated',
        }));

        if (result.created) created += 1;
        else if (result.adopted) {
          adopted += 1;
          if (onCollision === 'fail') {
            // Thrown after the ledger row is written, so the item that stopped
            // the pass is identifiable afterwards rather than merely counted.
            throw new Error(
              `Collision on the destination for a ${domain} item, and onCollision is 'fail': ` +
                'the target already holds an item under this natural key. Re-run with ' +
                "onCollision: 'skip' to keep the destination's copy.",
            );
          }
        } else skipped += 1;
      } catch (err) {
        // Record failure - DO NOT swallow
        failed += 1;
        const error = err as Error;
        
        // Record failed item in ledger
        await ledger.recordIfAbsent({
          tenantId,
          itemType: domain,
          mappingId,
          naturalKeyHash,
          contentHash: ch,
          targetId: '',
          createdAt: new Date().toISOString(),
          sizeBytes: 0,
          status: 'failed',
        });

        // Re-throw to surface the error
        throw error;
      }
    });

    // Persist cursor only after folder fully succeeded
    if (cursors) {
      await cursors.set(
        tenantId,
        mappingId,
        (folder as { path?: string; name?: string }).path ?? (folder as { name?: string }).name ?? '',
        nextCursor
      );
    }
  }

  reportPhases(phases, domain, scanned);

  return { scanned, created, skipped, adopted, failed, drift: 0, metrics: summarise(phases, scanned) };
}
