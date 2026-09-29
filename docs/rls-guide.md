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
> `DIRECT_DATABASE_URL` (§2's `set-task-env.sh` row). And on 2026-09-28 for
> 0138 T1 step 1: the builders build on the job's pool, the ledger, cursor and
> verification stores a pass builds run each statement inside `withTenant`
> (`tenantScopedDb`, §3), what is left outside a scope is named (the task row
> under "Where row security holds today"), and no task changed the role it
> connects as. Later the same day, for 0138 T1 step 2: the eight per-tenant
> tasks and the standalone worker connect as `app_user` (`openTaskPools`,
> `apps/worker/src/jobs/task-pools.ts`), their audit key is read on a pool of
> one of the owner's, and the task row is three rows now.
>
> Updated 2026-09-28 (0138 T6): the permission report and the sharing rescan
> read as `app_user` inside `withTenant`, like every other route, so no route
> reads tenant data on the owner's connection. A request still reaches the
> owner in two places, for the audit pseudonym key only, through `index.ts`'s
> pool of one (its row under "Where row security holds today").
>
> Updated 2026-09-28 (0138 T2): the digest, the drift detector and group
> discovery are split in two. Their one question across organisations, which
> ones are active, is read on the owner's connection by `activeOrganisations`
> (`task-pools.ts`), ids only; everything they read or write for one
> organisation is in that organisation's scope on the tenant pool, `app_user`.
> The three jobs that span organisations whole (the tick, retention, the purge)
> are the only tasks left on the owner's connection for tenant data, until T3
> step 2.
>
> Updated 2026-09-28 (0138 T3 step 2): no task connects as the owner any more.
> The three jobs that span organisations whole, the split jobs' list and every
> task's audit key connect as the system role, `ownpace_system`
> (`SYSTEM_DATABASE_URL`, managed migration 0033): `BYPASSRLS`, which their
> questions across organisations need, and the grants their statements need,
> and no superuser, no role or database of its own, a member of no role and
> no role a member of it. `set-task-env.sh` uploads its URL, and, in a run of
> its own after the tasks are deployed, deletes the owner's `DATABASE_URL` and
> `DIRECT_DATABASE_URL` from the task environment; the bring-up and
> `set-task-env.sh` itself refuse to upload the URL when Postgres says the role
> is a superuser, may create roles, or shares a membership either way (§2).

## What RLS buys here

Row-Level Security is the Postgres feature that filters every query by a
session predicate. In this stack it is the **tenancy boundary of the managed
edition**: on a connection it binds, Tenant A can never read or write Tenant
B's rows, even through a bug in application-level filtering, because the
database itself refuses. **It binds only some of the connections today**: the
API's request path, the managed edition's eight per-tenant Trigger.dev tasks, and
everything the digest, the drift detector and group discovery read for one
organisation, yes; the three managed jobs that span organisations whole (the
sync tick, retention, the purge of closed organisations), no: they connect as
the system role, which bypasses row security on the tables it is granted and is
not a superuser (0138 T3 step 2). The next section says which, and
[workplan 0138](./workplans/0138-tasks-under-row-security.md) says what is left
(its T3 step 3, parked). The self-host appliance runs the **same schema and
the same policies**, and its `withTenant` scopes drop to `app_user`, but its
ledger and cursor stores run outside them (the next section).

## Where row security holds today

Checked against the code and against a database with both migration chains
applied, 2026-09-27, and the task rows again on 2026-09-28 (0138 T1 step 2, T2
for the three jobs split in two, and T3 step 2 for the system role).
Postgres never applies row security to a superuser,
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
| **The eight per-tenant Trigger.dev tasks** (`run-delta-sync`, `run-discovery`, `run-verification`, `run-confirmation`, `run-apply-deletion`, `run-apply-relocation`, `run-cutover`, `run-rollback`), and the standalone worker (`apps/worker/src/index.ts`): the tenant pool `openTaskPools` builds (`apps/worker/src/jobs/task-pools.ts`) on `APP_DATABASE_URL`, and the builders they hand it to (`buildDepsFromMapping`, `buildDomainDepsFromMapping`, `createLedgerVerificationReader`) | `app_user`, since 0138 T1 step 2 (2026-09-28). `openTaskPools` refuses to start without `APP_DATABASE_URL` and never falls back to `DATABASE_URL`. Every store and read a pass makes runs inside `withTenant` for its tenant: the ledger, cursor and verification stores on `tenantScopedDb`, the helper reads (`enabledDomains`, `stoppedDomains`, `targetProviderKey`, the rollback's mapping name, the step before each data type), the organisation's own `tenant` row, which the step and both builders read to refuse a closed organisation (`organisationIsOpen`, 0085 T2; outside a scope `app_user` would find no row there, and every pass would stop as closed), and the run, status, receipt, cutover and confirmation writes in scopes of their own. Two things it touches need no scope and have none: the rate and byte budgets (`plainDb`: their tables have no row security, by design) and the operator's log page's events (`app_event`, which `app_user` may insert into and not read) | **in force** |
| The same tasks' audit key: `openTaskPools`'s second pool, on `SYSTEM_DATABASE_URL` | the system role, `ownpace_system` (not a superuser; 0138 T3 step 2, the owner until then); one connection, closed a second after its last use | not needed: it reads `deployment_key` only, which holds no tenant's rows and which ledger migration 0062 closes to `app_user`; managed migration 0033 grants it to the system role. It is the API's audit key pool, in a task |
| **The three scheduled jobs split in two** (`managed-digest`, `managed-drift-detect`, `managed-group-discovery`, 0138 T2), everything they read or write for one organisation: the tenant pool `openTaskPools` builds, opened in the run and ended in `afterwards` | `app_user`, since 0138 T2 (2026-09-28). Each organisation's reads and writes run in its own scope: the digest's organisation row (name and notification settings), recipients, migrations, their queues through the ledger, pending decisions, last send and the audit row recording this one; the drift detector's coverage, Microsoft sources, dismissed decisions, standing preset and the decisions it raises and closes; group discovery's source connections, the groups it records and the decisions it raises. `withTenant` for a job's own reads, `tenantScopedDb` for the ledger, decision, preset and group stores. The operator's log page's events go to the same pool (`app_event`, insert only), the audit lines to the key's pool below | **in force**. `apps/worker/src/jobs/a-job-that-reads-each-organisation-as-itself.integration.test.ts` runs each job's per-organisation half on the pools it opens, as `app_user`, for two organisations |
| The same three jobs' one question across organisations: `activeOrganisations` (`task-pools.ts`), on `SYSTEM_DATABASE_URL` | the system role, `ownpace_system` (the owner until 0138 T3 step 2); one connection, closed before it answers | not needed: one statement, the ids of the active organisations (`SELECT id FROM tenant WHERE status = 'active'`), no other column and no other table. It first asks whether its connection sees every organisation, and refuses when it does not: on `app_user`, with no organisation set, `tenant` answers no row, and a job handed that empty list would visit nobody and call it a quiet morning; the system role sees them because it has `BYPASSRLS`. Until T2 each of the three read its list and every organisation's rows on its own owner pool, and group discovery's list was every source connection across organisations, with its config |
| **The three scheduled Trigger.dev jobs** that span organisations whole (`managed-sync-tick`, `managed-retention`, `managed-purge-closed`) | the system role, `ownpace_system`, since 0138 T3 step 2: each builds its pool from `SYSTEM_DATABASE_URL` and refuses without it, never `DATABASE_URL`. `LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS`, a member of no role and no role a member of it, and the grants their statements need (managed migration 0033): what the tick reads across organisations, what retention prunes, and what the purge reads, updates and deletes, each table the purge only empties readable by its `tenant_id` alone. The tick reads every organisation's `tenant.status` in one statement to start no pass for a closed one (`AN_OPEN_ORGANISATION_WHERE`, 0085 T2), which on `app_user` would find no organisation open. Until step 2 the owner, a superuser | **not in force**, by design: `BYPASSRLS` reads past the policies on the tables it is granted, and the separation between organisations rests on each query's own tenant filter. What step 2 changed is that no run holds a superuser's credential: no program on the server, no file of the server's, no other role changed, no permanent table made or altered (a temporary one, which lives and dies with its session, as PUBLIC may on every database), and no table read that the jobs do not ask for, whoever the grant was written to, PUBLIC included |
| The appliance's `withTenant` scopes (`apps/selfhost/src/index.ts`) | the bundled image's owner or PGlite's `postgres`, dropping to `app_user` with `SET LOCAL ROLE` | **in force** |
| The appliance's `PgLedger` and `PgCursorStore`, over `persistenceBackend.db` | the bundled image's owner or PGlite's `postgres`, both superusers | not in force; the appliance holds one organisation, so there is nothing to separate |
| The scripts in §2's table | the owner | not in force, by nature: they act across tenants at the machine |
| The commands an operator runs with their own `DATABASE_URL`: the cutover CLI (`apps/worker/src/cli/index.ts`), the appliance's `forget-me` (`apps/selfhost/src/forget-me.ts`), and the two Drive measurements (`scripts/drive-export-stability.ts`, `scripts/drive-share-inheritance.ts`) | whatever that URL names (`forget-me` on PGlite: PGlite's `postgres`); none of them sets a role | **not in force** on a superuser's URL (the managed owner, the bundled image's owner, PGlite's `postgres`): each query's own filter, on a tenant or on one connection's id, is what separates. On an ordinary owner the `FORCE`d policies do apply, which is why the CLI calls the cutover store inside `withTenant`, and why the stores its `reindex` builds are tenant-scoped since 0138 T1 step 1 |

What that means in the managed edition: the database stops a query that forgets
its tenant in the API, in a per-tenant task and in the per-organisation half of
the three split jobs, and nothing stops one in the three jobs that span
organisations whole. The queries of those three that workplan 0138 read do
carry their tenant filters; nobody has audited them all. Every task run also
holds `SECRET_ENCRYPTION_KEY`, so a query in one of them that crossed
organisations could reach another organisation's stored credentials and the key
to decrypt them. Workplan 0138 T1 to T4 moved the per-tenant tasks to
`app_user` and kept the reach across organisations to the jobs that need it,
on a role of their own that is not a superuser. All four are built (T3's third
step, no credential across organisations in a run at all, is parked until the
service admits people the owner has not let in). T1's second step is the switch:
the eight per-tenant tasks take their pools from `openTaskPools`, the tenant
pool on `APP_DATABASE_URL`, `app_user`, and every scope in them is under the
policies (`apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts`
builds them on `app_user` and checks they see one organisation, that the
writes read back, that an audit event still prints its line, and that a
closed organisation's pass stops while an open one's runs). The audit
export reads its key, which `app_user` may not, on a pool of one of the
system role's (the owner's until T3 step 2), and nothing else goes there:
`openTaskPools` hands a task the tenant pool and its end, and keeps the key's
pool for the sink.
`scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` fails if a file in
`apps/worker/src` or `packages/*/src` that is not on its closed list reads a
database URL other than `APP_DATABASE_URL`, if a per-tenant task builds a pool
or points a sink itself, takes anything from `openTaskPools` but the tenant
pool and its end, or names an `end`, on any name, anywhere but in a function
it hands to `afterwards` (so a failed run's event reaches the log page, which
is on that pool, before it closes: `pool.end()` on `const pool = pools.tenant`
counts as much as `pools.end()`; it reads the task's own file, so it does not see
an end inside a function in another file that the pool is handed to; none
has one), if any
file but the module names the key's pool, or if the module does anything at
import. T2 split the digest, the drift detector and group discovery the same
way: each opens `openTaskPools` in its run and ends it in `afterwards`, takes
its list of organisations from `activeOrganisations`, and reads and writes
every organisation in that organisation's scope. The same guard holds them as
its third kind, `SPLIT`, closed, each entry saying why the job crosses
organisations and what it reads per organisation: a split job reads no
database URL and builds no pool; it names its tenant pool only as the first
argument of `withTenant` or `tenantScopedDb` (or hands it to a function of its
own file whose `Pool` parameter the rule reads in turn), since a statement on
that pool outside a scope finds nothing; and only the three and the module
name `activeOrganisations`. No URL and no pool of its own did not keep the
owner's connection out of a split job: review added one export to the module
that handed its caller the list's pool, and read every organisation on it from
a split job and from a per-tenant one with every guard green. So the same
guard closes the module at both ends (its rule 7): `task-pools.ts` exports
`openTaskPools`, `activeOrganisations` and the list's text, and types, and
nothing else; imports only its own short list, so no query builder and no
schema; names each pool it builds on the owner's URL (the key's, the list's)
only to ask it the list or the question whether it sees every organisation,
each by name and each held to its literal, to end it, to hear its errors, or,
the key's, as the audit sink's driver, never returned or handed on; and
declares `activeOrganisations` as `Promise<string[]>`, returning
`rows.map((row) => row.id)`. A per-tenant job and the standalone worker take
`openTaskPools` from it and a split job that and `activeOrganisations`, nothing
else (types aside), and none of them imports a value from another file on the
guard's cross-tenant list. It reads each file's own imports: a pool of the
owner's handed on through a module in between would be out of its sight, and
no file on that list exports one. What no static rule tells is a
per-organisation read in the wrong organisation's scope.
`apps/worker/src/jobs/a-job-that-reads-each-organisation-as-itself.integration.test.ts`
is for that: it runs each job's per-organisation half on the pools it opens,
for two organisations, with every queue the digest counts seeded and A's
numbers never B's: each produces the digest (every line of each
organisation's mail compared), the findings and the groups it produced on the
owner's, as `app_user`, on no pool but the tenant pool and the audit key's,
one connection at a time; the list names the active ones and refuses on
`app_user`; and the jobs' own statements outside a scope find nothing. It
runs the halves, not the tasks' `run` bodies, which the static rules above
hold. Since T3 step 2 the same guard's rule 8 holds who reads which URL across
organisations: the three jobs that span them and `task-pools.ts` read
`SYSTEM_DATABASE_URL` and no other database URL, the operator's CLI and
`direct-url.ts`, which never run in a task, never read it, and no other file
does; `scripts/a-run-that-carries-no-superuser.unit.test.ts` holds
`set-task-env.sh` to uploading the system role's URL, nothing composed from
the owner's user or password under any name, neither of the owner's two names,
and to deleting both from the store and reading the list back; and
`scripts/a-superuser-the-bring-up-would-have-uploaded.unit.test.ts` holds the
bring-up to asking Postgres, before the upload, whether the role is a
superuser or may create roles, and refusing if it is or may.
`apps/worker/src/jobs/a-system-role-that-is-not-the-owner.integration.test.ts`
asks a database with both chains what the role is and holds (its attributes,
no membership, and every grant, table by table and column by column, against a
list of its own), runs the tick, retention and the purge as it, and is refused
what it was not given. The first guard does not read `apps/api`;
`scripts/a-route-that-opened-the-owners-pool.unit.test.ts` does (0138 T6): a
file in `apps/api/src` that reads a database URL other than `APP_DATABASE_URL`,
builds a pool of its own, or names a function that reads the owner's URL or
opens a pool on the URL it is handed (`migrationConnectionString`,
`poolerInFront`, `createLedgerVerificationReader`; the orchestration builders
left that list when T1's first step removed their fallback) must be on its
closed list of four, and no route may be on it. The process entry and
`getDbPool()`'s file hold request-path code too, so each is pinned to exactly
what it reaches and where; the operator script and the seed are exempt whole,
and nothing outside `apps/api/src/scripts` may import them. It does not see a
connection handed in: the audit key's pool of one (§2).

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
  queries ("Where row security holds today"). **The eight per-tenant
  Trigger.dev tasks use it too**, since 0138 T1 step 2: `openTaskPools` builds
  their tenant pool on it and on nothing else, and refuses to start without it.
  So do the digest, the drift detector and group discovery for everything they
  read or write about one organisation, since 0138 T2. The three jobs that span
  organisations whole do not: they are the system role's (below).
- `DATABASE_URL` → the DB owner. **Not the request path.** No route opens a
  pool on it (the permission report and the sharing rescan did until
  2026-09-28, 0138 T6); in the API it serves the migrations and the audit key's
  pool of one when `DIRECT_DATABASE_URL` is unset (the table above). It is for
  the acts performed AT THE MACHINE by whoever runs the
  deployment — the ones that by their nature span tenants, or precede one
  existing. **No Trigger.dev task holds it** since workplan 0138 T3 step 2:
  `set-task-env.sh` uploads nothing composed from it and deletes the names it
  went up under (`DATABASE_URL`, `DIRECT_DATABASE_URL`) from the task
  environment. At the machine, these hold it:

| who holds it | what for |
| --- | --- |
| `deploy/compose/bootstrap-managed.sh` | applies the migrations, creates the `pgbouncer_auth` role, and, in its `tasks` phase, asks what the system role may do and sets its password (below) |
| `deploy/compose/seed-managed.sh` | writes the demo tenants |
| `deploy/compose/operator.sh` | appoints operators, manages their memberships, and runs `check` / `clean` — all of which ask questions that span every tenant, which is why they are scripts and not routes (see `apps/api/src/scripts/operator.ts`) |
| `deploy/compose/rotate-db-passwords.sh` | acts as the owner without composing a URL: `psql` over the database container's socket, as `POSTGRES_USER`, to list the login roles and to `ALTER ROLE` the owner and `app_user` to `.env`'s values (`--sync`, `--rotate`; the functions are `db-roles.sh`'s, which T2 (b)'s bring-up is to call). It asks each password over the stack's network and through PgBouncer, and prints no value (workplan 0132 T2; `docs/managed-bring-up.md`, "Changing the database passwords") |

`deploy/compose/set-task-env.sh` held it until 0138 T3 step 2 and holds it no
more: it uploads two database URLs into the Trigger.dev task environment,
beside `SECRET_ENCRYPTION_KEY` and the optional values, and every run of every
task receives both. `SYSTEM_DATABASE_URL` (composed as
`TASK_SYSTEM_DATABASE_URL`, from the system role's name and `.env`'s
`SYSTEM_DB_PASSWORD`) is the system role through the pooler: **the three jobs
that span organisations whole connect with it**; the three split jobs (the
digest, the drift detector, group discovery) read their list of organisations
on it, ids only; and every task that opens `openTaskPools` reads it for the
audit key's pool of one. `APP_DATABASE_URL` is `app_user`: the eight per-tenant
tasks read and write tenant data through it since 0138 T1 step 2, and the three
split jobs every organisation's rows since 0138 T2. Until T3 step 1 it also
uploaded `DIRECT_DATABASE_URL`, the owner straight to `postgres:5432`, and
until step 2 `DATABASE_URL`, the owner through the pooler; it deletes both from
the store now, in a run of its own (`set-task-env.sh --forget-owner-names`)
that the bring-up makes only after `deploy-tasks.sh` has put the new tasks in
place, so a deploy that fails leaves the old tasks the URL they read, and that
run fails when the list it reads back still holds either (`docs/managed-bring-up.md`, "The owner's names in the task
environment").

- `SYSTEM_DATABASE_URL` → **the system role, `ownpace_system`** (0138 T3 step
  2, managed migration 0033). **The jobs that span organisations, and nothing
  else**: the sync tick, retention and the purge of closed organisations for
  everything, the split jobs' list of organisations, and every task's audit key.
  `LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS`, a member
  of no role, **and no role a member of it**: a role it belonged to would lend
  it that role's rights with `SET ROLE`, and a role that belonged to it
  (`GRANT ownpace_system TO app_user`) would take its `BYPASSRLS` the same way,
  so the API's own request role would read every organisation's rows. **`BYPASSRLS` is required**: their questions cross organisations
  (which mappings are due, who is closed and past their window, which runs to
  prune), and on a role row security binds, with no organisation set, every
  row-secured table answers nothing, so each job would do nothing and say so as
  a quiet night. It reads past the policies on the tables it is granted, and
  its grants are the statements those jobs send, each table the purge only
  empties readable by its `tenant_id` alone; no default privileges, so a table
  added later is not its own until a migration says so. **A grant to PUBLIC is
  one of its grants too**: with `BYPASSRLS`, `GRANT SELECT ON <a tenant table>
  TO PUBLIC`, which reads as harmless under row security for `app_user`, hands
  it every organisation's rows, and so does a `SECURITY DEFINER` function left
  with PUBLIC's default `EXECUTE`. The integration guard compares what it may
  actually do with its list. It is not the owner: no program on the server,
  none of the server's files, no other role created or changed, no permanent
  table made or altered (PUBLIC's `TEMPORARY` on the database lets it make a
  temporary one, which lives and dies with its own session). It can still
  change its own password and its own settings, as any role can; the bring-up
  sets the one and clears the other on every run. The migration gives it no
  password; `ensure-env-secrets.sh` generates `SYSTEM_DB_PASSWORD`, and the
  bring-up's `tasks` phase asks Postgres whether the role is a superuser, may
  create roles or databases, replicates, belongs to a role, has a role
  belonging to it, or lacks `BYPASSRLS` or `LOGIN`, **refuses to go on if it
  is, may or does**, then sets the password, clears every setting on the role,
  and proves it opens where the tasks connect (`db_roles_system_fit`,
  `db_roles_system_set`, `deploy/compose/db-roles.sh`); `set-task-env.sh` asks
  the same question before every upload, the bring-up's or one run by hand, and
  uploads nothing on a wrong answer. Every run still
  receives this URL, because Trigger.dev stores variables per environment; a
  run that had been taken over could read past the policies with it. 0138's T3
  step 3, parked until the service admits people the owner has not let in,
  replaces it with functions the owner owns.

**That list is checked, not maintained by hand.**
`scripts/a-connection-the-docs-did-not-know-about.unit.test.ts` fails if a
script under `deploy/compose/` composes an owner URL and is not named above.
It used to read *"migrations and the demo seed only"*, which stopped being true
the day `operator.sh` was written (workplan 0093 T6) and stayed wrong because a
sentence in a document has nothing checking it.

Point the APP at the owner URL and tenant isolation silently disappears. The
three managed jobs that span organisations whole are past the policies too, by
design and on a narrower credential, the system role's ("Where row security
holds today"): what keeps one organisation's rows from another there is each
query's own `WHERE`. It is also why `openTaskPools` has
no fallback to `DATABASE_URL`: a per-tenant task that took one would be back
there with nothing to say so. And it is why `activeOrganisations` has no
fallback the other way: the list read on `app_user` finds no organisation, and
a split job handed it would visit nobody, so it asks its connection first and
refuses.

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

**A store that lives for a whole pass gets `tenantScopedDb(driverOrPool,
tenantId)`** (0138 T1). It is a drizzle handle each of whose statements runs
inside `withTenant` for that tenant, one transaction per statement, so a store
can hold it for minutes without holding a transaction open, and `withTenant`
stays the one place the tenant is set. It refuses `BEGIN`, `COMMIT` and the
rest, and so `db.transaction()`: each statement is its own scope, so work
between them would not be atomic. For work that must commit together, use
`withTenant` itself. It speaks node-postgres only; on PGlite use `withTenant`.
The rate and byte budgets, whose tables have no row security by design, get a
plain handle on the same pool (`plainDb`).

## Policies

Most RLS tables carry four policies (SELECT / INSERT / UPDATE / DELETE), each
with the same tenant predicate:

```sql
tenant_id = (current_setting('app.current_tenant', true))::uuid
```

The newer migrations wrap the setting in `NULLIF(…, '')`, and `tenant` compares
its own `id`. Asked of `pg_policies` on 2026-09-28: 32 tables (126 policies)
still use the plain form above, 9 the `NULLIF` form.

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
`vat_consultation` has SELECT and INSERT only. `person` has one policy for every
command, on the tenant. `person_migration`'s adds to it that a row it writes
names a migration of that tenant (managed `0031`). Its key already holds the
person to that tenant, and a key is checked past row security, so the policy is
what holds the migration. `legal_acceptance` (managed `0032`, workplan 0139 T3)
has SELECT and INSERT only, on the tenant, and an insert must name one of that
tenant's members; UPDATE and DELETE are revoked from `app_user` as well, so a
record of what somebody accepted cannot be rewritten on the request path. It
has no key to `tenant_member`, on purpose: removing a member leaves their rows,
which the organisation keeps until its data is erased (privacy §9's row), and
a member invited back is not asked again for a version they accepted there.
The erasure purge is the one deleter (`PURGED_TABLES`): the rows go with the
organisation, the owner's answer to 0139 open question 4 on 2026-09-29. Read
the policies themselves in
`pg_policies`; this paragraph is a map, not the contract.

None of this binds a superuser. "Where row security holds today" says which
connections are one.

## The RLS tables (all FORCEd)

Asked of `pg_class` on 2026-09-28, with both chains applied: 46 tables, every
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

**The managed chain** (`packages/managed/migrations`, managed only), 18:
`access_request`, `billing_party`, `bytes_moved`, `grant_link_allowance`,
`invoice`, `legal_acceptance`, `occupancy_peak`, `payment_method`, `person`, `person_migration`,
`platform_operator`, `platform_pause`, `support_read`, `tenant_closure`,
`tenant_member`, `tenant_pricing`, `usage_metric`, `vat_consultation`.

`cutover_state` and `cutover_event` came under row security in `0055`. The
cutover job, the rollback job and the operator CLI read those two through
`tenantCutoverStore` (`packages/ledger/src/cutover-store.ts`), which runs every
call inside `withTenant`; the API's cutover door reads them through
`withTenantDb`. Inside `withTenant` is not the same as under the policies: it
is under them on `app_user`, which the two jobs connect as since 0138 T1 step 2,
and not on a superuser's connection, which the CLI has when its operator's URL
is the owner's ("Where row security holds today").

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
- `packages/ledger/src/a-handle-scoped-to-one-tenant.unit.test.ts` —
  `tenantScopedDb` wraps each statement in `withTenant`, builds no drizzle
  handle per statement, and refuses the statements that would open or end a
  transaction (0138 T1).
- `apps/worker/src/jobs/a-task-pool-that-fell-back-to-the-owner.unit.test.ts`
  — `openTaskPools` refuses without `APP_DATABASE_URL` and never takes
  `DATABASE_URL` in its place, the audit key's pool is one connection on the
  system role's URL, `SYSTEM_DATABASE_URL`, never `DATABASE_URL` (0138 T3
  step 2), the audit export asks that pool for its key and the log page's
  events go to the tenant pool, and importing the module builds nothing
  (0138 T1 step 2). And `activeOrganisations` refuses without
  `SYSTEM_DATABASE_URL` and never takes `APP_DATABASE_URL` or `DATABASE_URL`
  in its place, asks one connection on the system role's URL whether it sees
  every organisation before it reads the list, refuses when it does not, and
  ends that connection before it answers (0138 T2, T3 step 2).

**In the integration gate (`pnpm test:integration` — real Postgres via
testcontainers):**

- `packages/ledger/src/rls.integration.test.ts` — policy correctness as
  `app_user` (cross-tenant reads/writes refused per table).
- `packages/ledger/src/rls-in-force.integration.test.ts` — the driver-path
  proof again, on the container backend.
- `apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts` — a
  per-tenant pass's handles, built on an `app_user` pool the way the jobs build
  them, see one organisation's rows and read back what they write, and the
  cutover gate and the rollback's name read answer for that organisation; and
  on the pools `openTaskPools` opens, the pass runs as `app_user`, an audit
  event it records still prints its line, and its log page events, budgets,
  run, status, first-copy bytes and confirmation reads all work there
  (0138 T1); and its organisation's status is read in its scope, so a closed
  organisation's pass stops before its next data type and neither builder
  builds, while an open one's runs (0085 T2).
- `apps/worker/src/jobs/a-job-that-reads-each-organisation-as-itself.integration.test.ts`
  — the digest, the drift detector and group discovery, split in two (0138
  T2): the list names the active organisations and refuses on `app_user`; each
  job's per-organisation half, on the pools the job opens, produces for each
  of two organisations what it produced on the owner's (the mail and its
  recipients, every queue it counts seeded with A's numbers never B's and
  each line compared, the relocations counted since that organisation's own
  last digest; the new mailboxes, a dismissal and a standing answer honoured;
  the groups and the question asked), as `app_user`, on no pool but the tenant
  pool and the audit key's, one connection at a time; and each of the jobs'
  own statements answers in its organisation's scope and finds nothing
  outside one. It runs the halves, not the tasks' `run` bodies.
- `apps/worker/src/jobs/a-system-role-that-is-not-the-owner.integration.test.ts`
  — the system role (0138 T3 step 2): exactly its attributes (`LOGIN`, no
  superuser, no `CREATEROLE`, `CREATEDB` or `REPLICATION`, `BYPASSRLS`), a
  member of no role and no role a member of it, and exactly its grants, table
  by table and column by column, against a list of its own, twice: as written
  to its name, and as what it may actually do (`has_table_privilege`,
  `has_column_privilege`), which counts a grant to PUBLIC; no `SECURITY
  DEFINER` function it may call, no sequence, no schema to create in, no
  default privileges for PUBLIC, and on the database only PUBLIC's `CONNECT`
  and `TEMPORARY`; the bring-up's own question and the smoke's, asked of the
  database, answer fit; a setting the role leaves on itself is gone after the
  bring-up's statements; logged in as it, the tick's `run` (under a hold and
  free), retention's and the purge's run to their ends against two active
  organisations and one closed past its window (its person and the migration
  that is theirs erased with it), the list, the audit key and the log page;
  and it is refused a role, a database, `SET ROLE` to the owner, a member of
  its own, the server's files and programs, a permanent table of its own, the
  columns and tables it was not granted, and every write it was not granted.
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
  grep for. The three managed jobs that span organisations whole were in this
  state until 0138 T3 step 2 and are past the policies still, on the system
  role, which is no superuser; the digest, the drift detector and group
  discovery were until 0138 T2, and the permission report's pool was until
  0138 T6 (all 2026-09-28; "Where row security holds today").
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
