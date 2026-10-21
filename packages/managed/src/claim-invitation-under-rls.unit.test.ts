// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Turning an invitation into a membership (migration 0006, workplan 0093 T6).
 *
 * **Email is not an identity.** That sentence is the whole of what this file
 * defends. An invitation is addressed to an address, and the person who turns
 * up holding a token is whoever the issuer says they are — so the dangerous
 * version of this feature is "find the invitation for this email and hand it
 * over", and every case below is a way that could go wrong.
 *
 * The policy is bounded from both sides and NEITHER HALF IS ENOUGH ALONE:
 *
 *   USING       the row must be an open invitation to `app.current_email`
 *   WITH CHECK  what it becomes must be active and name THIS subject
 *
 * Without WITH CHECK, a claimant could rewrite a row they were allowed to
 * touch into anything — including somebody else's user id. Without USING, they
 * could rewrite rows that were never addressed to them. Both are asserted.
 *
 * `app.current_email` is set by `withSubject` only when the caller passes a
 * `verifiedEmail`, and `auth.ts` passes one only when the issuer asserted
 * `email_verified: true`. The test for THAT half lives with the middleware; what
 * is proven here is that the database refuses everything the middleware is
 * trusted not to ask for.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withSubject, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

// UUID family 0121…, unused elsewhere in the repo.
const TENANT = '01210000-e29b-41d4-a716-446655442001';
const OTHER_TENANT = '01210000-e29b-41d4-a716-446655442002';

const INVITED_EMAIL = 'granted@example.test';
const SOMEBODY_ELSE = 'other@example.test';
const CLAIMANT = 'sub-claimant';
const IMPOSTOR = 'sub-impostor';

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
      `INSERT INTO tenant (id, name, status) VALUES ($1,'Granted','active'), ($2,'Other','active')`,
      [TENANT, OTHER_TENANT],
    );
    // Exactly what granting an access request writes: an owner nobody holds yet.
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

/** The claim, narrowed by the exact address (`auth.ts` compares in any case since managed 0059; see below). */
const claimAs = (userId: string, verifiedEmail: string | undefined, targetEmail: string) =>
  withSubject(
    driver,
    userId,
    async (db) =>
      db.execute(
        `UPDATE tenant_member SET user_id = '${userId}', status = 'active', joined_at = now()
          WHERE email = '${targetEmail}' AND status = 'invited'`,
      ),
    verifiedEmail === undefined ? {} : { verifiedEmail },
  );

/** Every message in the cause chain — Drizzle puts the reason in `.cause`. */
function reasons(err: unknown): string {
  const out: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    out.push(current.message);
    current = current.cause;
  }
  return out.join(' | ');
}

