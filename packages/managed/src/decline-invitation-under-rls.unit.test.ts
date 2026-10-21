// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Declining an invitation, and the two things the database must refuse
 * (workplan 0099, migration 0008).
 *
 * Its sibling `claim-invitation-under-rls.unit.test.ts` proves accepting. This
 * proves the answer that had nowhere to go until 0099 — and it matters more,
 * because "no" is the answer somebody gives to an organisation they do not
 * trust, and the statement that records it is one keystroke from two much worse
 * statements.
 *
 * ## Declining must not bind the decliner
 *
 * Accepting sets `user_id` to the real subject, because that is what joining
 * means. Declining must not, or `tenant_member` would hold a permanent link
 * between a person and an organisation they refused — in a table that
 * organisation's operator can read. The refusal is meant to end the
 * relationship, not to record it more precisely.
 *
 * ## And declining must not be usable as a weapon
 *
 * This is the one that would have shipped quietly. `tenant_member` is unique per
 * (organisation, subject), so writing SOMEBODY ELSE'S subject into a declined
 * row permanently blocks that person from ever joining that organisation:
 *
 *     SET status = 'declined', user_id = '<victim>'
 *
 * That is the same statement the route issues, with one field changed. Nothing
 * in application code distinguishes them, which is exactly why the bound is a
 * WITH CHECK (`user_id LIKE 'pending:%'`) and not a code review.
 *
 * ## And you can read who is asking
 *
 * A person deciding needs the organisation's NAME, and an invitee has no
 * membership and so no tenant scope. Migration 0008 gives them a policy bounded
 * by the invitation itself; ledger 0028 is what stops the pre-existing
 * `tenant_isolation_select` RAISING on the empty string first. Both are
 * asserted, because either one missing produces the same broken screen.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0122…, unused elsewhere in the repo.
const TENANT = '01220000-e29b-41d4-a716-446655442001';
const OTHER_TENANT = '01220000-e29b-41d4-a716-446655442002';

const INVITED_EMAIL = 'asked@example.test';
const SOMEBODY_ELSE = 'other@example.test';
const DECLINER = 'sub-decliner';
const VICTIM = 'sub-victim';

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
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM tenant_member');
    await conn.query('DELETE FROM tenant');
    await conn.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1,'Asked Ltd','active'), ($2,'Other','active')`,
      [TENANT, OTHER_TENANT],
    );
    await conn.query(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at) VALUES
         ($1,'pending:aaa',$3,'owner','invited', now()),
         ($2,'pending:bbb',$4,'admin','invited', now())`,
      [TENANT, OTHER_TENANT, INVITED_EMAIL, SOMEBODY_ELSE],
    );
  } finally {
    conn.release();
  }
});

/** The decline, narrowed by the exact address (`auth.ts` compares in any case since managed 0059; see below). */
const declineAs = (
  userId: string,
  verifiedEmail: string | undefined,
  targetEmail: string,
  setUserId?: string,
) =>
  withSubject(
    driver,
    userId,
    async (db) =>
      db.execute(
        `UPDATE tenant_member
            SET status = 'declined'${setUserId === undefined ? '' : `, user_id = '${setUserId}'`}
          WHERE email = '${targetEmail}' AND status = 'invited'`,
      ),
    verifiedEmail === undefined ? {} : { verifiedEmail },
  );

const rowFor = async (email: string) => {
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<{ status: string; user_id: string }>(
      `SELECT status, user_id FROM tenant_member WHERE email = $1`,
      [email],
    );
    return rows[0];
  } finally {
    conn.release();
  }
};

