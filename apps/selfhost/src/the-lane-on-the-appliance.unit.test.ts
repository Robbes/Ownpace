// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CONTINUOUS LANE ON THE APPLIANCE (workplan 0128 D4 (a)), on the
 * real appliance on PGlite.
 *
 * The Finish page's *Keep copying* sends `PUT /mappings/{id}` with
 * `{"status": "continuous"}` to both editions, and the appliance answered it
 * 404: the owner's D4 said the appliance gets the same choice, and it had no
 * door for it. Now it has one, decided by the rule managed's update door asks
 * and written through the ledger's own door, entering the lane and nothing
 * else. Ending the lane is Finish's own door, as on managed.
 *
 * The cutover itself is the operator CLI's on this edition, so the test puts
 * the migration there through the ledger's door while the appliance is down,
 * as that CLI does. It is finished before the lane is entered, so nothing is
 * scheduled, and entering the lane is seen to schedule its passes. The connectors point at port 1 and the schedule never
 * fires: what is under test is the lifecycle, not a pass.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMappingStatusChange, pgliteDriver } from '@openmig/ledger';
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

// UUID family 0128f600-…, unused elsewhere in the repo.
const TENANT = '0128f600-e29b-41d4-a716-446655440001';
const MAPPING = '0128f600-e29b-41d4-a716-446655440002';
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

function configDir(): string {
  const dir = tempDir('ownpace-lane-cfg-');
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

/** The operator CLI's cutover, as it writes one: through the ledger's own door. */
async function cutOver(dataDir: string): Promise<void> {
  const driver = pgliteDriver({ dataDir });
  try {
    await applyMappingStatusChange(driver, TENANT, {
      mappingId: ROW,
      from: 'active',
      to: 'cutover',
      actor: 'cli',
      via: 'cutover',
    });
  } finally {
    await driver.end();
  }
}

const put = (base: string, body: unknown) =>
  fetch(`${base}/mappings/${MAPPING}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('the continuous lane on the appliance', () => {
  it('is entered through its own door after the cutover, refused before it, and ended through Finish', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-lane-db-');
    let booted = await boot(cfg, dataDir);
    try {
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
      // Before the cutover the source is still the authority: not yet.
      const early = await put(booted.base, { status: 'continuous' });
      expect(early.status).toBe(409);
      expect(((await early.json()) as { code: string }).code).toBe('before_cutover');
      // A move managed's update door makes (a pause) is not this door's: it
      // enters the lane and nothing else, so no state gets a second door here.
      const pause = await put(booted.base, { status: 'paused' });
      expect(pause.status).toBe(409);
      expect(((await pause.json()) as { code: string }).code).toBe('own_door');
    } finally {
      await booted.handle.stop();
    }

    await cutOver(dataDir);
    booted = await boot(cfg, dataDir);
    try {
      // A status and nothing else: the rest of a mapping is its file.
      expect((await put(booted.base, { status: 'continuous', schedule: 'x' })).status).toBe(400);
      expect((await put(booted.base, {})).status).toBe(400);
      // Every other move has its own door on this edition.
      const done = await put(booted.base, { status: 'done' });
      expect(done.status).toBe(409);
      expect(((await done.json()) as { code: string }).code).toBe('own_door');

      // Finished first, so nothing is scheduled: the lane is entered from
      // `done` as well as from `cutover` (D3: Keep beside End), and entering
      // it must start the passes it runs.
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/finish`, { method: 'POST' })).status).toBe(200);
      const lines: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
      let kept: Response;
      try {
        kept = await put(booted.base, { status: 'continuous' });
      } finally {
        spy.mockRestore();
      }
      expect(kept.status).toBe(200);
      expect(await kept.json()).toEqual({ id: MAPPING, status: 'continuous', changed: true });
      expect(lines.some((l) => l.includes(`scheduled ${MAPPING}`))).toBe(true);
      const again = await put(booted.base, { status: 'continuous' });
      expect(await again.json()).toEqual({ id: MAPPING, status: 'continuous', changed: false });

      const status = (await (await fetch(`${booted.base}/status`)).json()) as {
        mappings: Array<{ mappingId: string; migrationStatus: string }>;
      };
      expect(status.mappings.find((m) => m.mappingId === MAPPING)?.migrationStatus).toBe('continuous');

      // In the lane, no update goes back before the cutover.
      const back = await put(booted.base, { status: 'paused' });
      expect(back.status).toBe(409);
      expect(((await back.json()) as { code: string }).code).toBe('after_cutover');

      // Ended through Finish's own door, as on managed.
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/finish`, { method: 'POST' })).status).toBe(200);
    } finally {
      await booted.handle.stop();
    }

    expect(await asTheDatabase(dataDir, `SELECT status FROM mailbox_mapping WHERE id = $1`, [ROW])).toEqual([
      { status: 'done' },
    ]);
    // Each move recorded, the lane's as an update by the operator.
    const moves = await asTheDatabase(
      dataDir,
      `SELECT actor, detail ->> 'from' AS "from", detail ->> 'to' AS "to", detail ->> 'via' AS via
         FROM audit_log WHERE action = 'mapping.status' ORDER BY at`,
    );
    expect(moves).toEqual([
      { actor: 'operator', from: 'paused', to: 'active', via: 'start' },
      { actor: 'cli', from: 'active', to: 'cutover', via: 'cutover' },
      { actor: 'operator', from: 'cutover', to: 'done', via: 'finish' },
      { actor: 'operator', from: 'done', to: 'continuous', via: 'update' },
      { actor: 'operator', from: 'continuous', to: 'done', via: 'finish' },
    ]);
    // The paths moved with it: in the lane they ran, and the finish ended them.
    const paths = await asTheDatabase(
      dataDir,
      `SELECT domain, state FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
      [ROW],
    );
    expect(paths).toEqual([
      { domain: 'calendar', state: 'done' },
      { domain: 'contact', state: 'done' },
    ]);
  }, 180_000);
});
