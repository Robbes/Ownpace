# Workplan 0138 — Tasks under row security

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that the
Trigger.dev tasks read and write tenant data as the database owner, and that the owner is a
superuser on this stack. Postgres never applies row security to a superuser. In the task plane,
then, the separation between organisations rests on each query's own `WHERE` clause and nothing
else, while the documents say the tasks run under row security (the review named three; §1 lists
the rest). The finding is `sec-worker-bypasses-rls` (high, confirmed; one side claim in it is too
broad, see §1). None of the questions and blockers the owner answered on 2026-09-24 was about
it. 0131 T5 makes it a row of the go/no-go: *"Built, or accepted in writing with the reason
stated."* T0 is that choice.

Nothing is built. Each fact in §1 was checked on 2026-09-24 at the current checkout and against
`origin/main`, which is ahead of it. On `main` every task file also builds an audit sink on its
pool (0129 T4), and the cutover gate has moved to `cutover-gate.ts`. The connection each task
uses is the same in both. Where the two differ, §1 says which it cites. Nothing was exercised
against the live stack.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's answer: build first, or accept in writing | ⏳ **Owner** | §4 and open question 1. 0131 T5's row for this plan. Recommended: accept in writing for the alpha, with T5's first step, T3's first step and T4 in place before the first invitation. |
| T1 Per-tenant tasks read and write as the application role | 📋 **Proposed** | §3. Eight jobs, the builders that open their own ledger from `DATABASE_URL`, the stores that filter by their own `WHERE`, and (on `main`) the audit sink's key. Changing the URL is not enough on its own: under row security, a query with no tenant set reads nothing. |
| T2 The owner's reach kept to the jobs that span tenants | 📋 **Proposed**, with T1 | §3. The sync tick, retention and the purge. The digest, the drift detector and group discovery keep it for the list of tenants only (open question 3). |
| T3 No superuser in a run's environment | 📋 **Proposed**; step 1 is small | §3. Step 1: stop uploading `DIRECT_DATABASE_URL`, which no task reads. Step 2: T2's jobs connect as a role that is not a superuser. Step 3: 🅿️ **Parked (trigger: the service admits people the owner has not let in personally)**. |
| T4 A guard that fails when a per-tenant job opens the owner's pool | 📋 **Proposed** | §3. A closed list of the files that may read a database URL other than `APP_DATABASE_URL`. Under T0's option (b) it lands first as a ratchet. |
| T5 The documents say which connection the tasks use | 📋 **Proposed**; step 1 before the first invitation | §3. Step 1: what is true today. Step 2: what T1 to T3 built. The legal texts' sentence goes to 0139. |

## 1. What there is today

### Which connection a task uses

- **What every run receives.** `deploy/compose/set-task-env.sh` uploads the task environment to
  Trigger.dev. Its `variables` object always contains `DATABASE_URL` (composed from
  `${POSTGRES_USER}`, the owner, through the pooler), `APP_DATABASE_URL` (`app_user`, through the
  pooler), `DIRECT_DATABASE_URL` (the owner again, straight to `postgres:5432`) and
  `SECRET_ENCRYPTION_KEY`. Trigger.dev stores variables per environment, not per task, so every
  run of every task gets all four.
- **What the tasks read.** Every job in `apps/worker/src/jobs/` that touches the database builds
  its pool from `process.env.DATABASE_URL`. There are eight per-tenant jobs: `run-delta-sync`,
  `run-discovery`, `run-verification`, `run-confirmation`, `run-apply-deletion`,
  `run-apply-relocation`, `run-cutover` and `run-rollback`. There are six scheduled jobs:
  `managed-sync-tick`, `managed-retention`, `managed-purge-closed`, `managed-digest`,
  `managed-drift-detect` and `managed-group-discovery`.
