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
 * rule. What stays here is this edition's half: the month's peak, and the
 * agreed tier's paths.
 *
 * ## A start past the agreed tier waits for the yes (workplan 0109 T6)
 *
 * ADR-0014: *"a path waits for the yes at activation"*. Every door here that
 * takes slots counts the slots held before, moves the paths, then counts again
 * under a lock per organisation (`refusePastTheTier`): a move that took slots
 * and left more held than the agreed tier runs throws `PathsNeedAYes`, and the
 * whole transaction, the status write with it, rolls back. Counted after the
 * move rather than predicted before it, so the rule for which paths move
 * (`pathFollows`) stays in one place. The lock is taken after the move and
 * before the second count, so two starts at once are counted one after the
 * other, each seeing the other's slots once it commits.
 *
 * Only these doors, the customer's. The operator's cutover CLI and the
 * rollback job write through the ledger's own door, unasked: a recovery is not
 * a step up. Not during the alpha (the owner, 2026-10-03: *"A"*).
 */

import {
  PgPathLifecycleStore,
  endOrKeepPath,
  movePathsWithMapping as movePaths,
  stopOrResumePath,
  type PathEndingChange,
  type PathEndingOutcome,
  type PathsChange,
  type PathStopChange,
  type PathStopOutcome,
} from '@openmig/ledger';
import { sql } from 'drizzle-orm';
import {
  PgDataAllowanceStore,
  PgOccupancyPeakStore,
  allowanceOf,
  holdsAtCeiling,
  pathsPastTheTier,
  pathsPastTheTierReason,
  type PathsPastTheTier,
} from '@openmig/managed';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';

type Db = ConstructorParameters<typeof PgPathLifecycleStore>[0];

/**
 * A start that would hold more slots than the agreed tier runs, refused
 * (workplan 0109 T6). Thrown inside the door's transaction, so nothing of the
 * start is kept; the routes answer it with 409 `paths_need_a_yes`
 * (`pathsNeedAYesBody`).
 */
export class PathsNeedAYes extends Error {
  readonly past: PathsPastTheTier;

  constructor(past: PathsPastTheTier) {
    super(pathsPastTheTierReason(past));
    this.name = 'PathsNeedAYes';
    this.past = past;
  }
}

/** The 409 a route answers a `PathsNeedAYes` with: the sentence, the numbers, and the tier that runs them. */
export function pathsNeedAYesBody(error: PathsNeedAYes) {
  const { tier, after, needs } = error.past;
  return {
    error: 'paths_need_a_yes',
    message: error.message,
    reason: error.message,
    tier: { id: tier.id, name: tier.name, paths: tier.paths },
    after,
    needs: needs ? { id: needs.id, name: needs.name, paths: needs.paths } : null,
  };
}

/** How many slots the organisation holds now. */
function slotsHeld(db: Db, tenantId: string): Promise<number> {
  return new PgPathLifecycleStore(db).slotsHeld(tenantId as TenantId);
}

/**
 * Refuse a move that took slots past the agreed tier: the second count, under
 * the organisation's lock, against the highest tier it said yes to.
 */
async function refusePastTheTier(db: Db, tenantId: string, before: number): Promise<void> {
  if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) return;
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'path_slots:' + tenantId}))`);
  const after = await slotsHeld(db, tenantId);
  const allowance = allowanceOf(await new PgDataAllowanceStore(db).grants(tenantId as TenantId));
  const past = pathsPastTheTier(allowance, before, after);
  if (past) throw new PathsNeedAYes(past);
}

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
  change: PathsChange,
): Promise<void> {
  const before = await slotsHeld(db, tenantId);
  const { slotsTaken } = await movePaths(db, tenantId, mappingId, change);
  if (slotsTaken) await refusePastTheTier(db, tenantId, before);
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
  const before = await slotsHeld(db, tenantId);
  await new PgPathLifecycleStore(db).activate(tenantId as TenantId, mappingId as MappingId, domain);
  await refusePastTheTier(db, tenantId, before);
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
  const before = await slotsHeld(db, tenantId);
  const outcome = await stopOrResumePath(db, tenantId, change);
  if ('slotsTaken' in outcome && outcome.slotsTaken) {
    await refusePastTheTier(db, tenantId, before);
    await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId as TenantId);
  }
  return outcome;
}

/**
 * End or keep one data type (0128 T3, T5 slice 7), through the ledger's own
 * door, and raise the month's peak when a data type kept in the lane took a
 * slot it did not hold: same transaction, as every other door that takes
 * slots.
 */
export async function endOrKeepDataType(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  change: PathEndingChange,
): Promise<PathEndingOutcome> {
  const before = await slotsHeld(db, tenantId);
  const outcome = await endOrKeepPath(db, tenantId, change);
  if ('slotsTaken' in outcome && outcome.slotsTaken) {
    await refusePastTheTier(db, tenantId, before);
    await new PgOccupancyPeakStore(db).recordCurrentOccupancy(tenantId as TenantId);
  }
  return outcome;
}
