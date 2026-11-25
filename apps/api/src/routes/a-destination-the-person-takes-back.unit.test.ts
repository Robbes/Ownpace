// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DESTINATION THE PERSON TAKES BACK (workplan 0174 §4.3, §5.9).
 *
 * *"Withdrawing (the person's progress page) works per account for
 * destinations too: the secret keys the person typed are removed from the
 * connection, the managed row is deleted, and nothing writes to that account
 * until they grant again."* Anna connects her own Soverin account on her grant
 * link and later removes it on her progress page:
 *
 *  - her password goes from the connection, and the owner's values stay;
 *  - `person_granted_connection` is deleted;
 *  - both migrations into it are held: nothing writes to the account, and the
 *    readiness check says it waits for her grant, until she grants again, on a
 *    new link, when the hold lifts;
 *  - one `mapping.grant_withdrawn` row per migration, with no value;
 *  - a press on a page read before a new grant takes nothing;
 *  - Bert's destination, beside hers, is untouched, and his `ref` on her link
 *    takes nothing;
 *  - on Cirrux, the Drive sign-in she gave goes with the password, and the
 *    workspace that binds a later grant stays.
 *
 * PGlite as `app_user`, both chains; the servers are recorded.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.GRANT_PASSWORD_TESTS_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { expiryFromDays, pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY, CIRRUX_DRIVE_WORKSPACE_KEY } from '@openmig/shared';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import { annasRows, encrypted, mintFor, query, resetAnna, setUpAnna } from '../__tests__/password-link-fixture.ts';

const R = annasRows('01740022');
const ANNAS_ICLOUD = 'placeholder-icloud-app-password';
const ANNAS_SOVERIN = 'placeholder-soverin-password';
const BERTS_PASSWORD = 'placeholder-berts-own-password';
/** Bert's destination and his one migration into it, beside Anna's rows. */
const BERTS_JMAP = R.tenant.replace(/01$/, '14');
const BERTS_MIGRATION = R.tenant.replace(/01$/, '33');

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const CONNECTED: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connected', count: 1, unit: 'calendar' } };
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return { ...actual, probeSourceConnection: async () => CONNECTED, probeTargetConnection: async () => CONNECTED };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: async () => undefined };
});
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/core')>();
  return { ...actual, verifyMX: async () => ({ resolverResults: {} }) };
});

const { default: grantRoutes } = await import('./grant.ts');
const { default: viewRoutes } = await import('./view.ts');
const { accountRef } = await import('./migrations/person-grant-subject.ts');
const { hasAWayInOnBothSides } = await import('./migrations/withdrawal-hold.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);
app.use('/api/view', viewRoutes);

const q = (sql: string, params: unknown[] = []) => query(driver, sql, params);
const ICLOUD_REF = accountRef('source', 'apple', R.icloud, 'anna@icloud.com');
const SOVERIN_REF = accountRef('target', 'soverin', R.soverin, 'anna@soverin.net');

const put = (token: string, ref: string, password: string) =>
  request(app).put(`/api/grant/${token}/password`).send({ ref, values: { password } });

/** A person's progress link: its token. */
async function progressFor(personId: string): Promise<string> {
  const { token } = await withTenant(driver, R.tenant, (db) =>
    issuePersonLink(db, { tenantId: R.tenant, personId, purpose: 'view', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );
  return token;
}

/** Anna connects both her accounts on a fresh link. */
async function annaConnectsBoth(): Promise<void> {
  const { token } = await mintFor(driver, R);
  expect((await put(token, ICLOUD_REF, ANNAS_ICLOUD)).status).toBe(200);
  expect((await put(token, SOVERIN_REF, ANNAS_SOVERIN)).status).toBe(200);
}

async function destinationsOn(token: string): Promise<Array<{ ref: string; provider: string; drive: boolean }>> {
  const view = await request(app).get(`/api/view/${token}`);
  expect(view.status).toBe(200);
  return view.body.destinations;
}

const secretOf = async (id: string) => {
  const [c] = await q('SELECT secret_ref FROM connection WHERE id = $1', [id]);
  return c!.secret_ref === null ? null : (SecretStore.decryptCredentials(c!.secret_ref as string) as Record<string, string>);
};

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await setUpAnna(driver, R);
  // Bert's own JMAP account, which he connected through his link, and his migration into it.
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1,$2,'target','jmap','c',$3::jsonb,'connected',$4)`,
    [BERTS_JMAP, R.tenant, JSON.stringify({ baseUrl: 'https://jmap.example.net', user: 'bert@example.net' }), encrypted({ username: 'bert@example.net', password: BERTS_PASSWORD })],
  );
  const box = (c: string) => c.replace(/00(\d\d)$/, '02$1');
  await q(`INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`, [
    box(BERTS_JMAP),
    R.tenant,
    BERTS_JMAP,
  ]);
  await q(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'active')`, [
    BERTS_MIGRATION,
    R.tenant,
    box(R.oldMail),
    box(BERTS_JMAP),
  ]);
  await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [BERTS_MIGRATION, R.bert, R.tenant]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  await resetAnna(driver, R);
  await q('UPDATE connection SET kind = $2 WHERE id = $1', [R.soverin, 'soverin']);
  await q('DELETE FROM audit_log WHERE tenant_id = $1', [R.tenant]).catch(() => undefined);
  await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [BERTS_JMAP, R.tenant, R.bert]);
  await q('UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = $1', [BERTS_MIGRATION]);
});

