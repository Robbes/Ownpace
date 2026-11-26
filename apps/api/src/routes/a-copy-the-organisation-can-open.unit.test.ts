// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY THE ORGANISATION CAN OPEN TOO (the owner's decisions of 2026-11-26,
 * change 3).
 *
 * A family member's grant page says, under a source's migration, who else can
 * open the copy when the destination is the organisation's: its own password
 * on the account, not one the person gives on the link, and not one the
 * person connected themselves (`person_granted_connection`). The grant link's
 * GET says it per migration, as `theOrganisationOpensIt`. Anna's iCloud
 * account is copied into her Soverin account:
 *
 *  - the Soverin password is asked of her on the link: false;
 *  - the owner typed the Soverin password themselves: true;
 *  - she connected Soverin herself on her link: false.
 *
 * PGlite as `app_user`, both chains.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { annasRows, encrypted, mintFor, query, resetAnna, setUpAnna } from '../__tests__/password-link-fixture.ts';

const R = annasRows('0226c3a1');
let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return { ...actual, verifyMX: async () => ({ resolverResults: {} }) };
});

const { default: grantRoutes } = await import('./grant.ts');
const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);

const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);

/** What the iCloud card says of its migration into Soverin. */
async function iCloudsMigration() {
  const { token } = await mintFor(driver, R);
  const page = await request(app).get(`/api/grant/${token}`);
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  const card = page.body.accounts.find((a: { role: string; provider: string }) => a.role === 'source' && a.provider === 'apple');
  expect(card, JSON.stringify(page.body.accounts)).toBeDefined();
  return card.migrations[0] as { theOrganisationOpensIt: boolean };
}

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await setUpAnna(driver, R);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await resetAnna(driver, R);
});

describe('who can open the copy (the owner’s decisions of 2026-11-26, change 3)', () => {
  it('a destination whose password is asked of the person: not the organisation’s', async () => {
    expect((await iCloudsMigration()).theOrganisationOpensIt).toBe(false);
  });

  it('a destination the owner connected with their own password: the organisation can open the copy too', async () => {
    await q('UPDATE connection SET secret_ref = $2 WHERE id = $1', [
      R.soverin,
      encrypted({ username: 'anna@soverin.net', password: 'placeholder-the-owners' }),
    ]);
    expect((await iCloudsMigration()).theOrganisationOpensIt).toBe(true);
  });

  it('a destination the person connected themselves: not the organisation’s, though its password is stored', async () => {
    await q('UPDATE connection SET secret_ref = $2 WHERE id = $1', [
      R.soverin,
      encrypted({ username: 'anna@soverin.net', password: 'placeholder-her-own' }),
    ]);
    await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [R.soverin, R.tenant, R.anna]);
    expect((await iCloudsMigration()).theOrganisationOpensIt).toBe(false);
  });
});
