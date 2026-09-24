// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE APPLIANCE'S DATA TYPES ARE ROWS NOW (workplan 0128 T5, slice 2a), on the
 * real appliance on PGlite.
 *
 * Its data types lived only in its configuration file: no scope rows, so no
 * path rows, and its Start and Finish wrote the migration's status with a raw
 * UPDATE that moved no path and left no record. A cutover per data type keeps
 * each data type's phase in its path row, so the appliance must have them:
 *
 *   1. at every start-up, a scope row per data type the file names, included
 *      as the file has it, and no path rows for a draft;
 *   2. Start and Finish through the ledger's own door: the status, its paths
 *      and an audit record in one transaction, as managed writes them;
 *   3. a migration started before this version gets its rows at the next
 *      start-up, from its status.
 *
 * The connectors point at port 1 and the schedule never fires. Start's first
 * pass fails at once against port 1, and nothing here reads what it wrote.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver, MAPPING_STATUS_ACTION } from '@openmig/ledger';
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

const TENANT = '00000000-0000-4000-8000-000000000652';
const MAPPING = '65265265-2652-4652-8652-652652652652';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

const dav = (type: 'caldav' | 'carddav', enabled: boolean) => ({
  enabled,
  source: {
    type,
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  target: {
    type,
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
});

/** One mapping: calendars on, contacts named but switched off. */
function configDir(): string {
  const dir = tempDir('ownpace-rows-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav('caldav', true).source,
      target: dav('caldav', true).target,
      domains: { calendar: dav('caldav', true), contacts: dav('carddav', false) },
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({
    persistence: 'pglite',
    pgliteDataDir: dataDir,
    configDir: cfg,
    port: 0,
    host: '127.0.0.1',
  });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

/** Run SQL against a stopped appliance's PGlite as the database's own user. */
async function asTheDatabase(dataDir: string, sql: string, params: unknown[] = []) {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
    await driver.end();
  }
}

const scopeOf = (dataDir: string) =>
  asTheDatabase(dataDir, `SELECT domain, included FROM scope_selection WHERE mapping_id = $1 ORDER BY domain`, [ROW]);
const pathsOf = (dataDir: string) =>
  asTheDatabase(
    dataDir,
    `SELECT domain, state, ended_at IS NOT NULL AS ended FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
    [ROW],
  );
const recordsOf = (dataDir: string) =>
  asTheDatabase(dataDir, `SELECT actor, detail FROM audit_log WHERE action = $1 ORDER BY at`, [
    MAPPING_STATUS_ACTION,
  ]);

describe("the appliance's data types, as rows", () => {
  it('are written at start-up as the file names them, and a draft has no path rows', async () => {
    const dataDir = tempDir('ownpace-rows-db-');
    const { handle } = await boot(configDir(), dataDir);
    await handle.stop();

    const scope = await scopeOf(dataDir);
    expect(scope.filter((s) => s.included).map((s) => s.domain)).toEqual(['calendar']);
    expect(scope.find((s) => s.domain === 'contact')).toEqual({ domain: 'contact', included: false });
    expect(await pathsOf(dataDir)).toEqual([]);
  }, 120_000);

  it('move with Start and Finish, through the ledger door, with a record of each', async () => {
    const dataDir = tempDir('ownpace-rows-press-db-');
    const { handle, base } = await boot(configDir(), dataDir);
    try {
      expect((await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
      const finished = await fetch(`${base}/mappings/${MAPPING}/finish`, { method: 'POST' });
      expect(finished.status).toBe(200);
    } finally {
      await handle.stop();
    }

    expect(await pathsOf(dataDir)).toEqual([{ domain: 'calendar', state: 'done', ended: true }]);
    expect(await recordsOf(dataDir)).toEqual([
      { actor: 'operator', detail: { mappingId: ROW, from: 'paused', to: 'active', via: 'start' } },
      { actor: 'operator', detail: { mappingId: ROW, from: 'active', to: 'done', via: 'finish' } },
    ]);
  }, 120_000);

  it('are given to a migration started before this version, at the next start-up', async () => {
    const dataDir = tempDir('ownpace-rows-older-db-');
    const first = await boot(configDir(), dataDir);
    await first.handle.stop();
    // As an older appliance's Start left it: running, with no path rows.
    await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [ROW]);
    await asTheDatabase(dataDir, `DELETE FROM path_lifecycle WHERE mapping_id = $1`, [ROW]);

    const again = await boot(configDir(), dataDir);
    await again.handle.stop();
    expect(await pathsOf(dataDir)).toEqual([{ domain: 'calendar', state: 'active', ended: false }]);
  }, 120_000);
});
