// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PRESS THAT MEETS THE TARGET'S LIMIT ON NEW SHARES (workplan 0104, Status
 * of 2026-10-25), on managed.
 *
 * E2E (managed) #277, attempt 2: the demo Nextcloud answered apply-all's
 * calls 404 404 429 429 429. Nextcloud 31 to 35 let one account create 20
 * shares in 10 minutes (`ShareAPIController::createShare`,
 * `#[UserRateLimit(limit: 20, period: 600)]`), failed attempts included, and
 * answer the next one 429 with an empty OCS reply and no `Retry-After`. A
 * press asks for a user share first and by mail after a 404, so an outsider's
 * row costs two, and a press over more than ten of them met the limit and
 * reported every row after it as refused, under the generic sentence.
 *
 * WHAT THIS HOLDS, through the real routes over a real in-process ledger,
 * against a server on this machine that counts as Nextcloud's limiter does:
 *
 * - a 429 on one row is `target_limited`, said in our words in English and
 *   Dutch, with when to apply again: what `Retry-After` asked, or ten minutes;
 * - `apply-all` and `apply-folder` stop at the first 429. The rows from there
 *   are in `waitingForLimit`, open and untried, and `refused` holds none of
 *   them; the server is asked nothing after the 429;
 * - a press after the window tries exactly the rows that waited.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { log, shareRefusalSaid } from '@openmig/shared';

// UUID family 0104a429-…, unused elsewhere in the repo.
const TENANT = '0104a429-e29b-41d4-a716-446655440001';
const SOURCE = '0104a429-e29b-41d4-a716-446655440011';
const TARGET = '0104a429-e29b-41d4-a716-446655440012';
const SOURCE_BOX = '0104a429-e29b-41d4-a716-446655440021';
const TARGET_BOX = '0104a429-e29b-41d4-a716-446655440022';
const MAPPING = '0104a429-e29b-41d4-a716-446655440031';
/** Twelve items, each shared with a person the target has no account for. */
const ALONE = Array.from({ length: 12 }, (_, i) => `0104a429-e29b-41d4-a716-4466554401${String(i + 10)}`);
/** A shared folder and two files in it, shared with one more outsider. */
const FOLDER = ['0104a429-e29b-41d4-a716-446655440201', '0104a429-e29b-41d4-a716-446655440202', '0104a429-e29b-41d4-a716-446655440203'];

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

// ---------------------------------------------------------------------------
// The target: a Nextcloud whose limiter allows `allowance` calls
// ---------------------------------------------------------------------------

/** What `RateLimitingMiddleware` answers through OCS v2: status 429, no words. */
const LIMITED = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 429, message: '' }, data: [] } });
const NO_SUCH_ACCOUNT = JSON.stringify({
  ocs: { meta: { status: 'failure', statuscode: 404, message: 'Please specify a valid account to share with' }, data: [] },
});
const SHARED = JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200, message: 'OK' }, data: { id: 1 } } });

