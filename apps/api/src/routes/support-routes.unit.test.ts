// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The four support routes, against a REAL database (workplan 0110 T4, plus
 * the retained-invoice screen).
 *
 * ## Why the route and not the view
 *
 * `support-views.unit.test.ts` already proves the views: an operator sees
 * rows, everybody else sees none, and every `support_` view carries the
 * predicate. All of that can be true while the ROUTE drops it on the floor —
 * a decision that is right and a caller that ignores it is the failure this
 * repo keeps rediscovering, most recently in 0108 T3, where the refusal was
 * computed correctly and the route wrote the row anyway.
 *
 * So this file asks the questions the view cannot answer:
 *
 *  - does the route read the VIEW, or did somebody point it at the table?
 *  - does a non-operator's request write a row into the log it is not in?
 *  - does a `404` — a read of nothing — get recorded as a read of somebody?
 *  - does anything the views deliberately omit come back out of a response?
 *
 * PGlite as `app_user`, both migration chains, and only `authenticateSubject`
 * stubbed: verifying a JWT is `auth.unit.test.ts`'s job, and everything that
 * matters here — row security, the views, the predicate, the log's grants —
 * is the product's own.
 *
 * UUID family 5f5c0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, tenantRef, currentTier } from '@openmig/managed';
import { FAILURE_CATEGORIES } from '@openmig/shared';
import type { TenantId } from '@openmig/shared';

const TENANT_A = '5f5c0000-e29b-41d4-a716-446655442201';
const TENANT_B = '5f5c0000-e29b-41d4-a716-446655442202';
const CONN_A = '5f5c0000-e29b-41d4-a716-446655442211';
const BOX_A = '5f5c0000-e29b-41d4-a716-446655442221';
const MAPPING_A = '5f5c0000-e29b-41d4-a716-446655442231';
/**
 * A tenant that has been ERASED: hashed into `erasure_record.tenant_ref` and
 * deliberately never inserted into `tenant`, because that is the state under
 * test. Its invoice survives, detached.
 */
const ERASED_TENANT = '5f5c0000-e29b-41d4-a716-446655442203';
/** A tenant CLOSED but not yet purged — its erasure record retains nothing. */
const CLOSING_TENANT = '5f5c0000-e29b-41d4-a716-446655442204';
const RETAINED_INVOICE = '5f5c0000-e29b-41d4-a716-446655442241';
/** What the detached invoice says about who it was for, stamped at purge. */
const BILLED_TO = 'Gamma BV';
/** A well-formed id that is not in the database — the "no such thing" case. */
const ABSENT = '5f5c0000-e29b-41d4-a716-446655442299';

const OPERATOR = 'operator-subject-0110';
const NOT_OPERATOR = 'ordinary-subject-0110';

/** The credential text the views must never let out. */
const SECRET_REF = 'encrypted-blob-that-must-never-be-served';
/** Prose with an address in it — exactly what `last_error` holds. */
const ERROR_PROSE = 'IMAP LOGIN failed for someone@example.invalid in folder Salaris 2025';
/** In `tenant.settings`, which the view does not select and a table read would. */
const TENANT_NOTE = 'internal-tenant-note-that-must-never-be-served';
/** A decision's `summary` — prose about one mailbox, counted and never served. */
const DECISION_PROSE = 'quota exceeded for finance@example.invalid';

