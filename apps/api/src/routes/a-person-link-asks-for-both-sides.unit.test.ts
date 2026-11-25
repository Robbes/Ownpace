// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S LINK ASKS FOR BOTH SIDES (workplan 0174 §4.1, §4.5, §5.2, T1).
 *
 * The owner, 2026-11-25: *"I want all sources/targets that supports granting
 * to be able to use the others-grant-page."* Anna moves off iCloud and an old
 * mail server into her own Soverin account. The owner saved the iCloud
 * account and the Soverin account for her, with no password; the old mail
 * server and a JMAP destination are the owner's own, with theirs.
 *
 * `GET /api/grant/:link` answers, per account:
 *  - one card per account and role, sources first: iCloud as a source, Soverin
 *    as a destination shared by two migrations, each `way: 'password'`, each
 *    with its `ref`, the server it would be tried against, what the owner
 *    fixed and what Anna fills, and the tries this link has left;
 *  - no card for the owner's own source or destination: not Anna's to grant;
 *  - a destination Anna connected herself (`person_granted_connection`)
 *    stays on her page, connected;
 *  - never a stored secret, the owner's or anybody's;
 *  - a password card is no sign-in: Google's door refuses it.
 *
 * PGlite as `app_user`, both chains.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, expiryFromDays } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { issuePersonLink, runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 01740001-…, unused elsewhere in the repo.
const U = (n: string) => `01740001-e29b-41d4-a716-4466554400${n}`;
const TENANT = U('01');
const ICLOUD = U('11');
const OLD_MAIL = U('12');
const SOVERIN = U('13');
const OWNERS_JMAP = U('14');
const ICLOUD_TO_SOVERIN = U('31');
const OLD_MAIL_TO_SOVERIN = U('32');
const ICLOUD_TO_JMAP = U('33');
const ANNA = U('41');

/** Secrets that must never reach the page. */
const OWNERS_SOURCE_PASSWORD = 'SENTINEL-owner-source-password';
const OWNERS_TARGET_PASSWORD = 'SENTINEL-owner-target-password';
const ANNAS_PASSWORD = 'SENTINEL-annas-own-password';

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: grantRoutes } = await import('./grant.ts');
const { accountRef } = await import('./migrations/person-grant-subject.ts');

