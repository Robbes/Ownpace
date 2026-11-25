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
 *
 * ## And the grant taken off again (workplan 0160)
 *
 * *Disconnect Cirrux Drive* removes the one key, under the same lock
 * (`removeCirruxDriveGrant`): a refresh in flight finishes first, and the
 * successor it stored is the token removed, never one stored after it. The
 * app password and every other key stay. A pass that holds an access token
 * learns it from `holdsGrant` within a minute (`cirrux-token-provider.ts`).
 */

import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connection as connectionTable, withTenant, type LedgerDriver, type PgDatabase } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY, CIRRUX_DRIVE_WORKSPACE_KEY, hasCirruxDriveGrant } from '@openmig/shared';
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
  /** The connection's id: the name a disconnect forgets this process's access tokens by. */
  readonly connection: string;

  constructor(row: CirruxGrantRow) {
    this.row = row;
    this.connection = row.connectionId;
  }

  /**
   * Is a Drive grant stored on the row now? Read without the lock: an answer a
   * moment old is enough to stop handing out an access token whose grant was
   * disconnected, and a refresh that follows reads the token under the lock
   * anyway. A row that is gone holds none.
   */
  async holdsGrant(): Promise<boolean> {
    const { pool, tenantId, connectionId } = this.row;
    const stored = await withTenant(pool, tenantId, async (db) => {
      const rows = await db
        .select({ secretRef: connectionTable.secretRef })
        .from(connectionTable)
        .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)));
      return rows[0]?.secretRef;
    });
    return stored ? hasCirruxDriveGrant(SecretStore.decryptCredentials(stored)) : false;
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
  /**
   * The workspace the sign-in reached (Cirrux's `uuid`), when Cirrux named
   * one (workplan 0174 §4.4, T5). Recorded beside the grant the first time;
   * after that, a grant that reached another workspace is refused under the
   * lock, `another_workspace`, and nothing is written.
   */
  readonly workspace?: string;
}

/** What storing a Drive grant found under the lock. */
export type CirruxGrantStored<R> = 'stored' | 'no_account' | 'another_workspace' | { readonly refused: R };

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
): Promise<CirruxGrantStored<R>> {
  const { pool, tenantId, connectionId } = row;
  return withTenant(pool, tenantId, (db) => storeCirruxDriveGrantIn(db, { tenantId, connectionId }, refreshToken, hooks));
}

/**
 * The same store, inside a transaction the caller holds: a grant link's ending
 * writes the grant, the person's row and the audit lines in one (workplan
 * 0174 §4.4, T5). The lock, the refusal, the workspace and the compare-and-swap
 * are this function's, so the two endings cannot store a grant two ways.
 */
export async function storeCirruxDriveGrantIn<R = never>(
  db: PgDatabase,
  row: { readonly tenantId: string; readonly connectionId: string },
  refreshToken: string,
  hooks: GrantStoreHooks<R> = {},
): Promise<CirruxGrantStored<R>> {
  const { tenantId, connectionId } = row;
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
  const recorded = creds[CIRRUX_DRIVE_WORKSPACE_KEY];
  if (hooks.workspace !== undefined && typeof recorded === 'string' && recorded !== '' && recorded !== hooks.workspace) {
    return 'another_workspace';
  }
  const next: Record<string, string> = { ...creds, [CIRRUX_DRIVE_GRANT_KEY]: refreshToken };
  if (hooks.workspace !== undefined && hooks.workspace !== '') next[CIRRUX_DRIVE_WORKSPACE_KEY] = hooks.workspace;
  const written = await db
    .update(connectionTable)
    .set({ secretRef: sealed(next), updatedAt: new Date() })
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
}

/** What *Disconnect Cirrux Drive* found under the lock, and did. */
export type CirruxDriveRemoval =
  /** A grant was stored, and is not now. */
  | 'removed'
  /** None was stored: nothing to remove, and no failure. */
  | 'not_connected'
  /** No Cirrux destination of this organisation has that id. */
  | 'no_account';

