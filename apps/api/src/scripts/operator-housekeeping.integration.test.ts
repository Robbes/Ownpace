// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// The housekeeping queries, RUN. Against Testcontainers Postgres with both
// migration chains applied (pnpm test:integration).
//
// SQL THAT HAS NEVER BEEN EXECUTED IS SQL NOBODY HAS CHECKED, and a registry of
// five queries is five chances to ship a column name that does not exist, a
// join to a table the managed chain renamed, or a `WHERE` that quietly matches
// nothing. None of those fails a unit test — a string is a string — and the
// first person to find out is an operator running `check` on a live stack,
// which is the one place this repository has repeatedly promised not to send
// somebody with an untested command.
//
// So every check runs here, and four of them run against a state built to be
// found. The two that CLEAN also run their statement and are asked what
// changed, because "the delete fired" and "the row is gone" are different
// claims and only the second one is the promise.
//
// PARALLEL-SAFE BY CONSTRUCTION. Integration files run concurrently and these
// queries are deployment-wide by nature — `empty-tenant` sees every tenant any
// sibling file has in flight. So nothing here asserts a COUNT: every assertion
// is "my row is in the answer" or "my row is not", keyed on this file's own
// uuid family and mark.
//
// UUID Family: 7a150000-e29b-41d4-a716-44665544xxxx

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import {
  checkByKind,
  HOUSEKEEPING_CHECKS,
  type HousekeepingRow,
} from './operator-housekeeping.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const MARK = 'hk';
const EMPTY_TENANT = '7a150000-e29b-41d4-a716-446655440001';
const HOLDING_TENANT = '7a150000-e29b-41d4-a716-446655440002';
const OWNERLESS_TENANT = '7a150000-e29b-41d4-a716-446655440003';
const INVITED_TENANT = '7a150000-e29b-41d4-a716-446655440004';
const MY_TENANTS = [EMPTY_TENANT, HOLDING_TENANT, OWNERLESS_TENANT, INVITED_TENANT];

/** Operator subjects this file owns, all three shapes `subjectRefusal` refuses. */
const SEPARATOR_SUBJECT = '--';
const LONG_SUBJECT = `${MARK}-${'x'.repeat(210)}`;
const TOKEN_SUBJECT = `eyJhbGciOiJSUzI1NiJ9.${MARK}${'A'.repeat(40)}.c2ln`;
/** A real subject whose EMAIL column holds a token — the other operator check. */
const GOOD_SUBJECT = `${MARK}-387847603254984715`;
const TOKEN_EMAIL = `eyJhbGciOiJSUzI1NiJ9.${'B'.repeat(40)}.c2ln`;
const MY_SUBJECTS = [SEPARATOR_SUBJECT, LONG_SUBJECT, TOKEN_SUBJECT, GOOD_SUBJECT];

let pool: Pool;

/** Run a check the way `operator.sh check` does, and keep only my own rows. */
async function findMine(kind: string, ids: readonly string[]): Promise<HousekeepingRow[]> {
  const check = checkByKind(kind);
  expect(check, `no check called ${kind}`).not.toBeNull();
  const { rows } = await pool.query<{
    id: string;
    label: string;
    note: string;
    count: number;
    other_count: number;
    age_days: number;
  }>(check!.find);
  return rows
    .filter((r) => ids.includes(r.id))
    .map((r) => ({
      id: r.id,
      label: r.label,
      note: r.note,
      count: r.count,
      otherCount: r.other_count,
      ageDays: r.age_days,
    }));
}

async function wipe(): Promise<void> {
  await pool.query(`DELETE FROM platform_operator WHERE user_id = ANY($1::text[])`, [MY_SUBJECTS]);
  // `tenant` cascades to members, connections and everything else this file makes.
  await pool.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [MY_TENANTS]);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: PG });
});

afterAll(async () => {
  await wipe();
  await pool.end();
});

beforeEach(async () => {
  await wipe();
});

describe('every check is a query the database accepts', () => {
  it('runs, and answers with the six columns the runner reads', async () => {
    // THE CHEAPEST THING THIS FILE DOES AND THE MOST IMPORTANT. A typo in any
    // of these fails here in a second, and on a live stack it fails in front of
    // an operator who was told to run it.
    for (const check of HOUSEKEEPING_CHECKS) {
      const result = await pool.query(check.find);
      const columns = result.fields.map((f) => f.name).sort();
      expect(columns, `${check.kind} answered with the wrong columns`).toEqual(
        ['age_days', 'count', 'id', 'label', 'note', 'other_count'].sort(),
      );
    }
  });

  it('hands back counts as numbers, not as bigint strings', async () => {
    // `::int` in every query, and this is what proves the cast is on all of
    // them: node-pg parses int4 to a number and int8 to a STRING, and every
    // plural in every report turns on `=== 1`.
    for (const check of HOUSEKEEPING_CHECKS) {
      const { rows } = await pool.query<Record<string, unknown>>(check.find);
      for (const row of rows.slice(0, 5)) {
        for (const column of ['count', 'other_count', 'age_days']) {
          expect(typeof row[column], `${check.kind}.${column}`).toBe('number');
        }
      }
    }
  });
});

