// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SHARING A TEST MIGRATION KEEPS (workplan 0162 §2 (d); the first thing
 * T1 settles before any marker can be set), pressed at the managed API's own
 * doors against a real database.
 *
 * `POST /api/migrations/:mappingId/sharing/rescan` reads the migration's
 * source through `migrationInventoryScans` and saves what it finds into
 * `share_grant`: who could reach what, by name, for the whole account.
 * `GET /api/permissions/report` reads the same scans and returns them as text.
 * Neither reads through the wrapper a pass reads through, so under a marker
 * both kept the sharing of every item in the account. Now a grant is kept
 * when the thing it is on carries the marker in its own name (T2's
 * `carriesMarker`, through `markedSharesOnly`), and nothing about any other is
 * saved or reported:
 *
 *  - a marked file, a marked folder, a marked file inside an unmarked folder,
 *    and a link on a file marked in another case are kept; an unmarked file,
 *    an unmarked file inside a marked folder, an unmarked folder and a link on
 *    an unmarked file are not, and neither are the people they were shared
 *    with;
 *  - a share the old system gave without saying what it is on refuses both
 *    doors, in both languages, and the rescan writes nothing;
 *  - an organisation-wide report, which names no migration, is refused in an
 *    organisation whose migrations carry a marker.
 *
 * Each case presses the same door for an organisation whose migration has no
 * marker, which keeps every share, as before. The scans are the real ones,
 * `scanNextcloudShares` over a faked OCS answer (only `tenantFetch`, the
 * network, is replaced) and, for a Google account, the Drive source's own
 * `listOwnedShareGrants` over a faked Drive answer.
 *
 * Nothing writes the marker yet (T1), so the fixture inserts it, as a
 * migration's creation will. And no migration carries one anywhere yet, so no
 * `share_grant` row was ever written for one, and none needs cleaning up.
 *
 * UUID family 01620007-…, unused elsewhere in the repository.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import {
  A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING,
  A_TEST_ORGANISATIONS_SHARING_IS_PER_MIGRATION,
} from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';

const TEST_TENANT = '01620007-e29b-41d4-a716-446655440001';
const TEST_CONN = '01620007-e29b-41d4-a716-446655440011';
const TEST_BOX = '01620007-e29b-41d4-a716-446655440021';
const TEST = '01620007-e29b-41d4-a716-446655440031';
const PLAIN_TENANT = '01620007-e29b-41d4-a716-446655440002';
const PLAIN_CONN = '01620007-e29b-41d4-a716-446655440012';
const PLAIN_BOX = '01620007-e29b-41d4-a716-446655440022';
const PLAIN = '01620007-e29b-41d4-a716-446655440032';
const GOOGLE_TENANT = '01620007-e29b-41d4-a716-446655440003';
const GOOGLE_CONN = '01620007-e29b-41d4-a716-446655440013';
const GOOGLE_BOX = '01620007-e29b-41d4-a716-446655440023';
const GOOGLE = '01620007-e29b-41d4-a716-446655440033';
const MARKER = '[Ownpace-test]';
const ADDRESS = 'tester@example.com';
const DRIVE = 'https://drive.example.test/v3';

let driver: LedgerDriver;

/** What OCS answers for the account's shares, set by each case. */
const h = vi.hoisted(() => ({ shares: [] as unknown[], asked: [] as string[] }));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    // The organisation the request names, so one file can ask for both.
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: req.header('x-organisation'), userId: 'an-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

// Only the network: OCS's answer, as a Nextcloud gives it.
vi.mock('@openmig/shared/reachable-host', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    tenantFetch: async (url: string) => {
      h.asked.push(url);
      if (!url.includes('/ocs/v2.php/apps/files_sharing/api/v1/shares')) {
        return { status: 404, headers: new Headers(), text: async () => `no fake route for ${url}` };
      }
      return {
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ ocs: { meta: { status: 'ok' }, data: h.shares } }),
      };
    },
  };
});

// A Google account's Drive: the real source, over a faked Drive answer of the
// files the account owns, each with who it is shared with.
vi.mock('@openmig/orchestration/drive-source-factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/drive-source-factory')>();
  const { GoogleDriveSource } = await import('@openmig/connectors');
  const owned = (id: string, name: string, emailAddress: string) => ({
    id,
    name,
    shared: true,
    mimeType: 'application/pdf',
    permissions: [
      { type: 'user', role: 'owner', emailAddress: 'tester@example.com' },
      { type: 'user', role: 'reader', emailAddress },
    ],
  });
  const files = [
    owned('d-1', '[Ownpace-test] Drive plan.pdf', 'anna@example.com'),
    owned('d-2', 'Mortgage.pdf', 'bank@example.com'),
  ];
  return {
    ...actual,
    buildGoogleDriveSourceFrom: () =>
      new GoogleDriveSource(
        async (url: string) => ({
          ok: url.includes('/files?q='),
          status: url.includes('/files?q=') ? 200 : 404,
          json: async () => ({ files }),
          arrayBuffer: async () => new ArrayBuffer(0),
          text: async () => '',
        }),
        { baseUrl: DRIVE },
      ),
  };
});

