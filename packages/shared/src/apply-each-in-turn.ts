// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE OWNER ACTION, MANY ITEMS, EACH DECIDED BY ITSELF (workplan 0164 T3;
 * ADR-0024, amended 2026-11-21).
 *
 * *Delete all of these here too* on *Deleted on the old system* orders the
 * removals the page shows, and this is the loop it orders them with. It does
 * not remove anything and it decides nothing about an item: `applyOne` is the
 * press a single *Delete it here too* makes, through the same route and the
 * same `applyDeletion`, so every gate stands in front of every item. What
 * this adds is the order, and when the run stops.
 *
 * - **In turn.** The next item is ordered only once the one before it has
 *   answered: `applyOne` resolves when the item is decided (the appliance's
 *   answer, or a managed receipt read to its end). A refusal of that item
 *   alone goes into the results with its words, and the next item is
 *   ordered.
 * - **A press that did not answer stops the run.** `applyOne` throwing (a
 *   fault, a time-out, a receipt that failed or never landed) is that item's
 *   result, and nothing after it is ordered (`notTried: 'failure'`): its
 *   removal may still be running, or have happened, and a next press would
 *   run beside it, perhaps past a refusal the first one never got to say.
 * - **A refusal that speaks for every item stops the run.** The breaker
 *   (ADR-0024 gate 6) refuses every apply while the queue looks like a source
 *   problem, because *"once the evidence looks that wrong in bulk, no single
 *   item in the queue — including the one an operator is looking at — is
 *   trustworthy either"*, and what it suspects (a restored account, an
 *   outage, the wrong place read) is the whole account's, not one data
 *   type's. So once an item is refused by it, nothing after it is ordered in
 *   this run, of any data type, even if the share has dropped by then: the
 *   person pressed before the breaker spoke, and a run that went on would
 *   nibble through a queue somebody is meant to look at (the reasoning
 *   `autoApplyRelocations` states for its cap). The cost is one more press,
 *   made afresh. (Until alpha.21, deleting by hand turned off, `not_enabled`,
 *   stopped it the same way; that switch is gone, ADR-0024, 2026-11-25.)
 * - **A removal the ledger could not record stops the run.**
 *   `removed_not_recorded` is the one answer that proves the ledger changed
 *   under a removal: a pass saw the item back on the old system, or another
 *   tab removed it first. The list the person confirmed is then not the one
 *   being deleted from (a folder restored at the source mid-run is the
 *   case: its next items are still reported until the pass reaches them), so
 *   nothing after it is ordered. Its own copy is gone all the same.
 * - **Evidence withdrawn during the run stops it too.** Every item had
 *   positive evidence when the list was read again (`mayOfferApply`), so an
 *   item refused `not_confirmed` (no evidence left) or `weak_evidence` (only
 *   absence left) lost it after the confirmation: a pass saw it back on the
 *   old system. That is the same sign that the list changed under the run,
 *   and the items after it, still reported only because the pass has not
 *   reached them yet, are not ordered.
 * - **An answer marked `stopsTheRun` stops it too**: the caller's word that
 *   nothing was started for that item, for a reason the next press would
 *   meet as well (on managed: the operator's hold, a closed account, a
 *   removal that could not be queued).
 * - **A stop is honoured between items.** `stopRequested` is asked before
 *   each order: the person's *Stop*, or the page closing. What was ordered
 *   finishes where it runs; nothing after it is ordered.
 * - **Every item gets exactly one result**, in the order given, and a failure
 *   is said, never swallowed (hard rule 9).
 */

import type { DiscoveryDomain } from './discovery.ts';

/** One row the person chose to have removed: its handle and its data type. */
export interface ApplyEachItem {
  readonly naturalKeyHash: string;
  readonly domain: DiscoveryDomain;
}

/** The refusal codes of ADR-0024's breaker (gate 6), for deletions and for relocations. */
export const BREAKER_CODES: ReadonlySet<string> = new Set([
  'mass_deletion_suspected',
  'mass_relocation_suspected',
]);

