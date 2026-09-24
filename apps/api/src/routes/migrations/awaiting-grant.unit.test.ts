// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A migration waiting on somebody's grant does not start (workplan 0108 T4).
 *
 * `grant-link-readiness.unit.test.ts` proves the DECISION. This proves the
 * START ROUTE acts on it, which is a separate claim and was learned the hard
 * way one task earlier: T3 shipped thirteen green tests around a refusal the
 * route could have computed and dropped on the floor, and nothing would have
 * gone red. So this drives the real router against a real database.
 *
 * It also pins the composition, which is where a guard most easily drifts from
 * reality: the credentials are assembled the way a sync pass assembles them —
 * the mapping's own OVER the connection's, key by key (migration 0032) — so a
 * grant that has landed lets the migration start even though the connection
 * itself still holds no token.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 5f510000-…, unused elsewhere in the repo.
const TENANT = '5f510000-e29b-41d4-a716-446655441801';
const GOOGLE_CONN = '5f510000-e29b-41d4-a716-446655441811';
const IMAP_CONN = '5f510000-e29b-41d4-a716-446655441812';
const GOOGLE_BOX = '5f510000-e29b-41d4-a716-446655441821';
const IMAP_BOX = '5f510000-e29b-41d4-a716-446655441822';
/** Google source, client configured, nobody has granted yet. */
const UNGRANTED = '5f510000-e29b-41d4-a716-446655441831';
/** An IMAP source, which nobody grants through a link. */
const IMAP_MAPPING = '5f510000-e29b-41d4-a716-446655441832';
/**
 * Granted through a link, then taken back by the person (0108 T8 (c)), on a
 * connection that holds a refresh token of the organisation's own: the case
 * where "is a grant awaited?" alone would say go ahead.
 */
const OWN_TOKEN_CONN = '5f510000-e29b-41d4-a716-446655441813';
const OWN_TOKEN_BOX = '5f510000-e29b-41d4-a716-446655441823';
const WITHDRAWN = '5f510000-e29b-41d4-a716-446655441833';
const WITHDRAWN_AT = '2026-09-24T06:00:00.000Z';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});
// The start route enqueues a first pass after activating. Nothing here is about
// that, and a real client would reach for a network — so it answers, and the
// route's own "a failure to enqueue must not fail the request" path is left
// alone rather than exercised by accident.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ trigger: () => Promise.resolve({ id: 'run-1' }) }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

const encrypted = (creds: Record<string, string>) =>
  JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

async function setMappingSecret(mappingId: string, value: string | null) {
  const conn = await driver.acquire();
  try {
    await conn.query('UPDATE mailbox_mapping SET source_secret_ref = $2 WHERE id = $1', [
      mappingId,
      value,
    ]);
  } finally {
    await conn.release();
  }
}