describe('removing a destination’s password on the progress page (0174 §4.3)', () => {
  it('takes her keys off the connection, keeps the owner’s, deletes the row, and holds both migrations into it', async () => {
    await annaConnectsBoth();
    expect(await secretOf(R.soverin)).toEqual({ username: 'anna@soverin.net', password: ANNAS_SOVERIN });
    const progress = await progressFor(R.anna);
    const [soverin, ...others] = await destinationsOn(progress);
    expect(others).toEqual([]);
    expect(soverin).toMatchObject({ provider: 'soverin', drive: false });
    expect(soverin!.ref).toMatch(/^[0-9a-f]{32}$/);

    const res = await request(app).post(`/api/view/${progress}/withdraw`).send({ destination: soverin!.ref });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ withdrawnAt: expect.any(String), provider: 'soverin', drive: false });

    // Her password is gone; the user name the owner set stays.
    expect(await secretOf(R.soverin)).toEqual({ username: 'anna@soverin.net' });
    expect(await q('SELECT 1 FROM person_granted_connection WHERE connection_id = $1', [R.soverin])).toHaveLength(0);
    const [conn] = await q('SELECT status FROM connection WHERE id = $1', [R.soverin]);
    expect(conn!.status).toBe('error');

    // Both migrations into it are held, and neither has a way in now.
    for (const m of [R.icloudToSoverin, R.oldMailToSoverin]) {
      const [row] = await q('SELECT grant_withdrawn_at FROM mailbox_mapping WHERE id = $1', [m]);
      expect(row!.grant_withdrawn_at, m).not.toBeNull();
      expect(await withTenant(driver, R.tenant, (db) => hasAWayInOnBothSides(db, R.tenant, m))).toBe(false);
    }

    // One audit row per migration, with no value of hers.
    const rows = await q(
      `SELECT detail FROM audit_log WHERE action = 'mapping.grant_withdrawn' AND tenant_id = $1 ORDER BY detail->>'mappingId'`,
      [R.tenant],
    );
    expect(rows.map((r) => (r.detail as Record<string, unknown>).mappingId)).toEqual([R.icloudToSoverin, R.oldMailToSoverin].sort());
    for (const r of rows) expect(r.detail).toMatchObject({ role: 'target', provider: 'soverin', drive: false });
    expect(JSON.stringify(rows)).not.toContain(ANNAS_SOVERIN);
    expect(JSON.stringify(res.body)).not.toContain(ANNAS_SOVERIN);

    // The page no longer offers it.
    expect(await destinationsOn(progress)).toEqual([]);
  });

  it('nothing writes to the account until she grants again: her new link asks for it, and the hold lifts once she does', async () => {
    await annaConnectsBoth();
    const progress = await progressFor(R.anna);
    const [soverin] = await destinationsOn(progress);
    expect((await request(app).post(`/api/view/${progress}/withdraw`).send({ destination: soverin!.ref })).status).toBe(200);

    // The readiness check: her link asks for the Soverin password again, as before she first gave it.
    const { token } = await mintFor(driver, R);
    const card = (await request(app).get(`/api/grant/${token}`)).body.accounts.find((a: { ref: string }) => a.ref === SOVERIN_REF);
    expect(card).toMatchObject({ role: 'target', way: 'password', granted: false });

    // A press on the page read before the new grant takes nothing.
    expect((await put(token, SOVERIN_REF, ANNAS_SOVERIN)).status).toBe(200);
    const stale = await request(app).post(`/api/view/${progress}/withdraw`).send({ destination: soverin!.ref });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('changed');
    expect(await secretOf(R.soverin)).toEqual({ username: 'anna@soverin.net', password: ANNAS_SOVERIN });

    // Both sides have a way in again, so the hold is lifted.
    for (const m of [R.icloudToSoverin, R.oldMailToSoverin]) {
      const [row] = await q('SELECT grant_withdrawn_at FROM mailbox_mapping WHERE id = $1', [m]);
      expect(row!.grant_withdrawn_at, m).toBeNull();
    }
  });

  it('leaves Bert’s destination as it is, and his ref on her link takes nothing', async () => {
    await annaConnectsBoth();
    const berts = (await destinationsOn(await progressFor(R.bert)))[0]!;
    expect(berts.provider).toBe('jmap');

    const annas = await progressFor(R.anna);
    expect((await destinationsOn(annas)).map((d) => d.ref)).not.toContain(berts.ref);
    const refused = await request(app).post(`/api/view/${annas}/withdraw`).send({ destination: berts.ref });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('changed');

    const [soverin] = await destinationsOn(annas);
    expect((await request(app).post(`/api/view/${annas}/withdraw`).send({ destination: soverin!.ref })).status).toBe(200);

    expect(await secretOf(BERTS_JMAP)).toEqual({ username: 'bert@example.net', password: BERTS_PASSWORD });
    expect(await q('SELECT 1 FROM person_granted_connection WHERE connection_id = $1', [BERTS_JMAP])).toHaveLength(1);
    const [m] = await q('SELECT grant_withdrawn_at FROM mailbox_mapping WHERE id = $1', [BERTS_MIGRATION]);
    expect(m!.grant_withdrawn_at).toBeNull();
  });

  it('takes a body with exactly one of account and destination', async () => {
    const progress = await progressFor(R.anna);
    for (const body of [{}, { destination: 'nope' }, { account: 'a'.repeat(32), destination: 'b'.repeat(32) }]) {
      const res = await request(app).post(`/api/view/${progress}/withdraw`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('a Cirrux destination: the Drive sign-in goes with the password (0174 §4.3, §4.4)', () => {
  it('removes the app password and the Drive grant, and keeps the workspace that binds a later grant', async () => {
    await q('UPDATE connection SET kind = $2, secret_ref = $3 WHERE id = $1', [
      R.soverin,
      'cirrux',
      encrypted({
        username: 'anna@soverin.net',
        password: 'placeholder-cirrux-app-password',
        [CIRRUX_DRIVE_GRANT_KEY]: 'placeholder-drive-refresh-token',
        [CIRRUX_DRIVE_WORKSPACE_KEY]: 'workspace-uuid-placeholder',
      }),
    ]);
    await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [R.soverin, R.tenant, R.anna]);
    const progress = await progressFor(R.anna);
    const [cirrux] = await destinationsOn(progress);
    expect(cirrux).toMatchObject({ provider: 'cirrux', drive: true });

    const res = await request(app).post(`/api/view/${progress}/withdraw`).send({ destination: cirrux!.ref });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ provider: 'cirrux', drive: true });
    expect(await secretOf(R.soverin)).toEqual({ username: 'anna@soverin.net', [CIRRUX_DRIVE_WORKSPACE_KEY]: 'workspace-uuid-placeholder' });
    expect(await q('SELECT 1 FROM person_granted_connection WHERE connection_id = $1', [R.soverin])).toHaveLength(0);
    const rows = await q(`SELECT detail FROM audit_log WHERE action = 'mapping.grant_withdrawn' AND tenant_id = $1`, [R.tenant]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.detail).toMatchObject({ provider: 'cirrux', drive: true });
    expect(JSON.stringify(rows)).not.toContain('placeholder-drive-refresh-token');
  });
});
