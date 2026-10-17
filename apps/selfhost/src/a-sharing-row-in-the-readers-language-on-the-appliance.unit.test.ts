// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARING ROW IN THE READER'S LANGUAGE, ON THE APPLIANCE (UX sweep,
 * 2026-10-17), on the real appliance on PGlite.
 *
 * The managed GET says each row's line in Dutch beside the stored English, as
 * `verdictTargetNl`; the appliance serves the same screen, so it answers the
 * same field (`a-sharing-row-in-the-readers-language.unit.test.ts` in
 * apps/api holds the managed half). The stored English reaches the answer
 * unchanged: the manual-only refusal quotes it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// UUID family 0159d5b0-…, unused elsewhere in the repo.
const TENANT = '0159d5b0-e29b-41d4-a716-446655440001';
const MAPPING = '0159d5b0-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));
const SHARE = '0159d5b0-e29b-41d4-a716-446655440011';

/** What the queue stores: the English target, with the developer note glued on. */
const STORED = 'a Nextcloud share with edit permission — A per-person file or folder share exists on both sides.';

const side = (user: string) => ({
  type: 'webdav',
  url: 'http://127.0.0.1:1/remote.php/dav',
  user,
  auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
});

function configDir(): string {
  const dir = tempDir('ownpace-share-nl-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: side('source'),
      target: side('target'),
      domains: { files: { enabled: true, source: side('source'), target: side('target') } },
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: cfg, port: 0, host: '127.0.0.1' });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

async function asTheDatabase(dataDir: string, text: string, params: unknown[] = []): Promise<void> {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    conn.release();
    await driver.end();
  }
}

describe('the appliance says each sharing row in Dutch beside the English', () => {
  it('GET /mappings/:id/sharing carries verdictTargetNl, without the note, and the stored English unchanged', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-share-nl-db-');
    let booted = await boot(cfg, dataDir);
    try {
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
    } finally {
      await booted.handle.stop();
    }
    await asTheDatabase(
      dataDir,
      `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict, verdict_target)
       VALUES ($1, $2, $3, 'hash-0159d5', 'drive_item', 'Projects/budget.xlsx', 'anna@example.invalid', 'writer', '{}', 'clean', $4)`,
      [SHARE, TENANT, ROW, STORED],
    );

    booted = await boot(cfg, dataDir);
    try {
      const res = await fetch(`${booted.base}/mappings/${MAPPING}/sharing`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { grants: Array<{ id: string; verdictTarget: string; verdictTargetNl?: string }> };
      expect(body.grants).toHaveLength(1);
      expect(body.grants[0]).toMatchObject({
        id: SHARE,
        verdictTarget: STORED,
        verdictTargetNl: 'een Nextcloud-deling met bewerkrechten',
      });
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);
});
