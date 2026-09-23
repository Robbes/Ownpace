// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE OPERATOR CAN READ (workplan 0129 T2): `support_log`, the view the
 * log page reads, against a real database.
 *
 * One timeline of the audit log and the application's errors and warnings,
 * metadata only. What this file holds the view to:
 *
 *  - both tables arrive, each in the shape of the other: an audit row is
 *    `info` with its actor, an application event has a level, a category and
 *    a reference and no actor;
 *  - the actor is the member's address, not the identity provider's subject,
 *    and a process's own name as it is; anything else is nothing;
 *  - an action that is not a name from code, or a migration id that is not an
 *    id, is never served as it was written;
 *  - `audit_log.detail` cannot be selected, and nothing in it comes out;
 *  - and, like every support view, nobody but an operator sees a row. The
 *    catalog guard in `support-views.unit.test.ts` holds the predicate; this
 *    file asks the view's own questions.
 *
 * UUID family 0e290000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

const TENANT_A = '0e290000-e29b-41d4-a716-446655440001';
const TENANT_B = '0e290000-e29b-41d4-a716-446655440002';
const CONN_A = '0e290000-e29b-41d4-a716-446655440011';
const BOX_A = '0e290000-e29b-41d4-a716-446655440021';
const MAPPING_A = '0e290000-e29b-41d4-a716-446655440031';
const OPERATOR = 'operator-subject-0129';
const NOT_OPERATOR = 'ordinary-subject-0129';

/** In `detail`, which the view does not select. It must not come out anywhere. */
const DETAIL_ADDRESS = 'finance@example.invalid';

let driver: LedgerDriver;

/** Read as `app_user`, as an operator does: a subject, and no tenant. */
async function asSubject<T>(
  subject: string,
  fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
): Promise<T> {
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('BEGIN');
    try {
      await q('SET LOCAL ROLE app_user');
      await q("SELECT set_config('app.current_user', $1, true)", [subject]);
      await q("SELECT set_config('app.current_tenant', '', true)");
      const out = await fn(q as never);
      await q('COMMIT');
      return out;
    } catch (e) {
      await q('ROLLBACK');
      throw e;
    }
  } finally {
    await conn.release();
  }
}

interface Entry {
  id: string;
  source: string;
  level: string;
  tenant_id: string | null;
  tenant_name: string | null;
  mapping_id: string | null;
  migration_name: string | null;
  event: string;
  category: string | null;
  reference: string | null;
  actor: string | null;
}

