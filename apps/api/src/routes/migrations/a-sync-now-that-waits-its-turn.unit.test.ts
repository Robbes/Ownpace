// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A "SYNC NOW" THAT WAITS ITS TURN (2026-09-24).
 *
 * `run-delta-sync` runs on a concurrency-1 queue that is partitioned by the
 * `concurrencyKey` set when a run is triggered: one running pass per mapping.
 * The sync tick sets it and so does `/start`. The manual route, behind "Sync
 * now" and the final pass before cutover, did not. Its run landed on the base
 * `delta-sync` queue, which every tenant shares with a limit of one, and it
 * did not wait for the mapping's scheduled pass.
 *
 * The real `POST /:mappingId/sync` over a real (in-process) ledger, with only
 * the Trigger.dev client replaced by a recorder.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 5c0a2409-…, unused elsewhere in the repo.
const TENANT = '5c0a2409-e29b-41d4-a716-446655440001';
const CONN = '5c0a2409-e29b-41d4-a716-446655440011';
const BOX = '5c0a2409-e29b-41d4-a716-446655440021';
const MAPPING = '5c0a2409-e29b-41d4-a716-446655440031';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'rob', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { enqueued } = vi.hoisted(() => ({
  enqueued: [] as Array<{ taskId: string; options: Record<string, unknown> }>,
}));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string, _payload: unknown, options: Record<string, unknown>) => {
          enqueued.push({ taskId, options });
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
    }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'sync now']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','m@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
     VALUES ($1,$2,$3,'active')`,
    [MAPPING, TENANT, BOX],
  );
  // PGlite and the full migration chain; see awaiting-grant.unit.test.ts for
  // why this is not vitest's default 10s.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  enqueued.length = 0;
});

describe('POST /:mappingId/sync', () => {
  it.each([
    ['a sync now', {}],
    ['the final pass before cutover', { type: 'delta' }],
    ['a forced full rescan', { type: 'full' }],
  ])('enqueues %s on the mapping’s own partition', async (_what, body) => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/sync`).send(body);
    expect(res.status).toBe(202);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.taskId).toBe('run-delta-sync');
    expect(
      enqueued[0]!.options.concurrencyKey,
      'a manual pass without concurrencyKey lands on the base delta-sync queue, shared by every\n' +
        'tenant, and runs beside the scheduled pass on the same mapping',
    ).toBe(MAPPING);
    expect(enqueued[0]!.options.tags).toEqual([`tenant:${TENANT}`, `mapping:${MAPPING}`]);
  });
});
