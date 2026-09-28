// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE PEOPLE AN ORGANISATION IS MOVING (ADR-0050, amended by the owner on
 * 2026-09-28; workplan 0153 T2; managed migration 0031).
 *
 * A person is a name, and optionally an address for grant links. A migration
 * belongs to at most one person. These are the four things the request path
 * does with them: list everyone with their migrations, create one, add a
 * migration to one, and delete one, which deletes no migration.
 *
 * Every function runs inside the organisation's own transaction
 * (`withTenant`), so the tables' policies hold each read and write to it, and a
 * route answers what one transaction saw. The shapes are `@openmig/shared`'s,
 * which the appliance answers too (ADR-0026), and the answer is built by the
 * same `peopleFrom` for a list and for one person.
 *
 * A person has no state of its own. What a screen says about one is their
 * migrations' states, read here from `mailbox_mapping` as the migration routes
 * read them, and nothing here writes a migration.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { mailboxMapping } from '@openmig/ledger/schema-pg';
import {
  MAPPING_LIFECYCLES,
  peopleFrom,
  type MappingLifecycle,
  type MigrationRow,
  type PeopleResponse,
  type Person,
  type PersonDeleted,
  type PersonRow,
} from '@openmig/shared';
import { person, personMigration } from './schema-managed.ts';

/** What `createPerson` stores: a name, and an address or none. */
export interface NewPerson {
  readonly displayName: string;
  readonly email: string | null;
}

/** What adding a migration to a person came to. */
export type AddMigrationOutcome =
  | { readonly kind: 'added'; readonly person: Person }
  /** Pressed twice, or re-sent: it converges, and changes nothing. */
  | { readonly kind: 'already_theirs'; readonly person: Person }
  | { readonly kind: 'no_such_person' }
  | { readonly kind: 'no_such_migration' }
  /** At most one person per migration: this one is somebody else's. */
  | { readonly kind: 'with_another_person'; readonly personId: string };

/** The state the database holds, or a fault: a word the lifecycle list lacks is never guessed (hard rule 9). */
function lifecycleOf(id: string, status: string): MappingLifecycle {
  if (!(MAPPING_LIFECYCLES as readonly string[]).includes(status)) {
    throw new Error(
      `migration ${id} is '${status}', which is not one of ${MAPPING_LIFECYCLES.join(', ')}. ` +
        "mailbox_mapping's CHECK should make this impossible; refusing to guess the migration's state.",
    );
  }
  return status as MappingLifecycle;
}

const personColumns = {
  id: person.id,
  displayName: person.displayName,
  email: person.email,
  createdAt: person.createdAt,
};

function personRow(row: { id: string; displayName: string; email: string | null; createdAt: Date }): PersonRow {
  return { id: row.id, displayName: row.displayName, email: row.email, createdAt: row.createdAt.toISOString() };
}

/** Everyone the organisation is moving, oldest first, and the migrations that are nobody's yet. */
export async function listPeople(db: PgDatabase, tenantId: string): Promise<PeopleResponse> {
  const people = await db
    .select(personColumns)
    .from(person)
    .where(eq(person.tenantId, tenantId))
    .orderBy(asc(person.createdAt), asc(person.id));
  const migrations = await db
    .select({ id: mailboxMapping.id, status: mailboxMapping.status, personId: personMigration.personId })
    .from(mailboxMapping)
    .leftJoin(personMigration, eq(personMigration.mappingId, mailboxMapping.id))
    .where(eq(mailboxMapping.tenantId, tenantId))
    .orderBy(asc(mailboxMapping.createdAt), asc(mailboxMapping.id));
  return peopleFrom(
    people.map(personRow),
    migrations.map((m): MigrationRow => ({ id: m.id, status: lifecycleOf(m.id, m.status), personId: m.personId })),
  );
}

/** One person with their migrations, or undefined when the organisation has nobody by that id. */
export async function readPerson(db: PgDatabase, tenantId: string, personId: string): Promise<Person | undefined> {
  const [row] = await db
    .select(personColumns)
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)));
  if (!row) return undefined;
  const migrations = await db
    .select({ id: mailboxMapping.id, status: mailboxMapping.status })
    .from(personMigration)
    .innerJoin(mailboxMapping, eq(mailboxMapping.id, personMigration.mappingId))
    .where(and(eq(personMigration.personId, personId), eq(personMigration.tenantId, tenantId)))
    .orderBy(asc(mailboxMapping.createdAt), asc(mailboxMapping.id));
  return peopleFrom(
    [personRow(row)],
    migrations.map((m): MigrationRow => ({ id: m.id, status: lifecycleOf(m.id, m.status), personId })),
  ).people[0];
}

/** A new person, with no migrations yet. */
export async function createPerson(db: PgDatabase, tenantId: string, input: NewPerson): Promise<Person> {
  const [row] = await db
    .insert(person)
    .values({ tenantId, displayName: input.displayName, email: input.email })
    .returning(personColumns);
  if (!row) throw new Error('the insert into person returned no row');
  return peopleFrom([personRow(row)], []).people[0]!;
}

/**
 * Add a migration to a person. Idempotent: adding it again changes nothing and
 * says so. A migration that is somebody else's stays theirs, and the answer
 * names whose: moving it between people is not a thing this does in passing.
 */
export async function addMigrationToPerson(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  mappingId: string,
): Promise<AddMigrationOutcome> {
  const [found] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)));
  if (!found) return { kind: 'no_such_person' };

  const [migration] = await db
    .select({ id: mailboxMapping.id })
    .from(mailboxMapping)
    .where(and(eq(mailboxMapping.id, mappingId), eq(mailboxMapping.tenantId, tenantId)));
  if (!migration) return { kind: 'no_such_migration' };

  const inserted = await db
    .insert(personMigration)
    .values({ mappingId, personId, tenantId })
    .onConflictDoNothing({ target: personMigration.mappingId })
    .returning({ mappingId: personMigration.mappingId });

  if (inserted.length === 0) {
    const [holder] = await db
      .select({ personId: personMigration.personId })
      .from(personMigration)
      .where(eq(personMigration.mappingId, mappingId));
    // The key said the migration is somebody's, and nobody is: a fault, not a person to name.
    if (!holder) throw new Error(`person_migration refused ${mappingId} and holds no row for it`);
    if (holder.personId !== personId) return { kind: 'with_another_person', personId: holder.personId };
  }

  const now = await readPerson(db, tenantId, personId);
  if (!now) throw new Error(`person ${personId} was read, and is gone in the same transaction`);
  return { kind: inserted.length > 0 ? 'added' : 'already_theirs', person: now };
}

/**
 * Delete a person. Their migrations are not deleted: they belong to nobody
 * again, and the answer lists them. Undefined when there is nobody by that id.
 */
export async function deletePerson(db: PgDatabase, tenantId: string, personId: string): Promise<PersonDeleted | undefined> {
  const theirs = await db
    .select({ mappingId: personMigration.mappingId })
    .from(personMigration)
    .innerJoin(mailboxMapping, eq(mailboxMapping.id, personMigration.mappingId))
    .where(and(eq(personMigration.personId, personId), eq(personMigration.tenantId, tenantId)))
    .orderBy(asc(mailboxMapping.createdAt), asc(mailboxMapping.id));
  // The key cascades: the person's rows in person_migration go with them, and nothing else does.
  const [gone] = await db
    .delete(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)))
    .returning({ id: person.id });
  if (!gone) return undefined;
  return { deleted: true, unassigned: theirs.map((t) => t.mappingId) };
}
