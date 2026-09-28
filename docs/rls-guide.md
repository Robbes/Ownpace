# Row-Level Security (RLS) Guide

> Rewritten 2026-08-02 (workplan 0021 T3). The previous version of this guide
> predated the entire enforcement model — it taught raw `SET app.current_tenant`
> with no role drop, named a `pnpm test:rls` command that does not exist, and
> its table list was stale. Everything below is written against the code:
> `packages/ledger/src/db.ts` (`withTenant`), `packages/ledger/src/driver.ts`
> (`LedgerDriver.role`), and migrations `0001`–`0004`.
>
> Updated 2026-09-27 ([workplan 0138](./workplans/0138-tasks-under-row-security.md)
> T5, step 1): which connections row security binds today and which it does
> not, the task plane among the second, and the table list asked of the catalog.
> Then, the same day, for 0138 T3 step 1: the task upload no longer carries
> `DIRECT_DATABASE_URL` (§2's `set-task-env.sh` row).
>
> Updated 2026-09-28 (0138 T6): the permission report and the sharing rescan
> read as `app_user` inside `withTenant`, like every other route, so no route
> reads tenant data on the owner's connection. A request still reaches the
> owner in two places, for the audit pseudonym key only, through `index.ts`'s
> pool of one (§2's row for it).

## What RLS buys here

Row-Level Security is the Postgres feature that filters every query by a
session predicate. In this stack it is the **tenancy boundary of the managed
edition**: on a connection it binds, Tenant A can never read or write Tenant
B's rows, even through a bug in application-level filtering, because the
database itself refuses. **It binds only some of the connections today**: the
API's request path, yes; the managed edition's Trigger.dev tasks, no. The next
section says which, and [workplan 0138](./workplans/0138-tasks-under-row-security.md)
is the way to close the gap. The self-host appliance runs the **same schema and
the same policies**, and its `withTenant` scopes drop to `app_user`, but its
ledger and cursor stores run outside them (the next section).

## Where row security holds today

Checked against the code and against a database with both migration chains
applied, 2026-09-27. Postgres never applies row security to a superuser,
`FORCE` or not, and the managed edition's database owner is a superuser (§2).
On an owner connection, `withTenant` still sets `app.current_tenant`, but
nothing reads it: asked inside such a transaction with tenant A set, a
`SELECT count(*) FROM tenant` on the owner's connection counted both
organisations, and the same question as `app_user` counted one.

| path | connects as | row security |
| --- | --- | --- |
| The API's request path: `getDbPool()` (`apps/api/src/middleware/auth.ts`) on `APP_DATABASE_URL`, its tenant queries inside `withTenant` / `withTenantDb`. Every route, the permission report and the sharing rescan (`apps/api/src/routes/permissions.ts`) included since 2026-09-28 (0138 T6); until then that file opened its own pool on `DATABASE_URL` | `app_user` | **in force** |
| The API's operator screens: the `support_*` views (managed migrations `0009` onward) | `app_user`, but a view runs with its owner's rights, and its owner is the owner | **passed by design**: the operator check written into each view is the only net, and `packages/managed/src/support-views.unit.test.ts` checks every view has it |
| The API's migrations and its audit key pool (`auditKeyPool`, `apps/api/src/index.ts`), on `DIRECT_DATABASE_URL`, or `DATABASE_URL` when that is unset. The key pool is reached from the request path in two places: the audit line printed after an audit event commits (the export sink, `auditExportOn`), and the operator's audit download (`GET /api/support/audit-export`, `routes/support.ts`, through `apps/api/src/audit-key.ts`). Each keeps the key once it has read it, and reads it again only after a read that failed | the owner; the key pool is one connection | not needed: the migrations change the schema, and the key pool reads `deployment_key` only, which holds no tenant's rows |
| **Every managed Trigger.dev task**: the eight per-tenant jobs (`run-delta-sync`, `run-discovery`, `run-verification`, `run-confirmation`, `run-apply-deletion`, `run-apply-relocation`, `run-cutover`, `run-rollback`) and the six scheduled ones (`managed-sync-tick`, `managed-retention`, `managed-purge-closed`, `managed-digest`, `managed-drift-detect`, `managed-group-discovery`), and the builders they call (`buildDepsFromMapping`, `buildDomainDepsFromMapping`, `createLedgerVerificationReader`) | the owner, a superuser: each builds its pool from `DATABASE_URL`, and none gives `withTenant` a role | **not in force**: the separation between organisations rests on each query's own tenant filter |
| The appliance's `withTenant` scopes (`apps/selfhost/src/index.ts`) | the bundled image's owner or PGlite's `postgres`, dropping to `app_user` with `SET LOCAL ROLE` | **in force** |
| The appliance's `PgLedger` and `PgCursorStore`, over `persistenceBackend.db` | the bundled image's owner or PGlite's `postgres`, both superusers | not in force; the appliance holds one organisation, so there is nothing to separate |
| The scripts in §2's table | the owner | not in force, by nature: they act across tenants at the machine |
| The commands an operator runs with their own `DATABASE_URL`: the cutover CLI (`apps/worker/src/cli/index.ts`), the standalone config-file worker (`apps/worker/src/index.ts`), the appliance's `forget-me` (`apps/selfhost/src/forget-me.ts`), and the two Drive measurements (`scripts/drive-export-stability.ts`, `scripts/drive-share-inheritance.ts`) | whatever that URL names (`forget-me` on PGlite: PGlite's `postgres`); none of them sets a role | **not in force** on a superuser's URL (the managed owner, the bundled image's owner, PGlite's `postgres`): each query's own filter, on a tenant or on one connection's id, is what separates. On an ordinary owner the `FORCE`d policies do apply, which is why the CLI calls the cutover store inside `withTenant` |

What that means in the managed edition: the database stops a query that forgets
its tenant in the API, and nothing stops one in a task. The task queries that
workplan 0138 read do carry their tenant filters; nobody has audited them all.
Every task run also holds `SECRET_ENCRYPTION_KEY`, so a task query that crossed
organisations could reach another organisation's stored credentials and the key
to decrypt them. Workplan 0138 T1 to T4 are the plan to move the per-tenant
tasks to `app_user` and keep the owner's reach to the jobs that span tenants.
Of them only T3's first step and T4 are built, and neither changes the role a
task connects as: a run no longer receives `DIRECT_DATABASE_URL` (§2's
`set-task-env.sh` row), and `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts`
fails if a file in `apps/worker/src` or `packages/*/src` that is not on its
lists reads a database URL other than `APP_DATABASE_URL`, with today's
per-tenant readers on a list that may only shrink and T1 empties. That guard
does not read `apps/api`; `scripts/a-route-that-opened-the-owners-pool.unit.test.ts`
does (0138 T6): a file in `apps/api/src` that reads a database URL other than
`APP_DATABASE_URL`, builds a pool of its own, or names a function that reads the
owner's URL or falls back to it (`migrationConnectionString`, and the
orchestration builders until T1 removes their fallback) must be on its closed
list of four, and no route may be on it. The process entry and `getDbPool()`'s
file hold request-path code too, so each is pinned to exactly what it reaches
and where; the operator script and the seed are exempt whole, and nothing
outside `apps/api/src/scripts` may import them. It does not see a connection
handed in: the audit key's pool of one (§2).

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
creation; `0055_the_two_tables_the_policies_missed.sql` brings in the two the
baseline never secured at all — `cutover_state` and `cutover_event`, which had
a `tenant_id` and grants and no policy, unnoticed because every reader was a
superuser until the API's cutover door read them as `app_user` (2026-09-20). FORCE means even the table's **owner** is subject to the policies —
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