const rowFor = async (email: string) => {
  const conn = await driver.acquire();
  try {
    const { rows } = await conn.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM tenant_member WHERE email = $1`,
      [email],
    );
    return rows[0]!;
  } finally {
    conn.release();
  }
};

describe('claiming an invitation addressed to you', () => {
  it('binds the row to the subject and makes it active', async () => {
    await claimAs(CLAIMANT, INVITED_EMAIL, INVITED_EMAIL);
    expect(await rowFor(INVITED_EMAIL)).toMatchObject({ user_id: CLAIMANT, status: 'active' });
  });

  it('lets the claimed membership be found by the ordinary lookup afterwards', async () => {
    // The point of the whole exercise: `authenticate` matches `status='active'`,
    // so an invitation that stays 'invited' is a row its holder cannot use.
    await claimAs(CLAIMANT, INVITED_EMAIL, INVITED_EMAIL);
    const { rows } = await withSubject(driver, CLAIMANT, async (db) =>
      db.execute(`SELECT tenant_id, role FROM tenant_member WHERE status = 'active'`),
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { role: string }).role).toBe('owner');
  });
});

describe('what the policy refuses', () => {
  it('claims NOTHING when no verified email was set', async () => {
    // The issuer did not assert `email_verified`, so `auth.ts` passes nothing
    // and `app.current_email` is never set. The statement runs and matches no
    // row — a refusal by non-match, which is the shape RLS refusals take.
    await claimAs(CLAIMANT, undefined, INVITED_EMAIL);
    expect(await rowFor(INVITED_EMAIL)).toMatchObject({ user_id: 'pending:aaa', status: 'invited' });
  });

  it('claims NOTHING addressed to somebody else, however verified you are', async () => {
    // The impostor genuinely holds `impostor@example.test` — the issuer says so
    // — and reaches for an invitation sent to a different address. USING is
    // what stops this, and it is the shape a route bug would take: look up an
    // invitation by an id or an email the CALLER supplied rather than by the
    // one the token proved.
    await claimAs(IMPOSTOR, 'impostor@example.test', SOMEBODY_ELSE);
    expect(await rowFor(SOMEBODY_ELSE)).toMatchObject({ user_id: 'pending:bbb', status: 'invited' });
  });

  it('REFUSES to bind an invitation to somebody OTHER than the caller', async () => {
    // The row is one the claimant may touch; what they may not do is hand it to
    // a third party. Measured rather than assumed: weakening the WITH CHECK to
    // `true` does NOT make this succeed, because the resulting row no longer
    // satisfies `see_own_invitation` either. The two policies refuse it
    // together, and the case below is the one that isolates WITH CHECK alone.
    const failed = await withSubject(
      driver,
      CLAIMANT,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET user_id = 'sub-somebody-else', status = 'active'
            WHERE email = '${INVITED_EMAIL}' AND status = 'invited'`,
        ),
      { verifiedEmail: INVITED_EMAIL },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(reasons(failed)).toMatch(/violates row-level security policy/);
    expect(await rowFor(INVITED_EMAIL)).toMatchObject({ user_id: 'pending:aaa' });
  });

  it('REFUSES to leave the row as an invitation while taking the user id', async () => {
    // WITH CHECK, isolated: `status = 'active'` is required of the result, so a
    // claim cannot quietly park a real subject on a row that still reads as
    // pending. Weakening the WITH CHECK to `true` makes exactly this case pass,
    // which is how the clause is shown to be load bearing at all.
    const failed = await withSubject(
      driver,
      CLAIMANT,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET user_id = '${CLAIMANT}'
            WHERE email = '${INVITED_EMAIL}' AND status = 'invited'`,
        ),
      { verifiedEmail: INVITED_EMAIL },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failed, 'the WITH CHECK did not fire').not.toBeNull();
  });

  it('cannot be used to change an ALREADY ACTIVE membership', async () => {
    // USING requires `status='invited'`, so this opens nothing on a real
    // membership — promoting yourself stays behind the tenant-scoped policies.
    await claimAs(CLAIMANT, INVITED_EMAIL, INVITED_EMAIL);
    await withSubject(
      driver,
      IMPOSTOR,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET user_id = '${IMPOSTOR}' WHERE email = '${INVITED_EMAIL}'`,
        ),
      { verifiedEmail: INVITED_EMAIL },
    ).catch(() => null);
    expect(await rowFor(INVITED_EMAIL)).toMatchObject({ user_id: CLAIMANT });
  });

  it('leaves an ordinary tenant-scoped request seeing exactly what it saw before', async () => {
    // A new permissive policy is an OR. This one keys on `app.current_email`,
    // which a tenant-scoped request never sets — and which decays to '' rather
    // than unset on a pooled connection (migration 0004), so the comparison is
    // deliberately TEXT with no cast.
    await withTenant(driver, TENANT, async (db) => db.execute('SELECT 1'));
    await withTenant(driver, TENANT, async (db) =>
      db.execute(`UPDATE tenant_member SET role = 'owner' WHERE email = '${SOMEBODY_ELSE}'`),
    );
    // The row belongs to OTHER_TENANT, so the tenant policy does not reach it
    // and the new one does not either.
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ role: string }>(
        `SELECT role FROM tenant_member WHERE email = $1`,
        [SOMEBODY_ELSE],
      );
      expect(rows[0]?.role).toBe('admin');
    } finally {
      conn.release();
    }
  });
});

/**
 * AN INVITATION IN ANY CASE (managed 0059; workplan 0156 §3's "Not done").
 *
 * Until 0059 the policy compared the address exactly, so an invitation typed
 * `Pat@Example.test` and an identity provider that verified `pat@example.test`
 * matched nothing: the organisation never bound and nobody was told why. The
 * rest of the system already decides two addresses are one person by
 * `lower(btrim(...))` (managed 0020's index, 0021's backfill, `auth.ts`'s
 * `labelsToUpdate`, the access queue's owner check), and 0059 makes the five
 * invitation policies use the same rule.
 *
 * Every statement here narrows by ORGANISATION, never by address, so it is the
 * policy alone that decides which address may see or claim. Everything the
 * policy refused before is still refused, each in another case.
 */
