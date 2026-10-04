// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AS MANY LIVE GRANT LINKS AS THE TIER RUNS MIGRATIONS (workplan 0108 T8 (d)),
 * at the one door that issues a grant link now: a person's (ADR-0035, amended
 * 2026-09-29; the owner, 2026-10-03: *"yes, replace the per-migration
 * links"*).
 *
 * The allowance itself (the tier's number, the operator's) is
 * `as-many-links-as-the-tier-runs.unit.test.ts`'s, in `@openmig/managed`, and
 * the lock that makes two issues take turns is
 * `one-issue-at-a-time.integration.test.ts`'s. What this file holds is the
 * door acting on them:
 *
 * - an organisation on Free is issued six live grant links and refused the
 *   seventh, with the sentence that names its tier, and nothing written;
 * - a migration's link sent before the person's replaced it counts in the same
 *   limit while it is live;
 * - a progress link is never refused, since it grants nothing;
 * - room is made when a link is revoked, used, or expires;
 * - the limit grows with the tier, and holds the operator's number while it
 *   stands.
 *
 * PGlite as `app_user`, both chains; `authenticate` is the one thing stubbed.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { expiryFromDays, issueMappingLink, pgliteDriver, revokeMappingLink, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 0153c5d4-…, unused elsewhere in the repo.
const U = (n: string) => `0153c5d4-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const SOURCE_CONN = U('11');
const TARGET_CONN = U('12');
const SOURCE_BOX = U('21');
const TARGET_BOX = U('22');
const MAPPING = U('31');
const ANNA = U('41');

let driver: LedgerDriver;

vi.mock('./../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: peopleRoutes } = await import('./people.ts');

const app = express();
app.use(express.json());
app.use('/api/people', peopleRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Anna's link, of either kind. */
const issue = (purpose?: 'grant' | 'view') =>
  request(app)
    .post(`/api/people/${ANNA}/links`)
    .send(purpose ? { purpose } : {});

const liveGrantRows = async () =>
  (await q(`SELECT id FROM person_link WHERE purpose = 'grant' AND revoked_at IS NULL`)).length;

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  // A Gmail source with its own client and its account named: a migration a
  // grant link can serve. No allowance and no peak: the organisation is on Free.
  const creds = JSON.stringify(
    SecretStore.encryptCredentials({
      username: 'anna@example.invalid',
      clientId: 'client.apps.googleusercontent.com',
      clientSecret: 'not-a-real-secret',
    }).encrypted,
  );
  await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Limit BV']);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $2, 'source', 'gmail', 'g', '{}'::jsonb, 'connected', $3)`,
    [SOURCE_CONN, TENANT, creds],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'target', 'nextcloud', 'nc', '{"host":"cloud.example.org"}'::jsonb, 'connected')`,
    [TARGET_CONN, TENANT],
  );
  for (const [box, conn] of [
    [SOURCE_BOX, SOURCE_CONN],
    [TARGET_BOX, TARGET_CONN],
  ]) {
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [box, TENANT, conn],
    );
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1, $2, $3, $4, 'paused')`,
    [MAPPING, TENANT, SOURCE_BOX, TARGET_BOX],
  );
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1, $2, 'Anna')`, [ANNA, TENANT]);
  await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1, $2, $3)', [MAPPING, ANNA, TENANT]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await q('DELETE FROM person_link WHERE tenant_id = $1', [TENANT]);
  await q('DELETE FROM mapping_link WHERE tenant_id = $1', [TENANT]);
  await q('DELETE FROM grant_link_allowance WHERE tenant_id = $1', [TENANT]);
  await q('DELETE FROM occupancy_peak WHERE tenant_id = $1', [TENANT]);
});

describe('as many live grant links as the tier runs migrations (0108 T8 (d))', () => {
  it('issues an organisation on Free six live grant links, and refuses the seventh, writing nothing', async () => {
    for (let n = 0; n < 6; n++) expect((await issue()).status).toBe(201);

    const seventh = await issue();

    expect(seventh.status).toBe(409);
    expect(seventh.body).toMatchObject({ error: 'grant_links_at_limit', live: 6, limit: 6 });
    expect(seventh.body.reason).toBe(
      'This organisation has 6 grant links that can still be used, and may hold 6 at once: ' +
        'as many as its tier, Free, runs migrations at the same time. ' +
        'Revoke one that is no longer needed, or wait until one is used or expires.',
    );
    expect(await liveGrantRows()).toBe(6);
  });

  it('counts a migration’s link sent before the person’s replaced it, while it is live', async () => {
    const old = await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: TENANT,
        mappingId: MAPPING,
        purpose: 'grant',
        createdBy: 'pat',
        expiresAt: expiryFromDays(7),
      }),
    );
    // The migration's link and five of the person's: Free's six.
    for (let n = 0; n < 5; n++) expect((await issue()).status).toBe(201);

    const refused = await issue();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'grant_links_at_limit', live: 6, limit: 6 });

    await withTenant(driver, TENANT, (db) => revokeMappingLink(db, { tenantId: TENANT, linkId: old.id }));
    expect((await issue()).status).toBe(201);
  });

  it('never refuses a progress link: it grants nothing', async () => {
    // At Free's six.
    for (let n = 0; n < 6; n++) await issue();

    expect((await issue('view')).status).toBe(201);
  });

  it('makes room when a link is revoked, used, or expires', async () => {
    // Five held, so each issued below is the sixth: Free's last.
    for (let n = 0; n < 5; n++) await issue();
    const revoked = await issue();
    expect((await request(app).delete(`/api/people/${ANNA}/links/${revoked.body.id as string}`)).body).toEqual({
      revoked: true,
    });
    const used = await issue();
    expect(used.status).toBe(201);
    await q('UPDATE person_link SET used_at = now() WHERE id = $1', [used.body.id]);
    const expired = await issue();
    expect(expired.status).toBe(201);
    await q("UPDATE person_link SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.body.id]);

    expect((await issue()).status).toBe(201);
  });

  it('grows with the tier: twelve at once, for an organisation that ran seven migrations this month', async () => {
    await q(
      `INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at)
       VALUES ($1, date_trunc('month', now())::date, 7, now())`,
      [TENANT],
    );
    for (let n = 0; n < 12; n++) expect((await issue()).status).toBe(201);

    const thirteenth = await issue();

    expect(thirteenth.body).toMatchObject({ error: 'grant_links_at_limit', live: 12, limit: 12 });
    expect(thirteenth.body.reason).toContain('as many as its tier, Medium, runs migrations at the same time');
  });

  it("holds the operator's number while it stands, and the tier's again once its day has passed", async () => {
    await q(
      `INSERT INTO grant_link_allowance (tenant_id, live_links, until, set_by)
       VALUES ($1, 8, now() + interval '1 day', 'operator.sh fixture')`,
      [TENANT],
    );
    for (let n = 0; n < 8; n++) expect((await issue()).status).toBe(201);
    const ninth = await issue();
    expect(ninth.body).toMatchObject({ live: 8, limit: 8 });
    expect(ninth.body.reason).toMatch(/: the number set for this organisation through \d{4}-\d{2}-\d{2}\. /);

    await q(`UPDATE grant_link_allowance SET until = now() - interval '1 second' WHERE tenant_id = $1`, [TENANT]);

    expect((await issue()).body).toMatchObject({ live: 8, limit: 6 });
  });
});
