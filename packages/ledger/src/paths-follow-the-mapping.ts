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
 */

import { and, eq } from 'drizzle-orm';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';
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

/**
 * Move every included path of one mapping to follow a mapping-status change.
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
  to: MappingStatus,
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

  if (to === 'active') {
    for (const { domain } of included) {
      await store.activate(tenantId as TenantId, mappingId as MappingId, domain as DiscoveryDomain);
    }
    return { moved: included.length, slotsTaken: true };
  }

  // Only rows that exist: a path that never activated has nothing to pause,
  // cut over or finish, and creating one here would either hold a slot for a
  // path that never ran (`paused`) or fabricate a history (`cutover`/`done`).
  const existing = await db
    .select({ domain: schemaPg.pathLifecycle.domain })
    .from(schemaPg.pathLifecycle)
    .where(
      and(eq(schemaPg.pathLifecycle.tenantId, tenantId), eq(schemaPg.pathLifecycle.mappingId, mappingId)),
    );
  const known = new Set(existing.map((r) => r.domain));
  let moved = 0;
  for (const { domain } of included) {
    if (known.has(domain)) {
      await store.moveTo(tenantId as TenantId, mappingId as MappingId, domain as DiscoveryDomain, to);
      moved += 1;
    }
  }
  // `continuous` takes back the slots `cutover` or `done` released (0117 D6),
  // so it raises the peak as a start does. `paused` holds a slot too, but only
  // one a running path already held, so it cannot raise anything.
  return { moved, slotsTaken: moved > 0 && to === 'continuous' };
}
