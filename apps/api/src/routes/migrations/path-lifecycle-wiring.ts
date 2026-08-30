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
 * Two asymmetries are deliberate, both in the direction that cannot over-bill:
 *
 * - **`active` creates rows** (via `activate`, which stamps
 *   `first_activated_at` exactly once and clears `ended_at`); **every other
 *   state moves only rows that exist.** A pause pressed on a path that never
 *   ran must not conjure a slot-holding row for a path that never cost
 *   anything — absent means `ready`, and `ready` is free (T1a's rule).
 * - **Only `included` domains move.** A domain outside the scope selection is
 *   not a path at all, and this helper is one of the places that keeps that
 *   true at every press.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgPathLifecycleStore } from '@openmig/ledger';
import type { PathDomain } from '@openmig/ledger';
import type { MappingId, TenantId } from '@openmig/shared';
import type { MappingStatus } from './mapping-status-audit.ts';

/**
 * Move every included path of one mapping to follow a mapping-status change.
 *
 * Call it inside the SAME transaction as the `mailbox_mapping.status` write,
 * after that write. The four mapping states map one-to-one onto ADR-0014's
 * path states of the same name; `ready` has no mapping spelling because it is
 * the state of never having moved at all.
 */
export async function movePathsWithMapping(
  db: ConstructorParameters<typeof PgPathLifecycleStore>[0],
  tenantId: string,
  mappingId: string,
  to: MappingStatus,
): Promise<void> {
  const included = await db
    .select({ domain: schema.scopeSelection.domain })
    .from(schema.scopeSelection)
    .where(
      and(
        eq(schema.scopeSelection.tenantId, tenantId),
        eq(schema.scopeSelection.mappingId, mappingId),
        eq(schema.scopeSelection.included, true),
      ),
    );
  if (included.length === 0) return;

  const store = new PgPathLifecycleStore(db);

  if (to === 'active') {
    for (const { domain } of included) {
      await store.activate(tenantId as TenantId, mappingId as MappingId, domain as PathDomain);
    }
    return;
  }

  // Only rows that exist: a path that never activated has nothing to pause,
  // cut over or finish, and creating one here would either hold a slot for a
  // path that never ran (`paused`) or fabricate a history (`cutover`/`done`).
  const existing = await db
    .select({ domain: schema.pathLifecycle.domain })
    .from(schema.pathLifecycle)
    .where(
      and(
        eq(schema.pathLifecycle.tenantId, tenantId),
        eq(schema.pathLifecycle.mappingId, mappingId),
      ),
    );
  const moved = new Set(existing.map((r) => r.domain));
  for (const { domain } of included) {
    if (moved.has(domain)) {
      await store.moveTo(tenantId as TenantId, mappingId as MappingId, domain as PathDomain, to);
    }
  }
}
