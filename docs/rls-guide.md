# Row-Level Security (RLS) Guide

> Rewritten 2026-08-02 (workplan 0021 T3). The previous version of this guide
> predated the entire enforcement model — it taught raw `SET app.current_tenant`
> with no role drop, named a `pnpm test:rls` command that does not exist, and
> its table list was stale. Everything below is written against the code:
> `packages/ledger/src/db.ts` (`withTenant`), `packages/ledger/src/driver.ts`
> (`LedgerDriver.role`), and migrations `0001`–`0004`.

## What RLS buys here

Row-Level Security is the Postgres feature that filters every query by a
session predicate. In this stack it is the **tenancy boundary of the managed
edition**: Tenant A can never read or write Tenant B's rows, even through a
bug in application-level filtering, because the database itself refuses. The
self-host appliance runs the **same schema, same policies, same code path**
(single-tenant, but the filter is never skipped) — an RLS bug cannot hide in
one edition only.

## The enforcement model — three parts, all load-bearing

Postgres exempts two kinds of user from row security: **superusers,
unconditionally**, and a table's **owner**, unless the table is `FORCE`d.
Both exemptions were once live in this repo — 96 policies existed, were
granted, were tested, and were **skipped** on the shipped path (see
`rls-in-force.unit.test.ts`'s header for the archaeology). The model that
closed it:

### 1. FORCE ROW LEVEL SECURITY on every RLS table

`0001_baseline.sql` FORCEs 22 of its 24 RLS tables;
`0002_force_row_security_stragglers.sql` closes the two that had `ENABLE`
without `FORCE` (`migration_discovery`, `migration_status`); migrations
`0003`/`0004` FORCE their new tables (`verification_run`, `apply_receipt`) on
creation. FORCE means even the table's **owner** is subject to the policies —
which matters because hard rule 5's operator points the appliance at their own
Postgres with an ordinary owner account.

### 2. The non-owner `app_user` role — "without it, RLS does nothing"

FORCE does not bind superusers, and the bootstrap user of the stock postgres
image (and PGlite's `postgres`) **is** a superuser. So the request path must
not run as it. `0001_baseline.sql` creates a `LOGIN` role **`app_user`**
(roles are cluster-global, so `pg_dump`-derived baselines omit them — the
migration creates it explicitly) with table grants but no ownership and no
superuser bit. The deployment contract (see `operator-runbook.md`, "The two
database roles"):

- `DATABASE_URL` → the DB owner. **Migrations and the demo seed only.**
- `APP_DATABASE_URL` → `app_user`. The API and the deployed Trigger.dev
  tasks connect through this for all tenant data.

Point the app at the owner URL and tenant isolation silently disappears.

### 3. `LedgerDriver.role` + `withTenant()` — the gate on the shipped path

The appliance has no second connection string to give out — it connects as
the owner (container path) or as `postgres` (PGlite path). The driver seam
carries the fix: constructing a driver with `role: 'app_user'` makes
`withTenant()` drop privileges **inside each transaction**.

`withTenant(driverOrPool, tenantId, fn)` is the one place tenant context is
set, and the order is the security property:

```
BEGIN
SET LOCAL ROLE "app_user"                                -- if driver.role is set;
                                                          -- BEFORE any caller query
SELECT set_config('app.current_tenant', $1, true)         -- bind param, transaction-local
… fn(txDb) …                                              -- every query filtered
COMMIT / ROLLBACK                                         -- both revert SET LOCAL + set_config
```

- `SET LOCAL` + `set_config(..., true)` are **transaction-local**: nothing to
  remember to undo, and a pooled connection carries no tenant context back.
- The tenant id goes through a **bind parameter**, never string interpolation.
- If `ROLLBACK` itself fails, the connection is **destroyed**, not returned —
  a client left in an aborted transaction could still carry
  `app.current_tenant` into the next request.

There is deliberately no "set the tenant on the session" API. If you find
yourself writing `SET app.current_tenant` outside `withTenant`, stop.

## Policies

Every RLS table carries four policies (SELECT / INSERT / UPDATE / DELETE),
each with the same predicate:

```sql
tenant_id = current_setting('app.current_tenant')::uuid
```

No context set → the predicate fails → zero rows (fail-closed), not an error.

## The RLS tables (26, all FORCEd)

From migrations `0001`–`0004`:

`audit_log`, `apply_receipt`, `backup_target`, `collection_mapping`,
`connection`, `cursor`, `cutover`, `decision`, `group_def`, `invoice`,
`item`, `mailbox`, `mailbox_mapping`, `migration_discovery`,
`migration_status`, `payment_method`, `policy_preset`, `run`, `run_event`,
`scope_selection`, `sync_checkpoint`, `tenant`, `tenant_member`,
`usage_metric`, `verification`, `verification_run`.

A future migration that adds an RLS table and forgets `FORCE` fails
`force-rls.unit.test.ts` **by name** — the test reads
`pg_class.relforcerowsecurity` for every RLS table rather than keeping its
own list.

## Beyond the row filter: the membership gate

Since workplan 0020 T1, a verified JWT signature is not an authorization:
`authenticate` confirms the `(tenantId, sub)` claim against an ACTIVE
`tenant_member` **row** (probed inside `withTenant`, so RLS scopes the lookup
— a forged tenant claim finds no row and gets 403), and the caller's role
comes from that row, never from the token. RLS bounds what a tenant's queries
can touch; the membership gate decides whether the caller is in that tenant
at all.

## Testing RLS — the real suites

There is no `pnpm test:rls`. The coverage lives in named suites:

**In the unit gate (`pnpm test` — PGlite, no containers):**

- `packages/ledger/src/force-rls.unit.test.ts` — catalog completeness (every
  RLS table is FORCEd, asked of `pg_class`) **and** enforcement with a
  non-superuser owner (owner + ENABLE sees everything; owner + FORCE is
  filtered).
- `packages/ledger/src/rls-in-force.unit.test.ts` — RLS is in force **on the
  path the appliance ships**: nothing but `pgliteDriver({ role })` +
  `withTenant()`, no privileged setup inside the assertions.
- `packages/ledger/src/pglite-driver.unit.test.ts` — the driver seam itself.

**In the integration gate (`pnpm test:integration` — real Postgres via
testcontainers):**

- `packages/ledger/src/rls.integration.test.ts` — policy correctness as
  `app_user` (cross-tenant reads/writes refused per table).
- `packages/ledger/src/rls-in-force.integration.test.ts` — the driver-path
  proof again, on the container backend.
- The API route suites (`apps/api/src/routes/**/*.integration.test.ts`) run
  every request through `withTenant` + the membership gate; each seeds the
  memberships its tokens imply (`apps/api/src/__tests__/seed-membership.ts`),
  and the apply-flag suite proves role-from-row (a viewer with an
  owner-claiming token gets 403).

### Manual spot-check

Connect **as `app_user`** (as the owner you would be testing the exemption,
not the enforcement) and stay inside one transaction:

```sql
BEGIN;
SELECT set_config('app.current_tenant', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true);
SELECT count(*) FROM connection;   -- tenant A's rows only
ROLLBACK;

BEGIN;
SELECT set_config('app.current_tenant', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', true);
SELECT count(*) FROM connection
 WHERE tenant_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';  -- 0 rows, filtered
ROLLBACK;
```

## Pitfalls that have actually happened here

- **Green policy tests, bypassed product.** The policies were tested through
  a purpose-built `app_user` pool while the shipped appliance connected as
  owner/superuser and skipped them all. That is why `rls-in-force.*` exists:
  it tests the wiring, not the policy text. When adding a backend or a
  connection path, add the in-force proof for it.
- **The owner URL in the request path.** Everything works, nothing is
  isolated. `APP_DATABASE_URL` exists so this is a configuration you can
  grep for.
- **Session-level context.** `SET app.current_tenant` without `LOCAL`
  survives the transaction and rides the pooled connection into another
  request. `withTenant` uses transaction-local everything; keep it that way.
- **A new table without FORCE.** Two tables shipped that way pre-squash;
  the catalog audit test now fails by name. Copy the
  `ENABLE` + `FORCE` + four-policy block from an existing migration.

## References

- `packages/ledger/src/db.ts` — `withTenant` (the gate)
- `packages/ledger/src/driver.ts` — `LedgerDriver.role` and the seam
- `packages/ledger/migrations/0001_baseline.sql` — policies, `app_user`, FORCE
- `packages/ledger/migrations/0002_force_row_security_stragglers.sql`
- [ADR-0016](./adr/0016-ledger-schema-v1.md) — ledger schema
- [ADR-0023](./adr/0023-persistence-postgres-only.md) /
  [ADR-0028](./adr/0028-pglite-appliance-persistence.md) — one storage engine,
  and why the same RLS runs on PGlite
- `docs/operator-runbook.md` — the two DB roles in deployment
- [Workplan 0016](./workplans/0016-pglite-adoption.md) — where the inert-RLS
  bug was found and fixed; [workplan 0020](./workplans/0020-managed-stack-productionization.md) T1 —
  the membership gate
