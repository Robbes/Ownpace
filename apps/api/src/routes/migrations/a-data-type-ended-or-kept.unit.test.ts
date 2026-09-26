// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATA TYPE ENDED OR KEPT, ON THE MANAGED API (workplan 0128 T3, T5 slice
 * 7; the owner's D3 and D8).
 *
 * The real `POST /:mappingId/domains/:domain/end` and `…/keep` over a real
 * in-process ledger, both chains: what the door writes is the ledger's own
 * test's business (`an-ending-per-data-type.unit.test.ts`); here it is what
 * the route adds. It counts the data type's own open failures for End, and
 * only its own; a forced End goes over them; it answers in words; and a data
 * type kept in the lane after its cutover raises the month's peak.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 0128e200-…, unused elsewhere in the repo.
const TENANT = '0128e200-e29b-41d4-a716-446655440001';
const CONN = '0128e200-e29b-41d4-a716-446655440011';
const BOX = '0128e200-e29b-41d4-a716-446655440021';
const MAPPING = '0128e200-e29b-41d4-a716-446655440031';
const GONE = '0128e200-e29b-41d4-a716-446655440041';

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

const press = (ending: 'end' | 'keep', domain: string, { force = false, mapping = MAPPING } = {}) =>
  request(app)
    .post(`/api/migrations/${mapping}/domains/${domain}/${ending}${force ? '?force=true' : ''}`)
    .send();

/** The migration in `status`, with mail and calendars in it, no failures, no peak. */
async function place(status: string): Promise<void> {
  await sql(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await sql(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  await sql(`DELETE FROM item WHERE mapping_id = $1`, [MAPPING]);
  await sql(`DELETE FROM occupancy_peak`);
  for (const domain of ['email', 'calendar']) {
    await sql(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [TENANT, MAPPING, domain, status],
    );
  }
}

/** One item of `domain` that failed `attempts` times: from five, it waits on a decision. */
async function aFailure(domain: string, key: string, attempts = 5): Promise<void> {
  await sql(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, attempt_count, last_error)
     VALUES ($1, $2, $3, 'c', $4, $4, 'failed', $5, 'refused')`,
    [TENANT, MAPPING, domain, key, attempts],
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: a data type kept in the lane raises `occupancy_peak`.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'endings']);
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
  await place('cutover');
});

describe('POST /:mappingId/domains/:domain/end and /keep', () => {
  it('ends one data type and keeps the other; the migration follows, and who did it is recorded', async () => {
    const ended = await press('end', 'email');
    expect(ended.status).toBe(200);
    expect(ended.body).toEqual({ id: MAPPING, domain: 'email', ending: 'end', changed: true, from: 'cutover', to: 'done', slotsTaken: false });

    const kept = await press('keep', 'calendar');
    expect(kept.status).toBe(200);
    expect(kept.body).toEqual({
      id: MAPPING,
      domain: 'calendar',
      ending: 'keep',
      changed: true,
      from: 'cutover',
      to: 'continuous',
      migration: { from: 'cutover', to: 'continuous' },
      slotsTaken: true,
    });
    expect((await sql(`SELECT status FROM mailbox_mapping WHERE id = $1`, [MAPPING]))[0]).toEqual({ status: 'continuous' });
    const actors = await sql(`SELECT DISTINCT actor FROM audit_log WHERE action = 'path.phase'`);
    expect(actors).toEqual([{ actor: 'pat' }]);
  });

  it("counts the data type's own open failures for End, and only its own; a forced End goes over them", async () => {
    await aFailure('calendar', 'k1');
    await aFailure('calendar', 'k2');
    await aFailure('calendar', 'k3', 1); // still being retried: it waits on no decision

    const refused = await press('end', 'calendar');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'end_refused', refused: 'unresolved_failures', count: 2, forceable: true });
    expect(refused.body.message).toMatch(/^2 item\(s\) of calendar could not be migrated/);

    // Mail's End does not wait on the calendars' failures, and Keep waits on none.
    expect((await press('end', 'email')).status).toBe(200);
    expect((await press('keep', 'calendar')).body).toMatchObject({ changed: true, to: 'continuous' });

    const forced = await press('end', 'calendar', { force: true });
    expect(forced.body).toMatchObject({ changed: true, from: 'continuous', to: 'done', migration: { to: 'done' } });
  });

  it("raises the month's peak when a data type kept after its cutover takes a slot", async () => {
    await press('keep', 'calendar');
    expect(await sql(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [TENANT])).toEqual([{ peak_paths: 1 }]);
  });

  it('raises nothing for End, which lets a slot go', async () => {
    await place('active');
    await press('end', 'email');
    expect(await sql(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [TENANT])).toEqual([]);
  });

  it('refuses while the migration is not running, in words, and answers what is not there', async () => {
    await place('paused');
    const res = await press('keep', 'email');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'keep_refused', refused: 'not_running' });
    expect(res.body.message).toContain("'paused'");
    expect(res.body.forceable).toBeUndefined();

    await place('cutover');
    expect((await press('end', 'contact')).body).toMatchObject({ refused: 'not_a_path' });
    const invalid = await press('end', 'photos');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('invalid_domain');
    expect((await press('end', 'email', { mapping: GONE })).status).toBe(404);
  });
});
