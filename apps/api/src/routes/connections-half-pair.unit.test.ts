// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CONNECTION ROUTES REFUSE HALF A GOOGLE CLIENT PAIR TOO.
 *
 * The add-form and a rotation validate through `CreateMappingBase`'s config
 * SHAPE, not through `CreateMappingSchema`'s refinement — so the create
 * door's refusal (`google-client-pair.unit.test.ts`) does not reach them, and
 * each needed the rule in its own hand. Both return before anything is probed
 * or stored, which is what makes them testable here without a database: a
 * refusal that only happened after the probe would be one that had already
 * asked Google about the wrong pair.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // The rotate route looks its row up before validating. One Gmail row, and
    // nothing else this file reaches for — a refusal past this point would
    // mean the rule fired AFTER a database write, which is the wrong place.
    withTenantDb: async () => [
      { id: 'conn-1', tenantId: 'a-tenant', role: 'source', kind: 'gmail', displayName: 'x' },
    ],
    getDbPool: () => ({}),
  };
});

// A control case has to get PAST the rule, and the next thing the add route
// does is probe the credential. No network from a unit test.
vi.mock('@openmig/orchestration/probe-connection', () => ({
  probeSourceConnection: async () => ({ ok: false, reason: 'probe stubbed' }),
  probeTargetConnection: async () => ({ ok: false, reason: 'probe stubbed' }),
}));

const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

const PAIR = {
  GOOGLE_OAUTH_CLIENT_ID: 'deployment.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
};
const WATCHED = Object.keys(PAIR) as Array<keyof typeof PAIR>;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) process.env[k] = PAIR[k];
});
afterEach(() => {
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

describe('POST /api/connections — the add-form door', () => {
  it('refuses a client id without its secret before probing or storing anything', async () => {
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'gmail',
        displayName: 'half',
        values: { username: 'someone@example.invalid', clientId: 'own.apps.googleusercontent.com' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('half_client_pair');
    expect(res.body.reason).toContain('clientId was sent without clientSecret');
    expect(res.body.reason).not.toContain('not-a-real-secret');
  });

  it('leaves a Dropbox source alone — the same three names, its own application', async () => {
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'dropbox',
        displayName: 'half',
        values: { username: 'someone@example.invalid', clientId: 'app-key' },
      });
    expect(res.body.error).not.toBe('half_client_pair');
  });

  it('has nothing to say without a deployment client', async () => {
    for (const k of WATCHED) delete process.env[k];
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'gmail',
        displayName: 'half',
        values: { username: 'someone@example.invalid', clientId: 'own.apps.googleusercontent.com' },
      });
    expect(res.body.error).not.toBe('half_client_pair');
  });
});

describe('PUT /api/connections/:id/credentials — the rotation door', () => {
  it('refuses a secret without its client id, because rotation replaces the stored pair', async () => {
    const res = await request(app)
      .put('/api/connections/conn-1/credentials')
      .send({ values: { username: 'someone@example.invalid', clientSecret: 'own-secret' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('half_client_pair');
    expect(res.body.reason).toContain('clientSecret was sent without clientId');
    expect(res.body.reason).not.toContain('own-secret');
  });
});
