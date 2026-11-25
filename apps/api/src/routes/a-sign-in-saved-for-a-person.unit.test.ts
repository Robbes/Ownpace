// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SIGN-IN ACCOUNT SAVED FOR A PERSON (workplan 0174 §8.2; found on the
 * managed test environment, alpha.20, 2026-11-25).
 *
 * A Google account saved by its address for a family member, *Used by 2
 * migrations*, whose sign-in that person gives through their grant link. The
 * sign-in lands on each of their migrations (`mailbox_mapping.source_secret_ref`,
 * 0108), never on the row. The Accounts page showed a red error icon, every
 * data type *"Unmeasured — the stored credentials carry no clientId/refreshToken
 * pair"*, and a Test answered with the advice for the owner's own Google app.
 * The account may be perfectly fine.
 *
 * Held here, through the real routes over a real (in-process) ledger as
 * `app_user`, both chains:
 *
 *  - `GET /api/connections` says `waitingFor` the person while no migration of
 *    theirs that reads it holds a sign-in, and `connectedBy` them once one
 *    does, for Google, Microsoft and Dropbox; and drops a record that was read
 *    with no token, so no stale "Unmeasured" sentence and no error is shown;
 *  - a row with a way in of its own, or that no person's migration reads, is
 *    neither, and keeps its record;
 *  - Test on such a row while it waits probes nothing and says so;
 *  - Test once a migration holds the sign-in measures with THAT sign-in,
 *    merged over the row's as a pass merges it, records that it did, and
 *    answers nothing of the token.
 *
 * UUID family 01740021-…, unused elsewhere. Addresses under `.invalid`; the
 * token is a placeholder.
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const U = (n: string) => `01740021-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const PERSON = U('41');
const GOOGLE_ROW = U('11');
const MICROSOFT_ROW = U('12');
const DROPBOX_ROW = U('13');
const OWNERS_GOOGLE = U('14');
const TARGET_ROW = U('15');
const PERSONS_TOKEN = 'placeholder-persons-refresh-token';

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

/** What the probe and the qualification were handed, to see which sign-in was used. */
const seen = vi.hoisted(() => ({
  probe: [] as Array<{ kind: string; config: Record<string, unknown>; creds: Record<string, string> }>,
  qualify: [] as Array<Record<string, string>>,
}));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  return {
    ...actual,
    probeSourceConnection: vi.fn(async (kind: string, config: Record<string, unknown>, creds: Record<string, string>) => {
      seen.probe.push({ kind, config, creds });
      return creds.refreshToken
        ? { ok: true, detail: 'Connected.', outcome: { code: 'connected', count: 2, unit: 'calendar' } }
        : { ok: false, reason: 'no token', outcome: { code: 'providerRefused' } };
    }),
  };
});
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  const yes = { answer: 'yes', detail: 'Read.', count: 1, unit: 'calendar' } as const;
  return {
    ...actual,
    qualifyAccount: vi.fn(async () => undefined),
    qualifyGoogleGrant: vi.fn(async (_kind: string, creds: Record<string, string>) => {
      seen.qualify.push(creds);
      return { domains: { mail: yes, calendar: yes, contact: yes, file: yes, task: yes } };
    }),
  };
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

const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

/** What a Test with no token stored on these rows, as alpha.20 wrote it. */
const READ_WITH_NO_TOKEN = (() => {
  const face = {
    answer: 'unknown',
    reason: 'refused',
    detail: 'Unmeasured — the stored credentials carry no clientId/refreshToken pair to read the grant from.',
  };
  return { domains: { mail: face, calendar: face, contact: face, file: face, task: face } };
})();

interface Listed {
  id: string;
  status: string;
  waitingFor?: { personId: string; name: string };
  connectedBy?: { personId: string; name: string };
  signInOnMigrations?: true;
  qualification: unknown;
}

const list = async (): Promise<Listed[]> => {
  const res = await request(app).get('/api/connections');
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).not.toContain(PERSONS_TOKEN);
  return res.body.connections as Listed[];
};
const row = (all: Listed[], id: string) => all.find((c) => c.id === id)!;

/** A migration of the person's from `source`, into the one destination. */
async function personsMigration(n: string, source: string, secret: Record<string, string> | null, override?: object) {
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','family@example.invalid')`,
    [U(`5${n}`), TENANT, source],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, source_secret_ref, source_config_override)
     VALUES ($1,$2,$3,$4,'paused',$5,$6)`,
    [U(`6${n}`), TENANT, U(`5${n}`), U('59'), secret ? sealed(secret) : null, override ? JSON.stringify(override) : null],
  );
  await sql('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [U(`6${n}`), PERSON, TENANT]);
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'A family']);
  await sql(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'A family member')`, [PERSON, TENANT]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  seen.probe.length = 0;
  seen.qualify.length = 0;
  resetProbeTestLimit();
  await sql('DELETE FROM person_migration WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await sql('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  const insert = (id: string, role: string, kind: string, name: string, secret: string | null, qualification: unknown) =>
    sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref, status, qualification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'error',$8)`,
      [id, TENANT, role, kind, name, JSON.stringify({ user: 'family@example.invalid' }), secret, JSON.stringify(qualification)],
    );
  // Saved by its address alone for a link: no token on the row.
  await insert(GOOGLE_ROW, 'source', 'google', 'Family · Google', sealed({}), READ_WITH_NO_TOKEN);
  await insert(MICROSOFT_ROW, 'source', 'microsoft', 'Family · Microsoft', null, READ_WITH_NO_TOKEN);
  await insert(DROPBOX_ROW, 'source', 'dropbox', 'Family · Dropbox', sealed({}), null);
  // The owner's own Google account, signed in on the row.
  await insert(OWNERS_GOOGLE, 'source', 'google', 'Mine · Google', sealed({ refreshToken: 'placeholder-owners-token' }), READ_WITH_NO_TOKEN);
  await insert(TARGET_ROW, 'target', 'jmap', 'Destination', sealed({ username: 'u', password: 'placeholder' }), null);
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','family@example.invalid')`,
    [U('59'), TENANT, TARGET_ROW],
  );
});

