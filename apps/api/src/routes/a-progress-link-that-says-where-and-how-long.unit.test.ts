// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROGRESS LINK SAYS WHERE EACH DATA TYPE IS, OF HOW MANY, AND HOW LONG
 * (workplan 0154 T8), against a real database.
 *
 * The person's page had *"18,234 items copied"* and the migration's lifecycle
 * in a sentence. The owner's pages say more, and the person should read what
 * the owner reads: each data type's stage, its count against what discovery
 * found, and how long, before Start from the count and during the copy from
 * the passes. Each worked out on the server from the facts the owner's pages
 * read, and only counts, stages and closed words cross.
 *
 * Three migrations of one Gmail account, each behind its own link:
 *
 *  - COPYING: a pass has completed, 300 of the 1,300 found are in, and
 *    three passes an hour apart copied 100 each: *kept in step*, and about
 *    10 to 11 hours more;
 *  - WAITING: no pass yet, and the count found 6 GB of mail: two to three
 *    days, from Gmail's daily ceiling;
 *  - CHECKED: all in, and the check passed: *ready to switch*, with when;
 *  - STOPPED: all in, and its owner stopped the data type: *paused*, and
 *    not a word of whose stop it was;
 *  - SWITCHING: its mail cut over on its own while its calendars still copy,
 *    so the migration is active: the mail *switching*, which only the data
 *    type's own phase says, and the calendars *kept in step*.
 *
 * PGlite as `app_user`. Nothing is stubbed but the pool.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'node:path';
import { pgliteDriver, runMigrations, withTenant, issueMappingLink, expiryFromDays } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { MigrationView } from '@openmig/shared';
import { specChecker } from '../__tests__/doors-that-start-work.ts';

// UUID family 0154d800-…, unused elsewhere in the repo.
const U = (n: string) => `0154d800-e29b-41d4-a716-4466554408${n}`;
const TENANT = U('01');
const CONN = U('11');
const BOX = U('21');
const COPYING = U('31');
const WAITING = U('32');
const CHECKED = U('33');
const STOPPED = U('34');
const SWITCHING = U('35');

const GB = 1_000_000_000;

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: viewRoutes } = await import('./view.ts');

const app = express();
app.use(express.json());
app.use('/api/view', viewRoutes);

const CHECKER = specChecker(join(import.meta.dirname, '..', '..', 'docs', 'openapi.yaml'));
const documented = (body: unknown): boolean => {
  const spec = '/api/view/{link}';
  const { schema } = CHECKER.responseSchema({ name: spec, path: spec, spec, method: 'get', accepted: 200 } as never, '200');
  return CHECKER.satisfies(schema, body);
};

async function q(sql: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

const tokenFor = (mappingId: string) =>
  withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, {
      tenantId: TENANT,
      mappingId,
      purpose: 'view',
      createdBy: 'pat',
      expiresAt: expiryFromDays(30),
    }),
  );

