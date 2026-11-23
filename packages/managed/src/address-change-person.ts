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
 * rows linked to them here and no other, each named by an opaque `ref`
 * (`linkRowRef`), and changes a row's state and nothing else, and only while
 * the row still says the new address the page showed
 * (`answerAddressChangeByLink`), through the ledger's one writer and under the
 * organisation's lock. Their confirmation is stored as theirs
 * (`confirmedByPerson`, `person:<id>`): it reads *Confirmed* to them and
 * *Confirmed by ‹person›* to everyone else, never as a member's address and
 * never as an id.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { lockAddressChanges, recordAddressChangeWrite, updateAddressChange } from '@openmig/ledger';
import {
  confirmedByPerson,
  personWhoConfirmed,
  saidBy,
  type AddressChange,
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
    confirmedByThePerson: person !== undefined && personWhoConfirmed(row.confirmedBy) === person.id,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    person: person === undefined ? null : { id: person.id, displayName: person.displayName },
  };
}

/**
 * One row as a person's own link shows it (0168 §4.4): the line on the grant
 * and progress pages, named by an opaque `ref`. Only the new address, which
 * the line asks about, and the state: never the old address, which is often
 * the Google account itself, and which a progress page, alive for up to 180
 * days and forwardable, names nowhere else. Nothing about who set or
 * confirmed it, and nothing about anybody else's rows.
 */
export interface LinkAddressChange {
  readonly ref: string;
  readonly newAddress: string;
  readonly state: AddressChangeState;
}

/**
 * A row's name on its person's links: a hash of the organisation, the person
 * and the old key, so it cannot be worked out from an address, and a press
 * through somebody else's link names nothing it can reach. Stable while the
 * row is linked to the person; a row moved to another person gets another.
 */
export function linkRowRef(tenantId: string, personId: string, oldKey: string): string {
  return createHash('sha256').update(`address-change\n${tenantId}\n${personId}\n${oldKey}`).digest('hex').slice(0, 32);
}

/** A row of the person's, as the server keeps it for their link: with the key, which never leaves. */
interface Theirs {
  readonly oldKey: string;
  readonly newAddress: string;
  readonly state: AddressChangeState;
}

/** The rows linked to this person, oldest first. Nobody else's. */
async function readTheirs(db: PgDatabase, tenantId: string, personId: string): Promise<Theirs[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT a.old_key, a.new_address, a.state
        FROM address_change_person l
        JOIN address_change a ON a.tenant_id = l.tenant_id AND a.old_key = l.old_key
       WHERE l.tenant_id = ${tenantId}::uuid AND l.person_id = ${personId}::uuid
       ORDER BY a.created_at, a.old_key`),
  );
  return rows.map((r) => ({
    oldKey: String(r.old_key),
    newAddress: String(r.new_address),
    state: r.state === 'confirmed' ? 'confirmed' : 'proposed',
  }));
}

const linkRow = (tenantId: string, personId: string, r: Theirs): LinkAddressChange => ({
  ref: linkRowRef(tenantId, personId, r.oldKey),
  newAddress: r.newAddress,
  state: r.state,
});

/** The rows linked to this person, oldest first, as their link shows them. Nobody else's. */
export async function readLinkAddressChanges(
  db: PgDatabase,
  tenantId: string,
  personId: string,
): Promise<LinkAddressChange[]> {
  return (await readTheirs(db, tenantId, personId)).map((r) => linkRow(tenantId, personId, r));
}

/**
 * Who answered through a link, as the audit log records it: the door's link
 * holder (`grant-link` or `progress-link`, the actors each door's other records
 * name, since a link carries no sign-in), the audit export's pseudonym under
 * this deployment's key, read before the transaction opens, and the link's own
 * id, as a withdrawal through a person's link records it.
 */
export interface LinkAnswerAudit {
  readonly actor: string;
  readonly pseudonym: Pseudonymize;
  readonly personLinkId?: string;
}

/** What a person's link says about one of their rows: which, the answer, and the address the page showed. */
export interface LinkAnswer {
  readonly ref: string;
  readonly state: AddressChangeState;
  /** The new address the page showed when the button was pressed: what *Yes* confirms. */
  readonly newAddress: string;
}

/**
 * How a press through a link went: the row as the link shows it now, or why
 * nothing was written. `not_found`: no row of this person's has that ref.
 * `changed`: the row's new address is no longer the one the page showed. The
 * route words both, in English and in Dutch.
 */
export type LinkAddressChangeWrite =
  | { readonly ok: true; readonly row: LinkAddressChange }
  | { readonly ok: false; readonly refused: 'not_found' | 'changed' };

/**
 * A person's answer through their own link (0168 §4.4, D6): *Yes, that is
 * right* confirms their row, *Not right?* sends it back to `proposed`. The
 * state, and nothing else, of the address the page showed.
 *
 * The organisation's lock first (`lockAddressChanges`), then the person's own
 * rows, then the write through `@openmig/ledger`'s one writer, which takes the
 * same lock again. So whose row it is and what it says hold from the check to
 * the write: the organisation's routes write and link a row under that lock,
 * and two presses at once are one after the other, the second changing
 * nothing.
 *
 * A ref is looked for among this person's rows only, so every ref this link
 * does not reach (somebody else's, a deleted row's, one never made) is the
 * same `not_found` after the same work: the lock and the one read. A link
 * learns nothing of anybody else's rows, not even by the time it takes.
 *
 * A row whose new address is not the one the page showed is `changed`, and
 * nothing is written: a confirmation is of one new address, the one the
 * person read (`updateAddressChange`'s own rule), never of whatever the row
 * says when the press lands.
 *
 * Each answer that changed the row is recorded in the audit log in the same
 * transaction (`recordAddressChangeWrite`, as the organisation's routes record
 * theirs): the door's link holder as the actor, `via: 'link'`, the person's
 * id, the link's id, and the row by its pseudonym, never by its address. A
 * press that changed nothing records nothing.
 */
export async function answerAddressChangeByLink(
  db: PgDatabase,
  tenantId: string,
  personId: string,
  answer: LinkAnswer,
  audit: LinkAnswerAudit,
): Promise<LinkAddressChangeWrite> {
  await lockAddressChanges(db, tenantId);
  const row = (await readTheirs(db, tenantId, personId)).find(
    (r) => linkRowRef(tenantId, personId, r.oldKey) === answer.ref,
  );
  if (row === undefined) return { ok: false, refused: 'not_found' };
  if (row.newAddress !== answer.newAddress.trim()) return { ok: false, refused: 'changed' };
  const written = await updateAddressChange(db, tenantId, row.oldKey, { state: answer.state, by: confirmedByPerson(personId) });
  // Read under the lock a moment ago, and only its state is asked for: a
  // refusal here is a defect, said as one (hard rule 9), not a 404.
  if (!written.ok) throw new Error(`The link's own row was refused after it was read under the lock: ${written.refusal.error}`);
  await recordAddressChangeWrite(db, tenantId, {
    actor: audit.actor,
    via: 'link',
    pseudonym: audit.pseudonym,
    before: written.before,
    after: written.row,
    person: { id: personId, moved: false },
    ...(audit.personLinkId === undefined ? {} : { personLinkId: audit.personLinkId }),
  });
  return { ok: true, row: linkRow(tenantId, personId, written.row) };
}
