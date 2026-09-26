// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ANNOUNCEMENT OF THE SHARES CARRIED BY HAND, ONE WAVE PER DATA TYPE
 * (workplan 0104 T3; 0128 T5, slice 6, the owner's D8), through the real
 * Express app on Postgres.
 *
 * A migration whose calendars were cut over on their own while its files keep
 * running: the press announces the calendars' shares carried by hand and
 * leaves the files', counted, for the press at their cutover; each data type
 * is announced once, and mailed again only on purpose.
 *
 * The mail channel is on, and its transport is this file's: what is under test
 * is who is told what, and when.
 *
 * UUID family: 0128fd00-e29b-41d4-a716-4466554400xx.
 * Runs against Postgres (pnpm test:integration).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { notCutOverToAnnounceReason } from '@openmig/core';

/** Every mail the channel was handed. */
const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

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
import { __setChannelForTests } from '../../access-notify.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT = '0128fd00-e29b-41d4-a716-446655440001';
const CONNECTION = '0128fd00-e29b-41d4-a716-446655440002';
const MAILBOX = '0128fd00-e29b-41d4-a716-446655440003';
const MAPPING = '0128fd00-e29b-41d4-a716-446655440004';
const NOTE = 'It all lives on the new server now.';

const token = () =>
  jwt.sign(
    { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: `user@${TENANT}.test` },
    process.env.JWT_SECRET!,
  );

describe('each data type’s shares carried by hand, announced once, at its own cutover (managed)', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  const announce = (body: Record<string, unknown> = {}) =>
    request
      .post(`/api/migrations/${MAPPING}/sharing/announce`)
      .set({ Authorization: `Bearer ${token()}` })
      .send({ note: NOTE, ...body });

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
    await pool.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Announced per data type', 'active')`, [TENANT]);
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
    // Carried over by hand: a calendar and a file to one person, a file to another.
    for (const [n, subject, on, grantee] of [
      [11, 'calendar', 'Team planning', 'cas@example.invalid'],
      [12, 'drive_item', 'Projects/budget.xlsx', 'cas@example.invalid'],
      [13, 'drive_item', 'Projects/plan.odt', 'anna@example.invalid'],
    ] as const) {
      await pool.query(
        `INSERT INTO share_grant (id, tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict,
           verdict_target, state, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'read', '{}', 'clean', 'a Nextcloud share', 'done_manual', 'owner', now())`,
        [`0128fd00-e29b-41d4-a716-4466554400${n}`, TENANT, MAPPING, `hash-${n}`, subject, on, grantee],
      );
    }
    __setChannelForTests({
      notifier: { notify: async () => {} },
      locale: 'en',
      announcement: '',
      config: {
        enabled: true,
        smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
        settings: { from: 'ownpace@example.invalid', to: ['ops@example.invalid'] },
      },
    } as unknown as Parameters<typeof __setChannelForTests>[0]);
    request = supertest(app);
  });

  afterAll(async () => {
    __setChannelForTests(null);
    await cleanUp();
    await pool.end();
  });

  it('nothing cut over: refused, naming both data types; nothing is sent', async () => {
    const early = await announce();
    expect(early.status).toBe(409);
    expect(early.body).toEqual({ error: 'not_cut_over', reason: notCutOverToAnnounceReason(['calendar', 'drive_item']) });
    expect(SENT).toEqual([]);
  });

  it('the calendars’ wave, then the files’, each once; mailed again only on purpose', async () => {
    await phases('active', 'cutover', 'active');
    const calendars = await announce();
    expect(calendars.status).toBe(200);
    expect(calendars.body).toMatchObject({ sent: ['cas@example.invalid'], waitingForCutover: 2, alreadyAnnounced: 0 });
    expect(SENT.map((m) => [m.to, m.body.includes('Team planning'), m.body.includes('budget')])).toEqual([
      [['cas@example.invalid'], true, false],
    ]);

    const again = await announce();
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_announced');

    await phases('cutover', 'cutover', 'cutover');
    SENT.length = 0;
    const files = await announce();
    expect(files.status).toBe(200);
    expect(files.body).toMatchObject({
      sent: ['anna@example.invalid', 'cas@example.invalid'],
      waitingForCutover: 0,
      alreadyAnnounced: 1,
      resend: false,
    });
    expect(SENT.every((m) => !m.body.includes('Team planning'))).toBe(true);

    const refused = await announce();
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('already_announced');

    SENT.length = 0;
    const resent = await announce({ confirmResend: true });
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ resend: true, sent: ['anna@example.invalid', 'cas@example.invalid'] });
    expect(SENT).toHaveLength(2);

    const audit = await pool.query(
      `SELECT detail FROM audit_log WHERE tenant_id = $1 AND action = 'share.announce' ORDER BY at`,
      [TENANT],
    );
    expect(audit.rows.map((r) => [...(r.detail.subjects as string[])].sort())).toEqual([
      ['calendar'],
      ['drive_item'],
      ['calendar', 'drive_item'],
    ]);
  });
});
