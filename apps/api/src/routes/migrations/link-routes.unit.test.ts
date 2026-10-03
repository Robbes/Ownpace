// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A migration's own link doors, against a REAL database (workplan 0108 T3;
 * ADR-0035, amended 2026-09-29; the owner, 2026-10-03: *"yes, replace the
 * per-migration links"*).
 *
 * Issuing is the person's now (`person-link-routes.ts`, proved by
 * `a-link-for-a-person.unit.test.ts`, and its limit by
 * `a-person-link-within-the-limit.unit.test.ts`). What this file proves is what
 * is left on a migration:
 *
 * - **the issue door refuses in words**, naming the person whose page makes the
 *   link, or saying the migration is given a person first, and writes nothing,
 *   whatever the body asked for;
 * - **a link already sent is listed** with its state and dates and never its
 *   secret, to anyone who may see the migration;
 * - **and can be revoked**, once, by an owner or admin of its own
 *   organisation only.
 *
 * PGlite as `app_user`, the wiring `mapping-link-store.unit.test.ts` uses, so
 * every "writes nothing" is the table's answer. `authenticate` is the one
 * thing stubbed.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'node:path';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  listMappingLinks,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { specChecker } from '../../__tests__/doors-that-start-work.ts';

// UUID family 5f4f0000-…, unused elsewhere in the repo.
const TENANT = '5f4f0000-e29b-41d4-a716-446655441601';
const OTHER_TENANT = '5f4f0000-e29b-41d4-a716-446655441602';
const GOOGLE_CONN = '5f4f0000-e29b-41d4-a716-446655441611';
const IMAP_CONN = '5f4f0000-e29b-41d4-a716-446655441612';
const GOOGLE_BOX = '5f4f0000-e29b-41d4-a716-446655441621';
const IMAP_BOX = '5f4f0000-e29b-41d4-a716-446655441622';
/** A Google source, Anna's. */
const READY_MAPPING = '5f4f0000-e29b-41d4-a716-446655441631';
/** An IMAP source that belongs to nobody yet. */
const IMAP_MAPPING = '5f4f0000-e29b-41d4-a716-446655441633';
/** Somebody else's mapping, for the isolation checks. */
const FOREIGN_MAPPING = '5f4f0000-e29b-41d4-a716-446655441634';
const FOREIGN_CONN = '5f4f0000-e29b-41d4-a716-446655441614';
const FOREIGN_BOX = '5f4f0000-e29b-41d4-a716-446655441624';
const TARGET_CONN = '5f4f0000-e29b-41d4-a716-446655441615';
const TARGET_BOX = '5f4f0000-e29b-41d4-a716-446655441625';
/** The person READY_MAPPING is for. */
const ANNA = '5f4f0000-e29b-41d4-a716-446655441641';

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', '..', 'docs', 'openapi.yaml'));
const LINKS_SPEC = '/api/migrations/{mappingId}/links';

let driver: LedgerDriver;
/** Set per test — the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
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

const { default: linkRoutes } = await import('./link-routes.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', linkRoutes);

/** A statement as the owner, outside any route: for a fixture, never for an assertion's subject. */
async function asOwner(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows;
  } finally {
    await conn.release();
  }
}

/** Read the table directly, outside any route, to see what really exists. */
async function rowsFor(mappingId: string): Promise<Array<Record<string, unknown>>> {
  return (await asOwner('SELECT * FROM mapping_link WHERE mapping_id = $1', [mappingId])) as Array<
    Record<string, unknown>
  >;
}

