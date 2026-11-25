// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT SAVED FOR A PERSON, WITHOUT ITS PASSWORD (workplan 0174 §8.2, T6).
 *
 * *Start a migration*, with *They do, with a link*, saves Anna's iCloud and
 * her Soverin account by their servers and accounts alone; she types each
 * password on her grant link's page. What the create door holds to, through
 * the real door over a real (in-process) ledger as `app_user`, both chains:
 *
 *  - a password account saved `forPerson` is stored WITHOUT its secret: no
 *    password in its config or its encrypted record, never probed (a login
 *    with no password at Anna's own server would count against her there),
 *    stored `error` as an account saved by its address alone for a link
 *    always was;
 *  - it is refused WITHOUT ITS SERVER: the person's page shows the server and
 *    never asks for it (D2), so the owner must set it;
 *  - Infomaniak's sync user name may be left for the person, who alone can
 *    read it (`personFieldsFor`'s `who: 'person'`);
 *  - a password sent with it is refused and nothing stored: it never passes
 *    through the one saving it;
 *  - a kind no link connects with a password is refused, and so is a person
 *    who is not this organisation's;
 *  - without `forPerson`, nothing changed: the password is still required.
 *
 * UUID family 01740006-…, unused elsewhere. Addresses under `.invalid`.
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const U = (n: string) => `01740006-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const OTHER_TENANT = U('02');
const ANNA = U('41');
const SOMEBODY_ELSES = U('42');

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'the-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

// A probe here is a defect for `forPerson`: it would log in with no password.
const probed = vi.hoisted(() => ({ count: 0 }));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const answer = async () => {
    probed.count += 1;
    return { ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } };
  };
  return { ...actual, probeSourceConnection: vi.fn(answer), probeTargetConnection: vi.fn(answer) };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

const { resetProbeTestLimit } = await import('../probe-limit.ts');
const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Every row the door stored, as the person's page and a pass would read it. */
async function stored(): Promise<Array<{ id: string; kind: string; status: string; config: Record<string, unknown>; creds: Record<string, string> }>> {
  const rows = await sql(`SELECT id, kind, status, config, secret_ref FROM connection WHERE tenant_id = $1`, [TENANT]);
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    status: String(r.status),
    config: r.config as Record<string, unknown>,
    creds:
      typeof r.secret_ref === 'string' && r.secret_ref !== ''
        ? (SecretStore.decryptCredentials(JSON.parse(r.secret_ref)) as Record<string, string>)
        : {},
  }));
}

const add = (body: Record<string, unknown>) => request(app).post('/api/connections').send(body);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2), ($3,$4)', [TENANT, 'Acme Legal', OTHER_TENANT, 'Elsewhere']);
  await sql(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna'), ($3,$4,'Somebody')`, [
    ANNA,
    TENANT,
    SOMEBODY_ELSES,
    OTHER_TENANT,
  ]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  probed.count = 0;
  resetProbeTestLimit();
  await sql('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
});

describe('an account saved for a person (0174 §8.2)', () => {
  it('saves her iCloud by its address alone: no password, not probed, stored as waiting', async () => {
    const res = await add({
      role: 'source',
      type: 'apple',
      displayName: 'Anna · iCloud',
      values: { username: 'anna@icloud.invalid' },
      forPerson: ANNA,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), forPerson: true });
    expect(probed.count).toBe(0);
    const [row] = await stored();
    expect(row).toMatchObject({ id: res.body.id, kind: 'apple', status: 'error' });
    expect(Object.keys(row!.config)).not.toContain('password');
    expect(row!.creds.password ?? '').toBe('');
  });

  it('saves her Soverin account with its servers and no password', async () => {
    const res = await add({
      role: 'target',
      type: 'soverin',
      displayName: 'Anna · Soverin',
      values: {
        host: 'dav.soverin.invalid',
        port: '443',
        username: 'anna@soverin.invalid',
        mailHost: 'imap.soverin.invalid',
        mailPort: '993',
      },
      forPerson: ANNA,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(probed.count).toBe(0);
    const [row] = await stored();
    expect(row).toMatchObject({ kind: 'soverin', status: 'error' });
    expect(JSON.stringify(row!.config)).toContain('dav.soverin.invalid');
    expect(JSON.stringify(row!.config)).toContain('imap.soverin.invalid');
    expect(Object.keys(row!.config)).not.toContain('password');
    expect(row!.creds.password ?? '').toBe('');
  });

  it('is refused without its server, which the person is shown and never asked for (D2)', async () => {
    const imap = await add({
      role: 'source',
      type: 'imap',
      displayName: 'Anna · mail',
      values: { port: '993', username: 'anna@old.invalid' },
      forPerson: ANNA,
    });
    expect(imap.status).toBe(400);
    expect(imap.body).toMatchObject({ error: 'missing_fields', fields: ['host'] });

    const nextcloud = await add({
      role: 'target',
      type: 'nextcloud',
      displayName: 'Anna · Nextcloud',
      values: { username: 'anna' },
      forPerson: ANNA,
    });
    expect(nextcloud.status).toBe(400);
    expect(nextcloud.body).toMatchObject({ error: 'missing_fields', fields: ['url'] });
    expect(await stored()).toEqual([]);
    expect(probed.count).toBe(0);
  });

  it('leaves Infomaniak’s sync user name to the person, who alone can read it', async () => {
    const res = await add({
      role: 'target',
      type: 'infomaniak',
      displayName: 'Anna · Infomaniak',
      values: { host: 'sync.infomaniak.invalid', port: '443' },
      forPerson: ANNA,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(probed.count).toBe(0);
  });

  it('refuses a password sent with it, and stores nothing: it never passes through the one saving it', async () => {
    const res = await add({
      role: 'source',
      type: 'imap',
      displayName: 'Anna · mail',
      values: { host: 'imap.old.invalid', port: '993', username: 'anna@old.invalid', password: 'placeholder-not-a-password' },
      forPerson: ANNA,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'secret_for_person', fields: ['password'] });
    expect(JSON.stringify(res.body)).not.toContain('placeholder-not-a-password');
    expect(await stored()).toEqual([]);
  });

  it('refuses a kind no link connects with a password', async () => {
    const res = await add({
      role: 'source',
      type: 'box',
      displayName: 'Anna · Box',
      values: { userId: '1' },
      forPerson: ANNA,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'not_by_link' });
    expect(await stored()).toEqual([]);
  });

  it('refuses a person who is not this organisation’s, and stores nothing', async () => {
    const res = await add({
      role: 'source',
      type: 'apple',
      displayName: 'Somebody · iCloud',
      values: { username: 'somebody@icloud.invalid' },
      forPerson: SOMEBODY_ELSES,
    });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'person_not_found' });
    expect(await stored()).toEqual([]);
  });

  it('changes nothing without it: the owner’s own account still needs its password', async () => {
    const res = await add({
      role: 'source',
      type: 'imap',
      displayName: 'Mine',
      values: { host: 'imap.mine.invalid', port: '993', username: 'me@mine.invalid' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_fields', fields: ['password'] });
  });
});

describe('the Accounts page says whom it waits for (0174 §8.2)', () => {
  const MAPPING = U('31');
  const list = async () => {
    const res = await request(app).get('/api/connections');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    return res.body.connections as Array<{ id: string; waitingFor?: { personId: string; name: string } }>;
  };
  const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

  it('names Anna on her iCloud and her Soverin account once a migration of hers uses them, and nobody once each has its password', async () => {
    const icloud = (
      await add({
        role: 'source',
        type: 'apple',
        displayName: 'Anna · iCloud',
        values: { username: 'anna@icloud.invalid' },
        forPerson: ANNA,
      })
    ).body.id as string;
    const soverin = (
      await add({
        role: 'target',
        type: 'soverin',
        displayName: 'Anna · Soverin',
        values: { host: 'dav.soverin.invalid', port: '443', username: 'anna@soverin.invalid' },
        forPerson: ANNA,
      })
    ).body.id as string;
    // Saved, and no migration of hers uses them yet: nobody to name.
    expect((await list()).every((c) => c.waitingFor === undefined)).toBe(true);

    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid'), ($4,$2,$5,'user','m@example.invalid')`,
      [U('21'), TENANT, icloud, U('22'), soverin],
    );
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'paused')`,
      [MAPPING, TENANT, U('21'), U('22')],
    );
    await sql('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [MAPPING, ANNA, TENANT]);
    try {
      const anna = { personId: ANNA, name: 'Anna' };
      const now = await list();
      expect(now.find((c) => c.id === icloud)?.waitingFor).toEqual(anna);
      expect(now.find((c) => c.id === soverin)?.waitingFor).toEqual(anna);

      // Her iCloud password lands on the migration; her Soverin one on the account.
      await sql('UPDATE mailbox_mapping SET source_secret_ref = $2 WHERE id = $1', [
        MAPPING,
        sealed({ password: 'placeholder-app-password' }),
      ]);
      await sql('UPDATE connection SET secret_ref = $2 WHERE id = $1', [
        soverin,
        sealed({ username: 'anna@soverin.invalid', password: 'placeholder' }),
      ]);
      expect((await list()).every((c) => c.waitingFor === undefined)).toBe(true);
    } finally {
      await sql('DELETE FROM person_migration WHERE mapping_id = $1', [MAPPING]);
      await sql('DELETE FROM mailbox_mapping WHERE id = $1', [MAPPING]);
      await sql('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
    }
  });
});
