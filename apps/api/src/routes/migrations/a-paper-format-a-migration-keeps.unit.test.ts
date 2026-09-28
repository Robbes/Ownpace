// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER FORMAT A MIGRATION KEEPS: the managed doors (workplan 0150 T3 (c)).
 *
 * The owner moved Paper export before the alpha: *"yes, paper export before
 * the alpha"*. The Dropbox source exports a Paper doc in the format a
 * migration chose (0150 T3 (b), T4); these tests hold the doors that write
 * that choice, under the key Drive's formats use, with a `paper` kind (D7):
 *
 *  - create stores it, through the parser the appliance's mapping file goes
 *    through, where until this a format sent for a Dropbox migration was
 *    dropped without a word; and refuses an unknown format or kind by name;
 *  - a reused connection's override carries it;
 *  - the update route writes it into this mapping's own override, keeping
 *    what else the override holds. It used to answer every Paper format with a
 *    400, because it read each one with Drive's parser. And it refuses a Paper
 *    format for a migration that is not Dropbox's, and Drive's formats for one
 *    that is, since either would be stored and never read;
 *  - a migration's record of its settings holds the Paper format, so the
 *    appliance's log names a switch as the revision it is.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { parseDropboxSource, parseMappingConfig, revisionSnapshotOf } from '@openmig/shared';

const TENANT = '0150fa00-e29b-41d4-a716-446655440101';
const DROPBOX_CONN = '0150fa00-e29b-41d4-a716-446655440111';
const GOOGLE_CONN = '0150fa00-e29b-41d4-a716-446655440112';
const DROPBOX_BOX = '0150fa00-e29b-41d4-a716-446655440121';
const GOOGLE_BOX = '0150fa00-e29b-41d4-a716-446655440122';
const DROPBOX_MAPPING = '0150fa00-e29b-41d4-a716-446655440131';
const GOOGLE_MAPPING = '0150fa00-e29b-41d4-a716-446655440132';

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

const {
  default: migrationRoutes,
  CreateMappingSchema,
  UpdateMappingSchema,
  sourceConfigOverride,
  sourceConnectionConfig,
} = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

/** A Dropbox migration as the wizard posts it, with `over` in its sourceConfig. */
function body(over: Record<string, unknown>) {
  return {
    name: 'a Dropbox migration',
    sourceType: 'dropbox',
    targetType: 'nextcloud',
    sourceConfig: {
      username: 'dropbox',
      clientId: 'app-key',
      clientSecret: 'app-secret',
      refreshToken: 'a-refresh-token',
      rootPath: '/Werk',
      ...over,
    },
    targetConfig: {
      url: 'https://cloud.example.invalid',
      username: 'a@example.invalid',
      password: 'x',
    },
    syncConfig: { domains: ['file'] },
  };
}

const issuesOn = (result: { success: boolean; error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } }) =>
  (result.error?.issues ?? [])
    .filter((i) => i.path.join('.') === 'sourceConfig.nativeFilePolicies')
    .map((i) => i.message);