const log = (subject: string): Promise<Entry[]> =>
  asSubject(subject, async (q) => {
    const r = await q(
      `SELECT id, source, level, tenant_id, tenant_name, mapping_id, migration_name,
              event, category, reference, actor
         FROM public.support_log ORDER BY at DESC, id DESC`,
    );
    return r.rows as Entry[];
  });

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2), ($3,$4)', [
      TENANT_A,
      'Alpha BV',
      TENANT_B,
      'Beta BV',
    ]);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','Alpha mail','{}'::jsonb,'connected','ref')`,
      [CONN_A, TENANT_A],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','someone@example.invalid')`,
      [BOX_A, TENANT_A, CONN_A],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
       VALUES ($1,$2,$3,'active','Alpha migration')`,
      [MAPPING_A, TENANT_A, BOX_A],
    );
    await q(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1,'sub-jan','jan@alpha.invalid','owner','active',now())`,
      [TENANT_A],
    );
    await q('INSERT INTO platform_operator (user_id, email) VALUES ($1,$2)', [
      OPERATOR,
      'operator@example.invalid',
    ]);

    // The audit log, oldest first: a person, a process, a subject that is no
    // member, and a writer that put a sentence where a name belongs.
    const audit = (at: string, actor: string, action: string, detail: unknown) =>
      q(
        `INSERT INTO audit_log (tenant_id, actor, action, entity, detail, at)
         VALUES ($1, $2, $3, 'mapping', $4::jsonb, $5::timestamptz)`,
        [TENANT_A, actor, action, JSON.stringify(detail), at],
      );
    await audit('2026-09-23T10:00:00Z', 'sub-jan', 'mapping.status', {
      mappingId: MAPPING_A,
      from: 'active',
      to: 'paused',
      notifiedAddress: DETAIL_ADDRESS,
    });
    await audit('2026-09-23T10:01:00Z', 'system:digest', 'digest_sent_daily', {
      recipients: [DETAIL_ADDRESS],
    });
    await audit('2026-09-23T10:02:00Z', 'sub-somebody-else', 'mapping.granted', {
      mappingId: 'not-an-id',
    });
    await audit('2026-09-23T10:03:00Z', 'Jan de Vries', 'Moved the Salaris folder for jan', {});

    // The application's own events, newer than all of those.
    await q(
      `INSERT INTO app_event (level, tenant_id, mapping_id, event, category, reference, at)
       VALUES ('error', $1, $2, 'sync.calendar.failed', 'auth_expired', '0a1b2c3d', '2026-09-23T10:04:00Z'),
              ('warn', $3, NULL, 'sync.email.keys-unreadable', NULL, '1b2c3d4e', '2026-09-23T10:05:00Z'),
              ('error', NULL, NULL, 'api.list_failed', NULL, '2c3d4e5f', '2026-09-23T10:06:00Z')`,
      [TENANT_A, MAPPING_A, TENANT_B],
    );
  } finally {
    await conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('one timeline of the audit log and the application events', () => {
  it('serves both, newest first, each in the shape of the other', async () => {
    const entries = await log(OPERATOR);

    expect(entries.map((e) => [e.source, e.level, e.event])).toEqual([
      ['app', 'error', 'api.list_failed'],
      ['app', 'warn', 'sync.email.keys-unreadable'],
      ['app', 'error', 'sync.calendar.failed'],
      ['audit', 'info', 'audit.unnamed'],
      ['audit', 'info', 'mapping.granted'],
      ['audit', 'info', 'digest_sent_daily'],
      ['audit', 'info', 'mapping.status'],
    ]);
  });

  it('names the customer and the migration, and carries the category and reference', async () => {
    const failed = (await log(OPERATOR)).find((e) => e.event === 'sync.calendar.failed');

    expect(failed).toMatchObject({
      tenant_id: TENANT_A,
      tenant_name: 'Alpha BV',
      mapping_id: MAPPING_A,
      migration_name: 'Alpha migration',
      category: 'auth_expired',
      reference: '0a1b2c3d',
      actor: null,
    });
  });

  it('keeps an event that belongs to no customer', async () => {
    const unowned = (await log(OPERATOR)).find((e) => e.event === 'api.list_failed');

    expect(unowned).toMatchObject({ tenant_id: null, tenant_name: null, mapping_id: null });
  });
});

describe('who acted, on an audit row', () => {
  it("is the member's address, where the subject is a member", async () => {
    const paused = (await log(OPERATOR)).find((e) => e.event === 'mapping.status');

    expect(paused?.actor).toBe('jan@alpha.invalid');
  });

  it("is the process's own name, and a subject the organisation has no member for", async () => {
    const entries = await log(OPERATOR);

    expect(entries.find((e) => e.event === 'digest_sent_daily')?.actor).toBe('system:digest');
    expect(entries.find((e) => e.event === 'mapping.granted')?.actor).toBe('sub-somebody-else');
  });

  it('is nothing, when a writer put a name with spaces where an identifier belongs', async () => {
    const unnamed = (await log(OPERATOR)).find((e) => e.event === 'audit.unnamed');

    expect(unnamed?.actor).toBeNull();
  });
});

describe('what the view will not serve as written', () => {
  it('a sentence where an action name belongs, which comes out as audit.unnamed', async () => {
    const body = JSON.stringify(await log(OPERATOR));

    expect(body).not.toContain('Salaris');
    expect(body).not.toContain('Jan de Vries');
  });

  it('a migration id that is not an id, which comes out as no migration', async () => {
    const granted = (await log(OPERATOR)).find((e) => e.event === 'mapping.granted');

    expect(granted?.mapping_id).toBeNull();
  });

  it('the audit detail, which cannot be selected and does not come out', async () => {
    await expect(
      asSubject(OPERATOR, (q) => q('SELECT detail FROM public.support_log')),
    ).rejects.toThrow();
    expect(JSON.stringify(await log(OPERATOR))).not.toContain(DETAIL_ADDRESS);
  });
});

describe('a page of it does not sort the whole audit log', () => {
  it('because the audit log has an index by time, as the application events have', async () => {
    // The default page is newest first across every customer, and the audit
    // log is never pruned. Without an index on `at` alone, every page would
    // sort the table first (ledger migration 0060).
    const conn = await driver.acquire();
    try {
      const r = await conn.query(
        `SELECT tablename, indexdef FROM pg_indexes
          WHERE tablename IN ('audit_log', 'app_event') AND indexdef ~ '\\(at( DESC)?\\)$'`,
      );
      const byTable = (r.rows as Array<{ tablename: string }>).map((row) => row.tablename).sort();
      expect(byTable).toEqual(['app_event', 'audit_log']);
    } finally {
      await conn.release();
    }
  });
});

describe('nobody but an operator', () => {
  it('sees a row', async () => {
    expect(await log(NOT_OPERATOR)).toEqual([]);
    expect(await log('')).toEqual([]);
  });
});
