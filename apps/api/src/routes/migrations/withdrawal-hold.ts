// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WITHDRAWAL'S HOLD, LIFTED ONLY WHEN BOTH SIDES HAVE A WAY IN (workplan
 * 0174 §4.3; ledger migration 0063).
 *
 * `grant_withdrawn_at` is the hold a person's withdrawal puts on a migration:
 * while it is set, the tick starts no pass, a running pass stops before its
 * next data type, and building the source is refused by name. Until alpha.21
 * only a source's grant could be withdrawn, and a new grant on the source
 * cleared the hold in the write that stored it.
 *
 * Since 0174 a person also withdraws a DESTINATION they connected with their
 * own password (`withdrawPersonDestination`, the person's progress page), and
 * the same hold stops everything that would write to it. So one side's new
 * grant may no longer clear the hold on its own: a source granted again while
 * the destination stands withdrawn would let the tick start a pass with no
 * way into the destination, which fails at the first write. Every ending that
 * stores a grant calls `liftTheHold` after its write, in its own transaction,
 * and the hold goes only where both sides have a way in again, judged as
 * Start judges them (`hasAWayInOnBothSides`).
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { readGrantRows, storedCredentials } from './grant-subject.ts';
import { credentialKeys } from './person-grant-subject.ts';
import { awaitingGrantRefusal } from './grant-link-readiness.ts';

/**
 * Whether a migration has a way in on both sides (workplan 0174 §4.2): the
 * source's merged credentials (the connection's, then the migration's own)
 * and the destination's, judged by `awaitingGrantRefusal` as Start judges
 * them. Read inside the caller's tenant transaction. A migration with no
 * source has no way in.
 */
export async function hasAWayInOnBothSides(db: PgDatabase, tenantId: string, mappingId: string): Promise<boolean> {
  const rows = await readGrantRows(db, tenantId, mappingId);
  if (!rows) return false;
  const [own] = await db
    .select({ sourceSecretRef: schema.mailboxMapping.sourceSecretRef })
    .from(schema.mailboxMapping)
    .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
  const source = { ...storedCredentials(rows.source.secretRef), ...storedCredentials(own?.sourceSecretRef ?? null) };
  const keys = credentialKeys(source);
  return (
    awaitingGrantRefusal({
      sourceKind: rows.source.kind,
      hasRefreshToken: keys.includes('refreshToken'),
      hasServiceAccountKey: keys.includes('serviceAccountKey'),
      sourceCredentialKeys: keys,
      target: {
        targetKind: rows.target?.kind ?? null,
        includedDomains: rows.includedDomains,
        targetCredentialKeys: rows.target ? credentialKeys(storedCredentials(rows.target.secretRef)) : [],
      },
    }) === null
  );
}

/**
 * Clear the hold on each of these migrations that has a way in on both sides
 * now, inside the caller's transaction, after its grant was written. A
 * migration with no hold is not touched. Answers the ones lifted.
 */
export async function liftTheHold(db: PgDatabase, tenantId: string, mappingIds: ReadonlyArray<string>): Promise<string[]> {
  if (mappingIds.length === 0) return [];
  const held = await db
    .select({ id: schema.mailboxMapping.id })
    .from(schema.mailboxMapping)
    .where(
      and(
        eq(schema.mailboxMapping.tenantId, tenantId),
        inArray(schema.mailboxMapping.id, [...mappingIds]),
        isNotNull(schema.mailboxMapping.grantWithdrawnAt),
      ),
    );
  const lifted: string[] = [];
  for (const { id } of held) {
    if (!(await hasAWayInOnBothSides(db, tenantId, id))) continue;
    await db
      .update(schema.mailboxMapping)
      .set({ grantWithdrawnAt: null, updatedAt: new Date() })
      .where(and(eq(schema.mailboxMapping.id, id), eq(schema.mailboxMapping.tenantId, tenantId)));
    lifted.push(id);
  }
  return lifted;
}
