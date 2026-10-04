// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The question at *Start*, before the press (workplan 0109 T6, the path axis;
 * the owner, 2026-10-04: *"side by side"*).
 *
 * What starting these migrations would do to the slots: the slots held now,
 * each migration's new ones, and the server's own rule on them
 * (`pathsForecast`, which asks `pathsPastTheTier`, the rule the doors refuse
 * by). The page asks the question this answers, with both ways on beside each
 * other: move up and start everything, or start what fits now.
 *
 * A migration's new slots are its included data types that never ran (no
 * path row, or `ready`): the paths a start activates and that hold no slot
 * yet (`pathFollows`). A paused migration's paths kept their slots, so its
 * resume takes none. This is the question, not the refusal: should it
 * undercount, the start is still refused at the door, under the lock, and
 * says so.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { PgPathLifecycleStore } from '@openmig/ledger';
import { pathLifecycle, scopeSelection } from '@openmig/ledger/schema-pg';
import {
  PgDataAllowanceStore,
  allowanceOf,
  pathsForecast,
  type PathsForecast,
  type StartingMigration,
} from '@openmig/managed';
import type { TenantId } from '@openmig/shared';

type Db = ConstructorParameters<typeof PgPathLifecycleStore>[0];

/** Each migration's new slots, in the order asked; a migration with no data type included takes none. */
export async function startingMigrations(
  db: Db,
  tenantId: TenantId,
  mappingIds: readonly string[],
): Promise<StartingMigration[]> {
  if (mappingIds.length === 0) return [];
  const included = await db
    .select({ mappingId: scopeSelection.mappingId, state: pathLifecycle.state })
    .from(scopeSelection)
    .leftJoin(
      pathLifecycle,
      and(eq(pathLifecycle.mappingId, scopeSelection.mappingId), eq(pathLifecycle.domain, scopeSelection.domain)),
    )
    .where(
      and(
        eq(scopeSelection.tenantId, tenantId),
        inArray(scopeSelection.mappingId, [...mappingIds]),
        eq(scopeSelection.included, true),
      ),
    );
  const newSlots = new Map<string, number>();
  for (const row of included) {
    if (row.state === null || row.state === 'ready') {
      newSlots.set(row.mappingId, (newSlots.get(row.mappingId) ?? 0) + 1);
    }
  }
  return mappingIds.map((mappingId) => ({ mappingId, newSlots: newSlots.get(mappingId) ?? 0 }));
}

/** The question at *Start* for these migrations, against the organisation's agreed tier. */
export async function readPathsForecast(
  db: Db,
  tenantId: TenantId,
  mappingIds: readonly string[],
): Promise<PathsForecast> {
  const held = await new PgPathLifecycleStore(db).slotsHeld(tenantId);
  const allowance = allowanceOf(await new PgDataAllowanceStore(db).grants(tenantId));
  return pathsForecast(allowance, held, await startingMigrations(db, tenantId, mappingIds));
}
