// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A purge that cannot be proven did not happen (workplan 0085 T7).
 *
 * The assertions that matter here are the ones about what SURVIVES. A purge is
 * easy to write slightly too wide, and the cost is not a slow query — it is a
 * customer's billing history, which the previous implementation destroyed with
 * a single `DELETE FROM tenant` and twenty-five cascading foreign keys.
 *
 * So this seeds a tenant across every table the purge names, erases it, and
 * checks **table by table**: named, not counted, for the same reason 0081's
 * guard names each stray 500 — a count tells the next person a number is wrong
 * and not which row survived.
 *
 * Real Postgres via PGlite, because the whole subject is foreign keys, cascade
 * behaviour and a `UPDATE … RETURNING` that has to run before a `DELETE`.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from '@openmig/ledger';
import { runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  closeTenant,
  reopenTenant,
  purgeTenant,
  tenantRef,
  PURGED_TABLES,
  RETAINED_TABLES,
  CLOSE_WINDOWS_DAYS,
  isCloseWindow,
} from './offboarding.ts';
import type { LedgerDriver, LedgerConnection } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';

// UUID family 5abb0000-…, unused elsewhere in the repo.
const LEAVING = '5abb0000-e29b-41d4-a716-446655441801';
const STAYING = '5abb0000-e29b-41d4-a716-446655441802';
const CONN = '5abb0000-e29b-41d4-a716-446655441811';
const SRC = '5abb0000-e29b-41d4-a716-446655441821';
const DST = '5abb0000-e29b-41d4-a716-446655441822';
const MAPPING = '5abb0000-e29b-41d4-a716-446655441831';
// The staying tenant's own ids. Spelled out rather than derived from the ones
// above by string surgery: the first attempt did `slice(0, -1) + '9'`, which
// mapped two DIFFERENT mailboxes onto one id and failed on a primary key.
const CONN2 = '5abb0000-e29b-41d4-a716-446655441911';
const SRC2 = '5abb0000-e29b-41d4-a716-446655441921';
const DST2 = '5abb0000-e29b-41d4-a716-446655441922';
const MAPPING2 = '5abb0000-e29b-41d4-a716-446655441931';

const NOW = new Date('2026-08-18T12:00:00.000Z');

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;

