// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DISCONNECT CIRRUX DRIVE, AT ITS ROUTE (workplan 0160; ADR-0052), over PGlite
 * with both chains, as `app_user`, and Cirrux faked: nothing here may reach it,
 * and the fake records every request, so a test can say none was made.
 *
 * - **Signed in, or nothing**: the door sits behind `authenticate`.
 * - **Only a Cirrux destination of this organisation**: another kind, another
 *   organisation's account, an unknown id and a body without an id are
 *   refused, and nothing is changed.
 * - **The grant goes and the app password stays**: the record decrypts to
 *   exactly what it held without the Drive sign-in, and the token is nowhere
 *   in the row.
 * - **The audit line** `connection.cirrux_drive_disconnected`, once, with the
 *   actor and the account, and no token in it.
 * - **The record reads the Drive as not connected**, in the same press, so the
 *   Accounts page and *Where does it go?* stop offering it, and a migration of
 *   files into the account is refused at the create door.
 * - **Nothing is asked of Cirrux**, and the answer never says `revoked`: it
 *   says where Cirrux ends the sign-in.
 * - **This process's access token is dropped**: a provider that held one is
 *   refused at its next call, and Cirrux is not asked.
 * - **Idempotent**: a second press answers 200, `removed: false`,
 *   `no_credential`, and records nothing.
 * - **A closed organisation may disconnect**: ending access stays open after a
 *   close, as withdrawing a grant does.
 * - **So may a deployment with no Cirrux client**: ending a sign-in needs none,
 *   and the record then says why files cannot go to the account.
 */

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY } from '@openmig/shared';
import { CirruxTokenProvider } from '@openmig/connectors';
import { PgCirruxGrantStore } from '@openmig/orchestration/cirrux-grant-store';
import { FakeCirrux } from '../../../../../packages/connectors/src/__testing__/cirrux-fake.ts';

// UUID family 0160dd00-…, unused elsewhere in the repo.
const P = '0160dd00-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const OTHER_TENANT = `${P}02`;
const CIRRUX = `${P}11`;
const NEXTCLOUD = `${P}12`;
const THEIRS = `${P}13`;
const APP_PASSWORD = { username: 'the-mailbox', password: 'app-password-1' };
const GRANT = 'rt-the-drive-sign-in';

let driver: LedgerDriver;

// Signed in as the owner of TENANT, unless a press says it is not signed in:
// then the real door answers, as it does for a request with no token.
vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.headers['x-test-signed-in'] === 'no') return actual.authenticate(req, res, next);
      Object.assign(req, { tenantId: TENANT, userId: 'member-1', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) }, runs: { cancel: () => Promise.resolve() } }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function rows<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as R[];
  } finally {
    await conn.release();
  }
}
const sql = async (text: string, params: unknown[] = []): Promise<void> => void (await rows(text, params));
const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

async function storedCreds(id = CIRRUX): Promise<Record<string, string>> {
  const [row] = await rows<{ secret_ref: string }>('SELECT secret_ref FROM connection WHERE id = $1', [id]);
  return SecretStore.decryptCredentials(row!.secret_ref);
}
async function rawSecretRef(id = CIRRUX): Promise<string> {
  const [row] = await rows<{ secret_ref: string }>('SELECT secret_ref FROM connection WHERE id = $1', [id]);
  return String(row!.secret_ref);
}
async function fileFace(): Promise<{ answer?: string; reason?: string; detail?: string } | undefined> {
  const [row] = await rows<{ qualification: { domains?: { file?: { answer?: string; reason?: string; detail?: string } } } | null }>(
    'SELECT qualification FROM connection WHERE id = $1',
    [CIRRUX],
  );
  return row?.qualification?.domains?.file;
}
const auditLines = async () =>
  rows<{ action: string; actor: string; detail: Record<string, unknown> }>(
    `SELECT action, actor, detail FROM audit_log WHERE tenant_id = $1 AND action = 'connection.cirrux_drive_disconnected'`,
    [TENANT],
  );

const disconnect = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  request(app).post('/api/migrations/cirrux/disconnect').set(headers).send(body);

