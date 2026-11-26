// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DESTINATION'S PASSWORD REMOVED IS NOT A SOURCE'S ACCESS WITHDRAWN (the
 * owner's decisions of 2026-11-26, change 1).
 *
 * A family member copies their Google account into a Soverin account they
 * connected with their own password on their grant link. On their progress
 * page they press *Remove my password* for Soverin. That holds every
 * migration into it (`grant_withdrawn_at`), which is right, but until this
 * change both progress pages read the hold as the SOURCE's access taken
 * back: *"on {date} you withdrew the access you gave"*, about a Google
 * account the person never touched.
 *
 * The server now says what stopped, from what the withdrawal stored: the
 * `mapping.grant_withdrawn` audit row it writes in the same transaction
 * carries `role: 'target'` for a destination, and none for a source. Checked
 * here for:
 *
 *  - a destination removed while the Google access is held: the person's
 *    page and the migration's own page say `destination`, and which one;
 *  - a destination removed BEFORE the Google access was ever given (the
 *    source column is empty, so the columns alone cannot tell the two apart);
 *  - the Google access withdrawn: still `source`, as before.
 *
 * PGlite as `app_user`, both chains. Google's revoke endpoint is a stub.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { expiryFromDays, issueMappingLink, pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import type { TokenRevoker } from '@openmig/shared';

// UUID family 0226a21f-…, unused elsewhere in the repo.
const U = (n: string) => `0226a21f-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const GOOGLE = U('11');
const SOVERIN = U('12');
const GOOGLE_BOX = U('21');
const SOVERIN_BOX = U('22');
const MAIL = U('31');
const PERSON = U('41');

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { readPersonView, withdrawPersonDestination, withdrawPersonGrant } = await import('./person-progress.ts');
const { default: viewRoutes } = await import('./view.ts');

const app = express();
app.use(express.json());
app.use('/api/view', viewRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const enc = (values: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(values).encrypted);
const LINK = { tenantId: TENANT, personId: PERSON, linkId: U('51') };
const REVOKER: TokenRevoker = { revoke: async () => ({ status: 'revoked' }) } as unknown as TokenRevoker;

const personPage = () =>
  withTenant(driver, TENANT, (db) => readPersonView(db, { tenantId: TENANT, personId: PERSON, expiresAt: expiryFromDays(7) }));

async function migrationPage() {
  const { token } = await withTenant(driver, TENANT, (db) =>
    issueMappingLink(db, { tenantId: TENANT, mappingId: MAIL, purpose: 'view', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );
  const page = await request(app).get(`/api/view/${token}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  return page.body as import('@openmig/shared').MigrationView;
}

async function removeSoverin() {
  const page = await personPage();
  const ref = page!.destinations![0]!.ref;
  const removed = await withdrawPersonDestination(driver, LINK, ref);
  expect(removed.ok).toBe(true);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Family']);
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
       ($1,$3,'source','google','g','{"user":"person@gmail.com"}'::jsonb,'connected',NULL),
       ($2,$3,'target','soverin','s','{"user":"person@soverin.net"}'::jsonb,'connected',NULL)`,
    [GOOGLE, SOVERIN, TENANT],
  );
  for (const [box, conn] of [
    [GOOGLE_BOX, GOOGLE],
    [SOVERIN_BOX, SOVERIN],
  ]) {
    await q(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`, [
      box,
      TENANT,
      conn,
    ]);
  }
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'active')`,
    [MAIL, TENANT, GOOGLE_BOX, SOVERIN_BOX],
  );
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'P')`, [PERSON, TENANT]);
  await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [MAIL, PERSON, TENANT]);
}, 60_000);

afterAll(async () => {
  await driver.end?.();
});

/** The person gave their Soverin password on their link, and (with `google`) their Google access. */
async function connected({ google }: { google: boolean }) {
  await q('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await q('DELETE FROM person_granted_connection WHERE tenant_id = $1', [TENANT]);
  await q('UPDATE connection SET secret_ref = $2, status = $3 WHERE id = $1', [
    SOVERIN,
    enc({ username: 'person@soverin.net', password: 'placeholder-their-own' }),
    'connected',
  ]);
  await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [SOVERIN, TENANT, PERSON]);
  await q('UPDATE mailbox_mapping SET source_secret_ref = $2, grant_withdrawn_at = NULL WHERE id = $1', [
    MAIL,
    google ? enc({ refreshToken: '1//placeholder-refresh' }) : null,
  ]);
}

beforeEach(async () => {
  await connected({ google: true });
});

describe('what stopped, as the progress pages are told (the owner’s decisions of 2026-11-26, change 1)', () => {
  it('a destination’s password removed: the person’s page names the destination, not the Google account', async () => {
    await removeSoverin();
    const page = (await personPage())!;
    const [mine] = page.migrations;
    expect(mine!.stopped).toEqual({ at: expect.any(String), what: 'destination', destination: 'soverin' });
    // The account section is withdrawn only in the sense that nothing of it is held for migrating.
    expect(page.accounts[0]!.grant).toEqual({
      state: 'withdrawn',
      withdrawnAt: mine!.stopped!.at,
      what: 'destination',
      destination: 'soverin',
    });
  });

  it('the migration’s own page says the same', async () => {
    await removeSoverin();
    const page = await migrationPage();
    expect(page.grant).toEqual({ state: 'withdrawn', withdrawnAt: expect.any(String), what: 'destination', destination: 'soverin' });
  });

  it('a destination removed before the Google access was ever given: still the destination', async () => {
    await connected({ google: false });
    await removeSoverin();
    const page = (await personPage())!;
    expect(page.migrations[0]!.stopped).toMatchObject({ what: 'destination', destination: 'soverin' });
    expect((await migrationPage()).grant).toMatchObject({ state: 'withdrawn', what: 'destination' });
  });

  it('the Google access withdrawn: the source, as before', async () => {
    const before = (await personPage())!;
    const withdrawn = await withdrawPersonGrant(driver, LINK, before.accounts[0]!.ref, REVOKER);
    expect(withdrawn.ok).toBe(true);
    const page = (await personPage())!;
    expect(page.migrations[0]!.stopped).toEqual({ at: expect.any(String), what: 'source' });
    expect(page.accounts[0]!.grant).toEqual({ state: 'withdrawn', withdrawnAt: expect.any(String), what: 'source' });
    expect((await migrationPage()).grant).toMatchObject({ state: 'withdrawn', what: 'source' });
  });

  it('nothing stopped: no `stopped` at all', async () => {
    const page = (await personPage())!;
    expect(page.migrations[0]).not.toHaveProperty('stopped');
    expect(page.accounts[0]!.grant).toEqual({ state: 'granted' });
  });
});
