// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE WAITS FOR ITS OWN DATA TYPE'S CUTOVER (ADR-0032 §5; workplan 0128
 * T5, slice 6, the owner's D8), through the real Express app on Postgres.
 *
 * A migration whose calendars were cut over on their own while its files keep
 * running: a calendar share passes the gate and a file share does not, one row
 * at a time and in the one-go press, which leaves the file share open for the
 * files' own cutover. (The announcement of the shares carried by hand, one wave
 * per data type, is `each-data-type-announced-once.integration.test.ts`'s.)
 *
 * The migration has no target mailbox, so a share that passes the gate is
 * refused next for want of a share API (`no_share_api`): what is under test is
 * the gate, whose own refusal is `not_cut_over`.
 *
 * UUID family: 0128fa00-e29b-41d4-a716-4466554400xx.
 * Runs against Postgres (pnpm test:integration).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { notCutOverReason } from '@openmig/core';

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

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT = '0128fa00-e29b-41d4-a716-446655440001';
const CONNECTION = '0128fa00-e29b-41d4-a716-446655440002';
const MAILBOX = '0128fa00-e29b-41d4-a716-446655440003';
const MAPPING = '0128fa00-e29b-41d4-a716-446655440004';
const CALENDAR_SHARE = '0128fa00-e29b-41d4-a716-446655440011';
const FILE_SHARE = '0128fa00-e29b-41d4-a716-446655440012';
const FOLDER = '0128fa00-e29b-41d4-a716-446655440013';
const IN_FOLDER = '0128fa00-e29b-41d4-a716-446655440014';
const TO_ANNA = { 'anna@example.invalid': 'anna@example.invalid' };

const token = () =>
  jwt.sign(
    { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: `user@${TENANT}.test` },
    process.env.JWT_SECRET!,
  );

describe('a share waits for its own data type’s cutover (managed)', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  const post = (path: string, body: unknown) =>
    request
      .post(`/api/migrations/${MAPPING}/sharing/${path}`)
      .set({ Authorization: `Bearer ${token()}` })
      .send(body as object);

  /** The migration's phases, written as a cutover of one data type leaves them. */
  async function phases(status: string, calendar: string, file: string): Promise<void> {
    await pool.query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
    await pool.query(`UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'calendar'`, [
      MAPPING,
      calendar,
    ]);
    await pool.query(`UPDATE path_lifecycle SET state = $2 WHERE mapping_id = $1 AND domain = 'file'`, [MAPPING, file]);
  }

  /** This file's rows, table by table: a tenant's removal does not reach them all. */
  async function cleanUp(): Promise<void> {
    for (const table of ['share_grant', 'path_lifecycle', 'scope_selection', 'audit_log', 'mailbox_mapping', 'mailbox', 'connection', 'tenant_member']) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT]);
    }
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await cleanUp();
    await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Shares per data type', 'active')`, [TENANT]);
    await seedMembership(pool, TENANT, `user-${TENANT}`);
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'fixture', '{}'::jsonb, 'connected')`,
      [CONNECTION, TENANT],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, 'src', 'a@example.invalid')`,
      [MAILBOX, TENANT, CONNECTION],
    );
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`,
      [MAPPING, TENANT, MAILBOX],
    );
    for (const domain of ['calendar', 'file']) {
      await pool.query(
        `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`,
        [TENANT, MAPPING, domain],
      );
      await pool.query(
        `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [TENANT, MAPPING, domain],
      );
    }
    for (const [id, subject, on, grantee] of [
      [CALENDAR_SHARE, 'calendar', 'Team planning', 'cas@example.invalid'],
      [FILE_SHARE, 'drive_item', 'Projects/budget.xlsx', 'anna@example.invalid'],
    ] as const) {
      await pool.query(
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict, verdict_target)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'read', '{}', 'clean', 'a Nextcloud share')`,
        [id, TENANT, MAPPING, `hash-${subject}`, subject, on, grantee],
      );
    }
    // A shared folder and a file in it, shared with the same person: one folder press.
    for (const [id, on, itemKey, parentKey, container] of [
      [FOLDER, 'Shared/Photos', 'F', 'root', true],
      [IN_FOLDER, 'Shared/Photos/one.jpg', 'c1', 'F', false],
    ] as const) {
      await pool.query(
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict,
           verdict_target, item_key, parent_key, is_container)
         VALUES ($1, $2, $3, $4, 'drive_item', $5, 'anna@example.invalid', 'read', '{}', 'clean', 'a Nextcloud share',
           $6, $7, $8)`,
        [id, TENANT, MAPPING, `hash-${itemKey}`, on, itemKey, parentKey, container],
      );
    }
    request = supertest(app);
  });

  afterAll(async () => {
    await cleanUp();
    await pool.end();
  });

  it('calendars cut over while the files run: the calendar share passes, the file share waits', async () => {
    await phases('active', 'cutover', 'active');

    const calendar = await post(`${CALENDAR_SHARE}/decision`, { action: 'apply' });
    expect(calendar.status).toBe(409);
    expect(calendar.body.error).toBe('no_share_api');

    const file = await post(`${FILE_SHARE}/decision`, { action: 'apply' });
    expect(file.status).toBe(409);
    expect(file.body).toEqual({ error: 'not_cut_over', reason: notCutOverReason(['drive_item']) });

    const press = await post('apply-all', {});
    expect(press.status).toBe(200);
    expect(press.body).toMatchObject({ applied: [], waitingForCutover: 3 });
    expect((press.body.refused as Array<{ id: string; code: string }>).map((r) => [r.id, r.code])).toEqual([
      [CALENDAR_SHARE, 'no_share_api'],
    ]);

    const folder = await post('apply-folder', { parentKey: 'F', confirmed: TO_ANNA });
    expect(folder.status).toBe(409);
    expect(folder.body).toEqual({ error: 'not_cut_over', reason: notCutOverReason(['drive_item']) });

    // Every row stays open: nothing was applied, and the files' shares wait.
    const rows = await pool.query(`SELECT id, state FROM share_grant WHERE mapping_id = $1 ORDER BY id`, [MAPPING]);
    expect(rows.rows).toEqual(
      [CALENDAR_SHARE, FILE_SHARE, FOLDER, IN_FOLDER].map((id) => ({ id, state: 'open' })),
    );
  });

  it('at the files’ own cutover, the file share and the folder press pass the gate', async () => {
    await phases('cutover', 'cutover', 'cutover');
    const file = await post(`${FILE_SHARE}/decision`, { action: 'apply' });
    expect(file.body.error).toBe('no_share_api');
    const folder = await post('apply-folder', { parentKey: 'F', confirmed: TO_ANNA });
    expect(folder.status).toBe(200);
    expect((folder.body.refused as Array<{ code: string }>).map((r) => r.code)).toEqual(['no_share_api', 'no_share_api']);
  });
});
