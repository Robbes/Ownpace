// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE EACH DATA TYPE OF EACH MIGRATION IS, IN ONE READ (workplan 0154 T1 (b)
 * to (d)).
 *
 * A person's card on Migrations read the list, which carries a lifecycle word
 * and a last sync and nothing per data type: every line on a card said the
 * migration's stage, none could say *Ready to switch*, and none had a count to
 * put under it. The real `GET /api/migrations/progress`, over a real in-process
 * ledger, answers per data type with the facts a stage is read from and the
 * counts its sentence says, and per migration with its check.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { ProgressReport } from '@openmig/shared';
import { specChecker } from '../../__tests__/doors-that-start-work.ts';

// UUID family 0154b100-…, unused elsewhere in the repo.
const U = (n: string) => `0154b100-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const CONN = U('11');
const BOX = U('21');
const RUNNING = U('31');
const DRAFT = U('32');
const CHECKING = U('33');
const CRASHED = U('34');
const SPLIT = U('35');

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

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', '..', 'docs', 'openapi.yaml'));
function documented(body: unknown): boolean {
  const spec = '/api/migrations/progress';
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method: 'get', accepted: 200 } as never, '200');
  return CHECKER.satisfies(schema, body);
}

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/** A migration in `status`, carrying `domains`, each with a path row in `phase`. */
async function migration(id: string, status: string, domains: readonly string[], phase = status): Promise<void> {
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,$4)`,
    [id, TENANT, BOX, status],
  );
  for (const domain of domains) {
    await sql(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      id,
      domain,
    ]);
    await sql(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at) VALUES ($1,$2,$3,$4,now())`,
      [TENANT, id, domain, phase],
    );
  }
}

async function progress(): Promise<ProgressReport> {
  const res = await request(app).get('/api/migrations/progress');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ProgressReport;
}

const of = (report: ProgressReport, id: string) => report.mappings.find((m) => m.mappingId === id);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'lines']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
    [BOX, TENANT, CONN],
  );

  // Running: mail kept in step with a total, calendars stopped by their owner,
  // contacts not yet reached, tasks switched off with nothing copied.
  await migration(RUNNING, 'active', ['email', 'calendar', 'contact']);
  await sql(`UPDATE path_lifecycle SET stopped_at = now() WHERE mapping_id = $1 AND domain = 'calendar'`, [RUNNING]);
  for (const [domain, state, completed] of [
    ['email', 'completed', true],
    ['calendar', 'completed', true],
    ['contact', 'pending', false],
    ['task', 'skipped', false],
  ] as const) {
    await sql(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
       VALUES ($1,$2,$3,$4,${completed ? "now() - interval '2 minutes'" : 'NULL'})`,
      [TENANT, RUNNING, domain, state],
    );
  }
  for (let i = 0; i < 3; i++) {
    await sql(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, size_bytes, status)
       VALUES ($1,$2,'email','INBOX',$3,$4,1000,'copied')`,
      [TENANT, RUNNING, `m-${i}`, `h-${i}`],
    );
  }
  await sql(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes) VALUES ($1,$2,'email',2,5,9000)`,
    [TENANT, RUNNING],
  );
  // Its check ran twice; the second, latest, passed.
  await sql(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, started_at, finished_at, report)
     VALUES ($1,$2,'done', now() - interval '2 days', now() - interval '2 days', $3::jsonb),
            ($1,$2,'done', now() - interval '1 day', now() - interval '1 day', $4::jsonb)`,
    [
      TENANT,
      RUNNING,
      JSON.stringify({ [RUNNING]: { canProceedToCutover: false } }),
      JSON.stringify({ [RUNNING]: { canProceedToCutover: true } }),
    ],
  );

  // A draft: created, never started, never checked.
  await migration(DRAFT, 'paused', ['file'], 'ready');
  // Checking now, and one whose check could not run.
  await migration(CHECKING, 'active', ['email']);
  await sql(`INSERT INTO verification_run (tenant_id, mapping_id, state) VALUES ($1,$2,'running')`, [TENANT, CHECKING]);
  await migration(CRASHED, 'active', ['email']);
  await sql(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, finished_at, error) VALUES ($1,$2,'failed', now(), 'ECONNRESET')`,
    [TENANT, CRASHED],
  );
  // In its cutover, with the calendars kept in step after it (0128 D8): each
  // data type in its own phase.
  await migration(SPLIT, 'cutover', ['email', 'calendar'], 'cutover');
  await sql(`UPDATE path_lifecycle SET state = 'continuous' WHERE mapping_id = $1 AND domain = 'calendar'`, [SPLIT]);
  for (const domain of ['email', 'calendar']) {
    await sql(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at) VALUES ($1,$2,$3,'completed', now())`,
      [TENANT, SPLIT, domain],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('GET /api/migrations/progress', () => {
  it('answers every migration of the organisation, in the shape the spec gives', async () => {
    const report = await progress();
    expect(report.mappings.map((m) => m.mappingId)).toEqual([RUNNING, DRAFT, CHECKING, CRASHED, SPLIT]);
    expect(documented(report)).toBe(true);
  });

  it('gives each data type the facts its stage is read from, and its counts against what was found', async () => {
    const running = of(await progress(), RUNNING)!;
    const email = running.domains.find((d) => d.domain === 'email');
    expect(email).toMatchObject({
      state: 'completed',
      phase: 'active',
      itemsSynced: 3,
      itemsFound: 5,
      bytesTransferred: 3000,
      bytesFound: 9000,
    });
    expect(email?.lastSyncedAt).toEqual(expect.any(String));
    expect(email && 'stopped' in email).toBe(false);
  });

  it('gives each data type its own phase, not the migration’s', async () => {
    const split = of(await progress(), SPLIT)!;
    expect(split.domains.map((d) => [d.domain, d.phase]).sort()).toEqual([
      ['calendar', 'continuous'],
      ['email', 'cutover'],
    ]);
  });

  it('says which data type its owner stopped, and keeps its line', async () => {
    const running = of(await progress(), RUNNING)!;
    expect(running.domains.find((d) => d.domain === 'calendar')).toMatchObject({ phase: 'active', stopped: true });
  });

  it('gives no line to a data type the migration does not copy, and no total where nothing was counted', async () => {
    const running = of(await progress(), RUNNING)!;
    expect(running.domains.map((d) => d.domain).sort()).toEqual(['calendar', 'contact', 'email']);
    const contact = running.domains.find((d) => d.domain === 'contact');
    expect(contact && 'itemsFound' in contact).toBe(false);
  });

  it('says the check by its latest run: passed, and when', async () => {
    const running = of(await progress(), RUNNING)!;
    expect(running.check.state).toBe('passed');
    expect(running.check).toEqual({ state: 'passed', at: expect.any(String) });
  });

  it('tells a check not run, running and one that could not run apart', async () => {
    const report = await progress();
    expect(of(report, DRAFT)).toEqual({ mappingId: DRAFT, domains: [], check: { state: 'not_run' } });
    expect(of(report, CHECKING)?.check).toEqual({ state: 'running', since: expect.any(String) });
    expect(of(report, CRASHED)?.check).toEqual({ state: 'could_not_run', at: expect.any(String) });
  });
});
