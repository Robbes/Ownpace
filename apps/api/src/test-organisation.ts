// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE OPERATOR MARKS AN ORGANISATION AS A TEST, OR NO LONGER (workplan 0162
 * T1, §3; the owner's §2 (b); ADR-0053).
 *
 * `POST /api/support/tenants/{tenantId}/test` with `{ marker }` sets the
 * organisation's marker, and `DELETE` on the same path clears it. Every
 * migration made in a test organisation copies the marker onto its own row
 * when it is created (`POST /api/migrations`), and then copies only the items
 * whose own title contains it. Both doors come here, so they ask the same
 * questions in the same order, in one transaction, in the organisation's own
 * context (step 4 is the mark's alone):
 *
 * 1. **Is the subject an appointed operator?** `actingAsAppointedOperator`,
 *    the question the support page's Close and Reopen ask
 *    (`close-account.ts`), asked here in the door's own transaction, which
 *    from then on acts as the operator (`app.current_user`). The write below
 *    is allowed by the database itself only to an appointed operator in their
 *    own name (managed 0062's policies), so the check and the write are one
 *    transaction. Anybody else marks nothing (`NotAnAppointedOperator`), and
 *    the route answers the 404 it gives for an organisation that does not
 *    exist.
 * 2. **Is it open?** Its status, read in this transaction and held until it
 *    commits (`statusHeldUntilCommit`). An organisation closed, or being
 *    erased, is neither marked nor unmarked (`notOpen`), and one no longer
 *    there is answered as one that never was (`notOpen: null`). The route
 *    asks the operator's view first, as the close and the reopen do, for its
 *    404 alone: that answer is read outside this transaction, and while it
 *    also decided whether the organisation was open, a close that committed
 *    between the two let a mark land on a closed organisation (0162 T1's
 *    re-review). Asked here, a close and a mark are decided one after the
 *    other.
 * 3. **The organisation's migrations lock**, the advisory lock the create door
 *    takes before it counts (`holdTheOrganisationsMigrations`), so a mark and
 *    a create are decided one after the other.
 * 4. **The same marker again changes nothing**: no write and no audit row, and
 *    the answer says so (`unchanged`).
 * 5. **Does it hold a migration?** Any `mailbox_mapping` row that names it,
 *    whatever its status, as `support_tenants.migration_count` and
 *    `operator.sh clean empty-tenant` count (`migrationsHeldBy`). While it
 *    holds one, nothing is written: a migration made before the mark copies
 *    everything, and one made under it keeps its marker whatever happens here
 *    (§2 (c)).
 * 6. The write, and **an audit row** in the same transaction, after it, as the
 *    close and the reopen write theirs: `tenant.test_marker_set` with the
 *    marker (and the one it replaced), `tenant.test_marker_cleared` with the
 *    one cleared, each under the operator with `via: operator`. A refused door
 *    records nothing, and an allowed one cannot go unrecorded.
 *
 * The marker the operator typed is read before any of this, by the route
 * (`readTestMarker`, shared): the API requires one and fills in none.
 */

import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { OPEN_ORGANISATION_STATUS, PgLedger, withTenant, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import * as schema from '@openmig/ledger/schema-pg';
import {
  TEST_MARKER_CLEARED_ACTION,
  TEST_MARKER_SET_ACTION,
  markTestOrganisation,
  migrationsHeldBy,
  testMarkerOfOrganisation,
  unmarkTestOrganisation,
} from '@openmig/managed';
import type { TenantId } from '@openmig/shared';
import { NotAnAppointedOperator, actingAsAppointedOperator } from './close-account.ts';
import { holdTheOrganisationsMigrations } from './routes/migrations/migration-cap.ts';

/** A mark, as the operator asked for it on the support page. */
export interface TestMarkCommand {
  readonly tenantId: string;
  /** The operator's subject. */
  readonly by: string;
  /** Read already (`readTestMarker`): trimmed, 3 to 64 printable characters. */
  readonly marker: string;
}

/** A clear, as the operator asked for it on the support page. */
export interface TestUnmarkCommand {
  readonly tenantId: string;
  readonly by: string;
}

/** The organisation holds migrations, so nothing was written (§2 (b)). */
export interface HoldsMigrations {
  readonly held: number;
}

/**
 * The organisation is not open, so nothing was written: its status as the
 * door's own transaction read it (`closed`, `deleting`), or null where it is
 * no longer there.
 */
export interface NotOpen {
  readonly notOpen: string | null;
}

/**
 * What a mark did: the marker set, and the one it replaced, if any; or, for
 * the marker the organisation already had, nothing (`unchanged`).
 */
export type TestMarkOutcome =
  | NotOpen
  | HoldsMigrations
  | { readonly marker: string; readonly replaced?: string }
  | { readonly marker: string; readonly unchanged: true };

/** What a clear did: the marker cleared, or nothing for an organisation that was not a test. */
export type TestUnmarkOutcome = NotOpen | HoldsMigrations | { readonly cleared?: string };

/**
 * The organisation's status, read in the door's own transaction and held
 * until it commits (`FOR SHARE`), or null where there is no such organisation.
 *
 * A close, a reopen and the purge each change `tenant.status` with an UPDATE
 * of this row, whose lock conflicts with this one. A close that comes after
 * this read waits for the door to commit, and a close written before it and
 * not yet committed makes this read wait, then read what it committed. So no
 * close commits between the door's answer and its write. It holds back only
 * what changes the status: two doors' shared locks do not conflict, and the
 * foreign key a create's insert checks takes a weaker one.
 *
 * `FOR SHARE` asks `UPDATE` on the table, which `app_user` holds, under the
 * policy that keeps it to the organisation's own row
 * (`tenant_isolation_update`).
 */
export async function statusHeldUntilCommit(db: PgDatabase, tenantId: string): Promise<string | null> {
  // By its primary key: one row, or none.
  const [row] = await db
    .select({ status: schema.tenant.status })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, tenantId))
    .for('share');
  return row === undefined ? null : row.status;
}

/** Mark the organisation as a test, with this marker, as the operator asked. */
export async function markAsTestAsOperator(
  source: Pool | LedgerDriver,
  command: TestMarkCommand,
): Promise<TestMarkOutcome> {
  const { tenantId, marker, by } = command;
  return withTenant(source, tenantId, async (db) => {
    if (!(await actingAsAppointedOperator(db, by))) throw new NotAnAppointedOperator(by, 'marked as a test');
    const status = await statusHeldUntilCommit(db, tenantId);
    if (status !== OPEN_ORGANISATION_STATUS) return { notOpen: status };
    await holdTheOrganisationsMigrations(db, tenantId);
    const current = await testMarkerOfOrganisation(db, tenantId);
    if (current === marker) return { marker, unchanged: true };
    const held = await migrationsHeldBy(db, tenantId);
    if (held > 0) return { held };
    const { replaced } = await markTestOrganisation(db, tenantId, marker, by);
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: by,
      action: TEST_MARKER_SET_ACTION,
      entity: 'tenant',
      detail: { marker, via: 'operator', ...(replaced !== undefined ? { replaced } : {}) },
    });
    return replaced !== undefined ? { marker, replaced } : { marker };
  });
}

/** Clear the organisation's marker, as the operator asked. */
export async function unmarkTestAsOperator(
  source: Pool | LedgerDriver,
  command: TestUnmarkCommand,
): Promise<TestUnmarkOutcome> {
  const { tenantId, by } = command;
  return withTenant(source, tenantId, async (db) => {
    if (!(await actingAsAppointedOperator(db, by))) throw new NotAnAppointedOperator(by, 'unmarked');
    const status = await statusHeldUntilCommit(db, tenantId);
    if (status !== OPEN_ORGANISATION_STATUS) return { notOpen: status };
    await holdTheOrganisationsMigrations(db, tenantId);
    const held = await migrationsHeldBy(db, tenantId);
    if (held > 0) return { held };
    const { cleared } = await unmarkTestOrganisation(db, tenantId);
    // Nothing was a test, so nothing changed and nothing is recorded.
    if (cleared === undefined) return {};
    await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
      actor: by,
      action: TEST_MARKER_CLEARED_ACTION,
      entity: 'tenant',
      detail: { marker: cleared, via: 'operator' },
    });
    return { cleared };
  });
}
