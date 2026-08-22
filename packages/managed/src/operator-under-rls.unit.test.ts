// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Who may answer the door, enforced by the database (migration 0005, T6).
 *
 * The whole point of putting this privilege in a policy rather than in a route
 * is that a bug in the route cannot grant it. So the assertions here are made
 * against the real `app_user` role — the one the API connects as — because a
 * policy checked on an owner connection proves nothing at all: Postgres exempts
 * owners and superusers from row security.
 *
 * Three properties, in order of how badly each would hurt if it were false:
 *
 *  1. **A non-operator sees NOTHING.** `access_request` holds what strangers
 *     typed into a public form — names, addresses, what they are moving. It had
 *     no SELECT grant at all before this migration, so every row of new access
 *     is new exposure.
 *  2. **An operator cannot learn who the other operators are.** The list of
 *     people who can provision accounts is a list of who to phish, so the
 *     policy on `platform_operator` is "your own row" and the authorisation
 *     check is an EXISTS over it — which answers "am I one", never "who is".
 *  3. **A tenant-scoped request is unchanged.** Permissive policies are OR'd,
 *     so a new one can only ever widen. The one that matters is that an
 *     ordinary request — which sets `app.current_tenant` and no
 *     `app.current_user` — still sees no access requests whatsoever.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0120…, unused elsewhere in the repo.
const TENANT = '01200000-e29b-41d4-a716-446655442001';
const OPERATOR = 'sub-operator-one';
const OTHER_OPERATOR = 'sub-operator-two';
const OUTSIDER = 'sub-outsider';

