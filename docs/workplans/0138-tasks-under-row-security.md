# Workplan 0138 — Tasks under row security

> **In one line:** Trigger.dev tasks reading tenant data as `app_user` under row security instead of the superuser owner via `DATABASE_URL`, owner reach kept to cross-tenant jobs, `DIRECT_DATABASE_URL` dropped from `set-task-env.sh`, a pool guard, docs corrected.

## Status — 2026-09-28 (update this block at the end of every session)

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
against a running stack.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
The testers' organisations now go into `ownpace-live`'s database, and its tasks run on live's own
Trigger.dev plane (0132 T1c) with URLs built from live's own `.env` (0132 T1b), so D2, D3, T3 and
§4 now say which stack and which plane they mean, and T1 is proven on the OTA stack before live
takes it from a tag (0132 T8, which §4 cited, is superseded). #1137 corrected
`managed.env.example`'s migration number, but every sentence §1 quotes is still on `main`
(checked at the merge), so T5's list stands.

**2026-09-27, T5 step 1 built** on branch
`claude/ownpace-public-readiness-y7orc6-where-row-security-holds`, not merged (0131 §6, R6 step 2).
T0 is still the owner's and still open, so the documents say what is true today, not what T0 will
decide. Documentation and code comments only; nothing a task, the API or the appliance does has
changed. What changed:

- **`docs/rls-guide.md`** has a new section, *Where row security holds today*: one table with
  every connection, what it connects as, and whether the policies bind it. The API's request path
  (`app_user`) and the appliance's `withTenant` scopes: in force. Every managed task, all fourteen
  by name, and the builders they call: not in force, the owner. §2's `APP_DATABASE_URL` bullet says
  the tasks do not use it yet, and the `set-task-env.sh` row names the three URLs a run receives,
  which one every task connects with, and that no task reads the other two or runs migrations. The
  opening paragraph no longer says the appliance's filter is never skipped. The *Policies* and
  *RLS tables* sections are rewritten from the catalog (below).
- **`docs/operator-runbook.md`**, *The two database roles*: `0001_baseline` creates `app_user`
  (was `0009`), `set-task-env.sh` is no longer called *"the tasks' own migration connection"*, and a
  new bullet says the tasks do not use `APP_DATABASE_URL` yet. The troubleshooting line had the
  same two errors and is corrected too.
- **`deploy/compose/managed.env.example`**: the owner's comment names the tasks among its holders
  (not every holder: several deploy scripts hold it too, and the guide's §2 lists those), and the
  `APP_DB_*` comment says the API connects as `app_user` and the tasks do not yet.
- **`README.md`** and **`SECURITY.md`**: tenant isolation is enforced in the API, bar two routes,
  and not yet in the tasks. `SECURITY.md`'s *"per-tenant secret scope"* is replaced by what is
  there: each organisation's credentials in its own rows, all under the one
  `SECRET_ENCRYPTION_KEY`.
- **`docs/architecture/solution-architecture.md`** v1.8, §17.1's isolation row: in force on the
  API's request path and not in the tasks, and *"egress controls"* marked not built with a pointer
  to 0136 T7, which owns the rest of that table and §16.
- **The code comments §1 lists**: seven in `build-deps-from-mapping.ts`, two in
  `run-discovery.ts`, one in `run-delta-sync.ts`. Each now says the query's own tenant filter is
  what holds on the task path, and why the policies do not.

**No guard, on purpose.** §3 names none for step 1: step 2 extends
`a-connection-the-docs-did-not-know-about` once T4's list exists. That guard stays green (it
requires *"tenant isolation silently disappears"* and *"`APP_DATABASE_URL` → `app_user`"*, and both
are kept; dropping the backticks round `app_user` in §2's bullet turned it red, 1 of its 6 cases,
and restoring them turned it green). Every fact written was checked instead, against the code at
`origin/main` (eba2d108) and against a real Postgres 16 with both migration chains applied
(`scripts/local-pg.sh`):

- *The tasks connect as the owner.* All fourteen files in `apps/worker/src/jobs/` that build a pool
  read `process.env.DATABASE_URL`; no file in `apps/worker/src` or `packages/*/src` reads
  `APP_DATABASE_URL` or `DIRECT_DATABASE_URL`, except `migrationConnectionString` and
  `poolerInFront` (`packages/ledger/src/direct-url.ts`), pure functions of an env their caller
  passes, whose callers are the API and the seed; no job gives `pgDriver` a role; no task calls
  `runMigrations` or `migrationConnectionString`. `set-task-env.sh` uploads all three URLs.
- *The owner is a superuser and `withTenant` on its connection does nothing.* Asked of the
  database: with two organisations in `tenant`, the owner counted 2 with no tenant set, and 2
  again inside a transaction with `app.current_tenant` set to one of them, the shape `withTenant`
  takes on the tasks' pool. As `app_user` the same queries counted 0 and 1.
- *The API's request path is `app_user`.* `getDbPool()` reads `APP_DATABASE_URL` first, and
  `managed.yml` gives the API the `app_user` URL. Every pool in `apps/api/src` was listed: the rest
  are `getDbPool()`, the audit key's pool (reads `deployment_key` only), the seed and the operator
  script, and one more (below, *Found here, and not in §1*).
- *Which tables have policies.* 43 tables, every one `FORCE`d: 28 from the ledger chain and 15
  from the managed chain, listed by name in the guide. The guide's old list named 29 and missed
  14, and four of the names it gave as *"from migrations 0001–0004"* are in the managed chain now.
  34 carry the four tenant policies. Seven carry policies keyed on the signed-in person, an
  operator's row or a grant link, beside or instead of the tenant's, and two carry fewer tenant
  policies; the guide now says which. `rate_budget`, `byte_budget` and `app_event` have a
  `tenant_id` and no row security, as their migrations say; `deployment_key` and `erasure_record`
  have neither.
- *Which paths pass the policies by design.* The ten `support_*` views are owned by the owner, have
  no `security_invoker`, and return every tenant's rows to an operator; their own operator check is
  the net, as managed migration 0009 says. Asked as `app_user` with no operator, `support_tenants`
  returned 0 rows.

