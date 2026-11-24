// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DAV SOURCE IN THE PERMISSION REPORT (workplan 0169).
 *
 * The managed door takes CalDAV, CardDAV and WebDAV sources since 0169, the
 * generic cards only (the owner, 2026-11-24). The report reads a migration's
 * sharing from its own source connection (`migrationInventoryScans`), and for
 * these three it says:
 *
 * - a WebDAV source's file shares are read through OCS, at the origin of the
 *   base URL its door stored (`url`), which is where a Nextcloud reached over
 *   WebDAV answers; and its calendar section does not name Nextcloud, because
 *   a WebDAV server is not one;
 * - a CalDAV or CardDAV source asks nothing of the network, and says in its
 *   own neutral words that its calendar and file sharing are not read.
 *
 * Over a real ledger (PGlite, both migration chains); only `tenantFetch`, the
 * network, is replaced. UUID family 01690001-…, unused elsewhere.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import {
  calendarSharingNotReadForThisSourceSaid,
  fileSharingNotReadForThisSourceSaid,
} from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '01690001-e29b-41d4-a716-446655440001';
const ADDRESS = 'anna@example.org';

let driver: LedgerDriver;

const h = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

// Only the network: an OCS answer with one shared file, as a Nextcloud gives it.
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
        text: async () =>
          JSON.stringify({
            ocs: {
              meta: { status: 'ok' },
              data: [{ share_type: 0, share_with: 'bram', permissions: 1, item_type: 'file', path: '/Plan.pdf' }],
            },
          }),
      };
    },
  };
});

const { migrationInventoryScans } = await import('./permissions.ts');

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

/** One source connection of `kind`, its mailbox and a migration from it; the ids end in `n`. */
async function aMigrationFrom(kind: string, n: number, config: Record<string, unknown>): Promise<string> {
  const id = (tail: number) => `01690001-e29b-41d4-a716-4466554400${String(tail).padStart(2, '0')}`;
  const [connection, mailbox, mapping] = [id(10 + n), id(20 + n), id(30 + n)];
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'source', $3, 'a DAV server', $4::jsonb, 'connected', $5)`,
    [
      connection,
      TENANT,
      kind,
      JSON.stringify(config),
      JSON.stringify(SecretStore.encryptCredentials({ username: 'anna', password: 'p' }).encrypted),
    ],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', $4)`,
    [mailbox, TENANT, connection, ADDRESS],
  );
  await query(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`, [
    mapping,
    TENANT,
    mailbox,
  ]);
  return mapping;
}

let WEBDAV = '';
let CALDAV = '';
let CARDDAV = '';

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await query('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'an organisation']);
  // As the create door stores a WebDAV source typed by its base URL: host and
  // port beside it, and the URL wins.
  WEBDAV = await aMigrationFrom('webdav', 1, {
    host: 'not-asked.example.org',
    port: 443,
    useSsl: true,
    url: 'https://cloud.example.org/remote.php/dav/files/anna/',
  });
  CALDAV = await aMigrationFrom('caldav', 2, { host: 'dav.example.org', port: 443, useSsl: true });
  CARDDAV = await aMigrationFrom('carddav', 3, { host: 'dav.example.org', port: 443, useSsl: true });
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  h.asked.length = 0;
});

describe('a WebDAV source', () => {
  it('reads its file shares at the origin of the base URL its door stored', async () => {
    const scans = await migrationInventoryScans(TENANT, WEBDAV, ADDRESS);
    const drive = await scans.scanDrive();

    expect(h.asked).toEqual(['https://cloud.example.org/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json']);
    expect(drive.kind).toBe('listed');
  });

  it('says its calendar sharing is not read without naming Nextcloud', async () => {
    const scans = await migrationInventoryScans(TENANT, WEBDAV, ADDRESS);
    const calendars = await scans.scanCalendars();

    expect(calendars).toMatchObject({ kind: 'not_discoverable' });
    expect(JSON.stringify(calendars)).not.toMatch(/Nextcloud/);
    expect(JSON.stringify(calendars)).toContain(calendarSharingNotReadForThisSourceSaid().en);
  });
});

describe.each([
  ['caldav', () => CALDAV],
  ['carddav', () => CARDDAV],
])('a %s source', (_kind, mapping) => {
  it('asks nothing of the network, and says neither sharing is read, in its own words', async () => {
    const scans = await migrationInventoryScans(TENANT, mapping(), ADDRESS);
    const [calendars, drive] = [await scans.scanCalendars(), await scans.scanDrive()];

    expect(h.asked).toEqual([]);
    expect(JSON.stringify(calendars)).toContain(calendarSharingNotReadForThisSourceSaid().en);
    expect(JSON.stringify(drive)).toContain(fileSharingNotReadForThisSourceSaid().en);
  });
});
