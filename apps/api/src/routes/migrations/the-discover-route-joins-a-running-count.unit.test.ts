// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DISCOVER ROUTE, ENQUEUEING THE WAY `discoveryTriggerOptions` SAYS
 * (2026-09-22).
 *
 * `a-count-each-reload-started.unit.test.ts` pins the rule. This pins that the
 * route actually applies it: the real `POST /:mappingId/discover` over a real
 * (in-process) ledger, with only the Trigger.dev client replaced by a recorder.
 * A reload must reach Trigger.dev as the same count, and a change to the
 * migration as a new one.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 7a5e0922-…, unused elsewhere in the repo.
const TENANT = '7a5e0922-e29b-41d4-a716-446655440001';
const CONN = '7a5e0922-e29b-41d4-a716-446655440011';
const BOX = '7a5e0922-e29b-41d4-a716-446655440021';
const MAPPING = '7a5e0922-e29b-41d4-a716-446655440031';

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
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'reloads']);
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
     VALUES ($1,$2,$3,'paused')`,
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

const discover = () => request(app).post(`/api/migrations/${MAPPING}/discover`).send({});

describe('POST /:mappingId/discover', () => {
  it('enqueues a reload as the SAME count, one per migration at a time', async () => {
    expect((await discover()).status).toBe(202);
    expect((await discover()).status).toBe(202);

    expect(enqueued).toHaveLength(2);
    const [first, reload] = enqueued.map((e) => e.options);
    // Trigger.dev answers the second with the first run: that is the join.
    expect(reload!.idempotencyKey).toBe(first!.idempotencyKey);
    expect(first!.idempotencyKeyTTL).toBeTruthy();
    expect(first!.concurrencyKey).toBe(MAPPING);
    expect(first!.tags).toEqual([`tenant:${TENANT}`, `mapping:${MAPPING}`]);
  });

  it('enqueues a NEW count once the migration has changed', async () => {
    await discover();
    await sql(
      `UPDATE mailbox_mapping SET updated_at = updated_at + interval '1 second' WHERE id = $1`,
      [MAPPING],
    );
    await discover();

    const [before, after] = enqueued.map((e) => e.options);
    expect(after!.idempotencyKey).not.toBe(before!.idempotencyKey);
    // Still one at a time: a new count waits for a running one.
    expect(after!.concurrencyKey).toBe(MAPPING);
  });
});