describe('declining an invitation', () => {
  it('records the refusal WITHOUT binding the person who refused', async () => {
    await declineAs(DECLINER, INVITED_EMAIL, INVITED_EMAIL);

    const row = await rowFor(INVITED_EMAIL);
    expect(row?.status, 'the refusal is recorded').toBe('declined');
    // The half that matters. A declined row naming its decliner is a permanent
    // link to an organisation they said no to, readable by that organisation.
    expect(row?.user_id, 'declining must not bind a subject').toBe('pending:aaa');
    expect(row?.user_id).not.toBe(DECLINER);
  });

  it('leaves the refusal VISIBLE to the person who gave it', async () => {
    // The condition the decline could not satisfy until migration 0008 added a
    // SELECT policy for it, and the reason this was a loud failure rather than a
    // silent one. An UPDATE's SELECT policies apply to the row it PRODUCES, not
    // only the one it started from — and a declined row matches neither
    // `see_own_invitation` (not 'invited'), `own_membership_select` (the id is
    // still `pending:`) nor `tenant_isolation_select` (no tenant scope).
    //
    // Accepting never noticed, because its new row carries this subject's id and
    // is therefore visible by accident of what accepting happens to write.
    await declineAs(DECLINER, INVITED_EMAIL, INVITED_EMAIL);

    const seen = await withSubject(
      driver,
      DECLINER,
      async (db) => db.execute(`SELECT status FROM tenant_member`),
      { verifiedEmail: INVITED_EMAIL },
    );
    const rows = (seen as unknown as { rows: Array<{ status: string }> }).rows;

    // Exactly their own, and it says what they answered. Not the other row,
    // which is an open invitation addressed to somebody else.
    expect(rows.map((r) => r.status)).toEqual(['declined']);
  });

  it('REFUSES to write somebody else into the declined row', async () => {
    // The weapon. Unique per (organisation, subject), so this would block the
    // victim from ever joining — a denial of service written as a refusal, and
    // one field away from the statement the route legitimately issues.
    await expect(declineAs(DECLINER, INVITED_EMAIL, INVITED_EMAIL, VICTIM)).rejects.toThrow();

    const row = await rowFor(INVITED_EMAIL);
    expect(row?.status, 'and it changed nothing on the way out').toBe('invited');
    expect(row?.user_id).toBe('pending:aaa');
  });

  it('REFUSES to decline an invitation addressed to somebody else', async () => {
    // USING, not WITH CHECK. `app.current_email` is the decliner's verified
    // address, and the other row is not addressed to it — so there is nothing
    // to update and the refusal is silent rather than loud. Emptiness is the
    // assertion: the row is untouched.
    await declineAs(DECLINER, INVITED_EMAIL, SOMEBODY_ELSE);

    const row = await rowFor(SOMEBODY_ELSE);
    expect(row?.status).toBe('invited');
  });

  it('refuses when the issuer never asserted the address', async () => {
    // No verified email means `app.current_email` is unset, and an unset
    // setting decays to '' on a pooled connection rather than NULL. `email = ''`
    // is false, never an error — so this matches nothing instead of raising.
    await declineAs(DECLINER, undefined, INVITED_EMAIL);

    expect((await rowFor(INVITED_EMAIL))?.status).toBe('invited');
  });

  it('leaves an unanswered invitation exactly as it was — skip writes nothing', async () => {
    // Skip is the absence of a statement, so there is nothing to run here. What
    // is asserted is that the fixture's own state IS the skipped state: an
    // invitation nobody answered is still open and still offered.
    const row = await rowFor(INVITED_EMAIL);
    expect(row?.status).toBe('invited');
    expect(row?.user_id).toBe('pending:aaa');
  });
});

describe('reading the organisation that invited you', () => {
  it('lets an invitee read the tenant, with no membership and no tenant scope', async () => {
    const names = await withSubject(
      driver,
      DECLINER,
      async (db) => db.execute(`SELECT name FROM tenant ORDER BY name`),
      { verifiedEmail: INVITED_EMAIL },
    );
    const rows = (names as unknown as { rows: Array<{ name: string }> }).rows;

    // Exactly the one that invited them — not the other tenant, which also
    // exists and also has an open invitation out to a different address.
    expect(rows.map((r) => r.name)).toEqual(['Asked Ltd']);
  });

  it('shows nothing to a subject holding no invitation', async () => {
    const names = await withSubject(
      driver,
      'sub-stranger',
      async (db) => db.execute(`SELECT name FROM tenant`),
      { verifiedEmail: 'stranger@example.test' },
    );
    const rows = (names as unknown as { rows: Array<{ name: string }> }).rows;

    // And crucially it does not RAISE. Before ledger 0028 the pre-existing
    // `tenant_isolation_select` cast '' to uuid here and the whole query threw,
    // which is a 500 on a screen whose job is to say "nothing is waiting".
    expect(rows).toEqual([]);
  });
});

/**
 * DECLINING IN ANY CASE (managed 0059; workplan 0156 §3's "Not done").
 *
 * The decline's USING and its WITH CHECK both pinned the address exactly, and
 * so did the policy that shows the answer afterwards and the one that lets an
 * invitee read the organisation's name. 0059 compares all four in any case and
 * without the spaces around it, as the rest of the system already does. The
 * WITH CHECK still refuses a real subject on the row and still refuses another
 * address; only the case of the same address stops mattering.
 *
 * Every statement narrows by organisation, never by address, so the policy
 * alone decides.
 */
