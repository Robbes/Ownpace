// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The link flow's ending: the token is stored, and nobody sees it (0108 T4).
 *
 * The owner's consent and the migrator's consent share a beginning, a code
 * exchange and a callback address. They differ in exactly one place — **who may
 * see the refresh token** — and this file is that place. In the owner's ending
 * the token goes to the owner's own wizard window, because it is their
 * credential. Here it goes into the database and no further: not to the page,
 * not through a postMessage, not into a log, not into the response.
 *
 * ## The order is the security property
 *
 * **Spend the link first, store the credential second.** `spendMappingLink`
 * re-checks revocation and expiry inside its own UPDATE, so a link the owner
 * revoked while this consent was in flight claims nothing — and a consent that
 * cannot claim the link stores no credential. The other order would write a
 * credential and *then* discover the owner had said no, which is the one
 * outcome a kill switch exists to prevent.
 *
 * Both statements run in ONE tenant-scoped transaction, so a failure to write
 * the credential un-spends the link rather than leaving a migrator holding a
 * dead link and a mapping holding nothing.
 *
 * ## What is stored is only the migrator's half
 *
 * `{ refreshToken }` and nothing else. The client id and secret stay on the
 * connection where the owner put them; migration 0032's merge puts the two
 * halves together at build time. Copying the client here would duplicate a
 * secret for no reason and quietly detach this mapping from an owner's future
 * rotation.
 */

import type { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { spendMappingLink, type LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { withTenantDb } from '../../middleware/auth.ts';

/** The link the consent belonged to, as the pending state recorded it. */
export interface GrantTarget {
  readonly linkId: string;
  readonly mappingId: string;
  readonly tenantId: string;
}

export type GrantStoreResult = { ok: true } | { ok: false; reason: string };

/**
 * Claim the link and store the granted token, or refuse having stored nothing.
 *
 * The refusal is deliberately the SAME sentence for a revoked link, an expired
 * one and one already spent — the same rule the store's own refusal follows,
 * and for the same reason: the person reading it cannot act on the difference,
 * and telling them the difference tells a forger which part failed.
 */
export async function storeGrantedToken(
  source: Pool | LedgerDriver,
  target: GrantTarget,
  refreshToken: string,
): Promise<GrantStoreResult> {
  const encrypted = JSON.stringify(SecretStore.encryptCredentials({ refreshToken }).encrypted);

  return withTenantDb(target.tenantId, source, async (db) => {
    const spent = await spendMappingLink(db, {
      tenantId: target.tenantId,
      linkId: target.linkId,
    });
    if (!spent) {
      return {
        ok: false as const,
        reason:
          'This link can no longer be used — it may have been used already, it may have ' +
          'expired, or the person who sent it may have withdrawn it. Nothing was stored.',
      };
    }

    const updated = await db
      .update(schema.mailboxMapping)
      .set({ sourceSecretRef: encrypted, updatedAt: new Date() })
      .where(
        and(
          eq(schema.mailboxMapping.id, target.mappingId),
          eq(schema.mailboxMapping.tenantId, target.tenantId),
        ),
      )
      .returning({ id: schema.mailboxMapping.id });

    if (updated.length === 0) {
      // The mapping went away between the consent starting and finishing. Throw
      // rather than return: the transaction must roll back so the link is not
      // left spent for a grant that did not land (hard rule 9 — this is a
      // genuine fault, not a refusal, and the caller reports it as one).
      throw new Error(
        `grant ending: mapping ${target.mappingId} no longer exists for its tenant, so the ` +
          'granted credential has nowhere to go',
      );
    }
    return { ok: true as const };
  });
}
