// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PEOPLE ROUTES (ADR-0050, amended by the owner on 2026-09-28; workplan
 * 0153 T2): `routes/people.ts` over PGlite with both chains, signed in by a
 * stand-in for `authenticate`, as `link-routes.unit.test.ts` is.
 *
 *  - the four doors answer what the spec says, in the shapes it names;
 *  - adding a migration twice changes nothing, and one that is somebody
 *    else's stays theirs;
 *  - deleting a person deletes no migration;
 *  - an organisation reaches its own people and migrations only, and an id
 *    that is not one answers 404 rather than a cast error.
 *
 * The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { parse } from 'yaml';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 0153a2c0-…, unused elsewhere in the repo.
const P = '0153a2c0-e29b-41d4-a716-4466554431';
const OURS = `${P}01`;
const THEIRS = `${P}02`;
const OUR_CONN = `${P}11`;
const OUR_BOX = `${P}12`;
const THEIR_CONN = `${P}13`;
const THEIR_BOX = `${P}14`;
const MAIL = `${P}21`;
const FILES = `${P}22`;
const THEIR_MAIL = `${P}31`;
/** A well-formed id that names nobody. */
const NOBODY = `${P}99`;

let driver: LedgerDriver;
/** Set per test: the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    // The only stub. Verifying a JWT is `auth.unit.test.ts`'s job; what this
    // file needs is a caller with a tenant.
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

const as = (tenantId: string) => {
  caller = { tenantId, userId: `member-of-${tenantId.slice(-2)}`, userRole: 'member' };
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

/** The body carries exactly the properties the spec's schema names, and every required one. */
function shapedAs(name: string, body: Record<string, unknown>): void {
  const schema = SPEC.components.schemas[name];
  expect(schema, `openapi.yaml has no schema ${name}`).toBeDefined();
  expect(Object.keys(body).sort(), name).toEqual(Object.keys(schema!.properties ?? {}).sort());
  for (const key of schema!.required ?? []) expect(body, `${name}.${key}`).toHaveProperty(key);
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
  for (const [i, [id, tenant, box, status]] of [
    [MAIL, OURS, OUR_BOX, 'active'],
    [FILES, OURS, OUR_BOX, 'paused'],
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

describe('signed out', () => {
  it('answers 401 at every door', async () => {
    caller = {};
    for (const res of [
      await request(app).get('/api/people'),
      await request(app).post('/api/people').send({ displayName: 'Anna' }),
      await request(app).post(`/api/people/${NOBODY}/migrations`).send({ mappingId: MAIL }),
      await request(app).delete(`/api/people/${NOBODY}`),
    ]) {
      expect(res.status).toBe(401);
    }
  });
});

describe('GET /api/people', () => {
  it('lists nobody, and every migration as nobody’s, in the spec’s shape', async () => {
    as(OURS);
    const res = await request(app).get('/api/people');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      people: [],
      unassigned: [
        { id: MAIL, status: 'active' },
        { id: FILES, status: 'paused' },
      ],
    });
    shapedAs('PeopleResponse', res.body);
    shapedAs('PersonMigration', res.body.unassigned[0]);
  });
});

describe('POST /api/people', () => {
  it('creates a person, trimmed, with an empty address as none', async () => {
    as(OURS);
    const res = await request(app).post('/api/people').send({ displayName: '  Anna de Vries ', email: '' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ implicit: false, displayName: 'Anna de Vries', email: null, migrations: [] });
    shapedAs('Person', res.body);
    shapedAs('LifecycleCounts', res.body.counts);
  });

  it('reads an address of spaces, or none sent, as no address', async () => {
    as(OURS);
    for (const body of [
      { displayName: 'Spaces', email: '   ' },
      { displayName: 'Nothing sent' },
      { displayName: 'Null', email: null },
    ]) {
      const res = await request(app).post('/api/people').send(body);
      expect(res.status, body.displayName).toBe(201);
      expect(res.body.email, body.displayName).toBeNull();
      await owner(`DELETE FROM person WHERE id = $1`, [res.body.id]);
    }
  });

  it('keeps an address that is one', async () => {
    as(OURS);
    const res = await request(app).post('/api/people').send({ displayName: 'Bram', email: 'bram@example.org' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('bram@example.org');
  });

  it.each([
    ['no name', {}, /needs a name/],
    ['a name of spaces', { displayName: '   ' }, /needs a name/],
    ['a page of text', { displayName: 'x'.repeat(201) }, /at most 200/],
    ['an address that is not one', { displayName: 'Carla', email: 'carla' }, /not an email address/],
  ])('refuses %s with a sentence, and stores nothing', async (_what, body, said) => {
    as(OURS);
    const before = await owner(`SELECT count(*)::int AS n FROM person`);
    const res = await request(app).post('/api/people').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.message).toMatch(said);
    expect(await owner(`SELECT count(*)::int AS n FROM person`)).toEqual(before);
  });
});

describe('POST /api/people/{personId}/migrations', () => {
  let anna = '';
  let bram = '';

  beforeAll(async () => {
    as(OURS);
    const listed = await request(app).get('/api/people');
    anna = listed.body.people.find((p: { displayName: string }) => p.displayName === 'Anna de Vries').id;
    bram = listed.body.people.find((p: { displayName: string }) => p.displayName === 'Bram').id;
  });

  it('adds a migration: 201, with the person and their states counted', async () => {
    as(OURS);
    const res = await request(app).post(`/api/people/${anna}/migrations`).send({ mappingId: MAIL });

    expect(res.status).toBe(201);
    expect(res.body.migrations).toEqual([{ id: MAIL, status: 'active' }]);
    expect(res.body.counts).toMatchObject({ active: 1, paused: 0 });
    shapedAs('Person', res.body);
  });

  it('adds it again as nothing new: 200, one row', async () => {
    as(OURS);
    const res = await request(app).post(`/api/people/${anna}/migrations`).send({ mappingId: MAIL });

    expect(res.status).toBe(200);
    expect(res.body.migrations).toEqual([{ id: MAIL, status: 'active' }]);
    expect(await owner(`SELECT count(*)::int AS n FROM person_migration WHERE mapping_id = $1`, [MAIL])).toEqual([
      { n: 1 },
    ]);
  });

  it('keeps somebody else’s migration theirs: 409, naming whose', async () => {
    as(OURS);
    const res = await request(app).post(`/api/people/${bram}/migrations`).send({ mappingId: MAIL });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'with_another_person', personId: anna });
    expect(res.body.message).toMatch(/one person at most/);
  });

  it('finds no migration of another organisation: 404, and writes nothing', async () => {
    as(OURS);
    const res = await request(app).post(`/api/people/${bram}/migrations`).send({ mappingId: THEIR_MAIL });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('migration_not_found');
    expect(await owner(`SELECT 1 FROM person_migration WHERE mapping_id = $1`, [THEIR_MAIL])).toEqual([]);
  });

  it('finds no person of another organisation: 404', async () => {
    as(THEIRS);
    const res = await request(app).post(`/api/people/${bram}/migrations`).send({ mappingId: THEIR_MAIL });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('person_not_found');
  });

  it('answers 404 for an id that names nobody, and for one that is not an id', async () => {
    as(OURS);
    for (const id of [NOBODY, 'not-an-id']) {
      const res = await request(app).post(`/api/people/${id}/migrations`).send({ mappingId: FILES });
      expect(res.status, id).toBe(404);
      expect(res.body.error, id).toBe('person_not_found');
    }
  });

  it('refuses a body with no migration id in it: 400', async () => {
    as(OURS);
    for (const body of [{}, { mappingId: 'mail' }]) {
      const res = await request(app).post(`/api/people/${bram}/migrations`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('Validation error');
    }
  });

  it('lists each person with theirs, and the rest as nobody’s', async () => {
    as(OURS);
    const res = await request(app).get('/api/people');

    expect(res.body.people.map((p: { displayName: string; migrations: Array<{ id: string }> }) => [
      p.displayName,
      p.migrations.map((m) => m.id),
    ])).toEqual([
      ['Anna de Vries', [MAIL]],
      ['Bram', []],
    ]);
    expect(res.body.unassigned).toEqual([{ id: FILES, status: 'paused' }]);
  });
});

describe('DELETE /api/people/{personId}', () => {
  it('is not reached from another organisation: 404, and the person stays', async () => {
    as(OURS);
    const anna = (await request(app).get('/api/people')).body.people[0].id;

    as(THEIRS);
    const res = await request(app).delete(`/api/people/${anna}`);

    expect(res.status).toBe(404);
    as(OURS);
    expect((await request(app).get('/api/people')).body.people[0].id).toBe(anna);
  });

  it('deletes the person and no migration: theirs belong to nobody again', async () => {
    as(OURS);
    const anna = (await request(app).get('/api/people')).body.people[0].id;
    const res = await request(app).delete(`/api/people/${anna}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, unassigned: [MAIL] });
    shapedAs('PersonDeleted', res.body);
    expect(await owner(`SELECT status FROM mailbox_mapping WHERE id = $1`, [MAIL])).toEqual([{ status: 'active' }]);
    const after = await request(app).get('/api/people');
    expect(after.body.unassigned.map((m: { id: string }) => m.id)).toEqual([MAIL, FILES]);
  });

  it('answers 404 the second time, and for an id that is not one', async () => {
    as(OURS);
    for (const id of [NOBODY, 'not-an-id']) {
      const res = await request(app).delete(`/api/people/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.body.error, id).toBe('person_not_found');
    }
  });
});
