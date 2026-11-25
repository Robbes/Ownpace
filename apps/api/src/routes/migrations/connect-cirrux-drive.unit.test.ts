// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CONNECT CIRRUX DRIVE, AT ITS TWO ROUTES (workplan 0160 T5; ADR-0052), over
 * PGlite with both chains, as `app_user`, and Cirrux faked: its API cannot be
 * reached from here, and the fake is as strict as Cirrux says it is (a code is
 * single-use and bound to its PKCE challenge, a refresh token is retired the
 * moment it is used).
 *
 * - **No client on this deployment**: the authorize door refuses, naming the
 *   variable, and begins nothing.
 * - **Only on a Cirrux destination of this organisation**: another kind, or
 *   an id that is not this organisation's, is refused.
 * - **The URL** carries the deployment's public client, the six scopes, the
 *   state, and an `S256` challenge, and no secret.
 * - **The callback stores the grant ON THE ACCOUNT**, encrypted beside the app
 *   password, with its audit line; the page carries no token; the account is
 *   measured again with the consent's own access token, so no refresh is spent
 *   and Cirrux Drive reads as connected at once.
 * - **Nothing is stored** for another issuer, Cirrux's own refusal, a state
 *   begun elsewhere, or an organisation closed since the consent began (asked
 *   before the code is exchanged).
 * - **Replacing the app password keeps the Drive** for the same mailbox, and
 *   drops it for another.
 */

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY, CIRRUX_DRIVE_SCOPES, CIRRUX_DRIVE_WORKSPACE_KEY } from '@openmig/shared';
import { FakeCirrux } from '../../../../../packages/connectors/src/__testing__/cirrux-fake.ts';

// UUID family 0160cd00-…, unused elsewhere in the repo.
const P = '0160cd00-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const OTHER_TENANT = `${P}02`;
const CIRRUX = `${P}11`;
const NEXTCLOUD = `${P}12`;
const THEIRS = `${P}13`;
const APP_PASSWORD = { username: 'anna@example.com', password: 'app-password-1' };

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'anna', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

vi.hoisted(() => {
  // The API refuses to make its producer without a jobs URL (__testing__/a-queue-stand-in.ts).
  process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
});
vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) => {
  const { aQueueStandIn, aRunId } = await import('../../__testing__/a-queue-stand-in.ts');
  return aQueueStandIn(await importOriginal(), () => aRunId(1));
});

// The app password's own faces reach IMAP and DAV servers, which are not this
// file's subject: the headline probe passes, and the qualification measures
// the Drive face for real, through what the route hands it, and nothing else.
const { measured } = vi.hoisted(() => ({ measured: [] as Array<{ kind: string; reach: boolean }> }));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeTargetConnection: vi.fn(async () => ({ ok: true })),
    probeSourceConnection: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  const unasked = { answer: 'unknown' as const, reason: 'notAskable' as const, detail: 'not this file’s subject' };
  return {
    ...actual,
    qualifyAccount: vi.fn(
      async (kind: string, _config: Record<string, unknown>, creds: Record<string, string>, deps: Parameters<typeof actual.qualifyCirruxDrive>[1] = {}) => {
        measured.push({ kind, reach: deps.cirruxDrive !== undefined });
        return {
          domains: {
            mail: unasked,
            calendar: unasked,
            contact: unasked,
            task: unasked,
            file: await actual.qualifyCirruxDrive(creds, deps),
          },
        };
      },
    ),
  };
});

const { default: migrationRoutes } = await import('./index.ts');
const { default: connectionRoutes } = await import('../connections.ts');

const app = express();
app.use(helmet());
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/connections', connectionRoutes);

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
async function storedFileFace(): Promise<{ answer?: string; reason?: string; detail?: string } | undefined> {
  const [row] = await rows<{ qualification: { domains?: { file?: { answer?: string; reason?: string; detail?: string } } } | null }>(
    'SELECT qualification FROM connection WHERE id = $1',
    [CIRRUX],
  );
  return row?.qualification?.domains?.file;
}
const auditLines = async () =>
  rows<{ action: string; actor: string; detail: Record<string, unknown> }>(
    `SELECT action, actor, detail FROM audit_log WHERE tenant_id = $1 AND action = 'connection.cirrux_drive_connected'`,
    [TENANT],
  );

