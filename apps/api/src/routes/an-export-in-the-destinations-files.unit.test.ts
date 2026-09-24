// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN EXPORT IN THE DESTINATION'S OWN FILES, AT THE DOORS (workplan 0148 T9, D11).
 *
 * The shared parser has read `where` since 0116 T4, and the pass, the
 * preflight and the Test all read through it. The doors did not: the create
 * door's schema had `provider` and `path` and nothing else, its builder
 * passed those two to the parser, and a reused connection's override kept
 * `path` alone. So a posted `where: 'target'` was dropped on the way in, and
 * since 0136 T5 every archive posted to the managed API was refused as a path
 * on the server — the one choice that could work there included.
 *
 * What this holds:
 *
 *  - an archive posted with `where: 'target'` and a Nextcloud destination is
 *    STORED with `where` — on the new connection's config, and on a reused
 *    connection's per-mapping override beside the path;
 *  - the Connections page's add door stores it the same way;
 *  - a JMAP destination is refused with the sentence the pass writes, and a
 *    destination with no files with one that says which have them. That rule
 *    is shared (`archiveInTargetRefusal`), and the wizard's target step reads
 *    the same function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as schema from '@openmig/ledger';
import { archiveInJmapTargetSentence, archiveInTargetRefusal } from '@openmig/shared';

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Every insert the doors make, by table. */
const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
/** What each `select` answers, in order; an empty list once the queue runs dry. */
let selects: unknown[][] = [];

/** A query that can be chained any way drizzle chains it, and awaited for `result`. */
function chain(result: unknown): Record<string, unknown> {
  const self: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, ko),
  };
  for (const method of ['from', 'where', 'returning', 'set', 'orderBy', 'limit', 'innerJoin', 'leftJoin']) {
    self[method] = () => self;
  }
  return self;
}

let nextId = 0;
const fakeDb = {
  select: () => chain(selects.shift() ?? []),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      const now = new Date();
      nextId += 1;
      return chain([
        {
          id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
          status: 'paused',
          mode: 'mirror',
          createdAt: now,
          updatedAt: now,
          ...values,
        },
      ]);
    },
  }),
  update: () => chain([]),
  delete: () => chain([]),
};

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // RUNS the door's callback against the recording database above, so what
    // the door would write is what the test reads.
    withTenantDb: vi.fn(async (_t: unknown, _p: unknown, fn: (db: unknown) => unknown) => fn(fakeDb)),
    getDbPool: () => ({}),
  };
});

// Nothing here may reach a network or a disk: the probe answers as the real
// one does for an export in the destination, and the reader is never built.
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: vi.fn(async () => ({
      ok: false,
      reason: 'counted at the preflight',
      outcome: { code: 'countedAtPreflight' },
    })),
    probeTargetConnection: vi.fn(async () => ({ ok: true, detail: 'stubbed' })),
  };
});
vi.mock('@openmig/orchestration/archive-source-factory', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@openmig/orchestration/archive-source-factory')>();
  return { ...actual, archiveReaderForLocation: vi.fn(() => undefined) };
});

const { default: connectionRoutes } = await import('./connections.ts');
const { default: migrationRoutes, sourceConfigOverride, sourceConnectionConfig } = await import(
  './migrations/index.ts'
);

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);
app.use('/api/migrations', migrationRoutes);

const FOLDER = 'Exports/takeout-20260904';
const NEXTCLOUD = {
  url: 'https://cloud.example.invalid/remote.php/dav',
  username: 'someone',
  password: 'x',
  useSsl: true,
};
const HOSTED = { host: 'mail.example.invalid', port: 993, username: 'someone', password: 'x', useSsl: true };

/** A migration from an export in the destination's files, as the wizard posts it. */
function mapping(targetType: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'photos out of Google',
    sourceType: 'archive',
    targetType,
    sourceConfig: { username: '', provider: 'google-takeout', path: FOLDER, where: 'target' },
    targetConfig: targetType === 'nextcloud' || targetType === 'webdav' ? NEXTCLOUD : HOSTED,
    syncConfig: { domains: ['file'] },
    ...extra,
  };
}

const insertedInto = (table: unknown) => inserts.filter((i) => i.table === table).map((i) => i.values);

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  selects = [];
});

describe('POST /api/migrations — an export in a Nextcloud destination', () => {
  it('is accepted and stored with `where` on the new connection', async () => {
    const res = await request(app).post('/api/migrations').send(mapping('nextcloud'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const source = insertedInto(schema.connection).find((c) => c['role'] === 'source');
    expect(source?.['config']).toEqual({
      type: 'archive',
      provider: 'google-takeout',
      path: FOLDER,
      where: 'target',
    });
  });

  it('a REUSED connection’s override keeps `where` beside the path', async () => {
    // The second export of a series names its own place (0116 §5).
    selects = [[{ id: 'conn-archive', role: 'source', kind: 'archive', qualification: null }]];
    const body = mapping('nextcloud', { sourceConnectionId: '11111111-1111-4111-8111-111111111111' });
    body.sourceConfig = { ...body.sourceConfig, provider: '' };
    const res = await request(app).post('/api/migrations').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [stored] = insertedInto(schema.mailboxMapping);
    expect(stored?.['sourceConfigOverride']).toEqual({ path: FOLDER, where: 'target' });
  });
});

describe('POST /api/migrations — a destination the export cannot be read from', () => {
  it('refuses a JMAP destination with the sentence the pass writes', async () => {
    const res = await request(app).post('/api/migrations').send(mapping('jmap'));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toContain(archiveInJmapTargetSentence('jmap'));
    expect(insertedInto(schema.connection), 'a refused migration was written').toEqual([]);
  });

  it.each(['imap', 'soverin', 'caldav'])('refuses a %s destination, which has no files', async (type) => {
    const res = await request(app).post('/api/migrations').send(mapping(type));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toContain(archiveInTargetRefusal(type as never)!);
    const paths = (res.body.details as Array<{ path: string[] }>).map((d) => d.path.join('.'));
    expect(paths).toContain('targetType');
  });

  it('refuses a `where` it does not know, by name', async () => {
    const body = mapping('nextcloud');
    body.sourceConfig = { ...body.sourceConfig, where: 'cloud' };
    const res = await request(app).post('/api/migrations').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toMatch(/target/);
    expect(res.body.message).toMatch(/disk/);
  });
});

describe('POST /api/connections — the Connections page’s add door', () => {
  it('stores an archive with `where: "target"` and answers that it is counted at the preflight', async () => {
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'archive',
        displayName: 'my photos',
        values: { provider: 'google-takeout', path: FOLDER, where: 'target' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [stored] = insertedInto(schema.connection);
    expect(stored?.['config']).toEqual({
      type: 'archive',
      provider: 'google-takeout',
      path: FOLDER,
      where: 'target',
    });
    expect(res.body.outcome).toEqual({ code: 'countedAtPreflight' });
  });
});

describe('the builders the doors share', () => {
  const half = {
    sourceType: 'archive',
    sourceConfig: { username: '', useSsl: true, provider: 'google-takeout', path: FOLDER, where: 'target' },
  } as never;

  it('the connection config carries `where`', () => {
    expect(sourceConnectionConfig(half)).toMatchObject({ where: 'target' });
  });

  it('the per-mapping override carries `where` beside `path`, and still never `provider`', () => {
    expect(sourceConfigOverride(half)).toEqual({ path: FOLDER, where: 'target' });
  });
});
