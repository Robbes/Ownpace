// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FROM THE MOMENT OF A WITHDRAWAL (workplan 0111, T7, slice 7b; decision 15:
 * "Back to Free from that moment").
 *
 * A withdrawal is a row (`contract_withdrawal`, managed 0049), and the yeses
 * and picks made before the organisation's latest one count for nothing: this
 * is the one condition that says so, used by the two stores every reader of the
 * tier goes through (`PgDataAllowanceStore.grants`, `PgTierPickStore.picks`).
 * So the Billing page, the month's invoice, the pace and the tick all read
 * Free from that moment, and a yes after it counts again.
 *
 * A leaf on purpose: the stores import it, and it imports nothing of theirs.
 * It reads only `tenant_id` and `withdrawn_at`, the two columns the system
 * role may read (0049), so the tick can ask it too.
 */

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { TenantId } from '@openmig/shared';

/** True for a row made after the organisation's latest withdrawal, or for every row when there is none. */
export function sinceTheLatestWithdrawal(madeAt: SQLWrapper, tenantId: TenantId): SQL {
  return sql`${madeAt} > COALESCE(
    (SELECT max(cw.withdrawn_at) FROM contract_withdrawal cw WHERE cw.tenant_id = ${tenantId}),
    '-infinity'::timestamptz)`;
}
