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
 * this adds is the order, and the one place where the breaker's own rule
 * reaches past one item.
 *
 * - **In turn.** One item at a time, each answered before the next is
 *   ordered: `applyOne` resolves once the item is decided (the appliance's
 *   answer, or a managed receipt polled to its end). A refusal goes into the
 *   results with its words, and the next item is ordered.
 * - **The breaker stops the rest of its data type.** ADR-0024 gate 6: while
 *   more than a fifth of a data type's migrated items wait to be deleted,
 *   every apply for that data type is refused, because *"once the evidence
 *   looks that wrong in bulk, no single item in the queue — including the
 *   one an operator is looking at — is trustworthy either"*. So once an item
 *   is refused by the breaker, no later item of that data type is ordered in
 *   this run, even if the share has dropped by the time it is reached: the
 *   person pressed before the breaker spoke, and a run that went on would
 *   nibble through a queue somebody is meant to look at (the same reasoning
 *   `autoApplyRelocations` states for its cap). The other data types go on,
 *   each behind its own breaker, as the rule is per data type.
 * - **A stop is honoured between items.** `stopRequested` is asked before
 *   each order: the person's *Stop*, or the page closing. What was ordered
 *   finishes where it runs; nothing after it is ordered.
 * - **A failure is said, not swallowed** (hard rule 9). `applyOne` throwing
 *   is that item's result, and the run goes on: the next item is a press of
 *   its own, through every gate.
 */

import type { DiscoveryDomain } from './discovery.ts';

/** One row the person chose to have removed: its handle and its data type. */
export interface ApplyEachItem {
  readonly naturalKeyHash: string;
  readonly domain: DiscoveryDomain;
}

/**
 * The refusal codes of ADR-0024's breaker (gate 6), for deletions and for
 * relocations. Either one stops the rest of its data type in a run.
 */
export const BREAKER_CODES: ReadonlySet<string> = new Set([
  'mass_deletion_suspected',
  'mass_relocation_suspected',
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
}

/** Why an item was not ordered at all. Nothing was asked about it, and nothing changed. */
export type NotTried =
  /** The breaker refused an earlier item of the same data type in this run. */
  | { readonly by: 'breaker'; readonly code: string; readonly reason: string }
  /** The person stopped the run, or the page went away, before its turn. */
  | { readonly by: 'stop' };

/** What became of one item in a run. */
export type ApplyEachResult<A extends OneApplyAnswer> =
  /** It was ordered, and this is what the press answered. */
  | { readonly item: ApplyEachItem; readonly answered: A }
  /** It was ordered, and the press failed: its fate is for a person to look at. */
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
  // The breaker's answer per data type, from the item it refused.
  const breakerSaid = new Map<DiscoveryDomain, { code: string; reason: string }>();
  let stopped = false;

  const record = (result: ApplyEachResult<A>): void => {
    results.push(result);
    options.onResult?.(result);
  };

  for (const item of items) {
    if (!stopped && options.stopRequested?.() === true) stopped = true;
    if (stopped) {
      record({ item, notTried: { by: 'stop' } });
      continue;
    }
    const breaker = breakerSaid.get(item.domain);
    if (breaker) {
      record({ item, notTried: { by: 'breaker', ...breaker } });
      continue;
    }

    let answered: A;
    try {
      answered = await applyOne(item);
    } catch (err) {
      record({ item, failed: err instanceof Error ? err.message : String(err) });
      continue;
    }
    record({ item, answered });

    if (!answered.ok && answered.code !== undefined && BREAKER_CODES.has(answered.code)) {
      breakerSaid.set(item.domain, { code: answered.code, reason: answered.reason ?? answered.code });
    }
  }
  return results;
}
