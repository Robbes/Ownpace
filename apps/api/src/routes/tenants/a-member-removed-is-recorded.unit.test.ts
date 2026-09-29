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
 * - the action is spelled as `operator.sh leave` spells it, and the statement
 *   the strays duty sends finds the subject on the owner's connection, as the
 *   script reads it; as `app_user`, row security shows one organisation's
 *   rows at a time, which is why the script reads as the owner;
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