/**
 * The refusals that stop a run: the breaker's, a
 * removal the ledger could not record, and evidence withdrawn after the
 * confirmation (`not_confirmed`, `weak_evidence`). Each says something about
 * every item after it, not only about its own.
 */
export const RUN_STOPPING_REFUSALS: ReadonlySet<string> = new Set([
  ...BREAKER_CODES,
  'removed_not_recorded',
  'not_confirmed',
  'weak_evidence',
]);

/**
 * What one press answered, as far as this loop needs to read it: whether it
 * went through, and when it did not, the gate's code and words. A press's
 * answer may carry more (how final the removal was, the Dutch of a line);
 * the loop hands it on untouched.
 */
export interface OneApplyAnswer {
  readonly ok: boolean;
  readonly code?: string;
  readonly reason?: string;
  /**
   * Nothing was started for this item, for a reason that holds for the next
   * press too, though its code is no gate's: nothing after it is ordered.
   */
  readonly stopsTheRun?: boolean;
}

/** Why an item was not ordered at all. Nothing was asked about it, and nothing changed. */
export type NotTried =
  /**
   * An earlier item's answer stopped the run: the breaker's,
   * `removed_not_recorded`, evidence withdrawn, or one marked `stopsTheRun`.
   */
  | { readonly by: 'refusal'; readonly code: string; readonly reason: string }
  /** An earlier press did not answer, so nothing more was ordered. */
  | { readonly by: 'failure' }
  /** The person stopped the run, or the page went away, before its turn. */
  | { readonly by: 'stop' };

/** What became of one item in a run. */
export type ApplyEachResult<A extends OneApplyAnswer> =
  /** It was ordered, and this is what the press answered. */
  | { readonly item: ApplyEachItem; readonly answered: A }
  /** It was ordered, and the press did not answer: its fate is not known. */
  | { readonly item: ApplyEachItem; readonly failed: string }
  /** It was not ordered. */
  | { readonly item: ApplyEachItem; readonly notTried: NotTried };

export interface ApplyEachOptions<A extends OneApplyAnswer> {
  /** Asked before each order. True orders nothing more. */
  readonly stopRequested?: () => boolean;
  /** Told each result as it is known, in the run's order. */
  readonly onResult?: (result: ApplyEachResult<A>) => void;
}

/**
 * Order each item's removal in turn, through `applyOne`, and say what became
 * of each. Every item gets exactly one result, in the order given.
 */
export async function applyEachInTurn<A extends OneApplyAnswer>(
  items: readonly ApplyEachItem[],
  applyOne: (item: ApplyEachItem) => Promise<A>,
  options: ApplyEachOptions<A> = {},
): Promise<ApplyEachResult<A>[]> {
  const results: ApplyEachResult<A>[] = [];
  // Once set, every item after it is not tried, for this reason.
  let stoppedBy: NotTried | undefined;

  const record = (result: ApplyEachResult<A>): void => {
    results.push(result);
    options.onResult?.(result);
  };

  for (const item of items) {
    if (stoppedBy === undefined && options.stopRequested?.() === true) stoppedBy = { by: 'stop' };
    if (stoppedBy !== undefined) {
      record({ item, notTried: stoppedBy });
      continue;
    }

    let answered: A;
    try {
      answered = await applyOne(item);
    } catch (err) {
      record({ item, failed: err instanceof Error ? err.message : String(err) });
      stoppedBy = { by: 'failure' };
      continue;
    }
    record({ item, answered });

    if (
      !answered.ok &&
      answered.code !== undefined &&
      (answered.stopsTheRun === true || RUN_STOPPING_REFUSALS.has(answered.code))
    ) {
      stoppedBy = { by: 'refusal', code: answered.code, reason: answered.reason ?? answered.code };
    }
  }
  return results;
}
