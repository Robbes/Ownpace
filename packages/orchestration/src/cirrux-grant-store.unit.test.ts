// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CIRRUX DRIVE GRANT ON ITS ROW (workplan 0160 T5; ADR-0052), over the
 * whole migration chain on PGlite, as the `app_user` role.
 *
 * What the database half of the write-back promises, apart from the lock's
 * concurrency (which only a server with two sessions can show, and
 * `cirrux-grant-store.integration.test.ts` does):
 *
 * - a refresh's successor is stored, ENCRYPTED, in the same record as the app
 *   password, and the next refresh is handed it;
 * - a token Cirrux may have spent is REMOVED, in a transaction that commits
 *   even though the refresh fails;
 * - a refresh Cirrux said nothing about stores NOTHING;
 * - the token is never in the row in plaintext;
 * - the consent door stores a grant only on a Cirrux destination of this
 *   organisation, and replacing the app password keeps it for the same
 *   mailbox only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { connection as connectionTable, pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { CIRRUX_DRIVE_GRANT_KEY } from '@openmig/shared';
import { CirruxTokenProvider } from '@openmig/connectors';
import { FakeCirrux } from '../../connectors/src/__testing__/cirrux-fake.ts';
import {
  PgCirruxGrantStore,
  mergeKeepingTheDriveGrant,
  storeCirruxDriveGrant,
} from './cirrux-grant-store.ts';

const TENANT = '01600cc0-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '01600cc0-e29b-41d4-a716-446655440002';
const CIRRUX = '01600cc0-e29b-41d4-a716-446655440011';
const SOVERIN = '01600cc0-e29b-41d4-a716-446655440012';
const THEIRS = '01600cc0-e29b-41d4-a716-446655440013';
const APP_PASSWORD = { username: 'anna@example.com', password: 'app-password-1' };

let driver: LedgerDriver;

async function storedCreds(id = CIRRUX, tenant = TENANT): Promise<Record<string, string>> {
  const ref = await withTenant(driver, tenant, async (db) => {
    const rows = await db
      .select({ secretRef: connectionTable.secretRef })
      .from(connectionTable)
      .where(and(eq(connectionTable.id, id), eq(connectionTable.tenantId, tenant)));
    return rows[0]?.secretRef;
  });
  return ref ? SecretStore.decryptCredentials(ref) : {};
}

async function rawSecretRef(): Promise<string> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT secret_ref FROM connection WHERE id = $1', [CIRRUX]);
    return String((r.rows[0] as { secret_ref: string }).secret_ref);
  } finally {
    conn.release();
  }
}

async function setCreds(creds: Record<string, string>, id = CIRRUX): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query('UPDATE connection SET secret_ref = $1 WHERE id = $2', [
      JSON.stringify(SecretStore.encryptCredentials(creds).encrypted),
      id,
    ]);
  } finally {
    conn.release();
  }
}

