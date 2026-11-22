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
 *    `person_not_found`.
 *
 * UUID family 0168a2e0-…, unused elsewhere in the repo. Addresses invented.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { parse } from 'yaml';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const P = '0168a2e0-e29b-41d4-a716-4466554431';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const KID = `${P}11`;
const THEIR_PERSON = `${P}12`;

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

const app = express();
app.use(express.json());
app.use('/api/address-changes', routes);

const as = (tenantId: string, userId = `member-of-${tenantId.slice(-2)}`) => {
  caller = { tenantId, userId, userRole: 'member' };
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
