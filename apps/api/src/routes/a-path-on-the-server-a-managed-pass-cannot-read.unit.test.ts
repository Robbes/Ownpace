// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PATH ON THE SERVER, WHICH A MANAGED PASS CANNOT READ (workplan 0136 T5).
 *
 * The export archive's credential is a location (0116 T1), and until this task
 * every location the managed API stored was `disk`: the doors drop a posted
 * `where`, and a config without one means "a path on the machine running the
 * pass". On the appliance that is the person's own machine. On managed it is
 * ours. A managed run container has no shared volume, so the pass could never
 * read the export, but the Test did not need a pass: the connection doors
 * probed and qualified the typed path INSIDE THE API PROCESS. A tester could
 * type `/etc` or `/app` and learn what the API container holds: whether a
 * path exists, whether it is a file or a folder, and a walk of any folder
 * (0136 §1, *The archive path on managed*; §4, *The API container's own
 * disk*).
 *
 * The owner kept the archive card on managed, labelled experimental (0148
 * D10), so the form stays reachable and this refusal is what stands between
 * the form and the API's disk. The export's place on managed is a folder of
 * the Nextcloud or WebDAV files the migration writes to (0148 D11), and the
 * sentence says so.
 *
 * WHAT THIS HOLDS, door by door: an archive whose `where` is absent or `disk`
 * is refused with that sentence, and neither the probe, the qualifier nor the
 * reader behind them is ever called — so nothing opens the path. The spies are
 * proved live by a control that does reach the probe, and a stored archive in
 * the destination's files (`where: 'target'`, what 0148 T9 stores) is not
 * refused, so the rule is the location and not the kind.
 *
 * Since 0148 T9 the doors keep a posted `where`, so `where: 'target'` passes
 * this refusal at every door; what the create door then asks of the
 * destination is `an-export-in-the-destinations-files.unit.test.ts`'s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';

// The doors encrypt what they store, even an empty credential record.
process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** The stored row the connection doors look up; each case sets its own. */
let storedRow: Record<string, unknown> = {};

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // Every database call answers with the stored row: a lookup finds it, an
    // insert's `.returning({ id })` is satisfied by it. Counted, so a refused
    // create can be shown to have written nothing.
    withTenantDb: vi.fn(async () => [storedRow]),
    getDbPool: () => ({}),
  };
});

// THE PROBE, stubbed: a door that reaches it has already let the path through.
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: vi.fn(async () => ({ ok: false, reason: 'probe stubbed' })),
    probeTargetConnection: vi.fn(async () => ({ ok: false, reason: 'probe stubbed' })),
  };
});

// THE QUALIFIER, watched but real: it is the other thing that opens the path.
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyArchive: vi.fn(actual.qualifyArchive) };
});

// AND THE READER BEHIND BOTH, which is where a path is actually opened. It
// answers "no reader" so that nothing here ever touches this machine's disk,
// whatever the code under test does.
vi.mock('@openmig/orchestration/archive-source-factory', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@openmig/orchestration/archive-source-factory')>();
  return { ...actual, archiveReaderForLocation: vi.fn(() => undefined) };
});

const auth = await import('../middleware/auth.ts');
const probe = await import('@openmig/orchestration/probe-connection');
const qualification = await import('@openmig/orchestration/account-qualification');
const factory = await import('@openmig/orchestration/archive-source-factory');
const { default: connectionRoutes } = await import('./connections.ts');
const { default: migrationRoutes } = await import('./migrations/index.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);
app.use('/api/migrations', migrationRoutes);

const PATH = '/srv/exports/takeout-20260904';
const ARCHIVE_ROW = {
  id: 'conn-1',
  tenantId: 'a-tenant',
  role: 'source',
  kind: 'archive',
  displayName: 'an export',
  config: { type: 'archive', provider: 'google-takeout', path: PATH },
  // What the doors really store for an archive: an encrypted EMPTY record.
  secretRef: JSON.stringify(SecretStore.encryptCredentials({}).encrypted),
};

const TARGET = {
  host: 'cloud.example.invalid',
  port: 443,
  username: 'someone@example.invalid',
  password: 'x',
  useSsl: true,
};

/** A migration from an archive, as the wizard posts it; `over` goes in its sourceConfig. */
function mapping(over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    name: 'photos out of Google',
    sourceType: 'archive',
    targetType: 'webdav',
    sourceConfig: { username: '', provider: 'google-takeout', path: PATH, ...over },
    targetConfig: TARGET,
    syncConfig: { domains: ['file'] },
    ...extra,
  };
}

