// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE STOPPED AND RESUMED, ON THE MANAGED API (workplan 0128 T4, T5
 * slice 3b; the owner's D2 (c) and D5).
 *
 * The real `POST /:mappingId/domains/:domain/stop` and `…/resume` over a real
 * in-process ledger, both chains: what the door writes is the ledger's own
 * test's business (`a-stop-per-data-type.unit.test.ts`); here it is what the
 * route adds. It answers in words, refuses the last data type still copying
 * with a pointer to ending the migration, and raises the month's peak when a
 * resume in the lane takes a slot back.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, PATH_STATUS_ACTION } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 0128f100-…, unused elsewhere in the repo.
const TENANT = '0128f100-e29b-41d4-a716-446655440001';
const CONN = '0128f100-e29b-41d4-a716-446655440011';
const BOX = '0128f100-e29b-41d4-a716-446655440021';
const MAPPING = '0128f100-e29b-41d4-a716-446655440031';
const GONE = '0128f100-e29b-41d4-a716-446655440041';

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

const press = (action: 'stop' | 'resume', domain: string, mapping = MAPPING) =>
  request(app).post(`/api/migrations/${mapping}/domains/${domain}/${action}`).send();

/** The migration in `status`, with mail and calendars running in it, no stops, no peak. */
async function place(status: string): Promise<void> {
  await sql(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await sql(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  await sql(`DELETE FROM occupancy_peak`);
  await sql(`DELETE FROM audit_log WHERE action = $1`, [PATH_STATUS_ACTION]);
  for (const domain of ['email', 'calendar']) {
    await sql(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [TENANT, MAPPING, domain, status],
    );
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: a resume in the lane raises `occupancy_peak`.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'stops']);
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
  for (const domain of ['email', 'calendar']) {
    await sql(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await place('active');
});

describe('POST /:mappingId/domains/:domain/stop and /resume', () => {
  it('stops and resumes a data type, and records who did it', async () => {
    const stopped = await press('stop', 'email');
    expect(stopped.status).toBe(200);
    expect(stopped.body).toEqual({ id: MAPPING, domain: 'email', stopped: true, changed: true });

    const resumed = await press('resume', 'email');
    expect(resumed.status).toBe(200);
    expect(resumed.body).toEqual({ id: MAPPING, domain: 'email', stopped: false, changed: true });

    const again = await press('resume', 'email');
    expect(again.body).toEqual({ id: MAPPING, domain: 'email', stopped: false, changed: false });

    const recorded = await sql(`SELECT actor, detail ->> 'to' AS "to" FROM audit_log WHERE action = $1 ORDER BY at`, [
      PATH_STATUS_ACTION,
    ]);
    expect(recorded).toEqual([
      { actor: 'pat', to: 'stopped' },
      { actor: 'pat', to: 'running' },
    ]);
  });

  it('refuses the last data type still copying, pointing at ending the migration (D5)', async () => {
    await press('stop', 'email');
    const res = await press('stop', 'calendar');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'stop_refused', refused: 'last_one_copying' });
    expect(res.body.message).toMatch(/end the migration instead/);
  });

  it('refuses while the migration is not running, in words', async () => {
    await place('paused');
    const res = await press('stop', 'email');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'stop_refused', refused: 'not_running' });
    expect(res.body.message).toContain("'paused'");
  });

  it('answers a data type the migration does not carry, one that is not a data type, and a migration that is not there', async () => {
    expect((await press('stop', 'contact')).body).toMatchObject({ refused: 'not_a_path' });
    const invalid = await press('stop', 'photos');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('invalid_domain');
    expect((await press('stop', 'email', GONE)).status).toBe(404);
  });

  it("raises the month's peak when a resume in the lane takes its slot back (D2 (c))", async () => {
    await place('continuous');
    await press('stop', 'email');
    // A stop in the lane releases its slot; nothing is raised for it.
    expect(await sql(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [TENANT])).toEqual([]);

    await press('resume', 'email');
    expect(await sql(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [TENANT])).toEqual([
      { peak_paths: 2 },
    ]);
  });

  it('raises nothing for a resume before the cutover: the stop kept its slot', async () => {
    await press('stop', 'email');
    await press('resume', 'email');
    expect(await sql(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [TENANT])).toEqual([]);
  });
});
