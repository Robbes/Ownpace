// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PERSON YOU ARE (ADR-0050, amended 2026-11-19; workplan 0153 T4):
 * `people.ts` and managed migration 0061.
 *
 *  - a person may be one member's own, written only from that member's
 *    subject, and a read says `you` to them alone, with no account id in it;
 *  - one person per member: linking another moves the link, in one
 *    transaction, and the table refuses two;
 *  - a person who is another member's stays theirs, and "this is not me"
 *    undoes only the asker's own link;
 *  - removing the member clears the link and keeps the person;
 *  - one organisation's members link only its own people, whoever writes it.
 *
 * PGlite as `app_user`, both chains. The people and subjects are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  addMigrationToPerson,
  createMyself,
  createPerson,
  listPeople,
  markMyself,
  readPerson,
  unmarkMyself,
} from './people.ts';

// UUID family 0153a2d0-…, unused elsewhere in the repo.
const P = '0153a2d0-e29b-41d4-a716-4466554430';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const OUR_CONN = `${P}11`;
const OUR_BOX = `${P}12`;
const MAIL = `${P}21`;

/** Sign-in subjects, as an identity provider issues them. */
const ANNA = 'subject-anna';
const BRAM = 'subject-bram';
const CARLA = 'subject-carla';
const SUSPENDED = 'subject-suspended';
const DIRK = 'subject-dirk';

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

/** Whose account a person row holds, read past row security. */
const linkOf = async (personId: string): Promise<unknown> =>
  (await owner(`SELECT user_id FROM person WHERE id = $1`, [personId]))[0]?.user_id;

