// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The tier a month bills (workplan 0109 T6; ADR-0014: *"each month still
 * bills what it used, never above the agreed tier"*).
 *
 * What it used is the measured tier (`observedTier`, `currentTier`): the
 * month's peak of migrations at the same time, and the data moved in total,
 * as it counts (the alpha's does not, managed 0040). The agreed tier is the
 * highest the organisation said yes to (`allowanceOf`), Free until the first
 * yes. The month bills the lower of the two: paths fall by themselves, the
 * data sets a floor, and nothing climbs past a yes.
 *
 * When the measurement is past what the month bills, `beyond` says why, so the
 * Billing page can say it (the owner, 2026-10-04): data that bands bought
 * cover (*"tiers buy lanes; top-ups buy room"*, so a top-up keeps the tier);
 * more at the same time than the agreed tier runs; or more moved than its
 * ceiling, where new items wait for a yes.
 *
 * A tier the person picked is the least the month bills (workplan 0157 T6;
 * ADR-0014, *Amendment 2026-10-04, evening*: *"The month bills the higher of
 * the picked tier and the derived one, and the automatic downgrade stops at
 * the picked tier"*). Which pick counts in which month is `pickedFloorOf`'s
 * (tier-pick.ts). A pick is a yes, so it is never above the agreed tier; were
 * one ever, the agreed tier would bill, as nothing climbs past a yes.
 */

import type { Allowance } from './data-ceiling.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

/** Why the measurement is past the tier billed. */
export type BeyondTheTier = 'bands' | 'paths' | 'data';

export interface BilledTier {
  /** The tier the month bills: what it used, never above the agreed tier, never below the pick. */
  readonly tier: ManagedTier;
  /** Empty when the measurement is the tier billed. */
  readonly beyond: readonly BeyondTheTier[];
  /** True when the pick decides it: what was used is below the tier picked. */
  readonly picked: boolean;
}

/**
 * The tier the month bills, from the measured tier (null past Extra large),
 * the agreed allowance, the measurement behind it, and the least the picks let
 * the month bill (`pickedFloorOf(…).now`; null for none).
 */
export function billedTierOf(
  measured: ManagedTier | null,
  allowance: Allowance,
  peakPaths: number,
  gbCounted: number,
  picked: ManagedTier | null = null,
): BilledTier {
  const place = (t: ManagedTier | null) => (t ? MANAGED_TIERS.findIndex((m) => m.id === t.id) : MANAGED_TIERS.length);
  const agreed = allowance.tier;
  // The pick, never above the agreed tier.
  const floor = picked && place(picked) > place(agreed) ? agreed : picked;
  if (measured && place(measured) <= place(agreed)) {
    if (floor && place(floor) > place(measured)) return { tier: floor, beyond: [], picked: true };
    return { tier: measured, beyond: [], picked: false };
  }
  const beyond: BeyondTheTier[] = [];
  if (gbCounted > agreed.dataGb && gbCounted <= allowance.ceilingGb) beyond.push('bands');
  if (peakPaths > agreed.paths) beyond.push('paths');
  if (gbCounted > allowance.ceilingGb) beyond.push('data');
  return { tier: agreed, beyond, picked: false };
}
