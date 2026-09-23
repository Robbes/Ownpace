// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A data type the mapping file switched off is said, not refused
 * (workplan 0125 T7), on the real appliance on PGlite.
 *
 * The owner, 2026-09-23: *"don't refuse but do the 3 steps"*. Two of the three
 * live in this edition's startup, and they are pinned here end to end:
 *
 *   1. at startup, one line per switched-off data type that has copies: how
 *      many stay, that they no longer follow the source, and that switching
 *      it back on continues where it stopped;
 *   2. `/status` says `stopped`, with that count, from the moment the
 *      appliance is up, where every pass used to write `skipped`.
 *
 * And the two edges of both: a data type switched back on stops saying
 * `stopped` at the same moment, and a finished migration is left as it was.
 *
 * The connectors point at port 1 and the schedule never fires: nothing here
 * is about a pass. The copies are written into the ledger by hand, between
 * two boots, the way `a-second-mapping-in-a-tenant-is-not-the-first` moves a
 * row.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from '@openmig/shared';
import { pgliteDriver } from '@openmig/ledger';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

/** Temp directories this file makes, removed at the end (see workplan 0099's sweep). */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const TENANT = '00000000-0000-4000-8000-000000000570';
const MAPPING = '57575757-5757-4575-8575-575757575757';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

const dav = (enabled: boolean) => ({
  enabled,
  source: {
    type: 'caldav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'source',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
  target: {
    type: 'caldav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'target',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  },
});

/** A config dir holding one mapping, with its calendar switched on or off. */
function configDir(calendar: boolean): string {
  const dir = tempDir('ownpace-switched-off-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav(true).source,
      target: dav(true).target,
      domains: { calendar: dav(calendar) },
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
async function asTheDatabase(dataDir: string, sql: string, params: unknown[] = []): Promise<void> {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    await conn.query(sql, params);
  } finally {
    conn.release();
    await driver.end();
  }
}

/** A migration whose calendar copied `copied` items and failed one, left at `lifecycle`. */
async function withCopies(dataDir: string, copied: number, lifecycle: string): Promise<void> {
  for (let i = 0; i < copied; i++) {
    await asTheDatabase(
      dataDir,
      `INSERT INTO item
         (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status)
       VALUES ($1,$2,'calendar','calendar','',$3,$3,'copied')`,
      [TENANT, ROW, `event-${i}`],
    );
  }
  await asTheDatabase(
    dataDir,
    `INSERT INTO item
       (tenant_id, mapping_id, domain, item_type, collection, natural_key, natural_key_hash, status)
     VALUES ($1,$2,'calendar','calendar','','broken','broken','failed')`,
    [TENANT, ROW],
  );
  await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [ROW, lifecycle]);
}

async function calendarOf(base: string): Promise<{ state: string; itemsSynced: number } | undefined> {
  const body = (await (await fetch(`${base}/status`)).json()) as {
    mappings: Array<{ mappingId: string; domains: Array<{ domain: string; state: string; itemsSynced: number }> }>;
  };
  return body.mappings
    .find((m) => m.mappingId === MAPPING)
    ?.domains.find((d) => d.domain === 'calendar');
}

/** Every line the appliance says at info level while `fn` runs. */
async function linesDuring<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  vi.spyOn(log, 'info').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  const result = await fn();
  return { result, lines };
}

const SWITCHED_OFF = /domains\.calendar is switched off/;

describe('a calendar switched off after copying', () => {
  it('is said at startup and is stopped on /status, with how many copies stay', async () => {
    const dataDir = tempDir('ownpace-switched-off-db-');
    const first = await boot(configDir(true), dataDir);
    await first.handle.stop();
    await withCopies(dataDir, 3, 'paused');

    const { result: booted, lines } = await linesDuring(() => boot(configDir(false), dataDir));
    try {
      expect(lines.filter((l) => SWITCHED_OFF.test(l))).toEqual([
        `[selfhost] ${MAPPING}: domains.calendar is switched off. Its 3 copies stay on the ` +
          'target and no longer follow the source; switching it back on continues where it stopped.',
      ]);
      // The failure is not a copy: three stay, not four.
      expect(await calendarOf(booted.base)).toMatchObject({ state: 'stopped', itemsSynced: 3 });
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);

  it('switched back on, says nothing and is pending until its next pass', async () => {
    const dataDir = tempDir('ownpace-switched-back-db-');
    const first = await boot(configDir(true), dataDir);
    await first.handle.stop();
    await withCopies(dataDir, 2, 'paused');
    const off = await boot(configDir(false), dataDir);
    try {
      expect((await calendarOf(off.base))?.state).toBe('stopped');
    } finally {
      await off.handle.stop();
    }

    const { result: on, lines } = await linesDuring(() => boot(configDir(true), dataDir));
    try {
      expect(lines.filter((l) => SWITCHED_OFF.test(l))).toEqual([]);
      expect(await calendarOf(on.base)).toMatchObject({ state: 'pending', itemsSynced: 2 });
    } finally {
      await on.handle.stop();
    }
  }, 120_000);

  it('in a finished migration, is neither said nor rewritten', async () => {
    const dataDir = tempDir('ownpace-switched-off-done-db-');
    const first = await boot(configDir(true), dataDir);
    await first.handle.stop();
    await withCopies(dataDir, 4, 'done');
    await asTheDatabase(
      dataDir,
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state) VALUES ($1,$2,'calendar','completed')`,
      [TENANT, ROW],
    );

    const { result: booted, lines } = await linesDuring(() => boot(configDir(false), dataDir));
    try {
      expect(lines.filter((l) => SWITCHED_OFF.test(l))).toEqual([]);
      expect((await calendarOf(booted.base))?.state).toBe('completed');
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);
});