let driver: LedgerDriver;
/** Set per test — the subject `authenticateSubject` pretends to have verified. */
let caller: string | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (caller === undefined) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, { userId: caller });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: supportRoutes } = await import('./support.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

/** Read a table directly, as the owner, to see what really exists. */
async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(sql, params);
    return r.rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const logRows = () =>
  rows('SELECT operator_user_id, tenant_id, view_name FROM support_read ORDER BY at, view_name');

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name, settings) VALUES ($1,$2,$3::jsonb)', [
      TENANT_A,
      'Alpha BV',
      JSON.stringify({ notes: TENANT_NOTE }),
    ]);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT_B, 'Beta BV']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','Alpha mail','{"host":"mail.internal.example"}'::jsonb,'connected',$3)`,
      [CONN_A, TENANT_A, SECRET_REF],
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
      `INSERT INTO migration_status
         (id, tenant_id, mapping_id, domain, state, last_error, last_error_category)
       VALUES (gen_random_uuid(), $1, $2, 'email', 'failed', $3, 'auth_expired')`,
      [TENANT_A, MAPPING_A, ERROR_PROSE],
    );
    await q(
      `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, total, currency)
       VALUES (gen_random_uuid(), $1, DATE '2026-07-01', DATE '2026-07-31', 'sent', 42.50, 'EUR')`,
      [TENANT_A],
    );
    // One pending decision on the mapping, one on the tenant alone
    // (workplan 0110 T5). The second carries the address the count exists to
    // avoid serving.
    await q(
      `INSERT INTO decision (id, tenant_id, mapping_id, category, summary, subject_key, status)
       VALUES (gen_random_uuid(), $1, $2, 'quota', $3, 'k1', 'pending')`,
      [TENANT_A, MAPPING_A, DECISION_PROSE],
    );
    await q(
      `INSERT INTO decision (id, tenant_id, mapping_id, category, summary, subject_key, status)
       VALUES (gen_random_uuid(), $1, NULL, 'new_mailbox', 'a mailbox nobody has placed', 'k2', 'pending')`,
      [TENANT_A],
    );
    // An ERASED tenant, in the state `purgeTenant` actually leaves behind: the
    // tenant row gone, its invoice detached (`tenant_id` NULL) and stamped
    // with the name it was billed to, and an `erasure_record` naming the
    // invoice by id under a HASH of the tenant id. Seeded as the end state
    // rather than by calling `purgeTenant`, so this file keeps testing the
    // routes; `offboarding.unit.test.ts` is what proves the purge produces it.
    await q(
      `INSERT INTO invoice
         (id, tenant_id, billed_to_name, period_start, period_end, status, total, currency)
       VALUES ($1, NULL, $2, DATE '2026-05-01', DATE '2026-05-31', 'paid', 99.00, 'EUR')`,
      [RETAINED_INVOICE, BILLED_TO],
    );
    await q(
      `INSERT INTO erasure_record
         (tenant_ref, requested_at, window_days, purged_at, retained_invoice_ids)
       VALUES ($1, TIMESTAMPTZ '2026-06-01T00:00:00Z', 30,
               TIMESTAMPTZ '2026-07-01T00:00:00Z', ARRAY[$2::uuid])`,
      [tenantRef(ERASED_TENANT), RETAINED_INVOICE],
    );
    // Closed but NOT yet purged: the record exists, the array is empty. Its
    // tenant would still be live and its invoices still on its own page, which
    // is why this must contribute nothing here.
    await q(
      `INSERT INTO erasure_record (tenant_ref, requested_at, window_days)
       VALUES ($1, TIMESTAMPTZ '2026-08-01T00:00:00Z', 7)`,
      [tenantRef(CLOSING_TENANT)],
    );
    await q(
      `INSERT INTO platform_operator (user_id, email, note)
       VALUES ($1, 'operator@ownpace.eu', 'workplan 0110 T4 fixture')`,
      [OPERATOR],
    );
  } finally {
    await conn.release();
  }
},
  // 30s, not vitest's default 10s for hooks. This builds BOTH migration chains
  // in an in-memory Postgres before a single test runs, which is most of a
  // second per migration and grew past the default when the managed chain
  // reached eleven. It passed alone and failed only in a full `--project unit`
  // run, where the machine is doing dozens of other files at once — the worst
  // way to find out, and the reason the number is stated here rather than left
  // to luck. The root config's own note records the same class of trap: inline
  // `projects` entries do not inherit root timeouts.
  30_000,
);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  caller = undefined;
  await rows('DELETE FROM support_read');
});

/** The bearer value is never inspected — `authenticateSubject` is stubbed. */
const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer stub');