- **What they do not read.** No task reads `APP_DATABASE_URL` or `DIRECT_DATABASE_URL`. No code
  in `apps/worker/src` or `packages/*/src` reads `APP_DATABASE_URL`; in the worker it appears only
  in its README. Its one runtime reader is the API's `getDbPool`
  (`apps/api/src/middleware/auth.ts`), which `managed.yml` gives the application role. The one
  package function that reads `DIRECT_DATABASE_URL`, `migrationConnectionString`
  (`packages/ledger/src/direct-url.ts`), reads it from the environment its caller passes, and its
  callers are the API and the seed. The tasks do not run migrations either. `runMigrations` is
  called by the API, the appliance and the seed, never by the worker.
- **The builders open their own ledger.** The two builders a pass calls read `DATABASE_URL`
  themselves and open a handle on it with `createPgDb`: `buildDepsFromMapping` and
  `buildDomainDepsFromMapping` (`packages/orchestration/src/build-deps-from-mapping.ts`, once per
  data type). `run-verification` and the cutover gate (inside `run-cutover.ts` at the checkout,
  `cutover-gate.ts` on `main`) pass the same URL to `createLedgerVerificationReader`, which opens
  another pool. Two more readers of `DATABASE_URL` sit in the same package but off the task path:
  `openLedger` (`build-deps.ts`), which the dev entrypoint reaches through `runAllDomains`, and
  `verifyMapping` (`orchestration.ts`), which only the appliance calls, with its own handle.
- **`withTenant` drops privileges only when asked.** `withTenant` (`packages/ledger/src/db.ts`)
  sets `app.current_tenant` for one transaction. It switches to a less privileged role with
  `SET LOCAL ROLE` only when the driver carries one. No job gives it one. The jobs pass the pool
  itself to `withTenant`, and wrap it as `pgDriver(pool)`, with no role, only for the event
  sinks: at the checkout `run-delta-sync.ts` alone does, and on `main` every job does. The
  appliance is the one caller that sets a role: `pgDriver(pgDb.$pool, { role: SERVING_ROLE })` in
  `apps/selfhost/src/index.ts`.
- **On `main`, every task also reads a key that only the owner may read.** Each of the 14 task
  files sets `setAuditExportSink(auditExportOn(pgDriver(pool), …))` on its owner pool (0129 T4).
  The sink reads the deployment's pseudonym key from `deployment_key` (`deploymentKeyFor`,
  `packages/ledger/src/audit-export-sink.ts`), and ledger migration 0062 revokes every privilege
  on that table from `app_user`. The API met this the day the sink was built: its request path is
  `app_user`, so every line would have failed, and it now reads the key on a one-connection owner
  pool (`auditKeyPool`, `apps/api/src/index.ts`, commit 3f5a217). A task moved to `app_user`
  would meet the same refusal. The audit event would be kept and its line lost.
- **Much of a pass is not inside `withTenant` at all.** `PgLedger` and `PgCursorStore` are built
  over a plain drizzle handle and filter by `tenant_id` in their own queries. `enabledDomains`
  (`enabled-domains.ts`) and `targetProviderKey` (`build-confirmation-readers.ts`) run
  `pool.query` with `WHERE tenant_id = $1`. `run-rollback.ts` reads the mapping's name through
  `drizzle(pool)`. The rate budget (`PgRateBudget`, used by `run-confirmation.ts` and by the
  throttle limiter) and the byte budget (`PgByteBudget`) are keyed by tenant too, but their
  tables have no row security on purpose (migrations 0024 and 0030), so they need the
  application role and not a tenant scope. No code in `packages/*/src` or `apps/worker/src`
  opens a drizzle transaction (`.transaction(` does not occur), which matters for T1.
- **The owner is a superuser.** `managed.yml` runs `postgres:18-alpine` with `POSTGRES_USER`, and
  that image creates this user as a superuser. `docs/operator-runbook.md` and
  `managed.env.example` both say so. The repository states the consequence once, for a task: the
  cutover section of `deploy/compose/smoke-managed.sh` says *"The job itself connects as the
  owner, a superuser on this stack, whom row security never binds"*. The headers of
  `managed-sync-tick.ts` and `managed-digest.ts` say the same about their own cross-tenant reads,
  on purpose.

