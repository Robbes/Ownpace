// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FORMAT THAT HAD TO FIT ALL FOUR KINDS: the managed doors (workplan 0042 T9).
 *
 * The owner's decision, 2026-09-23: *"a per kind choice makes more sense for
 * the fileformats. Split that up."* No editable format carries all four
 * Google kinds, so one setting for all of them made somebody choose which
 * kind to lose. The engine now reads a format per kind; these tests hold the
 * doors that write it:
 *
 *  - create stores it, through the parser the appliance's mapping file goes
 *    through, and refuses an unknown kind or format BY NAME on the box at
 *    fault;
 *  - a reused connection cannot hand one migration's per-kind formats to
 *    another that chose one format for all four;
 *  - the update route writes it into this mapping's own override, clears it
 *    when one format is chosen for all four, and answers an unreadable value
 *    with a 400 naming the key, where it used to answer 500.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import {
  nativeFilePoliciesOf,
  parseGoogleDriveSource,
  parseMappingConfig,
  refusalsFor,
} from '@openmig/shared';

const TENANT = 'fa4c0000-e29b-41d4-a716-446655449101';
const CONN = 'fa4c0000-e29b-41d4-a716-446655449111';
const BOX = 'fa4c0000-e29b-41d4-a716-446655449121';
const MAPPING = 'fa4c0000-e29b-41d4-a716-446655449131';

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
  exportFormatOverride,
  proposedRevisions,
  sourceConfigOverride,
  sourceConnectionConfig,
} = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

const ACCOUNT = 'someone@example.invalid';

/** A Google account migration as the wizard posts it, with `over` in its sourceConfig. */
function body(over: Record<string, unknown>) {
  return {
    name: 'a migration',
    sourceType: 'google',
    targetType: 'caldav',
    sourceConfig: {
      username: ACCOUNT,
      clientId: 'client.apps.googleusercontent.com',
      clientSecret: 'a-test-value',
      refreshToken: '1//a-granted-refresh-token',
      ...over,
    },
    targetConfig: { host: 'dst.example.invalid', port: 443, username: 'a@example.invalid', password: 'x' },
    syncConfig: { domains: ['calendar'] },
  };
}

const PER_KIND = { document: 'export-office', presentation: 'export-odf' };

describe('create', () => {
  it('stores a format per kind beside the address, and the appliance’s reader keeps it', () => {
    const config = sourceConnectionConfig(body({ nativeFilePolicies: PER_KIND }) as never);
    expect(config).toEqual({ type: 'google', user: ACCOUNT, nativeFilePolicies: PER_KIND });
    // Hard rule 5: a key this door stores and the shared reader drops is a
    // setting that exists until somebody reads the config back.
    const parsed = parseMappingConfig({
      tenantId: 't',
      mappingId: 'm',
      source: config,
      target: {
        type: 'caldav',
        url: 'https://dav.example.invalid/',
        user: 'u',
        auth: { kind: 'login', passwordFromEnv: 'UNUSED_IN_THIS_TEST' },
      },
    });
    expect(parsed.source).toEqual(config);
  });

  it('stores it on the google-drive row too, through the same parser', () => {
    const config = sourceConnectionConfig({
      sourceType: 'google-drive',
      sourceConfig: { username: ACCOUNT, nativeFilePolicy: 'export-pdf', nativeFilePolicies: PER_KIND },
    } as never);
    expect(config).toEqual({
      type: 'google-drive',
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: PER_KIND,
    });
  });

  it('stores none on a Google row that carries no files', () => {
    for (const sourceType of ['gmail', 'google-calendar', 'google-contacts'] as const) {
      expect(
        sourceConnectionConfig({
          sourceType,
          sourceConfig: { username: ACCOUNT, nativeFilePolicies: PER_KIND },
        } as never),
        sourceType,
      ).toEqual({ type: sourceType, user: ACCOUNT });
    }
  });

  it('stores none on an account whose files are not Google’s', () => {
    // A Microsoft or Apple account shares this branch with Google's, and its
    // files are OneDrive's or iCloud's: a Google export format stored on it
    // is a setting that could never do anything, shown back as if it did.
    for (const sourceType of ['microsoft', 'apple'] as const) {
      expect(
        sourceConnectionConfig({
          sourceType,
          sourceConfig: {
            username: ACCOUNT,
            nativeFilePolicy: 'export-pdf',
            nativeFilePolicies: PER_KIND,
          },
        } as never),
        sourceType,
      ).toEqual({ type: sourceType, user: ACCOUNT });
    }
  });

  it('refuses a kind it does not know on the box it was typed in, in the parser’s words', () => {
    const result = CreateMappingSchema.safeParse(body({ nativeFilePolicies: { slides: 'export-odf' } }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.join('.') === 'sourceConfig.nativeFilePolicies',
    );
    expect(issue?.message).toContain('unknown kind "slides"');
  });

  it('refuses a format it does not know, naming the kind', () => {
    const result = CreateMappingSchema.safeParse(
      body({ nativeFilePolicies: { presentation: 'odf' } }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message).join(' ')).toContain(
      'source.nativeFilePolicies.presentation: unsupported "odf"',
    );
  });
});

describe('a reused connection', () => {
  it('writes the per-kind formats as none when one format was chosen for all four', () => {
    expect(sourceConfigOverride(body({ nativeFilePolicy: 'export-pdf' }) as never)).toEqual({
      user: ACCOUNT,
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: {},
    });
  });

  it('writes per-kind formats alone when those were all that was chosen', () => {
    expect(sourceConfigOverride(body({ nativeFilePolicies: PER_KIND }) as never)).toEqual({
      user: ACCOUNT,
      nativeFilePolicies: PER_KIND,
    });
  });

  it('writes nothing when nothing was chosen, which means inherit, as it always has', () => {
    expect(sourceConfigOverride(body({}) as never)).toEqual({ user: ACCOUNT });
  });

  it('never hands one migration’s deck format to another that chose PDF for all four', () => {
    // THE DEFECT A KEY-BY-KEY MERGE WOULD HAVE MADE. The connection was
    // created by a first migration with decks as ODF; a second migration
    // reusing it chose PDF for everything. A pass lays the second one's
    // override over the connection's config, key by key.
    const connection = sourceConnectionConfig(
      body({ nativeFilePolicy: 'export-office', nativeFilePolicies: PER_KIND }) as never,
    );
    const override = sourceConfigOverride(body({ nativeFilePolicy: 'export-pdf' }) as never);
    const runs = parseGoogleDriveSource({ ...connection, ...override });
    expect(nativeFilePoliciesOf(runs)).toEqual({
      document: 'export-pdf',
      spreadsheet: 'export-pdf',
      presentation: 'export-pdf',
      drawing: 'export-pdf',
    });
  });
});

describe('the update body', () => {
  it('accepts per-kind formats alone, and proposes nothing the rule refuses', () => {
    const parsed = UpdateMappingSchema.parse({ sourceConfig: { nativeFilePolicies: PER_KIND } });
    expect(parsed.sourceConfig?.nativeFilePolicies).toEqual(PER_KIND);
    expect(refusalsFor(proposedRevisions(parsed))).toEqual([]);
  });

  it('clears the per-kind formats when one format is chosen for all four', () => {
    expect(exportFormatOverride({ nativeFilePolicy: 'export-pdf' })).toEqual({
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: {},
    });
    expect(exportFormatOverride({ nativeFilePolicy: '' })).toEqual({});
  });
});

async function overrideOf(): Promise<unknown> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT source_config_override AS o FROM mailbox_mapping WHERE id = $1', [
      MAPPING,
    ]);
    return (r.rows[0] as { o: unknown }).o;
  } finally {
    await conn.release();
  }
}