/** A new person who is nobody's account, in our organisation. */
const somebody = async (displayName: string): Promise<string> =>
  (await withTenant(driver, OURS, (db) => createPerson(db, OURS, { displayName, email: null }))).id;

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
  for (const [tenant, subject, status] of [
    [OURS, ANNA, 'active'],
    [OURS, BRAM, 'active'],
    [OURS, CARLA, 'active'],
    [OURS, SUSPENDED, 'suspended'],
    [THEIRS, DIRK, 'active'],
  ]) {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'member', $4)`,
      [tenant, subject, `${subject}@example.com`, status],
    );
  }
  await owner(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'source', '{}'::jsonb, 'connected')`,
    [OUR_CONN, OURS],
  );
  await owner(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'someone@example.com')`,
    [OUR_BOX, OURS, OUR_CONN],
  );
  await owner(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`,
    [MAIL, OURS, OUR_BOX],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('a person who is a member’s own', () => {
  let anna = '';

  it('is made by that member as Myself: the row holds their subject, and the answer says you', async () => {
    const made = await withTenant(driver, OURS, (db) =>
      createMyself(db, OURS, { displayName: 'Anna de Vries', email: null }, ANNA),
    );

    expect(made.kind).toBe('created');
    anna = made.kind === 'created' ? made.person.id : '';
    expect(made.kind === 'created' && made.person.you).toBe(true);
    expect(await linkOf(anna)).toBe(ANNA);
  });

  it('is you to that member alone, and carries no account id in any answer', async () => {
    await somebody('Bram Bakker');
    for (const [asking, yours] of [
      [ANNA, ['Anna de Vries']],
      [BRAM, []],
      [undefined, []],
    ] as const) {
      const got = await withTenant(driver, OURS, (db) => listPeople(db, OURS, asking));
      expect(got.people.filter((p) => p.you).map((p) => p.displayName), String(asking)).toEqual(yours);
      expect(JSON.stringify(got), String(asking)).not.toContain(ANNA);
      expect(got.people.every((p) => !('userId' in p) && !('user_id' in p))).toBe(true);
    }
    const one = await withTenant(driver, OURS, (db) => readPerson(db, OURS, anna, ANNA));
    expect(one?.you).toBe(true);
    expect(JSON.stringify(one)).not.toContain(ANNA);
  });

  it('stays you when a migration is added to them', async () => {
    const got = await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, anna, MAIL, ANNA));

    expect(got.kind === 'added' && got.person.you).toBe(true);
  });

  it('moves, in one transaction, when the member says another person is them', async () => {
    const other = await somebody('Anna (work)');

    const got = await withTenant(driver, OURS, (db) => markMyself(db, OURS, other, ANNA));

    expect(got.kind).toBe('marked');
    expect(got.kind === 'marked' && got.person.you).toBe(true);
    expect(await linkOf(other)).toBe(ANNA);
    expect(await linkOf(anna)).toBeNull();
    const listed = await withTenant(driver, OURS, (db) => listPeople(db, OURS, ANNA));
    expect(listed.people.filter((p) => p.you).map((p) => p.displayName)).toEqual(['Anna (work)']);
    // And back again, by making a new one as Myself.
    const again = await withTenant(driver, OURS, (db) =>
      createMyself(db, OURS, { displayName: 'Anna J.', email: null }, ANNA),
    );
    expect(await linkOf(other)).toBeNull();
    expect(again.kind === 'created' && (await linkOf(again.person.id))).toBe(ANNA);
  });

  it('changes nothing when the member says it twice', async () => {
    const mine = await somebody('Bram B.');
    await withTenant(driver, OURS, (db) => markMyself(db, OURS, mine, BRAM));

    const got = await withTenant(driver, OURS, (db) => markMyself(db, OURS, mine, BRAM));

    expect(got.kind).toBe('already_yours');
    expect(await linkOf(mine)).toBe(BRAM);
  });

  it('stays another member’s when somebody else says it is them', async () => {
    const brams = (await owner(`SELECT id FROM person WHERE user_id = $1`, [BRAM]))[0]!.id as string;

    const got = await withTenant(driver, OURS, (db) => markMyself(db, OURS, brams, CARLA));

    expect(got).toEqual({ kind: 'another_members' });
    expect(await linkOf(brams)).toBe(BRAM);
  });

  it('is undone by "this is not me" only for the member whose it is', async () => {
    const brams = (await owner(`SELECT id FROM person WHERE user_id = $1`, [BRAM]))[0]!.id as string;

    const notCarlas = await withTenant(driver, OURS, (db) => unmarkMyself(db, OURS, brams, CARLA));
    expect(notCarlas.kind).toBe('not_yours');
    expect(await linkOf(brams)).toBe(BRAM);

    const undone = await withTenant(driver, OURS, (db) => unmarkMyself(db, OURS, brams, BRAM));
    expect(undone.kind).toBe('unmarked');
    expect(undone.kind === 'unmarked' && undone.person.you).toBe(false);
    expect(await linkOf(brams)).toBeNull();

    const twice = await withTenant(driver, OURS, (db) => unmarkMyself(db, OURS, brams, BRAM));
    expect(twice.kind).toBe('not_yours');
  });

  it('answers nobody for an id that names no person', async () => {
    const gone = '0153a2d0-e29b-41d4-a716-446655443099';
    expect(await withTenant(driver, OURS, (db) => markMyself(db, OURS, gone, ANNA))).toEqual({
      kind: 'no_such_person',
    });
    expect(await withTenant(driver, OURS, (db) => unmarkMyself(db, OURS, gone, ANNA))).toEqual({
      kind: 'no_such_person',
    });
  });
});

describe('nobody who is not an active member here', () => {
  it('can say a person is them, and nothing is written', async () => {
    const carlo = await somebody('Carlo');
    for (const asking of ['subject-stranger', SUSPENDED, DIRK, undefined]) {
      expect(await withTenant(driver, OURS, (db) => markMyself(db, OURS, carlo, asking)), String(asking)).toEqual({
        kind: 'not_a_member',
      });
    }
    expect(await linkOf(carlo)).toBeNull();
  });

  it('can be made a person as Myself, and no person is made', async () => {
    const before = await owner(`SELECT count(*)::int AS n FROM person`);
    for (const asking of ['subject-stranger', SUSPENDED, DIRK, undefined]) {
      expect(
        await withTenant(driver, OURS, (db) => createMyself(db, OURS, { displayName: 'Mallory', email: null }, asking)),
        String(asking),
      ).toEqual({ kind: 'not_a_member' });
    }
    expect(await owner(`SELECT count(*)::int AS n FROM person`)).toEqual(before);
  });
});