### What the documents say

- `docs/rls-guide.md` §2: *"`APP_DATABASE_URL` → `app_user`. **The request path, always.** The API
  and the deployed Trigger.dev tasks read and write tenant data through this, so row security is
  in force on every query that serves somebody."* Its table says `set-task-env.sh` uploads the
  direct owner URL *"because the tasks run migrations at boot"*, and that `TASK_APP_DATABASE_URL`
  *"is what the tasks use for tenant data"*. Neither statement is true.
- `docs/operator-runbook.md`, "The two database roles": *"The API and the deployed Trigger.dev
  tasks connect through this for all tenant data, so row-level security is always in force"*. It
  calls the upload *"the tasks' own migration connection"*, and it says *"Migration `0009`
  creates"* `app_user`. In fact `0001_baseline.sql` creates it.
- `deploy/compose/managed.env.example`: *"The API and worker connect through this role via
  APP_DATABASE_URL so row-level security is always enforced."* The correction of the same
  comment's "migration 0009" to the baseline is drafted in the pending consistency PR. The
  sentence about the worker is left as it is there.
- `README.md`, on the managed edition's one execution plane: *"Tenant isolation is enforced at
  runtime (FORCE RLS through a non-owner role + a tenant-membership auth gate)"*. `SECURITY.md`
  lists Postgres RLS under tenant isolation. Neither mentions an exception.
- `docs/architecture/solution-architecture.md` §17.1 gives "Postgres RLS" as the mitigation for a
  multi-tenant isolation breach.
- Code comments say it too. Six in `build-deps-from-mapping.ts` say *"with RLS"*,
  *"RLS-enforced"* or *"RLS enforced"*, among them the mapping check and the credential load. The
  header of `run-discovery.ts` says the job *"writes counts inside `withTenant` as the non-owner
  app_user"*, and its `tenantScopedStore` comment says *"(app_user + tenant context)"*. One in
  `run-delta-sync.ts` says *"(RLS enforced)"*. On the managed task path all of these run as the
  owner. What holds there is the tenant filter the query writes itself.
- The legal texts promise it too. `site/legal/privacy.md` §11 says *"Tenant isolation enforced in
  the database itself through row-level security, not only in application code"*, and
  `privacy.nl.md` §11 says the same in Dutch. `site/legal/dpa.md` says the same and adds
  *"database roles hold least privilege"*.

### The review's side claim

The review said that no production code constructs `pgDriver(pool, { role })`. That holds for the
managed worker and the API. It does not hold for the appliance, which does construct one (above).

### What this means

Row security works like this in this repository. Every table under row security (the guide
lists them) has four policies with one condition,
`tenant_id = (current_setting('app.current_tenant', true))::uuid`. Each such table is `FORCE`d,
so its owner is bound as well. `withTenant` sets `app.current_tenant` for one transaction. The
API's request path connects as `app_user`, so every query it makes on those tables is filtered by
the database, whatever its own `WHERE` clause says. If a query forgets the tenant, it gets the
current organisation's rows or none. It never gets another organisation's.

Postgres does not apply row security to a superuser, `FORCE` or not. The tasks connect as the
owner, which is a superuser. So in the task plane the policies do nothing. Separation between
organisations rests on the `WHERE` clause each query writes for itself.

The task queries this plan read do carry those clauses. Neither the review nor this plan audited
every query in the task plane, so "no task query crosses organisations" is not established. What
is established is that nothing but those clauses would stop one. The second net is missing. One
query that forgets its tenant filter, or one join that follows an id into rows the filter did not
cover, would read or write another organisation's rows. The database would neither stop it nor
notice. `targetProviderKey` shows the pattern. It filters the mapping by tenant, then joins the
mailbox and the connection by id alone. That is correct, because the ids come from the
organisation's own mapping. But it is correct because of how the code is written, not because
the database enforces it.