beforeAll(async () => {
  process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2), ($3,$4)', [TENANT, 'ours', OTHER_TENANT, 'theirs']);
    const secret = (c: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(c).encrypted);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'target','cirrux','Cirrux','{}'::jsonb,'connected',$3),
              ($4,$2,'target','soverin','Soverin','{}'::jsonb,'connected',$3),
              ($5,$6,'target','cirrux','Theirs','{}'::jsonb,'connected',$3)`,
      [CIRRUX, TENANT, secret(APP_PASSWORD), SOVERIN, THEIRS, OTHER_TENANT],
    );
  } finally {
    conn.release();
  }
}, 120_000);

const store = () => new PgCirruxGrantStore({ pool: driver, tenantId: TENANT, connectionId: CIRRUX });

describe('a refresh, written back', () => {
  it('stores the successor beside the app password, encrypted, and hands it to the next refresh', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    let clock = 0;
    const cirrux = new FakeCirrux({ refreshToken: 'rt-0' });
    const tokens = new CirruxTokenProvider({ clientId: 'c', store: store(), fetchImpl: cirrux.fetch, now: () => clock });
    await tokens.getAccessToken();
    const first = (await storedCreds())[CIRRUX_DRIVE_GRANT_KEY];
    expect(first).toBe(cirrux.liveRefresh);
    clock += 16 * 60_000;
    await tokens.getAccessToken();
    expect(cirrux.presented).toEqual(['rt-0', first]);
    const after = await storedCreds();
    expect(after).toEqual({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: cirrux.liveRefresh });
    expect(cirrux.signedOut).toBe(false);
    // Never in the row as plaintext.
    expect(await rawSecretRef()).not.toContain(cirrux.liveRefresh!);
  });

  it('two runs, one after the other, each take the token the last one stored', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    const cirrux = new FakeCirrux({ refreshToken: 'rt-0' });
    const run = () => new CirruxTokenProvider({ clientId: 'c', store: store(), fetchImpl: cirrux.fetch }).getAccessToken();
    await Promise.all([run(), run(), run()]);
    expect(new Set(cirrux.presented).size).toBe(3);
    expect(cirrux.signedOut).toBe(false);
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe(cirrux.liveRefresh);
  });

  it('removes a token Cirrux may have spent, and keeps that removal though the refresh fails', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    const cirrux = new FakeCirrux({ refreshToken: 'rt-0' });
    cirrux.tokenFault = 'reset';
    const tokens = new CirruxTokenProvider({ clientId: 'c', store: store(), fetchImpl: cirrux.fetch });
    await expect(tokens.getAccessToken()).rejects.toThrow(/never arrived/);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('stores nothing when Cirrux said nothing was done', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    const before = await rawSecretRef();
    const cirrux = new FakeCirrux({ refreshToken: 'rt-0' });
    cirrux.tokenFault = 'server-error';
    await expect(new CirruxTokenProvider({ clientId: 'c', store: store(), fetchImpl: cirrux.fetch }).getAccessToken()).rejects.toThrow(
      /Nothing was spent/,
    );
    expect(await rawSecretRef()).toBe(before);
  });

  it('says the Drive is not connected, and asks nothing, when no grant is stored', async () => {
    await setCreds(APP_PASSWORD);
    let asked = false;
    await expect(
      store().rotate(async () => {
        asked = true;
        return { kind: 'kept', error: new Error('x') };
      }),
    ).rejects.toThrow(/no Cirrux Drive connected/);
    expect(asked).toBe(false);
  });
});

describe('the consent door’s grant, and the app password beside it', () => {
  it('stores a grant only on a Cirrux destination of this organisation', async () => {
    await setCreds(APP_PASSWORD);
    expect(await storeCirruxDriveGrant({ pool: driver, tenantId: TENANT, connectionId: CIRRUX }, 'rt-new')).toBe('stored');
    expect(await storedCreds()).toEqual({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-new' });
    expect(await storeCirruxDriveGrant({ pool: driver, tenantId: TENANT, connectionId: SOVERIN }, 'rt-new')).toBe('no_account');
    expect(await storeCirruxDriveGrant({ pool: driver, tenantId: TENANT, connectionId: THEIRS }, 'rt-new')).toBe('no_account');
    expect((await storedCreds(THEIRS, OTHER_TENANT))[CIRRUX_DRIVE_GRANT_KEY]).toBeUndefined();
  });

  it('a new app password for the same mailbox keeps the Drive; another mailbox’s does not', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    const same = await withTenant(driver, TENANT, (db) =>
      mergeKeepingTheDriveGrant(db, TENANT, CIRRUX, { username: 'Anna@Example.com', password: 'app-password-2' }),
    );
    expect(same).toEqual({ username: 'Anna@Example.com', password: 'app-password-2', [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    const other = await withTenant(driver, TENANT, (db) =>
      mergeKeepingTheDriveGrant(db, TENANT, CIRRUX, { username: 'bob@example.com', password: 'app-password-3' }),
    );
    expect(other).toEqual({ username: 'bob@example.com', password: 'app-password-3' });
  });
});