- `APP_DATABASE_URL` → `app_user`. **The request path, always.** The API reads
  and writes tenant data through this, so row security is in force on its
  queries ("Where row security holds today"). **The deployed Trigger.dev tasks do not use it yet.**
  `set-task-env.sh` uploads it and no task reads it: every task connects with
  `DATABASE_URL`, the owner, so row security does not bind them (workplan 0138).
- `DATABASE_URL` → the DB owner. **Not the request path.** No route opens a
  pool on it (the permission report and the sharing rescan did until
  2026-09-28, 0138 T6); in the API it serves the migrations and the audit key's
  pool of one when `DIRECT_DATABASE_URL` is unset (the table above). It is for
  the acts performed AT THE MACHINE by whoever runs the
  deployment — the ones that by their nature span tenants, or precede one
  existing — and, until workplan 0138 lands, for every Trigger.dev task as
  well:

| who holds it | what for |
| --- | --- |
| `deploy/compose/bootstrap-managed.sh` | applies the migrations, and creates the `pgbouncer_auth` role |
| `deploy/compose/seed-managed.sh` | writes the demo tenants |
| `deploy/compose/operator.sh` | appoints operators, manages their memberships, and runs `check` / `clean` — all of which ask questions that span every tenant, which is why they are scripts and not routes (see `apps/api/src/scripts/operator.ts`) |
| `deploy/compose/set-task-env.sh` | uploads two database URLs into the Trigger.dev task environment, beside `SECRET_ENCRYPTION_KEY` and the optional values, and every run of every task receives both. `DATABASE_URL` (composed as `TASK_DATABASE_URL`) is the owner through the pooler: **every task connects with it today**, for tenant data too. `APP_DATABASE_URL` is `app_user`: no task reads it yet; 0138 T1 is to move the per-tenant tasks onto it. Until 0138 T3 step 1 it uploaded a third, `DIRECT_DATABASE_URL`, the owner straight to `postgres:5432`; no task read it, and no task runs migrations (the API and the seed do), so it no longer does. A plane that stored it keeps it until it is deleted once (`docs/managed-bring-up.md`, "Once, after the pull that stopped uploading `DIRECT_DATABASE_URL`") |

**That list is checked, not maintained by hand.**
`scripts/a-connection-the-docs-did-not-know-about.unit.test.ts` fails if a
script under `deploy/compose/` composes an owner URL and is not named above.
It used to read *"migrations and the demo seed only"*, which stopped being true
the day `operator.sh` was written (workplan 0093 T6) and stayed wrong because a
sentence in a document has nothing checking it.

