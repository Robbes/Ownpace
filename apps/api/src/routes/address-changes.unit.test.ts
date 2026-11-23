// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ORGANISATION'S ADDRESS CHANGES, OVER HTTP (ADR-0055; workplan 0168 T2).
 *
 * The real router on the real migrations of both chains, in PGlite, with only
 * `authenticate` stubbed. It holds:
 *
 *  - every answer is shaped as `openapi.yaml` says, and names who set and
 *    confirmed a row by the member's address, never by the sign-in's id;
 *  - another organisation never sees a row, cannot change or delete one;
 *  - the refusals (`not_an_address`, `same_address`, `already_changed`,
 *    `chained`) in English and Dutch, with their statuses, naming the row;
 *  - the same POST twice is 201 then 200, and writes one row;
 *  - a person is linked and unlinked, and another organisation's person is
 *    `person_not_found`, in both languages;
 *
 * and, since 0168's review:
 *
 *  - who may write (finding 1): an owner or an admin does everything; any
 *    other member reads and confirms or sends back only their own person's
 *    rows, and is refused everything else with 403, in both languages;
 *  - every write is recorded in `audit_log`, the row by reference and never
 *    by address (finding 4);
 *  - a value no address holds, or a key too long for the table, is
 *    `not_an_address`, never a 500 (finding 3); the table's size is capped
 *    (finding 11); a body's faults are said in Dutch without zod's English
 *    (N7).
 *
 * UUID family 0168a2e0-…, unused elsewhere in the repo. Addresses invented.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { parse } from 'yaml';
import { deploymentKeyFor, pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { ADDRESS_CHANGE_ROWS_MAX, AUDIT_DETAIL_FIELDS, AUDIT_PSEUDONYM_PURPOSE, pseudonymizer } from '@openmig/shared';
import { setAuditKeyDriver } from '../audit-key.ts';

const P = '0168a2e0-e29b-41d4-a716-4466554431';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const KID = `${P}11`;
const THEIR_PERSON = `${P}12`;
const MUM = `${P}13`;

let driver: LedgerDriver;
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: routes } = await import('./address-changes.ts');
// *Apply the new addresses here too*, the migration's press of this table (N7).
const { default: migrationRoutes } = await import('./migrations/index.ts');

const app = express();
app.use(express.json());
app.use('/api/address-changes', routes);
app.use('/api/migrations', migrationRoutes);

// Signed in as an admin unless a test says otherwise: the role every
// membership row below holds. It said `member` until 0168's review, which is
// the role finding 1 is about: a member may no longer add a row.
const as = (tenantId: string, userId = `member-of-${tenantId.slice(-2)}`, userRole = 'admin') => {
  caller = { tenantId, userId, userRole };
};