The tasks are also where the product handles the most tenant data. Every pass reads an
organisation's source, writes to its target, and records each item in the ledger. The
`connection` table holds each organisation's stored credentials, encrypted under
`SECRET_ENCRYPTION_KEY`, and every run holds that key. So a query in a task that crossed
organisations could reach the other organisation's credentials, and the key to decrypt them.

A superuser can also do more than read past the policies. Postgres lets a superuser run a
program on the database server (`COPY … TO PROGRAM`), read the server's files and change any
role. Every run holds that credential while it parses content fetched from servers on the
internet. No flaw in that parsing is known. The point is what the credential would allow if one
were found.

The owner asked, about roles, *"Are permissions not implemented?"* 0137 answers that for roles
within an organisation. For the boundary between organisations, the answer is that it is
implemented, and in force in the API, but not in the tasks.

## 2. The owner's decisions (2026-09-24)

None of the questions the owner answered was about this finding. The answers below set its scale
and its timing.

- **D1, who shares the database in the alpha.** Asked whether the test is free or paid, how many
  people, how long and in which language: *"Free and invite only. 10 to 20 people max. Dutch."*
  Asked about the blocker that testers need a stack apart from CI and the nightly gate, reachable
  from the internet: *"Yes, but its a controlled rest. I Let people in and support them. Max
  10/20 people"*. Asked what the test's terms are: *"Free. A few weeks. No obligations both
  sides."* The owner asked that the test be called an alpha. Each granted request creates an
  organisation (`withSubjectAndTenant`, 0093 T6). So from the first invitation, one database
  holds the organisations of up to 20 people other than the owner. That is the point at which the
  boundary between organisations starts to carry weight.
- **D2, what the database holds today.** Asked whether ports 5432, 3001, 3090, 3443 and 3126 are
  reachable from outside, whether the database passwords were changed, and whether the live
  identity provider holds other organisations: *"No, these ports are not reachable outside of
  private network/NetBird. Usernamea changed. No other organisations are hosted."* So today the
  boundary separates only the owner's own organisations and the demo tenants, which 0132 T5 takes
  out of the alpha.
- **D3, the database credentials.** Asked about the blocker that Postgres is published with a
  password this repository contains: *"Ill change user and pass. But not reached from
  internet."* Every run receives the URLs built from those values, the owner's among them until
  T3 step 2, so the change has to be re-uploaded to the task environment. 0132 T2 step 6 does
  that.
- **D4, who holds credentials.** Asked about rotating the demo secrets: *"Who would need/het
  credentials? I aupporrthe test. No one will be added to NetBird network. Devs need to setup own
  private test/dev environments. GitHub PRs and git is the bridge."* 0132 §4 answers the question
  about people. This plan adds a holder that is not a person: every task run holds the owner URL
  in its environment.
- **D5, whether permissions exist.** Asked about the blocker that roles do not restrict writes:
  *"Explain risk and advice. Are permissions not implemented?"* 0137 answers it for roles. §1,
  "What this means", answers it for organisations.

## 3. What each task does

### T0 — the alpha's answer (owner)

Choose (a) or (b) in §4. The answer, with its date and reason, goes into 0131 T5's row for this
plan and into this block.

### T1 — per-tenant tasks read and write as the application role

This is the task that gives the task plane its second net. Changing the URL alone would break
passes. Under row security, a read with no tenant set is not refused: it returns zero rows. An
insert fails the policy's check, and an update or a delete finds nothing to change. A pass whose
`enabledDomains` came back empty would copy nothing and could still end as if it had succeeded.
So T1 has five parts, and they land together.

1. **One place builds the tasks' pools.** It is a small module with no import side effects, for
   example `apps/worker/src/jobs/task-pools.ts`. It builds the per-tenant pool from
   `APP_DATABASE_URL`, and it refuses to start when that variable is unset. It never falls back
   to `DATABASE_URL`. The API's `getDbPool` falls back, which its comment gives as the self-host
   arrangement, but a task that did so would quietly be back on the owner. The eight per-tenant
   jobs take their pool from this module. Every `withTenant` scope in them is then under the
   policies with no further change.
