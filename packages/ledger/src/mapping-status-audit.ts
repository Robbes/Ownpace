// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A mapping's status changes are recorded (workplan 0109 T1's second finding).
 *
 * ADR-0014's consequence 2 flagged `audit_log` coverage of lifecycle
 * transitions as unverified. It was verified while writing 0109 and the answer
 * was no: every `recordAuditEvent` call site fired on shares, connections,
 * relocations or the scheduling probe, and **none on a mapping changing
 * state**. So "who paused this, and when, and from what" had no answer
 * anywhere — the row simply held a different value than it used to.
 *
 * `updated_at` (fixed alongside this) says WHEN something changed. It cannot
 * say what it changed FROM, or who did it, and those are the two questions
 * actually asked when a migration is found in a state nobody expected.
 *
 * ## Written in the caller's transaction, deliberately
 *
 * Every API call site is already inside `withTenantDb`, which opens a real
 * transaction (`db.ts` — BEGIN, `SET LOCAL ROLE`, then COMMIT or ROLLBACK).
 * Passing the same `db` in means the status change and its record commit
 * together or not at all, which removes the question this would otherwise
 * have to answer badly: whether a failed audit write should abort somebody's
 * migration (refusing to finish because a log table hiccuped) or be swallowed
 * (the record silently absent, which is the failure this file exists to
 * prevent). Atomic is neither. `connections.ts` already writes an audit event
 * this way; this follows it.
 *
 * ## Moved here from `apps/api` on 2026-09-19 (ADR-0047)
 *
 * The worker's rollback is the one lifecycle write that lived outside the
 * API, and it wrote `mailbox_mapping` with no record at all — the exact gap
 * 0109 closed for every other transition, on the transition most worth
 * recording. The helper moved to the ledger so the worker can leave the same
 * row the API leaves; `apps/api/src/routes/migrations/mapping-status-audit.ts`
 * re-exports it so nothing there changed. `applyMappingStatusChange` and
 * `mappingLifecyclePort` are the pieces the worker needed on top: the row and
 * its record in ONE transaction, and the port `performRollback` asks for.
 */

import { and, eq } from 'drizzle-orm';
import type { TenantId } from '@openmig/shared';
import type { MappingLifecyclePort } from '@openmig/core/cutover-lifecycle';
import type { Pool } from 'pg';
import { PgLedger } from './ledger.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import * as schemaPg from './schema-pg.ts';
import { movePathsWithMapping } from './paths-follow-the-mapping.ts';

/** The audit action every mapping status transition is recorded under. */
export const MAPPING_STATUS_ACTION = 'mapping.status';

/**
 * The states `mailbox_mapping.status` may hold — five since 2026-09-10.
 *
 * `continuous` is 0117 T1's lane (ledger migration 0044, which widens this
 * CHECK and `path_lifecycle.state`'s together). It is listed here because a
 * transition INTO it is exactly the kind somebody will later need to explain:
 * "who put this migration into a phase that keeps reading the old account, and
 * when" is the question this file exists to answer.
 *
 * Kept as its own union rather than derived because it names the DATABASE's
 * vocabulary — migration 0001's CHECK as amended — and the typechecker caught
 * this file the moment the schema widened, which is the behaviour worth
 * keeping. `PATH_STATES` is the separate, billing-side vocabulary and has one
 * value this does not (`ready`).
 */
export type MappingStatus = 'active' | 'paused' | 'cutover' | 'done' | 'continuous';

/**
 * How a status change was reached — the route, in the operator's vocabulary.
 * `rollback` (ADR-0047) and `cutover` (ADR-0048) are the worker's, through the
 * cutover CLI; the other three are the API's.
 */
export type MappingStatusVia = 'start' | 'update' | 'finish' | 'rollback' | 'cutover';

/** The database handle the ledger writes through — a pool's, or a transaction's. */
type Db = ConstructorParameters<typeof PgLedger>[0];

export interface MappingStatusChange {
  readonly mappingId: string;
  readonly from: string;
  readonly to: MappingStatus;
  /** Who pressed it. `req.userId`, `'cli'`, `'trigger-job'`, or 'unknown'. */
  readonly actor: string;
  readonly via: MappingStatusVia;
  /** Set when the operator forced past unresolved failures (finish only). */
  readonly forced?: boolean;
}

/**
 * What a caller outside the API adds to a status change through the ledger's
 * own door (workplan 0109 T2).
 */
export interface MappingStatusChangeOptions {
  /**
   * Run in the change's own transaction, after its paths moved, when they took
   * slots: `active`, or `continuous`, which takes back what a cutover released.
   * The managed edition raises the month's peak here, in a table this package
   * may not write (hard rule 5), so the mark rises with the slots it counts.
   * Omitted, nothing but the ledger's own rows is written.
   */
  readonly onSlotsTaken?: (db: Db) => Promise<void>;
}