describe('an invitation in any case (managed 0059)', () => {
  const CASED_TENANT = '01210000-e29b-41d4-a716-446655442003';
  const STORED = ' Pat@Example.test ';

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1,'Cased','active')`, [
        CASED_TENANT,
      ]);
      await conn.query(
        `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, invited_at)
           VALUES ($1,'pending:ccc',$2,'owner','invited', now())`,
        [CASED_TENANT, STORED],
      );
    } finally {
      conn.release();
    }
  });

  /** What the invitation is now, read past row security. */
  const casedRow = async () => {
    const conn = await driver.acquire();
    try {
      const { rows } = await conn.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM tenant_member WHERE tenant_id = $1`,
        [CASED_TENANT],
      );
      return rows[0]!;
    } finally {
      conn.release();
    }
  };

  /** The claim, narrowed to the organisation only: the policy picks the row. */
  const claimTheOrganisation = (userId: string, verifiedEmail: string | undefined) =>
    withSubject(
      driver,
      userId,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET user_id = '${userId}', status = 'active', joined_at = now()
            WHERE tenant_id = '${CASED_TENANT}' AND status = 'invited'`,
        ),
      verifiedEmail === undefined ? {} : { verifiedEmail },
    );

  /** Which invitations this subject can see, as `pendingInvitations` reads them. */
  const seenBy = async (userId: string, verifiedEmail: string) => {
    const seen = await withSubject(
      driver,
      userId,
      async (db) => db.execute(`SELECT tenant_id FROM tenant_member WHERE status = 'invited'`),
      { verifiedEmail },
    );
    return (seen as unknown as { rows: Array<{ tenant_id: string }> }).rows.map((r) => r.tenant_id);
  };

  it.each([
    ['in lower case', 'pat@example.test'],
    ['in capitals', 'PAT@EXAMPLE.TEST'],
    ['with spaces around it', '  pat@example.test  '],
  ])('lets the verified address see it, %s', async (_how, verified) => {
    expect(await seenBy(CLAIMANT, verified)).toEqual([CASED_TENANT]);
  });

  it('binds it to the verified address in another case, and makes it active', async () => {
    await claimTheOrganisation(CLAIMANT, 'pat@example.test');
    expect(await casedRow()).toMatchObject({ user_id: CLAIMANT, status: 'active' });
  });

  it('binds an invitation stored in lower case to an address verified in capitals', async () => {
    // The other direction: the access form typed in lower case, and the
    // provider (Microsoft, say) verified the address with capitals.
    const conn = await driver.acquire();
    try {
      await conn.query(`UPDATE tenant_member SET email = 'pat@example.test' WHERE tenant_id = $1`, [
        CASED_TENANT,
      ]);
    } finally {
      conn.release();
    }
    await claimTheOrganisation(CLAIMANT, 'Pat@Example.TEST');
    expect(await casedRow()).toMatchObject({ user_id: CLAIMANT, status: 'active' });
  });

  it('claims NOTHING when no verified email was set, in any case', async () => {
    await claimTheOrganisation(CLAIMANT, undefined);
    expect(await casedRow()).toMatchObject({ user_id: 'pending:ccc', status: 'invited' });
  });

  it('claims NOTHING on a setting left empty by an earlier transaction', async () => {
    // A pooled connection: the earlier transaction set the address, and
    // `set_config(…, true)` reverts it to '' rather than to unset. Asked of
    // the setting itself, so the decay is shown, not assumed.
    await seenBy(CLAIMANT, 'pat@example.test');
    const left = await withSubject(driver, CLAIMANT, async (db) =>
      db.execute(`SELECT current_setting('app.current_email', true) AS v`),
    );
    expect((left as unknown as { rows: Array<{ v: string | null }> }).rows[0]?.v).toBe('');

    await claimTheOrganisation(CLAIMANT, undefined);
    expect(await casedRow()).toMatchObject({ user_id: 'pending:ccc', status: 'invited' });
  });

  it('matches nothing on an empty or blank setting, not even an address that is blank itself', async () => {
    // No route writes a blank address, but the column allows one. Trimming
    // both sides would make '' equal '   ', so 0059 treats a blank setting as
    // no address at all.
    const conn = await driver.acquire();
    try {
      await conn.query(`UPDATE tenant_member SET email = '   ' WHERE tenant_id = $1`, [CASED_TENANT]);
    } finally {
      conn.release();
    }
    for (const blank of ['', '   ']) {
      expect(await seenBy(CLAIMANT, blank), JSON.stringify(blank)).toEqual([]);
      await claimTheOrganisation(CLAIMANT, blank);
      expect(await casedRow(), JSON.stringify(blank)).toMatchObject({
        user_id: 'pending:ccc',
        status: 'invited',
      });
    }
  });

  it.each([
    ['another address', 'other@example.test'],
    ['the same name at another domain', 'pat@example.test.example'],
    ['a space inside it', 'pat @example.test'],
  ])('claims NOTHING for %s, however verified', async (_how, verified) => {
    expect(await seenBy(IMPOSTOR, verified)).not.toContain(CASED_TENANT);
    await claimTheOrganisation(IMPOSTOR, verified);
    expect(await casedRow()).toMatchObject({ user_id: 'pending:ccc', status: 'invited' });
  });

  it('cannot be used to change an ALREADY ACTIVE membership, in another case', async () => {
    await claimTheOrganisation(CLAIMANT, 'pat@example.test');
    await withSubject(
      driver,
      IMPOSTOR,
      async (db) =>
        db.execute(`UPDATE tenant_member SET user_id = '${IMPOSTOR}' WHERE tenant_id = '${CASED_TENANT}'`),
      { verifiedEmail: 'PAT@example.test' },
    ).catch(() => null);
    expect(await casedRow()).toMatchObject({ user_id: CLAIMANT, status: 'active' });
  });

  it('still REFUSES to bind it to somebody other than the caller, in another case', async () => {
    // WITH CHECK is unchanged by 0059: what the row becomes must name THIS
    // subject and be active, whichever case the address was matched in.
    const failed = await withSubject(
      driver,
      CLAIMANT,
      async (db) =>
        db.execute(
          `UPDATE tenant_member SET user_id = 'sub-somebody-else', status = 'active'
            WHERE tenant_id = '${CASED_TENANT}' AND status = 'invited'`,
        ),
      { verifiedEmail: 'pat@example.test' },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(reasons(failed)).toMatch(/violates row-level security policy/);
    expect(await casedRow()).toMatchObject({ user_id: 'pending:ccc', status: 'invited' });
  });
});