**Found here, and not in §1: two API routes read on the owner's connection.**
`apps/api/src/routes/permissions.ts` builds its own pool from `DATABASE_URL`
(`new Pool({ connectionString: process.env.DATABASE_URL })`, since 0029, 2026-08-04). On managed
that is the owner. `resolveMappingMailbox`, `tenantTargetConduct` and `tenantInventoryScans` read
`mailbox_mapping` joined to `mailbox`, and `connection` with `secret_ref` and `config`, filtered by
their own `tenant_id = $1`. Two routes call them: `GET /api/permissions/report` and
`POST /api/migrations/:mappingId/sharing/rescan`. The tenant comes from the authenticated
membership, so nothing is known to cross; but it is the task plane's gap on the request path. The
documents now name it. **Open, not built, and not yet in this plan's task table:** the fix is
small (those three helpers take `getDbPool()` and run inside `withTenant`), and T4's guard, which
reads only `apps/worker/src` and `packages/*/src`, would not see it. Whether it goes first, rides
with T4, or waits for T1 is for whoever builds R6 step 3, with the owner.

**Where the build differs from §3's T5:**

- **The guide got a section, not only a sentence.** §3 named §2's sentence and the table row. A
  reader asking *"where does row security hold?"* needed every connection in one place, the API's
  exceptions included, so the answer is one table near the top.
- **The table list and the policy description were stale** and are rewritten from the catalog.
  §3 did not name them; the task was to say which tables have policies, and the old list was wrong.
- **Seven comments in `build-deps-from-mapping.ts`, not six.** The builder's header also said
  *"All database operations are wrapped in withTenant() to enforce row-level security"*, and the
  mapping check is not in `withTenant` at all.
- **Also corrected, because they said the same wrong thing:** the runbook's troubleshooting line,
  the env example's owner comment, and `SECURITY.md`'s *"per-tenant secret scope"*.
- **§17.1's "egress controls" is marked, not removed.** 0136 T7 owns that row's rewrite and §16;
  this step only stops the row it edits from claiming something that does not exist.

Not changed, and why: `deploy-tasks.sh`'s header and `docs/managed-bring-up.md` list the uploaded
variables correctly; T3 step 1 changes them with the upload. The legal texts' sentence goes to 0139.
**Still open:** T0 (the owner); T5 step 2 (after T1 to T3); the permission report's pool (above).

**2026-09-27, later: the review's twelve findings fixed,** on the same branch, in one more commit.
Documentation and comments only, as before, and no guard, for the reason above. Each fact was asked
again of the code, or of a Postgres 16 with both chains applied (`scripts/local-pg.sh`):

- *The owner URL is the request path for two routes.* The runbook's *"Never the API's request
  path"* and the guide's §2 *"Never the request path"* now say it is meant never to be, and name
  the two routes. So does the API service's comment in `managed.yml`, which also said RLS is
  *"ALWAYS enforced"*.
- *No tenant set is not always zero rows.* Asked of `pg_policies`: 32 tables (126 policies) use the
  plain `::uuid` form and 7 the `NULLIF` form. As `app_user` on one connection, a plain-form table
  (`connection`) counted 0 before any tenant transaction and raised
  `invalid input syntax for type uuid: ""` after one; a `NULLIF` table (`mapping_link`) counted 0
  both times. The guide's *Policies* says so now, and points at managed migration `0004`. Nothing
  leaks either way.