/**
 * Record that a mapping moved from one status to another.
 *
 * A no-op when `from === to`. A PATCH that sets the status a mapping already
 * has is a request, not a transition, and an audit log that records
 * non-events is one nobody reads — which makes the events that matter harder
 * to find, not easier.
 *
 * `db` must be the handle from the SAME transaction as the status write, so
 * the two commit together. Taking it as a parameter rather than opening its
 * own connection is what makes that impossible to get wrong.
 */
export async function recordMappingStatusChange(
  db: Db,
  tenantId: string,
  change: MappingStatusChange,
): Promise<void> {
  if (change.from === change.to) return;
  await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
    actor: change.actor,
    action: MAPPING_STATUS_ACTION,
    // `entity` is the KIND of thing, and the id rides in `detail` — the shape
    // both existing call sites use (`connection.qualified` in `connections.ts`
    // writes `entity: 'connection'` with `connectionId` in the detail). The
    // table does have an `entity_id uuid` column, unused by every writer in
    // the repo and better suited to this; using it here would make a third
    // shape a reader has to know about, so it stays consistent instead.
    entity: 'mapping',
    detail: {
      mappingId: change.mappingId,
      from: change.from,
      to: change.to,
      via: change.via,
      ...(change.forced === true ? { forced: true } : {}),
    },
  });
}

/**
 * The row, its paths AND its record, in one transaction.
 *
 * The API's call sites do these two steps inside `withTenantDb`'s
 * transaction; a caller outside the API has no such wrapper, and two separate
 * statements would be exactly the "committed status, no record of it" state
 * the file header rules out. So this opens the same kind of transaction the
 * API has — `withTenant`: one connection, BEGIN, the tenant context set, COMMIT
 * or ROLLBACK — rather than drizzle's own `db.transaction`, which nothing in
 * this repository uses and whose handle the ledger's types do not accept.
 *
 * `updatedAt` is stamped here, not left to the database: there is no trigger
 * on this table (workplan 0109 T1), so a writer that omits it leaves the
 * column reading whenever somebody last touched the row for another reason.
 *
 * The mapping's path rows move with it (`movePathsWithMapping`), as they do
 * at every door the API serves. Without it a cutover executed from the CLI
 * kept every path `active`, holding its slot after the cutover had released
 * it. The month's peak is not written by this package: it is the managed
 * edition's table. A caller that has one passes `onSlotsTaken`, and the peak
 * rises in the same transaction as the slots it counts. Until 2026-09-24 no
 * caller did, and a comment here said the next read of the tier would true it
 * up, but nothing in production reads it that way.
 */
export async function applyMappingStatusChange(
  source: LedgerDriver | Pool,
  tenantId: string,
  change: MappingStatusChange,
  options: MappingStatusChangeOptions = {},
): Promise<void> {
  await withTenant(source, tenantId, async (db) => {
    await db
      .update(schemaPg.mailboxMapping)
      .set({ status: change.to, updatedAt: new Date() })
      .where(
        and(
          eq(schemaPg.mailboxMapping.id, change.mappingId),
          eq(schemaPg.mailboxMapping.tenantId, tenantId),
        ),
      );
    if (change.from !== change.to) {
      const { slotsTaken } = await movePathsWithMapping(db, tenantId, change.mappingId, change.to);
      if (slotsTaken && options.onSlotsTaken) await options.onSlotsTaken(db);
    }
    await recordMappingStatusChange(db, tenantId, change);
  });
}

/**
 * The mapping half of a rollback (ADR-0047) or a cutover step (ADR-0048), as
 * `performRollback`, `enterCutover` and `closeCutover` ask for it: read the
 * lifecycle, and set it with the record every other lifecycle write leaves.
 * `actor` is who is pressing — `'cli'` or `'trigger-job'` — and lands in the
 * audit row's `actor`; the door (`via`) comes with each write, because one
 * port serves both.
 *
 * A mapping that does not exist is an error, not a status. Hard rule 9: the
 * answer to "what state is this in" was missing, and "stays where it is"
 * would be a claim about a row nobody read.
 */
export function mappingLifecyclePort(
  source: LedgerDriver | Pool,
  tenantId: string,
  mappingId: string,
  actor: string,
  options: MappingStatusChangeOptions = {},
): MappingLifecyclePort {
  return {
    async readStatus() {
      const [row] = await withTenant(source, tenantId, (db) =>
        db
          .select({ status: schemaPg.mailboxMapping.status })
          .from(schemaPg.mailboxMapping)
          .where(
            and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)),
          )
          .limit(1),
      );
      if (!row) {
        throw new Error(`Mapping ${mappingId} was not found for tenant ${tenantId}.`);
      }
      return row.status;
    },
    async setStatus(change) {
      await applyMappingStatusChange(
        source,
        tenantId,
        { mappingId, from: change.from, to: change.to, actor, via: change.via },
        options,
      );
    },
  };
}