const person = { personId: PERSON, name: 'A family member' };

describe('the Accounts page: a sign-in account saved for a person (0174 §8.2)', () => {
  it('waits for the person while no migration of theirs holds a sign-in, with no error and no record read with no token', async () => {
    await personsMigration('1', GOOGLE_ROW, null);
    await personsMigration('2', GOOGLE_ROW, null);
    await personsMigration('3', MICROSOFT_ROW, null);
    await personsMigration('4', DROPBOX_ROW, null);
    const all = await list();
    for (const id of [GOOGLE_ROW, MICROSOFT_ROW, DROPBOX_ROW]) {
      expect(row(all, id), id).toMatchObject({ waitingFor: person, signInOnMigrations: true, qualification: null });
      expect(row(all, id).connectedBy, id).toBeUndefined();
    }
  });

  it('says the person connected it once one of their migrations holds their sign-in', async () => {
    await personsMigration('1', GOOGLE_ROW, null);
    await personsMigration('2', GOOGLE_ROW, { refreshToken: PERSONS_TOKEN });
    await personsMigration('3', DROPBOX_ROW, { refreshToken: PERSONS_TOKEN });
    const all = await list();
    for (const id of [GOOGLE_ROW, DROPBOX_ROW]) {
      expect(row(all, id), id).toMatchObject({ connectedBy: person, signInOnMigrations: true, qualification: null });
      expect(row(all, id).waitingFor, id).toBeUndefined();
    }
  });

  it('leaves alone a row with a sign-in of its own, and one no person’s migration reads', async () => {
    await personsMigration('1', OWNERS_GOOGLE, null);
    const all = await list();
    for (const id of [OWNERS_GOOGLE, MICROSOFT_ROW]) {
      expect(row(all, id).waitingFor, id).toBeUndefined();
      expect(row(all, id).connectedBy, id).toBeUndefined();
      expect(row(all, id).signInOnMigrations, id).toBeUndefined();
      expect(row(all, id).qualification, id).toEqual(READ_WITH_NO_TOKEN);
    }
  });
});

describe('Test on a sign-in account saved for a person (0174 §8.2)', () => {
  const test = (id: string) => request(app).post(`/api/connections/${id}/test`).send({});

  it('while it waits: probes nothing, says whom it waits for, and leaves the row as it was', async () => {
    await personsMigration('1', GOOGLE_ROW, null);
    const res = await test(GOOGLE_ROW);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, outcome: { code: 'waitingForPerson', person: 'A family member' } });
    expect(res.body.reason).toMatch(/^Waiting for A family member: .*Nothing is wrong with this account\.$/);
    expect(res.body.reason).not.toMatch(/clientId|refreshToken|client ID|secret/i);
    expect(seen.probe).toEqual([]);
    expect(seen.qualify).toEqual([]);
  });

  it('once a migration holds the sign-in: measures with it, merged as a pass merges it, and answers nothing of it', async () => {
    await personsMigration('1', GOOGLE_ROW, null);
    await personsMigration('2', GOOGLE_ROW, { refreshToken: PERSONS_TOKEN }, { user: 'their@example.invalid' });
    const res = await test(GOOGLE_ROW);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(PERSONS_TOKEN);
    expect(seen.probe).toEqual([
      { kind: 'google', config: { user: 'their@example.invalid' }, creds: { refreshToken: PERSONS_TOKEN } },
    ]);
    expect(seen.qualify).toEqual([{ refreshToken: PERSONS_TOKEN }]);
    expect(res.body.qualification.throughPersonsSignIn).toBe(true);

    // Recorded on the row, so the page shows what was measured, and no error.
    const after = row(await list(), GOOGLE_ROW);
    expect(after).toMatchObject({ status: 'connected', connectedBy: person });
    expect(after.qualification).toMatchObject({ throughPersonsSignIn: true, domains: { calendar: { answer: 'yes' } } });
  });
});