describe('an organisation with nobody in it', () => {
  it('is found, and one holding nothing may be cleaned', async () => {
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      EMPTY_TENANT,
      `${MARK} empty`,
    ]);

    const found = await findMine('empty-tenant', [EMPTY_TENANT]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count, 'no mappings or connections').toBe(0);
    expect(found[0]!.otherCount, 'no invoices').toBe(0);

    const check = checkByKind('empty-tenant')!;
    expect(check.clean!.can(found[0]!), 'holding nothing, it may go').toBeNull();

    // And the statement does what the report promised. `set_config` mirrors
    // what the runner does for a tenant-scoped clean.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [EMPTY_TENANT]);
      const { rowCount } = await client.query(check.clean!.sql, [EMPTY_TENANT]);
      expect(rowCount, 'the clean must match exactly one row').toBe(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await findMine('empty-tenant', [EMPTY_TENANT])).toHaveLength(0);
  });

  it('is found but refused when it holds work', async () => {
    // The second gate, against a real row rather than a synthetic one: deleting
    // this tenant would cascade the connection away with it.
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      HOLDING_TENANT,
      `${MARK} holding`,
    ]);
    await pool.query(
      `INSERT INTO connection (tenant_id, role, kind, display_name)
       VALUES ($1, 'source', 'imap', $2)`,
      [HOLDING_TENANT, `${MARK} source`],
    );

    const found = await findMine('empty-tenant', [HOLDING_TENANT]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(1);
    const why = checkByKind('empty-tenant')!.clean!.can(found[0]!);
    expect(why).not.toBeNull();
    expect(why).toContain('cascade');
  });

  it('does not report an organisation somebody is in', async () => {
    // The control. A check that matched every tenant would be a report nobody
    // could read, and it would pass every assertion above.
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      EMPTY_TENANT,
      `${MARK} peopled`,
    ]);
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())`,
      [EMPTY_TENANT, `${MARK}-owner`, `${MARK}-owner@example.test`],
    );
    expect(await findMine('empty-tenant', [EMPTY_TENANT])).toHaveLength(0);
  });

  it('still reports one whose only members are removed or declined', async () => {
    // `status NOT IN ('removed','declined')` — a tombstone is not somebody who
    // can administer the organisation, and treating it as one would hide the
    // finding entirely.
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      EMPTY_TENANT,
      `${MARK} tombstones`,
    ]);
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
       VALUES ($1, $2, $3, 'owner', 'removed')`,
      [EMPTY_TENANT, `${MARK}-gone`, `${MARK}-gone@example.test`],
    );
    expect(await findMine('empty-tenant', [EMPTY_TENANT])).toHaveLength(1);
  });
});

describe('an organisation with people in it and no owner', () => {
  beforeEach(async () => {
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      OWNERLESS_TENANT,
      `${MARK} ownerless`,
    ]);
  });

  it('is found, and names somebody who could be promoted', async () => {
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, $2, $3, 'member', 'active', now())`,
      [OWNERLESS_TENANT, `${MARK}-member`, `${MARK}-member@example.test`],
    );

    const found = await findMine('ownerless-tenant', [OWNERLESS_TENANT]);
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(1);
    expect(found[0]!.otherCount, 'one of them is active').toBe(1);
    expect(found[0]!.note, 'the candidate to promote').toBe(`${MARK}-member@example.test`);
    expect(checkByKind('ownerless-tenant')!.remedy(found[0]!)).toContain(
      `${MARK}-member@example.test`,
    );
  });

  it('is not fooled by an owner who is only invited', async () => {
    // `role = 'owner' AND status = 'active'`. An invited owner cannot
    // administer anything until they arrive, so an organisation holding only
    // one is exactly as stuck as an organisation holding none — and the
    // cheaper predicate (`role = 'owner'`) would report neither.
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
       VALUES ($1, $2, $3, 'owner', 'invited', now())`,
      [OWNERLESS_TENANT, `pending:${MARK}-a`, `${MARK}-invited@example.test`],
    );
    const found = await findMine('ownerless-tenant', [OWNERLESS_TENANT]);
    expect(found).toHaveLength(1);
    expect(found[0]!.otherCount, 'nobody active').toBe(0);
    expect(
      checkByKind('ownerless-tenant')!.remedy(found[0]!),
      'and it offers no UPDATE, because there is nobody to promote',
    ).toContain('nobody to promote');
  });

  it('goes quiet the moment there is an active owner', async () => {
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, $2, $3, 'owner', 'active', now())`,
      [OWNERLESS_TENANT, `${MARK}-real-owner`, `${MARK}-real-owner@example.test`],
    );
    expect(await findMine('ownerless-tenant', [OWNERLESS_TENANT])).toHaveLength(0);
  });
});

describe('an invitation nobody answered', () => {
  it('is found only once it is old, and never for somebody who arrived', async () => {
    await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [
      INVITED_TENANT,
      `${MARK} invited`,
    ]);
    // Three people: one invited long ago, one invited yesterday, one who
    // claimed. Only the first is a finding, and the other two are what stop
    // this check from being a list of everybody.
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
       VALUES ($1, $2, $3, 'member', 'invited', now() - interval '90 days')`,
      [INVITED_TENANT, `pending:${MARK}-old`, `${MARK}-old@example.test`],
    );
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
       VALUES ($1, $2, $3, 'member', 'invited', now() - interval '1 day')`,
      [INVITED_TENANT, `pending:${MARK}-new`, `${MARK}-new@example.test`],
    );
    await pool.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at, joined_at)
       VALUES ($1, $2, $3, 'member', 'active', now() - interval '90 days', now())`,
      [INVITED_TENANT, `${MARK}-arrived`, `${MARK}-arrived@example.test`],
    );

    const check = checkByKind('stale-invitation')!;
    const { rows } = await pool.query<{ id: string; label: string; age_days: number }>(check.find);
    const mine = rows.filter((r) => r.label.startsWith(`${MARK}-`));
    expect(mine.map((r) => r.label)).toEqual([`${MARK}-old@example.test`]);
    expect(mine[0]!.age_days).toBeGreaterThanOrEqual(89);
  });
});