/** Calls the limiter still lets through, and what it says when none are left. */
let allowance = 0;
let retryAfter: string | undefined;
/** Every call that reached the target, as its share type: `0` user, `4` by mail. */
let reached: string[] = [];
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const shareType = new URLSearchParams(body).get('shareType') ?? '?';
      reached.push(shareType);
      // A 429 is not counted: the limiter refuses before it registers the attempt.
      if (allowance <= 0) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) });
        res.end(LIMITED);
        return;
      }
      allowance--;
      const reply = shareType === '4' ? { status: 200, body: SHARED } : { status: 404, body: NO_SUCH_ACCOUNT };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'a press that meets the limit']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
       ($1,$3,'source','imap','typed source','{"host":"mail.example.invalid"}'::jsonb,'connected'),
       ($2,$3,'target','webdav','typed target',$4::jsonb,'connected')`,
    [SOURCE, TARGET, TENANT, JSON.stringify({ baseUrl: base, credentials: { username: 'pat', password: 'pw' } })],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
       ($1,$3,$4,'user','m@example.invalid'),
       ($2,$3,$5,'user','t@example.invalid')`,
    [SOURCE_BOX, TARGET_BOX, TENANT, SOURCE, TARGET],
  );
  // Done: every data type is past its cutover, so the gate lets a share through.
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status)
     VALUES ($1,$2,$3,$4,'done')`,
    [MAPPING, TENANT, SOURCE_BOX, TARGET_BOX],
  );
  for (const [i, id] of ALONE.entries()) {
    const n = String(i + 1).padStart(2, '0');
    await sql(
      `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw,
         verdict, verdict_target)
       VALUES ($1,$2,$3,$4,'drive_item',$5,$6,'read','{}','clean','a Nextcloud share')`,
      [id, TENANT, MAPPING, `0104a429-alone-${n}`, `Projects/item-${n}.xlsx`, `outsider-${n}@example.invalid`],
    );
  }
  for (const [id, on, itemKey, parentKey, container] of [
    [FOLDER[0], 'Shared/Photos', 'F', 'root', true],
    [FOLDER[1], 'Shared/Photos/one.jpg', 'c1', 'F', false],
    [FOLDER[2], 'Shared/Photos/two.jpg', 'c2', 'F', false],
  ] as const) {
    await sql(
      `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw,
         verdict, verdict_target, item_key, parent_key, is_container)
       VALUES ($1,$2,$3,$4,'drive_item',$5,'anna@example.invalid','read','{}','clean','a Nextcloud share',$6,$7,$8)`,
      [id, TENANT, MAPPING, `0104a429-folder-${itemKey}`, on, itemKey, parentKey, container],
    );
  }
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await driver.end?.();
});

beforeEach(() => {
  reached = [];
  retryAfter = undefined;
  for (const level of ['warn', 'error', 'info'] as const) vi.spyOn(log, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Our sentence for the limit, as the managed API ends it: with its reference. */
function isTheLimitSentence(reason: unknown, reasonNl: unknown, retryAfterSeconds?: number): void {
  const said = shareRefusalSaid({
    kind: 'answered',
    status: 429,
    ocsStatus: 429,
    ocs: true,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
  const ref = /Reference ([0-9a-f]{8})\.$/.exec(String(reason))?.[1];
  expect(ref, `"${String(reason)}" should end with its reference`).toBeDefined();
  expect(reason).toBe(`${said.en} Reference ${ref}.`);
  expect(reasonNl).toBe(`${said.nl} Referentie ${ref}.`);
}

async function states(ids: readonly string[]): Promise<string[]> {
  const rows = await sql('SELECT id, state FROM share_grant WHERE mapping_id = $1', [MAPPING]);
  return ids.map((id) => String(rows.find((r) => r.id === id)?.state));
}

describe("a press that meets the target's limit on new shares (0104, 2026-10-25)", () => {
  it('one row: target_limited, in our words, with the wait the target asked for', async () => {
    allowance = 0;
    retryAfter = '120';
    const res = await request(app).post(`/api/migrations/${MAPPING}/sharing/${ALONE[0]}/decision`).send({ action: 'apply' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('target_limited');
    isTheLimitSentence(res.body.reason, res.body.reasonNl, 120);
    expect(res.body.reason).toContain('apply again in about 2 minutes');
    expect(res.body.reasonNl).toContain('over ongeveer 2 minuten opnieuw toepassen');
    // The user attempt met the limit; the share by mail was not asked for.
    expect(reached).toEqual(['0']);
    expect(await states([ALONE[0]!])).toEqual(['open']);
  });

  it('one folder: the press stops at the limit, and the rows from there wait, untried', async () => {
    // Room for one outsider and a half: the second row's share by mail meets it.
    allowance = 3;
    const res = await request(app)
      .post(`/api/migrations/${MAPPING}/sharing/apply-folder`)
      .send({ parentKey: 'F', confirmed: { 'anna@example.invalid': 'anna@example.invalid' } });
    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.refused).toEqual([]);
    const waiting = res.body.waitingForLimit as Array<{ id: string }>;
    expect(waiting).toHaveLength(2);
    expect(res.body.limit).not.toHaveProperty('retryAfterSeconds');
    isTheLimitSentence(res.body.limit.reason, res.body.limit.reasonNl);
    expect(res.body.limit.reason).toContain('apply again in ten minutes');
    // Nothing after the 429: user, mail, user, mail (429).
    expect(reached).toEqual(['0', '4', '0', '4']);
    expect(await states(waiting.map((r) => r.id))).toEqual(['open', 'open']);
  });

  it('every row: twelve outsiders and Nextcloud’s 20 in ten minutes, the press stops at the 21st call', async () => {
    allowance = 20;
    const res = await request(app).post(`/api/migrations/${MAPPING}/sharing/apply-all`).send({});
    expect(res.status).toBe(200);
    // Twelve items and the folder's two rows still open: fourteen to try, ten fit.
    expect(res.body.applied).toHaveLength(10);
    expect(res.body.refused).toEqual([]);
    const waiting = res.body.waitingForLimit as Array<{ id: string; on: string; grantee?: string }>;
    expect(waiting).toHaveLength(4);
    expect(waiting[0]).toMatchObject({ id: ALONE[10], on: 'Projects/item-11.xlsx', grantee: 'outsider-11@example.invalid' });
    isTheLimitSentence(res.body.limit.reason, res.body.limit.reasonNl);
    expect(reached).toHaveLength(21);
    expect(reached.at(-1)).toBe('0');
    expect(await states(waiting.map((r) => r.id))).toEqual(['open', 'open', 'open', 'open']);
  });

  it('after the window, a press tries the rows that waited and nobody else', async () => {
    allowance = 20;
    const res = await request(app).post(`/api/migrations/${MAPPING}/sharing/apply-all`).send({});
    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(4);
    expect(res.body.waitingForLimit).toEqual([]);
    expect(res.body).not.toHaveProperty('limit');
    expect(reached).toHaveLength(8);
    expect(await states([...ALONE, ...FOLDER])).toEqual(Array(15).fill('applied'));
  });
});
