// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MAIL LOGIN KEPT ACROSS A ROTATION, AND HALF OF ONE REFUSED AT THE DOOR
 * (workplan 0161 T1).
 *
 * An `infomaniak` account stores two logins in one secret: the account's sync
 * login for calendars, contacts and tasks, and the mailbox's own for mail,
 * because Infomaniak refuses an app password for mail. *Replace credentials*
 * replaces the whole secret, so a person renewing the app password and leaving
 * the two mail boxes empty would lose the mailbox's login without a word, and
 * the next pass's mail would refuse. Half a mail login, sent to either door,
 * can sign in to nothing.
 *
 * What is held, through the real doors with the probe stubbed (the probe is
 * handed exactly what would be stored):
 *
 * - a rotation that leaves both mail boxes empty keeps the stored mail login;
 * - one that fills both stores the new one;
 * - half of one is refused naming the missing box, before anything is probed,
 *   at the rotation and at the add door, and the password is not echoed;
 * - the add door stores both logins, through `targetCredentialRecord`;
 * - a Cirrux or Soverin rotation stores exactly the pair it was sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const h = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));

vi.mock('../closed-organisation.ts', () => ({
  refusedAsClosed: async () => false,
  closedOrganisation: async () => null,
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // Every read answers the one row; the probe below refuses, so a rotation
    // writes nothing but its audit line.
    withTenantDb: vi.fn(async () => [h.row]),
    getDbPool: () => ({}),
  };
});

vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const refused = async () => ({ ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } });
  return { ...actual, probeSourceConnection: vi.fn(refused), probeTargetConnection: vi.fn(refused) };
});

// The add door measures the account after storing it; no network from a unit test.
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const probe = await import('@openmig/orchestration/probe-connection');
const { resetProbeTestLimit } = await import('../probe-limit.ts');
const { default: connectionRoutes, storedMailLogin } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

/** Obvious dummies: no real login is ever written into a test. */
const STORED = {
  username: 'AB12345',
  password: 'dummy-old-app-password',
  mailUsername: 'someone@example.com',
  mailPassword: 'dummy-mailbox-device-password',
};
const SERVERS = { host: 'sync.infomaniak.com', port: '443', mailHost: 'mail.infomaniak.com', mailPort: '993' };

const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

/** The credential a door would store, as the probe was handed it. */
function probedWith(): Record<string, string> {
  expect(vi.mocked(probe.probeTargetConnection)).toHaveBeenCalledTimes(1);
  return vi.mocked(probe.probeTargetConnection).mock.calls[0]![2] as Record<string, string>;
}

async function rotate(values: Record<string, string>) {
  return request(app).put('/api/connections/6f0c0178-0000-4000-8000-00000000c001/credentials').send({ values });
}

beforeEach(() => {
  resetProbeTestLimit();
  vi.mocked(probe.probeTargetConnection).mockClear();
  h.row = {
    id: '6f0c0178-0000-4000-8000-00000000c001',
    tenantId: 'a-tenant',
    role: 'target',
    kind: 'infomaniak',
    displayName: 'Infomaniak',
    config: { host: 'sync.infomaniak.com', port: 443, mailHost: 'mail.infomaniak.com', mailPort: 993 },
    secretRef: sealed(STORED),
  };
});

describe('Replace credentials on an Infomaniak account', () => {
  it('keeps the stored mail login when both mail boxes are left empty', async () => {
    const res = await rotate({ ...SERVERS, username: 'AB12345', password: 'dummy-new-app-password', mailUsername: '', mailPassword: '' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(probedWith()).toEqual({
      username: 'AB12345',
      password: 'dummy-new-app-password',
      mailUsername: 'someone@example.com',
      mailPassword: 'dummy-mailbox-device-password',
    });
  });

  it('keeps it too when the panel sends no mail boxes at all', async () => {
    const res = await rotate({ ...SERVERS, username: 'AB12345', password: 'dummy-new-app-password' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(probedWith().mailPassword).toBe('dummy-mailbox-device-password');
  });

  it('stores a new mail login when both boxes are filled', async () => {
    const res = await rotate({
      ...SERVERS,
      username: 'AB12345',
      password: 'dummy-new-app-password',
      mailUsername: 'other@example.com',
      mailPassword: 'dummy-new-device-password',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(probedWith()).toMatchObject({ mailUsername: 'other@example.com', mailPassword: 'dummy-new-device-password' });
  });

  it('refuses half a mail login, naming the missing box, before anything is probed', async () => {
    for (const [half, missing] of [
      [{ mailUsername: 'other@example.com' }, 'mailPassword'],
      [{ mailPassword: 'dummy-new-device-password' }, 'mailUsername'],
    ] as const) {
      vi.mocked(probe.probeTargetConnection).mockClear();
      const res = await rotate({ ...SERVERS, username: 'AB12345', password: 'dummy-new-app-password', ...half });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'missing_fields', fields: [missing] });
      expect(res.body.reason).toContain(`was sent without ${missing}`);
      expect(JSON.stringify(res.body)).not.toContain('dummy-');
      expect(vi.mocked(probe.probeTargetConnection)).not.toHaveBeenCalled();
    }
  });
});

describe('the other target kinds rotate exactly as before', () => {
  it.each(['cirrux', 'soverin'])('%s stores the pair it was sent, and nothing it was not', async (kind) => {
    h.row = { ...h.row, kind, secretRef: sealed({ username: 'someone@example.com', password: 'dummy-old', mailPassword: 'dummy-stray' }) };
    const res = await rotate({ host: 'dav.example.com', port: '443', username: 'someone@example.com', password: 'dummy-new' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(probedWith()).toEqual({ username: 'someone@example.com', password: 'dummy-new' });
  });

  it('reads no stored secret for a kind that signs in with one login', () => {
    // An unreadable secret on a Soverin row must not stop its rotation.
    expect(storedMailLogin({ id: 'x', kind: 'soverin', secretRef: 'not an encrypted credential' })).toEqual({});
    expect(storedMailLogin({ id: 'x', kind: 'infomaniak', secretRef: 'not an encrypted credential' })).toEqual({});
    expect(storedMailLogin({ id: 'x', kind: 'infomaniak', secretRef: sealed(STORED) })).toMatchObject({
      mailUsername: 'someone@example.com',
    });
  });
});

describe('Add an account: an Infomaniak destination', () => {
  const add = (values: Record<string, string>) =>
    request(app).post('/api/connections').send({ role: 'target', type: 'infomaniak', displayName: 'Infomaniak', values });

  it('refuses half a mail login before anything is probed or stored', async () => {
    const res = await add({ ...SERVERS, username: 'AB12345', password: 'dummy-app-password', mailUsername: 'someone@example.com' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_fields', fields: ['mailPassword'] });
    expect(vi.mocked(probe.probeTargetConnection)).not.toHaveBeenCalled();
  });

  it('stores both logins, the sync login beside the mailbox’s', async () => {
    await add({ ...SERVERS, ...STORED });
    expect(probedWith()).toEqual(STORED);
    // And the config it stores holds neither login.
    const config = vi.mocked(probe.probeTargetConnection).mock.calls[0]![1] as Record<string, unknown>;
    expect(config).not.toHaveProperty('mailUsername');
    expect(config).not.toHaveProperty('mailPassword');
    expect(JSON.stringify(config)).not.toContain('dummy-');
  });

  it('accepts a calendars-only account with no mail login at all', async () => {
    await add({ host: 'sync.infomaniak.com', port: '443', username: 'AB12345', password: 'dummy-app-password' });
    expect(probedWith()).toEqual({ username: 'AB12345', password: 'dummy-app-password' });
  });
});
