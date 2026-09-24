// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT TAKEN BACK, from the progress page (workplan 0108 T8 (c); the owner,
 * 2026-09-23: *"C: yes, after B. Also: if we cannot revoke at the sources, we
 * do revoke/remove in our system and tell the person that revokes."*).
 *
 * Against a real database, PGlite as `app_user`, with nothing stubbed but
 * Google's revocation endpoint: the link in the path is the whole credential,
 * and what the withdrawal deletes, keeps and records is only visible in the
 * rows.
 *
 *  - the page offers to withdraw a grant given through a link, and nothing
 *    else;
 *  - withdrawing sends Google the token the grant stored, deletes it here,
 *    stops the account being read, records it, and leaves the organisation's
 *    own credential alone;
 *  - Google refusing, or not answering, still deletes it here, and says so;
 *  - a token Google says is already dead counts as withdrawn there;
 *  - with nothing to take back, nobody calls Google;
 *  - a grant link, and a revoked progress link, take nothing back;
 *  - a new grant landing mid-withdrawal is neither deleted nor lost;
 *  - and a new grant ends the withdrawal.
 *
 * The names and addresses are invented.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  issueMappingLink,
  revokeMappingLink,
  expiryFromDays,
} from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 6a6b0000-…, unused elsewhere in the repo.
const TENANT = '6a6b0000-e29b-41d4-a716-446655443001';
const CONN = '6a6b0000-e29b-41d4-a716-446655443011';
const BOX = '6a6b0000-e29b-41d4-a716-446655443021';
/** One mapping per case, each granted through a link, so no case leans on another's leftovers. */
const GRANTED = '6a6b0000-e29b-41d4-a716-446655443031';
const REFUSED = '6a6b0000-e29b-41d4-a716-446655443032';
const UNREACHABLE = '6a6b0000-e29b-41d4-a716-446655443033';
const ALREADY_DEAD = '6a6b0000-e29b-41d4-a716-446655443034';
const REGRANTED_MIDWAY = '6a6b0000-e29b-41d4-a716-446655443035';
const GRANTED_AGAIN = '6a6b0000-e29b-41d4-a716-446655443036';
const TWICE = '6a6b0000-e29b-41d4-a716-446655443038';
const TWO_TABS = '6a6b0000-e29b-41d4-a716-446655443039';
/** Reads the account on the organisation's own credential: no grant here to take back. */
const OWN = '6a6b0000-e29b-41d4-a716-446655443037';

const ACCOUNT = 'pat@example.invalid';
/** What the connection holds: the organisation's own, which a withdrawal never touches. */
const ORGANISATIONS_OWN = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'the-organisations-own' };
const tokenOf = (mappingId: string) => `granted-${mappingId.slice(-4)}`;
const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  // Only the pool: `authenticateMappingLink` is the product's, against the real table.
  return { ...actual, getDbPool: () => driver };
});

const { default: viewRoutes } = await import('./view.ts');
const { storeGrantedToken } = await import('./migrations/grant-ending.ts');

const app = express();
app.use(express.json());
app.use('/api/view', viewRoutes);

/** Google's revocation endpoint, answered per case; every call is kept. */
type Answer = { status: number; body?: string } | 'unreachable';
let answer: Answer = { status: 200 };
let beforeGoogleAnswers: (() => Promise<void>) | undefined;
const googleCalls: { url: string; body: string }[] = [];

vi.stubGlobal('fetch', async (url: string | URL, init?: { body?: unknown }) => {
  googleCalls.push({ url: String(url), body: String(init?.body ?? '') });
  await beforeGoogleAnswers?.();
  if (answer === 'unreachable') throw new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com');
  const { status, body = '' } = answer;
  return new Response(body, { status });
});

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

const linkFor = async (mappingId: string, purpose: 'grant' | 'view') =>
  (
    await withTenant(driver, TENANT, (db) =>
      issueMappingLink(db, {
        tenantId: TENANT,
        mappingId,
        purpose,
        createdBy: 'granted-by-link',
        expiresAt: expiryFromDays(90),
      }),
    )
  );

const mappingRow = async (id: string) =>
  (
    await query<{ source_secret_ref: string | null; grant_withdrawn_at: Date | null }>(
      'SELECT source_secret_ref, grant_withdrawn_at FROM mailbox_mapping WHERE id = $1',
      [id],
    )
  )[0]!;

