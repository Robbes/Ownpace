// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The owner's three routes, against a REAL database (workplan 0108 T3).
 *
 * PGlite as `app_user`, the wiring `mapping-link-store.unit.test.ts` and
 * `mapping-link-auth.unit.test.ts` already use — because the property this file
 * exists to prove is *"a link that could not work is never written"*, and a
 * test that mocks the store cannot tell a row that was refused from a row that
 * was written and then hidden. Only the table can answer that, so the table is
 * asked directly after every refusal.
 *
 * `grant-link-readiness.unit.test.ts` proves the DECISION. This proves the
 * route acts on it — a gap that was real: computing the refusal and dropping it
 * on the floor left that file entirely green.
 *
 * `authenticate` is the one thing stubbed. Everything else — RLS, the
 * mapping/mailbox/connection join, the store, the encryption — is the product's.
 */

// Set before the imports below, because `SecretStore` reads it at encrypt time
// and the fixture credentials are encrypted in `beforeAll`. The same obviously
// fake value the integration tests use — a test key is not a secret, and hard
// rule 3 is about real ones (there is none in this repo, and never will be).
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  listMappingLinks,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 5f4f0000-…, unused elsewhere in the repo.
const TENANT = '5f4f0000-e29b-41d4-a716-446655441601';
const OTHER_TENANT = '5f4f0000-e29b-41d4-a716-446655441602';
const GOOGLE_CONN = '5f4f0000-e29b-41d4-a716-446655441611';
const IMAP_CONN = '5f4f0000-e29b-41d4-a716-446655441612';
const BARE_CONN = '5f4f0000-e29b-41d4-a716-446655441613';
const GOOGLE_BOX = '5f4f0000-e29b-41d4-a716-446655441621';
const IMAP_BOX = '5f4f0000-e29b-41d4-a716-446655441622';
const BARE_BOX = '5f4f0000-e29b-41d4-a716-446655441623';
/** A Google source with a client id AND secret: the one that may be granted. */
const READY_MAPPING = '5f4f0000-e29b-41d4-a716-446655441631';
/** A Google source with no stored credentials at all. */
const UNCONFIGURED_MAPPING = '5f4f0000-e29b-41d4-a716-446655441632';
/** An IMAP source — nothing to consent to. */
const IMAP_MAPPING = '5f4f0000-e29b-41d4-a716-446655441633';
/** Somebody else's mapping, for the isolation check. */
const FOREIGN_MAPPING = '5f4f0000-e29b-41d4-a716-446655441634';
const FOREIGN_CONN = '5f4f0000-e29b-41d4-a716-446655441614';
const FOREIGN_BOX = '5f4f0000-e29b-41d4-a716-446655441624';

