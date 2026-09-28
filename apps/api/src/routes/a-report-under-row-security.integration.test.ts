// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PERMISSION REPORT READS ONE ORGANISATION, AND THE DATABASE HOLDS IT TO
 * THAT (workplan 0138 T6), through the real Express app on Postgres, as
 * `app_user`.
 *
 * Until 2026-09-28 `routes/permissions.ts` read on a pool of its own, opened on
 * `DATABASE_URL`: the database owner on managed, a superuser, whom row security
 * never binds. Each of its queries filtered by `tenant_id = $1`, so what it
 * asked of `connection` was the caller's. But `resolveMappingMailbox` joined
 * `mailbox` by `source_mailbox_id` alone, and on the owner's connection a
 * mapping that names another organisation's mailbox reads that organisation's
 * address, into the report's heading and, through the sharing rescan, into
 * scans run for that address. No API door writes such a mapping; this file
 * seeds one as the owner, to stand for any id a join follows past its own
 * filter. That is the second net 0138 §1 says the owner's connection does not
 * have.
 *
 * Two organisations. A has a Google source, a CalDAV target, a migration of
 * its own mailbox, and one migration whose source mailbox is B's. B has a
 * Microsoft account as its source and a CalDAV target. Asked as A:
 *
 *   - A's own migration resolves to A's address;
 *   - the migration that names B's mailbox resolves to nothing, in the report
 *     and in the rescan, and B's address is in neither answer;
 *   - every section is written for A's own connections: Google's sentences, no
 *     Microsoft or Exchange sentence, and the target's section for A's target,
 *     never B's.
 *
 * Each of the report's three lookups is held to it, and a lookup asked in the
 * wrong organisation reads nothing here, so each one needs a row of A's to
 * lose: the mapping (A's own migration), the sources (A's Google source), and
 * the target (A's CalDAV target). A's target names `localhost` on port 1, where
 * nothing listens: its measurement fails at once without leaving the machine,
 * and a failed measurement is still written as the section (0105 T0).
 *
 * Handed its database (`an-integration-test-is-handed-its-database`): the app
 * reads `APP_DATABASE_URL`, derived from `TEST_DATABASE_URL`, and nothing here
 * names the owner's variable.
 *
 * UUID family: 0138f600-e29b-41d4-a716-4466554400xx.
 * Runs against Postgres (pnpm test:integration, or scripts/local-pg.sh).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { MICROSOFT_ACCOUNT_IS_DELEGATED } from '@openmig/connectors';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}
const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG_CONNECTION_STRING);

// Nothing here may reach a provider: with no client and no Graph settings, each
// section says why it could not be read, and says it without a network call.
const ENV = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'OAUTH2_CLIENT_ID',
  'OAUTH2_CLIENT_SECRET',
  'OAUTH2_REFRESH_TOKEN',
  'GRAPH_FILES_READ_CONSENTED',
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
for (const k of ENV) delete process.env[k];

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

const TENANT_A = '0138f600-e29b-41d4-a716-446655440001';
const TENANT_B = '0138f600-e29b-41d4-a716-446655440002';
const A_SOURCE = '0138f600-e29b-41d4-a716-446655440011';
const A_MAILBOX = '0138f600-e29b-41d4-a716-446655440012';
const A_MAPPING = '0138f600-e29b-41d4-a716-446655440013';
const A_MAPPING_OF_B = '0138f600-e29b-41d4-a716-446655440014';
const A_TARGET = '0138f600-e29b-41d4-a716-446655440015';
const B_SOURCE = '0138f600-e29b-41d4-a716-446655440021';
const B_TARGET = '0138f600-e29b-41d4-a716-446655440022';
const B_MAILBOX = '0138f600-e29b-41d4-a716-446655440023';
const A_ADDRESS = 'someone@a.example.test';
const B_ADDRESS = 'someone@b.example.test';

const USER_A = `user-${TENANT_A}`;
const tokenA = () =>
  jwt.sign({ sub: USER_A, tenantId: TENANT_A, email: `${USER_A}@example.test` }, process.env.JWT_SECRET!);

