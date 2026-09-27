// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELETED MIGRATION REVOKES ITS GRANT (workplan 0139 T6).
 *
 * Privacy §9 says credentials are destroyed when the migration is deleted.
 * `DELETE /api/migrations/:mappingId` deleted the row and revoked nothing, and
 * the row can hold a credential of its own: `source_secret_ref`, the token a
 * person granted through a grant link, which reaches their own mailbox. So the
 * grant stayed live at Google with nobody holding it.
 *
 * Against a real database, PGlite as `app_user`, through the real route, with
 * nothing stubbed but Google's revocation endpoint:
 *
 *  - deleting a migration that holds a granted token sends Google that token,
 *    once, after the row is gone, and says so;
 *  - the organisation's own credential, on the connection, is never touched,
 *    and a migration with no credential of its own calls nobody;
 *  - a migration that is not there, or is another organisation's, revokes
 *    nothing;
 *  - Google not answering still deletes the migration, and says the revocation
 *    failed, so the person knows to withdraw it themselves.
 *
 * It fails today: the route revokes nothing. The names and addresses are
 * invented.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 0139b600-…, unused elsewhere in the repo.
const TENANT = '0139b600-e29b-41d4-a716-446655440001';
const ELSEWHERE = '0139b600-e29b-41d4-a716-446655440002';
const CONN = '0139b600-e29b-41d4-a716-446655440011';
const BOX = '0139b600-e29b-41d4-a716-446655440021';
/** One migration per case, so no case leans on another's leftovers. */
const GRANTED = '0139b600-e29b-41d4-a716-446655440031';
const OWN = '0139b600-e29b-41d4-a716-446655440032';
const UNREACHABLE = '0139b600-e29b-41d4-a716-446655440033';
const NEVER_THERE = '0139b600-e29b-41d4-a716-446655440034';
const OTHERS = '0139b600-e29b-41d4-a716-446655440035';
const OTHERS_CONN = '0139b600-e29b-41d4-a716-446655440012';
const OTHERS_BOX = '0139b600-e29b-41d4-a716-446655440022';

/** What the connection holds: the organisation's own, which deleting a migration never touches. */
const ORGANISATIONS_OWN = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'the-organisations-own' };
const tokenOf = (mappingId: string) => `granted-${mappingId.slice(-4)}`;
const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

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

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/**
 * Whether the migration's row is still there when Google is called, or
 * `'held'` when the database does not answer within a second: then the
 * delete's own transaction is still open, which is a revocation made before
 * the delete had gone through. PGlite has one connection, so waiting on it
 * would hang the case instead of failing it.
 */
async function rowAtCall(mappingId: string): Promise<boolean | 'held'> {
  const held = new Promise<'held'>((resolve) => setTimeout(() => resolve('held'), 1000));
  const read = sql('SELECT id FROM mailbox_mapping WHERE id = $1', [mappingId]).then((rows) => rows.length > 0);
  return Promise.race([read, held]);
}

/** Google's revocation endpoint: every call is kept, with whether the migration's row was still there. */
let unreachable = false;
const googleCalls: { token: string; rowStillThere: boolean | 'held' }[] = [];
let deleting = '';

vi.stubGlobal('fetch', async (_url: string | URL, init?: { body?: unknown }) => {
  const token = new URLSearchParams(String(init?.body ?? '')).get('token') ?? '';
  googleCalls.push({ token, rowStillThere: await rowAtCall(deleting) });
  if (unreachable) throw new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com');
  return new Response('', { status: 200 });
});

const remove = (mappingId: string) => {
  deleting = mappingId;
  return request(app).delete(`/api/migrations/${mappingId}`).send();
};

const exists = async (mappingId: string) =>
  (await sql('SELECT id FROM mailbox_mapping WHERE id = $1', [mappingId])).length > 0;

const connectionSecret = async () =>
  String((await sql('SELECT secret_ref FROM connection WHERE id = $1', [CONN]))[0]?.secret_ref);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  for (const [tenant, conn, box, account] of [
    [TENANT, CONN, BOX, 'pat@example.invalid'],
    [ELSEWHERE, OTHERS_CONN, OTHERS_BOX, 'sam@example.invalid'],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, tenant === TENANT ? 'ours' : 'theirs']);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','google','Example Care Google','{}'::jsonb,'connected',$3)`,
      [conn, tenant, sealed(ORGANISATIONS_OWN)],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user',$4)`,
      [box, tenant, conn, account],
    );
  }
  for (const [id, tenant, box] of [
    [GRANTED, TENANT, BOX],
    [OWN, TENANT, BOX],
    [UNREACHABLE, TENANT, BOX],
    [OTHERS, ELSEWHERE, OTHERS_BOX],
  ] as const) {
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name, source_secret_ref)
       VALUES ($1,$2,$3,'active','Pat',$4)`,
      [id, tenant, box, id === OWN ? null : sealed({ refreshToken: tokenOf(id) })],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  unreachable = false;
  googleCalls.length = 0;
});

describe('DELETE /api/migrations/:mappingId revokes the credential its own row holds', () => {
  it('sends Google the granted token, once, after the row is gone, and says so', async () => {
    const before = await connectionSecret();
    const res = await remove(GRANTED);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, revocation: { kind: 'google', status: 'revoked' } });
    expect(googleCalls).toEqual([{ token: tokenOf(GRANTED), rowStillThere: false }]);
    expect(await exists(GRANTED)).toBe(false);
    // The organisation's own credential, on the connection, is left as it was.
    expect(await connectionSecret()).toBe(before);
    expect(SecretStore.decryptCredentials(before)).toEqual(ORGANISATIONS_OWN);
  });

  it("a migration with no credential of its own calls nobody, not even with the organisation's", async () => {
    const before = await connectionSecret();
    const res = await remove(OWN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Mapping deleted successfully' });
    expect(googleCalls).toEqual([]);
    expect(await exists(OWN)).toBe(false);
    expect(await connectionSecret()).toBe(before);
  });

  it("a migration that is not there, or is another organisation's, revokes nothing", async () => {
    expect((await remove(NEVER_THERE)).status).toBe(404);
    expect((await remove(OTHERS)).status).toBe(404);
    expect(googleCalls).toEqual([]);
    expect(await exists(OTHERS)).toBe(true);
  });

  it('Google not answering still deletes the migration, and says the revocation failed', async () => {
    unreachable = true;
    const res = await remove(UNREACHABLE);

    expect(res.status).toBe(200);
    expect(res.body.revocation).toMatchObject({ kind: 'google', status: 'failed' });
    expect(res.body.revocation.reason).toEqual(expect.any(String));
    expect(googleCalls).toEqual([{ token: tokenOf(UNREACHABLE), rowStillThere: false }]);
    expect(await exists(UNREACHABLE)).toBe(false);
  });
});