describe('an operator is served, and the serving is recorded', () => {
  it('lists every organisation', async () => {
    caller = OPERATOR;
    const res = await get('/api/support/tenants');
    expect(res.status).toBe(200);
    const names = (res.body.tenants as Array<{ tenant_name: string }>).map((t) => t.tenant_name);
    expect(names).toEqual(['Alpha BV', 'Beta BV']);
  });

  it('records the list as ONE read, with no organisation named', async () => {
    caller = OPERATOR;
    await get('/api/support/tenants');
    expect(await logRows()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: null, view_name: 'tenants' },
    ]);
  });

  it('serves one organisation with its connections, migrations and invoices', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/tenants/${TENANT_A}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.tenant_name).toBe('Alpha BV');
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0].display_name).toBe('Alpha mail');
    expect(res.body.migrations).toHaveLength(1);
    expect(res.body.migrations[0].name).toBe('Alpha migration');
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.invoices[0].status).toBe('sent');
  });

  it('records that organisation, named', async () => {
    caller = OPERATOR;
    await get(`/api/support/tenants/${TENANT_A}`);
    expect(await logRows()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: TENANT_A, view_name: 'tenant' },
    ]);
  });

  it('serves one migration, per domain, with the category and not the prose', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/migrations/${MAPPING_A}`);
    expect(res.status).toBe(200);
    expect(res.body.migration.name).toBe('Alpha migration');
    expect(res.body.domains).toHaveLength(1);
    expect(res.body.domains[0].state).toBe('failed');
    expect(res.body.domains[0].last_error_category).toBe('auth_expired');
    expect(res.body.domains[0]).not.toHaveProperty('last_error');
  });

  it('records the migration against its OWN organisation, not one the caller named', async () => {
    caller = OPERATOR;
    await get(`/api/support/migrations/${MAPPING_A}`);
    expect(await logRows()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: TENANT_A, view_name: 'migration' },
    ]);
  });
});

describe('a signed-in non-operator gets nothing and leaves nothing', () => {
  it('gets an empty list rather than a 403 — the database decided, not the route', async () => {
    caller = NOT_OPERATOR;
    const res = await get('/api/support/tenants');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toEqual([]);
  });

  it('writes NO row into the log', async () => {
    // The hole found while building this: the middleware in front of these
    // routes asks only for a valid token, and the views correctly return
    // nothing — so without the helper's own `WHERE EXISTS`, any signed-in
    // person could pollute the one record standing in for the consent the
    // owner dropped, by exactly the people it is not about.
    caller = NOT_OPERATOR;
    await get('/api/support/tenants');
    await get(`/api/support/tenants/${TENANT_A}`);
    await get(`/api/support/migrations/${MAPPING_A}`);
    expect(await logRows()).toEqual([]);
  });

  it('cannot tell a real organisation from an absent one', async () => {
    caller = NOT_OPERATOR;
    const real = await get(`/api/support/tenants/${TENANT_A}`);
    const absent = await get(`/api/support/tenants/${ABSENT}`);
    expect(real.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(real.body).toEqual(absent.body);
  });

  it('cannot tell a real migration from an absent one', async () => {
    caller = NOT_OPERATOR;
    const real = await get(`/api/support/migrations/${MAPPING_A}`);
    const absent = await get(`/api/support/migrations/${ABSENT}`);
    expect(real.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(real.body).toEqual(absent.body);
  });
});

describe('a read of nothing is not recorded as a read of somebody', () => {
  it('logs nothing when an operator asks for an organisation that is not there', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/tenants/${ABSENT}`);
    expect(res.status).toBe(404);
    expect(await logRows()).toEqual([]);
  });

  it('logs nothing when an operator asks for a migration that is not there', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/migrations/${ABSENT}`);
    expect(res.status).toBe(404);
    expect(await logRows()).toEqual([]);
  });

  it('still logs the LIST when it comes back empty for an operator', async () => {
    // An empty list plus a log row is an operator on a platform with no
    // customers; an empty list and no row is somebody who was never an
    // operator. Skipping the call on zero rows would erase the difference,
    // which is the one thing this log exists to keep.
    caller = OPERATOR;
    // `WHERE tenant_id IS NOT NULL`, because what this empties is the platform
    // of CUSTOMERS. A detached invoice belongs to no tenant — it is what an
    // erasure deliberately left behind — so deleting it here would be
    // incidental rather than intended, and would silently break the retained
    // invoice fixture below while the restore block put back only what it
    // meant to remove.
    await rows('DELETE FROM invoice WHERE tenant_id IS NOT NULL');
    await rows('DELETE FROM decision');
    await rows('DELETE FROM migration_status');
    await rows('DELETE FROM mailbox_mapping');
    await rows('DELETE FROM mailbox');
    await rows('DELETE FROM connection');
    const before = await rows('SELECT id, name, status, settings FROM tenant ORDER BY name');
    await rows('DELETE FROM tenant');
    try {
      const res = await get('/api/support/tenants');
      expect(res.status).toBe(200);
      expect(res.body.tenants).toEqual([]);
      expect(await logRows()).toEqual([
        { operator_user_id: OPERATOR, tenant_id: null, view_name: 'tenants' },
      ]);
    } finally {
      // Restored rather than left deleted: the fixtures are shared, and a test
      // that empties the database for the ones after it is a flake with a
      // schedule.
      for (const t of before) {
        await rows('INSERT INTO tenant (id, name, status, settings) VALUES ($1,$2,$3,$4)', [
          t.id,
          t.name,
          t.status,
          t.settings,
        ]);
      }
      await rows(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source','imap','Alpha mail','{"host":"mail.internal.example"}'::jsonb,'connected',$3)`,
        [CONN_A, TENANT_A, SECRET_REF],
      );
      await rows(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','someone@example.invalid')`,
        [BOX_A, TENANT_A, CONN_A],
      );
      await rows(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name)
         VALUES ($1,$2,$3,'active','Alpha migration')`,
        [MAPPING_A, TENANT_A, BOX_A],
      );
      await rows(
        `INSERT INTO migration_status
           (id, tenant_id, mapping_id, domain, state, last_error, last_error_category)
         VALUES (gen_random_uuid(), $1, $2, 'email', 'failed', $3, 'auth_expired')`,
        [TENANT_A, MAPPING_A, ERROR_PROSE],
      );
      await rows(
        `INSERT INTO invoice (id, tenant_id, period_start, period_end, status, total, currency)
         VALUES (gen_random_uuid(), $1, DATE '2026-07-01', DATE '2026-07-31', 'sent', 42.50, 'EUR')`,
        [TENANT_A],
      );
      await rows(
        `INSERT INTO decision (id, tenant_id, mapping_id, category, summary, subject_key, status)
         VALUES (gen_random_uuid(), $1, $2, 'quota', $3, 'k1', 'pending')`,
        [TENANT_A, MAPPING_A, DECISION_PROSE],
      );
      await rows(
        `INSERT INTO decision (id, tenant_id, mapping_id, category, summary, subject_key, status)
         VALUES (gen_random_uuid(), $1, NULL, 'new_mailbox', 'a mailbox nobody has placed', 'k2', 'pending')`,
        [TENANT_A],
      );
    }
  });
});

describe('what the response body may never contain', () => {
  it('serves no credential, no config and no error prose, at any level', async () => {
    caller = OPERATOR;
    const bodies = [
      (await get('/api/support/tenants')).text,
      (await get(`/api/support/tenants/${TENANT_A}`)).text,
      (await get(`/api/support/migrations/${MAPPING_A}`)).text,
    ].join('\n');

    // The fixtures put each of these behind the boundary on purpose, so a
    // route that selected from the TABLE instead of the view would fail here
    // rather than pass on a body nobody read.
    expect(bodies).not.toContain(SECRET_REF);
    expect(bodies).not.toContain('mail.internal.example');
    expect(bodies).not.toContain('Salaris 2025');
    expect(bodies).not.toContain('someone@example.invalid');
    expect(bodies).not.toContain(TENANT_NOTE);
    expect(bodies).not.toContain(DECISION_PROSE);
    // ...and the check is not vacuous: what SHOULD be there, is.
    expect(bodies).toContain('Alpha migration');
    expect(bodies).toContain('auth_expired');
  });
});

describe('the ways in that are refused before any database is touched', () => {
  it('answers 401 with no subject on the request', async () => {
    caller = undefined;
    expect((await get('/api/support/tenants')).status).toBe(401);
  });

  it('answers 400, not 500, for an id that is not a uuid', async () => {
    caller = OPERATOR;
    expect((await get('/api/support/tenants/not-a-uuid')).status).toBe(400);
    expect((await get('/api/support/migrations/00000000-oops')).status).toBe(400);
    expect(await logRows()).toEqual([]);
  });
});

describe('the spec describes what these routes actually serve', () => {
  it("documents the six failure categories the column can hold, and only those", () => {
    // The enum in `openapi.yaml` is a copy, and a copy rots. Asserted against
    // the source so that adding a seventh category — or renaming one — fails
    // here rather than in a client generated from a spec that is wrong.
    const spec = parseYaml(
      readFileSync(join(import.meta.dirname, '../../docs/openapi.yaml'), 'utf-8'),
    ) as {
      components: {
        schemas: {
          SupportMigrationDomain: { properties: { last_error_category: { enum: string[] } } };
        };
      };
    };
    const documented =
      spec.components.schemas.SupportMigrationDomain.properties.last_error_category.enum;
    expect([...documented].sort()).toEqual([...FAILURE_CATEGORIES].sort());
  });
});


describe('what is waiting on the customer, counted (workplan 0110 T5)', () => {
  it('serves the two counts, and they deliberately do not agree', async () => {
    // `decision.mapping_id` is nullable by design, so an organisation can be
    // waiting on something no migration owns. Two counts that added up would
    // mean one of them was wrong.
    caller = OPERATOR;
    const list = await get('/api/support/tenants');
    const alpha = (list.body.tenants as Array<Record<string, unknown>>).find(
      (t) => t.tenant_id === TENANT_A,
    );
    expect(Number(alpha?.pending_decision_count)).toBe(2);

    const one = await get(`/api/support/tenants/${TENANT_A}`);
    expect(Number(one.body.tenant.pending_decision_count)).toBe(2);
    expect(Number(one.body.migrations[0].pending_decision_count)).toBe(1);

    const migration = await get(`/api/support/migrations/${MAPPING_A}`);
    expect(Number(migration.body.migration.pending_decision_count)).toBe(1);
  });

  it('serves the count and never the decision', async () => {
    // The one thing a count must not become. `summary` is prose a detector
    // wrote about a specific mailbox; the view does not select it, so a route
    // that reached for the table instead would fail here.
    caller = OPERATOR;
    const bodies = [
      (await get('/api/support/tenants')).text,
      (await get(`/api/support/tenants/${TENANT_A}`)).text,
      (await get(`/api/support/migrations/${MAPPING_A}`)).text,
    ].join('\n');
    expect(bodies).not.toContain(DECISION_PROSE);
    expect(bodies).not.toContain('finance@example.invalid');
    expect(bodies).not.toContain('a mailbox nobody has placed');
  });
});



describe('the invoices an erasure kept', () => {
  it('serves a detached invoice that no tenant page could reach', async () => {
    // The whole point. This invoice has `tenant_id` NULL and the organisation
    // it billed no longer exists, so every other route on this surface —
    // each of which filters `WHERE tenant_id = $1` — is structurally unable to
    // return it. Before this route the rows kept for tax retention were kept
    // and unreadable.
    caller = OPERATOR;
    const res = await get('/api/support/retained-invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(1);
    const [only] = res.body.invoices as Array<Record<string, unknown>>;
    expect(only?.invoice_id).toBe(RETAINED_INVOICE);
    expect(only?.billed_to_name).toBe(BILLED_TO);
    expect(only?.status).toBe('paid');
  });

  it('identifies the erasure by hash, and carries no tenant id at all', async () => {
    // `erasure_record` holds a sha256 precisely so it cannot be read back into
    // a list of former customers. A response that leaked the id — or that a
    // later change made "helpful" by joining one in — would undo that, so the
    // assertion is against the whole body rather than one field.
    caller = OPERATOR;
    const res = await get('/api/support/retained-invoices');
    expect(res.body.invoices[0].tenant_ref).toBe(tenantRef(ERASED_TENANT));
    expect(res.text).not.toContain(ERASED_TENANT);
  });

  it('records the read with no organisation named', async () => {
    caller = OPERATOR;
    await get('/api/support/retained-invoices');
    expect(await logRows()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: null, view_name: 'retained_invoices' },
    ]);
  });

  it('tells a non-operator nothing, and writes nothing about them', async () => {
    caller = NOT_OPERATOR;
    const res = await get('/api/support/retained-invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toEqual([]);
    expect(await logRows()).toEqual([]);
  });

  it('refuses a request with no subject', async () => {
    caller = undefined;
    expect((await get('/api/support/retained-invoices')).status).toBe(401);
    expect(await logRows()).toEqual([]);
  });

  it('does not double-count with the live tenant surface, in either direction', async () => {
    // The two surfaces partition the invoices rather than overlapping, and it
    // falls out of WHEN `retained_invoice_ids` is written — at purge, after
    // the detach — rather than out of a predicate somebody has to remember.
    // A closed-but-unpurged tenant is seeded with an empty array for exactly
    // this: it must contribute nothing here while its invoices are still on
    // its own page.
    caller = OPERATOR;
    const retained = (await get('/api/support/retained-invoices')).body.invoices as Array<
      Record<string, unknown>
    >;
    const live = (await get(`/api/support/tenants/${TENANT_A}`)).body.invoices as Array<
      Record<string, unknown>
    >;

    expect(retained.map((i) => i.invoice_id)).toEqual([RETAINED_INVOICE]);
    expect(live.map((i) => i.invoice_id)).not.toContain(RETAINED_INVOICE);
    const liveIds = new Set(live.map((i) => i.invoice_id));
    expect(retained.some((i) => liveIds.has(i.invoice_id))).toBe(false);
  });
});

describe('the tier the month has earned so far (0109 T4, surfaced)', () => {
  // Seeded HERE rather than in the file's beforeAll: the empty-list test above
  // deletes and restores the tenants, and rows seeded before it would need to
  // be part of its restore block — a coupling this data has no reason to buy.
  //
  // The numbers are chosen so the derivation FLIPS if any input is dropped:
  //  - recorded peak 1, live slot-holders 3 (2 active + 1 paused; the cutover
  //    row holds nothing) → the paths axis says Small only because the LIVE
  //    number is folded in; from the recorded peak alone it says Tiny.
  //  - meter 100 GB → the data axis says Tiny, so `decided_by` is 'paths' —
  //    and the meter still shows in the evidence, so dropping it is visible.
  beforeAll(async () => {
    const conn = await driver.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      await q(
        `INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at)
         VALUES ($1, date_trunc('month', now())::date, 1, TIMESTAMPTZ '2026-08-12T10:00:00Z')`,
        [TENANT_A],
      );
      await q('INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, 100000000000)', [TENANT_A]);
      for (const [domain, state] of [
        ['email', 'active'],
        ['calendar', 'active'],
        ['contact', 'paused'],
        ['file', 'cutover'],
      ]) {
        await q(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state)
           VALUES ($1, $2, $3, $4)`,
          [TENANT_A, MAPPING_A, domain, state],
        );
      }
      // A second organisation where only the DATA axis says anything: 800 GB
      // moved, nothing running, nothing recorded.
      await q('INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, 800000000000)', [TENANT_B]);
    } finally {
      await conn.release();
    }
  });

  it('serves the derivation with its evidence, live occupancy folded in', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/tenants/${TENANT_A}`);
    expect(res.status).toBe(200);
    const usage = res.body.usage as Record<string, unknown>;
    // Small, and by PATHS: 3 slot-holders clear Tiny's 1 while 100 GB does
    // not clear Tiny's 250. From the recorded peak alone this would read
    // Tiny/'both' — a route that ignores the live counts fails here.
    expect((usage.tier as Record<string, unknown>).id).toBe('small');
    expect(usage.decided_by).toBe('paths');
    expect(usage.evidence).toEqual({ peak_paths: 3, gb_moved: 100 });
    // The observations behind it, separately: the mark somebody recorded and
    // when, and what stands right now. The cutover path is counted in its
    // state and NOT as a slot-holder — a route that counted rows instead of
    // asking `holdsASlot` would say 4 here.
    expect(usage.recorded_peak_paths).toBe(1);
    expect(new Date(usage.recorded_peak_at as string).toISOString()).toBe(
      '2026-08-12T10:00:00.000Z',
    );
    expect(usage.paths_now).toBe(3);
    expect(usage.paths_by_state).toEqual({ active: 2, paused: 1, cutover: 1 });
  });

  it('agrees with the calculator the invoice will use — before AND after its true-up', async () => {
    // The parity that makes this screen trustworthy: `currentTier` is what T5
    // will bill from, and it WRITES the month up before reading. The screen
    // must reach the same answer without writing anything — and must still
    // agree after the calculator's true-up has moved the recorded mark.
    caller = OPERATOR;
    const before = (await get(`/api/support/tenants/${TENANT_A}`)).body.usage as Record<
      string,
      { peak_paths?: number; gb_moved?: number; id?: string }
    >;

    const billed = await withTenant(driver, TENANT_A, async (db) =>
      currentTier(db, TENANT_A as TenantId),
    );
    expect(billed.tier?.id).toBe(before.tier?.id);
    expect(billed.decidedBy).toBe(before.decided_by as unknown as string);
    expect(billed.evidence.peakPaths).toBe(before.evidence?.peak_paths);
    expect(billed.evidence.gbMoved).toBe(before.evidence?.gb_moved);

    // The calculator's true-up just raised the recorded mark to 3. The screen
    // reads the same tables, so it now shows the raised mark — and the SAME
    // tier, because folding the live count in is exactly what the true-up
    // writes down.
    const after = (await get(`/api/support/tenants/${TENANT_A}`)).body.usage as Record<
      string,
      unknown
    >;
    expect(after.recorded_peak_paths).toBe(3);
    expect((after.tier as Record<string, unknown>).id).toBe(before.tier?.id);
    expect(after.evidence).toEqual({ peak_paths: 3, gb_moved: 100 });
  });

  it('lets the data axis decide when it is the higher one', async () => {
    caller = OPERATOR;
    const res = await get(`/api/support/tenants/${TENANT_B}`);
    expect(res.status).toBe(200);
    const usage = res.body.usage as Record<string, unknown>;
    // 800 GB clears Small's 750 → Medium, with zero paths anywhere: the
    // floor ADR-0014 promises ("the size of what you moved sets a floor").
    expect((usage.tier as Record<string, unknown>).id).toBe('medium');
    expect(usage.decided_by).toBe('data');
    expect(usage.evidence).toEqual({ peak_paths: 0, gb_moved: 800 });
    expect(usage.recorded_peak_paths).toBe(0);
    expect(usage.recorded_peak_at).toBeNull();
    expect(usage.paths_now).toBe(0);
    expect(usage.paths_by_state).toEqual({});
  });

  it('adds numbers to the body, never words about what is moving', async () => {
    // The usage block is counts, a tier name from a fixed table, and two
    // timestamps. The boundary assertions above already run before this data
    // exists; this re-runs the load-bearing ones on the body that now carries
    // usage.
    caller = OPERATOR;
    const body = (await get(`/api/support/tenants/${TENANT_A}`)).text;
    expect(body).not.toContain(SECRET_REF);
    expect(body).not.toContain('someone@example.invalid');
    expect(body).not.toContain(DECISION_PROSE);
    expect(body).toContain('"usage"');
  });
});
