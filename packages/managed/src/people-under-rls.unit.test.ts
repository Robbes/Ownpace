// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PEOPLE AN ORGANISATION IS MOVING (ADR-0050, amended by the owner on
 * 2026-09-28; workplan 0153 T2): `people.ts` and managed migration 0031.
 *
 *  - a person is a name and an address or none, and has no state of its own:
 *    what is said about one is their migrations' states, counted;
 *  - a migration belongs to at most one person, and adding it again changes
 *    nothing;
 *  - deleting a person deletes no migration, and deleting a migration leaves
 *    the person;
 *  - an organisation sees and writes its own people only, and a row can name
 *    neither another organisation's person nor another organisation's
 *    migration, whoever writes it.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { MAPPING_LIFECYCLES } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { addMigrationToPerson, createPerson, deletePerson, listPeople, readPerson } from './people.ts';

// UUID family 0153a2b0-…, unused elsewhere in the repo.
const P = '0153a2b0-e29b-41d4-a716-4466554430';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const OUR_CONN = `${P}11`;
const OUR_BOX = `${P}12`;
const THEIR_CONN = `${P}13`;
const THEIR_BOX = `${P}14`;
/** Our three migrations, made in this order. */
const MAIL = `${P}21`;
const FILES = `${P}22`;
const OLD = `${P}23`;
/** A fourth, deleted in its own test. */
const GONE = `${P}24`;
/** Theirs. */
const THEIR_MAIL = `${P}31`;

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** What the statement's refusal says, or null when it went through. */
async function refusal(tenantId: string, statement: string): Promise<string | null> {
  return withTenant(driver, tenantId, (db) => db.execute(sql.raw(statement))).then(
    () => null,
    (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ''}`,
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [OURS, 'Ours BV'],
    [THEIRS, 'Theirs BV'],
  ]) {
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [id, name]);
  }
  for (const [conn, box, tenant] of [
    [OUR_CONN, OUR_BOX, OURS],
    [THEIR_CONN, THEIR_BOX, THEIRS],
  ]) {
    await owner(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'source', '{}'::jsonb, 'connected')`,
      [conn, tenant],
    );
    await owner(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'someone@example.org')`,
      [box, tenant, conn],
    );
  }
  // One second apart, so "oldest first" has an order to keep.
  for (const [i, [id, tenant, box, status]] of [
    [MAIL, OURS, OUR_BOX, 'active'],
    [FILES, OURS, OUR_BOX, 'paused'],
    [OLD, OURS, OUR_BOX, 'done'],
    [GONE, OURS, OUR_BOX, 'paused'],
    [THEIR_MAIL, THEIRS, THEIR_BOX, 'active'],
  ].entries()) {
    await owner(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, created_at)
       VALUES ($1, $2, $3, $4, now() - make_interval(secs => $5))`,
      [id, tenant, box, status, 100 - i],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('before anybody is named', () => {
  it('lists nobody, and every migration as nobody’s, oldest first', async () => {
    const got = await withTenant(driver, OURS, (db) => listPeople(db, OURS));

    expect(got).toEqual({
      people: [],
      unassigned: [
        { id: MAIL, status: 'active' },
        { id: FILES, status: 'paused' },
        { id: OLD, status: 'done' },
        { id: GONE, status: 'paused' },
      ],
    });
  });
});

describe('a person, and the migrations that are theirs', () => {
  let anna = '';
  let bram = '';

  it('is created with a name and an address, no migrations, and every state counted at nought', async () => {
    const created = await withTenant(driver, OURS, (db) =>
      createPerson(db, OURS, { displayName: 'Anna de Vries', email: 'anna@example.org' }),
    );
    anna = created.id;

    expect(created).toMatchObject({
      implicit: false,
      displayName: 'Anna de Vries',
      email: 'anna@example.org',
      migrations: [],
    });
    expect(Date.parse(created.createdAt!)).not.toBeNaN();
    expect(Object.keys(created.counts).sort()).toEqual([...MAPPING_LIFECYCLES].sort());
    expect(Object.values(created.counts)).toEqual(MAPPING_LIFECYCLES.map(() => 0));
  });

  it('is created with a name alone', async () => {
    const created = await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName: 'Bram', email: null }));
    bram = created.id;

    expect(created.email).toBeNull();
  });

  it('gets a migration, and counts it by its state', async () => {
    const got = await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, anna, MAIL));

    expect(got.kind).toBe('added');
    expect(got.kind === 'added' && got.person.migrations).toEqual([{ id: MAIL, status: 'active' }]);
    expect(got.kind === 'added' && got.person.counts).toMatchObject({ active: 1, paused: 0, done: 0 });
  });

  it('gets it again as nothing new, and holds one row for it', async () => {
    const got = await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, anna, MAIL));

    expect(got.kind).toBe('already_theirs');
    expect(await owner(`SELECT person_id FROM person_migration WHERE mapping_id = $1`, [MAIL])).toEqual([
      { person_id: anna },
    ]);
  });

  it('keeps a migration with its person when another asks for it, and says whose it is', async () => {
    const got = await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, bram, MAIL));

    expect(got).toEqual({ kind: 'with_another_person', personId: anna });
    const still = await withTenant(driver, OURS, (db) => readPerson(db, OURS, bram));
    expect(still?.migrations).toEqual([]);
  });

  it('lists each person with theirs, and the rest as nobody’s', async () => {
    await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, anna, OLD));

    const got = await withTenant(driver, OURS, (db) => listPeople(db, OURS));

    expect(got.people.map((p) => [p.displayName, p.migrations.map((m) => m.id)])).toEqual([
      ['Anna de Vries', [MAIL, OLD]],
      ['Bram', []],
    ]);
    expect(got.people[0]!.counts).toMatchObject({ active: 1, done: 1, paused: 0 });
    expect(got.unassigned.map((m) => m.id)).toEqual([FILES, GONE]);
  });

  it('keeps the person when a migration of theirs is deleted', async () => {
    await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, bram, GONE));
    await withTenant(driver, OURS, (db) => db.execute(sql`DELETE FROM mailbox_mapping WHERE id = ${GONE}`));

    const got = await withTenant(driver, OURS, (db) => readPerson(db, OURS, bram));

    expect(got?.displayName).toBe('Bram');
    expect(got?.migrations).toEqual([]);
    expect(await owner(`SELECT 1 FROM person_migration WHERE mapping_id = $1`, [GONE])).toEqual([]);
  });

  it('is deleted without deleting a migration: theirs belong to nobody again', async () => {
    const gone = await withTenant(driver, OURS, (db) => deletePerson(db, OURS, anna));

    expect(gone).toEqual({ deleted: true, unassigned: [MAIL, OLD] });
    expect(
      (await owner(`SELECT id FROM mailbox_mapping WHERE id = ANY($1::uuid[]) ORDER BY id`, [[MAIL, OLD]])).length,
    ).toBe(2);
    const after = await withTenant(driver, OURS, (db) => listPeople(db, OURS));
    expect(after.people.map((p) => p.displayName)).toEqual(['Bram']);
    expect(after.unassigned.map((m) => m.id)).toEqual([MAIL, FILES, OLD]);
  });

  it('is not there to delete twice', async () => {
    expect(await withTenant(driver, OURS, (db) => deletePerson(db, OURS, anna))).toBeUndefined();
  });

  it('answers nobody for an id that names no person', async () => {
    expect(await withTenant(driver, OURS, (db) => readPerson(db, OURS, anna))).toBeUndefined();
    expect(await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, anna, FILES))).toEqual({
      kind: 'no_such_person',
    });
  });
});