const unasked = { answer: 'unknown', reason: 'notAskable', detail: 'not this file’s subject' };
const CONNECTED_RECORD = {
  domains: {
    mail: { answer: 'yes', detail: 'mail' },
    calendar: unasked,
    contact: unasked,
    task: unasked,
    file: { answer: 'yes', detail: 'Cirrux Drive connected as the-login, in the workspace Test Workspace: 1 item at the top level.' },
  },
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [TENANT, 'ours', OTHER_TENANT, 'theirs']);
}, 120_000);

let cirrux: FakeCirrux;

beforeEach(async () => {
  process.env.CIRRUX_OAUTH_CLIENT_ID = 'the-deployment-client';
  cirrux = new FakeCirrux({ refreshToken: GRANT });
  vi.stubGlobal('fetch', cirrux.fetch);
  await sql(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
  await sql('DELETE FROM tenant_closure WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM connection WHERE id IN ($1, $2, $3)', [CIRRUX, NEXTCLOUD, THEIRS]);
  const granted = sealed({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: GRANT });
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref, qualification)
     VALUES ($1, $2, 'target', 'cirrux', 'Cirrux', '{}'::jsonb, 'connected', $3, $7::jsonb),
            ($4, $2, 'target', 'nextcloud', 'Nextcloud', '{}'::jsonb, 'connected', $3, NULL),
            ($5, $6, 'target', 'cirrux', 'Theirs', '{}'::jsonb, 'connected', $3, $7::jsonb)`,
    [CIRRUX, TENANT, granted, NEXTCLOUD, THEIRS, OTHER_TENANT, JSON.stringify(CONNECTED_RECORD)],
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CIRRUX_OAUTH_CLIENT_ID;
});

describe('who may press it', () => {
  it('nobody who is not signed in: the door answers 401 and nothing is changed', async () => {
    const res = await disconnect({ connectionId: CIRRUX }, { 'x-test-signed-in': 'no' });
    expect(res.status).toBe(401);
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe(GRANT);
    expect(await auditLines()).toEqual([]);
  });

  it('only on a Cirrux destination of this organisation: another kind, another organisation’s account, an unknown id', async () => {
    for (const connectionId of [NEXTCLOUD, THEIRS, `${P}99`]) {
      const res = await disconnect({ connectionId });
      expect(res.status, connectionId).toBe(404);
      expect(res.body.error).toBe('not_a_cirrux_account');
    }
    // Their account kept its sign-in; ours was never named.
    expect((await storedCreds(THEIRS))[CIRRUX_DRIVE_GRANT_KEY]).toBe(GRANT);
    expect((await storedCreds(NEXTCLOUD))[CIRRUX_DRIVE_GRANT_KEY]).toBe(GRANT);
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe(GRANT);
    expect(await auditLines()).toEqual([]);
  });

  it('a body without a Cirrux account’s id is refused', async () => {
    for (const body of [{}, { connectionId: 'not-a-uuid' }]) {
      const res = await disconnect(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    }
  });

  it('a closed organisation may disconnect: ending access stays open after a close', async () => {
    await sql(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [TENANT]);
    await sql(`INSERT INTO tenant_closure (tenant_id, closed_at, purge_after) VALUES ($1, now(), now() + interval '30 days')`, [TENANT]);
    const res = await disconnect({ connectionId: CIRRUX });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });
});

describe('what a press does', () => {
  it('removes the Drive sign-in and keeps the app password, as it was, encrypted', async () => {
    const res = await disconnect({ connectionId: CIRRUX });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ connectionId: CIRRUX, removed: true });
    expect(await storedCreds()).toEqual(APP_PASSWORD);
    expect(await rawSecretRef()).not.toContain(GRANT);
    expect(await rawSecretRef()).not.toContain(APP_PASSWORD.password);
    expect(JSON.stringify(res.body)).not.toContain(GRANT);
  });

  it('writes one audit line, with who and which account, and no token', async () => {
    await disconnect({ connectionId: CIRRUX });
    const lines = await auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actor: 'member-1', detail: { connectionId: CIRRUX, kind: 'cirrux', revocation: 'unsupported' } });
    expect(JSON.stringify(lines[0])).not.toContain(GRANT);
  });

  it('the record reads the Drive as not connected at once, naming the button', async () => {
    expect((await fileFace())?.answer).toBe('yes');
    await disconnect({ connectionId: CIRRUX });
    const face = await fileFace();
    expect(face).toMatchObject({ answer: 'no', reason: 'notGranted' });
    expect(face?.detail).toContain('Connect Cirrux Drive');
  });

  it('asks nothing of Cirrux, and says so: never revoked, and where Cirrux ends the sign-in', async () => {
    const res = await disconnect({ connectionId: CIRRUX });
    expect(cirrux.requests).toEqual([]);
    expect(cirrux.presented).toEqual([]);
    expect(cirrux.signedOut).toBe(false);
    expect(res.body.revocation.status).toBe('unsupported');
    expect(res.body.revocation.kind).toBe('cirrux');
    expect(res.body.revocation.reason).toContain('Settings → Security');
    expect(res.body.revocation.reason).toContain('30 days');
  });

  it('drops this process’s access token for the account: the next call is refused, and Cirrux is not asked', async () => {
    const tokens = new CirruxTokenProvider({
      clientId: 'the-deployment-client',
      store: new PgCirruxGrantStore({ pool: driver, tenantId: TENANT, connectionId: CIRRUX }),
      fetchImpl: cirrux.fetch,
    });
    expect(await tokens.getAccessToken()).toMatch(/^at-/);
    expect(cirrux.presented).toEqual([GRANT]);
    // The successor was written back; the disconnect takes that one off.
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe(cirrux.liveRefresh);

    expect((await disconnect({ connectionId: CIRRUX })).body.removed).toBe(true);

    await expect(tokens.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    expect(cirrux.presented).toEqual([GRANT]);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('pressed again: 200, nothing removed, nothing recorded, and the record as the first press left it', async () => {
    await disconnect({ connectionId: CIRRUX });
    const after = await rawSecretRef();
    const again = await disconnect({ connectionId: CIRRUX });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      connectionId: CIRRUX,
      removed: false,
      revocation: {
        kind: 'cirrux',
        status: 'no_credential',
        reason: 'No Cirrux Drive sign-in was stored on this account, so there was nothing to disconnect.',
      },
    });
    expect(await rawSecretRef()).toBe(after);
    expect(await auditLines()).toHaveLength(1);
  });

  it('on a deployment with no Cirrux client, a stored sign-in can still be disconnected, and the record says why', async () => {
    delete process.env.CIRRUX_OAUTH_CLIENT_ID;
    const res = await disconnect({ connectionId: CIRRUX });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
    const face = await fileFace();
    expect(face).toMatchObject({ answer: 'no', reason: 'structural' });
    expect(face?.detail).toContain('no Cirrux client on this deployment');
  });

  it('an account whose sign-in Cirrux already ended, still recorded as connected, is put right', async () => {
    await sql('UPDATE connection SET secret_ref = $1 WHERE id = $2', [sealed(APP_PASSWORD), CIRRUX]);
    const res = await disconnect({ connectionId: CIRRUX });
    expect(res.body.removed).toBe(false);
    expect((await fileFace())?.answer).toBe('no');
    expect(await auditLines()).toEqual([]);
  });
});

describe('a migration of files into the account, once disconnected', () => {
  beforeEach(() => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'dbx-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'dbx-secret';
    process.env.MAX_MIGRATIONS_PER_ORGANISATION = '50';
  });
  afterEach(() => {
    delete process.env.DROPBOX_OAUTH_CLIENT_ID;
    delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
    delete process.env.MAX_MIGRATIONS_PER_ORGANISATION;
  });

  it('is refused at the create door, in the sentence that names the button, and nothing is made', async () => {
    await disconnect({ connectionId: CIRRUX });
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'Files into the Drive',
        sourceType: 'dropbox',
        targetType: 'cirrux',
        targetConnectionId: CIRRUX,
        sourceConfig: { username: 'the-files-account', refreshToken: 'dbx-refresh' },
        targetConfig: { username: 'the-mailbox', password: '' },
        syncConfig: { domains: ['file'] },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Connect Cirrux Drive');
    const [n] = await rows<{ n: string | number }>('SELECT count(*) AS n FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
    expect(Number(n!.n)).toBe(0);
  });
});
