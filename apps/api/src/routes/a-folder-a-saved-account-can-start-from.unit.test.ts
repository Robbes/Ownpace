// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FOLDER A SAVED ACCOUNT CAN START FROM (workplan 0153 open question 5,
 * item 4; the owner, 2026-10-04: *"go with the recommendations"*).
 *
 * *Only one folder* on *Start a migration* asks for the folder once the
 * account is connected, with the wizard's *Browse…*. The wizard's browse takes
 * the credential in the request; the flow has saved the account by then, so
 * `GET /api/connections/:id/folders` reads the stored one. Through the real
 * route, with the provider's two lists stubbed, this holds:
 *
 * - a Google account lists its shared drives, then the folders shared with
 *   it, by id, with the deployment's own client where the account holds none
 *   (as a Test and a pass read it);
 * - a Drive row whose one list is refused still shows the other, and says
 *   why; both refused is a refusal;
 * - Dropbox lists its shared folders by path, and one not added to the
 *   account comes back with no value, since it has no path to start from;
 * - Box, an IMAP account and a destination list nothing, each in words;
 * - an account with no stored sign-in, or none at all, reaches no provider.
 *
 * Whether a closed organisation is refused first is
 * `an-organisation-closed-at-every-door.unit.test.ts`'s, where this door is a
 * row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

// The organisation is open here (see the header).
vi.mock('../closed-organisation.ts', () => ({
  refusedAsClosed: async () => false,
  closedOrganisation: async () => null,
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-member', userRole: 'owner' });
      next();
    },
    withTenantDb: vi.fn(async () => h.rows),
    // Handed to the two stubs above and read by neither.
    getDbPool: () => ({}),
  };
});

// Nothing here reaches Google or Dropbox: each list answers at once.
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    listGoogleSharedDrives: vi.fn(),
    listGoogleSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  };
});

const probe = await import('@openmig/orchestration/probe-connection');
const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

/** One saved account, as the route reads it. */
const account = (over: Record<string, unknown>) => ({
  id: 'conn-1',
  tenantId: 'a-tenant',
  role: 'source',
  kind: 'google',
  displayName: 'Anna · Google',
  config: { type: 'google', user: 'anna@example.test' },
  status: 'connected',
  secretRef: sealed({ refreshToken: 'a-refresh-token' }),
  ...over,
});

const folders = () => request(app).get('/api/connections/conn-1/folders');

const ENV = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };

beforeEach(() => {
  vi.mocked(probe.listGoogleSharedDrives).mockReset();
  vi.mocked(probe.listGoogleSharedFolders).mockReset();
  vi.mocked(probe.listDropboxSharedFolders).mockReset();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'deployment-client.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'deployment-secret';
});

afterEach(() => {
  for (const [key, value] of [
    ['GOOGLE_OAUTH_CLIENT_ID', ENV.id],
    ['GOOGLE_OAUTH_CLIENT_SECRET', ENV.secret],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('a Google account', () => {
  it('lists its shared drives, then the folders shared with it, with the deployment client it leans on', async () => {
    h.rows = [account({})];
    vi.mocked(probe.listGoogleSharedDrives).mockResolvedValue({ ok: true, drives: [{ id: 'd-1', name: 'Family' }] });
    vi.mocked(probe.listGoogleSharedFolders).mockResolvedValue({
      ok: true,
      folders: [{ id: 'f-1', name: 'Holiday photos', owner: 'sam@example.test' }],
    });

    const res = await folders();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      key: 'rootFolderId',
      folders: [
        { value: 'd-1', name: 'Family', kind: 'shared-drive' },
        { value: 'f-1', name: 'Holiday photos', kind: 'shared-folder', owner: 'sam@example.test' },
      ],
    });
    // The stored token, with the deployment's client filled in where the
    // account holds none: what a Test and a pass read it with.
    const sent = vi.mocked(probe.listGoogleSharedDrives).mock.calls[0]![0];
    expect(sent).toMatchObject({
      refreshToken: 'a-refresh-token',
      clientId: 'deployment-client.apps.googleusercontent.com',
      clientSecret: 'deployment-secret',
    });
    expect(vi.mocked(probe.listGoogleSharedFolders).mock.calls[0]![0]).toEqual(sent);
  });

  it('on a Drive row, shows the list that answered and says why the other did not', async () => {
    h.rows = [account({ kind: 'google_drive', config: {} })];
    vi.mocked(probe.listGoogleSharedDrives).mockResolvedValue({ ok: false, reason: 'Shared drives: insufficient scope.' });
    vi.mocked(probe.listGoogleSharedFolders).mockResolvedValue({ ok: true, folders: [{ id: 'f-2', name: 'Work' }] });

    const res = await folders();

    expect(res.body).toEqual({
      ok: true,
      key: 'rootFolderId',
      folders: [{ value: 'f-2', name: 'Work', kind: 'shared-folder' }],
      refused: 'Shared drives: insufficient scope.',
    });
  });

  it('is a refusal, in the provider’s words, where both lists are refused', async () => {
    h.rows = [account({})];
    vi.mocked(probe.listGoogleSharedDrives).mockResolvedValue({ ok: false, reason: 'Token has been revoked.' });
    vi.mocked(probe.listGoogleSharedFolders).mockResolvedValue({ ok: false, reason: 'Token has been revoked.' });

    const res = await folders();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'Token has been revoked. Token has been revoked.' });
  });
});

describe('a Dropbox account', () => {
  it('lists its shared folders by path, and one not added to the account with no path to start from', async () => {
    h.rows = [account({ kind: 'dropbox', config: {} })];
    vi.mocked(probe.listDropboxSharedFolders).mockResolvedValue({
      ok: true,
      folders: [
        { id: 'id:1', name: 'Team', path: '/Team' },
        { id: 'id:2', name: 'Not added yet' },
      ],
    });

    const res = await folders();

    expect(res.body).toEqual({
      ok: true,
      key: 'rootPath',
      folders: [
        { value: '/Team', name: 'Team', kind: 'shared-folder' },
        { name: 'Not added yet', kind: 'shared-folder' },
      ],
    });
    expect(probe.listGoogleSharedDrives).not.toHaveBeenCalled();
  });
});

describe('an account with no folders to list', () => {
  it.each([
    ['Box, whose folder is typed', { kind: 'box' }, /Box's folders are not listed here/],
    ['an IMAP account', { kind: 'imap' }, /reads the whole account/],
    ['a destination', { role: 'target', kind: 'nextcloud' }, /reads the whole account/],
  ])('%s: 400 no_folders, reaching no provider', async (_name, over, reason) => {
    h.rows = [account(over)];

    const res = await folders();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_folders');
    expect(res.body.reason).toMatch(reason);
    expect(probe.listGoogleSharedDrives).not.toHaveBeenCalled();
    expect(probe.listDropboxSharedFolders).not.toHaveBeenCalled();
  });

  it('with no stored sign-in, says so and reaches no provider', async () => {
    h.rows = [account({ secretRef: null })];

    const res = await folders();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toMatch(/no stored sign-in/);
    expect(probe.listGoogleSharedDrives).not.toHaveBeenCalled();
  });

  it('that does not exist in this organisation: 404', async () => {
    h.rows = [];

    const res = await folders();

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
