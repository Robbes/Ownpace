// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT OF MAILBOXES CALLED MIGRATIONS (live 2026-09-12).
 *
 * The Connections page says "N migration(s) use this" under each account, and
 * the number decides whether somebody dares rotate a credential or delete a
 * connection. It counted `mailbox` rows.
 *
 * A mailbox row is created when an account is set up and OUTLIVES every
 * migration that ever used it, so the card claimed a migration for accounts no
 * mapping references. Measured on the owner's deployment:
 *
 *   display_name                       mailbox_rows  real_mappings
 *   Soverin Full                                  1              0   ← said 1
 *   microsoft · rhberentsen@gmail.com              1              0   ← said 1
 *   Dropbox                                        0              0   ← said 0 ✓
 *   jmap (demo target)                             2              1   ← said 2
 *
 * Dropbox was right by accident: it is the newest connection and had no
 * mailbox row yet. The query's own comment described a join to
 * `mailbox_mapping` — "the link is mailbox_mapping → mailbox → connection, so
 * this counts through the mailboxes" — that was not in the SQL. And the field
 * was called `usedByMailboxes` while the label said migrations, so the name
 * admitted what the number really was.
 *
 * **Why a database and not a fake.** The defect was a missing join. A fake
 * answers whatever it is handed; only Postgres can be asked whether a mailbox
 * with no mapping contributes to the count. So the fixture builds exactly the
 * four shapes above, including the one that needs `DISTINCT`.
 */

process.env.JWT_SECRET = 'test-secret-for-connection-usage-tests';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../index.ts')).default;
const { seedMembership } = await import('../__tests__/seed-membership.ts');

const P = '7c460000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;

/** Named for the live shapes they reproduce. */
const NEVER_USED = `${P}a1`; // a mailbox row, no mapping — "Soverin Full"
const NO_MAILBOX = `${P}a2`; // nothing at all — "Dropbox"
const SOURCE_USED = `${P}a3`; // one mapping, as source — "all google2"
const TARGET_TWICE = `${P}a4`; // two mailbox rows, ONE mapping — "jmap (demo target)"
const BOTH_SIDES = `${P}a5`; // one mapping using it on BOTH sides

const token = jwt.sign(
  { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: 'owner@usage.test' },
  process.env.JWT_SECRET,
);

describe('the Connections page counts migrations, not mailboxes', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);

    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, 'Usage', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(owner, TENANT, `user-${TENANT}`, 'owner');

    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $6, 'target', 'soverin',   'Never used',   '{}', 'connected'),
         ($2, $6, 'source', 'dropbox',   'No mailbox',   '{}', 'connected'),
         ($3, $6, 'source', 'google',    'Source used',  '{}', 'connected'),
         ($4, $6, 'target', 'jmap',      'Target twice', '{}', 'connected'),
         ($5, $6, 'source', 'nextcloud', 'Both sides',   '{}', 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [NEVER_USED, NO_MAILBOX, SOURCE_USED, TARGET_TWICE, BOTH_SIDES, TENANT],
    );

    // Mailbox rows. NEVER_USED gets one and no mapping — the live Soverin
    // shape. TARGET_TWICE gets two, only one of which a mapping names.
    const boxes: Array<[string, string]> = [
      [`${P}b1`, NEVER_USED],
      [`${P}b2`, SOURCE_USED],
      [`${P}b3`, TARGET_TWICE],
      [`${P}b4`, TARGET_TWICE],
      [`${P}b5`, BOTH_SIDES],
      [`${P}b6`, BOTH_SIDES],
    ];
    for (const [id, connectionId] of boxes) {
      await owner.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind)
         VALUES ($1, $2, $3, 'box', 'user') ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, connectionId],
      );
    }

    await owner.query(
      `INSERT INTO mailbox_mapping
         (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern, name)
       VALUES
         ($1, $3, $4, $5, 'active', 'mirror', 'shared_s', 'Across accounts'),
         ($2, $3, $6, $7, 'active', 'mirror', 'shared_s', 'Within one account')
       ON CONFLICT (id) DO NOTHING`,
      [
        `${P}d1`,
        `${P}d2`,
        TENANT,
        `${P}b2`, // source: SOURCE_USED
        `${P}b3`, // target: TARGET_TWICE (its OTHER mailbox stays unreferenced)
        `${P}b5`, // source: BOTH_SIDES
        `${P}b6`, // target: BOTH_SIDES again
      ],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await owner.end();
  });

  const counts = async (): Promise<Record<string, number>> => {
    const res = await request.get('/api/connections').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const out: Record<string, number> = {};
    const list = (res.body as { connections: Array<{ displayName: string; usedByMigrations: number }> })
      .connections;
    for (const c of list) out[c.displayName] = c.usedByMigrations;
    return out;
  };

  it('says zero for a connection whose mailbox row outlived every migration', async () => {
    // THE LIVE BUG. One mailbox row, no mapping — the old query said 1.
    expect((await counts())['Never used']).toBe(0);
  });

  it('still says zero for a connection with no mailbox row at all', async () => {
    // Dropbox's case, which the old query got right by accident. It has to
    // keep being right for the new reason.
    expect((await counts())['No mailbox']).toBe(0);
  });

  it('counts the migration that names it on the source side', async () => {
    expect((await counts())['Source used']).toBe(1);
  });

  it('counts migrations, not mailbox rows, when a connection has several', async () => {
    // Two mailbox rows, one mapping. The old query said 2.
    expect((await counts())['Target twice']).toBe(1);
  });

  it('counts a migration that uses one connection on BOTH sides exactly once', async () => {
    // A reorganisation inside one account is one migration. Without DISTINCT
    // the join produces a row per side and this reads 2.
    expect((await counts())['Both sides']).toBe(1);
  });
});
