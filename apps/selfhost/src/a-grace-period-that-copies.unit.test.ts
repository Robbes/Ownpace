// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRACE PERIOD THAT COPIES, ON THE APPLIANCE (workplan 0128 T2; the owner,
 * 2026-09-24, D1 (a)).
 *
 * The operator's cutover CLI is the one executor for both editions
 * (ADR-0048), so an appliance's migration can be in `cutover` with a ledger
 * beside it. From execute until the grace period ends, it keeps being copied
 * there as it does on the managed edition: the appliance's gates ask
 * `runsPassesNow` with the same SQL the managed tick schedules by. This boots
 * the real appliance on PGlite with a migration in its grace period, presses
 * Sync now, and reads the run it wrote; then moves the grace period's start
 * back past its end, boots again, and is refused, with the reason.
 *
 * The connectors point at port 1, the honest failure the other appliance
 * tests build on: what is under test is whether a pass runs, not whether it
 * succeeds.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
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

const TENANT = '0128a000-e29b-41d4-a716-446655440101';
const MAPPING = '0128a000-e29b-41d4-a716-446655440102';
/** The row the appliance keeps for that mapping. */
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

function configDir(): string {
  const dir = tempDir('ownpace-grace-cfg-');
  writeFileSync(
    join(dir, 'grace.mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: {
        type: 'imap-oauth2',
        host: '127.0.0.1',
        port: 1,
        user: 'nobody@invalid',
        auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'http://127.0.0.1:1',
        user: 'nobody@invalid',
        auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
    }),
  );
  return dir;
}

/**
 * Boot the appliance, and say whether its startup scan scheduled the
 * migration: the line `scheduleMapping` prints is the one outside sign of it,
 * since the schedule (31 February) never fires.
 */
async function boot(
  config: string,
  dataDir: string,
): Promise<{ handle: SelfhostHandle; base: string; scheduledAtStartup: boolean }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: config, port: 0, host: '127.0.0.1' });
    return {
      handle,
      base: `http://127.0.0.1:${handle.port}`,
      scheduledAtStartup: lines.some((l) => l.includes(`[selfhost] scheduled ${MAPPING}`)),
    };
  } finally {
    spy.mockRestore();
  }
}

/** SQL against a stopped appliance's PGlite, as the database's own user. */
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

async function runsOf(base: string): Promise<number> {
  const body = (await (await fetch(`${base}/mappings/${MAPPING}/runs`)).json()) as { runs: unknown[] };
  return body.runs.length;
}

describe('a migration in cutover, on the appliance', () => {
  it('is copied through its grace period, and refused with the reason after it', async () => {
    const config = configDir();
    const dataDir = tempDir('ownpace-grace-db-');

    // Boot once so the appliance makes its rows, then place the cutover the
    // CLI's execute leaves: the mapping in `cutover`, the ledger in its grace
    // period, begun an hour ago, for a migration that was running.
    await (await boot(config, dataDir)).handle.stop();
    await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = 'cutover' WHERE id = $1`, [ROW]);
    await asTheDatabase(
      dataDir,
      `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                  grace_period_started_at, updated_at)
       VALUES ($1, $2, 'GRACE_PERIOD', 72, true, now() - interval '1 hour', now() - interval '1 hour')`,
      [TENANT, ROW],
    );

    let booted = await boot(config, dataDir);
    try {
      expect(booted.scheduledAtStartup, 'the startup scan schedules a migration in its grace period').toBe(true);
      const before = await runsOf(booted.base);
      const run = await fetch(`${booted.base}/mappings/${MAPPING}/run`, { method: 'POST' });
      expect(run.status, await run.clone().text()).toBe(200);
      // And the pass itself ran: its own re-read before starting asks the
      // same rule, so a gate that let the press through while the re-read
      // said no would leave no run behind.
      expect(await runsOf(booted.base)).toBe(before + 1);
    } finally {
      await booted.handle.stop();
    }

    // The grace period ended an hour ago.
    await asTheDatabase(
      dataDir,
      `UPDATE cutover_state SET grace_period_started_at = now() - interval '73 hours' WHERE mapping_id = $1`,
      [ROW],
    );
    booted = await boot(config, dataDir);
    try {
      expect(booted.scheduledAtStartup).toBe(false);
      const run = await fetch(`${booted.base}/mappings/${MAPPING}/run`, { method: 'POST' });
      expect(run.status).toBe(409);
      const body = (await run.json()) as { error: string; hint: string };
      expect(body.error).toContain("'cutover'");
      expect(body.hint).toContain('until its grace period ends');
    } finally {
      await booted.handle.stop();
    }

    // Inside the grace period again, but paused when execute ran: stopped.
    await asTheDatabase(
      dataDir,
      `UPDATE cutover_state SET grace_period_started_at = now() - interval '1 hour', copies_through_grace = false
        WHERE mapping_id = $1`,
      [ROW],
    );
    booted = await boot(config, dataDir);
    try {
      expect(booted.scheduledAtStartup).toBe(false);
      const run = await fetch(`${booted.base}/mappings/${MAPPING}/run`, { method: 'POST' });
      expect(run.status).toBe(409);
    } finally {
      await booted.handle.stop();
    }
  }, 180_000);
});
