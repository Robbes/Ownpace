// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DECLINED REQUEST AGES OUT (workplan 0139 T6, open question 2 (a)).
 *
 * `access_request` holds the name, address, organisation and note of every
 * person who asked for an account. A granted request goes with its
 * organisation, because offboarding purges it (`PURGED_TABLES`). An open one
 * stays while it is open, because the owner answers every request. A declined
 * one was kept forever: no retention job named the table. The owner decided on
 * 2026-09-27 that it is deleted 30 days after the decision.
 *
 * 0093's rule still holds for people: `app_user` has no DELETE on the table, so
 * neither the operator nor anybody else can make a decision disappear. This
 * runs in the nightly retention job over the owner connection, like every
 * prune, and is the only thing that deletes one, on a stated date.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';

/** How long a declined request is kept after its decision: the owner's number. */
export const DECLINED_REQUEST_RETENTION_DAYS = 30;

export interface DeclinedRequestPrune {
  /** How many declined requests were deleted. Never who. */
  readonly deleted: number;
  /** Declined before this instant means deleted. */
  readonly cutoff: Date;
}

/** Delete every request declined more than 30 days before `now`. */
export async function pruneDeclinedAccessRequests(
  db: PgDatabase,
  now: Date,
): Promise<DeclinedRequestPrune> {
  const cutoff = new Date(now.getTime() - DECLINED_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Compared in the database, so the answer does not depend on how a driver
  // hands a timestamp back.
  const result = await db.execute(sql`
    DELETE FROM access_request
     WHERE state = 'declined'
       AND decided_at < ${cutoff.toISOString()}::timestamptz
    RETURNING id
  `);
  return { deleted: resultRows(result).length, cutoff };
}

function resultRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}