2. **The builders are handed their handle.** `buildDepsFromMapping`,
   `buildDomainDepsFromMapping` and the verification reader stop reading `DATABASE_URL` and take
   the handle from their caller. `LedgerOptions.ledgerDb` (`build-deps.ts`) is the precedent: the
   config-file builders already take the appliance's handle that way, though the from-mapping
   builders do not take one yet. `openLedger` and `verifyMapping` lose their fallback too; their
   callers, the dev entrypoint and the appliance, can pass a handle. The header of
   `stopping-a-pass.ts` quotes the rule the guard `an-integration-test-is-handed-its-database`
   holds: *"the fix is always to pass the handle"*.
3. **The stores get a handle scoped to one tenant.** `PgLedger`, `PgCursorStore` and any other
   store a pass builds over a row-secured table run their queries outside `withTenant`. T1 gives
   them a drizzle handle each of whose statements runs inside `withTenant` for the pass's tenant:
   one transaction per statement. `run-discovery.ts` already does this for its one store
   (`tenantScopedStore`, one transaction per operation). The rate and byte budgets keep a plain
   handle on the application pool, because their tables have no policies. Call the new handle
   `tenantScopedDb(driver, tenantId)`, placed in `packages/ledger/src/db.ts` beside `withTenant`,
   so that `withTenant` stays the one place the tenant is set. Because no code in these packages
   opens a drizzle transaction, a statement at a time may be enough. The build checks what
   drizzle's node-postgres session calls on its client before relying on that.
4. **The bare helpers move inside `withTenant`.** These are `enabledDomains`,
   `targetProviderKey` and the mapping-name read in `run-rollback.ts`. `enabledDomainsForMappings`
   stays as it is, because the tick uses it across tenants (T2).
5. **The audit sink keeps a key it may read** (on `main`, §1). Built on the application pool,
   the sink of a per-tenant task would be refused the key and lose every line, as the API's
   would have. The API's answer is the model: a pool of one, on a connection that may read the
   key, used for nothing else. In the tasks that connection is T3 step 2's system role, granted
   `deployment_key`, and the owner's until step 2 lands. The sink's wiring then reads a second
   URL, so it goes on T4's list with that reason. Granting `app_user` the table is not an option:
   migration 0062 keeps the key from the request path on purpose.

**Why one transaction per statement, and not the tenant set once per connection.** The pooler
runs in transaction mode (0082 T4). A setting made for a whole session would stay on the server
connection and reach whoever borrows it next. `packages/ledger/src/direct-url.ts` names that as
the one leak that would matter. A setting local to one transaction does not leak. The cost is
three extra statements per query on the compose network. The build measures one pass's wall time
before and after on the stack T1 is proven on (§4), and writes both figures in this block.

**What it will find.** Some table may lack a grant for `app_user`. The ledger's default
privileges cover tables the migrating role creates, and the managed migrations grant by name.
T1's test is what finds a gap. This plan has not made that inventory.

**Guard.** `apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts`, run against real
Postgres and handed its database, as the guard `an-integration-test-is-handed-its-database`
requires. It seeds two organisations as the privileged user, then builds a pass's handles the way
the jobs do, as `app_user`, for organisation A. It asserts three things. First, the pass's writes
for A are there when read back. This is the half that fails if a scope was missed: fail-closed
row security turns a missed scope into an empty pass, not an error. Second, a deliberately
unscoped probe (`SELECT count(*) FROM connection`) run on the handle the stores were given
returns A's rows only. Third, an audit event the pass records prints its line, so part 5 held.
On today's code the second assertion fails, because the handle is the owner's and sees both
organisations.

### T2 — the owner's reach kept to the jobs that span tenants

Three jobs ask questions that cross organisations by nature, and they keep a cross-tenant
connection (after T3, the system role):

- `managed-sync-tick`: which mappings are due, across every organisation; how many runs are in
  flight; whether the platform is paused.
