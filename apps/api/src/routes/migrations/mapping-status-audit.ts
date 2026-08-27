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
 * Every call site is already inside `withTenantDb`, which opens a real
 * transaction (`packages/ledger/src/db.ts:91` — BEGIN, `SET LOCAL ROLE`, then
 * COMMIT or ROLLBACK). Passing the same `db` in means the status change and
 * its record commit together or not at all, which removes the question this
 * would otherwise have to answer badly: whether a failed audit write should
 * abort somebody's migration (refusing to finish because a log table hiccuped)
 * or be swallowed (the record silently absent, which is the failure this file
 * exists to prevent). Atomic is neither. `connections.ts` already writes an
 * audit event this way; this follows it.
 */

import { PgLedger } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';

/** The audit action every mapping status transition is recorded under. */
export const MAPPING_STATUS_ACTION = 'mapping.status';

/** The four states `mailbox_mapping.status` may hold (migration 0001's CHECK). */
export type MappingStatus = 'active' | 'paused' | 'cutover' | 'done';

/**
 * Record that a mapping moved from one status to another.
 *
 * A no-op when `from === to`. A PATCH that sets the status a mapping already
 * has is a request, not a transition, and an audit log that records
 * non-events is one nobody reads — which makes the events that matter harder
 * to find, not easier.
 *
 * `db` must be the handle from the SAME `withTenantDb` call as the status
 * write, so the two share a transaction. Taking it as a parameter rather than
 * opening its own connection is what makes that impossible to get wrong.
 */
export async function recordMappingStatusChange(
  db: ConstructorParameters<typeof PgLedger>[0],
  tenantId: string,
  change: {
    readonly mappingId: string;
    readonly from: string;
    readonly to: MappingStatus;
    /** Who pressed it. `req.userId`, or 'unknown' when there is no session. */
    readonly actor: string;
    /** How it was reached — the route, in the operator's vocabulary. */
    readonly via: 'start' | 'update' | 'finish';
    /** Set when the operator forced past unresolved failures (finish only). */
    readonly forced?: boolean;
  },
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