describe('create', () => {
  it('stores the format for Paper docs beside the root, and the appliance’s reader keeps it', () => {
    const config = sourceConnectionConfig(body({ nativeFilePolicies: { paper: 'markdown' } }) as never);
    expect(config).toEqual({ type: 'dropbox', rootPath: '/Werk', nativeFilePolicies: { paper: 'markdown' } });
    // Hard rule 5: what this door stores, the shared reader reads the same.
    const parsed = parseMappingConfig({
      tenantId: 't',
      mappingId: 'm',
      source: config,
      target: {
        type: 'webdav',
        url: 'https://cloud.example.invalid/remote.php/dav/files/a/',
        user: 'u',
        auth: { kind: 'login', passwordFromEnv: 'UNUSED_IN_THIS_TEST' },
      },
    });
    expect(parsed.source).toEqual(config);
  });

  it('stores nothing more when no format was chosen, which refuses Paper docs by name (D1)', () => {
    expect(sourceConnectionConfig(body({}) as never)).toEqual({ type: 'dropbox', rootPath: '/Werk' });
  });

  it('accepts every format Dropbox exports a Paper doc in, and refuse', () => {
    for (const paper of ['markdown', 'html', 'refuse']) {
      const result = CreateMappingSchema.safeParse(body({ nativeFilePolicies: { paper } }));
      expect(issuesOn(result), paper).toEqual([]);
    }
  });

  it('refuses a format it does not know on the box it was typed in, in the parser’s words', () => {
    const result = CreateMappingSchema.safeParse(body({ nativeFilePolicies: { paper: 'pdf' } }));
    expect(result.success).toBe(false);
    expect(issuesOn(result).join(' ')).toContain('source.nativeFilePolicies.paper: unsupported "pdf"');
  });

  it('refuses a Google kind on a Dropbox migration, rather than storing what nothing reads', () => {
    const result = CreateMappingSchema.safeParse(body({ nativeFilePolicies: { document: 'export-office' } }));
    expect(result.success).toBe(false);
    expect(issuesOn(result).join(' ')).toContain('unknown kind "document" for a Dropbox source');
  });

  it('carries the format on a reused connection’s override', () => {
    expect(sourceConfigOverride(body({ nativeFilePolicies: { paper: 'html' } }) as never)).toEqual({
      rootPath: '/Werk',
      nativeFilePolicies: { paper: 'html' },
    });
    expect(sourceConfigOverride(body({}) as never)).toEqual({ rootPath: '/Werk' });
  });
});

describe('the update body', () => {
  it('reads a Paper format with Dropbox’s parser, where Drive’s answered 400', () => {
    const parsed = UpdateMappingSchema.safeParse({ sourceConfig: { nativeFilePolicies: { paper: 'markdown' } } });
    expect(parsed.success).toBe(true);
  });

  it('refuses one it does not know, naming it', () => {
    const parsed = UpdateMappingSchema.safeParse({ sourceConfig: { nativeFilePolicies: { paper: 'docx' } } });
    expect(issuesOn(parsed).join(' ')).toContain('source.nativeFilePolicies.paper: unsupported "docx"');
  });
});

async function overrideOf(mapping: string): Promise<unknown> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT source_config_override AS o FROM mailbox_mapping WHERE id = $1', [mapping]);
    return (r.rows[0] as { o: unknown }).o;
  } finally {
    await conn.release();
  }
}

