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
 * context (step 3 is the mark's alone):
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
 * 2. **The organisation's migrations lock**, the advisory lock the create door
 *    takes before it counts (`holdTheOrganisationsMigrations`), so a mark and
 *    a create are decided one after the other.
 * 3. **The same marker again changes nothing**: no write and no audit row, and
 *    the answer says so (`unchanged`).
 * 4. **Does it hold a migration?** Any `mailbox_mapping` row that names it,
 *    whatever its status, as `support_tenants.migration_count` and
 *    `operator.sh clean empty-tenant` count (`migrationsHeldBy`). While it
 *    holds one, nothing is written: a migration made before the mark copies
 *    everything, and one made under it keeps its marker whatever happens here
 *    (§2 (c)).
 * 5. The write, and **an audit row** in the same transaction, after it, as the
 *    close and the reopen write theirs: `tenant.test_marker_set` with the
 *    marker (and the one it replaced), `tenant.test_marker_cleared` with the
 *    one cleared, each under the operator with `via: operator`. A refused door
 *    records nothing, and an allowed one cannot go unrecorded.
 *
 * Whether the organisation is open is the route's question, asked of the
 * operator's view as the close and the reopen ask it.
 *
 * The marker the operator typed is read before any of this, by the route
 * (`readTestMarker`, shared): the API requires one and fills in none.
 */

import type { Pool } from 'pg';
import { PgLedger, withTenant, type LedgerDriver } from '@openmig/ledger';
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
 * What a mark did: the marker set, and the one it replaced, if any; or, for
 * the marker the organisation already had, nothing (`unchanged`).
 */
export type TestMarkOutcome =
  | HoldsMigrations
  | { readonly marker: string; readonly replaced?: string }
  | { readonly marker: string; readonly unchanged: true };

/** What a clear did: the marker cleared, or nothing for an organisation that was not a test. */
export type TestUnmarkOutcome = HoldsMigrations | { readonly cleared?: string };

/** Mark the organisation as a test, with this marker, as the operator asked. */
export async function markAsTestAsOperator(
  source: Pool | LedgerDriver,
  command: TestMarkCommand,
): Promise<TestMarkOutcome> {
  const { tenantId, marker, by } = command;
  return withTenant(source, tenantId, async (db) => {
    if (!(await actingAsAppointedOperator(db, by))) throw new NotAnAppointedOperator(by, 'marked as a test');
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
