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
  MAX_ITEM_ATTEMPTS,
  type Ledger,
  type LedgerRecord,
  type ItemFailure,
  type CursorStore,
  type UpsertResult,
  type UpsertOptions,
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
 * Consecutive item failures that stop the pass.
 *
 * Per-item isolation must not become "grind through 50 000 items with an
 * expired token". A systemic fault fails everything identically, so a run of
 * failures with no success between them is the cheapest available signal that
 * the problem is the connection, not the items — and stopping keeps the
 * failure queue readable and the ledger clean.
 *
 * 25 is comfortably above any plausible cluster of genuinely bad items in a
 * healthy corpus, and small enough that a dead target costs seconds rather
 * than the whole pass.
 */
const ABORT_AFTER_CONSECUTIVE_FAILURES = 25;

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

/**
 * A stop the loop asked for, as opposed to an item that failed.
 *
 * Per-item isolation catches everything a single item can throw, which would
 * otherwise also swallow the two deliberate aborts: the `onCollision: 'fail'`
 * policy, and the systemic-failure tripwire. Both mean "end this pass", and
 * both would silently become a failure counter without a way to tell them
 * apart from a bad item.
 */
export class PassAbortError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PassAbortError';
  }
}

/** Minimal folder interface - all domain folders have at least a path. */
export interface FolderLike {
  readonly path?: string;
  readonly name?: string;
}

/** What to do about an item the ledger already has. See `classifyKnownItem`. */
export type KnownItemAction =
  /** Nothing to do — the copy is current, or we cannot tell that it isn't. */
  | 'skip'
  /** Unchanged, but the ledger had no version yet; store one for next time. */
  | 'record-version'
  /** The source changed and we own the target copy: rewrite it. */
  | 'rewrite'
  /** The source changed but the target copy is the CUSTOMER'S: leave it. */
  | 'leave-adopted'
  /** A previous attempt failed and it is still worth trying again. */
  | 'retry-failed'
  /** Attempts are exhausted; it is waiting on an owner decision. */
  | 'needs-decision'
  /** The owner decided to migrate without it. Terminal. */
  | 'left-behind';

/**
 * Decide what a later pass owes an item the ledger already knows.
 *
 * Split out and exported because this is the whole safety argument for update
 * propagation, and it is worth being able to test directly rather than through
 * a live DAV server. Hard rule 2 says never auto-overwrite on the target; §11.1
 * says the source is authoritative for content. Both are true, and the line
 * between them runs exactly here.
 *
 * The rules, in the order they are applied:
 *
 * 1. **No source version → skip.** A source that reports no version (mail:
 *    messages are immutable, so there is nothing to report) gets exactly the
 *    behaviour it had before this existed. Never guess at change.
 * 2. **No recorded version → record it, do not rewrite.** Every row written
 *    before migration 0020 is in this state. Rewriting them would re-copy an
 *    entire corpus on first upgrade to prove nothing; instead the version is
 *    recorded so the NEXT change is caught.
 * 3. **Versions equal → skip.** The common case, and the one that keeps a
 *    steady-state pass cheap: no fetch, no write.
 * 4. **Versions differ, and the item was ADOPTED → leave it.** Adopted means
 *    the destination already held this item and we never wrote it. Those bytes
 *    are the customer's, not ours, and hard rule 2 is absolute about them. The
 *    caller counts these so they are visible rather than silent.
 * 5. **Versions differ, and we copied it → rewrite.** The only case that
 *    overwrites anything, and it only ever overwrites bytes this tool put
 *    there itself.
 *
 * Ahead of all of those sit the states where the item was never copied at all
 * — `failed` and `left_behind` — because for those the version question does
 * not arise. See the top of the function.
 */
