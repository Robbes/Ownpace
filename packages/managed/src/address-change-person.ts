// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE ADDRESS CHANGES, ON MANAGED (ADR-0055; workplan 0168 T2, §4.2; managed
 * migration 0063).
 *
 * The shared chain's `address_change` is the organisation's table; which
 * person a row is for is a managed row of its own, `address_change_person`,
 * because `person` is managed-only (hard rule 5). This file reads and writes
 * that link, and turns the stored rows into the answer the managed routes give:
 * each with its person, and who set and confirmed it said as the member's
 * address (`tenant_member.email`), never as the sign-in's subject.
 *
 * Every function runs inside the organisation's own transaction
 * (`withTenant`), and filters by the tenant as well as row security does.
 *
 * ## The link door (0168 §4.4, D6; ADR-0035)
 *
 * A person who has a link and no account confirms their own rows on the grant
 * and progress pages, or sends one back (*Not right?*). Their link reaches the
 * rows linked to them here and no other, and changes a row's state and
 * nothing else (`answerAddressChangeByLink`), through the ledger's one writer
 * and under the organisation's lock. Their confirmation is stored as theirs
 * (`confirmedByPerson`, `person:<id>`): it reads *Confirmed* to them and
 * *Confirmed by ‹person›* to everyone else, never as a member's address and
 * never as an id.
 */

import { sql } from 'drizzle-orm';
import { recordAddressChangeWrite, updateAddressChange } from '@openmig/ledger';
import {
  addressChangeNotFound,
  confirmedByPerson,
  personWhoConfirmed,
  saidBy,
  type AddressChange,
  type AddressChangeRefusal,
  type AddressChangeState,
  type StoredAddressChange,
} from '@openmig/shared';
import type { Pseudonymize } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger/db';

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] }).rows ?? []) as Row[];

/** A row's person, and the member that person is, when they are one. */
export interface AddressChangePersonOf {
  readonly id: string;
  readonly displayName: string;
  /** `person.user_id`: the member this person is, or null. Never answered; it says who "you" are. */
  readonly userId?: string | null;
}

/** The person each row is for, by old key. */
export async function readAddressChangePeople(
  db: PgDatabase,
  tenantId: string,
): Promise<Map<string, AddressChangePersonOf>> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT l.old_key, p.id, p.display_name, p.user_id
        FROM address_change_person l
        JOIN person p ON p.id = l.person_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${tenantId}::uuid`),
  );
  return new Map(
    rows.map((r) => [
      String(r.old_key),
      {
        id: String(r.id),
        displayName: String(r.display_name),
        userId: r.user_id === null || r.user_id === undefined ? null : String(r.user_id),
      },
    ]),
  );
}

/** Whether the organisation has this person. */
export async function hasPerson(db: PgDatabase, tenantId: string, personId: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`SELECT 1 FROM person WHERE id = ${personId}::uuid AND tenant_id = ${tenantId}::uuid`),
  );
  return rows.length > 0;
}

/**
 * The old keys of the rows that are the asker's own: linked to the person
 * who is their member (`person.user_id`, managed 0061). A member who is not
 * an owner or an admin reads only these, and confirms or sends back only
 * these (0168 §4.4; the review's finding 1). Empty for a member who is
 * nobody's person, and for no sign-in at all.
 */
export async function ownAddressChangeKeys(
  db: PgDatabase,
  tenantId: string,
  userId: string | undefined,
): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = rowsOf(
    await db.execute(sql`
      SELECT l.old_key
        FROM address_change_person l
        JOIN person p ON p.id = l.person_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${tenantId}::uuid AND p.user_id = ${userId}`),
  );
  return new Set(rows.map((r) => String(r.old_key)));
}

/**
 * Link a row to a person, or unlink it with null. Saying it again changes
 * nothing. Answers whether the link moved, for the write's audit record.
 */
export async function linkAddressChangePerson(
  db: PgDatabase,
  tenantId: string,
  oldKey: string,
  personId: string | null,
): Promise<boolean> {
  if (personId === null) {
    const gone = rowsOf(
      await db.execute(
        sql`DELETE FROM address_change_person WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey} RETURNING old_key`,
      ),
    );
    return gone.length > 0;
  }
  const linked = rowsOf(
    await db.execute(sql`
      INSERT INTO address_change_person (tenant_id, old_key, person_id)
      VALUES (${tenantId}::uuid, ${oldKey}, ${personId}::uuid)
      ON CONFLICT (tenant_id, old_key) DO UPDATE SET person_id = EXCLUDED.person_id, linked_at = now()
       WHERE address_change_person.person_id IS DISTINCT FROM EXCLUDED.person_id
      RETURNING old_key`),
  );
  return linked.length > 0;
}

/**
 * Who a stored setter or confirmer is, in words: each member's address by
 * their sign-in subject, and each person's name by `person:<id>`, which is
 * what their own confirmation through their link stores (`confirmedByPerson`).
 */
export async function memberLabels(db: PgDatabase, tenantId: string): Promise<Map<string, string>> {
  const members = rowsOf(
    await db.execute(sql`SELECT user_id, email FROM tenant_member WHERE tenant_id = ${tenantId}::uuid`),
  );
  const people = rowsOf(
    await db.execute(sql`SELECT id, display_name FROM person WHERE tenant_id = ${tenantId}::uuid`),
  );
  return new Map([
    ...members
      .filter((r) => r.user_id && r.email)
      .map((r): [string, string] => [String(r.user_id), String(r.email)]),
    ...people.map((r): [string, string] => [confirmedByPerson(String(r.id)), String(r.display_name)]),
  ]);
}

/** A stored row as the managed routes answer it, for the member who asks. */
export function addressChangeAnswer(
  row: StoredAddressChange,
  facts: {
    readonly labels: ReadonlyMap<string, string>;
    readonly people: ReadonlyMap<string, AddressChangePersonOf>;
    readonly asker: string | undefined;
  },
): AddressChange {
  const label = (s: string): string | null => facts.labels.get(s) ?? null;
  const person = facts.people.get(row.oldKey);
  // The row's person confirmed it through their own link, and the asker is
  // the member that person is: it is theirs, so it reads *Confirmed*.
  const theirOwn =
    person !== undefined &&
    personWhoConfirmed(row.confirmedBy) === person.id &&
    typeof person.userId === 'string' &&
    person.userId === facts.asker;
  return {
    oldAddress: row.oldAddress,
    oldKey: row.oldKey,
    newAddress: row.newAddress,
    state: row.state,
    setBy: saidBy(row.setBy, label),
    setByYou: facts.asker !== undefined && row.setBy === facts.asker,
    confirmedBy: saidBy(row.confirmedBy, label),
    confirmedByYou: facts.asker !== undefined && (row.confirmedBy === facts.asker || theirOwn),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    person: person === undefined ? null : { id: person.id, displayName: person.displayName },
  };
}

/**
 * One row as a person's own link shows it (0168 §4.4): the line on the grant
 * and progress pages, and the key a press names. Nothing about who set or
 * confirmed it, and nothing about anybody else's rows.
 */
export interface LinkAddressChange {
  readonly oldKey: string;
  readonly oldAddress: string;
  readonly newAddress: string;
  readonly state: AddressChangeState;
}

const linkRow = (r: StoredAddressChange): LinkAddressChange => ({
  oldKey: r.oldKey,
  oldAddress: r.oldAddress,
  newAddress: r.newAddress,
  state: r.state,
});

/** The rows linked to this person, oldest first, as their link shows them. Nobody else's. */
export async function readLinkAddressChanges(
  db: PgDatabase,
  tenantId: string,
  personId: string,
): Promise<LinkAddressChange[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT a.old_key, a.old_address, a.new_address, a.state
        FROM address_change_person l
        JOIN address_change a ON a.tenant_id = l.tenant_id AND a.old_key = l.old_key
       WHERE l.tenant_id = ${tenantId}::uuid AND l.person_id = ${personId}::uuid
       ORDER BY a.created_at, a.old_key`),
  );
  return rows.map((r) => ({
    oldKey: String(r.old_key),
    oldAddress: String(r.old_address),
    newAddress: String(r.new_address),
    state: r.state === 'confirmed' ? 'confirmed' : 'proposed',
  }));
}