Point the APP at the owner URL and tenant isolation silently disappears. That
is where the managed tasks are today ("Where row security holds today"): what
keeps one organisation's rows from another there is each query's own `WHERE`.

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

Most RLS tables carry four policies (SELECT / INSERT / UPDATE / DELETE), each
with the same tenant predicate:

```sql
tenant_id = (current_setting('app.current_tenant', true))::uuid
```

The newer migrations wrap the setting in `NULLIF(…, '')`, and `tenant` compares
its own `id`. Asked of `pg_policies` on 2026-09-27: 32 tables (126 policies)
still use the plain form above, 7 the `NULLIF` form.

No context set → no rows leak either way. On the `NULLIF` form it is zero rows.
On the plain form it is zero rows on a connection that never held a tenant,
and `invalid input syntax for type uuid: ""` on one that did: after a
transaction-local `set_config`, the setting reverts to the empty string, not to
unset (managed migration `0004` explains why, and converted `tenant_member`
for that reason).

Some tables also carry, or only carry, policies keyed on something other than
the tenant, each set transaction-locally by its own helper in `db.ts`:

- **the signed-in person** (`app.current_user`, `app.current_email`, set by
  `withSubject` and `withSubjectAndTenant`): `tenant_member` (your own
  memberships and invitations), `tenant` (an organisation you were invited to),
  `platform_operator` (your own operator row) and `support_read` (an operator's
  own reads);
- **an operator's row in `platform_operator`**: `access_request` and
  `platform_pause`, which also let anyone ask (`access_request`) and anyone read
  an open hold (`platform_pause`);
- **a grant link** (`app.current_link`, set by `withMappingLink`):
  `mapping_link`.

`grant_link_allowance` has one policy for every command, on the tenant, and
`vat_consultation` has SELECT and INSERT only. Read the policies themselves in
`pg_policies`; this paragraph is a map, not the contract.

None of this binds a superuser. "Where row security holds today" says which
connections are one.

## The RLS tables (all FORCEd)

Asked of `pg_class` on 2026-09-27, with both chains applied: 43 tables, every
one `FORCE`d. `force-rls.unit.test.ts` (ledger chain) and
`force-rls-managed.unit.test.ts` (managed chain) ask the same catalog, so this
list is a snapshot and those tests are the check.

**The ledger chain** (`packages/ledger/migrations`, both editions), 28:
`apply_receipt`, `audit_log`, `backup_target`, `collection_mapping`,
`connection`, `cursor`, `cutover`, `cutover_event`, `cutover_state`,
`decision`, `group_def`, `item`, `mailbox`, `mailbox_mapping`, `mapping_link`,
`migration_discovery`, `migration_status`, `path_lifecycle`, `policy_preset`,
`run`, `run_event`, `scope_selection`, `setup_step`, `share_grant`,
`sync_checkpoint`, `tenant`, `verification`, `verification_run`.

**The managed chain** (`packages/managed/migrations`, managed only), 15:
`access_request`, `billing_party`, `bytes_moved`, `grant_link_allowance`,
`invoice`, `occupancy_peak`, `payment_method`, `platform_operator`,
`platform_pause`, `support_read`, `tenant_closure`, `tenant_member`,
`tenant_pricing`, `usage_metric`, `vat_consultation`.

`cutover_state` and `cutover_event` came under row security in `0055`. The
cutover job, the rollback job and the operator CLI read those two through
`tenantCutoverStore` (`packages/ledger/src/cutover-store.ts`), which runs every
call inside `withTenant`; the API's cutover door reads them through
`withTenantDb`. Inside `withTenant` is not the same as under the policies: the
jobs' `withTenant` runs on the owner's connection ("Where row security holds
today").

Two tables have no row security and no `tenant_id`: `deployment_key` (ledger
`0062`, the audit export's key, which `app_user` may not read at all) and
`erasure_record` (managed chain).

A future migration that adds an RLS table and forgets `FORCE` fails
`force-rls.unit.test.ts` (or, in the managed chain,
`force-rls-managed.unit.test.ts`) **by name** — the test reads
`pg_class.relforcerowsecurity` for every RLS table rather than keeping its
own list. The same file asks the question that check could not: **which table
with a `tenant_id` column has no row security at all** (`pg_class.relrowsecurity`
joined to `pg_attribute`). That is the question `cutover_state` and
`cutover_event` were the answer to for the whole life of the baseline. Three
tables answer it on purpose. `rate_budget` (`0024`) and `byte_budget` (`0030`):
system-level code consults them with no tenant context, they carry no personal
data, and a cross-tenant read reveals nothing. `app_event` (`0059`), the
application's own errors and warnings: system-level code writes it, often with
no tenant at all, it holds metadata only, and `app_user` may insert into it and
nothing else, so no customer reads it. Their migrations say
`NO ROW-LEVEL SECURITY, deliberately`, and that sentence, in the file that
creates the table, is the only exemption the guard accepts.

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
  grep for. The managed Trigger.dev tasks are in this state today, and the
  permission report's pool was until 2026-09-28 ("Where row security holds
  today").
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