describe('declining in any case (managed 0059)', () => {
  const CASED_TENANT = '01220000-e29b-41d4-a716-446655442003';
  const STORED = 'Pat.Jansen@Example.test ';
  const VERIFIED = 'pat.jansen@example.test';

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'Cased Ltd','active')`, [
        CASED_TENANT,
      ]);
      await conn.query(
        `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
           VALUES ($1,'pending:ccc',$2,'admin','invited', now())`,
        [CASED_TENANT, STORED],
      );
    } finally {
      conn.release();
    }
  });

  const casedRow = async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ status: string; user_id: string; email: string }>(
        `SELECT status, user_id, email FROM tenant_member WHERE tenant_id = $1`,
        [CASED_TENANT],
      );
      return rows[0]!;
    } finally {
      conn.release();
    }
  };

  /** The decline, narrowed to the organisation only. */
  const declineTheOrganisation = (
    verifiedEmail: string | undefined,
    set = `status = 'declined'`,
  ) =>
    withSubject(
      driver,
      DECLINER,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET ${set}
            WHERE tenant_id = '${CASED_TENANT}' AND status = 'invited'`,
        ),
      verifiedEmail === undefined ? {} : { verifiedEmail },
    );

  it('records the refusal from the verified address in another case, binding nobody', async () => {
    await declineTheOrganisation(VERIFIED);
    expect(await casedRow()).toMatchObject({ status: 'declined', user_id: 'pending:ccc', email: STORED });
  });

  it('leaves the refusal visible to the person who gave it, in another case', async () => {
    await declineTheOrganisation(VERIFIED);
    const seen = await withSubject(
      driver,
      DECLINER,
      async (db) => db.execute(`SELECT tenant_id, status FROM tenant_member`),
      { verifiedEmail: 'PAT.JANSEN@EXAMPLE.TEST' },
    );
    const rows = (seen as unknown as { rows: Array<{ tenant_id: string; status: string }> }).rows;
    expect(rows).toEqual([{ tenant_id: CASED_TENANT, status: 'declined' }]);
  });

  it('lets the invitee read the organisation that invited them, in another case', async () => {
    const names = await withSubject(
      driver,
      DECLINER,
      async (db) => db.execute(`SELECT name FROM tenant ORDER BY name`),
      { verifiedEmail: `  ${VERIFIED.toUpperCase()}` },
    );
    const rows = (names as unknown as { rows: Array<{ name: string }> }).rows;
    // Only the one that invited this address; the other two are addressed to others.
    expect(rows.map((r) => r.name)).toEqual(['Cased Ltd']);
  });

  /** Every message in the cause chain: Drizzle puts Postgres's reason in `.cause`. */
  const refusalOf = async (attempt: Promise<unknown>) => {
    const err = await attempt.then(
      () => null,
      (e: unknown) => e,
    );
    const out: string[] = [];
    for (let current: unknown = err; current instanceof Error; current = current.cause) {
      out.push(current.message);
    }
    return out.join(' | ');
  };

  it('still REFUSES to write somebody else into the declined row, in another case', async () => {
    expect(
      await refusalOf(declineTheOrganisation(VERIFIED, `status = 'declined', user_id = '${VICTIM}'`)),
    ).toMatch(/violates row-level security policy/);
    expect(await casedRow()).toMatchObject({ status: 'invited', user_id: 'pending:ccc' });
  });

  it('still REFUSES to rewrite the address to somebody else on the way through', async () => {
    // The WITH CHECK's address pin, which 0059 keeps: the declined row must
    // still be addressed to the verified address, in whatever case.
    expect(
      await refusalOf(
        declineTheOrganisation(VERIFIED, `status = 'declined', email = 'someone.else@example.test'`),
      ),
    ).toMatch(/violates row-level security policy/);
    expect(await casedRow()).toMatchObject({ status: 'invited', email: STORED });
  });

  it.each([
    ['no verified address', undefined],
    ['an empty setting', ''],
    ['another address', 'other@example.test'],
  ])('declines NOTHING for %s', async (_how, verified) => {
    await declineTheOrganisation(verified);
    expect(await casedRow()).toMatchObject({ status: 'invited', user_id: 'pending:ccc' });
  });

  it('shows the organisation to nobody holding another address', async () => {
    const names = await withSubject(
      driver,
      'sub-stranger',
      async (db) => db.execute(`SELECT name FROM tenant`),
      { verifiedEmail: 'Stranger@Example.test' },
    );
    expect((names as unknown as { rows: unknown[] }).rows).toEqual([]);
  });
});