/** Whether this row is linked to this person. */
async function isAddressChangeOf(db: PgDatabase, tenantId: string, oldKey: string, personId: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT 1 FROM address_change_person
       WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey} AND person_id = ${personId}::uuid`),
  );
  return rows.length > 0;
}

/**
 * Who answered through a link, as the audit log records it: the door's link
 * holder (`grant-link` or `progress-link`, the actors each door's other records
 * name, since a link carries no sign-in), and the audit export's pseudonym
 * under this deployment's key, read before the transaction opens.
 */
export interface LinkAnswerAudit {
  readonly actor: string;
  readonly pseudonym: Pseudonymize;
}

/** How a press through a link went: the row as the link shows it now, or the refusal. */
export type LinkAddressChangeWrite =
  | { readonly ok: true; readonly row: LinkAddressChange }
  | { readonly ok: false; readonly refusal: AddressChangeRefusal };

/**
 * A person's answer through their own link (0168 §4.4, D6): *Yes, that is
 * right* confirms their row, *Not right?* sends it back to `proposed`. The
 * state, and nothing else.
 *
 * Through `@openmig/ledger`'s one writer, which takes the organisation's lock.
 * The first call says nothing new, so it writes nothing: it takes that lock
 * and reads the row, and the lock is held to the end of the transaction, so
 * whose row it is cannot change between the check and the write (the
 * organisation's routes link a row under the same lock). Two presses at once
 * are one after the other, and the second changes nothing.
 *
 * A row that is not linked to this person is answered as one that does not
 * exist, in the same words, so a link learns nothing of anybody else's rows.
 *
 * Each answer that changed the row is recorded in the audit log in the same
 * transaction (`recordAddressChangeWrite`, as the organisation's routes record
 * theirs): the door's link holder as the actor, `via: 'link'`, the person's
 * id, and the row by its pseudonym, never by its address. A press that changed
 * nothing records nothing.
 */
export async function answerAddressChangeByLink(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  oldKey: string,
  state: AddressChangeState,
  audit: LinkAnswerAudit,
): Promise<LinkAddressChangeWrite> {
  const by = confirmedByPerson(personId);
  const held = await updateAddressChange(db, tenantId, oldKey, { by });
  if (!held.ok) return held;
  // The ledger's own words for a key with no row, so the two cannot be told apart.
  if (!(await isAddressChangeOf(db, tenantId, oldKey, personId))) {
    return { ok: false, refusal: addressChangeNotFound(oldKey) };
  }
  const written = await updateAddressChange(db, tenantId, oldKey, { state, by });
  if (!written.ok) return written;
  await recordAddressChangeWrite(db, tenantId, {
    actor: audit.actor,
    via: 'link',
    pseudonym: audit.pseudonym,
    before: written.before,
    after: written.row,
    person: { id: personId, moved: false },
  });
  return { ok: true, row: linkRow(written.row) };
}
