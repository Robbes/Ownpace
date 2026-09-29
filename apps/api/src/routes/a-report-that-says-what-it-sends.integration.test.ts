// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REPORT'S FACTS ARE THE REPORTER'S ORGANISATION'S, AND THE DATABASE HOLDS
 * THEM TO IT (workplan 0130 T6, Part A), through the real Express app on
 * Postgres, as `app_user`.
 *
 * The preview of a problem report reads the migration the page names. That id
 * comes from the browser, and anybody can put another organisation's id in the
 * address bar. So the facts are read through `withTenantDb` on the API's own
 * pool (`APP_DATABASE_URL`), where row security answers for another
 * organisation's migration exactly as for one that does not exist: nothing.
 * `a-report-that-says-what-it-sends.unit.test.ts` asks the same of PGlite with
 * a reader a test hands the route; this file asks the API as it is wired, with
 * no test seam in between.
 *
 * Two organisations. A has a migration with a failing mail data type; B has a
 * migration whose files fail, under a provider's words and an item name that
 * must never be read. Asked as A:
 *
 *   - A's own migration gives its facts, and A's failure's reference matches;
 *   - B's migration id gives none of B's facts, and B's reference is not a
 *     current failure;
 *   - neither a provider's words nor a name or address planted in the rows
 *     reaches the answer.
 *
 * Handed its database (`an-integration-test-is-handed-its-database`): the app
 * reads `APP_DATABASE_URL`, derived from `TEST_DATABASE_URL`.
 *
 * UUID family: 0130fac8-e29b-41d4-a716-4466554400xx.
 * Runs against Postgres (pnpm test:integration, or scripts/local-pg.sh).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

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

// A service that takes reports by mail, so the preview answers. Nothing is
// sent: the preview sends nothing, and no report is posted here.
const MAIL_ENV = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '587',
  NOTIFY_FROM: 'ownpace@example.invalid',
  REPORT_MAIL_TO: 'support@example.invalid',
  ZAMMAD_URL: '',
  ZAMMAD_TOKEN: '',
} as const;
const saved = Object.fromEntries(Object.keys(MAIL_ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, MAIL_ENV);

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

const TENANT_A = '0130fac8-e29b-41d4-a716-446655440001';
const TENANT_B = '0130fac8-e29b-41d4-a716-446655440002';
const A_CONN = '0130fac8-e29b-41d4-a716-446655440011';
const A_BOX = '0130fac8-e29b-41d4-a716-446655440012';
const A_MAPPING = '0130fac8-e29b-41d4-a716-446655440013';
const B_CONN = '0130fac8-e29b-41d4-a716-446655440021';
const B_BOX = '0130fac8-e29b-41d4-a716-446655440022';
const B_MAPPING = '0130fac8-e29b-41d4-a716-446655440023';
const A_FAILURE = 'a1a1a1a1';
const B_FAILURE = 'b2b2b2b2';
const CANARY_ERROR = '550 5.7.1 rejected: /Documents/canary-payslips-2026.pdf';
const CANARY_ITEM = 'Canary subject: a letter from the bank';
const CANARY_ADDRESS = 'canary.b@example.invalid';

const USER_A = `user-${TENANT_A}`;
const tokenA = () =>
  jwt.sign({ sub: USER_A, tenantId: TENANT_A, email: `${USER_A}@example.test` }, process.env.JWT_SECRET!);

describe("a report's facts are the reporter's organisation's, under row security", () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  const preview = (query: Record<string, string>) =>
    request.get('/api/problem-reports/preview').query(query).set({ Authorization: `Bearer ${tokenA()}` });

  async function cleanUp(): Promise<void> {
    for (const table of ['item', 'migration_status', 'mailbox_mapping', 'mailbox', 'connection', 'tenant_member']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
    }
    await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
  }

  beforeAll(async () => {
    // The owner, for the fixture only.
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await cleanUp();
    await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Facts A', 'active'), ($2, 'Facts B', 'active')`, [
      TENANT_A,
      TENANT_B,
    ]);
    await seedMembership(pool, TENANT_A, USER_A, 'admin');
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $2, 'source', 'gmail', 'A Gmail', '{}'::jsonb, 'connected'),
         ($3, $4, 'source', 'dropbox', 'B Dropbox', $5::jsonb, 'revoked')`,
      [A_CONN, TENANT_A, B_CONN, TENANT_B, JSON.stringify({ user: CANARY_ADDRESS })],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address) VALUES
         ($1, $2, $3, 'a', 'a@example.invalid'), ($4, $5, $6, 'b', $7)`,
      [A_BOX, TENANT_A, A_CONN, B_BOX, TENANT_B, B_CONN, CANARY_ADDRESS],
    );
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES
         ($1, $2, $3, 'active'), ($4, $5, $6, 'cutover')`,
      [A_MAPPING, TENANT_A, A_BOX, B_MAPPING, TENANT_B, B_BOX],
    );
    await pool.query(
      `INSERT INTO migration_status
         (tenant_id, mapping_id, domain, state, last_error, last_error_category, failed_side, last_error_reference) VALUES
         ($1, $2, 'email', 'failed', $3, 'auth_expired', 'source', $4),
         ($5, $6, 'file', 'failed', $3, 'quota_exceeded', 'target', $7)`,
      [TENANT_A, A_MAPPING, CANARY_ERROR, A_FAILURE, TENANT_B, B_MAPPING, B_FAILURE],
    );
    await pool.query(
      `INSERT INTO item
         (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, display_name, status, last_error)
       VALUES ($1, $2, 'file', 'Private', $3, 'hash-of-canary', $3, 'failed', $4)`,
      [TENANT_B, B_MAPPING, CANARY_ITEM, CANARY_ERROR],
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

  it("reads its own migration's facts, and ties its own failure's reference to it", async () => {
    const res = await preview({ page: `/mappings/${A_MAPPING}`, reference: A_FAILURE });
    expect(res.status, res.text).toBe(200);
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        'Role: admin',
        'Organisation status: active',
        `Migration: ${A_MAPPING}, active`,
        'Grant: not given',
        `Data type email: failed, auth_expired, source side, reference ${A_FAILURE}`,
        'Source account: gmail, connected',
        `Reference match: the current failure of email on migration ${A_MAPPING}`,
      ]),
    );
    expect(res.text).not.toContain(CANARY_ERROR);
  });

  it("gives none of another organisation's migration, and its failure is not a current failure here", async () => {
    const res = await preview({ page: `/mappings/${B_MAPPING}/failures`, reference: B_FAILURE });
    expect(res.status, res.text).toBe(200);
    expect(res.body.lines).toEqual(
      expect.arrayContaining([
        `Migration: ${B_MAPPING} is not one of this organisation's`,
        'Reference match: none, not a current failure',
      ]),
    );
    for (const theirs of ['cutover', 'dropbox', 'revoked', 'quota_exceeded', 'Data type file', CANARY_ERROR, CANARY_ITEM, CANARY_ADDRESS]) {
      expect(res.text, `B's ${theirs} reached A's report`).not.toContain(theirs);
    }
  });
});