async function page(mappingId: string): Promise<MigrationView> {
  const res = await request(app).get(`/api/view/${(await tokenFor(mappingId)).token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(documented(res.body), JSON.stringify(res.body)).toBe(true);
  return res.body as MigrationView;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** `n` copied items: what `itemsSynced` counts. */
const copied = (mappingId: string, n: number) =>
  q(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, size_bytes)
     SELECT $1, $2, 'email', 'INBOX', 'k' || g, $3 || g, 'copied', 1000 FROM generate_series(1, $4::int) g`,
    [TENANT, mappingId, `${mappingId}-h`, n],
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Example family']);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','gmail','mum','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await q(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','mum@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  for (const id of [COPYING, WAITING, CHECKED, STOPPED, SWITCHING]) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1,$2,$3,'active','Mum — old Gmail')`,
      [id, TENANT, BOX],
    );
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'email',true)`, [
      TENANT,
      id,
    ]);
  }

  // COPYING: a completed pass, 300 in of 1,300 found, three passes an hour apart.
  await q(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
     VALUES ($1,$2,'email','in_progress',$3)`,
    [TENANT, COPYING, hoursAgo(1)],
  );
  await copied(COPYING, 300);
  await q(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes)
     VALUES ($1,$2,'email',4,1300,$3)`,
    [TENANT, COPYING, 2 * GB],
  );
  for (const h of [3, 2, 1]) {
    await q(
      `INSERT INTO run (tenant_id, mapping_id, kind, status, stats, started_at, finished_at, created_at)
       VALUES ($1,$2,'incremental','succeeded','{"itemsProcessed":100}'::jsonb,$3,$4,$3)`,
      [TENANT, COPYING, hoursAgo(h), hoursAgo(h - 0.8)],
    );
  }

  // WAITING: no pass yet; the count found 6 GB of mail.
  await q(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes)
     VALUES ($1,$2,'email',9,52000,$3)`,
    [TENANT, WAITING, 6 * GB],
  );

  // CHECKED: everything in, and the check passed.
  await q(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
     VALUES ($1,$2,'email','completed',$3)`,
    [TENANT, CHECKED, hoursAgo(2)],
  );
  await copied(CHECKED, 80);
  await q(
    `INSERT INTO migration_discovery (tenant_id, mapping_id, domain, collections, items, bytes)
     VALUES ($1,$2,'email',2,80,$3)`,
    [TENANT, CHECKED, GB / 10],
  );
  await q(
    `INSERT INTO verification_run (tenant_id, mapping_id, state, started_at, finished_at, report)
     VALUES ($1,$2,'done',$3,$4,$5::jsonb)`,
    [
      TENANT,
      CHECKED,
      hoursAgo(1.5),
      hoursAgo(1),
      JSON.stringify({ [CHECKED]: { canProceedToCutover: true } }),
    ],
  );

  // STOPPED: all in, and the data type's path stopped by its owner.
  await q(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
     VALUES ($1,$2,'email','completed',$3)`,
    [TENANT, STOPPED, hoursAgo(5)],
  );
  await copied(STOPPED, 40);
  await q(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, stopped_at)
     VALUES ($1,$2,'email','active',$3,$4)`,
    [TENANT, STOPPED, hoursAgo(9), hoursAgo(4)],
  );

  // SWITCHING: the mail's own path in its cutover, the calendars' still active.
  await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'calendar',true)`, [
    TENANT,
    SWITCHING,
  ]);
  for (const domain of ['email', 'calendar']) {
    await q(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
       VALUES ($1,$2,$3,'completed',$4)`,
      [TENANT, SWITCHING, domain, hoursAgo(3)],
    );
  }
  await copied(SWITCHING, 20);
  for (const [domain, state] of [
    ['email', 'cutover'],
    ['calendar', 'active'],
  ]) {
    await q(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [TENANT, SWITCHING, domain, state, hoursAgo(9)],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('a progress link, after 0154 T8', () => {
  it('says each data type’s stage and its count against what was found, and how long from the passes', async () => {
    const body = await page(COPYING);
    const [mail] = body.domains;
    expect(mail).toMatchObject({ domain: 'email', stage: 'kept_in_step', itemsSynced: 300, itemsFound: 1300 });
    expect(body.time).toEqual({
      kind: 'whileCopying',
      estimate: { kind: 'range', unit: 'hours', low: 10, high: 11, passes: 3, slowed: false },
    });
    // The source's kind, to name who slowed it; not the address, not the name.
    expect(body.from).toBe('gmail');
    expect(body.checkPassedAt).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/mum@|Mum — old Gmail/);
  });

  it('before the first pass, says how long from the count: Gmail’s mail in days', async () => {
    const body = await page(WAITING);
    expect(body.started).toBe(false);
    expect(body.time).toEqual({
      kind: 'beforeStart',
      estimate: { kind: 'gmailDays', low: 2, high: 3, filesToo: false },
    });
  });

  it('says ready to switch once the check passed, and when, with no time left to wait for', async () => {
    const body = await page(CHECKED);
    expect(body.domains[0]).toMatchObject({ stage: 'ready_to_switch', itemsSynced: 80, itemsFound: 80 });
    expect(Date.parse(body.checkPassedAt!)).toBeGreaterThan(Date.now() - 2 * 3_600_000);
    expect(body.time).toBeUndefined();
  });

  it('reads each data type’s own stop: paused, and nothing of whose stop it was', async () => {
    const body = await page(STOPPED);
    const [mail] = body.domains;
    expect(mail).toMatchObject({ domain: 'email', stage: 'paused' });
    expect(Object.keys(mail!)).not.toContain('stopped');
    expect(Object.keys(mail!)).not.toContain('stoppedByOwner');
  });

  it('reads each data type’s own phase: the mail switching while the calendars still copy', async () => {
    const body = await page(SWITCHING);
    expect(body.state).toBe('active');
    const stages = Object.fromEntries(body.domains.map((d) => [d.domain, d.stage]));
    expect(stages).toEqual({ email: 'switching', calendar: 'kept_in_step' });
  });
});
