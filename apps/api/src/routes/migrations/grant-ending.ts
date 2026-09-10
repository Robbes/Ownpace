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
import {
  DEFAULT_MAPPING_VIEW_LINK_EXPIRY_DAYS,
  expiryFromDays,
  issueMappingLink,
  spendMappingLink,
  type LedgerDriver,
} from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { log } from '@openmig/shared';
import { withTenantDb } from '../../middleware/auth.ts';
import { progressPageUrl, type ProgressPageUrl } from './progress-page-url.ts';

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

/**
 * Mint the progress link this person keeps, AFTER their grant has landed
 * (workplan 0122 T7, ADR-0035's second lifetime).
 *
 * ## Why this is not inside `storeGrantedToken`'s transaction
 *
 * That transaction has one job and it is the valuable one: spend the link,
 * store the credential, both or neither. Folding a third statement into it
 * would mean a failure to mint a *progress page* rolls back somebody's
 * *consent* — and the consent is the thing that took them ten minutes and a
 * decision, while the page is a convenience the owner can hand over later with
 * two clicks. So this runs after the commit, and a failure here is logged and
 * swallowed: the caller renders the ending without a link rather than telling
 * somebody their permission did not take.
 *
 * Returns null on any refusal, and the two of them are different:
 *
 * - **No `WEB_URL`.** The deployment cannot say what address to build, and
 *   0095 T3's lesson is that a link built without one goes out looking exactly
 *   like a working one. The same check `viewLinkRefusal` makes for the owner.
 * - **The write failed.** Logged as ours, because it is.
 *
 * ## Why a fresh one every time, rather than reusing a live link
 *
 * There is no reusing to be had: `mapping_link` stores a sha256 and the token
 * is returned exactly once, at issue. A second grant on a second link therefore
 * mints a second progress link, both live, both revocable, both on the owner's
 * panel. That is the honest consequence of the table holding no secret, not a
 * leak — and the owner can see and revoke every one of them.
 */
export async function mintProgressLink(
  source: Pool | LedgerDriver,
  target: GrantTarget,
): Promise<ProgressPageUrl | null> {
  const base = process.env.WEB_URL?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    const issued = await withTenantDb(target.tenantId, source, (db) =>
      issueMappingLink(db, {
        tenantId: target.tenantId,
        mappingId: target.mappingId,
        purpose: 'view',
        // Not a user id: nobody was signed in. The owner's list shows this
        // beside the links they issued themselves, so it has to say plainly
        // that this one arrived on its own.
        createdBy: 'granted-by-link',
        // The dialog's own pre-filled value, and deliberately not a second
        // number invented here: ninety days is the product's opinion about how
        // long a progress page should live, and a machine minting one knows
        // nothing the dialog does not.
        expiresAt: expiryFromDays(DEFAULT_MAPPING_VIEW_LINK_EXPIRY_DAYS),
      }),
    );
    return progressPageUrl(base, issued.token);
  } catch (error) {
    // Ours, and not worth failing their grant over. The owner can issue one.
    log.error('[api] minting a progress link after a grant failed:', error);
    return null;
  }
}