async function owner(statement: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(statement, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

type Schema = { properties?: Record<string, unknown>; required?: string[] };
const SPEC = parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};

function shapedAs(name: string, body: Record<string, unknown>): void {
  const schema = SPEC.components.schemas[name];
  expect(schema, `openapi.yaml has no schema ${name}`).toBeDefined();
  expect(Object.keys(body).sort(), name).toEqual(Object.keys(schema!.properties ?? {}).sort());
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Ours'), ($2, 'Theirs')`, [OURS, THEIRS]);
  for (const [tenant, subject] of [
    [OURS, 'member-of-01'],
    [OURS, 'admin-of-01'],
    [THEIRS, 'member-of-02'],
  ] as const) {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'admin', 'active')`,
      [tenant, subject, `${subject}@example.org`],
    );
  }
  await owner(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, '‹name›'), ($3, $4, '‹other›')`, [
    KID,
    OURS,
    THEIR_PERSON,
    THEIRS,
  ]);
  // The row's key is read on the owner's own connection (`audit-key.ts`), as
  // the API's start-up sets it; here the same in-process database.
  setAuditKeyDriver(driver);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('signed out', () => {
  it('answers 401 at every door', async () => {
    caller = {};
    for (const res of [
      await request(app).get('/api/address-changes'),
      await request(app).post('/api/address-changes').send({}),
      await request(app).put('/api/address-changes/a%40example.org').send({}),
      await request(app).delete('/api/address-changes/a%40example.org'),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe('the table, over HTTP', () => {
  it('starts empty, shaped as the spec says', async () => {
    as(OURS);
    const res = await request(app).get('/api/address-changes');
    expect(res.status).toBe(200);
    shapedAs('AddressChangeTable', res.body);
    expect(res.body).toEqual({ rows: [], door: 'api', file: null });
  });

  it('adds a proposed row for a person, saying who set it by address; again is 200 and one row', async () => {
    as(OURS);
    const body = { oldAddress: 'Kid.Name@gmail.com', newAddress: 'kid@example.org', personId: KID };
    const first = await request(app).post('/api/address-changes').send(body);
    expect(first.status).toBe(201);
    shapedAs('AddressChange', first.body);
    expect(first.body).toMatchObject({
      oldKey: 'kidname@gmail.com',
      state: 'proposed',
      setBy: 'member-of-01@example.org',
      setByYou: true,
      confirmedBy: null,
      confirmedByYou: false,
      person: { id: KID, displayName: '‹name›' },
    });
    expect(JSON.stringify(first.body)).not.toContain('"member-of-01"');
    const again = await request(app).post('/api/address-changes').send(body);
    expect(again.status).toBe(200);
    expect((await owner(`SELECT count(*)::int AS n FROM address_change`))[0]!.n).toBe(1);
  });

  it('an admin confirms it for the person, attributed; the asker sees it was not them', async () => {
    as(OURS, 'admin-of-01');
    const res = await request(app).put('/api/address-changes/kidname%40gmail.com').send({ state: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'confirmed', confirmedBy: 'admin-of-01@example.org', confirmedByYou: true, setByYou: false });
    as(OURS);
    const read = await request(app).get('/api/address-changes');
    expect(read.body.rows[0]).toMatchObject({ confirmedBy: 'admin-of-01@example.org', confirmedByYou: false });
  });

  it('finds the row by any spelling of its key', async () => {
    as(OURS);
    const res = await request(app).put('/api/address-changes/' + encodeURIComponent('Kid.Name+x@googlemail.com')).send({});
    expect(res.status).toBe(200);
    expect(res.body.oldKey).toBe('kidname@gmail.com');
  });

  it.each([
    [{ oldAddress: 'nobody', newAddress: 'x@example.org' }, 400, 'not_an_address'],
    [{ oldAddress: 'x@example.net', newAddress: 'X@Example.NET' }, 400, 'same_address'],
    [{ oldAddress: 'kidname@gmail.com', newAddress: 'other@example.org' }, 409, 'already_changed'],
    [{ oldAddress: 'dad@example.net', newAddress: 'kid.name@gmail.com' }, 409, 'chained'],
    [{ oldAddress: 'kid@example.org', newAddress: 'later@example.org' }, 409, 'chained'],
    [{ oldAddress: 'x@example.net', newAddress: 'y@example.org', extra: 1 }, 400, 'invalid_request'],
  ])('refuses %j with %i %s, in English and Dutch', async (body, status, error) => {
    as(OURS);
    const res = await request(app).post('/api/address-changes').send(body);
    expect(res.status).toBe(status);
    shapedAs('AddressChangeRefusal', { ...{ field: 0, row: 0, file: 0 }, ...res.body });
    expect(res.body.error).toBe(error);
    expect(typeof res.body.message).toBe('string');
    expect(typeof res.body.messageNl).toBe('string');
    expect(res.body.messageNl).not.toBe(res.body.message);
    if (status === 409) expect(res.body.row).toMatchObject({ oldKey: 'kidname@gmail.com' });
  });

  it("another organisation's person is person_not_found, and nothing is written", async () => {
    as(OURS);
    const res = await request(app)
      .post('/api/address-changes')
      .send({ oldAddress: 'mum@example.net', newAddress: 'mum@example.org', personId: THEIR_PERSON });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('person_not_found');
    expect((await owner(`SELECT count(*)::int AS n FROM address_change WHERE old_key = 'mum@example.net'`))[0]!.n).toBe(0);
  });

  it('another organisation never sees, changes or deletes the row', async () => {
    as(THEIRS);
    expect((await request(app).get('/api/address-changes')).body.rows).toEqual([]);
    const put = await request(app).put('/api/address-changes/kidname%40gmail.com').send({ state: 'proposed' });
    expect(put.status).toBe(404);
    expect(put.body.error).toBe('address_change_not_found');
    expect((await request(app).delete('/api/address-changes/kidname%40gmail.com')).status).toBe(404);
    const [row] = await owner(`SELECT state FROM address_change WHERE tenant_id = $1`, [OURS]);
    expect(row!.state).toBe('confirmed');
  });

  it('Not right? sends it back; unlinking leaves the row', async () => {
    as(OURS);
    const res = await request(app)
      .put('/api/address-changes/kidname%40gmail.com')
      .send({ state: 'proposed', personId: null });
    expect(res.body).toMatchObject({ state: 'proposed', confirmedBy: null, confirmedAt: null, person: null });
  });

  it('deletes the row, answering it as it was; a second delete is 404', async () => {
    as(OURS);
    await request(app).put('/api/address-changes/kidname%40gmail.com').send({ personId: KID });
    const gone = await request(app).delete('/api/address-changes/kidname%40gmail.com');
    expect(gone.status).toBe(200);
    expect(gone.body.person).toEqual({ id: KID, displayName: '‹name›' });
    expect((await owner(`SELECT count(*)::int AS n FROM address_change_person`))[0]!.n).toBe(0);
    expect((await request(app).delete('/api/address-changes/kidname%40gmail.com')).status).toBe(404);
  });
});

/** The refusal of a request, checked as every refusal here is: its shape, and both its languages. */
function refusedAs(res: request.Response, status: number, error: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  shapedAs('AddressChangeRefusal', { ...{ field: 0, row: 0, file: 0 }, ...res.body });
  expect(res.body.error).toBe(error);
  expect(res.body.message.length).toBeGreaterThan(20);
  expect(res.body.messageNl.length).toBeGreaterThan(20);
  expect(res.body.messageNl).not.toBe(res.body.message);
}

const rowsOf = async (tenantId: string) =>
  owner(`SELECT old_key, new_address, state, confirmed_by FROM address_change WHERE tenant_id = $1 ORDER BY old_key`, [tenantId]);

// 0168 §4.4 and D6: an owner or an admin proposes, changes, deletes and
// confirms for anyone; a person confirms or sends back their own row. The API
// checked membership only, so a legacy viewer could confirm any row and choose
// where a share invitation went.
describe('who may write (0168 §4.4; the review, finding 1)', () => {
  const KID_MEMBER = 'kid-of-01';
  const VIEWER = 'viewer-of-01';

  beforeAll(async () => {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
       VALUES ($1, $2, 'kid-of-01@example.org', 'member', 'active'), ($1, $3, 'viewer-of-01@example.org', 'viewer', 'active')`,
      [OURS, KID_MEMBER, VIEWER],
    );
    // The kid is a member, and ‹name› is their own person (managed 0061).
    await owner(`UPDATE person SET user_id = $1 WHERE id = $2`, [KID_MEMBER, KID]);
    await owner(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, '‹mum›')`, [MUM, OURS]);
    as(OURS, 'admin-of-01');
    for (const body of [
      { oldAddress: 'kid.name@gmail.com', newAddress: 'kid@example.org', personId: KID },
      { oldAddress: 'mum@hotmail.example', newAddress: 'mum@example.org', personId: MUM },
      { oldAddress: 'grandpa@hotmail.example', newAddress: 'grandpa@example.org' },
    ]) {
      expect((await request(app).post('/api/address-changes').send(body)).status).toBe(201);
    }
  });

  it.each(['member', 'viewer'])('a %s may not add, change or delete a row: 403, in both languages, nothing written', async (role) => {
    as(OURS, role === 'member' ? KID_MEMBER : VIEWER, role);
    const before = await rowsOf(OURS);
    refusedAs(
      await request(app).post('/api/address-changes').send({ oldAddress: 'grandpa@hotmail.example', newAddress: 'x@example.org', confirm: true }),
      403,
      'owner_or_admin_only',
    );
    refusedAs(
      await request(app).post('/api/address-changes').send({ oldAddress: 'new@example.net', newAddress: 'new@example.org' }),
      403,
      'owner_or_admin_only',
    );
    // Not even on their own row: a new address, a person, or a state with either.
    for (const body of [{ newAddress: 'elsewhere@example.org' }, { personId: null }, { state: 'confirmed', newAddress: 'x@example.org' }, {}]) {
      refusedAs(await request(app).put('/api/address-changes/kidname%40gmail.com').send(body), 403, 'owner_or_admin_only');
    }
    refusedAs(await request(app).delete('/api/address-changes/kidname%40gmail.com'), 403, 'owner_or_admin_only');
    refusedAs(await request(app).delete('/api/address-changes/grandpa%40hotmail.example'), 403, 'owner_or_admin_only');
    expect(await rowsOf(OURS)).toEqual(before);
  });

  it("reads only the rows that are their own person's; an owner or an admin reads them all", async () => {
    as(OURS, KID_MEMBER, 'member');
    const kid = await request(app).get('/api/address-changes');
    expect(kid.status).toBe(200);
    expect(kid.body.rows.map((r: { oldKey: string }) => r.oldKey)).toEqual(['kidname@gmail.com']);
    as(OURS, VIEWER, 'viewer');
    expect((await request(app).get('/api/address-changes')).body).toEqual({ rows: [], door: 'api', file: null });
    for (const role of ['owner', 'admin']) {
      as(OURS, 'admin-of-01', role);
      expect((await request(app).get('/api/address-changes')).body.rows).toHaveLength(3);
    }
  });

  it('a member confirms their own row, attributed to them, and sends it back', async () => {
    as(OURS, KID_MEMBER, 'member');
    const yes = await request(app).put('/api/address-changes/kidname%40gmail.com').send({ state: 'confirmed' });
    expect(yes.status).toBe(200);
    expect(yes.body).toMatchObject({ state: 'confirmed', confirmedBy: 'kid-of-01@example.org', confirmedByYou: true });
    const back = await request(app).put('/api/address-changes/' + encodeURIComponent('Kid.Name@gmail.com')).send({ state: 'proposed' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ state: 'proposed', confirmedBy: null });
  });

  it("may not confirm someone else's row, nor one nobody is linked to, nor one that is not there: one 403 for all", async () => {
    as(OURS, KID_MEMBER, 'member');
    const before = await rowsOf(OURS);
    const answers = [];
    for (const key of ['mum%40hotmail.example', 'grandpa%40hotmail.example', 'nobody%40example.net', 'not-an-address']) {
      const res = await request(app).put(`/api/address-changes/${key}`).send({ state: 'confirmed' });
      refusedAs(res, 403, 'not_your_address_change');
      answers.push(res.body);
    }
    // The same words whether or not the row exists: a member learns nothing of rows they cannot read.
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(await rowsOf(OURS)).toEqual(before);
  });

  it('an owner confirms for someone else, attributed to them, and deletes', async () => {
    as(OURS, 'admin-of-01', 'owner');
    const res = await request(app).put('/api/address-changes/mum%40hotmail.example').send({ state: 'confirmed' });
    expect(res.body).toMatchObject({ state: 'confirmed', confirmedBy: 'admin-of-01@example.org', person: { id: MUM } });
    expect((await request(app).delete('/api/address-changes/grandpa%40hotmail.example')).status).toBe(200);
  });
});

// 0168 §5: "The audit log records who confirmed which row by reference." No
// route wrote one, so once Kid pressed *Not right?* nothing said who had
// confirmed the change that rewrote the family's cards.
describe('every write is recorded, by reference, never by address (the review, finding 4)', () => {
  type Audit = { actor: string; action: string; entity: string; detail: Record<string, unknown> };
  const audits = async (): Promise<Audit[]> =>
    (await owner(
      `SELECT actor, action, entity, detail FROM audit_log WHERE tenant_id = $1 AND entity = 'address_change' ORDER BY at, id`,
      [OURS],
    )) as Audit[];

  beforeAll(async () => {
    await owner(`DELETE FROM audit_log WHERE tenant_id = $1`, [OURS]);
  });

  it('records each write once, saying who, which row, and the state it went from and to', async () => {
    const key = 'kidname@gmail.com';
    as(OURS, 'admin-of-01');
    await request(app).delete(`/api/address-changes/${encodeURIComponent(key)}`);
    await owner(`DELETE FROM audit_log WHERE tenant_id = $1`, [OURS]);

    await request(app).post('/api/address-changes').send({ oldAddress: 'Kid.Name@gmail.com', newAddress: 'kid@example.org', personId: KID });
    await request(app).post('/api/address-changes').send({ oldAddress: 'kid.name@gmail.com', newAddress: 'kid@example.org' });
    await request(app).put(`/api/address-changes/${encodeURIComponent(key)}`).send({ state: 'confirmed' });
    await request(app).put(`/api/address-changes/${encodeURIComponent(key)}`).send({ state: 'confirmed' });
    as(OURS, 'kid-of-01', 'member');
    await request(app).put(`/api/address-changes/${encodeURIComponent(key)}`).send({ state: 'proposed' });
    as(OURS, 'admin-of-01');
    await request(app).put(`/api/address-changes/${encodeURIComponent(key)}`).send({ newAddress: 'kid.new@example.org' });
    await request(app).put(`/api/address-changes/${encodeURIComponent(key)}`).send({ personId: null });
    await request(app).delete(`/api/address-changes/${encodeURIComponent(key)}`);

    const recorded = await audits();
    expect(recorded.map((a) => [a.actor, a.action, a.detail.from, a.detail.to, a.detail.via, a.detail.personId])).toEqual([
      ['admin-of-01', 'address_change.added', null, 'proposed', 'api', KID],
      // The same POST again, and the same confirmation again, are not events.
      ['admin-of-01', 'address_change.confirmed', 'proposed', 'confirmed', 'api', KID],
      ['kid-of-01', 'address_change.sent_back', 'confirmed', 'proposed', 'api', KID],
      ['admin-of-01', 'address_change.readdressed', 'proposed', 'proposed', 'api', KID],
      ['admin-of-01', 'address_change.linked', 'proposed', 'proposed', 'api', null],
      ['admin-of-01', 'address_change.deleted', 'proposed', null, 'api', null],
    ]);
    for (const a of recorded) expect(a.entity).toBe('address_change');

    // The row by reference: the audit export's own pseudonym of its key,
    // under this deployment's key, the same in every record of it.
    const pseudonym = pseudonymizer(await deploymentKeyFor(driver, AUDIT_PSEUDONYM_PURPOSE));
    expect(new Set(recorded.map((a) => a.detail.addressChange))).toEqual(new Set([pseudonym(key)]));
    expect(String(recorded[0]!.detail.addressChange)).toMatch(/^pseudo:[0-9a-f]{16}$/);

    // Never an address, anywhere in a record; and every field it carries is one the export keeps.
    for (const a of recorded) {
      const text = JSON.stringify(a);
      for (const value of ['@', 'kid.name', 'kidname', 'kid@example.org', 'kid.new']) expect(text).not.toContain(value);
      for (const field of Object.keys(a.detail)) expect(AUDIT_DETAIL_FIELDS).toHaveProperty(field);
    }
  });

  it('records nothing for a refusal', async () => {
    await owner(`DELETE FROM audit_log WHERE tenant_id = $1`, [OURS]);
    as(OURS, 'admin-of-01');
    await request(app).post('/api/address-changes').send({ oldAddress: 'nobody', newAddress: 'x@example.org' });
    await request(app).delete('/api/address-changes/nobody%40example.net');
    as(OURS, 'kid-of-01', 'member');
    await request(app).put('/api/address-changes/mum%40hotmail.example').send({ state: 'proposed' });
    expect(await audits()).toEqual([]);
  });
});

// Values the old check let through, which then failed the write with a 500
// whose log line carried both addresses (the review, finding 3).
describe('a value no row can hold is not an address, never a 500 (the review, finding 3)', () => {
  it.each([
    ['a NUL', 'mum\u0000@hotmail.example'],
    // 254 characters as typed, 255 once lower-cased: `İ` is two then.
    ['a key longer than the table holds', `İ${'a'.repeat(241)}@example.org`],
  ])('refuses an old address with %s as not_an_address, in both languages', async (_what, oldAddress) => {
    as(OURS, 'admin-of-01');
    const res = await request(app).post('/api/address-changes').send({ oldAddress, newAddress: 'fresh@example.org', confirm: true });
    refusedAs(res, 400, 'not_an_address');
    expect(res.body.field).toBe('oldAddress');
    expect((await owner(`SELECT count(*)::int AS n FROM address_change WHERE new_address = 'fresh@example.org'`))[0]!.n).toBe(0);
  });

  it('answers a path that names no address as no row, without asking the database', async () => {
    as(OURS, 'admin-of-01');
    refusedAs(await request(app).put('/api/address-changes/a%00b').send({ state: 'confirmed' }), 404, 'address_change_not_found');
    refusedAs(await request(app).delete('/api/address-changes/a%00b'), 404, 'address_change_not_found');
  });
});

describe(`a table holds at most ${ADDRESS_CHANGE_ROWS_MAX} rows (the review, finding 11)`, () => {
  it('refuses one more, in both languages, and still takes a change to a row', async () => {
    await owner(
      `INSERT INTO address_change (tenant_id, old_key, old_address, new_address, set_by)
       SELECT $1, 'old' || n || '@example.net', 'old' || n || '@example.net', 'new' || n || '@example.org', 'admin-of-01'
         FROM generate_series(1, $2::int) AS n`,
      [THEIRS, ADDRESS_CHANGE_ROWS_MAX],
    );
    try {
      as(THEIRS);
      refusedAs(
        await request(app).post('/api/address-changes').send({ oldAddress: 'one-more@example.net', newAddress: 'one-more@example.org' }),
        409,
        'too_many_address_changes',
      );
      expect((await request(app).put('/api/address-changes/old7%40example.net').send({ newAddress: 'other@example.org' })).status).toBe(200);
      expect((await owner(`SELECT count(*)::int AS n FROM address_change WHERE tenant_id = $1`, [THEIRS]))[0]!.n).toBe(ADDRESS_CHANGE_ROWS_MAX);
    } finally {
      await owner(`DELETE FROM address_change WHERE tenant_id = $1`, [THEIRS]);
    }
  });
});

// N7 of the review of the screens: the Dutch half carried zod's English, and
// person_not_found was English only, in a shape the spec did not give it.
describe('every answer is in both languages (N7; the review, finding 9)', () => {
  const ENGLISH = /\b(?:Invalid|expected|received|Unrecognized|Too big|is a string|true or false|proposed or confirmed|not a person id)\b/;

  it.each([
    ['a POST with an address that is not a string', 'POST', { oldAddress: 5, newAddress: 'x@example.org' }, 'oldAddress is tekst.'],
    ['a POST with a field it does not take', 'POST', { oldAddress: 'a@example.net', newAddress: 'b@example.org', extra: 1 }, 'De inhoud heeft een veld dat hier niet past: extra.'],
    ['an empty POST', 'POST', {}, 'Een adreswijziging heeft oldAddress en newAddress nodig.'],
    ['a POST with an address too long', 'POST', { oldAddress: `${'a'.repeat(400)}@example.net`, newAddress: 'b@example.org' }, 'oldAddress is langer dan een adres kan zijn.'],
    ['a POST whose confirm is not true or false', 'POST', { oldAddress: 'a@example.net', newAddress: 'b@example.org', confirm: 'yes' }, 'confirm is true of false.'],
    ['a POST whose personId is no id', 'POST', { oldAddress: 'a@example.net', newAddress: 'b@example.org', personId: 'kid' }, 'personId is het id van een persoon, of null.'],
    ['a PUT with a state there is not', 'PUT', { state: 'maybe' }, 'state is proposed of confirmed.'],
  ])('%s is said in Dutch without the English', async (_what, method, body, dutch) => {
    as(OURS, 'admin-of-01');
    const res =
      method === 'POST'
        ? await request(app).post('/api/address-changes').send(body)
        : await request(app).put('/api/address-changes/mum%40hotmail.example').send(body);
    refusedAs(res, 400, 'invalid_request');
    expect(res.body.messageNl).toBe(`Dit verzoek is niet te lezen. ${dutch}`);
    expect(res.body.messageNl).not.toMatch(ENGLISH);
  });

  it('says a body that is not an object in both languages', async () => {
    as(OURS, 'admin-of-01');
    const res = await request(app).post('/api/address-changes').set('content-type', 'application/json').send('["x"]');
    refusedAs(res, 400, 'invalid_request');
    expect(res.body.messageNl).toBe('Dit verzoek is niet te lezen. De inhoud moet een JSON-object zijn.');
  });

  it("answers the apply press of a migration this organisation does not have in both languages", async () => {
    as(OURS, 'admin-of-01');
    for (const id of [`${P}99`, 'not-a-migration']) {
      const res = await request(app).post(`/api/migrations/${id}/address-changes/apply`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: 'Not found',
        message: 'There is no such migration here.',
        messageNl: 'Deze migratie bestaat hier niet.',
      });
    }
  });

  it("says another organisation's person in both languages, shaped as every refusal here", async () => {
    as(OURS, 'admin-of-01');
    refusedAs(
      await request(app).post('/api/address-changes').send({ oldAddress: 'x@example.net', newAddress: 'x@example.org', personId: THEIR_PERSON }),
      404,
      'person_not_found',
    );
    refusedAs(
      await request(app).put('/api/address-changes/mum%40hotmail.example').send({ personId: THEIR_PERSON }),
      404,
      'person_not_found',
    );
  });
});
