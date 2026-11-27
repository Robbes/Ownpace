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
 *
 * THE PERSON YOU ARE (ADR-0050, amended 2026-11-19; managed migration 0061).
 * A person may be one member's own: `person.user_id` holds that member's
 * sign-in subject, so *Who is it for?* can choose them first. Three things
 * hold it:
 *
 * - **Only the member links themselves.** `createMyself` and `markMyself`
 *   take the subject the caller signed in with, which the route reads from
 *   the session; nothing here takes an account id from anywhere else.
 * - **The id stays here.** A read is given the asking subject and answers
 *   `you`, true for their own person; `user_id` itself is in no answer.
 * - **One person per member.** Linking another person moves the link, off the
 *   old one first, in the caller's transaction, so the unique index never
 *   holds two. A person who is another member's stays theirs.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
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
  type PersonVoice,
  isPersonVoice,
} from '@openmig/shared';
import { person, personMigration, tenantMember } from './schema-managed.ts';

/** What `createPerson` and `createMyself` store: a name, and an address or none. */
export interface NewPerson {
  readonly displayName: string;
  readonly email: string | null;
}

/**
 * Whom a read says `you` to: the asking member's sign-in subject
 * (`tenant_member.user_id`), or undefined where nobody asks, as for a job.
 * Then no person is anybody's `you`.
 */
export type Asking = string | undefined;

/** What making the asking member's own person came to. */
export type CreateMyselfOutcome =
  | { readonly kind: 'created'; readonly person: Person }
  /** The subject is no active member here, so no person can be theirs. */
  | { readonly kind: 'not_a_member' };

/** What saying "this is me" of a person came to. */
export type MarkMyselfOutcome =
  /** Linked now. Any other person of theirs here is no longer theirs. */
  | { readonly kind: 'marked'; readonly person: Person }
  /** Pressed twice, or re-sent: it converges, and changes nothing. */
  | { readonly kind: 'already_yours'; readonly person: Person }
  | { readonly kind: 'no_such_person' }
  | { readonly kind: 'not_a_member' }
  /** The person is another member's own: only they can say it is not them. */
  | { readonly kind: 'another_members' };

/** What saying "this is not me" of a person came to. */
export type UnmarkMyselfOutcome =
  | { readonly kind: 'unmarked'; readonly person: Person }
  /** It was not theirs (nobody's, or another member's): nothing changed. */
  | { readonly kind: 'not_yours'; readonly person: Person }
  | { readonly kind: 'no_such_person' };

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
  userId: person.userId,
  voice: person.voice,
};

/** The row as the answer carries it: `user_id` becomes `you`, and goes no further. */
function personRow(
  row: { id: string; displayName: string; email: string | null; createdAt: Date; userId: string | null; voice: string | null },
  asking: Asking,
): PersonRow {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    you: asking !== undefined && row.userId === asking,
    // Read through the list, as the migration's CHECK holds it (0176 T7).
    voice: isPersonVoice(row.voice) ? row.voice : null,
  };
}

/**
 * How a person's own pages speak to them, set where a member makes their link
 * (workplan 0176 T7, D8 (a)), in the caller's tenant transaction: one of
 * `PERSON_VOICES`, or null for unset. False when the organisation has no such
 * person.
 */
export async function setPersonVoice(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  voice: PersonVoice | null,
): Promise<boolean> {
  const set = await db
    .update(person)
    .set({ voice })
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)))
    .returning({ id: person.id });
  return set.length > 0;
}

/** How a person's own pages speak to them, or null when unset or the person is gone (0176 T7). */
export async function readPersonVoice(db: PgDatabase, tenantId: string, personId: string): Promise<PersonVoice | null> {
  const [row] = await db
    .select({ voice: person.voice })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)));
  return isPersonVoice(row?.voice) ? row.voice : null;
}

/**
 * Whether the subject is an active member of the organisation, the only one
 * a person here can be, with their row locked until the caller's transaction
 * ends. Two links by one member then wait for each other, and so does their
 * removal, which locks the same row before its key changes their person: the
 * member's row first and the person's after, in both, so neither deadlocks.
 */
async function lockMemberHere(db: PgDatabase, tenantId: string, subject: Asking): Promise<boolean> {
  if (subject === undefined) return false;
  const [row] = await db
    .select({ id: tenantMember.id })
    .from(tenantMember)
    .where(
      and(eq(tenantMember.tenantId, tenantId), eq(tenantMember.userId, subject), eq(tenantMember.status, 'active')),
    )
    .for('update');
  return row !== undefined;
}

/** The member's link off whichever person of theirs holds it here, before it is put on another. */
async function letGoOfOwnPerson(db: PgDatabase, tenantId: string, subject: string): Promise<void> {
  await db
    .update(person)
    .set({ userId: null })
    .where(and(eq(person.tenantId, tenantId), eq(person.userId, subject)));
}

/** Everyone the organisation is moving, oldest first, and the migrations that are nobody's yet. */
export async function listPeople(db: PgDatabase, tenantId: string, asking?: Asking): Promise<PeopleResponse> {
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
    people.map((p) => personRow(p, asking)),
    migrations.map((m): MigrationRow => ({ id: m.id, status: lifecycleOf(m.id, m.status), personId: m.personId })),
  );
}

