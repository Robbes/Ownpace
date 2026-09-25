// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The path rows move WITH the mapping (workplan 0109 T1b, the wiring half).
 *
 * ADR-0014 bills the `(mapping, domain)` PATH, and `path_lifecycle` is its
 * ledger (T1a: migration 0035, `PgPathLifecycleStore`). Until the cutover
 * machine gains a per-path grain (T1c), every lifecycle press still lands on
 * the whole mapping — so this helper moves every included path in the SAME
 * `withTenantDb` transaction as the `mailbox_mapping.status` write, keeping
 * the billing ledger and the product state from ever disagreeing about a
 * committed change. Taking `db` as a parameter rather than opening its own
 * connection is what makes "same transaction" impossible to get wrong —
 * `recordMappingStatusChange` established the pattern.
 *
 * The moving itself lives in the ledger since 2026-09-24
 * (`paths-follow-the-mapping.ts`, with its two deliberate asymmetries), so the
 * cutover CLI's and the rollback job's writes move the same rows by the same
 * rule. What stays here is this edition's half: the month's peak.
 */

import {
  PgPathLifecycleStore,
  movePathsWithMapping as movePaths,
  stopOrResumePath,
  type PathStopChange,
  type PathStopOutcome,
} from '@openmig/ledger';
import { PgOccupancyPeakStore } from '@openmig/managed';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';
import type { MappingStatus } from './mapping-status-audit.ts';

/**
 * Move every included path of one mapping to follow a mapping-status change,
 * and raise the month's peak when that took slots.
 *
 * Call it inside the SAME transaction as the `mailbox_mapping.status` write,
 * after that write. The moving is the ledger's (`movePathsWithMapping` there),
 * the one copy the CLI's and the rollback job's writes use too; the peak is
 * this edition's, and it rises on `active` and on `continuous`, which takes
 * back the slots a cutover released (0117 D6).
 */
export async function movePathsWithMapping(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  mappingId: string,
  to: MappingStatus,
): Promise<void> {
  const { slotsTaken } = await movePaths(db, tenantId, mappingId, to);
  // The month's high-water mark rises with the slots just taken (0109 T2) —
  // same transaction, so a committed activation cannot miss its peak. This
  // file is the managed API's; the appliance never imports these routes,
  // which is what lets a managed-chain table be written here (hard rule 5).
  if (slotsTaken) await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId as TenantId);
}

/**
 * A kind added to a RUNNING migration takes its slot now (workplan 0125 T6).
 *
 * Only its own path. `movePathsWithMapping(…, 'active')` would re-activate
 * every included path, and a path whose state has moved on from the
 * mapping's must not be pulled back to `active` because an unrelated kind
 * joined. A paused migration does not call this: its new kind takes its slot
 * with the rest when it is started again.
 *
 * Same transaction as the `scope_selection` insert, for the reason this file
 * exists: the billing ledger and the product state never disagree about a
 * committed change.
 */
export async function activateAddedPath(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  mappingId: string,
  domain: DiscoveryDomain,
): Promise<void> {
  await new PgPathLifecycleStore(db).activate(tenantId as TenantId, mappingId as MappingId, domain);
  // The month's high-water mark rises with the slot, as it does on a start.
  await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId as TenantId);
}

/**
 * Stop or resume one data type (0128 T4), through the ledger's own door, and
 * raise the month's peak when a resume in the lane took back its slot (D2 (c)):
 * same transaction, as every other door that takes slots.
 */
export async function stopOrResumeDataType(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  change: PathStopChange,
): Promise<PathStopOutcome> {
  const outcome = await stopOrResumePath(db, tenantId, change);
  if ('slotsTaken' in outcome && outcome.slotsTaken) {
    await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId as TenantId);
  }
  return outcome;
}