describe('the update route, against a real row', () => {
  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    const conn = await driver.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'per kind']);
      // The connection a first migration created: decks as ODF.
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source','google','g',$3::jsonb,'connected',$4)`,
        [
          CONN,
          TENANT,
          JSON.stringify({
            type: 'google',
            user: ACCOUNT,
            nativeFilePolicy: 'export-office',
            nativeFilePolicies: { presentation: 'export-odf' },
          }),
          JSON.stringify(
            SecretStore.encryptCredentials({ clientId: 'c', clientSecret: 's', refreshToken: 'r' })
              .encrypted,
          ),
        ],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user',$4)`,
        [BOX, TENANT, CONN, ACCOUNT],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused')`,
        [MAPPING, TENANT, BOX],
      );
    } finally {
      await conn.release();
    }
    // The full migration chain on a fresh cluster; see `mapping-status-audit`.
  }, 120_000);

  afterAll(async () => {
    await driver.end?.();
  });

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      // Whose data this mapping moves rides the same column, and must survive.
      await conn.query(`UPDATE mailbox_mapping SET source_config_override = $1::jsonb`, [
        JSON.stringify({ user: ACCOUNT }),
      ]);
    } finally {
      await conn.release();
    }
  });

  it('merges per-kind formats into this mapping’s own override', async () => {
    const res = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { document: 'export-office' } } });
    expect(res.status).toBe(200);
    expect(await overrideOf()).toEqual({
      user: ACCOUNT,
      nativeFilePolicies: { document: 'export-office' },
    });
  });

  it('clears them when one format is chosen for all four, so the connection’s cannot show through', async () => {
    await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { document: 'export-office' } } });
    const res = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicy: 'export-pdf' } });
    expect(res.status).toBe(200);
    expect(await overrideOf()).toEqual({
      user: ACCOUNT,
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: {},
    });

    // And the page reads back what a pass will run: PDF for all four, not
    // the connection's ODF for decks.
    const detail = await request(app).get(`/api/migrations/${MAPPING}`);
    expect(detail.status).toBe(200);
    expect(nativeFilePoliciesOf(parseGoogleDriveSource(detail.body.sourceConfig))).toEqual({
      document: 'export-pdf',
      spreadsheet: 'export-pdf',
      presentation: 'export-pdf',
      drawing: 'export-pdf',
    });
  });

  it('echoes the per-kind formats on the detail route', async () => {
    await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: PER_KIND } });
    const detail = await request(app).get(`/api/migrations/${MAPPING}`);
    expect(detail.body.sourceConfig.nativeFilePolicies).toEqual(PER_KIND);
  });

  it('answers an unreadable format with a 400 naming the key, and writes nothing', async () => {
    for (const [sourceConfig, key] of [
      [{ nativeFilePolicy: 'export_office' }, 'sourceConfig.nativeFilePolicy'],
      [{ nativeFilePolicies: { slides: 'export-odf' } }, 'sourceConfig.nativeFilePolicies'],
    ] as const) {
      const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ sourceConfig });
      // Was a 500 saying WE failed, for a misspelling in the request.
      expect(res.status, key).toBe(400);
      const paths = (res.body.details as Array<{ path: string[] }>).map((d) => d.path.join('.'));
      expect(paths).toContain(key);
    }
    expect(await overrideOf()).toEqual({ user: ACCOUNT });
  });
});
