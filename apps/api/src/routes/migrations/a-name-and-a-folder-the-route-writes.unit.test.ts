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
 * ledger holds an item (on a Google account too, whose files are Drive's),
 * and refused after, in the table's words; a source
 * with no folder, and the other spelling, are refused by name; an empty folder
 * takes it off the override, except where the account itself holds one.
 *
 * And the folder the copies land in (`targetFolderPrefix`), which the route
 * dropped without a word: written until the first item, refused after, and
 * refused where another migration between the same two accounts already
 * copies into it, in the words create uses for the same index.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { parseGoogleDriveSource } from '@openmig/shared';

const TENANT = '0153a500-e29b-41d4-a716-446655440101';
const CONN = {
  drive: '0153a500-e29b-41d4-a716-446655440111',
  dropbox: '0153a500-e29b-41d4-a716-446655440112',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440113',
  imap: '0153a500-e29b-41d4-a716-446655440114',
  copied: '0153a500-e29b-41d4-a716-446655440115',
  twin: '0153a500-e29b-41d4-a716-446655440116',
  target: '0153a500-e29b-41d4-a716-446655440117',
  account: '0153a500-e29b-41d4-a716-446655440118',
} as const;
const BOX = {
  drive: '0153a500-e29b-41d4-a716-446655440121',
  dropbox: '0153a500-e29b-41d4-a716-446655440122',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440123',
  imap: '0153a500-e29b-41d4-a716-446655440124',
  copied: '0153a500-e29b-41d4-a716-446655440125',
  twin: '0153a500-e29b-41d4-a716-446655440126',
  target: '0153a500-e29b-41d4-a716-446655440127',
  account: '0153a500-e29b-41d4-a716-446655440128',
} as const;
const MAPPING = {
  drive: '0153a500-e29b-41d4-a716-446655440131',
  dropbox: '0153a500-e29b-41d4-a716-446655440132',
  dropboxOwnRoot: '0153a500-e29b-41d4-a716-446655440133',
  imap: '0153a500-e29b-41d4-a716-446655440134',
  copied: '0153a500-e29b-41d4-a716-446655440135',
  twinA: '0153a500-e29b-41d4-a716-446655440136',
  twinB: '0153a500-e29b-41d4-a716-446655440137',
  account: '0153a500-e29b-41d4-a716-446655440138',
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

const { default: migrationRoutes, sourceConfigOverride } = await import('./index.ts');

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
const prefixOf = async (mapping: string) =>
  (await read('SELECT target_folder_prefix AS p FROM mailbox_mapping WHERE id = $1', [mapping]))['p'];

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
    const rows: ReadonlyArray<[keyof typeof CONN & keyof typeof MAPPING, string, Record<string, unknown>]> = [
      ['drive', 'google_drive', { type: 'google-drive' }],
      ['dropbox', 'dropbox', { type: 'dropbox' }],
      ['dropboxOwnRoot', 'dropbox', { type: 'dropbox', rootPath: '/Werk' }],
      ['imap', 'imap', { type: 'imap', host: 'imap.example.invalid', port: 993 }],
      ['copied', 'google_drive', { type: 'google-drive' }],
      ['account', 'google', { type: 'google', user: 'account@example.invalid' }],
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
    // Two migrations between the same two accounts, one in a folder of its own.
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','google_drive','twin','{"type":"google-drive"}'::jsonb,'connected',$4),
              ($3,$2,'target','soverin','target','{"type":"soverin"}'::jsonb,'connected',$4)`,
      [CONN.twin, TENANT, CONN.target, secret],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','twin@example.invalid'), ($4,$2,$5,'user','target@example.invalid')`,
      [BOX.twin, TENANT, CONN.twin, BOX.target, CONN.target],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, name, target_folder_prefix)
       VALUES ($1,$2,$3,$4,'paused','twin A','Anna'), ($5,$2,$3,$4,'paused','twin B',NULL)`,
      [MAPPING.twinA, TENANT, BOX.twin, BOX.target, MAPPING.twinB],
    );
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

  it('sets a Google account’s folder, since its files are Drive’s (Only one folder, on Start a migration)', async () => {
    const res = await put(MAPPING.account, { sourceConfig: { rootFolderId: 'folder-of-the-account' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await overrideOf(MAPPING.account)).toEqual({ rootFolderId: 'folder-of-the-account' });
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

describe('the folder the copies land in, until something is copied', () => {
  it('writes it on a migration that has copied nothing, through the parser create uses', async () => {
    const res = await put(MAPPING.twinB, { targetFolderPrefix: '/Gmail/' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prefixOf(MAPPING.twinB)).toBe('Gmail');
  });

  it('refuses a folder another migration between the same accounts copies into, in create’s words', async () => {
    const res = await put(MAPPING.twinB, { targetFolderPrefix: 'Anna' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_mapping');
    expect(res.body.existingMappingId).toBe(MAPPING.twinA);
    expect(res.body.message).toContain('A migration between these two accounts already exists');
    expect(await prefixOf(MAPPING.twinB)).toBe('Gmail');
  });

  it('refuses it once something was copied, in the table’s words', async () => {
    const res = await put(MAPPING.copied, { targetFolderPrefix: 'Elsewhere' });
    expect(res.status).toBe(409);
    expect(res.body.refused.map((r: { field: string }) => r.field)).toEqual(['target.folderPrefix']);
    expect(await prefixOf(MAPPING.copied)).toBeNull();
  });

  it('refuses a folder the parser refuses, on the key it was sent under', async () => {
    const res = await put(MAPPING.twinB, { targetFolderPrefix: 'a/../b' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('targetFolderPrefix');
  });

  it('is said by the migration’s own read', async () => {
    const res = await request(app).get(`/api/migrations/${MAPPING.twinA}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.targetFolderPrefix).toBe('Anna');
  });
});

describe('a Google account’s folder at create', () => {
  it('is kept in the migration’s own override, and read by a pass as the folder its files start from', () => {
    // Dropped here before, without a word: *Only one folder* on Start a
    // migration sends it for the account as for the Drive row.
    const override = sourceConfigOverride({
      sourceType: 'google',
      sourceConfig: { username: 'account@example.invalid', rootFolderId: 'folder-of-the-account' },
    } as never);
    expect(override).toEqual({ user: 'account@example.invalid', rootFolderId: 'folder-of-the-account' });
    // Laid over the account's row key by key, as a pass lays it, and read by
    // the account's file face, which is Drive's.
    const runs = parseGoogleDriveSource({ type: 'google', user: 'account@example.invalid', ...override });
    expect(runs.rootFolderId).toBe('folder-of-the-account');
  });
});
