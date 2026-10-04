// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NAME AND A FOLDER THE ROUTE WRITES (0153 open question 5, item 4; the
 * owner, 2026-10-04: *"go with the recommendations"*).
 *
 * `PUT /api/migrations/:mappingId` had three answers that were not true:
 *
 *  - a `name` was answered 200 and dropped, so *Rename* could not be built on it;
 *  - `rootFolderId` was refused on every migration, including one set up and
 *    not yet started, though the refusal's own reason is about items already
 *    copied;
 *  - Dropbox's `rootPath` was answered 200 and dropped.
 *
 * Against real rows: the name is written, trimmed, and a name of spaces is
 * refused; a folder is written into this migration's own override until the
 * ledger holds an item, and refused after, in the table's words; a source
 * with no folder, and the other spelling, are refused by name; an empty folder
 * takes it off the override, except where the account itself holds one.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '0153a500-e29b-41d4-a716-446655440101';
const CONN = {
  drive: '0153a500-e29b-41d4-a716-446655440111',
  dropbox: '0153a500-e29b-41d4-a716-446655440112',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440113',
  imap: '0153a500-e29b-41d4-a716-446655440114',
  copied: '0153a500-e29b-41d4-a716-446655440115',
} as const;
const BOX = {
  drive: '0153a500-e29b-41d4-a716-446655440121',
  dropbox: '0153a500-e29b-41d4-a716-446655440122',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440123',
  imap: '0153a500-e29b-41d4-a716-446655440124',
  copied: '0153a500-e29b-41d4-a716-446655440125',
} as const;
const MAPPING = {
  drive: '0153a500-e29b-41d4-a716-446655440131',
  dropbox: '0153a500-e29b-41d4-a716-446655440132',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440133',
  imap: '0153a500-e29b-41d4-a716-446655440134',
  copied: '0153a500-e29b-41d4-a716-446655440135',
} as const;

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function read(sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows[0] as Record<string, unknown>;
  } finally {
    await conn.release();
  }
}
const overrideOf = async (mapping: string) =>
  (await read('SELECT source_config_override AS o FROM mailbox_mapping WHERE id = $1', [mapping]))['o'];
const nameOf = async (mapping: string) => (await read('SELECT name FROM mailbox_mapping WHERE id = $1', [mapping]))['name'];

const put = (mapping: string, body: Record<string, unknown>) =>
  request(app).put(`/api/migrations/${mapping}`).send(body);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    const secret = JSON.stringify(
      SecretStore.encryptCredentials({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }).encrypted,
    );
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'folders']);
    const rows: ReadonlyArray<[keyof typeof CONN, string, Record<string, unknown>]> = [
      ['drive', 'google_drive', { type: 'google-drive' }],
      ['dropbox', 'dropbox', { type: 'dropbox' }],
      ['dropboxOwnRoot', 'dropbox', { type: 'dropbox', rootPath: '/Werk' }],
      ['imap', 'imap', { type: 'imap', host: 'imap.example.invalid', port: 993 }],
      ['copied', 'google_drive', { type: 'google-drive' }],
    ];
    for (const [key, kind, config] of rows) {
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source',$3,$4,$5::jsonb,'connected',$6)`,
        [CONN[key], TENANT, kind, key, JSON.stringify(config), secret],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user',$4)`,
        [BOX[key], TENANT, CONN[key], `${key}@example.invalid`],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name) VALUES ($1,$2,$3,'paused',$4)`,
        [MAPPING[key], TENANT, BOX[key], `${key} migration`],
      );
    }
    // One item in one ledger: that migration has copied something.
    await q(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status)
       VALUES ($1,$2,'file','/','a.jpg','hash-a','copied')`,
      [TENANT, MAPPING.copied],
    );
  } finally {
    await conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end?.();
});

describe('Rename: the name is written', () => {
  it('stores the name it is given, trimmed', async () => {
    const res = await put(MAPPING.drive, { name: '  Anna’s photos  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await nameOf(MAPPING.drive)).toBe('Anna’s photos');
  });

  it('refuses a name of spaces, on the box it was typed in, and keeps the old one', async () => {
    const res = await put(MAPPING.imap, { name: '   ' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('"name"');
    expect(await nameOf(MAPPING.imap)).toBe('imap migration');
  });
});

describe('a root folder, until something is copied', () => {
  it('sets a Drive folder on a migration that has copied nothing', async () => {
    const res = await put(MAPPING.drive, { sourceConfig: { rootFolderId: ' folder-abc ' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await overrideOf(MAPPING.drive)).toEqual({ rootFolderId: 'folder-abc' });
  });

  it('sets a Dropbox path, which the route used to drop without a word', async () => {
    const res = await put(MAPPING.dropbox, { sourceConfig: { rootPath: '/Photos' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await overrideOf(MAPPING.dropbox)).toEqual({ rootPath: '/Photos' });
  });

  it('refuses a folder once something was copied, in the table’s words, and changes nothing', async () => {
    const res = await put(MAPPING.copied, { sourceConfig: { rootFolderId: 'elsewhere' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('revision_refused');
    expect(res.body.refused.map((r: { field: string }) => r.field)).toEqual(['source.rootFolderId']);
    expect(res.body.refused[0].reason).toContain('Start a second migration for the other folder');
    expect(await overrideOf(MAPPING.copied)).toBeNull();
  });

  it('refuses a folder for a source with none, and the other spelling, by name', async () => {
    const imap = await put(MAPPING.imap, { sourceConfig: { rootFolderId: 'x' } });
    expect(imap.status).toBe(400);
    expect(JSON.stringify(imap.body.details)).toContain('no folder to start from');
    const spelling = await put(MAPPING.dropbox, { sourceConfig: { rootFolderId: 'x' } });
    expect(spelling.status).toBe(400);
    expect(JSON.stringify(spelling.body.details)).toContain('rootPath');
    expect(await overrideOf(MAPPING.dropbox)).toEqual({ rootPath: '/Photos' });
  });

  it('takes the folder off with an empty one, and refuses where the account itself holds it', async () => {
    const cleared = await put(MAPPING.drive, { sourceConfig: { rootFolderId: '' } });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await overrideOf(MAPPING.drive)).toEqual({});
    const own = await put(MAPPING.dropboxOwnRoot, { sourceConfig: { rootPath: '' } });
    expect(own.status).toBe(400);
    expect(JSON.stringify(own.body.details)).toContain('set on its account');
  });
});