async function count(table: string, where = ''): Promise<number> {
  const { rows } = await conn.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} ${where}`,
  );
  return Number(rows[0]?.n ?? '0');
}

/** Seed one tenant with a row in every table the purge is responsible for. */
async function seed(tenantId: string, suffix: string): Promise<void> {
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active')`, [
    tenantId,
    `acme ${suffix}`,
  ]);
  const leaving = tenantId === LEAVING;
  const connId = leaving ? CONN : CONN2;
  const src = leaving ? SRC : SRC2;
  const dst = leaving ? DST : DST2;
  const map = leaving ? MAPPING : MAPPING2;
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name)
     VALUES ($1, $2, 'source', 'imap', 'fixture')`,
    [connId, tenantId],
  );
  for (const [id, ext] of [[src, 's'], [dst, 't']] as const) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1, $2, $3, $4)`,
      [id, tenantId, connId, ext],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [map, tenantId, src, dst],
  );
  await conn.query(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash)
     VALUES ($1, $2, 'email', 'INBOX', 'k', 'h')`,
    [tenantId, map],
  );
  await conn.query(
    `INSERT INTO audit_log (tenant_id, actor, action) VALUES ($1, 'someone', 'did.a.thing')`,
    [tenantId],
  );
  await conn.query(
    `INSERT INTO usage_metric (tenant_id, period_start, period_end, metric_type, resource, quantity, unit)
     VALUES ($1, '2026-08-01', '2026-08-31', 'storage', 'gb', 1, 'gb')`,
    [tenantId],
  );
  await conn.query(
    `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total)
     VALUES ($1, '2026-08-01', '2026-08-31', 'paid', '100', '0.21', '21', '121')`,
    [tenantId],
  );
  await conn.query(
    `INSERT INTO rate_budget (tenant_id, provider, tokens) VALUES ($1, 'graph', 5)`,
    [tenantId],
  );
  // An agreed price list. `tenant_closure` is seeded by `closeTenant` in each
  // case rather than here, since closing is what creates it — but this one has
  // no other writer in the fixture, and an unseeded table makes the "empties
  // every table it names" assertion pass without testing anything.
  await conn.query(
    `INSERT INTO tenant_pricing (tenant_id, pricing) VALUES ($1, '{"baseFee": 999}'::jsonb)`,
    [tenantId],
  );
  // Seeded because the purge names them: without a row, "it was deleted" is a
  // vacuous truth and the assertion proves nothing.
  await conn.query(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
     VALUES ($1, $2, $3, 'owner', 'active')`,
    [tenantId, `sub-${suffix}`, `owner-${suffix}@example.test`],
  );
  // The buyer (workplan 0111 T1) — a consumer, deliberately, since that is the
  // default shape. The NAME differs from the tenant's display name on purpose:
  // the detach test below has to be able to tell which one was stamped.
  await conn.query(
    `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
     VALUES ($1, 'consumer', $2, 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
    [tenantId, `Piet ${suffix}`],
  );
  // A VIES consultation (0111 T2). Seeded even though the buyer above is a
  // consumer — the log outlives kind switches by design, and an unseeded
  // purged table makes its "was deleted" assertion vacuous.
  await conn.query(
    `INSERT INTO vat_consultation (tenant_id, country_code, vat_number, valid, consultation_number)
     VALUES ($1, 'NL', '123456789B01', true, $2)`,
    [tenantId, `WAPI-${suffix}`],
  );
  await conn.query(
    `INSERT INTO payment_method (tenant_id, mollie_id, type)
     VALUES ($1, $2, 'creditcard')`,
    [tenantId, `mandate-${suffix}`],
  );
  // The GRANTED request that created this tenant. Every managed customer has
  // one — the service is invite-only, so the queue is the only front door —
  // and migration 0007 gave the row an ON DELETE RESTRICT foreign key to
  // `tenant` on purpose. Absent from this fixture, the purge deleted a tenant
  // nothing pointed at, which is not the shape any real tenant has.
  await conn.query(
    `INSERT INTO access_request
       (email, name, organisation, state, tenant_id, decided_by, decided_at)
     VALUES ($1, $2, $3, 'granted', $4, 'operator@ownpace.eu', now())`,
    [`asker-${suffix}@example.test`, `Asker ${suffix}`, `Org ${suffix}`, tenantId],
  );
  // A verification RUN, whose parent `verification` the purge already names.
  await conn.query(
    `INSERT INTO verification_run (tenant_id, mapping_id, state) VALUES ($1, $2, 'running')`,
    [tenantId, map],
  );
}

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: `invoice`, `tenant_member`, `erasure_record`,
  // `tenant_pricing` and `tenant_closure` are all in it (ADR-0036), and the
  // purge under test is the thing that reads and empties them.
  await runManagedMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM erasure_record');
  await conn.query('DELETE FROM invoice');
  for (const t of PURGED_TABLES) await conn.query(`DELETE FROM ${t}`);
  await conn.query('DELETE FROM tenant');
  await seed(LEAVING, 'leaving');
  await seed(STAYING, 'staying');
});

describe('closing a tenant', () => {
  it('stops the service without deleting anything', async () => {
    const result = await closeTenant(db, LEAVING, 30, 'owner@acme.example', NOW);
    expect(result.windowDays).toBe(30);

    // The status is on `tenant` and the dates are in `tenant_closure`
    // (ADR-0036). Both halves are asserted: a close that wrote one and not the
    // other is the state the purge job's `status = 'closed'` guard exists for,
    // and a test that read only one would not see it.
    const { rows } = await conn.query<{ status: string; purge_after: Date | null }>(
      `SELECT t.status, c.purge_after
         FROM tenant t LEFT JOIN tenant_closure c ON c.tenant_id = t.id
        WHERE t.id = $1`,
      [LEAVING],
    );
    expect(rows[0]?.status).toBe('closed');
    expect(rows[0]?.purge_after).not.toBeNull();
    // Closed is not deleted: everything is still here, which is what makes the
    // window worth having.
    expect(await count('item')).toBe(2);
    expect(await count('erasure_record')).toBe(1);
  });

  it('records the request even if the purge never runs', async () => {
    // The signal that something owed did not happen. A record written only at
    // purge time would leave a broken job looking like no request was ever made.
    await closeTenant(db, LEAVING, 90, 'owner@acme.example', NOW);
    const { rows } = await conn.query<{ tenant_ref: string; purged_at: Date | null }>(
      `SELECT tenant_ref, purged_at FROM erasure_record`,
    );
    expect(rows[0]?.purged_at).toBeNull();
    expect(rows[0]?.tenant_ref).toBe(tenantRef(LEAVING));
    // Never the id itself.
    expect(rows[0]?.tenant_ref).not.toContain(LEAVING);
  });

  it('can be undone while the window is open, and not after', async () => {
    await closeTenant(db, LEAVING, 30, 'owner@acme.example', NOW);
    await reopenTenant(db, LEAVING, NOW);
    const { rows } = await conn.query<{ status: string }>(
      `SELECT status FROM tenant WHERE id = $1`,
      [LEAVING],
    );
    expect(rows[0]?.status).toBe('active');

    // An immediate close has no window, so there is nothing to come back to.
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await expect(reopenTenant(db, LEAVING, NOW)).rejects.toThrow(/window has already passed/);
  });

  it('records the backup promise, both the number and the date it produced', async () => {
    // T5. `purged_at` is when the rows left the LIVE database; every backup
    // taken before that still contains them. A record that offers no second
    // date invites everyone reading it to assume erasure finished on the first.
    //
    // The NUMBER is stored as well as the date because retention can change
    // and the date the customer was given cannot — without it, nobody can say
    // how the promise was arrived at.
    const result = await closeTenant(db, LEAVING, 30, 'owner@acme.example', NOW, 7);

    const { rows } = await conn.query<{
      backup_retention_days: number | null;
      backups_expire_at: Date | null;
      purge_after_from_tenant: Date;
    }>(
      `SELECT e.backup_retention_days, e.backups_expire_at, c.purge_after AS purge_after_from_tenant
         FROM erasure_record e, tenant_closure c WHERE c.tenant_id = $1`,
      [LEAVING],
    );
    expect(rows[0]?.backup_retention_days).toBe(7);

    // Seven days AFTER the purge, not after the close: the last backup that
    // can contain anything is taken the moment before the purge.
    const purge = new Date(rows[0]!.purge_after_from_tenant).getTime();
    expect(new Date(rows[0]!.backups_expire_at!).getTime() - purge).toBe(7 * 24 * 60 * 60 * 1000);
    expect(result.backupsExpireAt.getTime()).toBe(new Date(rows[0]!.backups_expire_at!).getTime());
  });

  it('a deployment that keeps no backups records that, rather than nothing', async () => {
    // 0 is a real answer, and it must be distinguishable from "nobody said" —
    // which is what NULL means on rows written before this existed.
    await closeTenant(db, LEAVING, 7, 'owner@acme.example', NOW, 0);

    const { rows } = await conn.query<{
      backup_retention_days: number | null;
      backups_expire_at: Date | null;
    }>(`SELECT backup_retention_days, backups_expire_at FROM erasure_record`);
    expect(rows[0]?.backup_retention_days).toBe(0);
    expect(rows[0]?.backups_expire_at).not.toBeNull();
  });

  it('offers exactly the windows the owner chose', () => {
    expect([...CLOSE_WINDOWS_DAYS]).toEqual([0, 7, 30, 90]);
    expect(isCloseWindow(30)).toBe(true);
    expect(isCloseWindow(45)).toBe(false);
    expect(isCloseWindow('30')).toBe(false);
  });
});

describe('purging a tenant', () => {
  it('records what happened to each credential, including what could not be revoked', async () => {
    // T4a. The receipt has to carry the failures, because `failed` and
    // `unsupported` are the customer's cue to go and withdraw the access
    // themselves — and a record that only kept the successes would lose it.
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW, 7);
    await purgeTenant(db, LEAVING, NOW, [
      { kind: 'gmail', status: 'revoked' },
      { kind: 'o365', status: 'unsupported', reason: 'Microsoft publishes no revocation endpoint.' },
      { kind: 'imap', status: 'no_credential' },
    ]);

    const { rows } = await conn.query<{ revocations: unknown }>(
      `SELECT revocations FROM erasure_record WHERE tenant_ref = $1`,
      [tenantRef(LEAVING)],
    );
    const recorded = rows[0]!.revocations as Array<{ kind: string; status: string; reason?: string }>;

    expect(recorded.map((r) => `${r.kind}:${r.status}`)).toEqual([
      'gmail:revoked',
      'o365:unsupported',
      'imap:no_credential',
    ]);
    // The reason survives, because "we could not" without "why" is not a record.
    expect(recorded[1]!.reason).toMatch(/no revocation endpoint/i);
  });

  it('a purge with no revocation attempt records that, rather than an empty success', async () => {
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW, 7);
    const result = await purgeTenant(db, LEAVING, NOW);
    expect(result.revocations).toEqual([]);
  });

  it('empties every table it names, for that tenant only', async () => {
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await purgeTenant(db, LEAVING, NOW);

    // Named, not counted. A survivor has to be identifiable.
    const survivors: string[] = [];
    for (const table of PURGED_TABLES) {
      if ((await count(table, `WHERE tenant_id = '${LEAVING}'`)) > 0) survivors.push(table);
    }
    expect(survivors).toEqual([]);
    expect(await count('tenant', `WHERE id = '${LEAVING}'`)).toBe(0);
  });

  it('leaves the OTHER tenant completely untouched', async () => {
    // Snapshot and compare, rather than asserting every table HAS a row for the
    // staying tenant. The first version did the latter and failed on tables the
    // fixture happened not to seed — measuring the fixture, not the purge. This
    // way a table nobody thought to seed still cannot be silently harmed.
    const before: Record<string, number> = {};
    for (const table of PURGED_TABLES) {
      before[table] = await count(table, `WHERE tenant_id = '${STAYING}'`);
    }

    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await purgeTenant(db, LEAVING, NOW);

    const harmed: string[] = [];
    for (const table of PURGED_TABLES) {
      const after = await count(table, `WHERE tenant_id = '${STAYING}'`);
      if (after !== before[table]) harmed.push(`${table}: ${before[table]} -> ${after}`);
    }
    expect(harmed).toEqual([]);
    expect(await count('tenant', `WHERE id = '${STAYING}'`)).toBe(1);
    // And the staying tenant's invoice is still ATTACHED — the detach must be
    // scoped to the tenant being erased.
    expect(await count('invoice', `WHERE tenant_id = '${STAYING}'`)).toBe(1);
  });

  it('KEEPS the invoices, detached, still saying who they billed', async () => {
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await purgeTenant(db, LEAVING, NOW);

    // The BUYER's name (billing_party, 0111 T1), not the tenant's display
    // label 'acme leaving': the label is what somebody typed for a workspace;
    // the buyer is who the invoice was for.
    const { rows } = await conn.query<{ tenant_id: string | null; billed_to_name: string; total: string }>(
      `SELECT tenant_id, billed_to_name, total FROM invoice WHERE billed_to_name = 'Piet leaving'`,
    );
    expect(rows).toHaveLength(1);
    // Detached — no link back to a tenant that no longer exists.
    expect(rows[0]?.tenant_id).toBeNull();
    // And still able to say who it was for, which is the whole point of
    // capturing the name rather than only dropping the foreign key.
    expect(rows[0]?.billed_to_name).toBe('Piet leaving');
    expect(rows[0]?.total).toBe('121');
  });

  it('falls back to the tenant name when no buyer details were ever provided', async () => {
    // billing_party is optional until T4 refuses to invoice without it, so the
    // detach has to survive its absence — an approximate name on a retained
    // invoice beats an invoice that says nobody. Removed as the OWNER: the
    // request path holds no DELETE on billing_party, and this is exactly the
    // out-of-band state (a tenant that never filled the form in) being staged.
    await conn.query(`DELETE FROM billing_party WHERE tenant_id = $1`, [LEAVING]);
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await purgeTenant(db, LEAVING, NOW);

    const { rows } = await conn.query<{ billed_to_name: string | null }>(
      `SELECT billed_to_name FROM invoice WHERE tenant_id IS NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.billed_to_name).toBe('acme leaving');
  });

  it('writes a receipt naming what it removed and what it kept', async () => {
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    const result = await purgeTenant(db, LEAVING, NOW);

    const { rows } = await conn.query<{
      purged_at: Date;
      purged_counts: Record<string, number>;
      retained_invoice_ids: string[];
    }>(`SELECT purged_at, purged_counts, retained_invoice_ids FROM erasure_record`);
    expect(rows[0]?.purged_at).toBeInstanceOf(Date);
    expect(rows[0]?.purged_counts?.item).toBe(1);
    expect(rows[0]?.retained_invoice_ids).toHaveLength(1);
    expect(result.retainedInvoiceIds).toHaveLength(1);
  });

  it('erases a tenant that has the rows a REAL tenant has', async () => {
    // The regression this file could not have caught, because its fixture did
    // not build a realistic tenant. Two tables with RESTRICTING foreign keys
    // were on no list:
    //
    //   verification_run -> mailbox_mapping   (no ON DELETE clause at all)
    //   access_request   -> tenant            (ON DELETE RESTRICT, on purpose)
    //
    // Either one makes `purgeTenant` throw partway through, leaving a tenant
    // marked `deleting`, half emptied, and needing a person. And the service is
    // invite-only, so every managed customer has a granted access request —
    // this was not an edge case, it was the ordinary one.
    //
    // Both rows are in `seed` now, so every purge test above exercises this.
    // This one states it, so the reason survives the next fixture edit.
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await expect(purgeTenant(db, LEAVING, NOW)).resolves.toBeTruthy();

    expect(await count('access_request', `WHERE tenant_id = '${LEAVING}'`)).toBe(0);
    expect(await count('verification_run', `WHERE tenant_id = '${LEAVING}'`)).toBe(0);
    expect(await count('tenant', `WHERE id = '${LEAVING}'`)).toBe(0);
    // The other tenant's are untouched, so the delete is scoped and not a
    // table sweep that happened to look right.
    expect(await count('access_request', `WHERE tenant_id = '${STAYING}'`)).toBe(1);
    expect(await count('verification_run', `WHERE tenant_id = '${STAYING}'`)).toBe(1);
  });

  it('keeps a support read of the LIST, which is about nobody in particular', async () => {
    // `support_read` is purged for this tenant (workplan 0110 T1), but a read
    // of the tenant LIST carries a NULL tenant_id: it records an operator
    // having surveyed everybody, which erasing one customer must not erase.
    await conn.query(
      `INSERT INTO support_read (operator_user_id, tenant_id, view_name)
       VALUES ('op-1', $1, 'tenant'), ('op-1', NULL, 'tenants')`,
      [LEAVING],
    );
    await closeTenant(db, LEAVING, 0, 'owner@acme.example', NOW);
    await purgeTenant(db, LEAVING, NOW);

    expect(await count('support_read', `WHERE tenant_id = '${LEAVING}'`)).toBe(0);
    expect(await count('support_read', 'WHERE tenant_id IS NULL')).toBe(1);
  });

  it('every tenant-scoped table has a DECIDED fate — purged, or retained with a reason', async () => {
    // The guard `offboarding.ts` claimed to have and did not.
    //
    // Its comment above PURGED_TABLES says the list is written out rather than
    // derived "so that adding a table to the schema without deciding its fate
    // fails a test rather than silently inheriting a decision". Every test in
    // this file iterated PURGED_TABLES — so a table on NEITHER list was
    // invisible to all of them, which is the one case the sentence promised to
    // catch.
    //
    // `support_read` (workplan 0110 T1) is what found it: a table carrying a
    // tenant id, added and shipped, and an erasure would have left its rows
    // behind naming a customer who no longer exists.
    //
    // Asked of the DATABASE rather than of the migrations: the catalog is what
    // the purge actually runs against, and a regex over SQL would miss a column
    // added by a later ALTER.
    const { rows } = await conn.query<{ table_name: string }>(`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND c.column_name = 'tenant_id'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name
    `);
    const tenantScoped = rows.map((r) => r.table_name);

    // Vacuity guard: an empty catalog query would make this pass forever.
    expect(tenantScoped.length, 'no tenant-scoped tables found — the query is wrong').
      toBeGreaterThan(20);

    const decided = new Set<string>([...PURGED_TABLES, ...Object.keys(RETAINED_TABLES)]);
    const undecided = tenantScoped.filter((t) => !decided.has(t));
    expect(
      undecided,
      'these tables carry a tenant_id and are on NEITHER list, so an erasure ' +
        'leaves their rows behind naming a customer who no longer exists — add ' +
        'each to PURGED_TABLES, or to RETAINED_TABLES with the reason',
    ).toEqual([]);
  });

  it('names no table that does not exist', async () => {
    // The other direction, and it goes stale the same way: a purge list naming
    // a table that was renamed or dropped would throw at erasure time, on the
    // one path nobody exercises until a customer leaves.
    const { rows } = await conn.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const real = new Set(rows.map((r) => r.table_name));
    const phantom = [...PURGED_TABLES, ...Object.keys(RETAINED_TABLES)].filter(
      (t) => !real.has(t),
    );
    expect(phantom, 'named for erasure but no such table exists').toEqual([]);
  });

  it('states what it deliberately does not delete', () => {
    // The reasons travel with the decision rather than living in a commit
    // message, and the test fails if somebody removes one without thinking.
    expect(Object.keys(RETAINED_TABLES).sort()).toEqual(['erasure_record', 'invoice']);
    expect(RETAINED_TABLES.invoice).toMatch(/[Tt]ax retention/);
    expect(PURGED_TABLES).not.toContain('invoice');
    expect(PURGED_TABLES).not.toContain('erasure_record');
  });
});
