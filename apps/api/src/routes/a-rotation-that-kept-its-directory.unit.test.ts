// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROTATION THAT KEPT ITS DIRECTORY (workplan 0153 open question 5).
 *
 * A Microsoft account made with a single-tenant registration of the person's
 * own stores that registration's tenant beside its token. Replacing the token
 * on the Accounts page offered what is required, secret or paired, which the
 * tenant is none of, and the rotation REPLACES the stored credential: so the
 * tenant went, and the next pass asked `common` for an application it could
 * not find.
 *
 * What is held, through the real rotation door with the probe stubbed (the
 * probe is handed exactly what would be stored):
 *
 * - a rotation of the same registration keeps the stored tenant;
 * - one of the deployment's registration (no pair either side) keeps it too;
 * - a different pair does not inherit it: a new registration brings its own;
 * - a tenant sent with the rotation is the one stored.
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
    // The rotation reads its row; the probe below refuses, so nothing is written.
    withTenantDb: vi.fn(async () => [h.row]),
    getDbPool: () => ({}),
  };
});

vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const refused = async () => ({ ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } });
  return { ...actual, probeSourceConnection: vi.fn(refused), probeTargetConnection: vi.fn(refused) };
});

const probe = await import('@openmig/orchestration/probe-connection');
const { resetProbeTestLimit } = await import('../probe-limit.ts');
const { default: connectionRoutes, keptTenant } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

/** A Microsoft account as stored: its token, and the registration it was granted through. */
const storedWith = (creds: Record<string, string>) => SecretStore.encryptCredentials(creds).encrypted;

/** The credential the rotation would store, as the probe was handed it. */
async function rotate(values: Record<string, string>): Promise<Record<string, string>> {
  vi.mocked(probe.probeSourceConnection).mockClear();
  const res = await request(app).put('/api/connections/conn-1/credentials').send({ values });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(vi.mocked(probe.probeSourceConnection)).toHaveBeenCalledTimes(1);
  return vi.mocked(probe.probeSourceConnection).mock.calls[0]![2] as Record<string, string>;
}

beforeEach(() => {
  resetProbeTestLimit();
  h.row = {
    id: 'conn-1',
    tenantId: 'a-tenant',
    role: 'source',
    kind: 'microsoft',
    displayName: 'Anna · Microsoft 365',
    config: { type: 'microsoft', user: 'anna@contoso.example' },
    secretRef: JSON.stringify(
      storedWith({
        refreshToken: 'the-revoked-token',
        clientId: 'own-client-id',
        clientSecret: 'own-secret',
        tenantId: 'contoso-tenant',
      }),
    ),
  };
});

describe('replacing a Microsoft account’s token keeps the directory its registration belongs to', () => {
  it('keeps the stored tenant when the same registration is rotated', async () => {
    const creds = await rotate({
      username: 'anna@contoso.example',
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
      refreshToken: 'a-new-token',
    });
    expect(creds).toMatchObject({ refreshToken: 'a-new-token', clientId: 'own-client-id', tenantId: 'contoso-tenant' });
  });

  it('keeps it for the deployment’s registration too, where neither side holds a pair', async () => {
    h.row.secretRef = JSON.stringify(storedWith({ refreshToken: 'the-revoked-token', tenantId: 'contoso-tenant' }));
    const creds = await rotate({ username: 'anna@contoso.example', refreshToken: 'a-new-token' });
    expect(creds.tenantId).toBe('contoso-tenant');
  });

  it('gives a different registration none of the old one’s directory', async () => {
    const creds = await rotate({
      username: 'anna@contoso.example',
      clientId: 'another-client-id',
      clientSecret: 'another-secret',
      refreshToken: 'a-new-token',
    });
    expect(creds).not.toHaveProperty('tenantId');
  });

  it('stores the tenant sent with the rotation, where one is', async () => {
    const creds = await rotate({
      username: 'anna@contoso.example',
      clientId: 'own-client-id',
      clientSecret: 'own-secret',
      refreshToken: 'a-new-token',
      tenantId: 'fabrikam-tenant',
    });
    expect(creds.tenantId).toBe('fabrikam-tenant');
  });
});

describe('keptTenant', () => {
  it('answers nothing where the stored credential cannot be read', () => {
    expect(keptTenant('not an encrypted credential', { refreshToken: 'x' })).toBeUndefined();
  });
});
