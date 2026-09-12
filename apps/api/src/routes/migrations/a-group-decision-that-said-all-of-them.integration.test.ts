// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GROUP DECISION THAT SAID "ALL OF THEM".
 *
 * `POST /api/migrations/:id/failures` is the press that puts a whole group of
 * parked items back in front of the loop. It exists because a connector bug
 * parks items by the dozen and its fix parks nothing: on 2026-09-11 a
 * non-recursive MKCOL left 82 files parked for a defect that no longer
 * existed, and the routes out were 82 presses or SQL.
 *
 * Three properties are pinned here rather than in a unit test, because all
 * three are about the route's effect on the DATABASE and a fake would answer
 * whatever it was handed:
 *
 *  1. **It refuses a press that narrows on nothing.** Not for safety — a retry
 *     writes nothing to anybody's account — but because the queue also holds
 *     policy refusals, which re-park the moment they are seen again. "Retry
 *     everything" costs a refetch per undecidable item and changes nothing
 *     about them.
 *  2. **A retry clears the cursors, and only when something matched.** Retry
 *     has always been two things (zero the attempts AND drop the cursors,
 *     ADR-0020); the SQL the owner ran by hand did the first. A press that
 *     matched nothing must NOT clear them: re-scanning whole accounts to put
 *     back zero items is a bill for nothing.
 *  3. **It cannot reach another tenant's queue.** The write goes through the
 *     same RLS-scoped handle every other operating route uses, and the way to
 *     find out it does not is to seed a second tenant with identical failures
 *     and check they are still parked.
 */

process.env.JWT_SECRET = 'test-secret-for-group-decision-tests';

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Importing the app pulls in the sync/cutover routes, which construct a
// Trigger client at import.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** app_user, so the route writes under RLS as it does in production. */
const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../../index.ts')).default;
const { seedMembership } = await import('../../__tests__/seed-membership.ts');

const P = '7c450000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const OTHER_TENANT = `${P}02`;
const MAPPING = `${P}d1`;
const OTHER_MAPPING = `${P}d2`;

const token = (tenant: string): string =>
  jwt.sign(
    { sub: `user-${tenant}`, tenantId: tenant, role: 'owner', email: 'owner@group.test' },
    process.env.JWT_SECRET as string,
  );

