// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PATH ROWS MOVE WITH THE MAPPING, AT EVERY DOOR (workplan 0109 T1b).
 *
 * ADR-0014 bills the `(mapping, domain)` PATH, and `path_lifecycle` is its
 * ledger. Until the cutover machine gains a per-path grain (T1c), every
 * lifecycle press lands on the whole mapping, so every included path moves in
 * the SAME transaction as the `mailbox_mapping.status` write: the billing
 * ledger and the product state never disagree about a committed change.
 *
 * This lived in the API (`path-lifecycle-wiring.ts`) and only the API's doors
 * called it: start, finish, the status update and a mapping created running.
 * The operator's cutover CLI and the rollback job write the mapping through
 * `applyMappingStatusChange`, which moved no path at all. So a cutover
 * executed from the CLI left every path `active`, holding its slot through the
 * grace period and after, which is not what `cutover` means (ADR-0014: the
 * slot is free from that instant) and which a future invoice would have
 * billed. A rollback after it left `cutover` rows beside an `active` mapping.
 * One copy, here, serves both: the API's helper and the ledger's own write.
 *
 * Two asymmetries are deliberate, both in the direction that cannot over-bill:
 *
 * - **`active` creates rows** (via `activate`, which stamps
 *   `first_activated_at` exactly once and clears `ended_at`); **every other
 *   state moves only rows that exist.** A pause pressed on a path that never
 *   ran must not conjure a slot-holding row for a path that never cost
 *   anything: absent means `ready`, and `ready` is free.
 * - **Only `included` domains move.** A domain outside the scope selection is
 *   not a path at all.
 *
 * The month's high-water mark (0109 T2) is the managed edition's table, which
 * this package may not write (hard rule 5). The answer says whether slots were
 * taken, and the API's doors record the peak on it. A write through the
 * ledger's own door (the CLI, the rollback job) records it through
 * `applyMappingStatusChange`'s `onSlotsTaken`, which both pass.
 *
 * ## Each path in its own phase (workplan 0128 T5, slice 5a)
 *
 * Once a data type can be cut over on its own (slice 5b), a migration's paths
 * are not all in one phase: mail in its cutover while files still copy before
 * theirs. A press on the whole migration then moves only the paths in the
 * phase the migration leaves (`pathFollows`). Pausing, resuming or starting
 * the rest does not move mail back before its cutover, which would bring its
 * deletion detectors back (0117 D4). Where the rows do not add up to the
 * status (something wrote the status alone), the status is every path's
 * phase, as the reader believes it (`readPathPhases`), and every path moves,
 * as before.
 */

import { and, eq } from 'drizzle-orm';
import { rollUpPhases, type DiscoveryDomain, type MappingId, type TenantId } from '@openmig/shared';
import * as schemaPg from './schema-pg.ts';
import { PgPathLifecycleStore } from './path-lifecycle-store.ts';
import type { MappingStatus } from './mapping-status-audit.ts';

/** What moving the paths did: whether it took slots, so the caller can raise the month's peak. */
export interface PathsMoved {
  /** Paths moved (or created, for `active`). */
  readonly moved: number;
  /** True when the paths now hold slots they may not have held before: `active` and `continuous`. */
  readonly slotsTaken: boolean;
}

/** A mapping-status change, as its paths follow it: the status it leaves (none for a new one), and the one it takes. */
export interface PathsChange {
  readonly from: string | null;
  readonly to: MappingStatus;
}

/**
 * Whether one path moves with its migration's status change (0128 T5, slice
 * 5a), given its own phase (undefined: it has no row, it never ran) and
 * whether the migration's rows are believed (they add up to the status it
 * leaves).
 *
 * Believed, a path moves when it is in the phase the migration leaves: a data
 * type cut over on its own stays where it is when the rest is paused, resumed
 * or started. `done` ends every path, and `active` also starts one that never
 * ran. Not believed, every path moves, as every one did before.
 */
export function pathFollows(change: PathsChange, phase: string | undefined, believed: boolean): boolean {
  if (change.to === 'active') return phase === undefined || phase === 'ready' || !believed || phase === change.from;
  if (phase === undefined) return false;
  if (!believed) return true;
  return change.to === 'done' ? phase !== 'done' : phase === change.from;
}

/**
 * Move the included paths of one mapping to follow a mapping-status change:
 * the ones `pathFollows` says move.
 *
 * Call it inside the SAME transaction as the `mailbox_mapping.status` write,
 * after that write. The five mapping states map one-to-one onto ADR-0014's
 * path states of the same name; `ready` has no mapping spelling, because it
 * is the state of never having moved at all.
 */
export async function movePathsWithMapping(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  mappingId: string,
  change: PathsChange,
): Promise<PathsMoved> {
  const included = await db
    .select({ domain: schemaPg.scopeSelection.domain })
    .from(schemaPg.scopeSelection)
    .where(
      and(
        eq(schemaPg.scopeSelection.tenantId, tenantId),
        eq(schemaPg.scopeSelection.mappingId, mappingId),
        eq(schemaPg.scopeSelection.included, true),
      ),
    );
  if (included.length === 0) return { moved: 0, slotsTaken: false };

  const store = new PgPathLifecycleStore(db);
  // Each included path's own phase; one with no row never ran. Only rows that
  // exist move to anything but `active`: a path that never activated has
  // nothing to pause, cut over or finish, and creating one here would either
  // hold a slot for a path that never ran (`paused`) or fabricate a history
  // (`cutover`/`done`).
  const existing = await db
    .select({ domain: schemaPg.pathLifecycle.domain, state: schemaPg.pathLifecycle.state })
    .from(schemaPg.pathLifecycle)
    .where(
      and(eq(schemaPg.pathLifecycle.tenantId, tenantId), eq(schemaPg.pathLifecycle.mappingId, mappingId)),
    );
  const phaseOf = new Map<string, string>(existing.map((r) => [r.domain, r.state]));
  const phases = included.map(({ domain }) => phaseOf.get(domain)).filter((p): p is string => p !== undefined);
  const believed = rollUpPhases(phases) === change.from;

  let moved = 0;
  for (const { domain } of included) {
    if (!pathFollows(change, phaseOf.get(domain), believed)) continue;
    if (change.to === 'active') {
      await store.activate(tenantId as TenantId, mappingId as MappingId, domain as DiscoveryDomain);
    } else {
      await store.moveTo(tenantId as TenantId, mappingId as MappingId, domain as DiscoveryDomain, change.to);
    }
    moved += 1;
  }
  // `active` takes slots, and `continuous` takes back the ones `cutover` or
  // `done` released (0117 D6), so both raise the peak. `paused` holds a slot
  // too, but only one a running path already held, so it cannot raise anything.
  return { moved, slotsTaken: moved > 0 && (change.to === 'active' || change.to === 'continuous') };
}