describe('the update route, against real rows', () => {
  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    const conn = await driver.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      const secret = JSON.stringify(
        SecretStore.encryptCredentials({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }).encrypted,
      );
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'paper']);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source','dropbox','d',$3::jsonb,'connected',$5),
                ($4,$2,'source','google','g','{"type":"google","user":"someone@example.invalid"}'::jsonb,'connected',$5)`,
        [DROPBOX_CONN, TENANT, JSON.stringify({ type: 'dropbox', rootPath: '/Werk' }), GOOGLE_CONN, secret],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','dropbox'), ($4,$2,$5,'user','someone@example.invalid')`,
        [DROPBOX_BOX, TENANT, DROPBOX_CONN, GOOGLE_BOX, GOOGLE_CONN],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused'), ($4,$2,$5,'paused')`,
        [DROPBOX_MAPPING, TENANT, DROPBOX_BOX, GOOGLE_MAPPING, GOOGLE_BOX],
      );
    } finally {
      await conn.release();
    }
  }, 120_000);

  afterAll(async () => {
    await driver.end?.();
  });

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      // Where this mapping is rooted rides the same column, and must survive.
      await conn.query(`UPDATE mailbox_mapping SET source_config_override = $1::jsonb WHERE id = $2`, [
        JSON.stringify({ rootPath: '/Werk' }),
        DROPBOX_MAPPING,
      ]);
      await conn.query(`UPDATE mailbox_mapping SET source_config_override = $1::jsonb WHERE id = $2`, [
        JSON.stringify({ user: 'someone@example.invalid' }),
        GOOGLE_MAPPING,
      ]);
    } finally {
      await conn.release();
    }
  });

  it("merges the Paper format into this mapping's own override, keeping its root", async () => {
    const res = await request(app)
      .put(`/api/migrations/${DROPBOX_MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { paper: 'markdown' } } });
    expect(res.status).toBe(200);
    const override = await overrideOf(DROPBOX_MAPPING);
    expect(override).toEqual({ rootPath: '/Werk', nativeFilePolicies: { paper: 'markdown' } });
    // And what a pass reads from it is what was chosen.
    expect(parseDropboxSource(override as Record<string, unknown>).nativeFilePolicies).toEqual({ paper: 'markdown' });
  });

  it('switches it back to refuse, and the detail route echoes what a pass will read', async () => {
    await request(app)
      .put(`/api/migrations/${DROPBOX_MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { paper: 'html' } } });
    const res = await request(app)
      .put(`/api/migrations/${DROPBOX_MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { paper: 'refuse' } } });
    expect(res.status).toBe(200);
    expect(await overrideOf(DROPBOX_MAPPING)).toEqual({ rootPath: '/Werk', nativeFilePolicies: { paper: 'refuse' } });
    const detail = await request(app).get(`/api/migrations/${DROPBOX_MAPPING}`);
    expect(detail.status).toBe(200);
    expect(detail.body.sourceConfig.nativeFilePolicies).toEqual({ paper: 'refuse' });
  });

  it('refuses a Paper format for a migration that is not Dropbox’s, and writes nothing', async () => {
    const res = await request(app)
      .put(`/api/migrations/${GOOGLE_MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { paper: 'markdown' } } });
    expect(res.status).toBe(400);
    const details = res.body.details as Array<{ path: string[]; message: string }>;
    expect(details.map((d) => d.path.join('.'))).toEqual(['sourceConfig.nativeFilePolicies']);
    expect(details[0]?.message).toContain('applies to a Dropbox migration only');
    expect(await overrideOf(GOOGLE_MAPPING)).toEqual({ user: 'someone@example.invalid' });
  });

  it('refuses Drive’s formats for a Dropbox migration, and writes nothing', async () => {
    for (const sourceConfig of [
      { nativeFilePolicies: { document: 'export-office' } },
      { nativeFilePolicy: 'export-pdf' },
    ]) {
      const res = await request(app).put(`/api/migrations/${DROPBOX_MAPPING}`).send({ sourceConfig });
      expect(res.status, JSON.stringify(sourceConfig)).toBe(400);
      const details = res.body.details as Array<{ path: string[]; message: string }>;
      expect(details[0]?.message).toContain('A Dropbox migration chooses a format for its Paper docs only');
    }
    expect(await overrideOf(DROPBOX_MAPPING)).toEqual({ rootPath: '/Werk' });
  });

  it('still writes Drive’s formats for a Google migration', async () => {
    const res = await request(app)
      .put(`/api/migrations/${GOOGLE_MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { document: 'export-office' } } });
    expect(res.status).toBe(200);
    expect(await overrideOf(GOOGLE_MAPPING)).toEqual({
      user: 'someone@example.invalid',
      nativeFilePolicies: { document: 'export-office' },
    });
  });
});

describe('what a Dropbox migration is recorded as', () => {
  const recorded = (source: Record<string, unknown>) =>
    revisionSnapshotOf({
      source: { type: 'dropbox', ...source },
      target: { type: 'webdav' },
    } as Parameters<typeof revisionSnapshotOf>[0])['source.nativeFilePolicy'];

  it('records the Paper format, so a switch is a revision the log names', () => {
    expect(recorded({ nativeFilePolicies: { paper: 'markdown' } })).toBe('markdown');
    expect(recorded({ nativeFilePolicies: { paper: 'html' } })).toBe('html');
  });

  it('records refuse when none was chosen, as every Dropbox record kept before this does', () => {
    expect(recorded({})).toBe('refuse');
    expect(recorded({ nativeFilePolicies: { paper: 'refuse' } })).toBe('refuse');
  });
});
