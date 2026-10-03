// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION THAT IS OPEN (workplan 0085 T2; the owner's report of
 * 2026-09-28, and their answer "Read tenant status (Recommended)").
 *
 * `tenant.status` says whether an organisation is open: `active`. Closing sets
 * it to `closed`, and the purge to `deleting` (`offboarding.ts` in
 * `packages/managed`). Nothing writes `suspended`. Only an open organisation's
 * migrations get a pass, and only its stored access is opened.
 *
 * The close leaves each migration's own status as it was, so this is a second
 * question beside it, not a lifecycle state. A reopen sets `active` again, and
 * everything that ran before runs again, with nothing to restore. The same
 * shape as a grant the person took back (ledger migration 0063): a stop that
 * is deliberately not a status.
 *
 * Two readings of one rule, held to one answer by
 * `a-closed-organisation-gets-no-pass.unit.test.ts`:
 *
 *   AN_OPEN_ORGANISATION_WHERE   in SQL, over `mailbox_mapping m`, for the
 *                                managed tick, which chooses what to start in
 *                                one statement;
 *   organisationIsOpen           for the pass between its data types and for
 *                                the credential builders, read inside the
 *                                organisation's own transaction;
 *   organisationStillOpen        the same read, as a question a verification,
 *                                a confirmation or a discovery already running
 *                                asks between its steps (0139 T7).
 *
 * In the shared chain because the status is (ADR-0036). The appliance's one
 * organisation is always open. When a close was made and when its data is
 * removed are the managed edition's (`tenant_closure`).
 */

import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';
import type { PgDatabase } from './db-types.ts';
import type { LedgerDriver } from './driver.ts';
import { withTenant } from './db.ts';

/** The one status whose organisation is open. */
export const OPEN_ORGANISATION_STATUS = 'active';

/** The migration's organisation is open. Over `mailbox_mapping m`. */
export const AN_OPEN_ORGANISATION_WHERE =
  `EXISTS (SELECT 1 FROM tenant t WHERE t.id = m.tenant_id AND t.status = '${OPEN_ORGANISATION_STATUS}')`;

/**
 * Is this organisation open? Read inside its own transaction. An organisation
 * that is gone is not open: no row is not an open row.
 */
export async function organisationIsOpen(db: PgDatabase, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: schemaPg.tenant.status })
    .from(schemaPg.tenant)
    .where(eq(schemaPg.tenant.id, tenantId));
  return row?.status === OPEN_ORGANISATION_STATUS;
}

/**
 * `organisationIsOpen`, asked afresh each time it is called, in a short
 * transaction of its own (workplan 0139 T7; terms briefing, precondition B).
 *
 * For work that was already running when the account closed and reads for
 * minutes: a verification, a confirmation, a discovery. Each built its readers
 * before the close, so the builders' refusal never reaches it, and the close
 * cancels only the runs whose row names the orchestrator's run. So each asks
 * this between its steps (before each read of a target, each item, each
 * collection) and stops once the answer is no.
 *
 * A transaction per question, never one held open across the run: the same
 * reason the confirmation pages its reads (`run-confirmation-pass.ts`).
 */
export function organisationStillOpen(
  source: LedgerDriver | Pool,
  tenantId: string,
): () => Promise<boolean> {
  return () => withTenant(source, tenantId, (db) => organisationIsOpen(db, tenantId));
}