export function classifyKnownItem(
  known: Pick<LedgerRecord, 'sourceVersion' | 'status' | 'attemptCount'>,
  sourceVersion: string | undefined,
): KnownItemAction {
  // FAILURE STATES FIRST. A row is not proof the item was migrated — it is only
  // proof we have seen the item, and these three states mean we have NOT copied
  // it. Treating them as "already done" is what made a failed item permanently
  // invisible: it was recorded `failed`, and every later pass found the row on
  // the fast-path and skipped it, so the item was never retried and never
  // reported. Silent data loss with a green count next to it.
  if (known.status === 'left_behind') return 'left-behind';
  if (known.status === 'failed') {
    return (known.attemptCount ?? 0) >= MAX_ITEM_ATTEMPTS ? 'needs-decision' : 'retry-failed';
  }

  if (sourceVersion === undefined) return 'skip';
  if (known.sourceVersion === undefined) return 'record-version';
  if (known.sourceVersion === sourceVersion) return 'skip';
  if (known.status === 'adopted') return 'leave-adopted';
  return 'rewrite';
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
  /**
   * Upsert item on target.
   *
   * `options.overwrite` is set ONLY on the update path, and the writers must
   * treat it as the sole licence to rewrite an item they already hold — see
   * `classifyKnownItem` for who is eligible.
   */
  readonly upsert: (
    targetId: string,
    raw: unknown,
    item: Item,
    options?: UpsertOptions,
  ) => Promise<UpsertResult>;
  /**
   * The source's own version marker for the item, from the LISTING — an ETag.
   *
   * Optional, and its absence is meaningful: a source that cannot report a
   * version (mail — messages are immutable) keeps the pre-update-propagation
   * behaviour exactly, skipping anything the ledger has seen.
   *
   * Must be readable from the listing alone. A version that required fetching
   * the item would defeat the fast-path this exists to preserve: the point is
   * to notice a change WITHOUT re-reading every item on every pass.
   */
  readonly sourceVersion?: (item: Item) => string | undefined;
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
  /**
   * Items rewritten because the source version changed after we copied them —
   * the shadow-sync update path (§11.1, "the source is authoritative for
   * content"). Every one of these overwrote bytes this tool wrote itself.
   */
  readonly updated: number;
  /**
   * Items that changed on the source but were left alone because the target
   * copy is the CUSTOMER'S, not ours (status `adopted`).
   *
   * Counted rather than silently skipped: it is a real divergence between
   * source and target that no other number reveals, and §11.2 says the owner
   * decides about their own data.
   */
  readonly changedButAdopted: number;
  /**
   * Items that failed THIS pass and will be retried on the next one.
   *
   * A pass no longer aborts on the first of these: one unreadable item used to
   * take its whole domain down with it, so a single corrupt file could stall a
   * migration indefinitely while everything else sat ready to move.
   */
  readonly failed: number;
  /**
   * Items that have exhausted `MAX_ITEM_ATTEMPTS` and are waiting on an owner
   * decision — retry, or accept and migrate without them (§11.2).
   */
  readonly needsDecision: number;
  /** Items the owner has accepted leaving behind. Skipped, never retried. */
  readonly leftBehind: number;
  /**
   * What failed and why, for the operator-facing queue.
   *
   * Carries the natural-key HASH, not the natural key: a file's natural key is
   * its path, and §17 treats that as personal data. The hash is enough to
   * target a retry or an accept.
   */
  readonly failures: ReadonlyArray<ItemFailure>;
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
    sourceVersion,
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
  // Rewritten because the source moved on after we copied them (§11.1).
  let updated = 0;
  let needsDecision = 0;
  let leftBehind = 0;
  const failures: ItemFailure[] = [];
  /**
   * Consecutive failures, reset by any success.
   *
   * Per-item isolation is right for a bad ITEM and wrong for a bad WORLD. An
   * expired credential, a target that is down, a full disk: those fail every
   * item identically, and grinding through 50 000 of them produces 50 000
   * identical ledger rows, 50 000 wasted round trips, and a failure queue no
   * person can read. This is the tripwire that says "this is not the items".
   *
   * Approximate under concurrency — up to `concurrency` results can interleave
   * — and deliberately so: it is a smoke alarm, not a measurement.
   */
  let consecutiveFailures = 0;
  // Changed on the source, but the target copy is the customer's own — left
  // alone by hard rule 2, and counted so that is a fact rather than a silence.
  let changedButAdopted = 0;

  const folders = await listFolders();
  
  for (const folder of folders) {
    const collectionId = await ensureCollection(folder);
    const prev = cursors ? await cursors.get(tenantId, mappingId, folder.path ?? folder.name ?? '') : undefined;
    const { items, nextCursor } = await listSince(folder, prev);

    await mapWithConcurrency(items, concurrency, async (item) => {
      scanned += 1;
      let naturalKeyHash = naturalKey(item);
      const version = sourceVersion?.(item);

      // Set when this item is a REWRITE of a copy we already made, not a new
      // item. It carries the existing row, whose createdAt and identity the
      // update must preserve.
      let rewriteOf: LedgerRecord | undefined;
      /**
       * True when the ledger ALREADY has a row for this item, so a successful
       * write has to UPDATE it rather than insert.
       *
       * `recordIfAbsent` no-ops on conflict. Without this, an item that failed
       * and then succeeded on a later pass kept `status: 'failed'` forever: it
       * would sit in the operator's queue after it had been migrated, and be
       * retried on every subsequent pass — a permanent phantom failure over
       * data that is safely on the target.
       */
      let hasExistingRow = false;

      // Ledger fast-path: already migrated -> usually skip without fetching.
      //
      // "Usually", since update propagation: an item whose source version has
      // moved on is fetched and rewritten rather than skipped. That is the one
      // and only case in this loop that overwrites anything on the target, and
      // `classifyKnownItem` is where the decision lives — including the rule
      // that an ADOPTED item (the customer's own copy) is never rewritten.
      if (naturalKeyHash !== undefined) {
        // Captured so the closure keeps the narrowing from the guard above.
        const key = naturalKeyHash;
        const known = await timed(phases, 'ledgerReadMs', () =>
          ledger.find(tenantId, mappingId, domain, key),
        );
        if (known) {
          const action = classifyKnownItem(known, version);
          if (action === 'skip') {
            skipped += 1;
            return;
          }
          if (action === 'record-version') {
            // Unchanged as far as we can tell, but the row predates the
            // version column. Store it — one small UPDATE, no fetch and no
            // target write — so the next genuine edit is detectable.
            await timed(phases, 'ledgerWriteMs', () =>
              ledger.recordUpdate({ ...known, sourceVersion: version }),
            );
            skipped += 1;
            return;
          }
          if (action === 'leave-adopted') {
            changedButAdopted += 1;
            return;
          }
          if (action === 'left-behind') {
            // The owner already decided. Nothing to do, and nothing to report
            // as a problem — but counted, so "we are not copying 12 items" is
            // never invisible.
            leftBehind += 1;
            return;
          }
          if (action === 'needs-decision') {
            // Out of automatic attempts. Do NOT fetch it again: that is the
            // whole point of parking, and re-reading a file that has failed
            // five times costs a real download every pass.
            needsDecision += 1;
            failures.push({
              domain,
              naturalKeyHash: key,
              attempts: known.attemptCount ?? MAX_ITEM_ATTEMPTS,
              lastError: known.lastError ?? '(no error recorded)',
              needsDecision: true,
            });
            return;
          }
          // 'retry-failed' falls through to the normal fetch-and-write path.
          // 'rewrite' does too, but carries the row so the write knows to
          // overwrite the target. Either way the ledger row already exists.
          hasExistingRow = true;
          if (action === 'rewrite') rewriteOf = known;
        }
      }

      // Everything from the fetch onward is inside the per-item boundary.
      //
      // The try used to start at the upsert, which left the most likely failure
      // of all outside it: `fetchRaw` is where an unreadable source item, a
      // 507, or a dropped connection actually surfaces. Isolating only the
      // WRITE would have meant a corrupt file still aborted the whole pass —
      // the exact bug this is meant to fix.
      //
      // `ch` is declared here so the catch can record whatever hash we managed
      // to compute; on a fetch failure there is none, which is honest.
      let ch = '';
      try {
        // Fetch raw data
        const { raw, sizeBytes } = await timed(phases, 'fetchMs', () => fetchRaw(item));

        if (naturalKeyHash === undefined) {
          // The key could not be known from the listing, so derive it now.
          // Mail with no Message-ID is keyed by a hash of its own bytes; that
          // is only available once the message has been read.
          if (!naturalKeyFromRaw) {
            throw new Error(
              `naturalKey returned undefined for a ${domain} item but no naturalKeyFromRaw was ` +
                `supplied; refusing to write an item with no idempotency anchor.`,
            );
          }
          naturalKeyHash = naturalKeyFromRaw(item, raw);

          // Second fast-path check, now that we have a key. This is what keeps
          // these items idempotent: a re-run pays the fetch again (unavoidable
          // — the key is the content) but must not create a duplicate.
          //
          // No update-propagation branch here, and none is needed: for these
          // items the key IS the content, so an item that changed necessarily
          // has a different natural key and arrives as a new item rather than
          // a changed one.
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
        // the hash of the bytes we will actually write. The target stores what
        // we wrote, and §20 checksum sampling compares against it.
        const hashStart = phases ? performance.now() : 0;
        ch = contentHash(raw);
        if (phases) phases.hashMs += performance.now() - hashStart;

        // Upsert on target (pass item for domain-specific metadata like keywords)
        // The version travels WITH the write. The writers record the ledger
        // row themselves and win the race (`recordIfAbsent` no-ops on
        // conflict), so a version recorded only here never reached the row.
        const result = await timed(phases, 'upsertMs', () =>
          upsert(collectionId, raw, item, {
            ...(rewriteOf ? { overwrite: true } : {}),
            ...(version !== undefined ? { sourceVersion: version } : {}),
          }),
        );

        const row: LedgerRecord = {
          tenantId,
          itemType: domain,
          mappingId,
          naturalKeyHash,
          contentHash: ch,
          targetId: result.targetId,
          createdAt: new Date().toISOString(),
          sizeBytes,
          status: result.created ? 'copied' : result.adopted ? 'adopted' : 'updated',
          ...(version !== undefined ? { sourceVersion: version } : {}),
        };

        // An item the ledger already knows MUST go through recordUpdate.
        // `recordIfAbsent` is a no-op on conflict, which would leave the old
        // state in place — the old content hash and source version for a
        // rewrite, and `status: 'failed'` for an item that has just been
        // retried successfully. Both make the next pass repeat the same work
        // forever, and the second also keeps a migrated item sitting in the
        // operator's failure queue.
        await timed(phases, 'ledgerWriteMs', () =>
          hasExistingRow ? ledger.recordUpdate(row) : ledger.recordIfAbsent(row),
        );

        consecutiveFailures = 0;
        if (rewriteOf) updated += 1;
        else if (result.created) created += 1;
        else if (result.adopted) {
          adopted += 1;
          if (onCollision === 'fail') {
            // Thrown after the ledger row is written, so the item that stopped
            // the pass is identifiable afterwards rather than merely counted.
            throw new PassAbortError(
              `Collision on the destination for a ${domain} item, and onCollision is 'fail': ` +
                'the target already holds an item under this natural key. Re-run with ' +
                "onCollision: 'skip' to keep the destination's copy.",
            );
          }
        } else skipped += 1;
      } catch (err) {
        // ONE ITEM FAILED. The pass carries on.
        //
        // This used to rethrow, which `mapWithConcurrency` turns into a
        // fail-fast abort of the whole folder and therefore the whole domain
        // pass — with the cursor unpersisted, so the next pass redid all of it
        // and stopped at the same item. One permanently unreadable file could
        // hold an entire migration at zero indefinitely, and the operator's
        // only signal was a stack trace in a container log.
        //
        // This is NOT masking the error (hard rule 9). The error is recorded
        // verbatim on the item's own ledger row, counted, logged, returned in
        // `failures`, and surfaced for a decision. Masking would be catching
        // and continuing SILENTLY; what changes here is only the blast radius.
        // A deliberate stop is not an item failure. `onCollision: 'fail'` asks
        // for the pass to end, and swallowing it here would turn an explicit
        // policy into a counter nobody set.
        if (err instanceof PassAbortError) throw err;

        failed += 1;
        consecutiveFailures += 1;
        const error = err as Error;
        const reason = error?.message ?? String(err);

        // No natural key means the fetch failed before one could be derived
        // (mail with no Message-ID, keyed by its own bytes). There is no
        // idempotency anchor, so there is no row to write and nothing for a
        // retry or accept to target — but it must still be counted and said
        // out loud rather than vanishing.
        if (naturalKeyHash === undefined) {
          log.warn(
            `[sync] ${domain}: an item failed before its natural key could be derived, so it ` +
              `cannot be tracked or retried individually: ${reason}`,
          );
          if (consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
            throw new PassAbortError(
              `${domain}: ${consecutiveFailures} items failed in a row. Last error: ${reason}`,
              { cause: err },
            );
          }
          return;
        }
        // Captured so the closure below keeps the narrowing from the guard.
        const failedKey = naturalKeyHash;

        // `recordFailure`, not `recordIfAbsent`: the attempt COUNT is what
        // eventually stops the retrying and hands the item to a person, and
        // `recordIfAbsent` no-ops on an existing row — so a permanently broken
        // item would have stayed at one attempt forever. It also deliberately
        // does not store the source version, so a failed rewrite is retried
        // rather than recorded as landed.
        const row = await timed(phases, 'ledgerWriteMs', () =>
          ledger.recordFailure(
            {
              tenantId,
              itemType: domain,
              mappingId,
              naturalKeyHash: failedKey,
              contentHash: ch,
              targetId: '',
              createdAt: new Date().toISOString(),
              sizeBytes: 0,
              status: 'failed',
            },
            reason,
          ),
        );

        const attempts = row.attemptCount ?? 1;
        const parked = attempts >= MAX_ITEM_ATTEMPTS;
        if (parked) needsDecision += 1;
        failures.push({
          domain,
          naturalKeyHash: failedKey,
          attempts,
          lastError: reason,
          needsDecision: parked,
        });

        // Logged as well as recorded: the ledger is where it persists, the log
        // is where an operator watching a run finds out at the time.
        log.warn(
          `[sync] ${domain}: item ${failedKey.slice(0, 12)} failed ` +
            `(attempt ${attempts}/${MAX_ITEM_ATTEMPTS}): ${reason}` +
            (parked ? ' — no further automatic retries; awaiting a decision' : ''),
        );

        // The bad-WORLD tripwire. Beyond this, "keep going" stops being
        // resilience and becomes a way to turn one broken credential into tens
        // of thousands of identical ledger rows.
        if (consecutiveFailures >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
          throw new PassAbortError(
            `${domain}: ${consecutiveFailures} items failed in a row, so this is not an ` +
              `item-level problem — the pass is stopping instead of failing every remaining ` +
              `item the same way. Last error: ${reason}`,
            // The original is the diagnosis; this wrapper only says how many
            // times it happened.
            { cause: err },
          );
        }
      }
    });

    // Persist the cursor only when nothing in this folder is still awaiting a
    // RETRY.
    //
    // An incremental cursor means "do not show me these items again". Advancing
    // it past an item that failed and is still retryable would retire the item
    // silently: the next pass would not list it, so the retry the ledger is
    // waiting for could never happen.
    //
    // Parked items (attempts exhausted) do NOT hold the cursor back — they are
    // not being retried automatically, so re-listing them buys nothing. An
    // operator RETRY therefore also clears the mapping's cursors, forcing the
    // full re-list that puts the item back in front of the loop.
    const retryablePending = failures.some((f) => !f.needsDecision);
    if (cursors && !retryablePending) {
      await cursors.set(
        tenantId,
        mappingId,
        (folder as { path?: string; name?: string }).path ?? (folder as { name?: string }).name ?? '',
        nextCursor
      );
    }
  }

  reportPhases(phases, domain, scanned);

  return {
    scanned,
    created,
    skipped,
    adopted,
    failed,
    updated,
    changedButAdopted,
    needsDecision,
    leftBehind,
    failures,
    drift: 0,
    metrics: summarise(phases, scanned),
  };
}