- `managed-retention`: pruning across organisations, and the run prune per organisation up to its
  last issued invoice (0121 T5).
- `managed-purge-closed`: finding closed organisations whose time has come, revoking their stored
  credentials and removing their data.

Three more jobs ask one cross-tenant question and then read each organisation's own rows:
`managed-digest`, `managed-drift-detect` and `managed-group-discovery`. The proposal is to split
them the way T1 splits a pass. The list of organisations (for group discovery, the list of
source connections across them) comes from the cross-tenant connection. Everything read for one
organisation goes through `withTenant` on the application pool. That puts the per-tenant half
of these jobs under the policies as well (open question 3).

Each job's header already says why it crosses organisations. T5 puts the same list in
`docs/rls-guide.md` §2, and T4 checks that the code and the guide agree.

### T3 — no superuser in a run's environment

**Step 1: stop uploading `DIRECT_DATABASE_URL`.** No task reads it (§1). It is the owner's
credential, straight to Postgres, past the pooler, in every run. Removing it from
`set-task-env.sh`'s `variables` changes nothing any task does. Removing it from the list may not
remove it from the store: the script deletes a variable only on its `FORCE_REWRITE` path
(`envvars.del`), and this plan did not verify whether `upload` drops a variable it is not given.
So step 1 also deletes the stored value once, and checks the list the script prints afterwards.
The header of `deploy-tasks.sh` and `docs/managed-bring-up.md`, which name it among the uploaded
variables, change with it. This step is small enough to land before the first invitation.

**Step 2: T2's jobs connect as a role that is not a superuser.** The role gets `LOGIN`,
`NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB` and `BYPASSRLS`, with grants on the tables T2's jobs
read and write, plus `deployment_key` for the audit sink on `main` (T1 part 5), and no others. It
is created the way `app_user` is: by a migration, because roles are cluster-global and the
baseline creates its own. Its password comes from a new `.env` value that
`ensure-env-secrets.sh` generates, and the bring-up sets it. It reaches Postgres through the
pooler the way `app_user` does, since the pooler looks any role up in Postgres (`auth_query` in
`deploy/compose/pgbouncer/pgbouncer.ini`, `user_lookup` in `setup-auth.sql`). `set-task-env.sh`
uploads its URL under a name of its own, stops uploading `DATABASE_URL`, and deletes the stored
one as in step 1.

What step 2 changes: no run holds a superuser's credential. No run can execute programs on the
database server, read its files, change roles or alter the schema. What it does not change:
`BYPASSRLS` still reads past the policies on the tables it is granted, and every run still
receives this URL, because variables are per environment. T4 makes sure no per-tenant job reads
it. A run that had been taken over still could.

**Step 3 (parked): no cross-tenant credential in a run at all.** The questions T2's jobs ask
become functions owned by the owner (`SECURITY DEFINER`), with `EXECUTE` granted to `app_user`,
and the system role goes. The trigger is the service admitting people the owner has not let in
personally, which means after the alpha (open question 2).

This interacts with D3. After the owner changes the owner role's user and password (0132 T2),
the new owner URL is what every run receives until step 2 lands. 0132 T2 step 6 re-uploads it.

**Guard.** `scripts/a-run-that-carries-no-superuser.unit.test.ts` reads `set-task-env.sh` and
fails when the uploaded `variables` contain a value composed from `${POSTGRES_USER`, or contain
`DIRECT_DATABASE_URL`. It fails on today's script on both counts. It is a guard in the style of
`a-connection-the-docs-did-not-know-about.unit.test.ts`, which reads the same scripts. In
addition, the bring-up asks Postgres whether the system role is a superuser or may create roles,
and refuses to continue if it is or may.

### T4 — a guard on who opens which pool

