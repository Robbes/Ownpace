// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KIND ADDED TO A RUNNING MIGRATION (workplan 0125 T6, 2026-09-23).
 *
 * The owner reconnected his Google account with Tasks ticked, and his running
 * migration had no way to take them: its kinds were written once, at
 * creation, and a second migration between the same two accounts is refused.
 * `POST /api/migrations/:id/domains` is that way, and the migration page
 * offers exactly what it accepts.
 *
 * **Why a database and not a fake.** What this route promises is three rows
 * moving together: the kind included, the migration's `updated_at` (which the
 * next preflight keys on), and, for a running migration, the new path's slot
 * and only that one. A fake would agree with whatever it was told.
 */

process.env.JWT_SECRET = 'test-secret-for-adding-a-kind';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { KIND_AFTER_CUTOVER_REFUSAL } from '@openmig/shared';

// Importing the app pulls in the sync routes, which build a Trigger client.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** app_user, so the route runs under RLS as it does in production. */
const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../../index.ts')).default;
const { seedMembership } = await import('../../__tests__/seed-membership.ts');

const P = '7add0000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const GOOGLE = `${P}a1`;
const GOOGLE_WITHOUT_TASKS = `${P}a2`;
const NEXTCLOUD = `${P}e1`;
const BOX = { active: `${P}b1`, paused: `${P}b2`, done: `${P}b3`, withoutTasks: `${P}b4` };
const NC_BOX = { active: `${P}c1`, paused: `${P}c2`, done: `${P}c3`, withoutTasks: `${P}c4` };
const MAPPING = { active: `${P}d1`, paused: `${P}d2`, done: `${P}d3`, withoutTasks: `${P}d4` };
const NOBODY = `${P}ff`;

/** When the seeded rows were last touched: long enough ago to see a move. */
const LONG_AGO = '2026-01-01T00:00:00.000Z';

const token = jwt.sign(
  { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: 'owner@adding-a-kind.test' },
  process.env.JWT_SECRET,
);