describe('one organisation’s people, and nobody else’s', () => {
  let ourPerson = '';
  let theirPerson = '';

  beforeAll(async () => {
    ourPerson = (await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName: 'Carla', email: null })))
      .id;
    theirPerson = (
      await withTenant(driver, THEIRS, (db) => createPerson(db, THEIRS, { displayName: 'Dirk', email: null }))
    ).id;
  });

  it('lists its own people only', async () => {
    const ours = await withTenant(driver, OURS, (db) => listPeople(db, OURS));
    const theirs = await withTenant(driver, THEIRS, (db) => listPeople(db, THEIRS));

    expect(ours.people.map((p) => p.displayName)).not.toContain('Dirk');
    expect(theirs.people.map((p) => p.displayName)).toEqual(['Dirk']);
    expect(theirs.unassigned.map((m) => m.id)).toEqual([THEIR_MAIL]);
  });

  it('finds neither another organisation’s person nor another organisation’s migration', async () => {
    expect(await withTenant(driver, OURS, (db) => readPerson(db, OURS, theirPerson))).toBeUndefined();
    expect(await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, theirPerson, FILES))).toEqual({
      kind: 'no_such_person',
    });
    expect(await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, ourPerson, THEIR_MAIL))).toEqual({
      kind: 'no_such_migration',
    });
  });

  it('refuses a row naming another organisation’s migration, written straight to the table', async () => {
    const said = await refusal(
      OURS,
      `INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ('${THEIR_MAIL}', '${ourPerson}', '${OURS}')`,
    );

    expect(said).toMatch(/row-level security/);
    expect(await owner(`SELECT 1 FROM person_migration WHERE mapping_id = $1`, [THEIR_MAIL])).toEqual([]);
  });

  it('refuses a row naming another organisation’s person, written straight to the table', async () => {
    const said = await refusal(
      OURS,
      `INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ('${FILES}', '${theirPerson}', '${OURS}')`,
    );

    expect(said).toMatch(/foreign key/);
    expect(await owner(`SELECT 1 FROM person_migration WHERE mapping_id = $1`, [FILES])).toEqual([]);
  });

  it('refuses a row written for another organisation', async () => {
    for (const statement of [
      `INSERT INTO person (tenant_id, display_name) VALUES ('${THEIRS}', 'Eve')`,
      `INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ('${THEIR_MAIL}', '${theirPerson}', '${THEIRS}')`,
    ]) {
      expect(await refusal(OURS, statement), statement).toMatch(/row-level security/);
    }
  });

  it('cannot change or delete another organisation’s person', async () => {
    await withTenant(driver, OURS, (db) =>
      db.execute(sql`UPDATE person SET display_name = 'Mallory' WHERE id = ${theirPerson}`),
    );
    expect(await withTenant(driver, OURS, (db) => deletePerson(db, OURS, theirPerson))).toBeUndefined();

    expect(await owner(`SELECT display_name FROM person WHERE id = $1`, [theirPerson])).toEqual([
      { display_name: 'Dirk' },
    ]);
  });
});

describe('what the table itself refuses', () => {
  it('a name that is nothing, or a page of text', async () => {
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      await expect(
        owner(`INSERT INTO person (tenant_id, display_name) VALUES ($1, $2)`, [OURS, name]),
        JSON.stringify(name.slice(0, 5)),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('an address with no @ in it, or too long to be one', async () => {
    for (const email of ['anna', '@example.org', `${'a'.repeat(250)}@example.org`]) {
      await expect(
        owner(`INSERT INTO person (tenant_id, display_name, email) VALUES ($1, 'Anna', $2)`, [OURS, email]),
        email.slice(0, 12),
      ).rejects.toThrow(/check constraint/i);
    }
  });
});
