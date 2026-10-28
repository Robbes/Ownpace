// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SYNC NOW, PRESSED AT THE MACHINE (workplan 0132 T9; the owner, 2026-10-28).
 *
 * `deploy/compose/live-pass-check.sh` starts one pass on the owner's own
 * migration on live after a deploy, through `scripts/live-pass.ts` inside the
 * api container. The promise is that the pass starts exactly as *Sync now*
 * starts it, and stops exactly where *Sync now* stops: the hold, a closed
 * organisation, a paused migration, a withdrawn grant, a migration of another
 * organisation. And that, unlike the button, it records no visit, so the
 * owner's migration keeps its cadence.
 *
 * The real route and the real script over one in-process ledger, as
 * `app_user` with both migration chains, with only the orchestrator's client
 * replaced by a recorder:
 *
 * - the button and the script on the same migration enqueue the same task,
 *   payload and options, and only the button writes a visit;
 * - each refusal is said as one line, and nothing is enqueued;
 * - the arguments and `APP_DATABASE_URL` are refused before any pool is
 *   built;
 * - a press that fails says its code, never its message;
 * - the script presses with an empty body, so `final` never skips Free's pace.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 0132e9d0-…, unused elsewhere in the repo.
const TENANT = '0132e9d0-e29b-41d4-a716-446655440001';
const OTHER = '0132e9d0-e29b-41d4-a716-446655440002';
const CONN = '0132e9d0-e29b-41d4-a716-446655440011';
const OTHER_CONN = '0132e9d0-e29b-41d4-a716-446655440012';
const BOX = '0132e9d0-e29b-41d4-a716-446655440021';
const OTHER_BOX = '0132e9d0-e29b-41d4-a716-446655440022';
const MAPPING = '0132e9d0-e29b-41d4-a716-446655440031';
const OTHERS_MAPPING = '0132e9d0-e29b-41d4-a716-446655440032';

/** What the orchestrator says when it cannot be reached: a code, and an address in the message. */
const UNREACHABLE_AT = '192.0.2.10';

let driver: LedgerDriver;

const { pools } = vi.hoisted(() => ({ pools: { built: 0 } }));
vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => {
      pools.built++;
      return driver;
    },
  };
});

const { enqueued, unreachable } = vi.hoisted(() => ({
  enqueued: [] as Array<{ taskId: string; payload: unknown; options: unknown }>,
  unreachable: { on: false },
}));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string, payload: unknown, options: unknown) => {
          if (unreachable.on) {
            return Promise.reject(
              Object.assign(new Error(`connect ECONNREFUSED ${UNREACHABLE_AT}:3030`), { code: 'ECONNREFUSED' }),
            );
          }
          enqueued.push({ taskId, payload, options });
          return Promise.resolve({ id: `run_test${enqueued.length}` });
        },
      },
    }),
  };
});