describe('a kind added to a running migration', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);

    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, 'Adding a kind', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(owner, TENANT, `user-${TENANT}`, 'owner');

    // Two Google accounts: one never measured, and one whose last Test found
    // a grant without Tasks, in the words the Test stores.
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, qualification) VALUES
         ($1, $4, 'source', 'google',    'Google',               '{}', 'connected', NULL),
         ($2, $4, 'source', 'google',    'Google without Tasks', '{}', 'connected', $5::jsonb),
         ($3, $4, 'target', 'nextcloud', 'Nextcloud',            '{}', 'connected', NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        GOOGLE,
        GOOGLE_WITHOUT_TASKS,
        NEXTCLOUD,
        TENANT,
        JSON.stringify({
          domains: { task: { answer: 'no', detail: 'The grant does not include tasks.readonly.' } },
        }),
      ],
    );

    // One mailbox pair per migration: two migrations between the same pair
    // must differ in their folder (migration 0022), and these do not.
    const pairs: Array<[string, string, string, string]> = [
      [BOX.active, GOOGLE, NC_BOX.active, 'active'],
      [BOX.paused, GOOGLE, NC_BOX.paused, 'paused'],
      [BOX.done, GOOGLE, NC_BOX.done, 'done'],
      [BOX.withoutTasks, GOOGLE_WITHOUT_TASKS, NC_BOX.withoutTasks, 'withoutTasks'],
    ];
    for (const [sourceBox, sourceConn, targetBox, label] of pairs) {
      await owner.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
           ($1, $3, $4, $5, 'user'), ($2, $3, $6, $7, 'user')
         ON CONFLICT (id) DO NOTHING`,
        [sourceBox, targetBox, TENANT, sourceConn, `${label} source`, NEXTCLOUD, `${label} target`],
      );
    }

    const mappings: Array<[string, string, string, string]> = [
      [MAPPING.active, BOX.active, NC_BOX.active, 'active'],
      [MAPPING.paused, BOX.paused, NC_BOX.paused, 'paused'],
      [MAPPING.done, BOX.done, NC_BOX.done, 'done'],
      [MAPPING.withoutTasks, BOX.withoutTasks, NC_BOX.withoutTasks, 'active'],
    ];
    for (const [id, sourceBox, targetBox, status] of mappings) {
      await owner.query(
        `INSERT INTO mailbox_mapping
           (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern, name, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'mirror', 'shared_s', $7, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, sourceBox, targetBox, status, LONG_AGO, `A ${status} migration`],
      );
    }

    await owner.query(
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
         ($1, $2, 'calendar', true), ($1, $2, 'contact', true),
         ($1, $3, 'calendar', true), ($1, $4, 'calendar', true), ($1, $5, 'calendar', true)
       ON CONFLICT DO NOTHING`,
      [TENANT, MAPPING.active, MAPPING.paused, MAPPING.done, MAPPING.withoutTasks],
    );

    // The running migration's paths hold their slots from long ago.
    await owner.query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, updated_at) VALUES
         ($1, $2, 'calendar', 'active', $3, $3), ($1, $2, 'contact', 'active', $3, $3)
       ON CONFLICT DO NOTHING`,
      [TENANT, MAPPING.active, LONG_AGO],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await owner.end();
  });

  const detail = async (id: string) => {
    const res = await request.get(`/api/migrations/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as {
      syncConfig: { domains: string[] };
      kindChoices: Array<{ domain: string; state: string; reason?: string }>;
    };
  };
  const add = (id: string, body: unknown) =>
    request.post(`/api/migrations/${id}/domains`).set('Authorization', `Bearer ${token}`).send(body as object);
  const pathOf = async (id: string, domain: string) =>
    (
      await owner.query(
        `SELECT state, first_activated_at, updated_at FROM path_lifecycle WHERE mapping_id = $1 AND domain = $2`,
        [id, domain],
      )
    ).rows[0] as { state: string; first_activated_at: Date | null; updated_at: Date } | undefined;
  const scopeOf = async (id: string) =>
    (
      await owner.query(
        `SELECT domain FROM scope_selection WHERE mapping_id = $1 AND included ORDER BY domain`,
        [id],
      )
    ).rows.map((r: { domain: string }) => r.domain);
  const updatedAtOf = async (id: string) =>
    ((await owner.query(`SELECT updated_at FROM mailbox_mapping WHERE id = $1`, [id])).rows[0] as {
      updated_at: Date;
    }).updated_at;

  it('the page offers Tasks, and the route adds exactly that', async () => {
    const before = await detail(MAPPING.active);
    expect(before.kindChoices).toEqual([
      { domain: 'calendar', state: 'on' },
      { domain: 'contact', state: 'on' },
      { domain: 'task', state: 'addable' },
    ]);

    const res = await add(MAPPING.active, { domain: 'task' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: MAPPING.active,
      added: 'task',
      domains: ['calendar', 'contact', 'task'],
    });

    expect(await scopeOf(MAPPING.active)).toEqual(['calendar', 'contact', 'task']);
    const after = await detail(MAPPING.active);
    expect(after.syncConfig.domains).toContain('task');
    expect(after.kindChoices.find((c) => c.domain === 'task')).toEqual({ domain: 'task', state: 'on' });
  });

  it("a running migration's new path takes its slot, and no other path moves", async () => {
    const task = await pathOf(MAPPING.active, 'task');
    expect(task?.state).toBe('active');
    expect(task?.first_activated_at).not.toBeNull();

    // The paths that were already running keep their dates to the second:
    // re-activating them would have been harmless here and wrong for a path
    // whose state had moved on from the migration's.
    for (const domain of ['calendar', 'contact']) {
      const path = await pathOf(MAPPING.active, domain);
      expect(path?.first_activated_at?.toISOString()).toBe(LONG_AGO);
      expect(path?.updated_at.toISOString()).toBe(LONG_AGO);
    }
  });

  it('moves the migration’s updated_at, so the next preflight counts afresh', async () => {
    expect((await updatedAtOf(MAPPING.active)).toISOString()).not.toBe(LONG_AGO);
  });

  it('a paused migration takes the kind, and its slot waits for the next start', async () => {
    const res = await add(MAPPING.paused, { domain: 'task' });
    expect(res.status).toBe(200);
    expect(await scopeOf(MAPPING.paused)).toEqual(['calendar', 'task']);
    expect(await pathOf(MAPPING.paused, 'task')).toBeUndefined();
  });

  it('records who added which data type (0128 T4)', async () => {
    const recorded = (
      await owner.query(
        `SELECT actor, detail FROM audit_log WHERE action = 'path.added' AND detail ->> 'mappingId' = ANY($1) ORDER BY at`,
        [[MAPPING.active, MAPPING.paused]],
      )
    ).rows as Array<{ actor: string; detail: Record<string, unknown> }>;
    expect(recorded.map((r) => r.detail)).toEqual([
      { mappingId: MAPPING.active, domain: 'task' },
      { mappingId: MAPPING.paused, domain: 'task' },
    ]);
    expect(recorded.every((r) => r.actor !== 'unknown' && r.actor.length > 0)).toBe(true);
  });

  it('refuses after cutover, in the words the page shows', async () => {
    const choices = (await detail(MAPPING.done)).kindChoices;
    expect(choices.find((c) => c.domain === 'task')).toEqual({
      domain: 'task',
      state: 'refused',
      reason: KIND_AFTER_CUTOVER_REFUSAL,
    });

    const res = await add(MAPPING.done, { domain: 'task' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'kind_refused', reason: KIND_AFTER_CUTOVER_REFUSAL });
    expect(await scopeOf(MAPPING.done)).toEqual(['calendar']);
    expect((await updatedAtOf(MAPPING.done)).toISOString()).toBe(LONG_AGO);
  });

  it('refuses a kind the account measured it cannot carry, and says what the Test found', async () => {
    const res = await add(MAPPING.withoutTasks, { domain: 'task' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('kind_refused');
    expect(res.body.reason).toContain('The grant does not include tasks.readonly.');
    expect(await scopeOf(MAPPING.withoutTasks)).toEqual(['calendar']);
  });

  it('refuses what is already there, and what the source cannot provide', async () => {
    const already = await add(MAPPING.active, { domain: 'calendar' });
    expect(already.status).toBe(409);
    expect(already.body.reason).toBe("'calendar' is already part of this migration.");

    const mail = await add(MAPPING.active, { domain: 'email' });
    expect(mail.status).toBe(409);
    expect(mail.body.reason).toMatch(/source cannot provide 'email'/);
  });

  it('answers a body that names no kind, and a migration that is not there', async () => {
    const bad = await add(MAPPING.active, { domain: 'mail' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_body');

    const missing = await add(NOBODY, { domain: 'task' });
    expect(missing.status).toBe(404);
  });
});