/** Nothing that could open the path was reached. */
function nothingOpened(): void {
  expect(
    vi.mocked(probe.probeSourceConnection),
    'the archive was PROBED — the API opened the typed path on its own disk',
  ).not.toHaveBeenCalled();
  expect(
    vi.mocked(qualification.qualifyArchive),
    'the archive was QUALIFIED — the API walked the typed path on its own disk',
  ).not.toHaveBeenCalled();
  expect(vi.mocked(factory.archiveReaderForLocation), 'a reader was asked for').not.toHaveBeenCalled();
}

/** The refusal, by its stable code and the two things its sentence must say. */
function refused(res: request.Response, status: number): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error).toBe('archive_on_server');
  expect(res.body.reason).toContain('cannot read a file on the server');
  expect(res.body.reason).toMatch(/folder of the Nextcloud or WebDAV files the migration writes to/);
}

beforeEach(() => {
  vi.clearAllMocks();
  storedRow = { ...ARCHIVE_ROW };
});

describe('POST /api/connections — the add door', () => {
  it.each([
    ['with no `where`', {}],
    ['with `where: "disk"` said out loud', { where: 'disk' }],
  ])('refuses an archive %s, before anything probes or stores it', async (_, over) => {
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'archive',
        displayName: 'an export',
        values: { provider: 'google-takeout', path: PATH, ...over },
      });
    refused(res, 400);
    nothingOpened();
    expect(vi.mocked(auth.withTenantDb), 'a refused archive was stored').not.toHaveBeenCalled();
  });

  it('still probes a source that is not an archive — the spies are live', async () => {
    // THE CONTROL. Without it, a probe spy that could not be called would
    // make every `not.toHaveBeenCalled` above pass having proved nothing.
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'imap',
        displayName: 'a mailbox',
        values: { host: 'mail.example.invalid', port: '993', username: 'a', password: 'x' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(vi.mocked(probe.probeSourceConnection)).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/migrations/test-connection — the wizard’s Test', () => {
  it.each([
    ['with no `where`', {}],
    ['with `where: "disk"` said out loud', { where: 'disk' }],
  ])('refuses an archive %s, and probes nothing', async (_, over) => {
    const res = await request(app)
      .post('/api/migrations/test-connection')
      .send({ side: 'source', sourceType: 'archive', sourceConfig: mapping(over).sourceConfig });
    refused(res, 400);
    nothingOpened();
  });
});

describe('POST /api/migrations — the create door', () => {
  it.each([
    ['with no `where`', {}],
    ['with `where: "disk"` said out loud', { where: 'disk' }],
  ])('refuses a new archive connection %s, and stores nothing', async (_, over) => {
    const res = await request(app).post('/api/migrations').send(mapping(over));
    refused(res, 400);
    // This door's documented 400 is the `Error` shape, which carries `message`.
    expect(res.body.message).toBe(res.body.reason);
    nothingOpened();
    expect(vi.mocked(auth.withTenantDb), 'a refused migration was written').not.toHaveBeenCalled();
  });

  it('refuses a REUSED archive connection pointed at a path, and stores nothing', async () => {
    // The second migration of an export series: the connection is reused and
    // this mapping names the next export's path in its override (0116 §5).
    // The override is WHERE this migration reads, so it is judged the same way.
    const res = await request(app)
      .post('/api/migrations')
      .send(
        mapping(
          { provider: '' },
          { sourceConnectionId: '11111111-1111-4111-8111-111111111111' },
        ),
      );
    refused(res, 400);
    nothingOpened();
    // REWRITTEN ON PURPOSE by 0148 T9's review: this asked that the door touch
    // no database at all. The door now READS the stored row first, because
    // the pass reads the row with the override laid over it, and an override
    // with no `where` is in whatever store the row is in. So there is one
    // call, and run against a database that can only be read, it reads the
    // row's config and nothing else — a write would throw here.
    expect(vi.mocked(auth.withTenantDb), 'a refused migration was written').toHaveBeenCalledTimes(1);
    const selected: unknown[] = [];
    const readOnly = {
      select: (columns: unknown) => {
        selected.push(columns);
        const query = { from: () => query, where: async () => [] };
        return query;
      },
    };
    const [lookup] = vi.mocked(auth.withTenantDb).mock.calls;
    await (lookup![2] as (db: unknown) => Promise<unknown>)(readOnly);
    expect(selected.map((c) => Object.keys(c as object))).toEqual([['config']]);
  });
});

/**
 * What the stored-row Test wrote after the lookup: the `.set(...)` of each
 * later `withTenantDb` call, run against a stand-in that records it. The mock
 * above answers without running the callback, so this runs it here.
 */
async function statusWritesAfterLookup(): Promise<Array<Record<string, unknown>>> {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  for (const call of vi.mocked(auth.withTenantDb).mock.calls.slice(1)) {
    await (call[2] as (d: unknown) => Promise<unknown>)(db);
  }
  return sets;
}

describe('a STORED archive connection — the Connections page', () => {
  it('refuses to test one whose path is on the server, and says so on its card', async () => {
    const res = await request(app).post('/api/connections/conn-1/test');
    refused(res, 409);
    nothingOpened();
    // The page re-reads the row after every Test so that the card cannot
    // contradict the answer. A row stored before the refusal was often
    // `connected`; left alone it would stay green beside "cannot read".
    const writes = await statusWritesAfterLookup();
    expect(writes, 'the refused row kept its old status').toHaveLength(1);
    expect(writes[0]?.['status']).toBe('error');
  });

  it('refuses to rotate one, since rotating probes the stored path first, and writes nothing', async () => {
    const res = await request(app)
      .put('/api/connections/conn-1/credentials')
      .send({ values: { provider: 'google-takeout', path: PATH } });
    refused(res, 409);
    nothingOpened();
    expect(vi.mocked(auth.withTenantDb), 'a refused rotation wrote to the row').toHaveBeenCalledTimes(1);
  });

  it('refuses a stored `where: "disk"` the same way', async () => {
    storedRow = { ...ARCHIVE_ROW, config: { ...ARCHIVE_ROW.config, where: 'disk' } };
    const res = await request(app).post('/api/connections/conn-1/test');
    refused(res, 409);
    nothingOpened();
  });

  it('does not refuse an export in the destination’s files — the rule is the location', async () => {
    // What 0148 T9 stores. Its Test answers that the contents are counted at
    // the preflight; the point here is only that it is not THIS refusal.
    storedRow = { ...ARCHIVE_ROW, config: { ...ARCHIVE_ROW.config, where: 'target' } };
    const res = await request(app).post('/api/connections/conn-1/test');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(vi.mocked(probe.probeSourceConnection)).toHaveBeenCalledTimes(1);
  });
});

describe('the one rule every door calls', async () => {
  const { archiveOnServerRefusal } = await import('./archive-on-the-server.ts');

  it('refuses an archive whose location says nothing, says disk, or says something unknown', () => {
    for (const location of [undefined, null, {}, { where: 'disk' }, { where: 'Target' }]) {
      expect(archiveOnServerRefusal('archive', location)?.error, JSON.stringify(location)).toBe(
        'archive_on_server',
      );
    }
  });

  it('lets an archive in the destination’s files through, and every other kind', () => {
    expect(archiveOnServerRefusal('archive', { where: 'target' })).toBeUndefined();
    // A path is meaningful only for an archive; nothing else is judged here.
    for (const kind of ['imap', 'google_drive', 'dropbox', 'webdav']) {
      expect(archiveOnServerRefusal(kind, { path: '/etc' })).toBeUndefined();
    }
  });
});
