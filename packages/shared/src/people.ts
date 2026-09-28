// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE PERSON A MIGRATION IS FOR (ADR-0050, amended by the owner on 2026-09-28;
 * workplan 0153 T2).
 *
 * The Migrations page lists people: one card per person being moved, with that
 * person's migrations under it (0153 T3). A person is a name, and optionally
 * an email address for grant links (0108). A migration belongs to at most one
 * person, and one that belongs to nobody is `unassigned`: every migration made
 * before people existed is.
 *
 * A PERSON CHANGES NOTHING ABOUT A MIGRATION. The engine runs migrations, the
 * ledger keys items per migration, ADR-0014 bills paths, and a person is never
 * billed. So a person has no state of its own (hard rule 10): what a screen
 * says about one is their migrations' states, here, and their stages
 * (`stage.ts`, 0154 T1).
 *
 * BOTH EDITIONS ANSWER THESE SHAPES (ADR-0026). Managed keeps people as rows
 * (`person` and `person_migration`, managed migration 0031, read by
 * `@openmig/managed`'s `people.ts`) and builds its answer with `peopleFrom`.
 * The appliance moves one person and has no table: it answers with
 * `implicitPeople`, one person holding every migration it is configured with.
 * `one-answer-from-both-editions.unit.test.ts` holds the two builders to one
 * shape.
 *
 * THE WORD IN CODE IS *person*, not ADR-0050's *move*: `/moves` and
 * `MovesQueue` already mean the items a source put somewhere else (§11.2), and
 * the owner chose "person / people" on 2026-09-28. On screen the grouping has
 * no noun: a card carries the person's name (0153 D6).
 */

import { MAPPING_LIFECYCLES, type MappingLifecycle } from './operating-contract.ts';

/** The appliance's one person's id. It has no row, so it has no uuid. */
export const IMPLICIT_PERSON_ID = 'implicit';

/** The longest name a person may have. `person`'s CHECK says the same. */
export const PERSON_NAME_MAX = 200;

/** The longest address a person may have (RFC 5321's path). `person`'s CHECK says the same. */
export const PERSON_EMAIL_MAX = 254;

/** The refusals the people routes answer with, beside a validation error. */
export const PERSON_NOT_FOUND = 'person_not_found';
export const MIGRATION_NOT_FOUND = 'migration_not_found';
/** The migration already belongs to somebody else: at most one person per migration. */
export const WITH_ANOTHER_PERSON = 'with_another_person';
/** The appliance's answer to a write: it moves one person, and has nobody else to add. */
export const ONE_PERSON_HERE = 'one_person_here';

/** One of a person's migrations, and where it is. */
export interface PersonMigration {
  /** The id this edition's migration routes take: a uuid on managed, the config's id on the appliance. */
  readonly id: string;
  readonly status: MappingLifecycle;
}

/** How many migrations are in each state. Every state is present, zero included. */
export type LifecycleCounts = Readonly<Record<MappingLifecycle, number>>;

/** A person being moved, and their migrations. */
export interface Person {
  readonly id: string;
  /** True for the appliance's one person, who has no row, no name and no address. */
  readonly implicit: boolean;
  /** The name that titles the person's card. Null only for the implicit person. */
  readonly displayName: string | null;
  /** Where grant links go (0108), when somebody gave one. */
  readonly email: string | null;
  /** ISO. Null only for the implicit person. */
  readonly createdAt: string | null;
  /** Their migrations, oldest first. */
  readonly migrations: readonly PersonMigration[];
  /** Their migrations' states, counted. A person has no state of its own. */
  readonly counts: LifecycleCounts;
}

/** `GET /people` on both editions. */
export interface PeopleResponse {
  /** Oldest first. */
  readonly people: readonly Person[];
  /** Migrations that belong to nobody, oldest first. Always empty on the appliance. */
  readonly unassigned: readonly PersonMigration[];
}

/** `POST /people`'s body. */
export interface CreatePersonRequest {
  readonly displayName: string;
  readonly email?: string | null;
}

/** `POST /people/{personId}/migrations`' body. */
export interface AddPersonMigrationRequest {
  readonly mappingId: string;
}

/** `DELETE /people/{personId}`'s answer: the person is gone, and these migrations belong to nobody again. */
export interface PersonDeleted {
  readonly deleted: true;
  readonly unassigned: readonly string[];
}

/** A person as the managed store reads one, before its migrations are put under it. */
export interface PersonRow {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly createdAt: string;
}

/** A migration's state, and the person it belongs to if any. */
export interface MigrationRow extends PersonMigration {
  readonly personId: string | null;
}

/** Each state's count, every state present. */
export function lifecycleCounts(migrations: readonly PersonMigration[]): LifecycleCounts {
  const counts = Object.fromEntries(MAPPING_LIFECYCLES.map((l) => [l, 0])) as Record<MappingLifecycle, number>;
  for (const m of migrations) {
    if (!MAPPING_LIFECYCLES.includes(m.status)) {
      // The database's CHECK makes this impossible. A state this list does not
      // know is shown as a fault, never counted as nothing (hard rule 9).
      throw new Error(`migration ${m.id} is '${m.status}', which is not one of ${MAPPING_LIFECYCLES.join(', ')}`);
    }
    counts[m.status] += 1;
  }
  return counts;
}

/**
 * Managed's answer: each person with the migrations that name them, and the
 * migrations that name nobody.
 *
 * `people` and `migrations` come in the order the page shows them, oldest
 * first. A migration naming a person who is not in `people` is a fault, not a
 * migration with nobody: one transaction read both, under one organisation's
 * policy, and the key cannot point at nobody.
 */
export function peopleFrom(people: readonly PersonRow[], migrations: readonly MigrationRow[]): PeopleResponse {
  const theirs = new Map<string, PersonMigration[]>(people.map((p) => [p.id, []]));
  const unassigned: PersonMigration[] = [];
  for (const m of migrations) {
    const migration: PersonMigration = { id: m.id, status: m.status };
    if (m.personId === null) {
      unassigned.push(migration);
      continue;
    }
    const list = theirs.get(m.personId);
    if (!list) throw new Error(`migration ${m.id} belongs to person ${m.personId}, who was not read with it`);
    list.push(migration);
  }
  return {
    people: people.map((p) => {
      const list = theirs.get(p.id)!;
      return {
        id: p.id,
        implicit: false,
        displayName: p.displayName,
        email: p.email,
        createdAt: p.createdAt,
        migrations: list,
        counts: lifecycleCounts(list),
      };
    }),
    unassigned,
  };
}

/** The appliance's answer: one person, who every configured migration is for. */
export function implicitPeople(migrations: readonly PersonMigration[]): PeopleResponse {
  const list = migrations.map((m) => ({ id: m.id, status: m.status }));
  return {
    people: [
      {
        id: IMPLICIT_PERSON_ID,
        implicit: true,
        displayName: null,
        email: null,
        createdAt: null,
        migrations: list,
        counts: lifecycleCounts(list),
      },
    ],
    unassigned: [],
  };
}
