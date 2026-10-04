// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A start past the agreed tier's paths waits for the yes (workplan 0109 T6,
 * the path axis; ADR-0014: *"a path waits for the yes at activation"*).
 *
 * The owner's answers of 2026-10-04: one agreed tier for both axes (A), the
 * question at *Start* with both ways side by side, and **enforced by the
 * server**, so the starts that happen with nobody on the page (a migration that
 * starts when its person connects, a data type added to a running migration,
 * the continuous lane) cannot cross the line unasked either.
 *
 * ## The agreed tier
 *
 * The highest tier the organisation said yes to, on either axis: the same
 * append-only rows as the data ceiling (`data_allowance`, `allowanceOf`). Free
 * until the first yes. Its paths are how many may hold a slot at the same time.
 *
 * ## When a start is refused
 *
 * Only when it TAKES slots and leaves more held than the agreed tier runs. A
 * start that takes none (a resume of a paused migration, which kept its slots)
 * is never refused, so an organisation already past its tier (one that ran
 * during the alpha) can pause and resume what runs, and only cannot add more.
 * The bill is never the reason a running migration stops: ADR-0014, *"it must
 * under-bill, never halt"*.
 *
 * Not during the alpha (the owner, 2026-10-03: *"A"*): that is the callers'
 * rule, through `holdsAtCeiling`, as for the data ceiling.
 */

import type { Allowance } from './data-ceiling.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** Why a start waits: what it would hold, what the agreed tier runs, and the tier that runs it. */
export interface PathsPastTheTier {
  /** The agreed tier: the highest the organisation said yes to; Free until the first yes. */
  readonly tier: ManagedTier;
  /** Paths holding a slot once the start is done. */
  readonly after: number;
  /** The smallest tier that runs them all; null past Extra large, where the answer is "talk to us". */
  readonly needs: ManagedTier | null;
}

/**
 * Whether a start that leaves `after` slots held, where `before` were held,
 * goes past the agreed tier; null when it may go ahead.
 */
export function pathsPastTheTier(allowance: Allowance, before: number, after: number): PathsPastTheTier | null {
  if (after <= before || after <= allowance.tier.paths) return null;
  return { tier: allowance.tier, after, needs: MANAGED_TIERS.find((t) => t.paths >= after) ?? null };
}

/** The refusal in words: the customer's numbers, the tier that runs them, and the other way, starting fewer. */
export function pathsPastTheTierReason(past: PathsPastTheTier): string {
  const now =
    `Starting this would make ${past.after} migrations at the same time (each kind of data counts as one), ` +
    `and ${past.tier.name} runs ${past.tier.paths}.`;
  return past.needs
    ? `${now} ${past.needs.name} runs ${past.needs.paths}: move up to it, or start fewer at the same time.`
    : `${now} Past ${MANAGED_TIERS[MANAGED_TIERS.length - 1]!.name}, talk to us, or start fewer at the same time.`;
}
