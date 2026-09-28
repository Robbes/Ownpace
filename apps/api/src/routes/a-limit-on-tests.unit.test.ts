// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIMIT ON TESTS (workplan 0136 T3).
 *
 * Five doors connect to an address a member typed, and nothing counted the
 * calls: a script could try names and ports as fast as the API answered. One
 * refusing limit now covers the five, per member (`probe-limit.ts`).
 *
 * WHAT THIS HOLDS, through the real doors with the probe stubbed:
 *
 * - sixty tests in an hour pass, and the sixty-first is refused with 429,
 *   `too_many_tests` and a `Retry-After`, before it connects to anything;
 * - the five doors share the one count;
 * - it is per member: another member of the same organisation still tests;
 * - a request refused for its shape connects to nothing, and costs nothing;
 * - an hour later, the member tests again.
 *
 * It fails without the limiter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const h = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  /** The organisation each of the report's target lookups was asked in (0138 T6). */
  targetAskedIn: [] as unknown[],
}));

// The organisation is open here. Whether a closed one is refused is
// `an-organisation-closed-at-every-door.unit.test.ts`'s subject, and this file
// has no organisation to read (workplan 0085 T2).
vi.mock('../closed-organisation.ts', () => ({
  refusedAsClosed: async () => false,
  closedOrganisation: async () => null,
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  const { Pool } = await import('pg');
  return {
    ...actual,
    // The member is whoever the request says, so a case can be two people.
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: req.header('x-member') ?? 'a-member', userRole: 'owner' });
      next();
    },
    withTenantDb: vi.fn(async () => [h.row]),
    // The permission report runs its reads on it, inside `withTenant` (0138 T6).
    getDbPool: () => new Pool(),
  };
});

vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      // What `withTenant` sets on this client: `app.current_tenant`, for one
      // transaction. The stored target answers in its own organisation only,
      // as row security would.
      let tenant: unknown;
      return {
        async query(q: string | { text: string }, values: readonly unknown[] = []) {
          const text = typeof q === 'string' ? q : q.text;
          if (text.includes("set_config('app.current_tenant'")) tenant = values[0];
          if (!text.includes("role = 'target'")) return { rows: [] };
          h.targetAskedIn.push(tenant);
          return tenant === h.row.tenantId
            ? { rows: [{ kind: h.row.kind, config: h.row.config, secret_ref: h.row.secretRef }] }
            : { rows: [] };
        },
        release() {},
      };
    }
    async end() {}
  },
}));

// Nothing here connects anywhere: the probe answers at once, and counts.
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const refused = async () => ({ ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } });
  return { ...actual, probeSourceConnection: vi.fn(refused), probeTargetConnection: vi.fn(refused) };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const probe = await import('@openmig/orchestration/probe-connection');
const { PROBE_TEST_LIMIT, resetProbeTestLimit } = await import('../probe-limit.ts');
const { default: connectionRoutes } = await import('./connections.ts');
const { default: migrationRoutes } = await import('./migrations/index.ts');
const { default: permissionRoutes } = await import('./permissions.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);
app.use('/api/migrations', migrationRoutes);
app.use('/api/permissions', permissionRoutes);

const CREDS = { username: 'u', password: 'p' };
const URL_TYPED = 'https://cloud.example.test/remote.php/dav/';

/** One test through each door (the Test door on both sides), by `member`. */
const DOORS: Record<string, (member: string) => request.Test> = {
  'the Test door': (member) =>
    request(app)
      .post('/api/migrations/test-connection')
      .set('x-member', member)
      .send({ side: 'target', targetType: 'nextcloud', targetConfig: { url: URL_TYPED, ...CREDS } }),
  'the Test door, for a source': (member) =>
    request(app)
      .post('/api/migrations/test-connection')
      .set('x-member', member)
      .send({
        side: 'source',
        sourceType: 'imap',
        sourceConfig: { host: 'imap.example.test', port: 993, useSsl: true, ...CREDS },
      }),
  'adding a connection': (member) =>
    request(app)
      .post('/api/connections')
      .set('x-member', member)
      .send({ role: 'target', type: 'nextcloud', displayName: 'ours', values: { url: URL_TYPED, ...CREDS } }),
  'testing a connection': (member) => request(app).post('/api/connections/conn-1/test').set('x-member', member).send({}),
  'replacing credentials': (member) =>
    request(app)
      .put('/api/connections/conn-1/credentials')
      .set('x-member', member)
      .send({ values: { url: URL_TYPED, ...CREDS } }),
  'the permission report': (member) =>
    request(app).get('/api/permissions/report?mailbox=someone@example.test').set('x-member', member),
};

const test = (member = 'a-member') => DOORS['the Test door']!(member);

beforeEach(() => {
  resetProbeTestLimit();
  vi.mocked(probe.probeTargetConnection).mockClear();
  h.targetAskedIn = [];
  h.row = {
    id: 'conn-1',
    tenantId: 'a-tenant',
    role: 'target',
    kind: 'nextcloud',
    displayName: 'ours',
    config: { url: URL_TYPED },
    secretRef: JSON.stringify(SecretStore.encryptCredentials(CREDS).encrypted),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a person pressing Test by hand never meets it; a script does', () => {
  it(`${PROBE_TEST_LIMIT.max} tests in an hour pass, and the next is refused before it connects`, async () => {
    for (let i = 0; i < PROBE_TEST_LIMIT.max; i++) expect((await test()).status, `test ${i + 1}`).toBe(200);
    const refused = await test();
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe('too_many_tests');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(vi.mocked(probe.probeTargetConnection)).toHaveBeenCalledTimes(PROBE_TEST_LIMIT.max);
  });

  it('the five doors share one count', async () => {
    vi.mocked(probe.probeSourceConnection).mockClear();
    const doors = Object.values(DOORS);
    for (let i = 0; i < PROBE_TEST_LIMIT.max; i++) {
      const res = await doors[i % doors.length]!('a-member');
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    for (const [door, call] of Object.entries(DOORS)) {
      expect((await call('a-member')).status, door).toBe(429);
    }
    // The report asked for the member's own organisation's target (0138 T6).
    expect(h.targetAskedIn.length, 'the report never looked up a target').toBeGreaterThan(0);
    for (const tenant of h.targetAskedIn) expect(tenant, 'the target lookup was asked outside a-tenant').toBe('a-tenant');
  });

  it('it is per member: another member of the organisation still tests', async () => {
    for (let i = 0; i < PROBE_TEST_LIMIT.max; i++) await test('a-member');
    expect((await test('a-member')).status).toBe(429);
    expect((await test('another-member')).status).toBe(200);
  });

  it('a request refused for its shape connects to nothing, and costs nothing', async () => {
    for (let i = 0; i < PROBE_TEST_LIMIT.max * 2; i++) {
      const res = await request(app).post('/api/migrations/test-connection').send({ side: 'target' });
      expect(res.status).toBe(400);
    }
    expect((await test()).status).toBe(200);
  });

  it('an hour later, the member tests again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
    for (let i = 0; i < PROBE_TEST_LIMIT.max; i++) await test();
    expect((await test()).status).toBe(429);
    vi.setSystemTime(new Date('2026-09-27T11:00:01Z'));
    expect((await test()).status).toBe(200);
  });
});
