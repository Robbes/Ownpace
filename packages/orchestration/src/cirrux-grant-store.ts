// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE A CIRRUX DRIVE GRANT LIVES, AND THE ONE LOCK EVERY REFRESH OF IT TAKES
 * (workplan 0160 T5; ADR-0052).
 *
 * The grant is the refresh token a person's sign-in produced, stored under
 * `CIRRUX_DRIVE_GRANT_KEY` in the `cirrux` connection's encrypted credentials,
 * beside its app password. Cirrux retires a refresh token the moment it is
 * used and signs the person out if a retired one is presented again
 * (`https://cirrux.co/help/api`), so this module is where the rule every other
 * connector keeps — a stored credential is read, never written by a pass —
 * has its one named exception.
 *
 * ## The lock
 *
 * Every refresh runs inside ONE transaction that first takes the connection
 * row's lock (`SELECT … FOR UPDATE`), reads and decrypts the token stored at
 * that moment, calls Cirrux with it, and stores the successor before it
 * commits. A second refresh of the same connection, in this process or any
 * other (a pass in the worker, a Test in the API), waits on the lock and then
 * reads the successor: never the token just spent. A row lock rather than an
 * advisory lock, because it also makes every OTHER write to the row wait: a
 * person replacing the app password, or connecting Drive again, cannot slip
 * in between a refresh's read and its write (ADR-0052, decision 1).
 *
 * ## The compare-and-swap
 *
 * The UPDATE that stores the successor carries `WHERE secret_ref = <what was
 * read>`. Under the lock nothing can have changed it; the comparison is there
 * for the writer that ever forgets the lock, and a mismatch stores nothing.
 *
 * ## What is stored, and what is not
 *
 * The whole credential record is decrypted, the one key replaced (or removed,
 * for a token Cirrux may have spent), and the record encrypted again through
 * `SecretStore`, the one credential store (ADR-0037). No token is logged and
 * none leaves this module but into Cirrux's token request.
 */

import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connection as connectionTable, withTenant, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY } from '@openmig/shared';
import {
  cirruxDriveNotConnected,
  type RotatingGrantStore,
  type RotationOutcome,
} from '@openmig/connectors';

/** The row a grant belongs to: one `cirrux` connection, in one tenant. */
export interface CirruxGrantRow {
  readonly pool: Pool | LedgerDriver;
  readonly tenantId: string;
  readonly connectionId: string;
}

/** Encrypt a credential record the way every door stores one. */
function sealed(creds: Record<string, string>): string {
  return JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
}

/**
 * `RotatingGrantStore` over the connection row: the managed edition's, the one
 * a pass and a Test both use.
 */
export class PgCirruxGrantStore implements RotatingGrantStore {
  private readonly row: CirruxGrantRow;

  constructor(row: CirruxGrantRow) {
    this.row = row;
  }

  async rotate<T>(use: (refreshToken: string) => Promise<RotationOutcome<T>>): Promise<T> {
    const { pool, tenantId, connectionId } = this.row;
    const answer = await withTenant(pool, tenantId, async (db) => {
      // THE LOCK, taken before the token is read: everything below, the call
      // to Cirrux included, happens while no other refresh of this row can.
      const rows = await db
        .select({ secretRef: connectionTable.secretRef })
        .from(connectionTable)
        .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)))
        .for('update');
      const read = rows[0]?.secretRef;
      if (!rows[0]) {
        return { ok: false as const, error: new Error(`The Cirrux account ${connectionId} is not in this organisation any more.`) };
      }
      if (!read) return { ok: false as const, error: cirruxDriveNotConnected() };
      const creds = SecretStore.decryptCredentials(read);
      const token = creds[CIRRUX_DRIVE_GRANT_KEY];
      if (typeof token !== 'string' || token.trim() === '') return { ok: false as const, error: cirruxDriveNotConnected() };

      const outcome = await use(token);
      if (outcome.kind === 'kept') return { ok: false as const, error: outcome.error };

