// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE STOPPED ON THE APPLIANCE (workplan 0128 T4, T5 slice 3b; the
 * owner's D4: *"the appliance gets the same choice … with a stopped data type
 * kept in its own database"*), on the real appliance on PGlite.
 *
 * Its stop and resume go through the ledger's own door, as managed's do. The
 * stop lives in the appliance's database, not in its configuration file, so it
 * survives a restart, and the start-up that switches on every data type the
 * file names does not undo it. The next pass moves past it and says so, and
 * the check that everything arrived skips it, *stopped by you* (D6).
 *
 * The connectors point at port 1 and the schedule never fires: what is under
 * test is which data types a pass takes, not whether they succeed.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver, PATH_STATUS_ACTION } from '@openmig/ledger';
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

// UUID family 0128f200-…, unused elsewhere in the repo.
const TENANT = '0128f200-e29b-41d4-a716-446655440001';
const MAPPING = '0128f200-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

const dav = (type: 'caldav' | 'carddav') => ({
  enabled: true,
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

/** Calendars and contacts, both on. */
function configDir(): string {
  const dir = tempDir('ownpace-stop-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav('caldav').source,
      target: dav('caldav').target,
      domains: { calendar: dav('caldav'), contacts: dav('carddav') },
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: cfg, port: 0, host: '127.0.0.1' });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

async function asTheDatabase(dataDir: string, text: string, params: unknown[] = []) {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
    await driver.end();
  }
}

const press = (base: string, action: 'stop' | 'resume', domain: string) =>
  fetch(`${base}/mappings/${MAPPING}/domains/${domain}/${action}`, { method: 'POST' });

describe('a data type stopped on the appliance', () => {
  it('is stopped and resumed through the ledger door, refused as the last one, and kept across a restart', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-stop-db-');
    let booted = await boot(cfg, dataDir);
    try {
      // Not while the migration is a draft: it does not run yet.
      const early = await press(booted.base, 'stop', 'calendar');
      expect(early.status).toBe(409);
      expect(((await early.json()) as { refused: string }).refused).toBe('not_running');

      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
      const stopped = await press(booted.base, 'stop', 'calendar');
      expect(stopped.status).toBe(200);
      expect(await stopped.json()).toEqual({ id: MAPPING, domain: 'calendar', stopped: true, changed: true });

      // D5: contacts are the last data type still copying.
      const last = await press(booted.base, 'stop', 'contact');
      expect(last.status).toBe(409);
      expect(((await last.json()) as { message: string }).message).toMatch(/end the migration instead/);

      expect((await press(booted.base, 'stop', 'photos')).status).toBe(400);
    } finally {
      await booted.handle.stop();
    }

    // The stop lives in the database, and a start-up does not undo it.
    booted = await boot(cfg, dataDir);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      const run = await fetch(`${booted.base}/mappings/${MAPPING}/run`, { method: 'POST' });
      expect(run.status, await run.clone().text()).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(lines.some((l) => l.includes('skipped calendar: you stopped this data type'))).toBe(true);

    // D6: the check that everything arrived skips it, and says why.
    try {
      expect((await fetch(`${booted.base}/verify/start`, { method: 'POST' })).status).toBe(202);
      const until = Date.now() + 60_000;
      let finished: { state: string; report?: Record<string, { calendar: { status: string; issues: Array<{ message: string }> } }> };
      for (;;) {
        finished = (await (await fetch(`${booted.base}/verify/report`)).json()) as typeof finished;
        if (finished.state === 'done' || finished.state === 'failed') break;
        if (Date.now() > until) throw new Error(`verify never finished: ${finished.state}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(finished.state).toBe('done');
      const calendar = finished.report![MAPPING]!.calendar;
      expect(calendar.status).toBe('SKIPPED');
      expect(calendar.issues.map((i) => i.message).join(' ')).toContain('stopped by you');
    } finally {
      await booted.handle.stop();
    }

    const paths = await asTheDatabase(
      dataDir,
      `SELECT domain, stopped_at IS NOT NULL AS stopped FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
      [ROW],
    );
    expect(paths).toEqual([
      { domain: 'calendar', stopped: true },
      { domain: 'contact', stopped: false },
    ]);
    const shown = await asTheDatabase(
      dataDir,
      `SELECT state FROM migration_status WHERE mapping_id = $1 AND domain = 'calendar'`,
      [ROW],
    );
    expect(shown).toEqual([{ state: 'stopped' }]);

    // And resumed, recorded as the operator's.
    booted = await boot(cfg, dataDir);
    try {
      const resumed = await press(booted.base, 'resume', 'calendar');
      expect(await resumed.json()).toEqual({ id: MAPPING, domain: 'calendar', stopped: false, changed: true });
    } finally {
      await booted.handle.stop();
    }
    const records = await asTheDatabase(
      dataDir,
      `SELECT actor, detail ->> 'domain' AS domain, detail ->> 'to' AS "to" FROM audit_log WHERE action = $1 ORDER BY at`,
      [PATH_STATUS_ACTION],
    );
    expect(records).toEqual([
      { actor: 'operator', domain: 'calendar', to: 'stopped' },
      { actor: 'operator', domain: 'calendar', to: 'running' },
    ]);
  }, 180_000);
});
