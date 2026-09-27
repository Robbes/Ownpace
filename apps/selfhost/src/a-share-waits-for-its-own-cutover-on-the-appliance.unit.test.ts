// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE WAITS FOR ITS OWN DATA TYPE'S CUTOVER, ON THE APPLIANCE (ADR-0032
 * §5; workplan 0128 T5, slice 6, the owner's D8), on the real appliance on
 * PGlite.
 *
 * Its calendars are cut over on their own while its files keep running: a
 * calendar share passes the gate and a file share does not, one row at a time
 * and in the one-go press, which leaves the file share open for the files' own
 * cutover. (The announcement of the shares carried by hand, one wave per data
 * type, is `each-data-type-announced-once-on-the-appliance.unit.test.ts`'s.)
 *
 * The target points at port 1, so a share that passes the gate is refused by
 * the target (`target_refused`): what is under test is the gate, whose own
 * refusal is `not_cut_over`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { notCutOverReason } from '@openmig/core';
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

// UUID family 0128f900-…, unused elsewhere in the repo.
const TENANT = '0128f900-e29b-41d4-a716-446655440001';
const MAPPING = '0128f900-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));
const CALENDAR_SHARE = '0128f900-e29b-41d4-a716-446655440011';
const FILE_SHARE = '0128f900-e29b-41d4-a716-446655440012';
const FOLDER = '0128f900-e29b-41d4-a716-446655440013';
const IN_FOLDER = '0128f900-e29b-41d4-a716-446655440014';
const TO_ANNA = { 'anna@example.invalid': 'anna@example.invalid' };

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
  const dir = tempDir('ownpace-share-cfg-');
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

/** The migration's phases, written as a cutover of one data type leaves them. */
async function phases(dataDir: string, status: string, calendar: string, file: string): Promise<void> {
  await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [ROW, status]);
  await asTheDatabase(dataDir, `UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'calendar'`, [
    ROW,
    calendar,
  ]);
  await asTheDatabase(dataDir, `UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'file'`, [
    ROW,
    file,
  ]);
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/mappings/${MAPPING}/sharing/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const apply = (base: string, id: string) => post(base, `${id}/decision`, { action: 'apply' });

describe('a share waits for its own data type’s cutover on the appliance', () => {
  it('a calendar share once calendars are cut over, and a file share at the files’ own', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-share-db-');
    let booted = await boot(cfg, dataDir);
    try {
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
    } finally {
      await booted.handle.stop();
    }
    for (const [id, subject, on, grantee] of [
      [CALENDAR_SHARE, 'calendar', 'Team planning', 'cas@example.invalid'],
      [FILE_SHARE, 'drive_item', 'Projects/budget.xlsx', 'anna@example.invalid'],
    ] as const) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict, verdict_target)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'read', '{}', 'clean', 'a Nextcloud share')`,
        [id, TENANT, ROW, `hash-${subject}`, subject, on, grantee],
      );
    }
    // A shared folder and a file in it, shared with the same person: one folder press.
    for (const [id, on, itemKey, parentKey, container] of [
      [FOLDER, 'Shared/Photos', 'F', 'root', true],
      [IN_FOLDER, 'Shared/Photos/one.jpg', 'c1', 'F', false],
    ] as const) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict,
           verdict_target, item_key, parent_key, is_container)
         VALUES ($1, $2, $3, $4, 'drive_item', $5, 'anna@example.invalid', 'read', '{}', 'clean', 'a Nextcloud share',
           $6, $7, $8)`,
        [id, TENANT, ROW, `hash-${itemKey}`, on, itemKey, parentKey, container],
      );
    }
    // Calendars cut over on their own; the files still run; the migration is active.
    await phases(dataDir, 'active', 'cutover', 'active');

    booted = await boot(cfg, dataDir);
    try {
      const calendar = await apply(booted.base, CALENDAR_SHARE);
      expect(calendar.status).toBe(409);
      expect(calendar.body.error).toBe('target_refused');

      const file = await apply(booted.base, FILE_SHARE);
      expect(file).toEqual({
        status: 409,
        body: { error: 'not_cut_over', reason: notCutOverReason(['drive_item']) },
      });

      const press = await post(booted.base, 'apply-all', {});
      expect(press.status).toBe(200);
      expect(press.body).toMatchObject({ applied: [], waitingForCutover: 3 });
      expect((press.body.refused as Array<{ id: string; code: string }>).map((r) => [r.id, r.code])).toEqual([
        [CALENDAR_SHARE, 'target_refused'],
      ]);

      const folder = await post(booted.base, 'apply-folder', { parentKey: 'F', confirmed: TO_ANNA });
      expect(folder).toEqual({ status: 409, body: { error: 'not_cut_over', reason: notCutOverReason(['drive_item']) } });
    } finally {
      await booted.handle.stop();
    }

    // The files cut over too: the migration is in its cutover, not yet done.
    await phases(dataDir, 'cutover', 'cutover', 'cutover');
    booted = await boot(cfg, dataDir);
    try {
      const file = await apply(booted.base, FILE_SHARE);
      expect(file.body.error).toBe('target_refused');
      const folder = await post(booted.base, 'apply-folder', { parentKey: 'F', confirmed: TO_ANNA });
      expect(folder.status).toBe(200);
      expect((folder.body.refused as Array<{ code: string }>).map((r) => r.code)).toEqual(['target_refused', 'target_refused']);
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);
});
