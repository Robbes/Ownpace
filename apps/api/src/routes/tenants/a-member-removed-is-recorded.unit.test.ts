// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MEMBER REMOVED IS RECORDED (workplan 0135 T8).
 *
 * The Team page's removal deletes the member row. Until 2026-09-29 it recorded
 * nothing, so nothing was left to say the person had ever been let in, and
 * `deploy/compose/idp-strays.sh`, live's daily duty, took their used sign-in
 * account for one nobody let in and removed it once it was 30 days old.
 * Privacy §9's 30 days are for an account "that we never let in", and the
 * owner's question was whether these are unused accounts: "unused, yes"
 * (`site/legal/README.md`). `operator.sh leave` already recorded its removals.
 *
 * What this holds, against a real database (PGlite, both migration chains,
 * the route as `app_user` so row security is in force):
 *
 * - a removal writes one `audit_log` row, `member.removed`, naming the removed
 *   subject in `detail.userId`, with the member row's id, role and status and
 *   the door it came through, and no address;
 * - the record names the row as the delete found it: an invitee who first
 *   signs in between the route's read and its delete turns the row from a
 *   `pending:` placeholder into their subject, and a record of the
 *   placeholder would leave their account to the strays duty (review of
 *   2026-09-29);
 * - the action is spelled as `operator.sh leave` spells it, and the statement
 *   the strays duty sends finds the subject on the owner's connection, as the
 *   script reads it; as `app_user`, row security shows one organisation's
 *   rows at a time, which is why the script reads as the owner;
 * - that statement gives each removal's time, the record's own `at`, in whole
 *   seconds since 1970: the script keeps the account until 7 days after the
 *   newest removal (0135 open question 13, answered 2026-09-29), and
 *   `operator.sh leave` names the subject under the key the statement reads;
 * - the statement the runbook's Tenant offboarding has the operator run before
 *   a purge names the organisation's members and the subjects removed from
 *   it, once each: the purge deletes the organisation's `audit_log` rows, and
 *   with them the record of a removal less than 7 days old, which would leave
 *   that account 30 days from its creation, or for ever with none (review of
 *   2026-09-29);
 * - a removal the route refuses records nothing;
 * - the removal and its record are one transaction: a record that cannot be
 *   written leaves the member in place.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

// UUID family 5f620000-…, unused elsewhere in the repo.
const TENANT = '5f620000-e29b-41d4-a716-446655441801';
const OTHER_TENANT = '5f620000-e29b-41d4-a716-446655441802';
const OWNER = { tenantId: TENANT, userId: 'sub-owner-0135', userRole: 'owner' };
const ADMIN = { tenantId: TENANT, userId: 'sub-admin-0135', userRole: 'admin' };
const FORMER = 'sub-former-0135';
const FORMER_ADDRESS = 'former@acme.test';

let driver: LedgerDriver;
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};
/** Runs once, after the route's next `withTenantDb` returns and before the one after it. */
let afterTheRead: (() => Promise<unknown>) | null = null;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
    withTenantDb: (async (...args: Parameters<typeof actual.withTenantDb>) => {
      const out = await actual.withTenantDb(...args);
      const between = afterTheRead;
      afterTheRead = null;
      if (between) await between();
      return out;
    }) as typeof actual.withTenantDb,
  };
});

const { default: memberRoutes, MEMBER_REMOVED_ACTION } = await import('./members.ts');
const { MEMBERSHIP_REMOVED_ACTION } = await import('../../scripts/operator.ts');

const app = express();
app.use(express.json());
app.use('/api/tenants/:tenantId/members', memberRoutes);

/** A statement on the database's own superuser: row security does not hold it back. */
async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

