// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Taking a grant back, from the progress page (workplan 0108 T8 (c); the
 * owner, 2026-09-23: *"C: yes, after B. Also: if we cannot revoke at the
 * sources, we do revoke/remove in our system and tell the person that
 * revokes."*).
 *
 * `grant-ending.ts` is where a grant given through a link is stored; this is
 * where it is taken back, by whoever holds the migration's progress link.
 *
 * ## Only the grant the link stored, never the organisation's own credential
 *
 * `source_secret_ref` is the one thing deleted. Its only writer is
 * `storeGrantedToken`, so it holds exactly the token a person granted through a
 * link and nothing the owner put there: the owner's own consent and a pasted
 * token live on the connection, which this never touches. A mapping with no
 * granted token has nothing to take back, and is told so without anybody
 * calling Google.
 *
 * ## Google first, then here, and here whatever Google said
 *
 * The token is revoked at Google before it is deleted here, so the record of
 * the withdrawal can say what Google answered in the same transaction that
 * deletes it. The delete does not wait on Google agreeing: the owner decided
 * that a withdrawal Google did not confirm still removes the grant here, and
 * the person is told to finish it at Google themselves.
 *
 * Revoking at Google takes back the whole grant the person gave this
 * application, not only this migration's part of it: the consent asks with
 * `include_granted_scopes`, so every grant to the same application from the
 * same account is one grant at Google (`grant-ending.ts` says why a WRONG
 * account's token is therefore dropped rather than revoked). Here the person
 * asked for exactly that, and the page says so before the button.
 *
 * ## And then nothing reads the account
 *
 * `grant_withdrawn_at` is set in the same transaction (ledger migration 0063).
 * While it is, the tick starts no pass, a running pass stops before its next
 * data type, building the source is refused by name, and Start and Sync now
 * tell the owner why. A new grant clears it.
 *
 * ## The delete names what it read
 *
 * The UPDATE matches the secret it read, not merely the mapping. A new grant
 * landing between the read and the delete would otherwise be deleted without
 * having been revoked; instead the person is told their permission changed
 * while it was being withdrawn, nothing is deleted, and pressing again
 * withdraws the new one.
 */

import type { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger, type LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import type { GrantWithdrawal, TenantId, TokenRevoker } from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';

/** What a withdrawal is recorded under in `audit_log`. */
export const GRANT_WITHDRAWN_ACTION = 'mapping.grant_withdrawn';

/** Who acted: whoever holds the progress link, who has no user id to be recorded under. */
export const WITHDRAWAL_ACTOR = 'progress-link';

/** The progress link the withdrawal came through, as its middleware resolved it. */
export interface WithdrawalLink {
  readonly tenantId: string;
  readonly mappingId: string;
  readonly linkId: string;
}

export type WithdrawalResult =
  | { readonly ok: true; readonly withdrawal: GrantWithdrawal }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'nothing_granted' | 'changed';
      readonly reason: string;
    };

/** The grant as the withdrawal reads it, before anything is changed. */
interface Granted {
  readonly secretRef: string;
  readonly sourceKind: string;
}

type Read =
  | { readonly kind: 'gone' }
  | { readonly kind: 'withdrawn'; readonly at: Date }
  | { readonly kind: 'none' }
  | { readonly kind: 'granted'; readonly granted: Granted };

async function readGrant(source: Pool | LedgerDriver, link: WithdrawalLink): Promise<Read> {
  return withTenantDb(link.tenantId, source, async (db) => {
    const rows = await db
      .select({
        secretRef: schema.mailboxMapping.sourceSecretRef,
        withdrawnAt: schema.mailboxMapping.grantWithdrawnAt,
        sourceKind: schema.connection.kind,
      })
      .from(schema.mailboxMapping)
      .leftJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
      .leftJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(
        and(
          eq(schema.mailboxMapping.id, link.mappingId),
          eq(schema.mailboxMapping.tenantId, link.tenantId),
        ),
      );
    const row = rows[0];
    if (!row) return { kind: 'gone' };
    if (row.withdrawnAt) return { kind: 'withdrawn', at: row.withdrawnAt };
    if (!row.secretRef) return { kind: 'none' };
    return { kind: 'granted', granted: { secretRef: row.secretRef, sourceKind: row.sourceKind ?? '' } };
  });
}

function alreadyWithdrawn(at: Date): WithdrawalResult {
  return {
    ok: false,
    code: 'nothing_granted',
    reason: `You already withdrew your permission, on ${at.toISOString().slice(0, 10)}. Nothing reads your account.`,
  };
}

/**
 * The token the grant stored, or null when it cannot be read. An unreadable
 * secret is still deleted: it is the grant, whatever state it is in, and the
 * person is then told Google did not confirm, which is true.
 */
function grantedToken(secretRef: string): string | null {
  try {
    const creds = SecretStore.decryptCredentials(secretRef) as Record<string, unknown>;
    const token = creds['refreshToken'];
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Take the grant back: revoke it at Google where Google will, delete it here
 * whatever Google answered, and stop the migration reading the account.
 */
export async function withdrawGrant(
  source: Pool | LedgerDriver,
  link: WithdrawalLink,
  revoker: TokenRevoker,
): Promise<WithdrawalResult> {
  const read = await readGrant(source, link);
  if (read.kind === 'gone') {
    return {
      ok: false,
      code: 'not_found',
      reason:
        'This migration no longer exists, so it holds no permission of yours. Nothing you can do ' +
        'from here will change that; please tell the person who sent you the link.',
    };
  }
  if (read.kind === 'withdrawn') return alreadyWithdrawn(read.at);
  if (read.kind === 'none') {
    return {
      ok: false,
      code: 'nothing_granted',
      reason:
        'This migration holds no permission that was given through a link, so there is nothing ' +
        'here to withdraw.',
    };
  }

  const token = grantedToken(read.granted.secretRef);
  const outcome = token
    ? await revoker.revoke({ kind: read.granted.sourceKind, credentials: { refreshToken: token } })
    : null;
  const atGoogle = outcome?.status === 'revoked' ? 'revoked' : 'not_confirmed';

  const withdrawnAt = await withTenantDb(link.tenantId, source, async (db) => {
    const now = new Date();
    const updated = await db
      .update(schema.mailboxMapping)
      .set({ sourceSecretRef: null, grantWithdrawnAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.mailboxMapping.id, link.mappingId),
          eq(schema.mailboxMapping.tenantId, link.tenantId),
          eq(schema.mailboxMapping.sourceSecretRef, read.granted.secretRef),
        ),
      )
      .returning({ at: schema.mailboxMapping.grantWithdrawnAt });
    const at = updated[0]?.at;
    if (!at) return null;
    await new PgLedger(db).recordAuditEvent(link.tenantId as TenantId, {
      actor: WITHDRAWAL_ACTOR,
      action: GRANT_WITHDRAWN_ACTION,
      // The kind, with the id in `detail`: the shape every other writer uses.
      entity: 'mapping',
      detail: { mappingId: link.mappingId, linkId: link.linkId, atGoogle },
    });
    return at;
  });

  if (!withdrawnAt) {
    // The row moved between the read and the delete. Withdrawn by another
    // press (a second tab) is the same answer as a second press; anything else
    // is a new grant, which was not revoked and so is not deleted.
    const now = await readGrant(source, link);
    if (now.kind === 'withdrawn') return alreadyWithdrawn(now.at);
    return {
      ok: false,
      code: 'changed',
      reason:
        'Your permission changed while it was being withdrawn (it was given again), so nothing ' +
        'was deleted. Press withdraw once more to take the new one back.',
    };
  }
  return { ok: true, withdrawal: { withdrawnAt: withdrawnAt.toISOString(), atGoogle } };
}
