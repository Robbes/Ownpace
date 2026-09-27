// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE ENDED OR KEPT ON THE APPLIANCE (workplan 0128 T3, T5 slice 7;
 * the owner's D3, D4 and D8), on the real appliance on PGlite.
 *
 * Its End and Keep go through the ledger's own door, as managed's do. With the
 * last data type ended the migration is done: the appliance stops scheduling
 * it and says so once, as its Finish does. A data type kept copying after that
 * brings the schedule back. End counts the data type's own open failures,
 * unless forced.
 *
 * The connectors point at port 1 and the schedule never fires: what is under
 * test is the door, not a pass.
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

// UUID family 0128e300-…, unused elsewhere in the repo.
const TENANT = '0128e300-e29b-41d4-a716-446655440001';
const MAPPING = '0128e300-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

const side = (type: 'caldav' | 'webdav', user: string) => ({
  type,
  url: 'http://127.0.0.1:1/remote.php/dav',
  user,
  auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
});
const domain = (type: 'caldav' | 'webdav') => ({
  enabled: true,
  source: side(type, 'source'),
  target: side(type, 'target'),
});

/** Calendars and files, both on. */
function configDir(): string {
  const dir = tempDir('ownpace-ending-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: side('caldav', 'source'),
      target: side('caldav', 'target'),
      domains: { calendar: domain('caldav'), files: domain('webdav') },
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

async function press(base: string, ending: 'end' | 'keep', domain: string, { force = false, mapping = MAPPING } = {}) {
  const res = await fetch(`${base}/mappings/${mapping}/domains/${domain}/${ending}${force ? '?force=true' : ''}`, {
    method: 'POST',
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function migrationStatus(base: string): Promise<string | undefined> {
  const status = (await (await fetch(`${base}/status`)).json()) as {
    mappings: Array<{ mappingId: string; migrationStatus: string }>;
  };
  return status.mappings.find((m) => m.mappingId === MAPPING)?.migrationStatus;
}

/** What the appliance logged while `work` ran. */
async function logged<T>(work: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    return { result: await work(), lines };
  } finally {
    spy.mockRestore();
  }
}

describe('a data type ended or kept on the appliance', () => {
  it('ends and keeps each data type on its own; the last one ended finishes the migration, and a Keep brings it back', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-ending-db-');
    let booted = await boot(cfg, dataDir);
    try {
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
      const notify = vi.spyOn(booted.handle.notifier, 'notify');

      // One data type ended while the other runs: the migration goes on, scheduled, and nothing is said.
      const first = await logged(() => press(booted.base, 'end', 'calendar'));
      expect(first.result).toEqual({
        status: 200,
        body: { id: MAPPING, domain: 'calendar', ending: 'end', changed: true, from: 'active', to: 'done', slotsTaken: false },
      });
      expect(first.lines.some((l) => l.includes(`unscheduled ${MAPPING}`))).toBe(false);
      expect(notify).not.toHaveBeenCalled();
      expect((await press(booted.base, 'keep', 'file')).body).toMatchObject({
        changed: true,
        from: 'active',
        to: 'continuous',
        migration: { from: 'active', to: 'continuous' },
      });
      expect(await migrationStatus(booted.base)).toBe('continuous');

      // The last one ended: the migration is done, no longer scheduled, and said so once.
      const ended = await logged(() => press(booted.base, 'end', 'file'));
      expect(ended.result.body).toMatchObject({ changed: true, migration: { from: 'continuous', to: 'done' } });
      expect(ended.lines.some((l) => l.includes(`unscheduled ${MAPPING}`))).toBe(true);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(await migrationStatus(booted.base)).toBe('done');

      // Asked again, nothing changes and nothing is said.
      expect((await press(booted.base, 'end', 'file')).body).toMatchObject({ changed: false, phase: 'done' });
      expect(notify).toHaveBeenCalledTimes(1);
      notify.mockRestore();

      // A data type kept after the finish takes its slot and its schedule back.
      const kept = await logged(() => press(booted.base, 'keep', 'calendar'));
      expect(kept.result.body).toMatchObject({ changed: true, from: 'done', to: 'continuous', slotsTaken: true });
      expect(kept.lines.some((l) => l.includes(`scheduled ${MAPPING}`))).toBe(true);
      expect(await migrationStatus(booted.base)).toBe('continuous');

      // The rest is answered in words, and what is not there is not.
      expect((await press(booted.base, 'end', 'contact')).body).toMatchObject({ error: 'end_refused', refused: 'not_a_path' });
      expect((await press(booted.base, 'end', 'photos')).status).toBe(400);
      expect((await press(booted.base, 'end', 'calendar', { mapping: '0128e300-e29b-41d4-a716-446655440099' })).status).toBe(404);
    } finally {
      await booted.handle.stop();
    }

    // A failure of the calendars, waiting on a decision: End waits on it, unless forced. One
    // still being retried, and one of the files, are not the calendars' to wait on.
    await asTheDatabase(
      dataDir,
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, attempt_count, last_error)
       VALUES ($1, $2, 'calendar', 'c', 'k1', 'k1', 'failed', 5, 'refused'),
              ($1, $2, 'calendar', 'c', 'k2', 'k2', 'failed', 1, 'refused'),
              ($1, $2, 'file', 'c', 'k3', 'k3', 'failed', 5, 'refused')`,
      [TENANT, ROW],
    );
    booted = await boot(cfg, dataDir);
    try {
      const refused = await press(booted.base, 'end', 'calendar');
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: 'end_refused', refused: 'unresolved_failures', count: 1, forceable: true });
      expect((await press(booted.base, 'end', 'calendar', { force: true })).body).toMatchObject({
        changed: true,
        to: 'done',
        migration: { to: 'done' },
      });
    } finally {
      await booted.handle.stop();
    }
    // Each move is the operator's.
    expect(await asTheDatabase(dataDir, `SELECT DISTINCT actor FROM audit_log WHERE action = 'path.phase'`)).toEqual([
      { actor: 'operator' },
    ]);
  }, 180_000);
});