`scripts/a-pass-that-opened-the-owners-pool.unit.test.ts` reads every non-test `.ts` file under
`apps/worker/src` and `packages/*/src`. It fails when a file reads a database URL from the
environment other than `APP_DATABASE_URL`, meaning `DATABASE_URL`, `DIRECT_DATABASE_URL`, the
`TEST_DATABASE_URL || DATABASE_URL` fallback in the builders, or T3's system variable, and that
file is not on its list. The list is closed, and each entry states its reason:

- T2's jobs, by file name;
- the audit sink's key connection (T1 part 5), wherever the build puts it;
- `apps/worker/src/cli/index.ts`, the operator's CLI, which runs at the machine and not as a task;
- `apps/worker/src/index.ts`, the dev entrypoint, which its README places outside both editions;
- `packages/ledger/src/direct-url.ts`, if the guard's pattern catches it:
  `migrationConnectionString` reads the variables from an environment its caller passes, and its
  callers are the API and the seed.

It also fails when a per-tenant job builds a `Pool` any other way than through T1's module. It
first checks that it found at least the tick, the way the existing guard checks that it found
`operator.sh` and `seed-managed.sh`, so that a change in the pattern turns it red instead of
letting it pass by matching nothing. On today's code it fails on `run-delta-sync.ts`, the seven
other per-tenant jobs and the builders in `packages/orchestration/src`.

The list is exported, and T5's guard reads the same list. The code and the guide then cannot
disagree about who holds the cross-tenant connection.

**Under T0's option (b)** it lands before T1, as a ratchet. Today's per-tenant readers go on a
second list, "known, removed by T1", which may only shrink. A new file that reads the owner's URL
fails at once. T1 empties that second list, and its PR deletes it.

### T5 — the documents say which connection the tasks use

**Step 1, before the first invitation, whatever T0 decides.** The documents say what is true
today. The tasks connect as the owner, row security is not in force there, and this plan is the
way out.

- `docs/rls-guide.md` §2: the sentence about the tasks, and the table row for `set-task-env.sh`.
  That row loses *"the tasks run migrations at boot"*.
- `docs/operator-runbook.md`, "The two database roles": the same sentence, *"the tasks' own
  migration connection"*, and the migration number.
- `deploy/compose/managed.env.example`: the sentence about the worker.
- `README.md`'s managed paragraph and `SECURITY.md`'s tenant isolation line: say where row
  security is in force.
- `docs/architecture/solution-architecture.md` §17.1: the isolation row, together with 0136 T7,
  which adds the worker plane's row.
- The code comments listed in §1: six in `build-deps-from-mapping.ts`, two in
  `run-discovery.ts` and one in `run-delta-sync.ts`.

The existing guard `scripts/a-connection-the-docs-did-not-know-about.unit.test.ts` must stay
green. It requires the guide to keep *"tenant isolation silently disappears"* and
*"`APP_DATABASE_URL` → `app_user`"*. The new text keeps both, and adds where the second one does
not yet hold.