const withdrawals = (mappingId: string) =>
  query<{ actor: string; entity: string; detail: Record<string, unknown> }>(
    `SELECT actor, entity, detail FROM audit_log
      WHERE action = 'mapping.grant_withdrawn' AND detail->>'mappingId' = $1`,
    [mappingId],
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  await query('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'Example Care BV']);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1,$2,'source','google','Example Care Google','{}'::jsonb,'connected',$3)`,
    [CONN, TENANT, sealed(ORGANISATIONS_OWN)],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user',$4)`,
    [BOX, TENANT, CONN, ACCOUNT],
  );
  for (const id of [GRANTED, REFUSED, UNREACHABLE, ALREADY_DEAD, REGRANTED_MIDWAY, GRANTED_AGAIN, TWICE, TWO_TABS, OWN]) {
    await query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name, source_config_override, source_secret_ref)
       VALUES ($1,$2,$3,'active','Pat',$4::jsonb,$5)`,
      [id, TENANT, BOX, JSON.stringify({ user: ACCOUNT }), id === OWN ? null : sealed({ refreshToken: tokenOf(id) })],
    );
  }
}, 120_000);

beforeEach(() => {
  answer = { status: 200 };
  beforeGoogleAnswers = undefined;
  googleCalls.length = 0;
});

describe('the progress page offers to take a grant back', () => {
  it('when the migration reads the account on a grant given through a link, and not otherwise', async () => {
    const granted = await linkFor(GRANTED, 'view');
    const own = await linkFor(OWN, 'view');

    expect((await request(app).get(`/api/view/${granted.token}`)).body.grant).toEqual({ state: 'granted' });
    expect((await request(app).get(`/api/view/${own.token}`)).body.grant).toEqual({ state: 'none' });
  });
});

describe('withdrawing', () => {
  it('sends Google the token the grant stored, deletes it here, stops the reading, and records it', async () => {
    const view = await linkFor(GRANTED, 'view');

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(200);
    expect(res.body.atGoogle).toBe('revoked');
    expect(googleCalls).toEqual([
      { url: 'https://oauth2.googleapis.com/revoke', body: `token=${tokenOf(GRANTED)}` },
    ]);
    const row = await mappingRow(GRANTED);
    expect(row.source_secret_ref).toBeNull();
    expect(row.grant_withdrawn_at).not.toBeNull();
    expect(res.body.withdrawnAt).toBe(row.grant_withdrawn_at!.toISOString());
    // The organisation's own credential is not the person's to take back.
    const [conn] = await query<{ secret_ref: string }>('SELECT secret_ref FROM connection WHERE id = $1', [CONN]);
    expect(SecretStore.decryptCredentials(conn!.secret_ref)).toEqual(ORGANISATIONS_OWN);
    // Recorded, with the link it came through and Google's answer, and no token.
    const recorded = await withdrawals(GRANTED);
    expect(recorded).toEqual([
      {
        actor: 'progress-link',
        entity: 'mapping',
        detail: { mappingId: GRANTED, linkId: view.id, atGoogle: 'revoked' },
      },
    ]);
    // The page now says when, and offers nothing more.
    const after = await request(app).get(`/api/view/${view.token}`);
    expect(after.body.grant).toEqual({ state: 'withdrawn', withdrawnAt: res.body.withdrawnAt });
  });

  it('deletes it here when Google refuses, and says Google did not confirm', async () => {
    answer = { status: 503, body: 'backend error' };
    const view = await linkFor(REFUSED, 'view');

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(200);
    expect(res.body.atGoogle).toBe('not_confirmed');
    expect((await mappingRow(REFUSED)).source_secret_ref).toBeNull();
    expect((await withdrawals(REFUSED))[0]?.detail.atGoogle).toBe('not_confirmed');
  });

  it('deletes it here when Google cannot be reached, and says so', async () => {
    answer = 'unreachable';
    const view = await linkFor(UNREACHABLE, 'view');

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.body.atGoogle).toBe('not_confirmed');
    expect((await mappingRow(UNREACHABLE)).grant_withdrawn_at).not.toBeNull();
  });

  it('counts a token Google says is already dead as withdrawn there', async () => {
    answer = { status: 400, body: '{"error":"invalid_token"}' };
    const view = await linkFor(ALREADY_DEAD, 'view');

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.body.atGoogle).toBe('revoked');
  });

  it('a second time, says when it was withdrawn and calls nobody', async () => {
    const view = await linkFor(TWICE, 'view');
    expect((await request(app).post(`/api/view/${view.token}/withdraw`)).status).toBe(200);
    const { grant_withdrawn_at: first } = await mappingRow(TWICE);
    googleCalls.length = 0;

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_granted');
    expect(res.body.reason).toContain(first!.toISOString().slice(0, 10));
    expect(googleCalls).toEqual([]);
    expect((await mappingRow(TWICE)).grant_withdrawn_at).toEqual(first);
    expect(await withdrawals(TWICE)).toHaveLength(1);
  });
});

describe('what takes nothing back', () => {
  it('a migration that reads the account on the organisation’s own credential: nobody calls Google', async () => {
    const view = await linkFor(OWN, 'view');

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_granted');
    expect(googleCalls).toEqual([]);
    expect((await mappingRow(OWN)).grant_withdrawn_at).toBeNull();
  });

  it('a grant link, which opens only the grant page', async () => {
    const grantLink = await linkFor(GRANTED_AGAIN, 'grant');

    const res = await request(app).post(`/api/view/${grantLink.token}/withdraw`);

    expect(res.status).toBe(401);
    expect((await mappingRow(GRANTED_AGAIN)).source_secret_ref).not.toBeNull();
  });

  it('a progress link the owner revoked', async () => {
    const view = await linkFor(GRANTED_AGAIN, 'view');
    await withTenant(driver, TENANT, (db) => revokeMappingLink(db, { tenantId: TENANT, linkId: view.id }));

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(401);
    expect(googleCalls).toEqual([]);
    expect((await mappingRow(GRANTED_AGAIN)).source_secret_ref).not.toBeNull();
  });
});

describe('a new grant', () => {
  it('landing while the old one is withdrawn is neither deleted nor lost: the person is told to press again', async () => {
    const view = await linkFor(REGRANTED_MIDWAY, 'view');
    const renewed = sealed({ refreshToken: 'granted-again-midway' });
    beforeGoogleAnswers = async () => {
      await query('UPDATE mailbox_mapping SET source_secret_ref = $2 WHERE id = $1', [REGRANTED_MIDWAY, renewed]);
    };

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('changed');
    const row = await mappingRow(REGRANTED_MIDWAY);
    expect(row.source_secret_ref).toBe(renewed);
    expect(row.grant_withdrawn_at).toBeNull();
    expect(await withdrawals(REGRANTED_MIDWAY)).toEqual([]);
  });

  it('withdrawn by another press meanwhile (a second tab) is answered as withdrawn, not as a new grant', async () => {
    const view = await linkFor(TWO_TABS, 'view');
    beforeGoogleAnswers = async () => {
      await query(
        'UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = now() WHERE id = $1',
        [TWO_TABS],
      );
    };

    const res = await request(app).post(`/api/view/${view.token}/withdraw`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_granted');
    expect(res.body.reason).toMatch(/^You already withdrew your permission, on \d{4}-\d{2}-\d{2}\./);
  });

  it('ends the withdrawal: the account may be read again, and the page offers to withdraw again', async () => {
    const view = await linkFor(GRANTED_AGAIN, 'view');
    expect((await request(app).post(`/api/view/${view.token}/withdraw`)).status).toBe(200);
    const grantLink = await linkFor(GRANTED_AGAIN, 'grant');

    const stored = await storeGrantedToken(
      driver,
      { linkId: grantLink.id, mappingId: GRANTED_AGAIN, tenantId: TENANT },
      { refreshToken: 'granted-once-more', signedInAs: ACCOUNT },
    );

    expect(stored).toEqual({ ok: true });
    const row = await mappingRow(GRANTED_AGAIN);
    expect(row.grant_withdrawn_at).toBeNull();
    expect(SecretStore.decryptCredentials(row.source_secret_ref!)).toEqual({ refreshToken: 'granted-once-more' });
    expect((await request(app).get(`/api/view/${view.token}`)).body.grant).toEqual({ state: 'granted' });
  });
});