/**
 * Who a migration is for: the person it belongs to, by id and name, or
 * undefined when it belongs to nobody (or is not this organisation's). At most
 * one person holds a migration (`person_migration`'s key). A link is made on
 * that person's page (ADR-0035, amended 2026-09-29), so the migration's own
 * doors name them.
 */
export async function readPersonOfMigration(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<{ readonly id: string; readonly displayName: string } | undefined> {
  const [row] = await db
    .select({ id: person.id, displayName: person.displayName })
    .from(personMigration)
    .innerJoin(person, and(eq(person.id, personMigration.personId), eq(person.tenantId, personMigration.tenantId)))
    .where(and(eq(personMigration.mappingId, mappingId), eq(personMigration.tenantId, tenantId)));
  return row;
}

/** One person with their migrations, or undefined when the organisation has nobody by that id. */
export async function readPerson(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  asking?: Asking,
): Promise<Person | undefined> {
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
    [personRow(row, asking)],
    migrations.map((m): MigrationRow => ({ id: m.id, status: lifecycleOf(m.id, m.status), personId })),
  ).people[0];
}

/** A new person, with no migrations yet, and nobody's account. */
export async function createPerson(db: PgDatabase, tenantId: string, input: NewPerson): Promise<Person> {
  const [row] = await db
    .insert(person)
    .values({ tenantId, displayName: input.displayName, email: input.email })
    .returning(personColumns);
  if (!row) throw new Error('the insert into person returned no row');
  return peopleFrom([personRow(row, undefined)], []).people[0]!;
}

/**
 * A new person who is the asking member (*Myself* when adding one). Their
 * link moves here from any other person of theirs in the organisation, in the
 * caller's transaction. `subject` is the one the caller signed in with.
 */
export async function createMyself(
  db: PgDatabase,
  tenantId: string,
  input: NewPerson,
  subject: Asking,
): Promise<CreateMyselfOutcome> {
  if (subject === undefined || !(await lockMemberHere(db, tenantId, subject))) return { kind: 'not_a_member' };
  await letGoOfOwnPerson(db, tenantId, subject);
  const [row] = await db
    .insert(person)
    .values({ tenantId, displayName: input.displayName, email: input.email, userId: subject })
    .returning(personColumns);
  if (!row) throw new Error('the insert into person returned no row');
  return { kind: 'created', person: peopleFrom([personRow(row, subject)], []).people[0]! };
}

/**
 * "This is me": the person becomes the asking member's own, and any other
 * person of theirs here stops being so, in the caller's transaction. A person
 * who is another member's stays theirs: linking is each member's own act.
 */
export async function markMyself(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  subject: Asking,
): Promise<MarkMyselfOutcome> {
  const member = await lockMemberHere(db, tenantId, subject);
  // Locked too, so another member's "this is me" waits for this one, and then
  // reads the person as this member's.
  const [found] = await db
    .select({ userId: person.userId })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)))
    .for('update');
  if (!found) return { kind: 'no_such_person' };
  if (subject === undefined || !member) return { kind: 'not_a_member' };
  if (found.userId !== null && found.userId !== subject) return { kind: 'another_members' };

  if (found.userId === null) {
    await letGoOfOwnPerson(db, tenantId, subject);
    const linked = await db
      .update(person)
      .set({ userId: subject })
      .where(and(eq(person.id, personId), eq(person.tenantId, tenantId), isNull(person.userId)))
      .returning({ id: person.id });
    // Locked as nobody's above, in this transaction: a row it cannot update
    // now is a fault, not a person to name.
    if (linked.length === 0) throw new Error(`person ${personId} was nobody's, and could not be linked`);
  }

  const now = await readPerson(db, tenantId, personId, subject);
  if (!now) throw new Error(`person ${personId} was read, and is gone in the same transaction`);
  return { kind: found.userId === null ? 'marked' : 'already_yours', person: now };
}

/**
 * "This is not me": the person stops being the asking member's own. Only
 * their own link is undone; a person who is nobody's, or another member's, is
 * left as it is, and the answer says so.
 */
export async function unmarkMyself(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  subject: Asking,
): Promise<UnmarkMyselfOutcome> {
  const [found] = await db
    .select({ userId: person.userId })
    .from(person)
    .where(and(eq(person.id, personId), eq(person.tenantId, tenantId)))
    .for('update');
  if (!found) return { kind: 'no_such_person' };
  const theirs = subject !== undefined && found.userId === subject;
  if (theirs) {
    await db
      .update(person)
      .set({ userId: null })
      .where(and(eq(person.id, personId), eq(person.tenantId, tenantId), eq(person.userId, subject)));
  }
  const now = await readPerson(db, tenantId, personId, subject);
  if (!now) throw new Error(`person ${personId} was read, and is gone in the same transaction`);
  return { kind: theirs ? 'unmarked' : 'not_yours', person: now };
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
  asking?: Asking,
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

  const now = await readPerson(db, tenantId, personId, asking);
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