let driver: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  // Seeded on the owner connection — which is the only thing that may write
  // this table, and the reason `operator:add` is a script and not a route.
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM access_request');
    await conn.query('DELETE FROM platform_operator');
    await conn.query('DELETE FROM tenant_member');
    await conn.query('DELETE FROM tenant');
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'T','active')`, [TENANT]);
    await conn.query(
      `INSERT INTO platform_operator (user_id, email) VALUES ($1,'op1@x.test'), ($2,'op2@x.test')`,
      [OPERATOR, OTHER_OPERATOR],
    );
    await conn.query(
      `INSERT INTO access_request (email, note, locale) VALUES
         ('stranger@example.test','two mailboxes off Google','nl'),
         ('другой@example.test','a family','en')`,
    );
  } finally {
    conn.release();
  }
});

const asSubject = (sub: string, sql: string) =>
  withSubject(driver, sub, async (db) => db.execute(sql));

/**
 * Every message in the cause chain, joined.
 *
 * Drizzle wraps a driver error as `Failed query: …` and puts the REASON in
 * `.cause` — so matching on `.message` alone asserts that something failed and
 * nothing about what, which would pass just as happily on a typo in the SQL.
 */
function reasons(err: unknown): string {
  const out: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    out.push(current.message);
    current = current.cause;
  }
  if (typeof current === 'object' && current !== null && 'message' in current) {
    out.push(String((current as { message: unknown }).message));
  }
  return out.join(' | ');
}

/** The error a statement raised, or null if it was allowed through. */
const refusalFrom = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('reading the queue', () => {
  it('answers an operator with the requests', async () => {
    const { rows } = await asSubject(OPERATOR, 'SELECT email FROM access_request');
    expect(rows).toHaveLength(2);
  });

  it('shows a NON-operator nothing at all', async () => {
    const { rows } = await asSubject(OUTSIDER, 'SELECT email FROM access_request');
    expect(rows).toHaveLength(0);
  });

  it('shows an ordinary tenant-scoped request nothing — the old property', async () => {
    // This is the assertion that would catch an over-broad policy. Before 0005
    // `app_user` had no SELECT grant here at all; now it has one, and the only
    // thing standing between a tenant token and everybody's contact details is
    // the EXISTS below being false.
    const { rows } = await withTenant(driver, TENANT, async (db) =>
      db.execute('SELECT email FROM access_request'),
    );
    expect(rows).toHaveLength(0);
  });

  it('shows nothing on a connection that has served a tenant first', async () => {
    // The decay from migration 0004, in the direction that matters here:
    // `app.current_user` reverts to '' rather than unset, and '' must not be
    // an operator.
    await withTenant(driver, TENANT, async (db) => db.execute('SELECT 1'));
    const { rows } = await asSubject(OUTSIDER, 'SELECT email FROM access_request');
    expect(rows).toHaveLength(0);
  });
});

describe('the operator list itself', () => {
  it('shows an operator their own row, and only their own', async () => {
    const { rows } = await asSubject(OPERATOR, 'SELECT user_id FROM platform_operator');
    expect(rows.map((r) => (r as { user_id: string }).user_id)).toEqual([OPERATOR]);
  });

  it('shows an outsider no operator at all — not even that any exist', async () => {
    const { rows } = await asSubject(OUTSIDER, 'SELECT user_id FROM platform_operator');
    expect(rows).toHaveLength(0);
  });

  it('REFUSES to let an operator appoint another operator', async () => {
    // Not a policy — a missing GRANT. An operator who could write this table
    // could hand the privilege on, and then the owner is no longer the one
    // deciding who decides.
    const err = await refusalFrom(
      asSubject(
        OPERATOR,
        `INSERT INTO platform_operator (user_id, email) VALUES ('sub-new','new@x.test')`,
      ),
    );
    expect(reasons(err)).toMatch(/permission denied/i);
  });

  it('REFUSES to let an operator remove one', async () => {
    const err = await refusalFrom(
      asSubject(OPERATOR, `DELETE FROM platform_operator WHERE user_id = '${OTHER_OPERATOR}'`),
    );
    expect(reasons(err)).toMatch(/permission denied/i);
  });
});

describe('deciding', () => {
  const anId = async () => {
    const { rows } = await asSubject(OPERATOR, `SELECT id FROM access_request LIMIT 1`);
    return (rows[0] as { id: string }).id;
  };

  it('lets an operator decline a request', async () => {
    const id = await anId();
    await asSubject(
      OPERATOR,
      `UPDATE access_request SET state='declined', decided_by='${OPERATOR}',
              decided_at=now(), decision_note='not yet' WHERE id='${id}'`,
    );
    const { rows } = await asSubject(OPERATOR, `SELECT state FROM access_request WHERE id='${id}'`);
    expect((rows[0] as { state: string }).state).toBe('declined');
  });

  it('does NOT let a non-operator decide', async () => {
    const id = await anId();
    // No policy matches, so the UPDATE finds no row rather than raising — which
    // is the same non-answer a SELECT gets, and is why the route has to check
    // the affected count rather than trust that the statement ran.
    await asSubject(
      OUTSIDER,
      `UPDATE access_request SET state='declined', decided_by='${OUTSIDER}', decided_at=now() WHERE id='${id}'`,
    );
    const { rows } = await asSubject(OPERATOR, `SELECT state FROM access_request WHERE id='${id}'`);
    expect((rows[0] as { state: string }).state).toBe('open');
  });

  it('REFUSES to let anybody delete a request, operator included', async () => {
    // A request is decided, never erased. An operator who could delete could
    // make a refusal disappear, and the queue's whole value is that it cannot.
    const id = await anId();
    const err = await refusalFrom(asSubject(OPERATOR, `DELETE FROM access_request WHERE id='${id}'`));
    expect(reasons(err)).toMatch(/permission denied/i);
  });

  it('still lets a stranger knock, with no subject and no tenant', async () => {
    // `anyone_may_ask` is untouched by any of the above.
    await withSubject(driver, '', async (db) =>
      db.execute(`INSERT INTO access_request (email) VALUES ('late@example.test')`),
    );
    const { rows } = await asSubject(OPERATOR, 'SELECT email FROM access_request');
    expect(rows).toHaveLength(3);
  });
});
