// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR THAT IGNORED THE ORGANISATION IN ITS OWN PATH (workplan 0178 T10's
 * reading, the maintainer's answer of 2026-11-26).
 *
 * `PUT /api/tenants/{tenantId}` acted on the caller's organisation, the one
 * `authenticate` resolved, whatever its path named, and so did the members'
 * doors under it. Nothing leaked, since each read and wrote the caller's own
 * rows, but a door that ignores its own path is wrong: a person who is a
 * member of two organisations, signed in to the first, who renames the
 * second by its address, renamed the first. And `GET
 * /api/migrations/{mappingId}/runs` answered another organisation's
 * migration with an empty list, where every other door of a migration
 * answers 404.
 *
 * So this holds, on a real database, under row security:
 *  1. A door that names an organisation in its path refuses one that is not
 *     the caller's (403, `requireTenantMatch`'s answer), and writes nothing:
 *     the member of two, signed in to the first, renames neither by naming
 *     the second, and reads neither's members either.
 *  2. The same doors with the caller's own organisation answer as before.
 *  3. `/runs` of a migration that is not the caller's answers 404, as the
 *     migration's own door does; the caller's own still answers its list.
 */

process.env.JWT_SECRET = 'test-secret-for-a-door-that-names-its-own';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  // The API refuses to make its producer without a jobs URL (__testing__/a-queue-stand-in.ts).
  process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
});
vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) => {
  const { aQueueStandIn, aRunId } = await import('../__testing__/a-queue-stand-in.ts');
  return aQueueStandIn(await importOriginal(), () => aRunId(1));
});

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** app_user, so the routes read under row security as they do in production. */
const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../index.ts')).default;
const { seedMembership } = await import('../__tests__/seed-membership.ts');

const P = '7c178000-e29b-41d4-a716-4466554400';
const FIRST = `${P}01`;
const SECOND = `${P}02`;
const BOTH = `user-of-both-${FIRST}`;
const ONLY_FIRST = `user-of-first-${FIRST}`;
const BOX = { first: [`${P}b1`, `${P}b2`], second: [`${P}b3`, `${P}b4`] };
const CONN = { first: [`${P}c1`, `${P}c2`], second: [`${P}c3`, `${P}c4`] };
const MAPPING = { first: `${P}d1`, second: `${P}d2` };

/** Signed in to the first organisation: the token's claim names it. */
const tokenOf = (sub: string) => jwt.sign({ sub, tenantId: FIRST, email: `${sub}@a-door.test` }, process.env.JWT_SECRET!);

describe('a door that names an organisation or a migration in its path', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  const nameOf = async (id: string) => (await owner.query<{ name: string }>('SELECT name FROM tenant WHERE id = $1', [id])).rows[0]?.name;

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);
    for (const [id, name] of [[FIRST, 'The first'], [SECOND, 'The second']] as const) {
      await owner.query(`INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active') ON CONFLICT (id) DO NOTHING`, [id, name]);
    }
    await seedMembership(owner, FIRST, BOTH, 'owner');
    await seedMembership(owner, SECOND, BOTH, 'owner');
    await seedMembership(owner, FIRST, ONLY_FIRST, 'owner');
    for (const [side, tenant] of [['first', FIRST], ['second', SECOND]] as const) {
      const [source, target] = CONN[side];
      const [boxSource, boxTarget] = BOX[side];
      await owner.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
           ($1, $3, 'source', 'imap', 'A source', '{}', 'connected'),
           ($2, $3, 'target', 'jmap', 'A target', '{}', 'connected')
         ON CONFLICT (id) DO NOTHING`,
        [source, target, tenant],
      );
      await owner.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
           ($1, $3, $4, 'source box', 'user'), ($2, $3, $5, 'target box', 'user')
         ON CONFLICT (id) DO NOTHING`,
        [boxSource, boxTarget, tenant, source, target],
      );
      await owner.query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
         VALUES ($1, $2, $3, $4, 'active', 'mirror') ON CONFLICT (id) DO NOTHING`,
        [MAPPING[side], tenant, boxSource, boxTarget],
      );
    }
  });

  afterAll(async () => {
    await owner.query('DELETE FROM tenant WHERE id = ANY($1)', [[FIRST, SECOND]]);
    await owner.end();
  });

  it('refuses to rename the organisation it names when that is not the one signed in to, and renames neither (1)', async () => {
    const res = await request.put(`/api/tenants/${SECOND}`).set('Authorization', `Bearer ${tokenOf(BOTH)}`).send({ name: 'Renamed by its path' });
    expect(res.status).toBe(403);
    expect(await nameOf(FIRST)).toBe('The first');
    expect(await nameOf(SECOND)).toBe('The second');
  });

  it('refuses the other doors under another organisation’s id: its details, members and settings (1)', async () => {
    const token = tokenOf(BOTH);
    for (const [method, path, body] of [
      ['get', `/api/tenants/${SECOND}`, undefined],
      ['get', `/api/tenants/${SECOND}/members`, undefined],
      ['put', `/api/tenants/${SECOND}/contact`, {}],
      ['put', `/api/tenants/${SECOND}/notifications`, {}],
    ] as const) {
      const res = await request[method](path).set('Authorization', `Bearer ${token}`).send(body);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  it('refuses to set the name a member shows under another organisation’s id, and writes it in neither (1)', async () => {
    // Workplan 0176 T3's own door: what a member says of themselves on a
    // person's page. Named by the second organisation's path, it set the name
    // in the first, the one signed in to.
    const res = await request
      .put(`/api/tenants/${SECOND}/members/me`)
      .set('Authorization', `Bearer ${tokenOf(BOTH)}`)
      .send({ displayName: 'Named by its path' });
    expect(res.status).toBe(403);
    const names = await owner.query<{ display_name: string | null }>(
      'SELECT display_name FROM tenant_member WHERE user_id = $1 AND tenant_id = ANY($2)',
      [BOTH, [FIRST, SECOND]],
    );
    expect(names.rows.map((r) => r.display_name)).toEqual([null, null]);
  });

  it('answers the same doors for the organisation signed in to, as before (2)', async () => {
    const token = tokenOf(BOTH);
    expect((await request.get(`/api/tenants/${FIRST}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request.get(`/api/tenants/${FIRST}/members`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const renamed = await request.put(`/api/tenants/${FIRST}`).set('Authorization', `Bearer ${token}`).send({ name: 'The first, renamed' });
    expect(renamed.status).toBe(200);
    expect(await nameOf(FIRST)).toBe('The first, renamed');
    await owner.query(`UPDATE tenant SET name = 'The first' WHERE id = $1`, [FIRST]);
  });

  it('answers 404 for the runs of a migration that is not the caller’s, as the migration’s own door does, and the list for its own (3)', async () => {
    const token = tokenOf(ONLY_FIRST);
    const other = await request.get(`/api/migrations/${MAPPING.second}/runs`).set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(404);
    expect((await request.get(`/api/migrations/${MAPPING.second}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    const own = await request.get(`/api/migrations/${MAPPING.first}/runs`).set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ runs: [], truncated: false });
  });
});
