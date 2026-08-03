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
  type ItemMove,
  type ItemDeletion,
  DELETION_CONFIRMATIONS,
  isOnTarget,
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
      // Two decimals, not one. The e2e gate reads this to decide whether a
      // pass did enough writing for its overlap to mean anything, and its
      // floor is 0.1s — at one decimal a 115 ms pass prints as `0.1s` and the
      // boundary case is literally unrepresentable. It cost a red run.
      `target-write ${(phases.upsertMs / 1000).toFixed(2)}s (${per(phases.upsertMs)}ms/item) | ` +
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
  /**
   * The source lists it in a different collection from the one we copied it
   * into. Neither copied nor deleted — reported, and left for the owner.
   */
  | 'moved'
  /** A previous attempt failed and it is still worth trying again. */
  | 'retry-failed'
  /** Attempts are exhausted; it is waiting on an owner decision. */
  | 'needs-decision'
  /** The owner decided to migrate without it. Terminal. */
  | 'left-behind'
  /**
   * We REMOVED this item's copy from the target, on the owner's decision, and
   * the source is listing it again. Terminal, and reported.
   */
  | 'tombstoned';

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
 *
 * Between the two groups sits the TOPOLOGY question: the source may still hold
 * this exact item, unchanged, but somewhere else. That is `'moved'`, and it
 * outranks every version rule below it because §11.1 splits authority — the
 * source owns an item's CONTENT, the owner owns its PLACE — and a rewrite
 * would answer the content question while silently ignoring the other one.
 */
export function classifyKnownItem(
  known: Pick<LedgerRecord, 'sourceVersion' | 'status' | 'attemptCount' | 'collection'>,
  sourceVersion: string | undefined,
  /**
   * The source collection the item is listed in NOW.
   *
   * Optional so the many call sites that predate move detection keep their
   * exact behaviour: with nothing to compare against there is no move.
   */
  collection?: string,
): KnownItemAction {
  // FAILURE STATES FIRST. A row is not proof the item was migrated — it is only
  // proof we have seen the item, and these three states mean we have NOT copied
  // it. Treating them as "already done" is what made a failed item permanently
  // invisible: it was recorded `failed`, and every later pass found the row on
  // the fast-path and skipped it, so the item was never retried and never
  // reported. Silent data loss with a green count next to it.
  if (known.status === 'left_behind') return 'left-behind';
  // REMOVED ON PURPOSE, and the source is showing it again.
  //
  // Not re-copied, deliberately. Re-creating it would be the natural reading of
  // "the source is authoritative for content" — and it would silently
  // re-materialise data somebody deliberately had deleted. If that deletion was an
  // erasure request, restoring it is a compliance failure, and this code cannot
  // tell an erasure request from a change of mind. So the item is left alone and
  // the reappearance is reported, which is the one outcome that cannot be wrong in
  // a way nobody can undo.
  //
  // Ahead of every version rule because a tombstoned row has no meaningful version
  // question: there are no bytes on the target to compare against. Left to fall
  // through, it matched "versions equal → skip" and became invisible forever.
  if (known.status === 'tombstoned') return 'tombstoned';
  if (known.status === 'failed') {
    return (known.attemptCount ?? 0) >= MAX_ITEM_ATTEMPTS ? 'needs-decision' : 'retry-failed';
  }

  // TOPOLOGY BEFORE CONTENT. Both collections must be non-empty to compare:
  // every ledger row written before this change carries `''`, because nothing
  // ever populated the column, and reading that as "the empty-named folder"
  // would declare an entire migrated corpus moved on the first pass after
  // upgrading. Absent information is not evidence of change.
  if (
    collection !== undefined &&
    collection !== '' &&
    known.collection !== undefined &&
    known.collection !== '' &&
    known.collection !== collection
  ) {
    return 'moved';
  }

  if (sourceVersion === undefined) return 'skip';
  if (known.sourceVersion === undefined) return 'record-version';
  if (known.sourceVersion === sourceVersion) return 'skip';
  if (known.status === 'adopted') return 'leave-adopted';
  return 'rewrite';
}

/**
 * True when the owner has already looked at THIS move and chosen to leave it.
 *
 * Per destination, not per item. Re-reporting a move somebody closed would make
 * the queue impossible to empty, and a queue that never empties is one people
 * stop reading — which is how a real divergence goes unnoticed among a hundred
 * already-decided ones. But a move somewhere NEW is a new arrangement, and
 * consent to the old one says nothing about it.
 */