async function seeded(userId: string, email: string, role: string): Promise<string> {
  const [row] = await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
     VALUES ($1, $2, $3, $4, 'active', now()) RETURNING id`,
    [TENANT, userId, email, role],
  );
  return row!.id as string;
}

const removals = () =>
  rows(`SELECT actor, entity, detail FROM audit_log WHERE tenant_id = $1 AND action = 'member.removed' ORDER BY at`, [
    TENANT,
  ]);

/** The statement `idp-strays.sh` sends for the subjects that were let in and removed since. */
function theStraysDutysStatement(): string {
  const script = readFileSync(join(REPO, 'deploy', 'compose', 'idp-strays.sh'), 'utf8');
  const line = /^db "\$\{WORK\}\/removed" "([^"]+)"$/m.exec(script);
  if (!line) throw new Error('idp-strays.sh reads no record of removals (db "${WORK}/removed" "…")');
  return line[1]!;
}

/**
 * The statement the runbook's Tenant offboarding has the operator run before
 * a purge, for the subjects whose accounts to remove with `--subject` after it.
 */
function theOffboardingStatement(): string {
  const runbook = readFileSync(join(REPO, 'docs', 'operator-runbook.md'), 'utf8');
  const from = runbook.indexOf('**Their sign-in accounts.**');
  if (from < 0) throw new Error("the runbook's Tenant offboarding has no paragraph on their sign-in accounts");
  const statement = /<<'SQL'\n([\s\S]*?)\nSQL\n/.exec(runbook.slice(from, runbook.indexOf('\n## ', from)))?.[1];
  if (!statement) throw new Error("the runbook's Tenant offboarding gives no statement for the subjects to note before the purge");
  return statement;
}

let ownerId = '';
let formerId = '';

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Families']);
  // 120s for the reason every PGlite fixture here carries it: both migration
  // chains run before the first test, and a loaded runner is slow.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = OWNER;
  afterTheRead = null;
  await rows('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await rows('DELETE FROM tenant_member WHERE tenant_id = $1', [TENANT]);
  ownerId = await seeded(OWNER.userId, 'owner@acme.test', 'owner');
  await seeded(ADMIN.userId, 'admin@acme.test', 'admin');
  formerId = await seeded(FORMER, FORMER_ADDRESS, 'admin');
});

describe('a member removed on the Team page is recorded', () => {
  it('in one audit_log row, member.removed, naming the subject and no address', async () => {
    const res = await request(app).delete(`/api/tenants/${TENANT}/members/${formerId}`);
    expect(res.status).toBe(204);
    expect(await rows('SELECT 1 FROM tenant_member WHERE id = $1', [formerId])).toEqual([]);

    const recorded = await removals();
    expect(recorded, 'the removal wrote no record, so the strays duty would take their account').toHaveLength(1);
    expect(recorded[0]).toEqual({
      actor: OWNER.userId,
      entity: 'member',
      detail: { memberId: formerId, userId: FORMER, role: 'admin', status: 'active', via: 'the Team page' },
    });
    expect(JSON.stringify(recorded[0])).not.toContain('@');
  });

  it('under the action operator.sh leave writes, which the strays duty reads on the owner connection', async () => {
    expect(MEMBER_REMOVED_ACTION).toBe(MEMBERSHIP_REMOVED_ACTION);
    const statement = theStraysDutysStatement();
    expect(statement).toContain(`action = '${MEMBER_REMOVED_ACTION}'`);

    await request(app).delete(`/api/tenants/${TENANT}/members/${formerId}`).expect(204);

    const asTheOwner = (await rows(statement)).map((r) => Object.values(r)[0]);
    expect(asTheOwner).toContain(FORMER);

    // Its second column is when, by the record's own `at`, in whole seconds
    // since 1970: the script keeps the account until 7 days after the newest
    // removal (0135 open question 13). Moved back 8 days, it reads 8 days ago,
    // so it is the row's time and not the statement's.
    const when = async () =>
      (await rows(statement)).map((r) => Object.values(r)).filter(([subject]) => subject === FORMER).map(([, at]) => Number(at));
    const [now] = await when();
    expect(Number.isInteger(now), `the time is not whole seconds: ${String(now)}`).toBe(true);
    expect(Math.abs(now! - Date.now() / 1000)).toBeLessThan(120);
    await rows(`UPDATE audit_log SET at = at - interval '8 days' WHERE tenant_id = $1 AND action = 'member.removed'`, [TENANT]);
    const [then] = await when();
    expect(Math.abs(then! - (Date.now() / 1000 - 8 * 86_400))).toBeLessThan(120);

    // As `app_user`, row security shows one organisation's rows at a time,
    // and none of another's: a question across every organisation has to be
    // asked as the database's owner, which is how the script asks it.
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query('SET LOCAL ROLE app_user');
      await conn.query(`SELECT set_config('app.current_tenant', $1, true)`, [OTHER_TENANT]);
      expect((await conn.query(statement)).rows).toEqual([]);
    } finally {
      await conn.query('ROLLBACK');
      await conn.release();
    }
  });

  it('and operator.sh leave names the subject under the key the statement reads it by', () => {
    // `operator.sh leave` records its own removal (`removeMembership`,
    // `scripts/operator.ts`), for a subject whose memberships it read by
    // `user_id`. Without the subject where the statement looks, its removal
    // would name nobody, and the account would be weighed as one nobody let in.
    const key = /detail->>'(\w+)'/.exec(theStraysDutysStatement())?.[1];
    expect(key, 'the statement reads no key of detail').toBe('userId');
    const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'scripts', 'operator.ts'), 'utf8');
    const from = source.indexOf('async function removeMembership(');
    expect(from, 'removeMembership is gone from operator.ts').toBeGreaterThan(-1);
    const body = source.slice(from, source.indexOf('\n}\n', from));
    expect(body).toContain('MEMBERSHIP_REMOVED_ACTION,');
    expect(body).toMatch(new RegExp(`\\b${key!}: subject,`));
  });

  it("and the runbook's Tenant offboarding notes them before a purge takes the record", async () => {
    // Closed with a window of 0, an organisation is purged at the next hourly
    // run, and the purge deletes its audit rows: a member removed less than 7
    // days before has no record left, and the daily run would keep their
    // account 30 days from its creation. So the operator notes the subjects
    // first, as the owner, and removes each with --subject after the purge.
    await request(app).delete(`/api/tenants/${TENANT}/members/${formerId}`).expect(204);
    // Removed twice, and an invitation whose placeholder is no account.
    await rows(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
       VALUES ($1, $2, 'member.removed', 'member', jsonb_build_object('userId', $3::text))`,
      [TENANT, OWNER.userId, FORMER],
    );
    await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
       VALUES ($1, 'pending:5f620000-e29b-41d4-a716-446655441804', 'invitee@acme.test', 'member', 'invited', 'requested', now())`,
      [TENANT],
    );
    // Another organisation's removal is not this one's to note.
    await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'Elsewhere') ON CONFLICT (id) DO NOTHING`, [OTHER_TENANT]);
    await rows(
      `INSERT INTO audit_log (tenant_id, actor, action, entity, detail)
       VALUES ($1, 'sub-someone', 'member.removed', 'member', '{"userId":"sub-elsewhere-0135"}')`,
      [OTHER_TENANT],
    );
    try {
      const statement = theOffboardingStatement();
      expect(statement).toContain(`action = '${MEMBER_REMOVED_ACTION}'`);
      const noted = (await rows(statement.replaceAll('<tenant-id>', TENANT))).map((r) => Object.values(r)[0]);
      expect(noted.sort()).toEqual([ADMIN.userId, OWNER.userId, FORMER].sort());
    } finally {
      await rows('DELETE FROM audit_log WHERE tenant_id = $1', [OTHER_TENANT]);
    }
  });

  it('names the row it deleted, when the invitee signs in between the read and the delete', async () => {
    // An invitation the owner withdraws while the invitee first signs in:
    // claimRequestedMembership (auth.ts) turns the same row from a `pending:`
    // placeholder, invited, into the person's subject, active. The row deleted
    // is then the member's, and a record that named what the route read first
    // would say `pending:…`, so the strays duty would weigh their account as
    // one nobody let in.
    const INVITEE = 'sub-invitee-0135';
    const [row] = await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
       VALUES ($1, $2, 'invitee@acme.test', 'member', 'invited', 'requested', now()) RETURNING id`,
      [TENANT, 'pending:5f620000-e29b-41d4-a716-446655441803'],
    );
    const invitationId = row!.id as string;
    afterTheRead = () =>
      rows(`UPDATE tenant_member SET user_id = $1, status = 'active', joined_at = now() WHERE id = $2`, [
        INVITEE,
        invitationId,
      ]);

    const res = await request(app).delete(`/api/tenants/${TENANT}/members/${invitationId}`);
    expect(res.status).toBe(204);
    expect(afterTheRead, 'the invitee never signed in between the two').toBeNull();
    expect(await rows('SELECT 1 FROM tenant_member WHERE id = $1', [invitationId])).toEqual([]);
    const recorded = await removals();
    expect(recorded.map((r) => r.detail)).toEqual([
      { memberId: invitationId, userId: INVITEE, role: 'member', status: 'active', via: 'the Team page' },
    ]);
  });

  it('records nothing for a removal it refuses', async () => {
    caller = ADMIN;
    const res = await request(app).delete(`/api/tenants/${TENANT}/members/${ownerId}`);
    expect(res.status).toBe(400);
    expect(await removals()).toEqual([]);
  });

  it('removes nobody when the record cannot be written: the two are one transaction', async () => {
    await rows(`CREATE FUNCTION refuse_the_record() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'the record is refused'; END $$`);
    await rows(`CREATE TRIGGER refuse_the_record BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.action = 'member.removed') EXECUTE FUNCTION refuse_the_record()`);
    try {
      const res = await request(app).delete(`/api/tenants/${TENANT}/members/${formerId}`);
      expect(res.status).toBe(500);
      expect(
        await rows('SELECT user_id FROM tenant_member WHERE id = $1', [formerId]),
        'the member was removed with no record of it',
      ).toEqual([{ user_id: FORMER }]);
    } finally {
      await rows('DROP TRIGGER refuse_the_record ON audit_log');
      await rows('DROP FUNCTION refuse_the_record()');
    }
  });
});
