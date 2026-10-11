// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APPLY PRESSED AFTER CUTOVER, OVER THE APPLIANCE'S OWN HTTP (2026-10-05).
 *
 * The owner, 2026-10-05, asked *"should pressing Apply on a deletion or move
 * that was queued before cutover be refused?"*: **"Refuse after cutover
 * (Recommended)"**. Core refuses (`after_cutover`) with the question it is
 * handed; this boots the appliance against a real database, seeds the entries
 * a pass before the cutover would have left, moves the migration's own row the
 * way execute and a rollback move it, and asks the two routes and the two
 * queues what they now say.
 *
 * The items are ones a later gate refuses too (adopted bytes; a move already
 * kept), so a press that gets past the phase never reaches a target: which
 * refusal answers says where the phase is asked.
 *
 * UUID namespace 5e20 for this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';
import { uuidFromString } from './config-dir.ts';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// Its own database, as `selfhost-queues.integration` explains: the appliance
// migrates itself at startup and must find an empty one.
const DB_NAME = `selfhost_after_cutover_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const dbUrl = new URL(ADMIN_URL);
dbUrl.pathname = `/${DB_NAME}`;
const PG_CONNECTION_STRING = dbUrl.toString();

const TENANT_ID = '5e200000-e29b-41d4-a716-446655440001';
const MAPPING_ID = '5e200000-e29b-41d4-a716-446655440002';
const LEDGER_MAPPING_ID = uuidFromString(`${TENANT_ID}:mapping:${MAPPING_ID}`);

const BINNED = '9'.repeat(64);
const KEPT_MOVE = 'a'.repeat(64);
const ARRIVAL = 'b'.repeat(64);

let handle: SelfhostHandle;
let pool: Pool;
let base: string;
let configDir: string;

const press = async (path: string) => {
  const res = await fetch(`${base}${path}`, { method: 'POST' });
  return { status: res.status, body: (await res.json()) as { error?: string; reason?: string } };
};
const queue = async (path: string) =>
  ((await (await fetch(`${base}${path}`)).json()) as Record<string, { afterCutover?: string[] }>)[MAPPING_ID];
const setStatus = (status: string) =>
  pool.query(`UPDATE mailbox_mapping SET status = $1 WHERE id = $2`, [status, LEDGER_MAPPING_ID]);

beforeAll(async () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: PG_CONNECTION_STRING });

  configDir = mkdtempSync(join(tmpdir(), 'ownpace-after-cutover-cfg-'));
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT_ID,
      mappingId: MAPPING_ID,
      // 31 February: a valid cron that never fires. Nothing may sync here.
      schedule: { cron: '0 5 31 2 *' },
      // On: the case in which anything is removed at all.
      allowApplyDeletions: true,
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
      domains: {},
    }),
  );
  process.env.OPENMIG_TEST_NOPE = 'x';

  handle = await start({
    persistence: 'postgres',
    databaseUrl: PG_CONNECTION_STRING,
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;

  // A message the leaver binned at the old system, whose copy on the target
  // was already there when we arrived (gate 4 refuses it too); and a message
  // whose relocation the owner already answered with keep.
  await pool.query(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                       content_hash, target_ref, deletion_trashed_at)
     VALUES ($1, $2, 'email', 'INBOX', 'binned', $3, 'adopted', 'h-binned', jsonb_build_object('id', 't-binned'), now())`,
    [TENANT_ID, LEDGER_MAPPING_ID, BINNED],
  );
  await pool.query(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                       content_hash, target_ref, moved_to_collection, moved_to_natural_key_hash, move_acknowledged_at)
     VALUES ($1, $2, 'email', 'INBOX', 'kept', $3, 'copied', 'h-pair', jsonb_build_object('id', 't-kept'), 'INBOX', $4, now()),
            ($1, $2, 'email', 'INBOX', 'arrival', $4, 'copied', 'h-pair', jsonb_build_object('id', 't-arrival'), NULL, NULL, NULL)`,
    [TENANT_ID, LEDGER_MAPPING_ID, KEPT_MOVE, ARRIVAL],
  );
}, 180_000);

afterAll(async () => {
  await handle?.stop();
  await pool?.end();
  if (configDir) rmSync(configDir, { recursive: true, force: true });
  delete process.env.OPENMIG_TEST_NOPE;
  const cleanup = new Pool({ connectionString: ADMIN_URL });
  try {
    await cleanup.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME],
    );
    await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  } finally {
    await cleanup.end();
  }
});

describe("the appliance's apply routes, after cutover", () => {
  it('before cutover, a press reaches the gates after the phase, and both queues name no data type', async () => {
    await setStatus('active');
    expect((await press(`/mappings/${MAPPING_ID}/deletions/${BINNED}/apply`)).body.error).toBe('not_ours');
    expect((await press(`/mappings/${MAPPING_ID}/moves/${KEPT_MOVE}/apply`)).body.error).toBe('already_kept');
    expect((await queue('/deletions'))?.afterCutover).toEqual([]);
    expect((await queue('/moves'))?.afterCutover).toEqual([]);
  });

  it('in continuous, both presses are refused 403 after_cutover, and both queues name every data type', async () => {
    await setStatus('continuous');
    const deletion = await press(`/mappings/${MAPPING_ID}/deletions/${BINNED}/apply`);
    expect(deletion.status).toBe(403);
    expect(deletion.body.error).toBe('after_cutover');
    expect(deletion.body.reason).toMatch(/no longer decides what exists/);
    const move = await press(`/mappings/${MAPPING_ID}/moves/${KEPT_MOVE}/apply`);
    expect(move.status).toBe(403);
    expect(move.body.error).toBe('after_cutover');
    expect((await queue('/deletions'))?.afterCutover).toEqual([...DISCOVERY_DOMAINS]);
    expect((await queue('/moves'))?.afterCutover).toEqual([...DISCOVERY_DOMAINS]);
  });

  it('after a rollback the old system decides again, and the presses reach the later gates once more', async () => {
    // ADR-0047: a rollback puts the migration back to `active`.
    await setStatus('active');
    expect((await press(`/mappings/${MAPPING_ID}/deletions/${BINNED}/apply`)).body.error).toBe('not_ours');
    expect((await queue('/moves'))?.afterCutover).toEqual([]);
  });
});
