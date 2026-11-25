// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DESTINATION A PERSON CONNECTED THEMSELVES (workplan 0174 §4.3, D1 (a), D6;
 * managed migration 0064).
 *
 * When a person gives a destination its way in through their grant link (their
 * own password, or Cirrux Drive's sign-in), the secret lands on the
 * destination CONNECTION, because the account is theirs, and a row of
 * `person_granted_connection` says whose it is. This file writes that row and
 * holds the three doors to it:
 *
 * - **Only their migrations go into it.** A migration with no person, or
 *   another person's, is refused at every door that would point one at the
 *   account (`receivingRefusal`): the create door, the door that gives a
 *   migration to a person, and the edit door. Otherwise an owner could copy
 *   somebody else's data into an account that is not theirs, with a password
 *   they never saw.
 * - **Nobody else changes its way in** (D6, `rotationRefusal`). Otherwise an
 *   owner replaces the person's password with one they know, and the promise
 *   that it never passes through the owner holds only until the first
 *   rotation. The remedy is a new grant link.
 * - **One person per account** (`recordPersonGrantedConnection`). A second
 *   person's grant on an account a first one connected is refused, as the
 *   key is the connection.
 *
 * Managed only, as `person` is (ADR-0036, hard rule 5): the appliance has no
 * person and no link, and imports none of this (`no-managed-leakage`).
 * Every function runs in the caller's tenant transaction.
 */

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { mailbox, mailboxMapping } from '@openmig/ledger/schema-pg';
import type { Bilingual } from '@openmig/shared';
import { person, personGrantedConnection, personMigration } from './schema-managed.ts';

/** Who connected a destination themselves, or null when nobody did. */
export interface GrantedBy {
  readonly personId: string;
  readonly displayName: string;
}

/** The person who connected this destination through a link, or null. */
export async function readGrantedBy(
  db: PgDatabase,
  tenantId: string,
  connectionId: string,
): Promise<GrantedBy | null> {
  const rows = await db
    .select({ personId: personGrantedConnection.personId, displayName: person.displayName })
    .from(personGrantedConnection)
    .innerJoin(person, and(eq(person.id, personGrantedConnection.personId), eq(person.tenantId, personGrantedConnection.tenantId)))
    .where(and(eq(personGrantedConnection.connectionId, connectionId), eq(personGrantedConnection.tenantId, tenantId)));
  const row = rows[0];
  return row ? { personId: row.personId, displayName: row.displayName } : null;
}

/** The sentence for a migration pointed at an account somebody else connected (0174 §4.3). */
export function onlyTheirMigrations(name: string): Bilingual {
  return {
    en: `This account was connected by ${name}. It can only receive their migrations.`,
    nl: `Dit account is verbonden door ${name}. Het ontvangt alleen migraties van ${name}.`,
  };
}

/** The sentence for a new password or sign-in on an account a person connected (D6). */
export function connectedByThemselves(name: string): Bilingual {
  return {
    en: `${name} connected this account themselves. Make them a new grant link to change it.`,
    nl: `${name} heeft dit account zelf verbonden. Maak een nieuwe toegangslink voor ${name} om het te wijzigen.`,
  };
}

/**
 * Whether a migration of `personId` (null: a migration of nobody's) may go
 * into this destination: null when it may, the sentence when the account was
 * connected by somebody else.
 */
export async function receivingRefusal(
  db: PgDatabase,
  tenantId: string,
  connectionId: string,
  personId: string | null,
): Promise<Bilingual | null> {
  const by = await readGrantedBy(db, tenantId, connectionId);
  if (by === null || by.personId === personId) return null;
  return onlyTheirMigrations(by.displayName);
}

/**
 * The same question for a migration that exists: its destination's
 * connection, and the person it belongs to now, read here. Null when it may
 * stay, or there is no such migration (the caller's own 404 says that).
 */
export async function migrationReceivingRefusal(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  personId?: string | null,
): Promise<Bilingual | null> {
  const rows = await db
    .select({ connectionId: mailbox.connectionId })
    .from(mailboxMapping)
    .innerJoin(mailbox, eq(mailbox.id, mailboxMapping.targetMailboxId))
    .where(and(eq(mailboxMapping.id, mappingId), eq(mailboxMapping.tenantId, tenantId)));
  const connectionId = rows[0]?.connectionId;
  if (!connectionId) return null;
  let whose = personId;
  if (whose === undefined) {
    const held = await db
      .select({ personId: personMigration.personId })
      .from(personMigration)
      .where(and(eq(personMigration.mappingId, mappingId), eq(personMigration.tenantId, tenantId)));
    whose = held[0]?.personId ?? null;
  }
  return receivingRefusal(db, tenantId, connectionId, whose);
}

/** Null when the owner may give this account a new secret; the sentence when a person connected it (D6). */
export async function rotationRefusal(
  db: PgDatabase,
  tenantId: string,
  connectionId: string,
): Promise<Bilingual | null> {
  const by = await readGrantedBy(db, tenantId, connectionId);
  return by === null ? null : connectedByThemselves(by.displayName);
}

/** What recording a person's grant on a destination found. */
export type RecordedGrantedConnection = 'recorded' | { readonly heldBy: GrantedBy };

/**
 * Record that `personId` connected this destination through `linkId`, in the
 * caller's transaction (the one that stored the secret). Idempotent for the
 * same person, whose row then names the latest link; refused, writing
 * nothing, when another person connected it first, and the caller rolls back
 * the secret it wrote.
 */
export async function recordPersonGrantedConnection(
  db: PgDatabase,
  row: { readonly tenantId: string; readonly personId: string; readonly connectionId: string; readonly linkId: string },
): Promise<RecordedGrantedConnection> {
  const held = await readGrantedBy(db, row.tenantId, row.connectionId);
  if (held !== null && held.personId !== row.personId) return { heldBy: held };
  const written = await db
    .insert(personGrantedConnection)
    .values({ connectionId: row.connectionId, tenantId: row.tenantId, personId: row.personId, linkId: row.linkId })
    .onConflictDoUpdate({
      target: personGrantedConnection.connectionId,
      set: { linkId: row.linkId, grantedAt: new Date() },
      // Another person's row, written since the read above: left as it is.
      setWhere: eq(personGrantedConnection.personId, row.personId),
    })
    .returning({ connectionId: personGrantedConnection.connectionId });
  if (written.length === 1) return 'recorded';
  const now = await readGrantedBy(db, row.tenantId, row.connectionId);
  if (now === null) throw new Error(`person_granted_connection kept no row for ${row.connectionId} and names nobody`);
  return { heldBy: now };
}