      const next: Record<string, string> = { ...creds };
      if (outcome.kind === 'rotated') next[CIRRUX_DRIVE_GRANT_KEY] = outcome.refreshToken;
      else delete next[CIRRUX_DRIVE_GRANT_KEY];
      // THE COMPARE-AND-SWAP, on the ciphertext read under the lock.
      const written = await db
        .update(connectionTable)
        .set({ secretRef: sealed(next) })
        .where(
          and(
            eq(connectionTable.id, connectionId),
            eq(connectionTable.tenantId, tenantId),
            eq(connectionTable.secretRef, read),
          ),
        )
        .returning({ id: connectionTable.id });
      if (written.length === 0) {
        // Not reachable while the lock holds; if it ever is, nothing was
        // stored, and the successor is lost: said, never hidden.
        throw new Error(
          `The stored credentials of the Cirrux account ${connectionId} changed while its Drive sign-in ` +
            'was being renewed, so the renewed one was not stored. Connect Cirrux Drive again on the ' +
            'Accounts page.',
        );
      }
      return outcome.kind === 'rotated'
        ? { ok: true as const, value: outcome.value }
        : { ok: false as const, error: outcome.error };
    });
    // Thrown AFTER the commit, so a spent token's removal is kept.
    if (!answer.ok) throw answer.error;
    return answer.value;
  }
}

/** What the consent door's own transaction asks and records, around the write. */
export interface GrantStoreHooks<R> {
  /**
   * Asked under the lock, before anything is written: a refusal (a closed
   * organisation) stores nothing, whatever the callback asked before the code
   * exchange, since a close can land in between.
   */
  readonly refusal?: (db: PgDatabase) => Promise<R | null>;
  /** Written in the same transaction as the grant (the audit line), so both commit or neither. */
  readonly recorded?: (db: PgDatabase) => Promise<void>;
}

/**
 * Store a person's Drive grant on a Cirrux account, the consent door's last
 * step (ADR-0052, decision 7), under the same lock a refresh takes.
 *
 * Only on a `cirrux` DESTINATION in this tenant: the consent began on the
 * account the authorize call named, and nothing else may receive it.
 */
export async function storeCirruxDriveGrant<R = never>(
  row: CirruxGrantRow,
  refreshToken: string,
  hooks: GrantStoreHooks<R> = {},
): Promise<'stored' | 'no_account' | { readonly refused: R }> {
  const { pool, tenantId, connectionId } = row;
  return withTenant(pool, tenantId, async (db) => {
    const rows = await db
      .select({ secretRef: connectionTable.secretRef, kind: connectionTable.kind, role: connectionTable.role })
      .from(connectionTable)
      .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)))
      .for('update');
    const found = rows[0];
    if (!found || found.kind !== 'cirrux' || found.role !== 'target' || !found.secretRef) return 'no_account';
    const refused = hooks.refusal ? await hooks.refusal(db) : null;
    if (refused !== null) return { refused };
    const creds = SecretStore.decryptCredentials(found.secretRef);
    const written = await db
      .update(connectionTable)
      .set({ secretRef: sealed({ ...creds, [CIRRUX_DRIVE_GRANT_KEY]: refreshToken }), updatedAt: new Date() })
      .where(
        and(
          eq(connectionTable.id, connectionId),
          eq(connectionTable.tenantId, tenantId),
          eq(connectionTable.secretRef, found.secretRef),
        ),
      )
      .returning({ id: connectionTable.id });
    if (written.length !== 1) return 'no_account';
    await hooks.recorded?.(db);
    return 'stored';
  });
}

/**
 * The record to store when a Cirrux account's app password is replaced,
 * carrying its Drive grant across, read UNDER THE LOCK inside the caller's
 * own transaction (`PUT /api/connections/:id/credentials`).
 *
 * Merged from a record read before the lock, the grant could be one a
 * refresh retired in the meantime, and storing it again would sign the person
 * out at the next one. So the route takes the row lock in the transaction its
 * UPDATE runs in, and merges what it reads there.
 */
export async function mergeKeepingTheDriveGrant(
  db: PgDatabase,
  tenantId: string,
  connectionId: string,
  replacement: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ secretRef: connectionTable.secretRef })
    .from(connectionTable)
    .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)))
    .for('update');
  const stored = rows[0]?.secretRef ? SecretStore.decryptCredentials(rows[0].secretRef) : {};
  return keepingTheDriveGrant(stored, replacement);
}

/**
 * A new credential record for a Cirrux account, carrying its stored Drive
 * grant across: a person replacing the app password keeps their Drive
 * connected, as long as the mailbox is the same one. Another mailbox's app
 * password starts without it, because the grant was that person's sign-in.
 */
export function keepingTheDriveGrant(
  stored: Readonly<Record<string, string>>,
  replacement: Readonly<Record<string, string>>,
): Record<string, string> {
  const grant = stored[CIRRUX_DRIVE_GRANT_KEY];
  const sameMailbox =
    (stored.username ?? '').trim().toLowerCase() === (replacement.username ?? '').trim().toLowerCase();
  return grant && sameMailbox ? { ...replacement, [CIRRUX_DRIVE_GRANT_KEY]: grant } : { ...replacement };
}