const app = express();
app.use(express.json());
app.use('/api/grant', grantRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const encrypted = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

beforeAll(async () => {
  process.env.WEB_URL = 'https://app.example';
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Acme Legal']);
  await q('INSERT INTO tenant_member (tenant_id, user_id, email) VALUES ($1,$2,$3)', [TENANT, 'pat', 'owner@example.org']);
  for (const [id, role, kind, config, secret] of [
    // Saved for Anna by her address alone (0174 §8.2).
    [ICLOUD, 'source', 'apple', { user: 'anna@icloud.com' }, null],
    // The owner's own, with the owner's password.
    [OLD_MAIL, 'source', 'imap', { host: 'imap.old.example', port: 993 }, encrypted({ username: 'anna@old.example', password: OWNERS_SOURCE_PASSWORD })],
    // Anna's Soverin account, saved for her with its servers and no password.
    [SOVERIN, 'target', 'soverin', { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', user: 'anna@soverin.net' }, null],
    [OWNERS_JMAP, 'target', 'jmap', { host: 'jmap.example.org', port: 443 }, encrypted({ username: 'archive@example.org', password: OWNERS_TARGET_PASSWORD })],
  ] as const) {
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,$3,$4,'c',$5::jsonb,'connected',$6)`,
      [id, TENANT, role, kind, JSON.stringify(config), secret],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [id.replace(/00(\d\d)$/, '02$1'), TENANT, id],
    );
  }
  const box = (c: string) => c.replace(/00(\d\d)$/, '02$1');
  for (const [m, from, to, domains] of [
    [ICLOUD_TO_SOVERIN, ICLOUD, SOVERIN, ['email', 'calendar']],
    [OLD_MAIL_TO_SOVERIN, OLD_MAIL, SOVERIN, ['email']],
    [ICLOUD_TO_JMAP, ICLOUD, OWNERS_JMAP, ['contact']],
  ] as const) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status) VALUES ($1,$2,$3,$4,'paused')`,
      [m, TENANT, box(from), box(to)],
    );
    for (const d of domains) {
      await q('INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)', [TENANT, m, d]);
    }
  }
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna')`, [ANNA, TENANT]);
  for (const m of [ICLOUD_TO_SOVERIN, OLD_MAIL_TO_SOVERIN, ICLOUD_TO_JMAP]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, ANNA, TENANT]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

const mint = () =>
  withTenant(driver, TENANT, (db) =>
    issuePersonLink(db, { tenantId: TENANT, personId: ANNA, purpose: 'grant', createdBy: 'pat', expiresAt: expiryFromDays(7) }),
  );

interface Card {
  ref: string;
  role: string;
  way: string;
  provider: string;
  account: string;
  granted: boolean;
  server?: { hosts: string[]; published: boolean } | null;
  fields?: Array<{ key: string; who: string; value?: string; secret: boolean }>;
  tries?: { left: number; locked: boolean } | null;
  domains: string[];
  scope: string | null;
  notReady: unknown;
  migrations: Array<{ domains: string[]; to: { provider: string; account: string | null }; from: { provider: string; account: string | null }; granted: boolean }>;
}

describe('a person’s link with a password source and a password destination', () => {
  it('answers one card per account and role, sources first, each with its ref, server, fields and tries', async () => {
    const { token } = await mint();
    const res = await request(app).get(`/api/grant/${token}`);
    expect(res.status).toBe(200);
    const cards = res.body.accounts as Card[];

    expect(cards.map((c) => [c.role, c.way, c.provider, c.account, c.granted])).toEqual([
      ['source', 'password', 'apple', 'anna@icloud.com', false],
      ['target', 'password', 'soverin', 'anna@soverin.net', false],
    ]);
    const [icloud, soverin] = cards as [Card, Card];

    // A ref each, a hash: stable, distinct, never the address.
    expect(icloud.ref).toBe(accountRef('source', 'apple', ICLOUD, 'anna@icloud.com'));
    expect(soverin.ref).toBe(accountRef('target', 'soverin', SOVERIN, 'anna@soverin.net'));
    expect(icloud.ref).not.toBe(soverin.ref);
    expect(icloud.ref).not.toContain('anna');

    // Where the password is tried: Apple's own servers; Soverin's as the owner set them.
    expect(icloud.server).toEqual({ hosts: ['imap.mail.me.com', 'caldav.icloud.com', 'contacts.icloud.com'], published: true });
    expect(soverin.server).toEqual({ hosts: ['caldav.soverin.net', 'imap.soverin.net'], published: false });

    // What the owner fixed, shown; what Anna fills, a box.
    expect(icloud.fields!.map((f) => [f.key, f.who, f.value])).toEqual([
      ['username', 'owner', 'anna@icloud.com'],
      ['password', 'person', undefined],
    ]);
    expect(soverin.fields!.filter((f) => f.who === 'person').map((f) => f.key)).toEqual(['password']);
    expect(soverin.fields!.find((f) => f.key === 'mailHost')).toMatchObject({ who: 'owner', value: 'imap.soverin.net' });

    // Five tries on a new link.
    expect(icloud.tries).toEqual({ left: 5, locked: false });

    // The source names where each migration goes; the destination where each comes from.
    expect(icloud.migrations.map((m) => m.to.provider)).toEqual(['soverin', 'jmap']);
    expect(soverin.migrations.map((m) => [m.from.provider, m.from.account])).toEqual([
      ['apple', 'anna@icloud.com'],
      ['imap', 'anna@old.example'],
    ]);
    expect(soverin.domains).toEqual(['email', 'calendar']);
    expect(icloud.scope).toBeNull();
    expect(icloud.notReady).toBeNull();

    // Never a secret: not the owner's, on either side.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(OWNERS_SOURCE_PASSWORD);
    expect(body).not.toContain(OWNERS_TARGET_PASSWORD);
  });

  it('says the tries left on this link, and locked after five', async () => {
    const { token, id } = await mint();
    const ref = accountRef('source', 'apple', ICLOUD, 'anna@icloud.com');
    await q('INSERT INTO person_link_try (link_id, tenant_id, account_ref, refused) VALUES ($1,$2,$3,2)', [id, TENANT, ref]);
    let cards = (await request(app).get(`/api/grant/${token}`)).body.accounts as Card[];
    expect(cards.find((c) => c.ref === ref)!.tries).toEqual({ left: 3, locked: false });

    await q('UPDATE person_link_try SET refused = 5, locked_at = now() WHERE link_id = $1', [id]);
    cards = (await request(app).get(`/api/grant/${token}`)).body.accounts as Card[];
    expect(cards.find((c) => c.ref === ref)!.tries).toEqual({ left: 0, locked: true });

    // Another link starts at zero: the owner's remedy.
    const fresh = await mint();
    cards = (await request(app).get(`/api/grant/${fresh.token}`)).body.accounts as Card[];
    expect(cards.find((c) => c.ref === ref)!.tries).toEqual({ left: 5, locked: false });
  });

  it('keeps a destination Anna connected herself on her page, connected, and never says its password', async () => {
    await q('UPDATE connection SET secret_ref = $2 WHERE id = $1', [SOVERIN, encrypted({ username: 'anna@soverin.net', password: ANNAS_PASSWORD })]);
    await q('INSERT INTO person_granted_connection (connection_id, tenant_id, person_id) VALUES ($1,$2,$3)', [SOVERIN, TENANT, ANNA]);
    try {
      const { token } = await mint();
      const res = await request(app).get(`/api/grant/${token}`);
      const soverin = (res.body.accounts as Card[]).find((c) => c.role === 'target')!;
      expect([soverin.provider, soverin.granted]).toEqual(['soverin', true]);
      expect(soverin.migrations.every((m) => m.granted)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(ANNAS_PASSWORD);

      // The owner's own password on the same kind, with no such row: no card.
      await q('DELETE FROM person_granted_connection WHERE connection_id = $1', [SOVERIN]);
      const again = await request(app).get(`/api/grant/${token}`);
      expect((again.body.accounts as Card[]).map((c) => c.role)).toEqual(['source']);
    } finally {
      await q('DELETE FROM person_granted_connection WHERE connection_id = $1', [SOVERIN]);
      await q('UPDATE connection SET secret_ref = NULL WHERE id = $1', [SOVERIN]);
    }
  });

  it('opens no sign-in for a password card', async () => {
    const { token } = await mint();
    const res = await request(app).post(`/api/grant/${token}/google/authorize`).send({ account: 'anna@icloud.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_this_account');
  });
});