function decided(
  row: { readonly movedToCollection?: string; readonly moveAcknowledgedAt?: string },
  to: string,
): boolean {
  return row.movedToCollection === to && row.moveAcknowledgedAt !== undefined;
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
  readonly listSince: (
    folder: Folder,
    cursor?: { readonly value: string },
  ) => Promise<{
    items: ReadonlyArray<Item>;
    nextCursor: { readonly value: string };
    /**
     * Source refs the server REPORTED as removed on this poll.
     *
     * The one deletion signal in this product that is not an inference. RFC 6578
     * `sync-collection` answers an incremental CalDAV/CardDAV poll with the
     * changed objects and the removed ones, the latter as an href plus a 404 —
     * and both connectors have been issuing that REPORT and discarding this half
     * of the answer since they were written.
     *
     * Matched back to items through `Ledger.findBySourceRef`, because a removed
     * object has no body left to read a UID out of. Empty or absent means the
     * server reported none, which is NOT the same as "nothing was deleted": a
     * full listing has no removals to report, and a source that does not speak
     * sync-collection never fills this in at all.
     */
    removed?: ReadonlyArray<string>;
  }>;
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
  /**
   * The source's OWN handle for the item — a DAV href.
   *
   * Recorded so a later removal report can be matched back to the item it used
   * to be. RFC 6578 `sync-collection` reports a deleted object as its href with
   * a 404 status, and a deleted object has no body left to read a UID out of.
   *
   * Optional, and its absence simply means those items cannot be matched against
   * a removal report — they fall back to absence-counting.
   */
  readonly sourceRef?: (item: Item) => string | undefined;
  /** Extract natural key from item */
  /**
   * The item's natural-key hash, or undefined when it cannot be known from the
   * listing alone — mail with no Message-ID, whose key has to be derived from
   * the body. Those items fall through to `naturalKeyFromRaw` after the fetch.
   */
  readonly naturalKey: (item: Item) => string | undefined;
  /**
   * Every natural-key hash currently in a collection, ignoring any cursor.
   *
   * Supplied only by domains whose source can answer it cheaply (files, from
   * the PROPFIND `listSince` already makes). It is what lets a path-keyed
   * domain notice an item has DISAPPEARED — and therefore tell a move from a
   * deletion — on an ordinary incremental pass rather than only on a full scan.
   *
   * Absent, the loop falls back to what the pass itself listed, which is
   * complete only when there was no cursor.
   */
  readonly listCollectionKeys?: (folder: Folder) => Promise<ReadonlyArray<string>>;
  /**
   * Natural-key hashes of items sitting in the owner's BIN on the source.
   *
   * The collections this reads are out of scope as CONTENT — trash and junk are
   * excluded by default — and that is exactly what makes them available as a
   * SIGNAL. An item in a `\Trash` collection (RFC 6154) is the source system's own
   * record that the person deleted it: positive evidence, needing no
   * corroboration, and the only deletion evidence the mail domain has.
   *
   * Keys only — no bodies, and nothing is copied. The caller decides which roles
   * count: trash does, junk does NOT, because a message in Junk was very likely
   * put there by a filter rather than by a person, and the whole value of this
   * signal is that it is unambiguous owner intent.
   *
   * Absent means the domain has no readable bin, which is a "not measured" and
   * never a "nothing was deleted".
   */
  readonly listDiscardedKeys?: () => Promise<ReadonlyArray<string>>;
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
   * Rewrites the target REFUSED because our copy had been edited there.
   *
   * Distinct from `changedButAdopted`, which is an item we never wrote at all.
   * These we did write — and someone has since changed them in the new system,
   * which shadow migration positively invites. The pass leaves their version
   * alone and marks the item adopted, so it is never a candidate for overwrite
   * again.
   */
  readonly conflicted: number;
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
  /**
   * Items the source now lists in a different collection from the one we
   * copied them into. Nothing was written and nothing was deleted.
   */
  readonly moved: number;
  /** Which ones, and where from and to, for the operator. See `ItemMove`. */
  readonly moves: ReadonlyArray<ItemMove>;
  /**
   * Items the source has stopped showing, for long enough to be worth saying
   * out loud. Nothing is removed from the target — see `ItemDeletion`.
   */
  readonly deletions: ReadonlyArray<ItemDeletion>;
  /**
   * Source items absent on a later pass (potential deletions).
   *
   * Populated only for the FILE domain, and only when every collection's key
   * set is known to be complete — see `detectPathKeyedMoves` for why both
   * conditions are load-bearing. Anywhere else this is 0, which is a "not
   * measured", not a "none found".
   */
  readonly drift: number;
  /**
   * The source lists this key again after this tool REMOVED the target's copy
   * on an explicit owner decision (`applyDeletion`).
   *
   * NOT re-created, and that is the point of counting it rather than acting on
   * it. Re-copying it would be the ordinary reading of "the source is
   * authoritative for content" (§11.1) — but it would also silently undo a
   * destructive decision an owner made on purpose, and this code has no way to
   * tell "the owner changed their mind" from "this was an erasure request and
   * restoring it is a compliance failure". So the tombstoned row is left
   * exactly as it is, and the reappearance is surfaced here instead of
   * vanishing into a routine `skip`.
   */
  readonly reappearedAfterRemoval: number;
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
    sourceRef,
    listCollectionKeys,
    listDiscardedKeys,
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
  // The source lists a key again after `apply` removed the target's copy for
  // it. Never re-created — see `DomainSyncResult.reappearedAfterRemoval`.
  let reappearedAfterRemoval = 0;
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
  let moved = 0;
  // Rewrites REFUSED because somebody edited our copy in the new system.
  let conflicted = 0;
  const moves: ItemMove[] = [];
  const deletions: ItemDeletion[] = [];
  let drift = 0;
  /**
   * Source refs the server said are gone, gathered across every folder.
   *
   * Resolved after the whole pass rather than per folder — see the note where
   * they are collected. Refs (DAV hrefs), because a removed object has no body
   * left and therefore no UID: the natural key has to be recovered from the
   * ledger row that recorded the href at copy time.
   */
  const reportedRemovals: string[] = [];

  /**
   * Every natural key this pass actually SAW, per source collection.
   *
   * The input to path-keyed move detection: for files the natural key is the
   * path, so a move produces a brand-new key and the only trace of the old one
   * is its ABSENCE from the listing. Recorded for every item regardless of
   * outcome — skipped and failed items are still present on the source, and
   * counting them as gone would read a healthy corpus as mass deletion.
   */
  const seenByCollection = new Map<string, Set<string>>();
  /** Items created THIS pass — the other half of the correlation. */
  const createdThisPass: Array<{ naturalKeyHash: string; contentHash: string; collection: string }> = [];
  /**
   * True only while the key set of EVERY folder so far is known to be complete.
   *
   * A cursor-limited listing reports just what changed, so nearly every key the
   * ledger holds would be "absent" and the detector would call an entire
   * mailbox moved. Completeness comes from one of two things: the folder was
   * listed from the beginning (no cursor), or the source answered
   * `listCollectionKeys` for it.
   */
  let fullyEnumerated = true;

  const folders = await listFolders();

  for (const folder of folders) {
    const collectionId = await ensureCollection(folder);
    // Hoisted: this is the source collection PATH (as opposed to `collectionId`,
    // the target's handle for it), and it is now needed three times — for the
    // cursor, for the ledger row, and for move detection.
    //
    // '/' rather than '' for the ROOT, and that substitution is load-bearing.
    // A WebDAV connection's own root really does report `path: ''`
    // (`WebdavFileSource.toRelativePath` returns the empty string for the
    // collection that IS the base), and '' is exactly the value the ledger
    // reads as "collection never recorded". Left as-is, every file sitting
    // directly in the user's file root — the commonest layout there is — was
    // recorded as having no collection, and so could never be reported as
    // moved: `classifyKnownItem` skips it and `placedItems` filters it out.
    // The feature was silently inert for the majority of files.
    //
    // Changing it re-keys the ROOT folder's cursor once, costing that one
    // folder a single full re-list. Cursors are non-authoritative (ADR-0020),
    // the re-list is idempotent, and no other folder is affected — a far
    // cheaper price than two subtly different names for the same collection.
    const collectionPath = folder.path ? folder.path : folder.name ? folder.name : '/';
    const prev = cursors ? await cursors.get(tenantId, mappingId, collectionPath) : undefined;
    const { items, nextCursor, removed } = await listSince(folder, prev);
    const seenHere = seenByCollection.get(collectionPath) ?? new Set<string>();
    seenByCollection.set(collectionPath, seenHere);

    // Set aside, NOT acted on here. Resolving a removal report needs to know
    // whether the same item turned up anywhere else in this pass — a UID moved
    // between two calendars is reported as a removal from the first and an
    // arrival in the second — and that is only knowable once every folder has
    // been listed. Acting per folder would report a move as a deletion whenever
    // the destination happened to be listed later.
    for (const href of removed ?? []) reportedRemovals.push(href);

    // Seed the seen-set with everything the collection holds, so a
    // cursor-limited pass still knows what is THERE and not only what changed.
    if (listCollectionKeys) {
      try {
        for (const k of await listCollectionKeys(folder)) seenHere.add(k);
      } catch (err) {
        // Degrade the DETECTOR, not the pass. This listing moves no data — it
        // only decides whether we can distinguish a move from a deletion — and
        // failing an entire migration because a diagnostic PROPFIND hiccuped
        // would trade a real copy for a report. Said out loud, not swallowed:
        // the pass then knows its key set is incomplete and reports nothing
        // rather than reporting the collection as vanished.
        fullyEnumerated = false;
        log.warn(
          `[sync] ${domain}: could not enumerate a collection's keys, so moved and deleted ` +
            `items will not be reported this pass: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    } else if (prev !== undefined) {
      fullyEnumerated = false;
    }

    await mapWithConcurrency(items, concurrency, async (item) => {
      scanned += 1;
      let naturalKeyHash = naturalKey(item);
      const version = sourceVersion?.(item);
      if (naturalKeyHash !== undefined) seenHere.add(naturalKeyHash);

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
          // THE ITEM IS HERE. Whatever else is true about it, any claim that it
          // had disappeared is now false, and that claim is the most dangerous
          // thing in the ledger to leave stale: `deletionReportedAt` is the
          // source's own word that an item is gone, which is the one piece of
          // evidence strong enough to ever act on.
          //
          // A UID really does come back — a declined invitation re-sent, a
          // contact restored from a phone, a calendar re-subscribed, a message
          // dragged out of Deleted Items — and it comes back with the same
          // natural key. This is also what corrects the one false positive the
          // bin scan can produce: a message that exists in BOTH the bin and a
          // live folder is reported as deleted when the live copy was not listed
          // this pass (a cursor-limited listing shows only what changed), and any
          // later pass that does list it clears the claim here.
          //
          // Cleared BEFORE the branching
          // below, because the `moved` and `left-behind` branches both return
          // early and an item can be moved and previously-missing at once.
          //
          // Guarded, so a healthy corpus pays nothing: on rows that never went
          // missing this is a comparison, not a write.
          if (
            known.absentPasses ||
            known.deletionReportedAt !== undefined ||
            known.deletionTrashedAt !== undefined
          ) {
            await timed(phases, 'ledgerWriteMs', () =>
              ledger.clearAbsent(tenantId, mappingId, domain, key),
            );
          }
          const action = classifyKnownItem(known, version, collectionPath);
          if (action === 'moved') {
            // The source shows this item somewhere else. Do NOTHING to the
            // target: writing it into the new collection would leave the old
            // copy behind as a duplicate, and removing the old copy is the
            // delete half of a move, which hard rule 2 forbids outright.
            //
            // The ledger row is deliberately left pointing at the OLD
            // collection, because that is still where the target copy actually
            // is. Updating it would make the divergence disappear from the
            // report while the target stayed exactly as wrong as before.
            //
            // WRITTEN DOWN, not merely counted. The first version of this only
            // returned the move in the pass result, so an operator who was not
            // reading the container output at that moment never learned — and
            // had no way to say "dealt with, stop telling me".
            if (!decided(known, collectionPath)) {
              await timed(phases, 'ledgerWriteMs', () =>
                ledger.recordMove(tenantId, mappingId, domain, key, collectionPath),
              );
              moved += 1;
              moves.push({
                domain,
                naturalKeyHash: key,
                from: known.collection ?? '',
                to: collectionPath,
              });
            }
            return;
          }
          // Not moved — so any move we recorded earlier is over, and its queue
          // entry has to go with it. An entry that outlived its cause has
          // people acting on a layout that was already put back.
          if (known.movedToCollection !== undefined) {
            await timed(phases, 'ledgerWriteMs', () =>
              ledger.clearMove(tenantId, mappingId, domain, key),
            );
          }
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
          if (action === 'tombstoned') {
            // The owner explicitly removed this item's copy (`apply`), and the
            // source is listing the key again. NOT re-created — see the long
            // comment on `classifyKnownItem` and on
            // `DomainSyncResult.reappearedAfterRemoval` for why: this code
            // cannot tell "the owner changed their mind" from "this was an
            // erasure request and putting it back is a compliance failure", so
            // the only safe answer is to leave the tombstone standing and say
            // so out loud rather than silently undo a destructive decision.
            reappearedAfterRemoval += 1;
            log.warn(
              `[sync] ${domain}: item ${key.slice(0, 12)} was explicitly removed from the target ` +
                '(apply) and the source is listing it again. NOT re-created — an operator decided ' +
                'this item should go, and the row is left as tombstoned.',
            );
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
          // Now that there IS a key, the item counts as seen. It was skipped by
          // the record at the top of the loop because the key did not exist
          // yet, and an item missing from that set reads as gone from the
          // source.
          seenHere.add(derivedKey);
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
            // Only on a rewrite, and only when we know what we left there. The
            // writer refuses if the target reports anything else.
            ...(rewriteOf?.targetVersion !== undefined
              ? { expectedTargetVersion: rewriteOf.targetVersion }
              : {}),
            ...(version !== undefined ? { sourceVersion: version } : {}),
            collection: collectionPath,
            ...(sourceRef?.(item) !== undefined ? { sourceRef: sourceRef(item) } : {}),
          }),
        );

        // THE TARGET COPY IS NOT OURS ANY MORE.
        //
        // Nothing was written. Mark the item `adopted`, which is not a
        // consolation prize but the exact truth: those bytes are the
        // customer's, and `classifyKnownItem` already refuses to rewrite an
        // adopted item however far the source moves. From here the divergence
        // is reported every pass as `changedButAdopted`, and cheaply — that
        // branch returns before any fetch.
        //
        // `sourceVersion` is deliberately NOT advanced. Recording it would say
        // the source change had been applied, which is the opposite of what
        // happened, and would hide a real divergence from the operator.
        if (result.conflicted) {
          conflicted += 1;
          await timed(phases, 'ledgerWriteMs', () =>
            ledger.recordUpdate({
              ...rewriteOf!,
              status: 'adopted',
              targetId: result.targetId,
            }),
          );
          log.warn(
            `[sync] ${domain}: item ${naturalKeyHash.slice(0, 12)} changed on the source, but ` +
              'the copy on the target has been edited since we wrote it. Left alone — those ' +
              'bytes are the owner\'s now (hard rule 2), and this item will not be overwritten ' +
              'again.',
          );
          return;
        }

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
          // What the TARGET says our copy is now, so the next rewrite can tell
          // whether it is still ours. Absent when the server offered no ETag,
          // which costs this item its overwrite protection and nothing else.
          ...(result.targetVersion !== undefined ? { targetVersion: result.targetVersion } : {}),
          // The source's own handle, so a removal report can find this row.
          ...(sourceRef?.(item) !== undefined ? { sourceRef: sourceRef(item) } : {}),
          // WHERE it came from, not just what it was. Until this was recorded
          // the ledger could not tell an item that had never moved from one
          // that had, so a move was indistinguishable from a steady state.
          collection: collectionPath,
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
        else if (result.created) {
          created += 1;
          // The "arrived" half of a path-keyed move. Only genuinely NEW items
          // qualify: an adopted or rewritten item was already accounted for
          // under this key, so it cannot be the destination of one.
          createdThisPass.push({
            naturalKeyHash,
            contentHash: ch,
            collection: collectionPath,
          });
        }
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
      await cursors.set(tenantId, mappingId, collectionPath, nextCursor);
    }
  }

  // What the SOURCE said outright, which likewise can only be resolved once
  // every folder has been listed — a UID moved between two collections is a
  // removal from one and an arrival in the other.
  //
  // Deliberately NOT gated on `fullyEnumerated`. That gate exists because
  // absence-based detection needs a complete key set to mean anything; a removal
  // report needs nothing of the kind. The server named the object. An incomplete
  // listing cannot make that untrue, and refusing to believe it on an
  // incremental pass would discard the signal on every pass that has a cursor —
  // which in production is all of them but the first.
  if (reportedRemovals.length > 0) {
    const reported = await resolveReportedRemovals({
      tenantId,
      mappingId,
      domain,
      ledger,
      removals: reportedRemovals,
      seenByCollection,
    });
    deletions.push(...reported);
  }

  // What the owner threw away. Read from collections this pass deliberately did
  // NOT copy — which is what makes them readable as a signal at all.
  if (listDiscardedKeys) {
    let discarded: ReadonlyArray<string> | undefined;
    try {
      discarded = await listDiscardedKeys();
    } catch (err) {
      // Degrade the DETECTOR, not the pass. This listing moves no data; failing
      // a whole migration because a scan of Deleted Items hiccuped would trade a
      // real copy for a report. Said out loud rather than swallowed (hard rule 9).
      log.warn(
        `[sync] ${domain}: could not read the owner's discarded items, so deletions will not ` +
          `be reported from them this pass: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (discarded && discarded.length > 0) {
      deletions.push(
        ...(await resolveDiscardedItems({
          tenantId,
          mappingId,
          domain,
          ledger,
          discarded,
          seenByCollection,
        })),
      );
    }
  }

  // The path-keyed half, which can only run once every folder has been listed.
  if (domain === 'file' && fullyEnumerated) {
    const found = await detectPathKeyedMoves({
      tenantId,
      mappingId,
      domain,
      ledger,
      seenByCollection,
      createdThisPass,
    });
    moved += found.moves.length;
    moves.push(...found.moves);
    deletions.push(...found.deletions);
    drift += found.drift;
  }

  reportPhases(phases, domain, scanned);

  // ONE ENTRY PER ITEM, keeping the strongest evidence.
  //
  // A deleted file is found twice on the same pass by design: it is in the owner's
  // bin (positive evidence, reported at once) AND missing from the collection
  // listing (absence-counting, reported once it repeats). Both are true and both
  // are worth recording on the row, but a queue that shows the same file twice —
  // once as `trashed` and once as `inferred` — reads as two problems.
  const strongest = new Map<string, ItemDeletion>();
  const rank = { reported: 3, trashed: 2, inferred: 1 } as const;
  for (const d of deletions) {
    const held = strongest.get(d.naturalKeyHash);
    if (!held) {
      strongest.set(d.naturalKeyHash, d);
      continue;
    }
    // Strongest evidence wins, but the COUNT is the highest anyone saw. The two
    // detectors read the row at different moments — the bin scan takes its snapshot
    // before absence-counting has incremented on this pass — so keeping the winner's
    // number verbatim would report a count one behind the row it came from.
    const winner = rank[d.evidence] > rank[held.evidence] ? d : held;
    const absentPasses = Math.max(d.absentPasses, held.absentPasses);
    strongest.set(d.naturalKeyHash, absentPasses === winner.absentPasses ? winner : { ...winner, absentPasses });
  }
  const reportedDeletions = [...strongest.values()];

  // The two POSITIVE kinds of evidence, logged together: both mean "the owner
  // deleted this", and neither had to be inferred from absence.
  const certain = reportedDeletions.filter((d) => d.evidence !== 'inferred');
  if (certain.length > 0) {
    const reported = certain.filter((d) => d.evidence === 'reported').length;
    const trashed = certain.length - reported;
    // Said out loud because this is the strongest claim the pass can make, and
    // nothing acts on it: the target keeps its copy until a person decides
    // (§11.1 — deletions are never auto-propagated). Hash prefixes and counts
    // only; the collections travel in `deletions`, which goes to the operator's
    // own status surface rather than a container log (§17).
    log.warn(
      `[sync] ${domain}: ${certain.length} item(s) were deleted on the source ` +
        `(${reported} reported by the server, ${trashed} found in the owner's bin). Nothing was ` +
        'removed from the target — the owner decides whether their copy goes too. First: ' +
        certain
          .slice(0, 5)
          .map((d) => d.naturalKeyHash.slice(0, 12))
          .join(', '),
    );
  }
  if (moved > 0) {
    // Hash prefixes and counts only. The paths themselves travel in `moves`,
    // which goes to the operator's own status surface; a container log is
    // read, shipped and retained by a different set of people (§17).
    log.warn(
      `[sync] ${domain}: ${moved} item(s) are in a different source collection than the one ` +
        'they were copied into. Nothing was written and nothing was deleted — the owner ' +
        'decides where items live (§11.1). First: ' +
        moves
          .slice(0, 5)
          .map((m) => m.naturalKeyHash.slice(0, 12))
          .join(', '),
    );
  }

  return {
    scanned,
    created,
    skipped,
    adopted,
    failed,
    updated,
    changedButAdopted,
    conflicted,
    needsDecision,
    leftBehind,
    reappearedAfterRemoval,
    failures,
    moved,
    moves,
    deletions: reportedDeletions,
    drift,
    metrics: summarise(phases, scanned),
  };
}

/**
 * Turn the server's own removal reports into deletions on the ledger.
 *
 * The only place in this product where a deletion is KNOWN rather than suspected.
 * Everywhere else an item is presumed gone because it stopped appearing, which
 * has innocent causes that all look identical; here the source answered an
 * incremental poll with "that object is 404" (RFC 6578). No corroboration is
 * required and none would help — a second pass cannot make the server's own
 * answer truer.
 *
 * The href is all that arrives. A removed object has no body, so no UID, so no
 * natural key — which is the entire reason the href is recorded on the ledger row
 * at copy time (migration 0025). `findBySourceRef` is the way back.
 *
 * FOUR THINGS ARE REFUSED, and each of them is a way this could report a live
 * item as deleted:
 *
 * 1. **An href we never copied.** No ledger row means the object was created and
 *    deleted between two of our passes, or was never in scope. There is nothing
 *    on the target to reconcile and nothing to tell anyone.
 * 2. **An item that is not on the target.** A `failed` or `left_behind` row is
 *    not a copy (see `isOnTarget`), so the source deleting the original changes
 *    nothing about our side.
 * 3. **An item this pass SAW under its natural key.** The decisive one. A UID
 *    moved between two collections is reported as a removal from the old href and
 *    an arrival at a new one; a UID deleted and re-created likewise. In both
 *    cases the item is plainly alive, and reporting it deleted because one of its
 *    hrefs died would be exactly wrong. This is why the whole thing waits until
 *    every folder has been listed.
 * 4. **An item the owner has already decided about.** Recorded, not re-reported:
 *    a queue that cannot be emptied stops being read.
 */
async function resolveReportedRemovals(args: {
  tenantId: TenantId;
  mappingId: MappingId;
  domain: 'email' | 'calendar' | 'contact' | 'file';
  ledger: Ledger;
  removals: ReadonlyArray<string>;
  seenByCollection: ReadonlyMap<string, ReadonlySet<string>>;
}): Promise<ItemDeletion[]> {
  const { tenantId, mappingId, domain, ledger, removals, seenByCollection } = args;

  // Every key the pass saw ANYWHERE, which is what makes a move distinguishable
  // from a deletion. Per-collection is the wrong grain here: the point is that
  // the item still exists, not where.
  const seenAnywhere = new Set<string>();
  for (const keys of seenByCollection.values()) for (const k of keys) seenAnywhere.add(k);

  const out: ItemDeletion[] = [];
  // Two hrefs can lead to one row (a server repeating itself, a collection listed
  // twice), and one item must not become two queue entries.
  const done = new Set<string>();

  for (const href of new Set(removals)) {
    const row = await ledger.findBySourceRef(tenantId, mappingId, domain, href);
    if (!row) continue;
    if (!isOnTarget(row.status)) continue;
    if (seenAnywhere.has(row.naturalKeyHash)) continue;
    if (done.has(row.naturalKeyHash)) continue;
    done.add(row.naturalKeyHash);

    // Written down before anything is returned. The pass result is read by
    // whoever happens to be watching; the ledger is what an owner can still act
    // on next week.
    const recorded = await ledger.recordReportedDeletion(
      tenantId,
      mappingId,
      domain,
      row.naturalKeyHash,
    );
    // The row went away underneath us (a concurrent reset, a wiped mapping).
    // Reporting a deletion whose row no longer exists would give an operator a
    // decision they cannot make — `resolveDeletion` would find nothing.
    if (!recorded) continue;
    if (row.deletionAcknowledgedAt !== undefined) continue;

    out.push({
      domain,
      naturalKeyHash: row.naturalKeyHash,
      collection: row.collection ?? '',
      // Whatever absence-counting had reached, which for a reported deletion is
      // normally 0 and says nothing. `evidence` is the field that matters.
      absentPasses: row.absentPasses ?? 0,
      confirmed: true,
      evidence: 'reported',
    });
  }

  return out;
}

/**
 * Record the items we copied that are now sitting in the owner's bin.
 *
 * The mail domain's deletion evidence over IMAP, and the reason the trash
 * exclusion in `excludeSpecialUse` is more than tidiness. IMAP offers no removal
 * report in the shape `sync-collection` gives (Graph's delta `@removed` does,
 * and feeds the reported channel above), and a mailbox cannot be enumerated
 * cheaply enough to run absence-counting on every pass — so before this, a
 * message the owner deleted in the old system produced nothing at all. The target
 * kept its copy, and no surface anywhere said so.
 *
 * An item in a `\Trash` collection is a POSITIVE observation: we are looking at
 * it, not failing to find it. That is what makes it believable on sight, and what
 * makes it a different claim from a removal report — the object still exists, the
 * owner may empty the bin, and they may drag the item back out.
 *
 * The same four refusals as `resolveReportedRemovals`, for the same reasons: a
 * key we never copied (most of what is in a bin), an item not on the target, an
 * item this pass saw alive under its natural key, and one the owner has already
 * decided about.
 *
 * ONE RESIDUAL FALSE POSITIVE, stated rather than hidden. A message can exist in
 * both the bin and a live folder — the same Message-ID in two mailboxes is
 * ordinary on plenty of servers — and on a cursor-limited pass the live copy is
 * not listed, so the seen-check cannot catch it. The report is then wrong, though
 * nothing is removed either way, and it corrects itself: the next pass that lists
 * that message for any reason clears the claim. The alternative was to require a
 * complete key set for the whole mailbox, which in production would mean the
 * signal fired on the first pass and never again — a detector that cannot fire
 * when it matters, which is worse than one that occasionally over-reports.
 */
async function resolveDiscardedItems(args: {
  tenantId: TenantId;
  mappingId: MappingId;
  domain: 'email' | 'calendar' | 'contact' | 'file';
  ledger: Ledger;
  discarded: ReadonlyArray<string>;
  seenByCollection: ReadonlyMap<string, ReadonlySet<string>>;
}): Promise<ItemDeletion[]> {
  const { tenantId, mappingId, domain, ledger, discarded, seenByCollection } = args;

  const seenAnywhere = new Set<string>();
  for (const keys of seenByCollection.values()) for (const k of keys) seenAnywhere.add(k);

  const out: ItemDeletion[] = [];
  for (const key of new Set(discarded)) {
    if (seenAnywhere.has(key)) continue;
    const row = await ledger.find(tenantId, mappingId, domain, key);
    if (!row) continue;
    if (!isOnTarget(row.status)) continue;

    const recorded = await ledger.recordTrashedDeletion(tenantId, mappingId, domain, key);
    if (!recorded) continue;
    if (row.deletionAcknowledgedAt !== undefined) continue;

    out.push({
      domain,
      naturalKeyHash: key,
      // Where the target's copy is, which is where it was copied FROM — not the
      // bin it is in now. `evidence` is what says it is in a bin.
      collection: row.collection ?? '',
      absentPasses: row.absentPasses ?? 0,
      confirmed: true,
      evidence: 'trashed',
    });
  }

  return out;
}

/**
 * Find moves in a domain whose natural key IS the item's location.
 *
 * For files the natural key is the path, so moving a file changes its key. The
 * ledger fast-path therefore MISSES, the loop treats it as a brand-new item and
 * copies it — and because nothing is ever deleted from the target (hard rule
 * 2), the old copy stays put. One drag in the source file manager silently
 * becomes two files on the target, and every later pass keeps them both.
 *
 * Nothing about the new item says where it came from, so it has to be inferred,
 * and it takes both halves to do it honestly:
 *
 *   - the old key is GONE from the collection the ledger recorded it in, and
 *   - an item with the SAME CONTENT appeared somewhere else in the same pass.
 *
 * Either half alone is a different event. A disappearance with no match is a
 * deletion on the source — reported as `drift`, never acted on, per §11.1. An
 * appearance with no disappearance is just a new file.
 *
 * TWO CONDITIONS ARE LOAD-BEARING, and both are enforced by the caller:
 *
 * 1. **Complete key sets only.** A cursor-limited listing returns what changed,
 *    so almost every key the ledger holds would look absent and a routine
 *    incremental pass would report the entire corpus as moved or deleted. The
 *    caller therefore runs this only when every collection was either listed
 *    from the beginning or enumerated via `listCollectionKeys`. That second
 *    route is what makes the detector useful at all: production always
 *    configures cursors, so a full-scan-only gate would fire on the first pass
 *    and never again — for the one domain where a move duplicates data.
 * 2. **File domain only.** Everywhere else the natural key survives a move, so
 *    the direct comparison in `classifyKnownItem` already catches it — and
 *    content-correlating mail would be actively wrong, since identical
 *    messages in two folders are ordinary rather than evidence of anything.
 *
 * The ledger is read for the WHOLE DOMAIN rather than per scanned collection,
 * which is what makes a renamed folder visible. A rename removes the old folder
 * from the source listing entirely, so a query driven by the collections this
 * pass happened to scan would never look at its rows — and every file under it
 * would be silently re-copied under the new folder while the report stayed
 * empty. Reading everything costs one query and holds two short strings per
 * migrated item; the per-collection version read the same rows in more
 * round trips and still missed that case.
 *
 * This runs AFTER the copy, which is not a lucky ordering — it is the only one
 * available. The disappearance is only knowable once every folder has been
 * listed, and by then the new copy exists. So the first pass after a move still
 * produces the duplicate; what changes is that the operator is told, instead of
 * finding it themselves months later.
 */
async function detectPathKeyedMoves(args: {
  tenantId: TenantId;
  mappingId: MappingId;
  domain: 'email' | 'calendar' | 'contact' | 'file';
  ledger: Ledger;
  seenByCollection: ReadonlyMap<string, ReadonlySet<string>>;
  createdThisPass: ReadonlyArray<{ naturalKeyHash: string; contentHash: string; collection: string }>;
}): Promise<{ moves: ItemMove[]; deletions: ItemDeletion[]; drift: number }> {
  const { tenantId, mappingId, domain, ledger, seenByCollection, createdThisPass } = args;

  // Content hash -> the new items carrying it, consumed as they are matched.
  // Consuming matters: three identical files deleted and one created is one
  // move and two deletions, not three moves.
  const arrivals = new Map<string, Array<{ naturalKeyHash: string; collection: string }>>();
  for (const c of createdThisPass) {
    if (!c.contentHash) continue;
    const list = arrivals.get(c.contentHash) ?? [];
    list.push({ naturalKeyHash: c.naturalKeyHash, collection: c.collection });
    arrivals.set(c.contentHash, list);
  }

  const moves: ItemMove[] = [];
  const deletions: ItemDeletion[] = [];
  let drift = 0;

  const placed = await ledger.placedItems(tenantId, mappingId, domain);
  for (const row of placed) {
    // A collection the pass never scanned has an empty seen-set, so everything
    // the ledger holds under it counts as gone — which is exactly right for a
    // folder that was renamed or removed on the source.
    if (seenByCollection.get(row.collection)?.has(row.naturalKeyHash)) {
      // Still where we copied it from. Any move recorded earlier is over, so
      // the queue entry goes too — someone moved the file back.
      if (row.movedToCollection !== undefined) {
        await ledger.clearMove(tenantId, mappingId, domain, row.naturalKeyHash);
      }
      // Same for a run of absences: it is back, so the run is broken. This is
      // what keeps the count CONSECUTIVE — without it a flaky collection would
      // accumulate its way to "confirmed deleted" over a month of unrelated
      // hiccups, none of them adjacent.
      if (row.absentPasses) {
        await ledger.clearAbsent(tenantId, mappingId, domain, row.naturalKeyHash);
      }
      continue;
    }

    // Gone from the source. Whether it moved or was deleted depends on whether
    // its content turned up elsewhere.
    //
    // A row with no content hash cannot be correlated at all, and matching it
    // against every other blank would pair unrelated files. Counted as drift,
    // which is the weaker and therefore safer claim.
    const candidates = row.contentHash ? arrivals.get(row.contentHash) : undefined;
    const at = candidates?.findIndex((c) => c.collection !== row.collection) ?? -1;
    if (candidates && at >= 0) {
      const [match] = candidates.splice(at, 1);
      const to = match!.collection;
      // Consume the arrival either way — it explains this disappearance whether
      // or not anyone has decided about it yet. Leaving it in the pool would let
      // the same new file account for a second, unrelated deletion.
      if (decided(row, to)) continue;
      await ledger.recordMove(tenantId, mappingId, domain, row.naturalKeyHash, to);
      moves.push({ domain, naturalKeyHash: row.naturalKeyHash, from: row.collection, to });
      continue;
    }

    // Gone, with no arrival THIS pass — but we already know where it went.
    //
    // The arrival only exists on the pass that first saw the move: by the next
    // one the file at the new path is an ordinary known item, so nothing is
    // created and there is nothing left to correlate against. Without this the
    // move became permanent drift — reported once as a move and then, forever
    // after, as a deletion of a file that is plainly still there. Correlation
    // is how a move is DISCOVERED; the recorded move is how it is remembered.
    if (row.movedToCollection !== undefined) {
      if (row.moveAcknowledgedAt === undefined) {
        moves.push({
          domain,
          naturalKeyHash: row.naturalKeyHash,
          from: row.collection,
          to: row.movedToCollection,
        });
      }
      continue;
    }

    // GONE, and nothing explains it as a move. Counted rather than concluded:
    // we never observe a deletion, only an absence, and absence has innocent
    // causes that all look identical — a folder briefly missing from discovery,
    // a throttled listing, a connector having a bad ten minutes. The count is
    // what separates "the source no longer has this" from "the source had a bad
    // afternoon", and nothing is reported to a person until it repeats.
    drift += 1;
    const seen = await ledger.recordAbsent(tenantId, mappingId, domain, row.naturalKeyHash);
    if (seen >= DELETION_CONFIRMATIONS && !row.deletionAcknowledgedAt) {
      deletions.push({
        domain,
        naturalKeyHash: row.naturalKeyHash,
        collection: row.collection,
        absentPasses: seen,
        confirmed: true,
        // INFERRED, and the weaker claim of the two on purpose. Nobody told us
        // this was deleted; we stopped seeing it, twice. That is enough to put in
        // front of a person and must never be enough to act on.
        evidence: 'inferred',
      });
    }
  }

  return { moves, deletions, drift };
}
