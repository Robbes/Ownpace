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
 *                                organisation's own transaction.
 *
 * In the shared chain because the status is (ADR-0036). The appliance's one
 * organisation is always open. When a close was made and when its data is
 * removed are the managed edition's (`tenant_closure`).
 */

import { eq } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';
import type { PgDatabase } from './db-types.ts';

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