describe('the permission report reads one organisation, under row security', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  const report = (query: string) =>
    request.get(`/api/permissions/report?${query}`).set({ Authorization: `Bearer ${tokenA()}` });

  /** This file's rows, table by table. */
  async function cleanUp(): Promise<void> {
    for (const table of ['share_grant', 'mailbox_mapping', 'mailbox', 'connection', 'tenant_member']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
    }
    await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
  }

  beforeAll(async () => {
    // The owner, for the fixture only: it writes a row no API door would.
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await cleanUp();
    await pool.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, 'Report A', 'active'), ($2, 'Report B', 'active')`,
      [TENANT_A, TENANT_B],
    );
    await seedMembership(pool, TENANT_A, USER_A);
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $2, 'source', 'google', 'A Google', $3::jsonb, 'connected'),
         ($4, $5, 'source', 'microsoft', 'B Microsoft', $6::jsonb, 'connected'),
         ($7, $5, 'target', 'caldav', 'B CalDAV', $8::jsonb, 'connected'),
         ($9, $2, 'target', 'caldav', 'A CalDAV', $10::jsonb, 'connected')`,
      [
        A_SOURCE,
        TENANT_A,
        JSON.stringify({ credentials: { refreshToken: 'rt-not-a-real-token' } }),
        B_SOURCE,
        TENANT_B,
        JSON.stringify({ type: 'microsoft', user: B_ADDRESS }),
        B_TARGET,
        JSON.stringify({ url: 'https://dav.b.example.test/', credentials: { username: 'b', password: 'b' } }),
        A_TARGET,
        JSON.stringify({ url: 'http://localhost:1/', credentials: { username: 'a', password: 'a' } }),
      ],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address) VALUES
         ($1, $2, $3, 'a', $4), ($5, $6, $7, 'b', $8)`,
      [A_MAILBOX, TENANT_A, A_SOURCE, A_ADDRESS, B_MAILBOX, TENANT_B, B_SOURCE, B_ADDRESS],
    );
    // A's own migration, and one of A's whose source mailbox is B's.
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES
         ($1, $2, $3, 'active'), ($4, $2, $5, 'active')`,
      [A_MAPPING, TENANT_A, A_MAILBOX, A_MAPPING_OF_B, B_MAILBOX],
    );
    request = supertest(app);
  }, 60_000);

  afterAll(async () => {
    await cleanUp();
    await pool.end();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('resolves its own migration to its own mailbox', async () => {
    const res = await report(`mappingId=${A_MAPPING}`);
    expect(res.status, res.text).toBe(200);
    expect(res.text).toContain(`**Migration:** ${A_ADDRESS}`);
  });

  it("resolves a migration that names another organisation's mailbox to nothing", async () => {
    const res = await report(`mappingId=${A_MAPPING_OF_B}`);
    expect(
      res.text,
      "the report read B's mailbox through A's migration: the join followed the id past A's " +
        'own filter, and nothing in the database stopped it',
    ).not.toContain(B_ADDRESS);
    expect(res.status, res.text).toBe(409);
    expect(res.body.message).toContain('does not record which mailbox it reads');
  });

  it('and so does the sharing rescan, which asks the same question', async () => {
    const res = await request
      .post(`/api/migrations/${A_MAPPING_OF_B}/sharing/rescan`)
      .set({ Authorization: `Bearer ${tokenA()}` })
      .send({});
    expect(res.text).not.toContain(B_ADDRESS);
    expect(res.status, res.text).toBe(409);
    const grants = await pool.query(`SELECT count(*)::int AS n FROM share_grant WHERE mapping_id = $1`, [
      A_MAPPING_OF_B,
    ]);
    expect(grants.rows[0].n, 'the rescan scanned for B’s mailbox and kept what it found').toBe(0);
  });

  it("writes every section for the caller's own connections, and none for the other's", async () => {
    const res = await report(`mailbox=${encodeURIComponent(A_ADDRESS)}`);
    expect(res.status, res.text).toBe(200);
    // A's: a Google source, so Google's sentences.
    expect(res.text).toContain('Google Calendar sharing is not yet read by this tool');
    expect(res.text).toContain('Gmail delegation and send-as are not read by this tool');
    // B's Microsoft account would have put Microsoft's and Exchange's here.
    expect(res.text).not.toContain(MICROSOFT_ACCOUNT_IS_DELEGATED);
    expect(res.text).not.toContain('Get-MailboxPermission');
    // A's CalDAV target, measured where nothing answers: the section is there.
    // A target lookup asked in another organisation finds no row of A's, and
    // the report leaves the section out without a word.
    expect(
      res.text,
      "the report did not find A's own target: its lookup read another organisation's rows, or none",
    ).toContain('What the target will do with what we write');
    // And it is A's target that was measured, never B's.
    expect(res.text).not.toContain('dav.b.example.test');
  });
});