const { default: migrationRoutes } = await import('../routes/migrations/index.ts');
const { main, press } = await import('./live-pass.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function rows<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

async function sql(text: string, params: unknown[] = []): Promise<void> {
  await rows(text, params);
}

const visits = async () => (await rows('SELECT mapping_id FROM migration_visit WHERE mapping_id = $1', [MAPPING])).length;

/** One press of the script, with what it wrote and warned. */
async function pressed(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await press(argv, driver as unknown as Pool, (l) => out.push(l), (l) => err.push(l));
  return { code, out, err };
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the hold, the close and the visit are managed tables.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2), ($3,$4)', [TENANT, 'live pass', OTHER, 'someone else']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected'), ($3,$4,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT, OTHER_CONN, OTHER],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','m@example.invalid'), ($4,$5,$6,'user','o@example.invalid')`,
    [BOX, TENANT, CONN, OTHER_BOX, OTHER, OTHER_CONN],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
     VALUES ($1,$2,$3,'active'), ($4,$5,$6,'active')`,
    [MAPPING, TENANT, BOX, OTHERS_MAPPING, OTHER, OTHER_BOX],
  );
  // PGlite and both migration chains; see awaiting-grant.unit.test.ts for why
  // this is not vitest's default 10s.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(() => {
  enqueued.length = 0;
  unreachable.on = false;
  pools.built = 0;
});

describe('the script presses Sync now the same way the button does', () => {
  it('enqueues the same task, payload and options, and only the button records a visit', async () => {
    await sql('DELETE FROM migration_visit');
    const res = await request(app).post(`/api/migrations/${MAPPING}/sync`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(await visits(), 'the button records a visit (visits.ts)').toBe(1);

    await sql('DELETE FROM migration_visit');
    const { code, out, err } = await pressed([TENANT, MAPPING]);

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out).toEqual(['started\trun_test2']);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1]).toEqual(enqueued[0]);
    expect(enqueued[1]).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING },
      options: { concurrencyKey: MAPPING, tags: [`tenant:${TENANT}`, `mapping:${MAPPING}`] },
    });
    expect(await visits(), 'a machine checking a release is not a person checking: no visit').toBe(0);
  });
});

describe('it stops where the button stops, says so in one line, and enqueues nothing', () => {
  it('while a hold is open', async () => {
    await sql(`INSERT INTO platform_pause (message, started_by) VALUES ($1, 'operator-sub')`, ['We werken het platform bij.']);
    try {
      const { code, out } = await pressed([TENANT, MAPPING]);
      expect(out).toEqual(['refused\t409\tplatform_held']);
      expect(code).toBe(4);
      expect(enqueued).toEqual([]);
    } finally {
      await sql(`UPDATE platform_pause SET ended_at = now(), ended_by = 'operator-sub' WHERE ended_at IS NULL`);
    }
  });

  it('on a paused migration', async () => {
    await sql(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    try {
      const { code, out } = await pressed([TENANT, MAPPING]);
      expect(out).toEqual(['refused\t409\tpaused']);
      expect(code).toBe(4);
      expect(enqueued).toEqual([]);
    } finally {
      await sql(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    }
  });

  it('on a grant its person withdrew', async () => {
    await sql('UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1', [MAPPING]);
    try {
      const { code, out } = await pressed([TENANT, MAPPING]);
      expect(out).toEqual(['refused\t409\tgrant_withdrawn']);
      expect(code).toBe(4);
      expect(enqueued).toEqual([]);
    } finally {
      await sql('UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = $1', [MAPPING]);
    }
  });

  it('in a closed organisation', async () => {
    await sql(`UPDATE tenant SET status = 'closed' WHERE id = $1`, [TENANT]);
    await sql(
      `INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
       VALUES ($1, now(), now() + interval '30 days', 'pat')`,
      [TENANT],
    );
    try {
      const { code, out } = await pressed([TENANT, MAPPING]);
      expect(out).toEqual(['refused\t409\taccount_closed']);
      expect(code).toBe(4);
      expect(enqueued).toEqual([]);
    } finally {
      await sql('DELETE FROM tenant_closure WHERE tenant_id = $1', [TENANT]);
      await sql(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
    }
  });

  it("on another organisation's migration, which row security does not show it", async () => {
    const { code, out } = await pressed([TENANT, OTHERS_MAPPING]);
    expect(out).toEqual(['refused\t404\tnot_found']);
    expect(code).toBe(4);
    expect(enqueued).toEqual([]);
  });
});

describe('it refuses before any pool is built', () => {
  /** What main warned, one string per write. */
  let warned: string[] = [];
  beforeEach(() => {
    warned = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (warned.push(String(chunk)), true));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['one argument', [MAPPING]],
    ['three arguments', [TENANT, MAPPING, 'final']],
    ['an id that is not one', [TENANT, 'my-migration']],
    ['an id in capitals', [TENANT, MAPPING.toUpperCase()]],
  ])('%s: 2', async (_what, argv) => {
    expect(await main(argv, { APP_DATABASE_URL: 'postgres://example.invalid/db' })).toBe(2);
    expect(pools.built).toBe(0);
    expect(warned).toEqual([expect.stringContaining('usage:')]);
  });

  it('without APP_DATABASE_URL: 2, so getDbPool never falls back to the owner', async () => {
    expect(await main([TENANT, MAPPING], { APP_DATABASE_URL: '' })).toBe(2);
    expect(await main([TENANT, MAPPING], {})).toBe(2);
    expect(pools.built).toBe(0);
    expect(warned).toEqual([
      expect.stringContaining('APP_DATABASE_URL is not set'),
      expect.stringContaining('APP_DATABASE_URL is not set'),
    ]);
  });
});

describe('a press that fails', () => {
  it('says its code and never its message, and prints no line for the shell', async () => {
    unreachable.on = true;
    const { code, out, err } = await pressed([TENANT, MAPPING]);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join('\n')).toContain('ECONNREFUSED');
    expect(err.join('\n')).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  });
});

describe('the body the script presses with', () => {
  it('is empty, so the final pass before the switch never lets it skip Free’s pace', () => {
    const source = readFileSync(join(import.meta.dirname, 'live-pass.ts'), 'utf8');
    expect(source).toMatch(/pressSyncNow\(\s*\w+,\s*\w+,\s*\w+,\s*\{\s*\},/);
    expect(source).not.toMatch(/\bfinal\s*:/);
  });
});
