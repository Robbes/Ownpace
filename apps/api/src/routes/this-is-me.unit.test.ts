// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THIS IS ME (ADR-0050, amended 2026-11-19; workplan 0153 T4): the people
 * routes' half of the person you are, over PGlite with both chains, signed in
 * by a stand-in for `authenticate`, as `people.unit.test.ts` is.
 *
 *  - `GET /api/people` says `you` to the member whose person it is, and sends
 *    no account id;
 *  - `POST /api/people` with `myself` links the subject the sign-in names,
 *    whatever account the body names;
 *  - `PUT` and `DELETE /api/people/{personId}/myself` link and unlink only the
 *    asker's own account, and leave another member's link alone;
 *  - an organisation never reaches another's people, and somebody who is no
 *    member here is refused before anything is written.
 *
 * The people and subjects are invented.
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

// UUID family 0153a2e0-…, unused elsewhere in the repo.
const P = '0153a2e0-e29b-41d4-a716-4466554431';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
/** A well-formed id that names nobody. */
const NOBODY = `${P}99`;

/** Sign-in subjects. */
const ANNA = 'subject-anna';
const BRAM = 'subject-bram';
const DIRK = 'subject-dirk';

let driver: LedgerDriver;
/** Set per test: the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    // The only stub, as in `people.unit.test.ts`: a caller with a tenant and a subject.
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: peopleRoutes } = await import('./people.ts');

const app = express();
app.use(express.json());
app.use('/api/people', peopleRoutes);

/** Signed in to an organisation as a subject; a viewer, the narrowest role, unless told. */
const as = (tenantId: string, userId: string, userRole = 'viewer') => {
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

/** Whose account a person row holds, read past row security. */
const linkOf = async (personId: string): Promise<unknown> =>
  (await owner(`SELECT user_id FROM person WHERE id = $1`, [personId]))[0]?.user_id;

type Schema = { properties?: Record<string, unknown>; required?: string[] };
const SPEC = parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};

/** The body carries exactly the properties the spec's schema names, and every required one. */
function shapedAs(name: string, body: Record<string, unknown>): void {
  const schema = SPEC.components.schemas[name];
  expect(schema, `openapi.yaml has no schema ${name}`).toBeDefined();
  expect(Object.keys(body).sort(), name).toEqual(Object.keys(schema!.properties ?? {}).sort());
  for (const key of schema!.required ?? []) expect(body, `${name}.${key}`).toHaveProperty(key);
}