describe('operator rows that hold what they should not', () => {
  it('finds every subject shape no issuer can mint, and removing one takes nothing', async () => {
    for (const subject of [SEPARATOR_SUBJECT, LONG_SUBJECT, TOKEN_SUBJECT]) {
      await pool.query(`INSERT INTO platform_operator (user_id, email) VALUES ($1, $2)`, [
        subject,
        `${MARK}-appointed@example.test`,
      ]);
    }
    // And a real one, which must survive all of it.
    await pool.query(`INSERT INTO platform_operator (user_id, email) VALUES ($1, $2)`, [
      GOOD_SUBJECT,
      `${MARK}-real@example.test`,
    ]);

    const check = checkByKind('operator-that-matches-nobody')!;
    const found = await findMine('operator-that-matches-nobody', MY_SUBJECTS);
    expect(found.map((r) => r.id).sort()).toEqual(
      [SEPARATOR_SUBJECT, LONG_SUBJECT, TOKEN_SUBJECT].sort(),
    );
    // The report says nothing about the values, and the query does not even
    // fetch them — see the module header.
    expect(found.every((r) => r.label === '(not printed)')).toBe(true);
    expect(found.every((r) => r.note === '')).toBe(true);

    for (const row of found) {
      expect(check.clean!.can(row), 'a row matching nobody may always go').toBeNull();
      const { rowCount } = await pool.query(check.clean!.sql, [row.id]);
      expect(rowCount).toBe(1);
    }
    expect(await findMine('operator-that-matches-nobody', MY_SUBJECTS)).toHaveLength(0);

    const { rows: survivors } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM platform_operator WHERE user_id = $1`,
      [GOOD_SUBJECT],
    );
    expect(survivors, 'the real operator is untouched').toHaveLength(1);
  });

  it('finds a credential in the email column and redacts it, keeping the appointment', async () => {
    await pool.query(`INSERT INTO platform_operator (user_id, email) VALUES ($1, $2)`, [
      GOOD_SUBJECT,
      TOKEN_EMAIL,
    ]);

    const check = checkByKind('credential-at-rest')!;
    const found = await findMine('credential-at-rest', MY_SUBJECTS);
    expect(found).toHaveLength(1);
    expect(found[0]!.count, 'the length, which is all it says').toBe(TOKEN_EMAIL.length);
    expect(check.describe(found[0]!)).not.toContain('B'.repeat(20));

    const { rowCount } = await pool.query(check.clean!.sql, [found[0]!.id]);
    expect(rowCount).toBe(1);

    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM platform_operator WHERE user_id = $1`,
      [GOOD_SUBJECT],
    );
    expect(rows, 'THE APPOINTMENT STANDS — this redacts, it does not unappoint').toHaveLength(1);
    expect(rows[0]!.email).toBe('redacted-credential@invalid');
    expect(await findMine('credential-at-rest', MY_SUBJECTS)).toHaveLength(0);
  });

  it('leaves an ordinary appointment entirely alone', async () => {
    // The control for both operator checks at once. They run over the whole
    // table on a live deployment, and a false positive here is a report telling
    // an operator to delete a colleague.
    await pool.query(`INSERT INTO platform_operator (user_id, email, note) VALUES ($1, $2, $3)`, [
      GOOD_SUBJECT,
      `${MARK}-real@example.test`,
      'first operator',
    ]);
    expect(await findMine('operator-that-matches-nobody', MY_SUBJECTS)).toHaveLength(0);
    expect(await findMine('credential-at-rest', MY_SUBJECTS)).toHaveLength(0);
  });
});
