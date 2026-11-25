// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT SAVED FOR SOMEBODY ELSE (workplan 0174 §8.2, T6).
 *
 * *Start a migration*, with *They do, with a link* chosen, saves the person's
 * password account (an IMAP mailbox, their iCloud, their Soverin account) by
 * its server and its account alone. The person types the password on their
 * grant link's page, where it is tested before it is stored (T3); the one
 * saving it never holds it. The create door takes `forPerson: <personId>` for
 * this, and this file says what that flag changes:
 *
 *  - ONLY A PASSWORD KIND (`isPasswordKind`, the seam's two lists). A sign-in
 *    account saved by its address for a link is saved as it was before
 *    (0108), and a kind no link connects cannot be saved for a person.
 *  - NO SECRET IS REQUIRED, AND NONE IS TAKEN. `credentialFieldRequired`
 *    answers false for every secret field with `forPerson`, and a secret sent
 *    anyway is refused rather than stored: a password for a person's account
 *    that passed through the one saving it is exactly what 0174 exists to
 *    end (§1, *"no person's password ever has to pass through the one who
 *    sets up the migration"*).
 *  - EVERY OTHER REQUIRED FIELD STAYS REQUIRED (D2): the server and the
 *    account are the owner's to set, because the person's page shows them and
 *    does not ask for them. A row without its server is refused. The one
 *    exception is a field the person's page lets them fill when the owner left
 *    it empty (`personFieldsFor`'s `who: 'person'`: Infomaniak's sync user
 *    name).
 *  - NOT PROBED, and no status of its own (§8.2, open question 3). There is
 *    nothing to log in with, and a login tried with no password against the
 *    person's own server is a refused login there, counted against them. The
 *    row is stored `error`, which is what saving a Google or Microsoft
 *    account by its address alone for a link writes (its probe has no token
 *    and fails), and what it waits for is an observation of the rows, as
 *    `awaitingGrantRefusal` is: it has no password, and a migration of a
 *    person's uses it. The CHECK on `connection.status` is untouched.
 *  - The person must be this organisation's. Whose account it is is not
 *    stored now: `person_granted_connection` is written when they grant.
 *
 * Managed only: `person` is a managed row (ADR-0036), and the appliance has
 * no links (D7). This is `apps/api`'s, which the appliance never loads.
 */

import { and, asc, eq, inArray, or } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { person, personMigration } from '@openmig/managed/schema-managed';
import { credentialFieldRequired, isPasswordKind, type CredentialField } from '@openmig/shared';
import { personFieldsFor } from './grant-providers.ts';
import { credential, storedCredentials } from './migrations/grant-subject.ts';

/** A refusal of the create door, as its other refusals are shaped. */
export interface ForPersonRefusal {
  readonly status: 400 | 404;
  readonly body: { readonly error: string; readonly reason: string; readonly fields?: string[] };
}

/**
 * Why this kind, with these values, cannot be saved for a person; null when
 * it can. Pure: the person's row is read by `personOfThisOrganisation`.
 */
export function forPersonRefusal(
  role: 'source' | 'target',
  kind: string,
  fields: ReadonlyArray<CredentialField>,
  values: Readonly<Record<string, string>>,
): ForPersonRefusal | null {
  if (!isPasswordKind(role, kind)) {
    return {
      status: 400,
      body: {
        error: 'not_by_link',
        reason:
          'This account is not one a person connects with their own password on a grant link, ' +
          'so it cannot be saved for them without its credentials.',
      },
    };
  }
  const sent = fields.filter((f) => f.secret === true && (values[f.key] ?? '').trim() !== '').map((f) => f.key);
  if (sent.length > 0) {
    return {
      status: 400,
      body: {
        error: 'secret_for_person',
        fields: sent,
        reason:
          'An account saved for somebody else takes no password: they type it themselves, on the ' +
          'page their grant link opens, and it never passes through you.',
      },
    };
  }
  return null;
}

/** The non-secret fields the person's page lets them fill, when the owner left them empty. */
function theirFields(role: 'source' | 'target', kind: string): ReadonlySet<string> {
  if (!isPasswordKind(role, kind)) return new Set();
  return new Set(
    personFieldsFor(role, kind, {})
      .filter((f) => f.who === 'person' && !f.secret)
      .map((f) => f.key),
  );
}

/**
 * The fields still missing from an account saved for a person: every
 * required field but a secret, and but one the person's page lets them fill.
 */
export function missingForPerson(
  role: 'source' | 'target',
  kind: string,
  fields: ReadonlyArray<CredentialField>,
  values: Readonly<Record<string, string>>,
): string[] {
  const theirs = theirFields(role, kind);
  return fields
    .filter((f) => credentialFieldRequired(f, { deploymentClient: true, forPerson: true }) && !theirs.has(f.key))
    .filter((f) => !(values[f.key] ?? '').trim())
    .map((f) => f.key);
}

/**
 * The values as the create door's config shape reads them, for an account
 * saved for a person: each field the person fills (the secrets, and one
 * their page lets them fill) given as empty when it was not sent, so a shape
 * that types a password or a user name as present (the target's) checks the
 * rest. The empty values reach no credential record: the door builds that
 * from what was sent.
 */
export function shapedForPerson(
  role: 'source' | 'target',
  kind: string,
  fields: ReadonlyArray<CredentialField>,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const theirs = theirFields(role, kind);
  const out: Record<string, string> = { ...values };
  for (const f of fields) {
    if (out[f.key] === undefined && (f.secret === true || theirs.has(f.key))) out[f.key] = '';
  }
  return out;
}

/** Whether this person is this organisation's, read inside the caller's tenant transaction. */
export async function personOfThisOrganisation(db: PgDatabase, tenantId: string, personId: string): Promise<boolean> {
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}

/** The door's refusal for a person who is not this organisation's. */
export const PERSON_NOT_FOUND: ForPersonRefusal = {
  status: 404,
  body: { error: 'person_not_found', reason: 'This organisation has no such person.' },
};

/** Whom an account on the Accounts page waits for (0174 §8.2): the person who types its password. */
export interface WaitingFor {
  readonly personId: string;
  readonly name: string;
}

/** The keys that give a password account a way in, any one of them (`awaitingGrantRefusal`'s). */
const PASSWORD_KEYS = ['password', 'appPassword', 'mailPassword'] as const;

const hasAPassword = (secretRef: string | null): boolean => {
  const creds = storedCredentials(secretRef);
  return PASSWORD_KEYS.some((k) => credential(creds, k) !== '');
};

/**
 * WAITING FOR {PERSON}, ON THE ACCOUNTS PAGE (0174 §8.2). An observation of
 * the rows, as `awaitingGrantRefusal` is, never a status: a password account
 * that holds no password, used by a migration of a person's whose side of it
 * has none either (a source's password lands on the migration, ADR-0035
 * decision 4; a destination's on the account, D1). Answered by connection,
 * with the person first added; an account no person's migration uses yet, or
 * one whose password is in, waits for nobody. The encrypted records are read
 * for which keys they carry, never for a value, and only for the password
 * kinds among the rows given.
 */
export async function waitingForPeople(
  db: PgDatabase,
  tenantId: string,
  connections: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly kind: string;
    readonly secretRef: string | null;
  }>,
): Promise<Map<string, WaitingFor>> {
  const out = new Map<string, WaitingFor>();
  const candidates = connections.filter(
    (c) => (c.role === 'source' || c.role === 'target') && isPasswordKind(c.role, c.kind) && !hasAPassword(c.secretRef),
  );
  if (candidates.length === 0) return out;
  const rows = await db
    .select({
      connectionId: schema.mailbox.connectionId,
      mailboxId: schema.mailbox.id,
      sourceMailboxId: schema.mailboxMapping.sourceMailboxId,
      sourceSecretRef: schema.mailboxMapping.sourceSecretRef,
      personId: person.id,
      name: person.displayName,
    })
    .from(schema.mailbox)
    .innerJoin(
      schema.mailboxMapping,
      or(
        eq(schema.mailboxMapping.sourceMailboxId, schema.mailbox.id),
        eq(schema.mailboxMapping.targetMailboxId, schema.mailbox.id),
      ),
    )
    .innerJoin(personMigration, eq(personMigration.mappingId, schema.mailboxMapping.id))
    .innerJoin(person, eq(person.id, personMigration.personId))
    .where(
      and(
        eq(schema.mailbox.tenantId, tenantId),
        eq(personMigration.tenantId, tenantId),
        inArray(
          schema.mailbox.connectionId,
          candidates.map((c) => c.id),
        ),
      ),
    )
    .orderBy(asc(personMigration.addedAt));
  const roleOf = new Map(candidates.map((c) => [c.id, c.role]));
  for (const r of rows) {
    if (out.has(r.connectionId)) continue;
    const asSource = r.sourceMailboxId === r.mailboxId;
    if (roleOf.get(r.connectionId) === 'source') {
      // The person's password for a source lands on the migration.
      if (!asSource || hasAPassword(r.sourceSecretRef)) continue;
    } else if (asSource) {
      continue;
    }
    out.set(r.connectionId, { personId: r.personId, name: r.name });
  }
  return out;
}