/** What the disconnect's own transaction writes beside the removal. */
export interface GrantRemovalHooks {
  /**
   * The file face to store in the account's record, so no screen reads the
   * Drive as connected once this commits: the measured no the face answers
   * without a grant. Written whether or not a grant was found, since a record
   * can still say connected after Cirrux ended the sign-in. A row with no
   * record is left without one.
   */
  readonly face?: Readonly<Record<string, unknown>>;
  /** Written in the same transaction when a grant was removed (the audit line), so both commit or neither. */
  readonly recorded?: (db: PgDatabase) => Promise<void>;
}

/** The stored record with its file face replaced, or undefined when there is no record to replace it in. */
function withFileFace(stored: unknown, face: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const domains = (stored as { domains?: unknown }).domains;
  if (typeof domains !== 'object' || domains === null) return undefined;
  return { ...(stored as Record<string, unknown>), domains: { ...(domains as Record<string, unknown>), file: face } };
}

/**
 * DISCONNECT CIRRUX DRIVE: take the Drive grant off a Cirrux account, and
 * nothing else (workplan 0160; ADR-0052).
 *
 * Under the row lock every refresh takes, so a refresh in flight stores its
 * successor first and that is the token removed. Only `CIRRUX_DRIVE_GRANT_KEY`
 * leaves the record: the app password and every other key are encrypted again
 * as they were, through `SecretStore`, by a compare-and-swap on what was read.
 * Only on a `cirrux` DESTINATION in this tenant, as the consent door stores
 * one. Nothing is asked of Cirrux here, and no token leaves this function.
 */
export async function removeCirruxDriveGrant(
  row: CirruxGrantRow,
  hooks: GrantRemovalHooks = {},
): Promise<CirruxDriveRemoval> {
  const { pool, tenantId, connectionId } = row;
  return withTenant(pool, tenantId, async (db) => {
    const rows = await db
      .select({
        secretRef: connectionTable.secretRef,
        kind: connectionTable.kind,
        role: connectionTable.role,
        qualification: connectionTable.qualification,
      })
      .from(connectionTable)
      .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)))
      .for('update');
    const found = rows[0];
    if (!found || found.kind !== 'cirrux' || found.role !== 'target') return 'no_account';
    const qualification = hooks.face ? withFileFace(found.qualification, hooks.face) : undefined;
    const creds = found.secretRef ? SecretStore.decryptCredentials(found.secretRef) : {};
    if (!found.secretRef || !hasCirruxDriveGrant(creds)) {
      // Nothing to remove. A record that still says the Drive is connected
      // (Cirrux ended the sign-in since the last Test) is put right.
      if (qualification) {
        await db
          .update(connectionTable)
          .set({ qualification, updatedAt: new Date() })
          .where(and(eq(connectionTable.id, connectionId), eq(connectionTable.tenantId, tenantId)));
      }
      return 'not_connected';
    }
    const kept: Record<string, string> = { ...creds };
    delete kept[CIRRUX_DRIVE_GRANT_KEY];
    // THE COMPARE-AND-SWAP, on the ciphertext read under the lock.
    const written = await db
      .update(connectionTable)
      .set({ secretRef: sealed(kept), ...(qualification ? { qualification } : {}), updatedAt: new Date() })
      .where(
        and(
          eq(connectionTable.id, connectionId),
          eq(connectionTable.tenantId, tenantId),
          eq(connectionTable.secretRef, found.secretRef),
        ),
      )
      .returning({ id: connectionTable.id });
    if (written.length !== 1) {
      // Not reachable while the lock holds; if it ever is, nothing was removed, and that is said.
      throw new Error(
        `The stored credentials of the Cirrux account ${connectionId} changed while its Drive was being ` +
          'disconnected, so nothing was removed. Press Disconnect Cirrux Drive again.',
      );
    }
    await hooks.recorded?.(db);
    return 'removed';
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
  const workspace = stored[CIRRUX_DRIVE_WORKSPACE_KEY];
  const sameMailbox =
    (stored.username ?? '').trim().toLowerCase() === (replacement.username ?? '').trim().toLowerCase();
  if (!sameMailbox) return { ...replacement };
  // The workspace a grant reached stays with the mailbox, grant or not
  // (workplan 0174 §4.4): a later grant must reach the same one.
  return {
    ...replacement,
    ...(grant ? { [CIRRUX_DRIVE_GRANT_KEY]: grant } : {}),
    ...(workspace ? { [CIRRUX_DRIVE_WORKSPACE_KEY]: workspace } : {}),
  };
}