const authorize = (body: Record<string, unknown>) => request(app).post('/api/migrations/cirrux/authorize').send(body);

/** Begin a consent and play Cirrux's consent screen: the code, bound to the URL's challenge. */
async function consented(cirrux: FakeCirrux): Promise<{ state: string; code: string; url: URL }> {
  const begun = await authorize({ connectionId: CIRRUX });
  expect(begun.status).toBe(200);
  const url = new URL(begun.body.url);
  const code = cirrux.issueCode({
    challenge: url.searchParams.get('code_challenge')!,
    redirectUri: url.searchParams.get('redirect_uri')!,
  });
  return { state: url.searchParams.get('state')!, code, url };
}

const callback = (query: Record<string, string>) =>
  request(app).get(`/api/migrations/cirrux/callback?${new URLSearchParams(query).toString()}`);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2), ($3, $4)', [TENANT, 'Anna thuis', OTHER_TENANT, 'theirs']);
}, 120_000);

let cirrux: FakeCirrux;

beforeEach(async () => {
  process.env.API_URL = 'https://app.example.test';
  process.env.WEB_URL = 'https://app.example.test';
  process.env.CIRRUX_OAUTH_CLIENT_ID = 'the-deployment-client';
  measured.length = 0;
  cirrux = new FakeCirrux({ refreshToken: 'none-yet' });
  cirrux.liveRefresh = undefined;
  vi.stubGlobal('fetch', cirrux.fetch);
  await sql(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
  await sql('DELETE FROM tenant_closure WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM connection WHERE id IN ($1, $2, $3)', [CIRRUX, NEXTCLOUD, THEIRS]);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'target', 'cirrux', 'Cirrux', '{}'::jsonb, 'connected', $3),
            ($4, $2, 'target', 'nextcloud', 'Nextcloud', '{}'::jsonb, 'connected', $3),
            ($5, $6, 'target', 'cirrux', 'Theirs', '{}'::jsonb, 'connected', $3)`,
    [CIRRUX, TENANT, sealed(APP_PASSWORD), NEXTCLOUD, THEIRS, OTHER_TENANT],
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CIRRUX_OAUTH_CLIENT_ID;
});

describe('the authorize door', () => {
  it('on a deployment with no Cirrux client: refused, naming the variable, and nothing begun', async () => {
    delete process.env.CIRRUX_OAUTH_CLIENT_ID;
    const res = await authorize({ connectionId: CIRRUX });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_cirrux_client');
    expect(res.body.reason).toContain('CIRRUX_OAUTH_CLIENT_ID');
    expect(res.body).not.toHaveProperty('url');
  });

  it('only on a Cirrux destination of this organisation', async () => {
    for (const connectionId of [NEXTCLOUD, THEIRS, `${P}99`]) {
      const res = await authorize({ connectionId });
      expect(res.status, connectionId).toBe(404);
      expect(res.body.error).toBe('not_a_cirrux_account');
    }
    expect((await authorize({})).status).toBe(400);
  });

  it('the URL: the deployment’s public client, the six scopes, the state and an S256 challenge, and no secret', async () => {
    const res = await authorize({ connectionId: CIRRUX, locale: 'nl' });
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe('https://api.cirrux.co/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('the-deployment-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/api/migrations/cirrux/callback');
    expect(res.body.redirectUri).toBe('https://app.example.test/api/migrations/cirrux/callback');
    expect(url.searchParams.get('scope')).toBe(CIRRUX_DRIVE_SCOPES.join(' '));
    expect(url.searchParams.get('scope')).toBe('user.profile workspace.read drive.read drive.create drive.update drive.delete');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toBeTruthy();
    // Cirrux says not to send these: `resource` binds MCP tokens, and a refresh token comes without asking.
    expect(url.searchParams.has('resource')).toBe(false);
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(url.searchParams.get('scope')).not.toContain('offline_access');
  });

  it('a closed organisation begins nothing', async () => {
    await sql(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [TENANT]);
    await sql(`INSERT INTO tenant_closure (tenant_id, closed_at, purge_after) VALUES ($1, now(), now() + interval '30 days')`, [TENANT]);
    const res = await authorize({ connectionId: CIRRUX });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('account_closed');
  });
});

describe('the callback', () => {
  it('stores the grant on the account, encrypted beside the app password, with its audit line, and hands the page no token', async () => {
    const { state, code } = await consented(cirrux);
    const res = await callback({ state, code, iss: 'https://api.cirrux.co' });
    expect(res.status).toBe(200);

    const creds = await storedCreds();
    // With the workspace it reached, which every later grant must reach too (workplan 0174 §4.4).
    expect(creds).toEqual({
      ...APP_PASSWORD,
      [CIRRUX_DRIVE_GRANT_KEY]: cirrux.liveRefresh,
      [CIRRUX_DRIVE_WORKSPACE_KEY]: cirrux.workspaceUuid,
    });
    expect(await rawSecretRef()).not.toContain(cirrux.liveRefresh!);
    // The page tells the opener the Drive is connected, and carries no token.
    expect(res.text).toContain('ownpace-cirrux-drive');
    expect(res.text).not.toContain(cirrux.liveRefresh!);
    expect(res.text).not.toMatch(/at-[0-9a-f]{12}/);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'sha256-/);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');

    const lines = await auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actor: 'anna', detail: { connectionId: CIRRUX, kind: 'cirrux' } });
    expect(JSON.stringify(lines[0])).not.toContain(cirrux.liveRefresh!);
  });

  it('measures the account again with the consent’s own access token: the Drive reads connected, and no refresh was spent', async () => {
    expect((await storedFileFace())?.answer).toBeUndefined();
    const { state, code } = await consented(cirrux);
    await callback({ state, code });
    expect(measured).toEqual([{ kind: 'cirrux', reach: true }]);
    const face = await storedFileFace();
    expect(face?.answer).toBe('yes');
    expect(face?.detail).toContain('Cirrux Drive connected as ada, in the workspace Test Workspace');
    expect(cirrux.presented, 'a refresh was spent measuring a grant minted a second ago').toEqual([]);
    expect(cirrux.signedOut).toBe(false);
  });

  it('a Test afterwards refreshes, writes the successor back, and signs nobody out', async () => {
    const { state, code } = await consented(cirrux);
    await callback({ state, code });
    const first = (await storedCreds())[CIRRUX_DRIVE_GRANT_KEY];
    const res = await request(app).post(`/api/connections/${CIRRUX}/test`).send({});
    expect(res.status).toBe(200);
    expect(res.body.qualification?.domains?.file?.answer).toBe('yes');
    expect(cirrux.presented).toEqual([first]);
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe(cirrux.liveRefresh);
    expect(cirrux.liveRefresh).not.toBe(first);
    expect(cirrux.signedOut).toBe(false);
  });

  it('another issuer is refused before the code is exchanged; nothing stored', async () => {
    const { state, code } = await consented(cirrux);
    const res = await callback({ state, code, iss: 'https://login.example.invalid' });
    expect(res.status).toBe(400);
    expect(cirrux.exchangedCodes).toEqual([]);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('Cirrux’s own refusal is shown in its words; nothing is exchanged or stored', async () => {
    const { state } = await consented(cirrux);
    const res = await callback({ state, error: 'access_denied', error_description: 'The user said no.' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('access_denied');
    expect(cirrux.exchangedCodes).toEqual([]);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('a code Cirrux refuses stores nothing, and a state is spent once', async () => {
    const { state } = await consented(cirrux);
    const res = await callback({ state, code: 'a-code-cirrux-never-issued' });
    expect(res.status).toBe(400);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
    const again = await callback({ state, code: 'a-code-cirrux-never-issued' });
    expect(again.status).toBe(400);
    expect(again.text).toContain('This sign-in cannot be finished');
  });

  it('a grant short of what a migration needs is refused by name; nothing stored', async () => {
    cirrux.grantedScope = 'user.profile workspace.read drive.read';
    const { state, code } = await consented(cirrux);
    const res = await callback({ state, code });
    expect(res.status).toBe(400);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('a state begun at another door is not one this callback ends', async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'dbx-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'dbx-secret';
    try {
      const dropbox = await request(app).post('/api/migrations/dropbox/authorize').send({});
      const state = new URL(dropbox.body.url).searchParams.get('state')!;
      const res = await callback({ state, code: 'whatever' });
      expect(res.status).toBe(400);
      expect(res.text).toContain('This sign-in cannot be finished');
      expect(await storedCreds()).toEqual(APP_PASSWORD);
    } finally {
      delete process.env.DROPBOX_OAUTH_CLIENT_ID;
      delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
    }
  });

  it('an organisation closed after the consent began: refused before the code is exchanged, nothing stored', async () => {
    const { state, code } = await consented(cirrux);
    await sql(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [TENANT]);
    await sql(`INSERT INTO tenant_closure (tenant_id, closed_at, purge_after) VALUES ($1, now(), now() + interval '30 days')`, [TENANT]);
    const res = await callback({ state, code });
    expect(res.status).toBe(409);
    expect(res.text).toContain('This organisation was closed');
    expect(cirrux.exchangedCodes).toEqual([]);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
    expect(await auditLines()).toEqual([]);
  });

  it('the account deleted while the person was at Cirrux: nothing stored, and the page says so', async () => {
    const { state, code } = await consented(cirrux);
    await sql('DELETE FROM connection WHERE id = $1', [CIRRUX]);
    const res = await callback({ state, code });
    expect(res.status).toBe(400);
    expect(res.text).toContain('is not on your Accounts page any more');
    expect(await auditLines()).toEqual([]);
  });
});

describe('the app password beside the Drive', () => {
  it('a new app password for the same mailbox keeps the Drive; another mailbox’s does not', async () => {
    const { state, code } = await consented(cirrux);
    await callback({ state, code });
    const same = await request(app)
      .put(`/api/connections/${CIRRUX}/credentials`)
      .send({ values: { host: 'api.cirrux.co', port: '443', username: 'Anna@Example.com', password: 'app-password-2' } });
    expect(same.status).toBe(200);
    expect(same.body.rotated).toBe(true);
    const kept = await storedCreds();
    expect(kept.password).toBe('app-password-2');
    // Kept, and refreshed by the re-measure that follows a rotation: the one Cirrux holds as live.
    expect(kept[CIRRUX_DRIVE_GRANT_KEY]).toBe(cirrux.liveRefresh);
    expect(cirrux.signedOut).toBe(false);

    const other = await request(app)
      .put(`/api/connections/${CIRRUX}/credentials`)
      .send({ values: { host: 'api.cirrux.co', port: '443', username: 'bob@example.com', password: 'app-password-3' } });
    expect(other.status).toBe(200);
    const dropped = await storedCreds();
    expect(dropped).toEqual({ username: 'bob@example.com', password: 'app-password-3' });
    expect(other.body.qualification?.domains?.file).toMatchObject({ answer: 'no', reason: 'notGranted' });
  });
});

describe('a migration into the Drive', () => {
  let created = 0;
  /** Dropbox files into the stored Cirrux account, on a deployment that carries the Dropbox app. */
  const files = () => {
    created += 1;
    return {
      name: `Anna’s files ${created}`,
      sourceType: 'dropbox',
      targetType: 'cirrux',
      targetConnectionId: CIRRUX,
      sourceConfig: { username: `anna-${created}@example.com`, refreshToken: 'dbx-refresh' },
      targetConfig: { username: 'anna@example.com', password: '' },
      syncConfig: { domains: ['file'] },
    };
  };

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

  it('is refused while the account stores no Drive grant, in the sentence that names the button', async () => {
    const res = await request(app).post('/api/migrations').send(files());
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Connect Cirrux Drive');
    const [n] = await rows<{ n: string | number }>('SELECT count(*) AS n FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
    expect(Number(n!.n)).toBe(0);
  });

  it('is created once the Drive is connected on that account', async () => {
    const { state, code } = await consented(cirrux);
    await callback({ state, code });
    const res = await request(app).post('/api/migrations').send(files());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