let driver: LedgerDriver;
/** Set per test — the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    // The only stub. Verifying a JWT is `auth.unit.test.ts`'s job; what this
    // file needs is a caller with a tenant and a role.
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

/** Read the table directly, outside any route, to see what really exists. */
async function rowsFor(mappingId: string): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT * FROM mapping_link WHERE mapping_id = $1', [mappingId]);
    return r.rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  const withClient = async (fn: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<void>) => {
    const conn = await driver.acquire();
    try {
      await fn((sql, p) => conn.query(sql, p ?? []));
    } finally {
      await conn.release();
    }
  };

  // `JSON.stringify(...encrypted)`, exactly as the create route stores it
  // (`migrations/index.ts`): `secret_ref` is a text column and `.encrypted` is
  // the EncryptedSecret OBJECT, so binding it raw writes "[object Object]" —
  // which decrypts to nothing and reads, one refusal later, as an unconfigured
  // client. The fixture has to lie the same way production tells the truth.
  const googleCreds = JSON.stringify(
    SecretStore.encryptCredentials({
      username: 'someone@example.invalid',
      clientId: 'client.apps.googleusercontent.com',
      clientSecret: 'not-a-real-secret',
    }).encrypted,
  );

  await withClient(async (q) => {
    for (const [id, name] of [
      [TENANT, 'links'],
      [OTHER_TENANT, 'other'],
    ]) {
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [id, name]);
    }
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','gmail','g','{}'::jsonb,'connected',$3)`,
      [GOOGLE_CONN, TENANT, googleCreds],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','gmail','g-bare','{}'::jsonb,'connected')`,
      [BARE_CONN, TENANT],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
      [IMAP_CONN, TENANT],
    );
    for (const [box, conn] of [
      [GOOGLE_BOX, GOOGLE_CONN],
      [BARE_BOX, BARE_CONN],
      [IMAP_BOX, IMAP_CONN],
    ]) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','m@example.invalid')`,
        [box, TENANT, conn],
      );
    }
    for (const [mapping, box] of [
      [READY_MAPPING, GOOGLE_BOX],
      [UNCONFIGURED_MAPPING, BARE_BOX],
      [IMAP_MAPPING, IMAP_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused')`,
        [mapping, TENANT, box],
      );
    }
    // The other tenant's own chain, so its mapping is a real one rather than a
    // half-row: the isolation check has to fail on the TENANT, not on a
    // constraint.
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','gmail','theirs','{}'::jsonb,'connected')`,
      [FOREIGN_CONN, OTHER_TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','them@example.invalid')`,
      [FOREIGN_BOX, OTHER_TENANT, FOREIGN_CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'paused')`,
      [FOREIGN_MAPPING, OTHER_TENANT, FOREIGN_BOX],
    );
  });
});

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  caller = { tenantId: TENANT, userId: 'rob', userRole: 'owner' };
});

describe('issuing refuses BEFORE it writes', () => {
  it('refuses a source that is not Google, and writes nothing', async () => {
    const res = await request(app).post(`/api/migrations/${IMAP_MAPPING}/links`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('source_not_google');
    expect(res.body.reason).toContain('Gmail');
    // The property the mocked version of this test could not have seen.
    expect(await rowsFor(IMAP_MAPPING)).toEqual([]);
  });

  it('refuses a Google source with no client stored, and writes nothing', async () => {
    const res = await request(app).post(`/api/migrations/${UNCONFIGURED_MAPPING}/links`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('client_not_configured');
    expect(await rowsFor(UNCONFIGURED_MAPPING)).toEqual([]);
  });

  it('refuses when the deployment has no WEB_URL, and writes nothing', async () => {
    const had = process.env.WEB_URL;
    delete process.env.WEB_URL;
    try {
      const res = await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('web_url_unset');
      expect(await rowsFor(READY_MAPPING)).toEqual([]);
    } finally {
      process.env.WEB_URL = had;
    }
  });

  it('refuses an expiry it does not offer, and writes nothing', async () => {
    const res = await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send({
      expiryDays: 365,
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toContain('1, 7, 30');
    expect(await rowsFor(READY_MAPPING)).toEqual([]);
  });

  it("answers 404 for another tenant's mapping, and writes nothing", async () => {
    const res = await request(app).post(`/api/migrations/${FOREIGN_MAPPING}/links`).send({});
    expect(res.status).toBe(404);
    expect(await rowsFor(FOREIGN_MAPPING)).toEqual([]);
  });

  it('refuses a viewer, whatever the mapping is like', async () => {
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    const res = await request(app).post(`/api/migrations/${READY_MAPPING}/links`).send({});
    expect(res.status).toBe(403);
    expect(await rowsFor(READY_MAPPING)).toEqual([]);
  });
});

describe('a link that can work', () => {
  it('is written once, returned once, and never stored in the clear', async () => {
    const res = await request(app)
      .post(`/api/migrations/${READY_MAPPING}/links`)
      .send({ expiryDays: 1 });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^https:\/\/app\.example\/grant\/[0-9a-f-]{36}\.[\w-]+$/);
    expect(res.body.expiryDays).toBe(1);
    expect(res.body.distribution).toMatch(/Send this to the person yourself/);

    const secret = String(res.body.url).split('.').slice(1).join('.');
    const rows = await rowsFor(READY_MAPPING);
    expect(rows).toHaveLength(1);
    // Not in ANY column, in any form — the table holds a hash.
    expect(JSON.stringify(rows[0])).not.toContain(secret);
    expect(rows[0]!.purpose).toBe('grant');
    expect(rows[0]!.created_by).toBe('rob');

    // A day, not the seven-day default: the owner's choice reached the row.
    const expiresIn = new Date(String(rows[0]!.expires_at)).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(23 * 3_600_000);
    expect(expiresIn).toBeLessThan(25 * 3_600_000);
  });

  it('lists it with state and dates, and no URL anywhere in the answer', async () => {
    const res = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0].state).toBe('live');
    expect(res.body.links[0].createdBy).toBe('rob');
    // Nothing resembling a token — this endpoint could not produce one.
    expect(JSON.stringify(res.body)).not.toMatch(/grant\//);
  });

  it('lets a viewer SEE that a door exists, because seeing is not opening', async () => {
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    const res = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    expect(res.status).toBe(200);
    expect(res.body.links).toHaveLength(1);
  });
});

describe('revoking', () => {
  it('revokes once, then answers the second press without erroring', async () => {
    const links = await request(app).get(`/api/migrations/${READY_MAPPING}/links`);
    const id = links.body.links[0].id;

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
    const res = await request(app)
      .delete(`/api/migrations/${READY_MAPPING}/links/${OTHER_TENANT}`);
    expect(res.status).toBe(404);
  });

  it("cannot revoke another tenant's link, even knowing its id", async () => {
    // Knowing an id is the most an attacker gets from a leaked list, and the
    // id is in the URL of every link ever sent. Two layers say no — the
    // store's own `WHERE tenant_id`, and RLS on the tenant-scoped transaction
    // — and this asserts the OUTCOME rather than either layer, so removing one
    // is still caught by the other rather than by nothing.
    const foreign = await withTenant(driver, OTHER_TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: OTHER_TENANT,
        mappingId: FOREIGN_MAPPING,
        purpose: 'grant',
        createdBy: 'them',
        expiresAt: expiryFromDays(7),
      }),
    );

    const res = await request(app)
      .delete(`/api/migrations/${READY_MAPPING}/links/${foreign.id}`);
    expect(res.status).toBe(404);

    const still = await withTenant(driver, OTHER_TENANT, (db) =>
      listMappingLinks(db, { tenantId: OTHER_TENANT, mappingId: FOREIGN_MAPPING }),
    );
    expect(still).toHaveLength(1);
    expect(still[0]!.state).toBe('live');
  });

  it('refuses a viewer', async () => {
    caller = { tenantId: TENANT, userId: 'someone', userRole: 'viewer' };
    const res = await request(app).delete(`/api/migrations/${READY_MAPPING}/links/${READY_MAPPING}`);
    expect(res.status).toBe(403);
  });
});