describe('one organisation’s members, and nobody else’s', () => {
  let dirks = '';

  beforeAll(async () => {
    const made = await withTenant(driver, THEIRS, (db) =>
      createMyself(db, THEIRS, { displayName: 'Dirk', email: null }, DIRK),
    );
    dirks = made.kind === 'created' ? made.person.id : '';
  });

  it('finds no person of another organisation to say is them', async () => {
    expect(await withTenant(driver, OURS, (db) => markMyself(db, OURS, dirks, ANNA))).toEqual({
      kind: 'no_such_person',
    });
    expect(await withTenant(driver, OURS, (db) => unmarkMyself(db, OURS, dirks, DIRK))).toEqual({
      kind: 'no_such_person',
    });
    expect(await linkOf(dirks)).toBe(DIRK);
  });

  it('never reads another organisation’s people, and none of ours is their member', async () => {
    const ours = await withTenant(driver, OURS, (db) => listPeople(db, OURS, DIRK));

    expect(ours.people.map((p) => p.displayName)).not.toContain('Dirk');
    expect(ours.people.some((p) => p.you)).toBe(false);
  });

  it('cannot link one of ours to another organisation’s member, written straight to the table', async () => {
    const ourPerson = await somebody('Eva');

    const said = await refusal(OURS, `UPDATE person SET user_id = '${DIRK}' WHERE id = '${ourPerson}'`);

    expect(said).toMatch(/foreign key/);
    expect(await linkOf(ourPerson)).toBeNull();
  });

  it('cannot change another organisation’s person’s link, written straight to the table', async () => {
    await withTenant(driver, OURS, (db) => db.execute(sql`UPDATE person SET user_id = NULL WHERE id = ${dirks}`));

    expect(await linkOf(dirks)).toBe(DIRK);
  });
});

describe('what the table itself refuses and does', () => {
  it('a second person for one member, written straight to the table', async () => {
    const holder = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;
    const another = await somebody('Anna again');

    const said = await refusal(OURS, `UPDATE person SET user_id = '${ANNA}' WHERE id = '${another}'`);

    expect(said).toMatch(/person_one_per_member|unique/);
    expect(await linkOf(holder)).toBe(ANNA);
    expect(await linkOf(another)).toBeNull();
  });

  it('removing the member sets the link back to nobody, and keeps the person and their migrations', async () => {
    const carlas = await somebody('Carla');
    await withTenant(driver, OURS, (db) => markMyself(db, OURS, carlas, CARLA));
    await withTenant(driver, OURS, (db) => addMigrationToPerson(db, OURS, carlas, MAIL));
    const before = await owner(`SELECT mapping_id FROM person_migration WHERE person_id = $1`, [carlas]);

    // The Team page's Remove: a DELETE on the request path, as app_user.
    await withTenant(driver, OURS, (db) =>
      db.execute(sql`DELETE FROM tenant_member WHERE tenant_id = ${OURS} AND user_id = ${CARLA}`),
    );

    expect(await owner(`SELECT display_name, user_id FROM person WHERE id = $1`, [carlas])).toEqual([
      { display_name: 'Carla', user_id: null },
    ]);
    expect(await owner(`SELECT mapping_id FROM person_migration WHERE person_id = $1`, [carlas])).toEqual(before);
  });

  it('a membership whose subject is rewritten carries its person with it', async () => {
    const holder = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;

    await owner(`UPDATE tenant_member SET user_id = 'subject-anna-2' WHERE tenant_id = $1 AND user_id = $2`, [
      OURS,
      ANNA,
    ]);

    expect(await linkOf(holder)).toBe('subject-anna-2');
  });
});