describe('one press over a group of failures', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  async function seedTenant(tenant: string, mapping: string, suffix: string): Promise<void> {
    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenant, `Group press ${suffix}`],
    );
    await seedMembership(owner, tenant, `user-${tenant}`, 'owner');
    const src = `${P}${suffix}1`;
    const dst = `${P}${suffix}2`;
    const boxSrc = `${P}${suffix}3`;
    const boxDst = `${P}${suffix}4`;
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $3, 'source', 'google',    'Google',    '{}', 'connected'),
         ($2, $3, 'target', 'nextcloud', 'Nextcloud', '{}', 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [src, dst, tenant],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
         ($1, $3, $4, 'source box', 'user'),
         ($2, $3, $5, 'target box', 'user')
       ON CONFLICT (id) DO NOTHING`,
      [boxSrc, boxDst, tenant, src, dst],
    );
    await owner.query(
      `INSERT INTO mailbox_mapping
         (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern, name)
       VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s', 'Group press')
       ON CONFLICT (id) DO NOTHING`,
      [mapping, tenant, boxSrc, boxDst],
    );
  }

  /** A parked failure, the shape the live 82 were in. */
  async function parked(
    tenant: string,
    mapping: string,
    key: string,
    error: string,
    domain = 'file',
  ): Promise<void> {
    await owner.query(
      `INSERT INTO item
         (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
          status, attempt_count, last_error)
       VALUES ($1, $2, $3, '/Documents', $4, $4, 'failed', 5, $5)`,
      [tenant, mapping, domain, key, error],
    );
  }

  async function attemptsOf(tenant: string, key: string): Promise<number> {
    const r = await owner.query<{ attempt_count: number; status: string }>(
      `SELECT attempt_count, status FROM item WHERE tenant_id = $1 AND natural_key_hash = $2`,
      [tenant, key],
    );
    return r.rows[0]?.attempt_count ?? -1;
  }

  async function cursorCount(tenant: string): Promise<number> {
    const r = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cursor WHERE tenant_id = $1`,
      [tenant],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  const press = (body: unknown, tenant = TENANT, mapping = MAPPING) =>
    request
      .post(`/api/migrations/${mapping}/failures`)
      .set('Authorization', `Bearer ${token(tenant)}`)
      .send(body as Record<string, unknown>);

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);
    await seedTenant(TENANT, MAPPING, 'a');
    await seedTenant(OTHER_TENANT, OTHER_MAPPING, 'b');
  });

  beforeEach(async () => {
    await owner.query(`DELETE FROM item WHERE tenant_id = ANY($1)`, [[TENANT, OTHER_TENANT]]);
    await owner.query(`DELETE FROM cursor WHERE tenant_id = ANY($1)`, [[TENANT, OTHER_TENANT]]);
    // A delta token per side, so "were the cursors cleared" is answerable.
    for (const [t, m] of [
      [TENANT, MAPPING],
      [OTHER_TENANT, OTHER_MAPPING],
    ]) {
      await owner.query(
        `INSERT INTO cursor (tenant_id, mapping_id, folder_path, cursor_value)
         VALUES ($1, $2, '/caldav/v2/events/', 'sync-token:abc')`,
        [t, m],
      );
    }
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = ANY($1)`, [[TENANT, OTHER_TENANT]]);
    await owner.end();
  });

  it('refuses a press that names neither a domain nor a substring', async () => {
    await parked(TENANT, MAPPING, 'f1', 'MKCOL 404 on the parent collection');

    const res = await press({ action: 'retry' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('WHICH failures');
    // Nothing moved, and — the part that costs money — the cursors are intact.
    expect(await attemptsOf(TENANT, 'f1')).toBe(5);
    expect(await cursorCount(TENANT)).toBe(1);
  });

  it('refuses an empty substring, which is the same press wearing a filter', async () => {
    await parked(TENANT, MAPPING, 'f1', 'MKCOL 404');

    const res = await press({ action: 'retry', errorContains: '' });

    expect(res.status).toBe(400);
    expect(await attemptsOf(TENANT, 'f1')).toBe(5);
  });

  it('refuses an action it does not have, and a domain that is not one', async () => {
    const bad = await press({ action: 'delete-them', domain: 'file' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('delete-them');

    const notADomain = await press({ action: 'retry', domain: 'photos' });
    expect(notADomain.status).toBe(400);
    expect(notADomain.body.error).toContain('photos');
    // The refusal names the way out rather than leaving the caller guessing.
    expect(notADomain.body.hint).toContain('calendar');
  });

  it('retries a domain, zeroes every attempt count, and clears the cursors ONCE', async () => {
    for (const n of [1, 2, 3]) {
      await parked(TENANT, MAPPING, `f${n}`, 'MKCOL 404 on the parent collection');
    }
    await parked(TENANT, MAPPING, 'c1', 'calendar refused it', 'calendar');

    const res = await press({ action: 'retry', domain: 'file' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', action: 'retry', matched: 3 });
    expect(res.body.effect).toContain('3 item(s)');
    for (const n of [1, 2, 3]) expect(await attemptsOf(TENANT, `f${n}`)).toBe(0);
    expect(await attemptsOf(TENANT, 'c1')).toBe(5);
    expect(await cursorCount(TENANT)).toBe(0);
  });

  it('matches the error substring literally — a % is a percent sign', async () => {
    await parked(TENANT, MAPPING, 'literal', 'PUT refused for (50%).pdf');
    await parked(TENANT, MAPPING, 'decoy', 'PUT refused for 500-page-report.pdf');

    const res = await press({ action: 'retry', errorContains: '50%' });

    expect(res.body.matched).toBe(1);
    expect(await attemptsOf(TENANT, 'literal')).toBe(0);
    expect(await attemptsOf(TENANT, 'decoy')).toBe(5);
  });

  it('leaves the cursors alone when nothing matched', async () => {
    await parked(TENANT, MAPPING, 'f1', 'MKCOL 404');

    const res = await press({ action: 'retry', errorContains: 'a wording nothing used' });

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(0);
    // It says so rather than reporting success over an empty set.
    expect(res.body.effect).toContain('Nothing matched');
    // The whole point: no re-scan is paid for to put back zero items.
    expect(await cursorCount(TENANT)).toBe(1);
  });

  it('accepts a group without clearing cursors — nothing is going back in the loop', async () => {
    await parked(TENANT, MAPPING, 'g1', 'Google-native file has no bytes to copy');
    await parked(TENANT, MAPPING, 'g2', 'Google-native file has no bytes to copy');

    const res = await press({ action: 'accept', errorContains: 'Google-native' });

    expect(res.body).toMatchObject({ action: 'accept', matched: 2 });
    const rows = await owner.query<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM item WHERE tenant_id = $1 ORDER BY natural_key_hash`,
      [TENANT],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['left_behind', 'left_behind']);
    // The reason the decision was made survives it.
    expect(rows.rows[0]?.last_error).toContain('Google-native');
    expect(await cursorCount(TENANT)).toBe(1);
  });

  it('never reaches another tenant with identical failures', async () => {
    await parked(TENANT, MAPPING, 'mine', 'MKCOL 404 on the parent collection');
    await parked(OTHER_TENANT, OTHER_MAPPING, 'theirs', 'MKCOL 404 on the parent collection');

    const res = await press({ action: 'retry', errorContains: 'MKCOL' });

    expect(res.body.matched).toBe(1);
    expect(await attemptsOf(TENANT, 'mine')).toBe(0);
    expect(await attemptsOf(OTHER_TENANT, 'theirs')).toBe(5);
    expect(await cursorCount(OTHER_TENANT)).toBe(1);
  });

  it('answers 404 for a mapping in somebody else’s tenant', async () => {
    await parked(OTHER_TENANT, OTHER_MAPPING, 'theirs', 'MKCOL 404');

    const res = await press({ action: 'retry', errorContains: 'MKCOL' }, TENANT, OTHER_MAPPING);

    expect(res.status).toBe(404);
    expect(await attemptsOf(OTHER_TENANT, 'theirs')).toBe(5);
  });
});