**The legal texts go to 0139.** `site/legal/privacy.md` §11, `privacy.nl.md` §11 and `dpa.md`
promise isolation in the database itself, and the DPA promises database roles with least
privilege. Under T0's option (b) that is not true during the alpha. 0139 carries the legal pass,
and there are two ways to make the sentence true: T1 to T3 land before the texts are published,
or until then the texts say where row security applies (the application's requests) and where it
does not yet (the background tasks). 0139 carries this sentence (its §1, *Isolation in the
database*, and T1's point 11).

**Step 2, after T1 to T3.** The documents say what was built. Per-tenant tasks run as `app_user`.
T2's jobs are named, each with its reason, on the system role. No run carries the owner's URL.
The guide's table gets one row per job on T4's list, and the existing guard is extended to check
that the guide names every one of them. That is prose that enumerates a closed set, which the
guard's own header names as the kind of sentence worth checking.

**Guards and mutations.** Each code task's guard is written first and fails on today's code.
Each task goes in its own PR with its guard, as 0129's tasks did. Mutations are run the way
0129 and 0130 ran them, and the count goes in this block.

## 4. Order, and the alpha

Whatever T0 decides, T5's first step goes first. A public repository, and a privacy policy about
to be read by testers, should not say the tasks run under row security while they do not. T3's
first step and T4 come next. Both are small, and both stop the gap from growing.

Then there are two ways to reach the first invitation:

- **(a) Build T1 to T4 before the first invitation.** The database then holds the boundary
  between testers in both planes from the first day. The cost is time, and one specific risk. T1
  touches the pass path of every data type, and a scope missed there reads nothing rather than
  the wrong thing, which a pass can report as a quiet success. T1's test stands against that, and
  the change should be proven on a managed stack that is not the alpha's before testers depend on
  it, which is 0132 T8's trigger. The alpha waits for it.
- **(b) Accept the gap in writing for the alpha, and build T1 to T3 before it ends.**
  *Recommended.* Before the first invitation: T5 step 1, T3 step 1, and T4 as a ratchet. T1, T2
  and T3 step 2 follow, and must land before the alpha ends or admits anyone the owner has not
  let in personally, whichever comes first. The reasons: the people are 10 to 20 the owner lets in
  and supports (D1); nobody has found a task query that crosses organisations, though nobody has
  audited them all; and a T1 built in a hurry risks passes that silently copy nothing, which
  testers would feel more directly than a risk that has not been realised.

What (b) accepts, said plainly: for the alpha's weeks, a defect in a task's own tenant filter
could read or write another tester's rows, including that tester's stored credentials, which the
run holds the key to decrypt. The database would not stop it. And every run holds a superuser's
credential until T3 step 2. 0131 T5 asks for the reason to be stated. The owner writes the
acceptance in their own words, with the date it ends.

## Cross-references

- 0131 T5: the go/no-go row for this plan.
- 0132 T2: the password change (D3); its step 6 re-uploads the task URLs. 0132 T8: a managed
  stack apart from the alpha's, whose trigger T1 meets (§4).
- 0129 T4: the audit sink every task file sets on `main`, whose key T1 part 5 keeps readable.
- 0136 T4: the runners off the control plane's network, the other half of the worker plane. 0136
  T7: the worker plane's row in SAD §17.1, which T5 edits together with it.
- 0137: roles within an organisation, and the question in D5.
- 0139: the legal texts' sentence on isolation (T5).

## Not in this plan

- **The detectors' stack-wide credentials** (`wp-managed-detectors-stack-credentials`, high,
  confirmed). On the managed edition, the drift detector, group discovery and the permission
  report call `directoryAvailability(process.env, graphTenantId)`. That uses the deployment's
  single `OAUTH2_*` client for every customer's tenant, not the customer's own connection. The
  drift detector and the permission report also look the tenant up with `kind = 'o365'`, while
  0114's Connect-with-Microsoft connections are of kind `microsoft`. The review concludes that
  for those testers the report says there is no Microsoft 365 source; this plan checked the
  filter and the kind, not a live report. That is a question about credentials, not rows, and it
  needs its own follow-up. It shares only its files with T2.
- **The appliance.** Its stores run over the owner's handle the same way
  (`apps/selfhost/src/index.ts` builds `PgLedger` over `persistenceBackend.db`), and only its
  `withTenant` scopes drop to `app_user`. It holds one organisation, so there is nothing to
  separate. T1's handle can serve it later, which would make the guide's "same code path" true.
- **The API's request path.** It already connects as `app_user` (§1).

## Open questions

1. **T0: (a) or (b)?** If (b), the date or event that ends the acceptance, and the reason, for
   0131 T5.
2. **T3's end state.** Is the system role of step 2 the end, or should step 3's functions follow
   at its trigger, so that no run holds a credential that reads past the policies? Recommended:
   step 2 for the alpha, step 3 before the service admits people the owner has not let in.
3. **The digest, the drift detector and group discovery.** Split them as T2 proposes, or keep
   them whole on the system connection? They are on T4's list either way, for their list of
   organisations. Splitting puts their per-tenant reads under the policies. Keeping them whole is
   less work, and leaves those reads past the policies too.