/** A person nobody is, made through the door. */
async function somebody(tenantId: string, displayName: string): Promise<string> {
  as(tenantId, tenantId === OURS ? BRAM : DIRK);
  const res = await request(app).post('/api/people').send({ displayName });
  expect(res.status).toBe(201);
  return res.body.id as string;
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
  for (const [tenant, subject] of [
    [OURS, ANNA],
    [OURS, BRAM],
    [THEIRS, DIRK],
  ]) {
    await owner(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, $3, 'viewer', 'active')`,
      [tenant, subject, `${subject}@example.com`],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('signed out', () => {
  it('answers 401 at both new doors', async () => {
    caller = {};
    for (const res of [
      await request(app).put(`/api/people/${NOBODY}/myself`),
      await request(app).delete(`/api/people/${NOBODY}/myself`),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe('POST /api/people with myself', () => {
  it('links the subject the sign-in names, never an account the body names', async () => {
    as(OURS, ANNA);
    const res = await request(app)
      .post('/api/people')
      .send({ displayName: 'Anna de Vries', myself: true, userId: BRAM, user_id: BRAM, subject: BRAM });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ displayName: 'Anna de Vries', you: true });
    shapedAs('Person', res.body);
    expect(await linkOf(res.body.id)).toBe(ANNA);
  });

  it('links nobody without it, and nobody from an account in the body alone', async () => {
    as(OURS, ANNA);
    const res = await request(app).post('/api/people').send({ displayName: 'Bram Bakker', userId: ANNA });

    expect(res.status).toBe(201);
    expect(res.body.you).toBe(false);
    expect(await linkOf(res.body.id)).toBeNull();
  });

  it('moves the member’s link off their other person', async () => {
    as(OURS, ANNA);
    const first = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;

    const res = await request(app).post('/api/people').send({ displayName: 'Anna (work)', myself: true });

    expect(res.status).toBe(201);
    expect(await linkOf(res.body.id)).toBe(ANNA);
    expect(await linkOf(first)).toBeNull();
  });

  it('refuses a myself that is not true or false: 400, and stores nothing', async () => {
    as(OURS, ANNA);
    const before = await owner(`SELECT count(*)::int AS n FROM person`);

    const res = await request(app).post('/api/people').send({ displayName: 'Carla', myself: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(await owner(`SELECT count(*)::int AS n FROM person`)).toEqual(before);
  });

  it('refuses somebody who is no member here: 403 not_a_member, and stores nothing', async () => {
    as(OURS, DIRK);
    const before = await owner(`SELECT count(*)::int AS n FROM person`);

    const res = await request(app).post('/api/people').send({ displayName: 'Dirk', myself: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
    expect(res.body.message).toMatch(/Only a member of this organisation/);
    expect(await owner(`SELECT count(*)::int AS n FROM person`)).toEqual(before);
  });
});

describe('GET /api/people', () => {
  it('says you to the member whose person it is, and to nobody else', async () => {
    as(OURS, ANNA);
    const annas = await request(app).get('/api/people');
    as(OURS, BRAM);
    const brams = await request(app).get('/api/people');

    expect(annas.status).toBe(200);
    const yours = (body: { people: Array<{ displayName: string; you: boolean }> }) =>
      body.people.filter((p) => p.you).map((p) => p.displayName);
    expect(yours(annas.body)).toEqual(['Anna (work)']);
    expect(yours(brams.body)).toEqual([]);
    for (const p of annas.body.people) shapedAs('Person', p);
  });

  it('sends no member’s account id', async () => {
    as(OURS, ANNA);
    const res = await request(app).get('/api/people');

    for (const subject of [ANNA, BRAM, DIRK]) expect(res.text).not.toContain(subject);
  });
});

describe('PUT /api/people/{personId}/myself', () => {
  it('says the person is the asker: 200, you, and their other person is no longer theirs', async () => {
    const another = await somebody(OURS, 'Anna J.');
    const before = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;

    as(OURS, ANNA);
    const res = await request(app).put(`/api/people/${another}/myself`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: another, you: true });
    shapedAs('Person', res.body);
    expect(await linkOf(another)).toBe(ANNA);
    expect(await linkOf(before)).toBeNull();
  });

  it('changes nothing the second time: 200, still theirs', async () => {
    const annas = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;
    as(OURS, ANNA);

    const res = await request(app).put(`/api/people/${annas}/myself`);

    expect(res.status).toBe(200);
    expect(res.body.you).toBe(true);
    expect(await linkOf(annas)).toBe(ANNA);
  });

  it('leaves another member’s person theirs: 409 another_members', async () => {
    const annas = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;
    as(OURS, BRAM);

    const res = await request(app).put(`/api/people/${annas}/myself`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('another_members');
    expect(res.body.message).toMatch(/another member’s own/);
    expect(await linkOf(annas)).toBe(ANNA);
  });

  it('refuses somebody who is no member here: 403, and links nothing', async () => {
    const carla = await somebody(OURS, 'Carla');
    as(OURS, 'subject-stranger');

    const res = await request(app).put(`/api/people/${carla}/myself`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
    expect(await linkOf(carla)).toBeNull();
  });

  it('answers 404 for an id that names nobody, and for one that is not an id', async () => {
    as(OURS, ANNA);
    for (const id of [NOBODY, 'not-an-id']) {
      const res = await request(app).put(`/api/people/${id}/myself`);
      expect(res.status, id).toBe(404);
      expect(res.body.error, id).toBe('person_not_found');
    }
  });
});

describe('DELETE /api/people/{personId}/myself', () => {
  it('leaves another member’s link alone: 200, not you, and still theirs', async () => {
    const annas = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;
    as(OURS, BRAM);

    const res = await request(app).delete(`/api/people/${annas}/myself`);

    expect(res.status).toBe(200);
    expect(res.body.you).toBe(false);
    expect(await linkOf(annas)).toBe(ANNA);
  });

  it('undoes the asker’s own: 200, not you, and nobody’s again, twice over', async () => {
    const annas = (await owner(`SELECT id FROM person WHERE user_id = $1`, [ANNA]))[0]!.id as string;
    as(OURS, ANNA);

    for (const time of ['first', 'second']) {
      const res = await request(app).delete(`/api/people/${annas}/myself`);
      expect(res.status, time).toBe(200);
      expect(res.body.you, time).toBe(false);
      shapedAs('Person', res.body);
    }
    expect(await linkOf(annas)).toBeNull();
  });

  it('answers 404 for an id that names nobody', async () => {
    as(OURS, ANNA);
    const res = await request(app).delete(`/api/people/${NOBODY}/myself`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('person_not_found');
  });
});

describe('one organisation’s people, and nobody else’s', () => {
  let dirks = '';

  beforeAll(async () => {
    as(THEIRS, DIRK);
    const res = await request(app).post('/api/people').send({ displayName: 'Dirk', myself: true });
    expect(res.status).toBe(201);
    dirks = res.body.id as string;
  });

  it('cannot say another organisation’s person is them: 404, and the link stays', async () => {
    as(OURS, ANNA);
    const marked = await request(app).put(`/api/people/${dirks}/myself`);
    const unmarked = await request(app).delete(`/api/people/${dirks}/myself`);

    expect(marked.status).toBe(404);
    expect(unmarked.status).toBe(404);
    expect(await linkOf(dirks)).toBe(DIRK);
  });

  it('never lists another organisation’s people, as anybody’s or as yours', async () => {
    as(OURS, DIRK);
    const res = await request(app).get('/api/people');

    expect(res.body.people.map((p: { displayName: string }) => p.displayName)).not.toContain('Dirk');
    expect(res.body.people.some((p: { you: boolean }) => p.you)).toBe(false);
  });
});
