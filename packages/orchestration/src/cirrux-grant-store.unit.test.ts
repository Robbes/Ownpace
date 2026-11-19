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
 *   mailbox only;
 * - DISCONNECT CIRRUX DRIVE (workplan 0160) removes the grant and nothing
 *   else, from a Cirrux destination of this organisation only, writes the
 *   record's file face and its audit line in the same transaction, answers
 *   an account with no grant as `not_connected` without touching the secret,
 *   and the store then says no grant is held, so a refresh asks Cirrux
 *   nothing.
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
  removeCirruxDriveGrant,
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

describe('Disconnect Cirrux Drive: the grant taken off, and nothing else (workplan 0160)', () => {
  const row = (connectionId = CIRRUX, tenantId = TENANT) => ({ pool: driver, tenantId, connectionId });
  const unasked = { answer: 'unknown', reason: 'notAskable', detail: 'not this file’s subject' };
  const MEASURED = {
    domains: {
      mail: { answer: 'yes', detail: 'mail' },
      calendar: { answer: 'yes', detail: 'calendars' },
      contact: unasked,
      task: unasked,
      file: { answer: 'yes', detail: 'Cirrux Drive connected as the-login: 3 items at the top level.' },
    },
    scheduling: { capability: 'server' },
  };
  const NOT_CONNECTED = { answer: 'no', reason: 'notGranted', detail: 'Cirrux Drive is not connected on this account.' };
  const WITH_SETTINGS = { ...APP_PASSWORD, host: 'api.cirrux.co', mailHost: 'imap.cirrux.co' };

  async function setQualification(q: unknown, id = CIRRUX): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query('UPDATE connection SET qualification = $1::jsonb WHERE id = $2', [q === null ? null : JSON.stringify(q), id]);
    } finally {
      conn.release();
    }
  }
  async function storedQualification(id = CIRRUX): Promise<{ domains?: Record<string, unknown>; scheduling?: unknown } | null> {
    const conn = await driver.acquire();
    try {
      const r = await conn.query('SELECT qualification FROM connection WHERE id = $1', [id]);
      return (r.rows[0] as { qualification: { domains?: Record<string, unknown> } | null }).qualification;
    } finally {
      conn.release();
    }
  }

  it('removes the grant and keeps the app password and every other key, encrypted, under the row lock', async () => {
    await setCreds({ ...WITH_SETTINGS, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-held' });
    let recordedIn: unknown;
    const outcome = await removeCirruxDriveGrant(row(), {
      recorded: async (db) => {
        recordedIn = db;
      },
    });
    expect(outcome).toBe('removed');
    expect(await storedCreds()).toEqual(WITH_SETTINGS);
    expect(await rawSecretRef()).not.toContain('rt-held');
    expect(await rawSecretRef()).not.toContain('app-password-1');
    // The audit line is written in the removal's own transaction.
    expect(recordedIn).toBeDefined();
  });

  it('writes the record’s file face in the same transaction, and leaves the other faces as they were', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-held' });
    await setQualification(MEASURED);
    expect(await removeCirruxDriveGrant(row(), { face: NOT_CONNECTED })).toBe('removed');
    expect(await storedQualification()).toEqual({ ...MEASURED, domains: { ...MEASURED.domains, file: NOT_CONNECTED } });
  });

  it('a row with no record is left without one: nothing claims the Drive either way', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-held' });
    await setQualification(null);
    expect(await removeCirruxDriveGrant(row(), { face: NOT_CONNECTED })).toBe('removed');
    expect(await storedQualification()).toBeNull();
  });

  it('an account with no grant is not_connected: the secret is not written and nothing is recorded, and a stale face is put right', async () => {
    await setCreds(APP_PASSWORD);
    await setQualification(MEASURED);
    const before = await rawSecretRef();
    let recorded = 0;
    const outcome = await removeCirruxDriveGrant(row(), {
      face: NOT_CONNECTED,
      recorded: async () => {
        recorded += 1;
      },
    });
    expect(outcome).toBe('not_connected');
    expect(await rawSecretRef()).toBe(before);
    expect(recorded).toBe(0);
    expect((await storedQualification())?.domains?.file).toEqual(NOT_CONNECTED);
  });

  it('pressed twice: removed, then not_connected, the record as the first left it', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-held' });
    expect(await removeCirruxDriveGrant(row())).toBe('removed');
    const after = await rawSecretRef();
    expect(await removeCirruxDriveGrant(row())).toBe('not_connected');
    expect(await rawSecretRef()).toBe(after);
    expect(await storedCreds()).toEqual(APP_PASSWORD);
  });

  it('only on a Cirrux destination of this organisation: another kind, or another organisation’s row, is no_account and untouched', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-ours' }, SOVERIN);
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-theirs' }, THEIRS);
    expect(await removeCirruxDriveGrant(row(SOVERIN))).toBe('no_account');
    expect((await storedCreds(SOVERIN))[CIRRUX_DRIVE_GRANT_KEY]).toBe('rt-ours');
    // Named in our organisation, the other organisation's row is not found.
    expect(await removeCirruxDriveGrant(row(THEIRS))).toBe('no_account');
    expect((await storedCreds(THEIRS, OTHER_TENANT))[CIRRUX_DRIVE_GRANT_KEY]).toBe('rt-theirs');
    expect(await removeCirruxDriveGrant(row('01600cc0-e29b-41d4-a716-446655440099'))).toBe('no_account');
  });

  it('an audit line that cannot be written keeps the grant: both commit or neither', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-held' });
    await expect(
      removeCirruxDriveGrant(row(), {
        recorded: async () => {
          throw new Error('the audit log is not there');
        },
      }),
    ).rejects.toThrow(/audit log/);
    expect((await storedCreds())[CIRRUX_DRIVE_GRANT_KEY]).toBe('rt-held');
  });

  it('the store then holds no grant, and a refresh asks Cirrux nothing and says the Drive is not connected', async () => {
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-0' });
    expect(await store().holdsGrant()).toBe(true);
    await removeCirruxDriveGrant(row());
    expect(await store().holdsGrant()).toBe(false);
    const cirrux = new FakeCirrux({ refreshToken: 'rt-0' });
    const tokens = new CirruxTokenProvider({ clientId: 'c', store: store(), fetchImpl: cirrux.fetch });
    await expect(tokens.getAccessToken()).rejects.toThrow(/no Cirrux Drive connected/);
    expect(cirrux.presented).toEqual([]);
  });

  it('holdsGrant: a row that is gone holds none, and the store names its connection', async () => {
    expect(store().connection).toBe(CIRRUX);
    expect(
      await new PgCirruxGrantStore({ pool: driver, tenantId: TENANT, connectionId: '01600cc0-e29b-41d4-a716-446655440099' }).holdsGrant(),
    ).toBe(false);
    // Another organisation's row, asked from ours, is not read.
    await setCreds({ ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-theirs' }, THEIRS);
    expect(await new PgCirruxGrantStore({ pool: driver, tenantId: TENANT, connectionId: THEIRS }).holdsGrant()).toBe(false);
  });
});