/** A link sent before the person's replaced it: written as the store wrote it then. */
const sent = (mappingId: string, purpose: 'grant' | 'view' = 'grant') =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, { tenantId: TENANT, mappingId, purpose, createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: who a migration is for is a `person` row.
  await runManagedMigrations({ driver, logger: () => {} });

  for (const [id, name] of [
    [TENANT, 'links'],
    [OTHER_TENANT, 'other'],
  ]) {
    await asOwner('INSERT INTO tenant (id, name) VALUES ($1,$2)', [id, name]);
  }
  await asOwner(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$4,'source','gmail','g','{"user":"anna@example.invalid"}'::jsonb,'connected'),
       ($2,$4,'source','imap','i','{}'::jsonb,'connected'),
       ($3,$4,'target','nextcloud','nc','{"host":"cloud.example.org"}'::jsonb,'connected')`,
    [GOOGLE_CONN, IMAP_CONN, TARGET_CONN, TENANT],
  );
  for (const [box, conn] of [
    [GOOGLE_BOX, GOOGLE_CONN],
    [IMAP_BOX, IMAP_CONN],
    [TARGET_BOX, TARGET_CONN],
  ]) {
    await asOwner(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  for (const [mapping, box] of [
    [READY_MAPPING, GOOGLE_BOX],
    [IMAP_MAPPING, IMAP_BOX],
  ]) {
    await asOwner(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status)
       VALUES ($1,$2,$3,$4,'paused')`,
      [mapping, TENANT, box, TARGET_BOX],
    );
  }
  await asOwner(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, 'Anna')`, [ANNA, TENANT]);
  await asOwner('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1, $2, $3)', [
    READY_MAPPING,
    ANNA,
    TENANT,
  ]);
  // The other organisation's own chain, so its mapping is a real one: the
  // isolation checks have to fail on the TENANT, not on a constraint.
  await asOwner(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','gmail','theirs','{}'::jsonb,'connected')`,
    [FOREIGN_CONN, OTHER_TENANT],
  );
  await asOwner(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','them@example.invalid')`,
    [FOREIGN_BOX, OTHER_TENANT, FOREIGN_CONN],
  );
  await asOwner(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,'paused')`,
    [FOREIGN_MAPPING, OTHER_TENANT, FOREIGN_BOX],
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };
  await asOwner('DELETE FROM mapping_link WHERE tenant_id = $1', [TENANT]);
});

describe('issuing is the person’s now', () => {
  it('refuses for a migration of a person, naming them and their page, and writes nothing', async () => {
    const res = await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send({ expiryDays: 7 });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toEqual({
      error: 'links_are_per_person',
      reason: "Links are made per person now: one for all of Anna's migrations. Make it on their page.",
      personId: ANNA,
    });
    expect(await rowsFor(READY_MAPPING)).toEqual([]);
    const { schema } = CHECKER.responseSchema({ name: 'issue', path: LINKS_SPEC, spec: LINKS_SPEC, accepted: 409 } as never, '409');
    expect(CHECKER.satisfies(schema, res.body), 'the spec does not document this answer').toBe(true);
  });

  it('refuses for a migration of nobody, saying it is given a person first', async () => {
    const res = await request(app).post(`/api/migrations/${IMAP_MAPPING}/links`).send({ purpose: 'view' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('links_are_per_person');
    expect(res.body.reason).toBe(
      'Links are made per person now, and this migration is not with a person yet. ' +
        'Say who it is for on its page, then make the link on theirs.',
    );
    expect(res.body.personId).toBeUndefined();
    expect(await rowsFor(IMAP_MAPPING)).toEqual([]);
  });

  it('answers the same whatever the body asks for, a progress link included', async () => {
    for (const body of [{}, { purpose: 'grant', expiryDays: 30 }, { purpose: 'view', expiryDays: 90 }, { bogus: 1 }]) {
      const res = await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error).toBe('links_are_per_person');
    }
    expect(await rowsFor(READY_MAPPING)).toEqual([]);
  });

  it('asks the role first, as every door that used to issue did, and the organisation', async () => {
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    expect((await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send({})).status).toBe(403);

    caller = { tenantId: TENANT, userId: 'pat', userRole: 'owner' };
    expect((await request(app).post(`/api/migrations/${FOREIGN_MAPPING}/links`).send({})).status).toBe(404);
  });
});

describe('a link already sent', () => {
  it('is listed with state and dates, and no URL anywhere in the answer', async () => {
    await sent(READY_MAPPING);
    const res = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0].state).toBe('live');
    expect(res.body.links[0].createdBy).toBe('pat');
    // Nothing resembling a token — this endpoint could not produce one.
    expect(JSON.stringify(res.body)).not.toMatch(/grant\//);
  });

  it('lets a viewer SEE that a door exists, because seeing is not opening', async () => {
    await sent(READY_MAPPING);
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    const res = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
  });

  it('appears wearing its own purpose', async () => {
    await sent(IMAP_MAPPING, 'view');
    const res = await request(app).get(`/api/migrations/${IMAP_MAPPING}/links`);
    expect(res.body.links.map((l: { purpose: string; state: string }) => [l.purpose, l.state])).toEqual([
      ['view', 'live'],
    ]);
  });
});

describe('revoking a link already sent', () => {
  it('revokes once, then answers the second press without erroring', async () => {
    const { id } = await sent(READY_MAPPING);

    const first = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${id}`);
    expect(first.status).toBe(200);
    expect(first.body.revoked).toBe(true);

    const again = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${id}`);
    expect(again.status).toBe(200);
    expect(again.body.revoked).toBe(false);

    const after = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    expect(after.body.links[0].state).toBe('revoked');
  });

  it('answers 404 for a link id that is not on this migration', async () => {
    const res = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${OTHER_TENANT}`);
    expect(res.status).toBe(404);
  });

  it("cannot revoke another tenant's link, even knowing its id", async () => {
    // Knowing an id is the most an attacker gets from a leaked list, and the
    // id is in the URL of every link ever sent. Two layers say no — the
    // store's own `WHERE tenant_id`, and RLS on the tenant-scoped transaction
    // — and this asserts the OUTCOME rather than either layer.
    const foreign = await withTenant(driver, OTHER_TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: OTHER_TENANT,
        mappingId: FOREIGN_MAPPING,
        purpose: 'grant',
        createdBy: 'them',
        expiresAt: expiryFromDays(7),
      }),
    );

    const res = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${foreign.id}`);
    expect(res.status).toBe(404);

    const still = await withTenant(driver, OTHER_TENANT, (db) =>
      listMappingLinks(db, { tenantId: OTHER_TENANT, mappingId: FOREIGN_MAPPING }),
    );
    expect(still).toHaveLength(1);
    expect(still[0]!.state).toBe('live');
  });

  it('refuses a viewer', async () => {
    const { id } = await sent(READY_MAPPING);
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    const res = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${id}`);
    expect(res.status).toBe(403);
  });
});