- *Also corrected, because they said the same wrong thing:* the root `.env.example` (*"The
  API/worker connect through … app_user … so row-level security is always enforced"*), the API
  service's comment in `managed.yml`, and three comments outside §1's list: two in
  `apps/api/src/routes/migrations/job-resolution.ts` and one in
  `packages/orchestration/src/discovery.ts`. `run-discovery.ts`'s header now says the builder also
  opens its own handle from `DATABASE_URL`.
- *The guide's table lists every connection now.* It gains the API's migrations beside the audit
  key's pool, and a row for the commands an operator runs with their own `DATABASE_URL`: the
  cutover CLI, the standalone config-file worker, the appliance's `forget-me` and the two Drive
  measurement scripts. Every `new Pool(`, `createPgDb(` and `createPgliteDb(` outside tests in
  `apps/*/src`, `packages/*/src` and `scripts/` falls in one of its rows.
- *§16 of the architecture document* loses *"secret scope"* too, and says where row security
  holds, so it no longer contradicts §17.1; v1.8's note names both changes and §17.1's egress
  mark. 0136 §1 quotes §16 as it was; its T7 still applies to *"egress controls"*, which stays.
- Smaller: §17.1 names `SECRET_ENCRYPTION_KEY` rather than *"one deployment key"*, which read as the
  `deployment_key` table; the guide names both FORCE tests, the managed chain's too; the env
  example's owner comment adds Zitadel's database setup and the API, and the bullet above no longer
  says it names every holder; the one package reader of `DIRECT_DATABASE_URL` is named above; a
  cross-reference is fixed.

**2026-09-27, T3 step 1 and T4 built** on branch
`claude/ownpace-public-readiness-y7orc6-tasks-without-the-owners-connection-string`, not merged
(0131 §6, R6 step 3). T0 is still open, so T4 is built as the ratchet §3 describes for option
(b). That is safe under (a) as well: T1 empties the ratchet list either way.

- **T3 step 1.** `deploy/compose/set-task-env.sh` no longer composes or uploads
  `DIRECT_DATABASE_URL`. Checked first: nothing in `apps/worker/src` or
  `apps/worker/trigger.config.ts` names it. In `packages/*/src` only `migrationConnectionString`
  and `poolerInFront` (`packages/ledger/src/direct-url.ts`) read it, from an environment their
  caller passes, and their callers are `apps/api/src/index.ts` and
  `apps/api/src/scripts/seed-managed.ts`. A run now receives `DATABASE_URL` (still the owner),
  `APP_DATABASE_URL`, `SECRET_ENCRYPTION_KEY` and the optional values. The script's header,
  `deploy-tasks.sh`'s header and `docs/managed-bring-up.md` phase 9 say so.
- **T3's guard**, `scripts/a-run-that-carries-no-superuser.unit.test.ts`, reads the upload block
  whole and fails on any part of it it cannot read: every line of the `variables` literal and of
  the optional list, every `process.env` read, every use of `variables` and every `envvars` call
  must have a shape it knows. It traces each value through the script's assignments, as deep as
  they go, and a value that reaches `$POSTGRES_USER` or `$POSTGRES_PASSWORD`, braced or not, is
  the owner's under whatever name it goes up. It cannot see what `.env` holds: an owner URL put
  there under a name that says nothing, and handed through, is outside it. The owner half is a
  ratchet, since step 2 is not built: `OWNER_URL_UNTIL_T3_STEP_2` holds `DATABASE_URL` alone, and
  the test fails if `DATABASE_URL` stops being the owner's while the entry stays. A URL may go up
  only under a name T4 reads as a database URL, and the guard checks that T4's file still carries
  the same pattern. **Failed first:** on the unchanged script 2 of the first version's 5 cases
  failed: `DIRECT_DATABASE_URL` is uploaded, and an owner-composed value other than `DATABASE_URL`
  is uploaded (the same variable). 15 ways back are cases in the guard, each red: the direct URL
  as it was, with a comment after it, as `|| ""`, and written into `variables` after the literal;
  the owner composed in the prefix and written in under another name, unbraced, and two
  assignments deep; `PGPASSWORD` from `POSTGRES_PASSWORD` in `variables`; `POSTGRES_PASSWORD` in
  the optional list; an unquoted name in that list; a `postgresql://` URL named `SYSTEM_URL`;
  `DATABASE_URL` composed from another role with its entry kept; `envvars.create`;
  `process.env` destructured; a second `node -e` block.
- **T4**, `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts`, parses every non-test `.ts`
  under `apps/worker/src` and `packages/*/src` that mentions `DATABASE_URL`. A read is any name
  ending in `DATABASE_URL` other than `APP_DATABASE_URL`, used as a property, an element, a
  destructured binding or a string of its own; a comment or a message is not. Two lists:
  `CROSS_TENANT` (9: the six scheduled jobs, the operator's CLI, the dev entrypoint and
  `direct-url.ts`), and `KNOWN_REMOVED_BY_T1` (11: the eight per-tenant jobs,
  `build-deps-from-mapping.ts`, `build-deps.ts` for `openLedger` and `orchestration.ts` for
  `verifyMapping`). Every entry of the second must be one of the 11 it landed with
  (`KNOWN_REMOVED_BY_T1_AS_LANDED`), it may not grow past its current size, and an entry whose
  file no longer reads a URL fails until it is deleted. No scanned file but `direct-url.ts` may
  name `migrationConnectionString` or `poolerInFront`, which read the owner's URL for their caller
  without the caller naming it. A second rule: a file in `apps/worker/src/jobs/` that builds a
  pool must be on a list, where building one is a `new` of `Pool` or pg's `Client` under any
  name it is bound to, `createPgDb`, or a `drizzle(…)` not handed a pool. Until T1 part 2, a job
  that calls a builder on the ratchet list inherits its owner read without being seen. The guard
  first checks that it found the tick and the builders, that `stopping-a-pass.ts`, which names
  `DATABASE_URL` only in its header, is not counted, and that the pool rule sees the shapes
  review found (below). **Failed first:** a ratchet passes on the code it was written for, so the
  failing run is its strict form. With `KNOWN_REMOVED_BY_T1` emptied, as it will be once T1
  lands, 19 of 51 cases failed on the unchanged code: the eight per-tenant jobs and the three
  orchestration files as readers, and the eight jobs as pool builders. 7 mutations, each red:
  `process.env.DATABASE_URL` in `cutover-gate.ts`; `process.env['DIRECT_DATABASE_URL']` in a new
  package file; `const { DATABASE_URL: url } = process.env`; `getEnv('DATABASE_URL')`; a
  ratchet file that stops reading with its entry kept; an entry added to the ratchet list;
  `new pg.Pool` in `cutover-gate.ts`.

**2026-09-27, later: review fixes, same branch, not merged.** Review found both guards narrower
than their headers said, and ran mutations on scratch copies to show it. Each was run again here
against the first version and against the fix:

- **T3's guard skipped what it could not parse.** A `variables` line that was not exactly
  `NAME: process.env.SOURCE,` was dropped without a word, the owner test matched only the braced
  `${POSTGRES_USER`, and it followed one assignment. 12 of the 15 ways back listed above passed
  all 5 of the first version's cases; all 15 fail the fix, and are now its own cases. The
  script's header said the guard catches the direct URL "under any name", and this Status said
  so too; both now say what it checks.
- **T4's ratchet was pinned by size alone.** Freeing one entry and adding a new reader in the same
  change passed. So did a new file calling `migrationConnectionString(process.env)`, a job calling
  `poolerInFront`, `new PgPool` from `import { Pool as PgPool } from 'pg'`,
  `drizzle(process.env.APP_DATABASE_URL!)`, `drizzle({ connection: … })` and `new Client(…)`:
  7 mutations, each passing all cases of the first version and failing the fix.
- **The owner's recipe** in `docs/managed-bring-up.md` resolved the environment itself instead of
  through `trigger_env`, and read a not-found from `envvars.del` as proof that the plane never
  held the variable, which `deploy/compose/reset-trigger.sh` records as untrue once. It now runs
  in a subshell with the script's own resolver, prints what the delete said, and makes the list
  `set-task-env.sh` prints the check, with trigger-db's `SecretStore` as the next place to look.
- **The guard's header had the history backwards.** It said the direct URL was uploaded because
  `docs/rls-guide.md` said the tasks run migrations. `git log -S` shows the upload came in with
  the pooler on 2026-08-18 and the guide's row on 2026-09-01.

Where the build departs from §3:

- **The ratchet list is longer than §3 T4 predicted.** §3 names the eight jobs and "the builders
  in `packages/orchestration/src`". `openLedger` and `verifyMapping` read the owner's URL too.
  §1 places them off the task path, and T1 part 2 removes their fallback, so they are on the
  ratchet list and not on `CROSS_TENANT`.
- **No entry yet for the audit sink's key connection or for T1's pool module.** On `main` the
  sink is built on each job's own pool and reads no URL itself, and T1's module does not exist.
  T1 adds both entries with the files.
- **The lists are not exported.** §3 T4 says T5's guard reads the same list. Importing from a
  `.unit.test.ts` runs every case in it inside the importer (in review, a one-case test that
  imported `CROSS_TENANT` reported 63). T5 step 2 first moves the lists to a plain module both
  guards import, and keeps each listed file's route to this guard in `docs/LESSONS.md`, which
  today comes from the paths being written in the guard.
- **The pool rule does not count an object with a `connectionString`.** `cutover-gate.ts` hands
  one to the verification reader, which opens its own pool from the URL `run-cutover.ts` reads.
  T1 part 2 takes that with `run-cutover.ts`'s entry.
- **T3's guard carries its `${POSTGRES_USER` half as a ratchet.** §3 has it fail on today's
  script on both counts, and it does. What lands is the half step 1 makes true, plus a list of
  one that step 2 empties. Step 2's bring-up check, which asks Postgres whether the system role
  is a superuser, is step 2's.
- **Two lines that are also T5 step 1's.** `docs/rls-guide.md` §2's row for `set-task-env.sh`
  said it uploads the direct URL because the tasks run migrations, and `docs/operator-runbook.md`
  called the upload the tasks' migration connection. Both now say it uploads the owner URL every
  task connects with today. R6 step 2 (0138 T5 step 1) rewrote the same two lines on its own
  branch. At the merge (below), T5 step 1's wording was kept and this fact added to it: no
  `DIRECT_DATABASE_URL` upload.

**The owner's step, before the first invitation (⏳ Owner).** Delete the stored
`DIRECT_DATABASE_URL` once on each plane that holds it: the OTA stack's, and live's if its task
environment was filled before this lands (0132 T1c). The command and the check are in
`docs/managed-bring-up.md`, "Once, after the pull that stopped uploading `DIRECT_DATABASE_URL`".
The check is the list `set-task-env.sh` prints afterwards, not what the delete answers.
Leaving the name out of the upload does not delete the stored value. It also matters for a later
key rotation: `SET_TASK_ENV_FORCE_REWRITE=1` deletes and rewrites only what the script uploads,
so a leftover would stay on the old key and stop every run. Not verified here: whether the
platform drops a variable it is not sent. The SDK (4.5.16) sends only the given variables to the
environment's import endpoint; the server's side is not in this repository. Nothing was exercised
against a running stack.

**2026-09-27, later still: T5 step 1's branch merged into this one,** by a merge commit, so this
branch's PR stacks on T5 step 1's; neither is on `main`. Both had rewritten the same lines. The
result keeps T5 step 1's documentation and T3 step 1's fact, each checked against this branch's
`set-task-env.sh` and the two guards:

- **Two URLs a run receives, not three.** T5 step 1 wrote, true at `eba2d108`, that
  `set-task-env.sh` uploads three URLs and every run receives all three. `docs/rls-guide.md` §2's
  row and `docs/operator-runbook.md`'s bullet on the tasks now say a run receives `DATABASE_URL`
  (the owner, through the pooler) and `APP_DATABASE_URL`, beside `SECRET_ENCRYPTION_KEY` and the
  optional values, that T3 step 1 stopped uploading `DIRECT_DATABASE_URL`, and where the owner's
  one-off deletion is.
- **What is built.** The guide's *Where row security holds today* said none of T1 to T4 is built.
  It now says T3 step 1 and T4 are, and that neither changes the role a task connects as, and its
  header note names T3 step 1's change beside T5's.
- **The permission report's pool is outside T4.** T4 walks `apps/worker/src` and
  `packages/*/src` only, so `apps/api/src/routes/permissions.ts` (T5 step 1's note) is not on its
  lists or in its reach, and is still not in the task table. The guide says so.
- **Left as written:** T5 step 1's note says `deploy-tasks.sh`'s header and
  `docs/managed-bring-up.md` were left for T3 step 1, which changed them (above).

Still open: T0 (the owner); T1 and T2; T3 step 2, and the owner's one-off deletion (above); T5
step 2, after T1 to T3; the permission report's pool (T5 step 1's note).

**2026-09-28: T0 answered, (a).** The owner: *"0138 T0: build the fix first."* So §4's (a): T1 to
T4 are built before the first invitation, and nothing is accepted in writing. T3 step 1 and T4
are merged (#1222). T1, T2 and T3 step 2 now come before the first invitation, proven on the OTA
stack before live takes them from a tag. Their rows and 0131 T5's row for this plan say so. Open
questions 2 and 3 are still the owner's.

**2026-09-28, T1 step 1 built: every handle a pass uses is scoped to its tenant** (parts 2 to
4), on branch `claude/ownpace-public-readiness-y7orc6-every-handle-a-pass-uses-is-scoped`, not
merged. Built on the owner's answer to T0, *"0138 T0: build the fix first."*, which #1295
recorded (merged 2026-09-28, the entry above). No task connects any differently: every job still
builds its pool from `DATABASE_URL`, the owner, a superuser, and on that connection a tenant scope
changes nothing a query sees. What changed:

- **`tenantScopedDb(driverOrPool, tenantId)`** in `packages/ledger/src/db.ts` (part 3): a drizzle
  handle each of whose statements runs inside `withTenant` for one tenant, one transaction per
  statement, so `withTenant` stays the one place the tenant is set. Beside it, `plainDb(pool)`: a
  plain handle on a pool the caller owns, for the rate and byte budgets, whose tables have no row
  security. **What drizzle does, read before relying on it** (part 3 asked): in drizzle-orm
  0.45.2's node-postgres session (`drizzle-orm/node-postgres/session.js`) every statement is one
  `client.query(config, params)` on the client the handle was built over, and nothing else
  touches that client. `db.transaction()` asks whether the client is a `Pool` (`instanceof`, or a
  constructor name containing "Pool"); when it is not, it sends its `begin` and `commit` through
  the same `query`. This handle's client is not a pool, so a transaction on it would put `begin`
  and `commit` in scopes of their own and leave the work between them unatomic. `.transaction(`
  still occurs nowhere in the repository, and the handle refuses any statement that opens or ends
  a transaction and sends nothing. It speaks node-postgres only, and refuses a PGlite driver at
  the first statement; the appliance does not use it.
- **The builders build on the pool they are handed** (part 2). `buildDepsFromMapping` and
  `buildDomainDepsFromMapping` no longer open a second handle from
  `TEST_DATABASE_URL || DATABASE_URL`: their mapping check, `PgLedger` and `PgCursorStore` run on
  `tenantScopedDb(pool, tenantId)`, and the rate and byte budgets on `plainDb(pool)`. Their
  signatures did not change, so no caller did: the eight jobs, `build-reindexers.ts`
  (`managedOpener`, through which the verification, the cutover gate and the confirmation reach
  them) and the CLI's `reindex`. The `close()` on what they return releases nothing now; the pool
  is the caller's.
- **The verification reader takes a handle** (part 2): `run-verification.ts` and
  `runCutoverGate` (`cutover-gate.ts`) give `createLedgerVerificationReader` a `tenantScopedDb` on
  their own pool, and `runCutoverGate` no longer takes a connection string (`run-cutover.ts` and
  the CLI's `verify` call it without one).
- **The bare reads move inside `withTenant`** (part 4): `enabledDomains`, `stoppedDomains`,
  `targetProviderKey` and the mapping-name read in `run-rollback.ts`, each keeping its own tenant
  filter. `enabledDomainsForMappings`, the tick's, stays on the bare pool (T2).
  `run-confirmation.ts`'s rate budget is on `plainDb(pool)`, the job's own pool, instead of a
  second pool from `DATABASE_URL` that nothing closed.
- **The fallbacks go** (part 2). `openLedger` (`build-deps.ts`) and `verifyMapping`
  (`orchestration.ts`) no longer read `DATABASE_URL`. `LedgerOptions.ledgerDb` is required, and so
  is the ledger argument of `runAllDomains`, `discoverAllDomains`, `verifyMapping`,
  `applyMappingDeletion`, `applyMappingRelocation` and `applianceOpener`; a caller that passes
  nothing anyway is refused, *"A pass is handed its ledger"*. The appliance already passed its
  handle to every one of them and runs unchanged (its comment is corrected). The standalone
  worker, `apps/worker/src/index.ts`, now passes its own `createPgDb` handle, and its lanes share
  that one pool: `LEDGER_POOL_MAX`, the size of the pool the fallback opened per lane, went with
  the fallback.
- **T4's ratchet.** The three orchestration files read no database URL now and left
  `KNOWN_REMOVED_BY_T1`. `KNOWN_REMOVED_BY_T1_AT_MOST` is 8; `KNOWN_REMOVED_BY_T1_AS_LANDED` keeps
  the eleven it landed with, as its comment requires. The eight jobs remain until step 2. The
  guard's non-vacuity check, which pinned the builders' two reads, now reads their old fallback
  as two reads on a sample line and asserts the three files read none.

**The guard, `apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts`, with its first
two assertions.** It seeds two organisations as the owner and builds organisation A's handles the
way the jobs do, the mail builder's and the other data types' (contacts), on a pool that connects
as `app_user` (the URL derived from `TEST_DATABASE_URL`, as `a-pause-nobody-could-press` derives
it). First, what the pass writes for A reads back (a ledger item and a cursor), and what it asks
before it runs is A's answer (`enabledDomains`, `stoppedDomains`, `targetProviderKey`). Second,
`SELECT count(*) FROM connection`, with no `WHERE`, on the handle each of the four stores was
given, counts A's three connections and none of B's. A fourth case shows why step 1 is safe on
today's connection: on the owner's pool the same scoped handle counts every organisation's
connections. **Failed first:** run against `origin/main`'s versions of the eight changed files in
`packages/` (the test file as here), the second assertion failed, *"the mail ledger: expected 7 to
be 3"*: the builder's own owner handle counted every connection in the database (27 on a later
run, after the other suites had left theirs). The fourth case failed as well, *"tenantScopedDb is
not a function"*. The first assertion's reads failed too, `enabledDomains` with *invalid input
syntax for type uuid: ""*: the bare read on an `app_user` connection that had held a tenant, the
failure this block found on the plain-form tables on 2026-09-27 (*"No tenant set is not always
zero rows"*); its writes passed, because the owner's handle can write. On this branch all 4 cases
pass. Seven mutations, each red: the mail builder's stores on a plain handle (2 of 4 cases fail);
the other data types' builder back on its own owner handle (1); `enabledDomains` on the bare pool
(1); `stoppedDomains` and `targetProviderKey` each scoped to the wrong tenant (1 each);
`tenantScopedDb` scoping its statement to the wrong tenant (2 of 4, and 1 of the unit guard's 8);
`tenantScopedDb` letting a transaction statement through (2 of the unit guard's 8). The unit guard
is `packages/ledger/src/a-handle-scoped-to-one-tenant.unit.test.ts`: the statement order on a
recording `pg` pool, the role when the driver has one, a scope per statement, a rollback, the
refusals, and PGlite refused.

**Where the build departs from §3:**

- **T1 lands in two steps, not together.** §3 has the five parts land together, and each task in
  its own PR with its guard. Step 1 (this) is parts 2 to 4: it changes which handle each store
  and read uses, and no connection. Step 2 is parts 1 and 5: `task-pools.ts`, the eight jobs on
  `APP_DATABASE_URL`, the audit sink's key pool, the third assertion, the ratchet deleted, and the
  wall time after, against a baseline from before step 1 (below). Why that is safe: the danger that made the parts land together is a
  pass that reads nothing and reports success, and only the switch of connection can cause it. On
  today's connection, a superuser's, a scope changes nothing any query sees (the guard's fourth
  case), so step 1 cannot empty a pass. Step 2 is the one change that can, and it lands with the
  test that catches it, whose first two assertions are already here and pass on `app_user`.
- **Part 2 is simpler than written.** The builders already took a pool; they build on it, so no
  caller's signature changed. The verification reader was already able to take a handle; its two
  callers now give it one.
- **`stoppedDomains` is in part 4**, which §3 missed (it is newer than the plan), and the
  confirmation's rate budget was a second pool as well as a bare budget.
- **The first assertion covers the reads a pass makes before it runs** as well as its writes: a
  missed scope there reads nothing just the same.
- **The handle refuses transaction statements** rather than rely on nobody calling
  `.transaction()`.
- **Cost on today's connection.** Every store statement is now a transaction on the owner's
  connection too, three extra round trips each (`BEGIN`, `set_config`, `COMMIT`). So step 1, not
  step 2, is where a pass slows down: step 2's switch adds at most `SET LOCAL ROLE`. The wall time
  step 2 reports is compared against a pass on `main` from before this step merged, not against a
  nightly after it; measured locally in the review fixes' entry below. A pass's stores now share
  the job's pool, node-postgres's default of ten connections, where each builder call used to
  open a pool of its own.

Gates: `pnpm -s typecheck` green; `eslint` on the 34 changed files clean; unit, `packages/ledger`,
`apps/worker`, `packages/orchestration`, `apps/selfhost` and `packages/core`, 262 files and 2615
tests passed; `scripts`, 197 files and 3333 tests passed; the API's tests of the routes that load
orchestration, 47 files and 650 tests passed. Integration against a Postgres 16 with both chains
applied (`scripts/local-pg.sh`), as the owner the harness uses, a superuser: every
Postgres-only integration file in `packages/ledger`, `apps/worker` and
`packages/orchestration`, 22 files and 202 tests passed; the four that need Stalwart or
Nextcloud (`shadow-pass`, `imap-dav-target`, `jmap-reindex`, `shared-mailbox`) were not run
here. Nothing was exercised against a running stack; the nightly deploys `main`'s tasks to the
OTA plane, where this runs on the owner's connection until step 2.

Still open: T1 step 2 and T2; T3 step 2, and the owner's one-off deletion (2026-09-27); T5 step
2, after T1 to T3; the permission report's pool (T5 step 1's note).

**2026-09-28, later: review fixes, same branch, not merged.** Review found five things. Each is
fixed here, and the branch now sits on `main` at 73d94eb7, #1295 included:

- **A scope cost more than its round trips.** `pgDriver`'s `acquire` built a drizzle handle over
  the whole schema for every connection it handed out, and `tenantScopedDb` takes a connection per
  statement and reached its client through that handle. The handle is now built on first use, and
  the scoped handle sends its statement on the connection's own `pg` client. It does so through
  `inTenantScope`, the function `withTenant` now wraps, so the tenant is still set in one place.
  Measured on a local Postgres 16 over TCP (`scripts/local-pg.sh`), 3,000 `PgLedger.find` calls per
  figure, the two versions alternating, two runs each:

  | | plain pool handle | `tenantScopedDb` | what a scope adds | `acquire` alone |
  |---|---|---|---|---|
  | first version | 1.27 and 1.25 ms | 2.26 and 2.44 ms | 1.0 to 1.2 ms | 0.39 to 0.43 ms |
  | fixed | 0.88 and 1.06 ms | 1.33 and 1.32 ms | 0.26 to 0.45 ms | 0.01 ms |

  What is left is the three round trips (`BEGIN`, `set_config`, `COMMIT`). The machine was noisy:
  the plain figure, which this change does not touch, moved by up to a third between runs. So these
  show the shape of the cost, not its size on the box. The unit guard gains a case that counts
  the drizzle handles built: five statements build none. It fails against the first version,
  *"expected 5 to be +0"*, and again with only the eager build put back.
- **The measurement had no baseline.** Step 1, not step 2, adds the transaction per statement;
  step 2's switch adds at most `SET LOCAL ROLE`. A "before" taken from a nightly after this branch
  merged would already carry step 1's cost, and the step 2 comparison would report the switch as
  free. So the baseline is one pass's wall time from a scheduled OTA nightly on `main` before
  this branch merges. Step 2 compares against that. The "Cost" bullet above and §3's "Why one
  transaction per statement" now say so. **Not taken here:** this session cannot reach the OTA
  stack, so it is still to be taken before the merge.
- **Moved onto `main`.** #1295 had recorded T0 in the same lines. Its entry and its T0, T2 and T3
  rows are kept, and step 1's status is added to its T1 row. The sentence above that called #1295
  unmerged now says it merged.
- **The guide said more than step 1 did.** `docs/rls-guide.md` said every store and read a
  per-tenant pass makes runs inside `withTenant`, and that the switch would find nothing left
  outside a scope. Three things a pass touches are outside one:
  - the rate and byte budgets, by design, since their tables have no row security;
  - the app-event sink, which only inserts, into a table with no row security;
  - the audit sink's read of `deployment_key`, which ledger migration 0062 closes to `app_user`.
    That is part 5, step 2's.

  The guide's task row and its paragraph under the table now name all three, and its note at the
  top no longer says "every store".
- **Three scopes had no test.** They were the verification reader in `cutover-gate.ts` and
  `run-verification.ts`, and the rollback's mapping-name read. The reader both use is now one
  exported function, `ledgerReaderFor` (`cutover-gate.ts`). The name read is now `mappingNameOf`
  (`run-rollback.ts`). The integration guard gains two cases on `app_user`:
  - `runCutoverGate` on a calendar migration of A's, with 3 items recorded, blocks with *"3
    calendar item(s) were copied"*: the reader's count. The JMAP target has no calendar listing,
    so the gate stops before it would contact the target.
  - `mappingNameOf` finds the name A gave it.

  Two mutations, each red. With the gate's reader on `drizzle(pool)`, the gate case fails with
  *invalid input syntax for type uuid: ""*. With the name read on a bare `drizzle(pool)`, the name
  case fails the same way. The guard has 6 cases now, all passing.

Gates: `pnpm -s typecheck` green; `eslint` on the 34 changed files clean. Unit tests all
passed: `packages/ledger`, `apps/worker`, `packages/orchestration`, `apps/selfhost` and
`packages/core`, 263 files and 2636 tests; `apps/api`, `packages/managed` and `packages/shared`,
230 files and 3016 tests; `scripts`, 196 files and 3335 tests. Integration against a Postgres 16
with both chains (`scripts/local-pg.sh`), as its owner, a superuser, all passed. That was every
Postgres-only integration file in `packages/ledger`, `apps/worker` and `packages/orchestration`,
23 files and 211 tests. Then the ten in `apps/api` and `packages/managed` that need nothing but
Postgres, 82 tests, run because `withTenant` changed shape. The four that need Stalwart or
Nextcloud were not run.

Still open: the pre-step-1 baseline (above), before this branch merges; T1 step 2 and T2; T3 step
2, and the owner's one-off deletion (2026-09-27); T5 step 2, after T1 to T3; the permission
report's pool (T5 step 1's note).

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's answer: build first, or accept in writing | 📋 **Decided 2026-09-28** (open question 1): (a), T1 to T4 built before the first invitation | §4 and open question 1. 0131 T5's row for this plan. The recommendation was (b): accept in writing for the alpha, with T5's first step, T3's first step and T4 in place before the first invitation. |
| T1 Per-tenant tasks read and write as the application role | Step 1 🔨 **built 2026-09-28**, not merged (parts 2 to 4). Step 2 📋 **Proposed** (parts 1 and 5, the switch). Both before the first invitation (T0 (a), 2026-09-28) | §3. Eight jobs, the builders that opened their own ledger from `DATABASE_URL` (step 1 hands them the job's pool), the stores that filtered by their own `WHERE` (step 1 scopes them), and (on `main`) the audit sink's key. Changing the URL is not enough on its own: under row security, a query with no tenant set reads nothing. |
| T2 The owner's reach kept to the jobs that span tenants | 📋 **Proposed**, with T1; before the first invitation (T0 (a), 2026-09-28) | §3. The sync tick, retention and the purge. The digest, the drift detector and group discovery keep it for the list of tenants only: split, open question 3 answered 2026-09-28. |
| T3 No superuser in a run's environment | Step 1 ✅ **done** in #1222, merged 2026-09-27; deleting the stored value once per plane ⏳ **Owner**. Step 2 📋 **Proposed**, before the first invitation (T0 (a), 2026-09-28) | §3. Step 1: stop uploading `DIRECT_DATABASE_URL`, which no task reads. Step 2: T2's jobs connect as a role that is not a superuser. Step 3: 🅿️ **Parked (trigger: the service admits people the owner has not let in personally)**. |
| T4 A guard that fails when a per-tenant job opens the owner's pool | ✅ **done** in #1222, merged 2026-09-27, as a ratchet | §3. A closed list of the files that may read a database URL other than `APP_DATABASE_URL`. Under T0's option (b) it lands first as a ratchet. T1 empties `KNOWN_REMOVED_BY_T1` and deletes it: step 1 took the three orchestration files off (11 to 8), step 2 takes the eight jobs. |
| T5 The documents say which connection the tasks use | ✅ **Step 1 done** in #1218, merged 2026-09-27. Step 2 📋 **Proposed**, after T1 to T3 | §3. Step 1: what is true today, and an owner pool in the API that §1 missed (Status, 2026-09-27). Step 2: what T1 to T3 built. The legal texts' sentence goes to 0139. |

## 1. What there is today

### Which connection a task uses

- **What every run receives.** `deploy/compose/set-task-env.sh` uploads the task environment to
  Trigger.dev. Its `variables` object always contains `DATABASE_URL` (composed from
  `${POSTGRES_USER}`, the owner, through the pooler), `APP_DATABASE_URL` (`app_user`, through the
  pooler) and `SECRET_ENCRYPTION_KEY`, beside the optional values. Until T3 step 1 (#1222,
  2026-09-27) it also held `DIRECT_DATABASE_URL` (the owner again, straight to `postgres:5432`).
  Trigger.dev stores variables per environment, not per task, so every run of every task gets all
  of them.
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
  *T1 step 1 (Status, 2026-09-28) changed all of this:* the builders and the reader build on the
  pool their caller hands in, and neither fallback reads `DATABASE_URL` any more.
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
  *T1 step 1 (Status, 2026-09-28) changed this too:* the stores run each statement inside
  `withTenant` (`tenantScopedDb`), the three reads above and `stoppedDomains` run inside it, and the
  budgets have a plain handle on the job's own pool.
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
  APP_DATABASE_URL so row-level security is always enforced."* The same comment's
  "migration 0009" is corrected to `0001_baseline` in #1137, merged 2026-09-24. That PR left
  the sentence about the worker as it was, and it is still there on `main`.
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
  organisation (`withSubjectAndTenant`, 0093 T6). So from the first invitation, one database,
  `ownpace-live`'s (0132 D-new), holds the organisations of up to 20 people other than the
  owner. That is the point at which the boundary between organisations starts to carry weight.
- **D2, what the database holds today.** Asked whether ports 5432, 3001, 3090, 3443 and 3126 are
  reachable from outside, whether the database passwords were changed, and whether the running
  identity provider holds other organisations: *"No, these ports are not reachable outside of
  private network/NetBird. Usernamea changed. No other organisations are hosted."* So today, on
  the OTA stack, the boundary separates only the owner's own organisations and the demo tenants.
  The testers' organisations go into `ownpace-live`'s database instead, which is brought up
  without the demo tenants (0132 T1b).
- **D3, the database credentials.** Asked about the blocker that Postgres is published with a
  password this repository contains: *"Ill change user and pass. But not reached from
  internet."* Under 0132 D-new the change is chiefly the OTA stack's. Every run on that stack's
  Trigger.dev plane receives the URLs built from those values, the owner's among them until T3
  step 2, so the change has to be re-uploaded to that task environment. 0132 T2 step 6 does
  that. Live's values are generated before its first bring-up (0132 T1b), and
  `set-task-env.sh`, which reads the `.env` beside it and uploads to the `TRIGGER_PROJECT_REF`
  that file names, puts the URLs built from them on live's own plane (0132 T1c). There too the
  owner's is among them until T3 step 2.
- **D4, who holds credentials.** Asked about rotating the demo secrets: *"Who would need/het
  credentials? I aupporrthe test. No one will be added to NetBird network. Devs need to setup own
  private test/dev environments. GitHub PRs and git is the bridge."* 0132 §4 answers the question
  about people. This plan adds a holder that is not a person: every task run, on either stack's
  plane, holds that stack's owner URL in its environment.
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
So T1 has five parts. They were written to land together; they land in two steps, parts 2 to 4
and then parts 1 and 5, and the Status block (2026-09-28) says why that is safe.

1. **One place builds the tasks' pools.** It is a small module with no import side effects, for
   example `apps/worker/src/jobs/task-pools.ts`. It builds the per-tenant pool from
   `APP_DATABASE_URL`, and it refuses to start when that variable is unset. It never falls back
   to `DATABASE_URL`. The API's `getDbPool` falls back, which its comment gives as the self-host
   arrangement, but a task that did so would quietly be back on the owner. The eight per-tenant
   jobs take their pool from this module. Every `withTenant` scope in them is then under the
   policies with no further change.
2. **The builders are handed their handle.** `buildDepsFromMapping`,
   `buildDomainDepsFromMapping` and the verification reader stop reading `DATABASE_URL` and take
   the handle from their caller. Their callers are the eight per-tenant jobs, `managedOpener` and
   `buildTargetReindexers` (`build-reindexers.ts`), through which the verification, the cutover
   gate and the confirmation reach them, and the operator's CLI (`cli/index.ts`, its `reindex` and
   its `verify`). `LedgerOptions.ledgerDb` (`build-deps.ts`) is the precedent: the
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
4. **The bare helpers move inside `withTenant`.** These are `enabledDomains`, `stoppedDomains`
   (`enabled-domains.ts`, added on 2026-09-25 by 0128 T4 after this plan was written: a bare read
   of `path_lifecycle` joined to `scope_selection`, which the verification and the cutover gate
   call), `targetProviderKey` and the mapping-name read in `run-rollback.ts`.
   `enabledDomainsForMappings` stays as it is, because the tick uses it across tenants (T2).
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
before and after on the stack T1 is proven on (§4), and writes both figures in this block. T1
landed in two steps, and the first is the one that adds the transaction per statement, so
"before" is a pass on `main` from before step 1 merged (Status, 2026-09-28).

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
So step 1 also deletes the stored value once on each plane that holds it, the OTA stack's and,
if it was filled before step 1 landed, live's own (0132 T1c), and checks the list the script
prints afterwards.
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

This interacts with D3. On the OTA stack, after the owner changes the owner role's user and
password (0132 T2), the new owner URL is what every run on that stack's plane receives until
step 2 lands. 0132 T2 step 6 re-uploads it. On live, the owner URL built from the values
generated before its first bring-up (0132 T1b) is what every run on live's own plane receives
until then, and a live deploy (0132 T6) re-uploads it.

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
letting it pass by matching nothing. On the code it was written against it failed on
`run-delta-sync.ts`, the seven other per-tenant jobs and three files in
`packages/orchestration/src`: the builders, `build-deps.ts` for `openLedger` and
`orchestration.ts` for `verifyMapping`.

T5's guard is to read the same list, so that the code and the guide cannot disagree about who
holds the cross-tenant connection. The list landed unexported (Status, 2026-09-27): importing
from a `.unit.test.ts` runs its cases in the importer, so T5 step 2 first moves the lists to a
plain module both guards import.

**Under T0's option (b)** it lands before T1, as a ratchet. Today's per-tenant readers go on a
second list, "known, removed by T1", which may only shrink. A new file that reads the owner's URL
fails at once. T1 empties that second list, and its PR deletes it. It landed as that ratchet
while T0 was still open, with eleven entries (#1222); T1's first step took the three
orchestration files off, and its second step, which moves the eight jobs, empties and deletes it.

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
  it. Under 0132 D-new that is the OTA stack, which follows `main` nightly and holds no testers;
  live takes the change only from a tag (0132 T1g). The alpha waits for it.
- **(b) Accept the gap in writing for the alpha, and build T1 to T3 before it ends.**
  *Recommended.* Before the first invitation: T5 step 1, T3 step 1, and T4 as a ratchet. T1, T2
  and T3 step 2 follow, and must land before the alpha ends or admits anyone the owner has not
  let in personally, whichever comes first. The reasons: the people are 10 to 20 the owner lets in
  and supports (D1); nobody has found a task query that crosses organisations, though nobody has
  audited them all; and a T1 built in a hurry risks passes that silently copy nothing, which
  testers would feel more directly than a risk that has not been realised.

**Decided 2026-09-28: (a)** (T0, open question 1).

What (b) accepts, said plainly: for the alpha's weeks, a defect in a task's own tenant filter
could read or write another tester's rows, including that tester's stored credentials, which the
run holds the key to decrypt. The database would not stop it. And every run holds a superuser's
credential until T3 step 2. 0131 T5 asks for the reason to be stated. The owner writes the
acceptance in their own words, with the date it ends.

## Cross-references

- 0131 T5: the go/no-go row for this plan.
- 0132 D-new: testers on `ownpace-live`, whose tasks run on its own Trigger.dev plane (T1c)
  with URLs built from its own `.env` (T1b). The OTA stack is where T1 is proven (§4); live takes
  it from a tag (T1g). 0132 T8, which §4 cited before, is superseded by D-new.
- 0132 T2: the password change (D3), now chiefly the OTA stack's; its step 6 re-uploads the task
  URLs there. 0132 T6 does the same for live.
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
- **The API's request path.** It already connects as `app_user` (§1), with one exception found
  on 2026-09-27: the permission report's own pool (Status). That one is not in the table yet.

## Open questions

1. **T0: (a) or (b)?** If (b), the date or event that ends the acceptance, and the reason, for
   0131 T5. **Answered 2026-09-28: (a)**, *"0138 T0: build the fix first."* Nothing is accepted in
   writing, so there is no end date to state.
2. **T3's end state.** Is the system role of step 2 the end, or should step 3's functions follow
   at its trigger, so that no run holds a credential that reads past the policies? Recommended:
   step 2 for the alpha, step 3 before the service admits people the owner has not let in.
3. **The digest, the drift detector and group discovery.** Split them as T2 proposes, or keep
   them whole on the system connection? They are on T4's list either way, for their list of
   organisations. Splitting puts their per-tenant reads under the policies. Keeping them whole is
   less work, and leaves those reads past the policies too.
   **Answered 2026-09-28: split them**, *"0138 open question 3: a - split them"*. T2 splits the
   three: the list of organisations from the cross-tenant connection, each organisation's reads
   through `withTenant` on the application pool (PR D, after C).
