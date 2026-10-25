// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PRESS THAT MEETS THE TARGET'S LIMIT ON NEW SHARES, ON THE APPLIANCE
 * (workplan 0104, Status of 2026-10-25), on the real appliance on PGlite.
 *
 * Nextcloud 31 to 35 let one account create 20 shares in 10 minutes, failed
 * attempts included, and answer the next one 429 with an empty OCS reply. The
 * appliance answers every other refusal in the target's words, for its owner;
 * a limit has none worth reading, so it is said in ours, in English and
 * Dutch, with when to apply again, and the presses stop at it as managed's
 * do: the rows from there wait, open and untried, and none is refused.
 *
 * The target is a server on this machine that answers as Nextcloud's limiter
 * does: a user attempt is a 404 (the grantee has no account), a share by mail
 * succeeds, and once `allowance` calls are spent every call is a 429.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { shareRefusalSaid } from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// UUID family 0104a430-…, unused elsewhere in the repo.
const TENANT = '0104a430-e29b-41d4-a716-446655440001';
const MAPPING = '0104a430-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));
const SHARES = ['0104a430-e29b-41d4-a716-446655440011', '0104a430-e29b-41d4-a716-446655440012', '0104a430-e29b-41d4-a716-446655440013'];

/** What `RateLimitingMiddleware` answers through OCS v2: status 429, no words. */
const LIMITED = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 429, message: '' }, data: [] } });

let allowance = 0;
let retryAfter: string | undefined;
/** Every share call that reached the target, as its share type. */
let reached: string[] = [];
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      // Only the share endpoint counts; anything else the appliance asks is not here.
      if (req.method !== 'POST' || !req.url?.startsWith('/ocs/v2.php/apps/files_sharing/api/v1/shares')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const shareType = new URLSearchParams(body).get('shareType') ?? '?';
      reached.push(shareType);
      if (allowance <= 0) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) });
        res.end(LIMITED);
        return;
      }
      allowance--;
      const ok = shareType === '4';
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ocs: { meta: ok ? { status: 'ok', statuscode: 200 } : { status: 'failure', statuscode: 404, message: 'no such account' } },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const side = (url: string, user: string) => ({
  type: 'webdav',
  url,
  user,
  auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
});

/** Files only: the source nowhere, the target the server above. */
function configDir(): string {
  const dir = tempDir('ownpace-limit-cfg-');
  const source = side('http://127.0.0.1:1/remote.php/dav', 'source');
  const target = side(`${base}/remote.php/dav/files/target/`, 'target');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source,
      target,
      domains: { files: { enabled: true, source, target } },
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

async function post(at: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${at}/mappings/${MAPPING}/sharing/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const LIMIT = (retryAfterSeconds?: number) =>
  shareRefusalSaid({
    kind: 'answered',
    status: 429,
    ocsStatus: 429,
    ocs: true,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });

describe("a press that meets the target's limit on new shares, on the appliance (0104)", () => {
  it('says the limit in our words, stops the press there, and tries the waiting rows after the window', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-limit-db-');
    let booted = await boot(cfg, dataDir);
    try {
      expect((await fetch(`${booted.base}/mappings/${MAPPING}/start`, { method: 'POST' })).status).toBe(200);
    } finally {
      await booted.handle.stop();
    }
    for (const [i, id] of SHARES.entries()) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict, verdict_target)
         VALUES ($1, $2, $3, $4, 'drive_item', $5, $6, 'read', '{}', 'clean', 'a Nextcloud share')`,
        [id, TENANT, ROW, `hash-${i}`, `Projects/item-${i + 1}.xlsx`, `outsider-${i + 1}@example.invalid`],
      );
    }
    // The files are cut over, so the gate lets a share through.
    await asTheDatabase(dataDir, `UPDATE mailbox_mapping SET status = 'cutover' WHERE id = $1`, [ROW]);
    await asTheDatabase(dataDir, `UPDATE path_lifecycle SET state = 'cutover' WHERE mapping_id = $1`, [ROW]);

    booted = await boot(cfg, dataDir);
    try {
      // One row, at the limit, with a wait the target asked for.
      allowance = 0;
      retryAfter = '240';
      reached = [];
      const one = await post(booted.base, `${SHARES[0]}/decision`, { action: 'apply' });
      expect(one).toEqual({
        status: 409,
        body: { error: 'target_limited', reason: LIMIT(240).en, reasonNl: LIMIT(240).nl },
      });
      expect(reached).toEqual(['0']);

      // The one-go press: room for one outsider, then the limit.
      allowance = 2;
      retryAfter = undefined;
      reached = [];
      const press = await post(booted.base, 'apply-all', {});
      expect(press.status).toBe(200);
      expect(press.body.applied).toHaveLength(1);
      expect(press.body.refused).toEqual([]);
      expect((press.body.waitingForLimit as Array<{ id: string }>).map((r) => r.id)).toEqual(SHARES.slice(1));
      expect(press.body.limit).toEqual({ reason: LIMIT().en, reasonNl: LIMIT().nl });
      expect(reached).toEqual(['0', '4', '0']);

      // After the window: the two that waited, and nobody else.
      allowance = 20;
      reached = [];
      const again = await post(booted.base, 'apply-all', {});
      expect(again.status).toBe(200);
      expect(again.body.applied).toHaveLength(2);
      expect(again.body.waitingForLimit).toEqual([]);
      expect(reached).toEqual(['0', '4', '0', '4']);
    } finally {
      await booted.handle.stop();
    }
  }, 120_000);
});
