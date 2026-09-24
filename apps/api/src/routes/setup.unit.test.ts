// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANAGED CHECKLIST READS WHAT THE DEPLOYMENT CARRIES (workplan 0148 T2 (b)).
 *
 * The route built the list from `setupStepsFor(side, provider)` alone, so on a
 * deployment carrying its own Dropbox app the checklist still opened on
 * *Create a Dropbox app* — beside a wizard whose button needs no app at all.
 * It passes `providerClientFacts()` now, the one fact the wizard reads over
 * `/api/provider-clients`. The appliance's route passes nothing and keeps
 * every step; that half is `provider-setup.unit.test.ts`'s.
 *
 * No database: the ledger rows are the tenant's ticks, and an empty list is
 * a checklist nobody has touched yet, which is what these cases need.
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
    withTenantDb: async () => [],
    getDbPool: () => ({}),
  };
});

const { default: setupRoutes } = await import('./setup.ts');

const app = express();
app.use(express.json());
app.use('/api/setup', setupRoutes);

const PAIR = {
  DROPBOX_OAUTH_CLIENT_ID: 'deployment-app-key',
  DROPBOX_OAUTH_CLIENT_SECRET: 'deployment-app-secret',
};
const WATCHED = Object.keys(PAIR) as Array<keyof typeof PAIR>;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) delete process.env[k];
});
afterEach(() => {
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

const keys = (body: { steps: Array<{ step: { key: string } }> }) => body.steps.map((s) => s.step.key);

describe('GET /api/setup/source/dropbox', () => {
  it("returns no create_app step where the deployment carries Dropbox's app", async () => {
    Object.assign(process.env, PAIR);
    const res = await request(app).get('/api/setup/source/dropbox');
    expect(res.status).toBe(200);
    expect(keys(res.body)).not.toContain('create_app');
    expect(res.body.steps).toEqual([]);
    // Never the values, as `/api/provider-clients` never does.
    expect(res.text).not.toContain('deployment-app');
  });

  it('keeps every step where each connection brings its own app', async () => {
    const res = await request(app).get('/api/setup/source/dropbox');
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(['create_app', 'scopes', 'redirect_uri', 'consent', 'exchange_code']);
  });

  it('refuses to record a step the deployment has left out, as it refuses any unknown step', async () => {
    Object.assign(process.env, PAIR);
    const res = await request(app)
      .put('/api/setup/source/dropbox/create_app')
      .send({ state: 'done' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_step');
  });
});