async function statusOf(mappingId: string): Promise<string> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT status FROM mailbox_mapping WHERE id = $1', [mappingId]);
    return (r.rows[0] as { status: string }).status;
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'waiting']);
    // The owner's client, and deliberately NO refresh token: the shape a
    // migration has while it waits for its migrator.
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','gmail','g','{}'::jsonb,'connected',$3)`,
      [
        GOOGLE_CONN,
        TENANT,
        encrypted({ username: 'a@example.invalid', clientId: 'cid', clientSecret: 'csec' }),
      ],
    );
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected',$3)`,
      [IMAP_CONN, TENANT, encrypted({ username: 'a@example.invalid', password: 'p' })],
    );
    for (const [box, c] of [
      [GOOGLE_BOX, GOOGLE_CONN],
      [IMAP_BOX, IMAP_CONN],
    ]) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','m@example.invalid')`,
        [box, TENANT, c],
      );
    }
    for (const [m, box] of [
      [UNGRANTED, GOOGLE_BOX],
      [IMAP_MAPPING, IMAP_BOX],
    ]) {
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused')`,
        [m, TENANT, box],
      );
    }
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','google','own','{}'::jsonb,'connected',$3)`,
      [
        OWN_TOKEN_CONN,
        TENANT,
        encrypted({ clientId: 'cid', clientSecret: 'csec', refreshToken: '1//the-organisations-own' }),
      ],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','pat@example.invalid')`,
      [OWN_TOKEN_BOX, TENANT, OWN_TOKEN_CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, grant_withdrawn_at)
       VALUES ($1,$2,$3,'paused',$4)`,
      [WITHDRAWN, TENANT, OWN_TOKEN_BOX, WITHDRAWN_AT],
    );
  } finally {
    await conn.release();
  }
  // 120s, not vitest's default 10s: this fixture initialises a PGlite cluster
  // and runs the full migration chain, which under a loaded CI runner has
  // exceeded 10s while passing 8/8 in isolation — the load-class flake #652
  // documented. The offboarding and support fixtures carry the same allowance
  // for the same reason.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query("UPDATE mailbox_mapping SET status = 'paused', source_secret_ref = NULL");
  } finally {
    await conn.release();
  }
});

describe('POST /:mappingId/start', () => {
  it('refuses a Google source nobody has connected, and leaves it paused', async () => {
    const res = await request(app).post(`/api/migrations/${UNGRANTED}/start`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('awaiting_grant');
    expect(res.body.message).toMatch(/grant link/);
    // The property that matters: it did not quietly become active and then
    // fail at the provider hours later.
    expect(await statusOf(UNGRANTED)).toBe('paused');
  });

  it('starts once the migrator’s grant has landed on the MAPPING', async () => {
    // The connection still holds no refresh token — only the client. The
    // composition is what makes this work, exactly as a sync pass composes it.
    await setMappingSecret(UNGRANTED, encrypted({ refreshToken: '1//granted' }));
    const res = await request(app).post(`/api/migrations/${UNGRANTED}/start`).send({});
    expect(res.status).toBe(200);
    expect(await statusOf(UNGRANTED)).toBe('active');
  });

  it('says nothing about a source that nobody grants through a link', async () => {
    const res = await request(app).post(`/api/migrations/${IMAP_MAPPING}/start`).send({});
    expect(res.status).toBe(200);
    expect(await statusOf(IMAP_MAPPING)).toBe('active');
  });

  it('treats an unreadable credential as no credential, never as a green light', async () => {
    // Hard rule 9's direction: the owner meets a refusal that names the remedy
    // rather than a run that dies at the first request.
    await setMappingSecret(UNGRANTED, 'not-decryptable-at-all');
    const res = await request(app).post(`/api/migrations/${UNGRANTED}/start`).send({});
    expect(res.status).toBe(409);
    expect(await statusOf(UNGRANTED)).toBe('paused');
  });
});

describe('a grant the person took back (0108 T8 (c))', () => {
  it('is not started, and the owner is told who stopped it and when', async () => {
    const res = await request(app).post(`/api/migrations/${WITHDRAWN}/start`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('grant_withdrawn');
    expect(res.body.message).toContain('withdrew their permission on 2026-09-24');
    expect(res.body.message).toMatch(/new grant link/);
    // Although the connection has a token of its own, and "is a grant still
    // awaited?" would have said no: the person said no to being read.
    expect(await statusOf(WITHDRAWN)).toBe('paused');
  });

  it('is not synced on the owner’s press either', async () => {
    const conn = await driver.acquire();
    try {
      await conn.query("UPDATE mailbox_mapping SET status = 'active' WHERE id = $1", [WITHDRAWN]);
    } finally {
      await conn.release();
    }

    const res = await request(app).post(`/api/migrations/${WITHDRAWN}/sync`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('grant_withdrawn');
    expect(res.body.reason).toContain('withdrew their permission on 2026-09-24');
  });

  it('is said on the migration’s own page', async () => {
    const res = await request(app).get(`/api/migrations/${WITHDRAWN}`);

    expect(res.status).toBe(200);
    expect(res.body.grantWithdrawnAt).toBe(WITHDRAWN_AT);
    expect((await request(app).get(`/api/migrations/${UNGRANTED}`)).body.grantWithdrawnAt).toBeNull();
  });
});
