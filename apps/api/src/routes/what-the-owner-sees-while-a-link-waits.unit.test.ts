// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE OWNER SEES WHILE A PERSON'S LINK WAITS (workplan 0174 §4.6, T6).
 *
 * Anna moves off iCloud into her own Soverin account; the owner saved both
 * for her with no password (§8.2), and a second migration reads her old mail
 * server, whose password is the owner's own. `GET
 * /api/people/:id/awaiting-grant` says, per migration, which accounts it
 * waits for, so the person's page can say the four lines:
 *
 *  - it waits for Anna to connect, and starts by itself or is reviewed, as
 *    before;
 *  - it waits for Anna to connect the destination, her Soverin account;
 *  - Anna typed a wrong password N times on her live link, with tries left;
 *  - her card is locked on this link after five, and a new link starts at zero.
 *
 * Never a password, and never the server's words for a refusal: the count
 * only. The owner's own old mail server waits for nobody. PGlite as
 * `app_user`, both chains. UUID family 01740016-…, unused elsewhere.
 */

process.env.SECRET_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, expiryFromDays } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

const U = (n: string) => `01740016-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const ICLOUD = U('11');
const OLD_MAIL = U('12');
const SOVERIN = U('13');
const ICLOUD_TO_SOVERIN = U('31');
const OLD_MAIL_TO_SOVERIN = U('32');
const ANNA = U('41');

/** The owner's own password on the old mail server: never said. */
const OWNERS_PASSWORD = 'SENTINEL-owners-own-password';

let driver: LedgerDriver;

vi.hoisted(() => {
  // The API refuses to make its producer without a jobs URL (__testing__/a-queue-stand-in.ts).
  process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
});
vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) =>
  (await import('../__testing__/a-queue-stand-in.ts')).aQueueStandIn(await importOriginal(), () => 'never'),
);
vi.mock('../middleware/auth.ts', async (importOriginal) => {
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
const { accountRef } = await import('./migrations/person-grant-subject.ts');

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

const box = (c: string) => c.replace(/00(\d\d)$/, '02$1');

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Acme Legal']);
  await q('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)', [
    TENANT,
    'pat',
    'owner@example.invalid',
  ]);
  const owners = JSON.stringify(
    SecretStore.encryptCredentials({ username: 'anna@old.invalid', password: OWNERS_PASSWORD }).encrypted,
  );
  for (const [id, role, kind, config, secret] of [
    // Saved for Anna by her address alone (0174 §8.2).
    [ICLOUD, 'source', 'apple', { user: 'anna@icloud.invalid' }, null],
    // The owner's own, with the owner's password.
    [OLD_MAIL, 'source', 'imap', { host: 'imap.old.invalid', port: 993 }, owners],
    // Anna's Soverin account, saved for her with its servers and no password.
    [
      SOVERIN,
      'target',
      'soverin',
      { host: 'dav.soverin.invalid', port: 443, mailHost: 'imap.soverin.invalid', user: 'anna@soverin.invalid' },
      null,
    ],
  ] as const) {
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,$3,$4,'c',$5::jsonb,'error',$6)`,
      [id, TENANT, role, kind, JSON.stringify(config), secret],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box(id), TENANT, id],
    );
  }
  for (const [m, from, to] of [
    [ICLOUD_TO_SOVERIN, ICLOUD, SOVERIN],
    [OLD_MAIL_TO_SOVERIN, OLD_MAIL, SOVERIN],
  ] as const) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'paused')`,
      [m, TENANT, box(from), box(to)],
    );
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'email',true)`, [
      TENANT,
      m,
    ]);
  }
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [ANNA, TENANT]);
  for (const m of [ICLOUD_TO_SOVERIN, OLD_MAIL_TO_SOVERIN]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, ANNA, TENANT]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

const awaiting = async () => {
  const res = await request(app).get(`/api/people/${ANNA}/awaiting-grant`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(JSON.stringify(res.body)).not.toContain(OWNERS_PASSWORD);
  return res.body.migrations as Array<{ mappingId: string; then: string; waitsFor: unknown[] }>;
};

const mint = () =>
  withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, {
      tenantId: TENANT,
      personId: ANNA,
      purpose: 'grant',
      createdBy: 'pat',
      expiresAt: expiryFromDays(7),
    }),
  );

const icloudRef = () => accountRef('source', 'apple', ICLOUD, 'anna@icloud.invalid');
const soverinRef = () => accountRef('target', 'soverin', SOVERIN, 'anna@soverin.invalid');

describe('the accounts each migration of Anna’s waits for (0174 §4.6)', () => {
  it('names her iCloud and her Soverin account, sources first; the owner’s own server waits for nobody', async () => {
    expect(await awaiting()).toEqual([
      {
        mappingId: ICLOUD_TO_SOVERIN,
        then: 'review_and_start',
        waitsFor: [
          { role: 'source', way: 'password', account: 'anna@icloud.invalid' },
          { role: 'target', way: 'password', account: 'anna@soverin.invalid' },
        ],
      },
      {
        mappingId: OLD_MAIL_TO_SOVERIN,
        then: 'review_and_start',
        waitsFor: [{ role: 'target', way: 'password', account: 'anna@soverin.invalid' }],
      },
    ]);
  });

  it('counts her refused tries on the link that still works, and says a card is locked after five', async () => {
    const link = await mint();
    await q(`INSERT INTO person_link_try (link_id, tenant_id, account_ref, refused) VALUES ($1,$2,$3,2)`, [
      link.id,
      TENANT,
      icloudRef(),
    ]);
    await q(
      `INSERT INTO person_link_try (link_id, tenant_id, account_ref, refused, locked_at) VALUES ($1,$2,$3,5,now())`,
      [link.id, TENANT, soverinRef()],
    );
    const locked = { role: 'target', way: 'password', account: 'anna@soverin.invalid', tries: { refused: 5, left: 0, locked: true } };
    const [first, second] = await awaiting();
    expect(first!.waitsFor).toEqual([
      { role: 'source', way: 'password', account: 'anna@icloud.invalid', tries: { refused: 2, left: 3, locked: false } },
      locked,
    ]);
    expect(second!.waitsFor).toEqual([locked]);

    // Revoked, the link counts nothing; a new one starts at zero, the owner's remedy.
    await q('UPDATE person_link SET revoked_at = now() WHERE id = $1', [link.id]);
    expect((await awaiting())[0]!.waitsFor).toEqual([
      { role: 'source', way: 'password', account: 'anna@icloud.invalid' },
      { role: 'target', way: 'password', account: 'anna@soverin.invalid' },
    ]);
    await mint();
    const fresh = { refused: 0, left: 5, locked: false };
    expect((await awaiting())[0]!.waitsFor).toEqual([
      { role: 'source', way: 'password', account: 'anna@icloud.invalid', tries: fresh },
      { role: 'target', way: 'password', account: 'anna@soverin.invalid', tries: fresh },
    ]);
  });
});
