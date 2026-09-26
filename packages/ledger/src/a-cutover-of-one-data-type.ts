// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CUTOVER OF ONE DATA TYPE (workplan 0128 T5, slice 5b; the owner's D8:
 * *"someone might want to keep syncing some kinds, like keeps files running,
 * while email cutover/stops"*).
 *
 * The core's steps (`enterCutover`, `closeCutover`, `performRollback`) move a
 * cutover ledger and the lifecycle beside it. For the whole migration those
 * are its ledger and its status. For one data type they are its own ledger
 * (`bindCutoverLedger`) and its own path (`pathLifecyclePort`, here): the same
 * steps, the same rules (`cutoverTransition` and `rollbackTransition`, asked of
 * the path's phase, which uses the same words), and nothing else of the
 * migration moves.
 *
 * The migration's status is then its paths' roll-up (`rollUpPhases`), written
 * in the same transaction as the path, so the lists, the digest and every gate
 * that still reads the status keep one answer with the rows the reader
 * believes (`readPathPhases`). Mail cut over while calendars copy is an
 * `active` migration with a path in `cutover`; with every data type cut over it
 * is in `cutover`.
 *
 * Every move is recorded twice over, in the move's transaction: the path's own
 * (`path.phase`), and the migration's (`mapping.status`) when the roll-up moved
 * it.
 */

import { and, eq } from 'drizzle-orm';
import { rollUpPhases, type DiscoveryDomain, type MappingId, type TenantId } from '@openmig/shared';
import type { MappingLifecyclePort } from '@openmig/core/cutover-lifecycle';
import type { Pool } from 'pg';
import * as schemaPg from './schema-pg.ts';
import { withTenant, type PgDatabase } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { PgLedger } from './ledger.ts';
import { PgPathLifecycleStore } from './path-lifecycle-store.ts';
import {
  recordMappingStatusChange,
  type MappingStatus,
  type MappingStatusChangeOptions,
  type MappingStatusVia,
} from './mapping-status-audit.ts';

/** The audit action a data type's own phase change is recorded under (0128 T5, slice 5b). */
export const PATH_PHASE_ACTION = 'path.phase';

/** One data type's phase moving, through its own cutover or rollback. */
export interface PathPhaseChange {
  readonly mappingId: string;
  readonly domain: DiscoveryDomain;
  /** Its phase before, as the reader believed it. */
  readonly from: string;
  readonly to: MappingStatus;
  /** Who pressed it: `'cli'`, `'trigger-job'`. */
  readonly actor: string;
  readonly via: MappingStatusVia;
}

/** The migration's status and its included paths' own phases. Null when the migration is gone. */
async function readTheMigration(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<{ status: string; phases: Map<string, string> } | null> {
  const [row] = await db
    .select({ status: schemaPg.mailboxMapping.status })
    .from(schemaPg.mailboxMapping)
    .where(and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)));
  if (row === undefined) return null;
  const rows = await db
    .select({ domain: schemaPg.pathLifecycle.domain, state: schemaPg.pathLifecycle.state })
    .from(schemaPg.pathLifecycle)
    .innerJoin(
      schemaPg.scopeSelection,
      and(
        eq(schemaPg.scopeSelection.mappingId, schemaPg.pathLifecycle.mappingId),
        eq(schemaPg.scopeSelection.domain, schemaPg.pathLifecycle.domain),
        eq(schemaPg.scopeSelection.included, true),
      ),
    )
    .where(eq(schemaPg.pathLifecycle.mappingId, mappingId));
  return { status: row.status, phases: new Map(rows.map((r) => [r.domain, r.state])) };
}

/**
 * Move one data type's path, write the migration's status as its paths'
 * roll-up, and record both, in one transaction.
 *
 * `active` keeps the date the path first ran (`activate`), and a path in
 * `active` or `continuous` holds a slot again, so `onSlotsTaken` runs, as at
 * the whole migration's door.
 */
export async function applyPathStatusChange(
  source: LedgerDriver | Pool,
  tenantId: string,
  change: PathPhaseChange,
  options: MappingStatusChangeOptions = {},
): Promise<void> {
  await withTenant(source, tenantId, async (db) => {
    const store = new PgPathLifecycleStore(db);
    const t = tenantId as TenantId;
    const m = change.mappingId as MappingId;
    if (change.to === 'active') await store.activate(t, m, change.domain);
    else await store.moveTo(t, m, change.domain, change.to);

    const migration = await readTheMigration(db, tenantId, change.mappingId);
    if (migration === null) throw new Error(`Mapping ${change.mappingId} was not found for tenant ${tenantId}.`);
    const rolled = rollUpPhases([...migration.phases.values()]) as MappingStatus | undefined;
    if (rolled !== undefined && rolled !== migration.status) {
      await db
        .update(schemaPg.mailboxMapping)
        .set({ status: rolled, updatedAt: new Date() })
        .where(and(eq(schemaPg.mailboxMapping.id, change.mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)));
      await recordMappingStatusChange(db, tenantId, {
        mappingId: change.mappingId,
        from: migration.status,
        to: rolled,
        actor: change.actor,
        via: change.via,
      });
    }
    await new PgLedger(db).recordAuditEvent(t, {
      actor: change.actor,
      action: PATH_PHASE_ACTION,
      entity: 'mapping',
      detail: {
        mappingId: change.mappingId,
        domain: change.domain,
        from: change.from,
        to: change.to,
        via: change.via,
      },
    });
    if ((change.to === 'active' || change.to === 'continuous') && options.onSlotsTaken) await options.onSlotsTaken(db);
  });
}

/**
 * One data type's path, as the core's cutover steps and rollback ask for a
 * migration's lifecycle (`MappingLifecyclePort`): its phase as the reader
 * believes it (its own row where the rows add up to the status, the status
 * where they do not or it has none), and a move of it alone, with the status
 * as the roll-up (`applyPathStatusChange`).
 */
export function pathLifecyclePort(
  source: LedgerDriver | Pool,
  tenantId: string,
  mappingId: string,
  domain: DiscoveryDomain,
  actor: string,
  options: MappingStatusChangeOptions = {},
): MappingLifecyclePort {
  return {
    async readStatus() {
      const migration = await withTenant(source, tenantId, (db) => readTheMigration(db, tenantId, mappingId));
      if (migration === null) throw new Error(`Mapping ${mappingId} was not found for tenant ${tenantId}.`);
      const own = migration.phases.get(domain);
      const believed = rollUpPhases([...migration.phases.values()]) === migration.status;
      return believed && own !== undefined ? own : migration.status;
    },
    async setStatus(change) {
      await applyPathStatusChange(
        source,
        tenantId,
        { mappingId, domain, from: change.from, to: change.to, actor, via: change.via },
        options,
      );
    },
  };
}