const { default: migrationRoutes } = await import('./migrations/index.ts');
const { default: permissionRoutes } = await import('./permissions.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/permissions', permissionRoutes);

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

/** An organisation with a Nextcloud (or a Google) source account, and a migration from it, marked or not. */
async function anOrganisation(
  tenant: string,
  connection: string,
  mailbox: string,
  mapping: string,
  marker: string | null,
  kind: 'nextcloud' | 'google' = 'nextcloud',
): Promise<void> {
  await query('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenant, `organisation ${tenant.slice(-2)}`]);
  const nextcloud = kind === 'nextcloud';
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'source', $5, 'an account', $3::jsonb, 'connected', $4)`,
    [
      connection,
      tenant,
      JSON.stringify(nextcloud ? { baseUrl: 'https://cloud.example.test/remote.php/dav/files/tester' } : {}),
      JSON.stringify(
        SecretStore.encryptCredentials(
          nextcloud ? { username: 'tester', password: 'p' } : { refreshToken: 'a-refresh-token-of-the-test' },
        ).encrypted,
      ),
      kind,
    ],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', $4)`,
    [mailbox, tenant, connection, ADDRESS],
  );
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, test_marker)
     VALUES ($1, $2, $3, 'active', $4)`,
    [mapping, tenant, mailbox, marker],
  );
}

/** One OCS share: a person's (type 0) or a public link's (type 3). */
const share = (path: string | undefined, over: Record<string, unknown> = {}) => ({
  share_type: 0,
  share_with: 'anna',
  permissions: 1,
  item_type: 'file',
  ...(path === undefined ? {} : { path }),
  ...over,
});

/** An account with marked and unmarked things shared, and what a test may keep of them. */
const ACCOUNT = [
  share('/[Ownpace-test] plan.pdf'),
  share('/Family/Taxes 2025.pdf', { share_with: 'bram', permissions: 3 }),
  share('/[Ownpace-test] Shared', { item_type: 'folder', permissions: 31 }),
  share('/Family', { share_with: 'bram', item_type: 'folder' }),
  // Its own name decides, not the folder it sits in (§2 (a)): kept in an
  // unmarked folder, and not kept in a marked one (open question 2).
  share('/Family/[Ownpace-test] notes.txt', { share_with: 'carla' }),
  share('/[Ownpace-test] Shared/Budget.xlsx', { share_with: 'erik' }),
  // Ignoring case.
  share('/[ownpace-TEST] public.pdf', { share_type: 3, share_with: undefined }),
  share('/Holiday.jpg', { share_type: 3, share_with: undefined }),
];
const KEPT = [
  '[Ownpace-test] Shared',
  '[Ownpace-test] plan.pdf',
  '[ownpace-TEST] public.pdf',
  'Family/[Ownpace-test] notes.txt',
].sort();
const EVERY = [
  ...KEPT,
  'Family',
  'Family/Taxes 2025.pdf',
  '[Ownpace-test] Shared/Budget.xlsx',
  'Holiday.jpg',
].sort();

/** What `share_grant` holds for a migration, read outside any route, in one order. */
async function savedFor(mapping: string): Promise<string[]> {
  const rows = await query<{ on_label: string }>(`SELECT on_label FROM share_grant WHERE mapping_id = $1`, [mapping]);
  return rows.map((r) => r.on_label).sort();
}

const rescan = (tenant: string, mapping: string) =>
  request(app).post(`/api/migrations/${mapping}/sharing/rescan`).set('x-organisation', tenant).send({});

const reportOf = (tenant: string, mapping: string) =>
  request(app)
    .get(`/api/permissions/report?mappingId=${mapping}&lang=en`)
    .set('x-organisation', tenant)
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      res.on('end', () => done(null, text));
    });

const GOOGLE_CLIENT = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the doors here read the operator's hold on an
  // organisation, a managed-only table.
  await runManagedMigrations({ driver, logger: () => {} });
  await anOrganisation(TEST_TENANT, TEST_CONN, TEST_BOX, TEST, MARKER);
  await anOrganisation(PLAIN_TENANT, PLAIN_CONN, PLAIN_BOX, PLAIN, null);
  await anOrganisation(GOOGLE_TENANT, GOOGLE_CONN, GOOGLE_BOX, GOOGLE, MARKER, 'google');
  // The deployment carries the Google client (ADR-0041), so a Drive scan runs.
  for (const name of GOOGLE_CLIENT) saved[name] = process.env[name];
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'a-client-id.apps.googleusercontent.test';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'a-client-secret';
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default.
}, 120_000);

afterAll(async () => {
  for (const name of GOOGLE_CLIENT) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await driver.end?.();
});

beforeEach(async () => {
  h.shares = ACCOUNT;
  h.asked.length = 0;
  await query(`DELETE FROM share_grant WHERE mapping_id IN ($1, $2, $3)`, [TEST, PLAIN, GOOGLE]);
});

describe('the sharing rescan of a test migration', () => {
  it('saves only the shares on things whose own name carries the marker', async () => {
    const res = await rescan(TEST_TENANT, TEST);

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(KEPT.length);
    expect(await savedFor(TEST)).toEqual(KEPT);
    // Nobody an unmarked thing was shared with is on the list.
    expect(
      await query(`SELECT 1 FROM share_grant WHERE mapping_id = $1 AND grantee IN ('bram', 'erik')`, [TEST]),
    ).toEqual([]);
    expect(h.asked).toHaveLength(1);
  });

  it('saves every share for the same account in a migration without a marker', async () => {
    const res = await rescan(PLAIN_TENANT, PLAIN);

    expect(res.status).toBe(200);
    expect(await savedFor(PLAIN)).toEqual(EVERY);
  });

  it('refuses, in both languages, and writes nothing, when a share does not say what it is on', async () => {
    expect((await rescan(TEST_TENANT, TEST)).status).toBe(200);
    h.shares = [...ACCOUNT, share(undefined, { share_with: 'dora' })];

    const res = await rescan(TEST_TENANT, TEST);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Conflict',
      reason: A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING.en,
      reasonNl: A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING.nl,
      code: 'test_migration',
    });
    // What the last rescan saved, and nothing of this one.
    expect(await savedFor(TEST)).toEqual(KEPT);
  });

  it('saves that share too, for a migration without a marker', async () => {
    h.shares = [...ACCOUNT, share(undefined, { share_with: 'dora' })];

    const res = await rescan(PLAIN_TENANT, PLAIN);

    expect(res.status).toBe(200);
    expect(await savedFor(PLAIN)).toEqual(['', ...EVERY]);
  });
});

describe('the permission report of a test migration', () => {
  it('lists only the shares on marked things, and no one an unmarked thing was shared with', async () => {
    const res = await reportOf(TEST_TENANT, TEST);

    expect(res.status).toBe(200);
    const report = res.body as string;
    for (const kept of KEPT) expect(report).toContain(kept);
    for (const left of ['Taxes 2025.pdf', 'Holiday.jpg', 'Budget.xlsx', 'bram', 'erik']) {
      expect(report).not.toContain(left);
    }
  });

  it('lists every share for the same account in a migration without a marker', async () => {
    const res = await reportOf(PLAIN_TENANT, PLAIN);

    expect(res.status).toBe(200);
    const report = res.body as string;
    for (const any of ['[Ownpace-test] plan.pdf', 'Taxes 2025.pdf', 'Holiday.jpg', 'bram']) {
      expect(report).toContain(any);
    }
  });

  it('is refused, in both languages, when a share does not say what it is on', async () => {
    h.shares = [...ACCOUNT, share(undefined, { share_with: 'dora' })];

    const res = await request(app)
      .get(`/api/permissions/report?mappingId=${TEST}&lang=nl`)
      .set('x-organisation', TEST_TENANT);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Conflict',
      message: A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING.en,
      messageNl: A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING.nl,
      code: 'test_migration',
    });
  });
});

describe('a test migration from a Google account', () => {
  it('saves and reports only the Drive file whose own name carries the marker', async () => {
    const res = await rescan(GOOGLE_TENANT, GOOGLE);

    expect(res.status).toBe(200);
    expect(await savedFor(GOOGLE)).toEqual(['[Ownpace-test] Drive plan.pdf']);
    const report = (await reportOf(GOOGLE_TENANT, GOOGLE)).body as string;
    expect(report).toContain('[Ownpace-test] Drive plan.pdf');
    for (const left of ['Mortgage.pdf', 'bank@example.com']) expect(report).not.toContain(left);
  });
});

describe('the organisation-wide report, which names no migration', () => {
  it('is refused in an organisation whose migrations carry a marker, before anything is read', async () => {
    const res = await request(app)
      .get(`/api/permissions/report?mailbox=${encodeURIComponent(ADDRESS)}`)
      .set('x-organisation', TEST_TENANT);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Conflict',
      message: A_TEST_ORGANISATIONS_SHARING_IS_PER_MIGRATION.en,
      messageNl: A_TEST_ORGANISATIONS_SHARING_IS_PER_MIGRATION.nl,
      code: 'test_organisation',
    });
    expect(h.asked).toEqual([]);
  });

  it('is made as before in an organisation whose migration carries none', async () => {
    const res = await request(app)
      .get(`/api/permissions/report?mailbox=${encodeURIComponent(ADDRESS)}`)
      .set('x-organisation', PLAIN_TENANT);

    expect(res.status).toBe(200);
    expect(h.asked).toHaveLength(1);
  });
});
