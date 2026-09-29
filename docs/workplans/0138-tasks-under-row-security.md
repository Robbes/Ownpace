# Workplan 0138 — Tasks under row security

> **In one line:** Trigger.dev tasks reading tenant data as `app_user` under row security instead of the superuser owner via `DATABASE_URL`, owner reach kept to cross-tenant jobs, `DIRECT_DATABASE_URL` dropped from `set-task-env.sh`, a pool guard, docs corrected.

## Status — 2026-09-29 (update this block at the end of every session)

**2026-09-29, later: T3 step 2's migration renumbered to `0033`, and the purge granted the
texts' acceptances (blocking), same branch, not merged.** `main` merged in first (#1360, #1366).

- **`0033`, not `0032`.** #1360 (0139 T3) merged managed `0032_a_text_accepted_with_its_version.sql`
  first, so this branch's role is now `0033_a_system_role_that_is_not_the_owner.sql`, applied after
  it (the runner orders by file name). It had run on no stack, as the entry below says, so the new
  number is safe. Every reference this branch made moved with it; the entries below say `0033` for
  this migration throughout. The two that stay `0032` are #1360's, `legal_acceptance`.
- **The purge granted `legal_acceptance` (blocking).** #1360 put `legal_acceptance` in
  `PURGED_TABLES`, and `0033` did not grant it, so every erasure as `ownpace_system` would have
  stopped: on a throwaway Postgres (`scripts/local-pg.sh`) with both chains,
  `a-system-role-that-is-not-the-owner.integration.test.ts` failed 2 of 39, *"legal_acceptance is
  in PURGED_TABLES and has no grant listed here"* and the purge's own *"permission denied for table
  legal_acceptance"*, rolled back. `0033` now grants it `SELECT (tenant_id), DELETE` with the
  others the purge empties (32 tables), and the guard's `EXPECTED` lists it: 39 of 39.
- **The search clean-up's sentence.** #1366 merged first, so this branch takes out the sentence its
  guard names once `set-task-env.sh` stops uploading `DATABASE_URL`: `support-read-prune.sh`'s
  header and the runbook now say the purge runs as `ownpace_system` since this step, and 0139's
  entry quotes the case by its guard's name. `a-search-kept-past-its-year`: 1 of 17 red on the
  merge, 17 of 17 after.

**2026-09-29 (placed first, the latest): review fixes for T3 step 2, same branch, not merged.**
Review found one blocking thing, four major and seven minor. Each is fixed here, in one commit
after a merge of `main` (fc10672d) into the branch; none was rejected.

- **`main` merged in, and the purge's two new tables granted (blocking).** #1332 (0153 T2) added
  `person_migration` and `person` to `PURGED_TABLES`; `0033` granted neither, so every hourly purge,
  as `ownpace_system`, would have rolled back at `DELETE FROM person_migration`, permission
  denied, and no erasure would have completed. Both are in `0033`'s purge-only list now
  (`SELECT (tenant_id), DELETE`, 29 tables becoming 31) and in the integration guard's `EXPECTED`,
  and its purge case seeds C a person and the migration that is theirs and counts both in the
  receipt. **Red first, on the merged tree with the guard as it was: 2 of 32** (*DELETE on every
  table the purge empties*: "person_migration is in PURGED_TABLES and has no grant listed here";
  the purge: "permission denied for table person_migration", rolled back).
- **Into `0033`, not a new `0034` (major, the plan's half of it).** The migrator records a
  migration by its file name and never runs it again, so amending one that a stack has applied
  changes nothing there. `0033` has run on no stack: this branch was never pushed (`git ls-remote
  origin` lists no ref for it), so no E2E (managed) run could have applied it, and the only
  databases that ran it were throwaway ones. So it is amended in place. **Dispatch no E2E
  (managed) for this branch until it is about to merge**: a stack that applies `0033` refuses to
  start `main`'s API at the next nightly (*"Database schema version 0033… is newer than this build
  understands"*, which review replayed with `runMigrations`). Merge it before a nightly, then let
  that nightly or a dispatch on `main` run it.
- **Membership, both ways (major).** Every check asked which roles `ownpace_system` belongs to and
  none which roles belong to it: a later `GRANT ownpace_system TO app_user` passed them all, and
  `app_user`, the API's own request role, could then `SET ROLE ownpace_system` and read every
  organisation's rows (review: 0 before, 4 after, on its database). The bring-up's question
  (`DB_ROLES_SYSTEM_FIT_SQL`) answers an eighth field, the roles that belong to it, and refuses one
  ("*N role(s) belong to it, and take its BYPASSRLS and grants with SET ROLE*"); the smoke asks it
  too; the integration guard asserts both directions, runs the bring-up's own question and the
  smoke's against the database and holds each to its fit answer, and adds a refusal: the role
  cannot `GRANT ownpace_system TO app_user` itself. The migration's header, rls-guide, SECURITY,
  the runbook and `managed-bring-up.md` (*The system role*, whose `\du` and `REVOKE` covered one
  direction: now both, with a query that lists both) say so.
- **What it may actually do, PUBLIC included (major).** The grant checks read access-list entries
  written to the role's name, and a grant to PUBLIC is one the role holds too: with `BYPASSRLS`,
  `GRANT SELECT ON decision TO PUBLIC`, harmless-looking under row security for `app_user`, handed
  it every organisation's decisions with the guard green. The guard now also compares, for every
  relation outside the system schemas, `has_table_privilege` for every privilege (`MAINTAIN` on 17
  and later) and `has_column_privilege` for the rest with `EXPECTED`; and asserts no `SECURITY
  DEFINER` function it may call, no sequence, `CREATE` on no schema, no default privileges for
  PUBLIC or for it, and on the database exactly PUBLIC's `CONNECT` and `TEMPORARY`. The written-to-
  its-name comparison stays, for the exact list.
- **The bring-up's order and verdict are run, not read (major).** The guard found
  `system_role_ready` in `phase_tasks`'s text, comments included, and `1) die` somewhere after the
  question; commenting the call out, skipping it on a variable, or answering the question and
  ignoring the answer all stayed green. `a-superuser-the-bring-up-would-have-uploaded` now takes
  `phase_tasks`, `system_role_ready`, `say`, `note`, `die` and `env_get` out of
  `bootstrap-managed.sh` as written and runs them under `set -euo pipefail`, with `db-roles.sh`,
  `set-task-env.sh`, `deploy-tasks.sh` and `ensure-env-secrets.sh` as stand-ins that record what
  ran: a fit role runs *fit, set, prove, upload, deploy, forget*, in that order; an unfit role or
  an unasked question stops at *fit*; a password that did not set or does not open stops before the
  upload; an upload or a deploy that fails stops there, the forget not run; a password a URL does
  not carry stops before the question. And the phase's statements, comments dropped, are held to
  what they are, which is what a skip keyed on a variable the run does not set changes.
- **The owner's names forgotten only after a deploy that went through (minor).** `set-task-env.sh`
  deleted `DATABASE_URL` before `deploy-tasks.sh` ran, and a failed deploy would have left the old
  tasks, which read it, with nothing to connect to. It is two runs now: the upload (which deletes
  nothing of the owner's and says when a name is still stored) and `set-task-env.sh
  --forget-owner-names` (which uploads nothing, deletes both names, reads the list back and fails
  when either is left), and `phase_tasks` runs the forget last, after the deploy. The header,
  `deploy-tasks.sh`'s, `deploy-live.sh`'s, `stand-up-live.sh`'s, `managed-bring-up.md` (phase 9,
  the non-production recipe's new step 6, *The owner's names in the task environment*, with what a
  failed deploy leaves and how to go on), rls-guide and the runbook say so.
- **A setting left on the role (minor).** An ordinary role may change its own password and its own
  settings, per database too (asked: both accepted as `ownpace_system`), and `RESET ALL` without
  `IN DATABASE` leaves the per-database ones. `db_roles_system_set` sends, in one transaction with
  the password, `ALTER ROLE … RESET ALL` and `ALTER ROLE … IN DATABASE :"DBNAME" RESET ALL`; the
  smoke's question counts the settings left (a ninth field); the integration guard has the role
  set both kinds on itself, sees its writes refused, runs the bring-up's two `RESET` lines and
  finds none left. `0033`'s header no longer says `NOCREATEROLE` stops it changing itself. On the
  cluster: with `default_transaction_read_only = on` set on the role, the old smoke's question
  answered `false|false|false|false|true|true|0`, its pass; the new one answers `…|0|0|1`, a
  failure, and `…|0|0|0` after the reset.
- **`rotate-db-passwords.sh`'s closing line (minor)** said the gate uploads `DATABASE_URL`; it says
  `SYSTEM_DATABASE_URL` and `APP_DATABASE_URL`, that the owner's URL no longer goes to the tasks,
  and that the script does not rotate the system role's password.
- **The list's verdict held to its own branch, and run (minor).** The rule found `process.exit(1)`
  anywhere after the list's check, and the `.catch` at the end always has one, so the exit in the
  `if (kept.length > 0)` branch could go and a stored `DATABASE_URL` pass as a warning. The rule
  now reads that branch, closed at its own indentation; and the whole script runs, in a copy of its
  directory, against a stand-in `@trigger.dev/sdk` recording every call and a stand-in `docker`
  answering the role question: the upload run uploads the system role's URL composed from `.env`,
  deletes nothing of the owner's, and refuses (nothing uploaded) a superuser, a role another
  belongs to, no role, or a question it could not ask; the forget run deletes both names, uploads
  nothing, asks nothing, passes on a clean list and **exits 1** when the list still holds either;
  an unknown argument is refused before anything.
- **No fallback the rule cannot see (minor).** Rule 8 saw only spelled-out names: a new
  `direct-url.ts` export returning `env.DATABASE_URL`, imported by a job through `@openmig/ledger`,
  or `` process.env[`${p}DATABASE_URL`] `` beside the visible read, stayed green. `AT_THE_MACHINE`
  files now export exactly what is listed (`direct-url.ts` its two helpers, the CLI nothing); an
  `ON_THE_SYSTEM_ROLE` file imports nothing from them; and reads the environment only by names it
  spells (no computed key on `process.env` or an `env`, no `process.env` handed on, spread or
  enumerated; a parameter's default is allowed).
- **`set-task-env.sh` asks too (minor).** The sentence that the role is *"asked, not assumed, every
  time its URL is about to go up"* was true of the bring-up alone, and the repository tells
  operators to run the script alone (a key rotation, another environment). The upload run now
  sources `db-roles.sh` and asks `db_roles_system_fit` over the socket before anything goes up,
  and uploads nothing on any answer but fit. The forget run uploads nothing and asks nothing.
- **"No table" was "no permanent table" (minor).** Through PUBLIC's `TEMPORARY` on the database the
  role can make a temporary table (review made one). The documents say *no permanent table*, and
  the guard's database check names `CONNECT` and `TEMPORARY` as the two PUBLIC gives it. Not done:
  revoking `TEMPORARY` from PUBLIC. A temporary table lives and dies with the session that made
  it, reads nothing the role could not, and the revoke would be a database-level change the
  migration chain does not make anywhere else, taken from `app_user` and every tool too.

**Guards written first, and how they failed.** On the merged tree before any fix: the integration
guard as it was, 2 of 32 (above); the integration guard as rewritten, **5 of 39** (the bring-up's
question and the smoke's, the grants, what it may do, the purge, and the settings' reset); unit,
the three rewritten files, **18 of 225** (T3's 13, among them the whole-script runs; the
bring-up's 5, among them the run of the phase; T4's new cases pass on this code, and the table
below shows each red on what review wrote). After the fix: the integration guard **39 of 39**;
unit, the five guard files, **248 of 248**.

**Each gap review found, green on the old guard and red on the new.** The old guards are
2da5c8ac's, run in a scratch copy of that tree (unit) or, for the integration guard, 2da5c8ac's
file with `person` and `person_migration` added to `EXPECTED` (the merge's two lines, so it can
pass at all), on a fresh database of the merged chains plus the later migration named. Every
mutation restored after its run and the tree compared.

| # | Mutation (review's name where it had one) | Old guard | New guard |
|---|---|---|---|
| R1 | A later migration: `GRANT ownpace_system TO app_user` | integration 32 of 32 passed | 2 failed (membership both ways; the bring-up's question) |
| R2 | A later migration: `GRANT SELECT ON public.decision TO PUBLIC` | 32 of 32 passed | 1 failed (what it may do) |
| R3 | A later `SECURITY DEFINER` function, PUBLIC's `EXECUTE` left | 32 of 32 passed | 1 failed (nothing else anywhere) |
| R4 | `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO PUBLIC` | 32 of 32 passed | 1 failed (nothing else anywhere) |
| B1 | `system_role_ready` commented out in `phase_tasks` | unit 212 of 212 passed | 11 failed |
| B2 | `[ "${SKIP_SYSTEM_ROLE_CHECK:-0}" = 1 ] \|\| system_role_ready` | 212 of 212 passed | 1 failed (the phase's statements) |
| B3 | The question answered and ignored (`\|\| note …`) | 212 of 212 passed | 2 failed (an unfit role, an unasked question) |
| S3 | The exit taken out of the list's verdict, *FAILED* made *WARNING* | 212 of 212 passed | 5 failed (the rule; the forget run on either name left; two mutation anchors) |
| U1 | A new `direct-url.ts` export read by retention through `@openmig/ledger` | 212 of 212 passed | 3 failed (exports closed; import; `process.env` handed on) |
| U2 | `` process.env[`${p}DATABASE_URL`] `` behind the tick's visible read | 212 of 212 passed | 1 failed (names it spells) |
| F3 | The forget run before the deploy | — | unit 3 failed |
| F4 | The settings' `RESET` lines taken out | — | unit 1, integration 1 failed |
| F6 | The bring-up's question one way only again | — | unit 1, integration 1 failed |
| F6s | The smoke's question one way only again | — | integration 1 failed |
| F11 | `set-task-env.sh`'s question skipped | — | unit 6 failed |

Documents in the same commit: `0033`'s header, `docs/rls-guide.md`, `SECURITY.md`, `README.md`,
the SAD v1.12 (§16, §17.1), `docs/operator-runbook.md`, `docs/managed-bring-up.md` (phase 9, the
non-production recipe, *The owner's names in the task environment*, *The system role*),
`managed.env.example` and `.env.example`, the worker README, and the headers of
`set-task-env.sh`, `db-roles.sh`, `bootstrap-managed.sh`, `smoke-managed.sh`, `deploy-tasks.sh`,
`deploy-live.sh` and `stand-up-live.sh`. `pgbouncer.ini` did not change.

Gates, run last, on the tree as committed: `pnpm -s typecheck` green; eslint on the four changed
`.ts` files clean; `vitest run --project unit scripts apps/worker packages/managed
packages/ledger`, **324 files, 5113 tests, all passed** (and the ten files that read `README.md`
or file modes again after the last `README.md` edit, 246 passed); on a throwaway Postgres 16
rebuilt by `scripts/local-pg.sh` with both chains (`LOCAL_PG_DIR=/tmp/ownpace-local-pg-0138e`,
port 55448), the ten integration files the last entry ran, **123 tests, all passed**. The first
run of those ten had `run-rollback` fail all 8 of its cases at its first insert, *"Key
(mapping_id)=(7a160000-…d1) is not present in table mailbox_mapping"*: the file alone then passed
8 of 8, and all ten again on a fresh cluster passed 123 of 123; nothing in this change touches
that file's tenant, which no other file shares. The workplan index, `LESSONS.md` and
`OPERATIVE.md` current; `commit-convention.mjs` over the branch. The cluster was removed after.
Not run: Atlas's migration lint (no Docker here; CI's `migration-lint` runs it), shellcheck (not
installed; `bash -n` on every changed script). Nothing was exercised against a running stack.

**2026-09-28, later still (placed first, the latest): T3 step 2 built: the jobs across
organisations connect as a system role that is not the owner,** on branch
`claude/ownpace-public-readiness-y7orc6-a-system-role-that-is-not-the-owner`, on `main` at
9cbe3240 (T2, #1330), not merged. Built on the owner's answer to open question 2, *"yes, For the
Alpha, the jobs that span organisations get their own account, one that is not a superuser."*
After this no task run reads `DATABASE_URL` or `DIRECT_DATABASE_URL`, and `set-task-env.sh`
uploads neither. What changed:

- **Who moved, read from the code** (T4's `CROSS_TENANT`, each file read): the sync tick, retention
  and the purge of closed organisations, whole (each built its pool from `DATABASE_URL` at import);
  `activeOrganisations`, the split jobs' list; and `openTaskPools`'s audit key pool, which every
  per-tenant task, split job and the standalone worker opens. All five read `SYSTEM_DATABASE_URL`
  now, refuse without it, and never read `DATABASE_URL`: no fallback in either direction.
  **Stays on the owner**, none of it in a task: the API's migrations and its own audit key pool
  (`DIRECT_DATABASE_URL`; §3 T3 is about what a run holds, and the API is no run), the operator's
  CLI (`cli/index.ts`, at the machine), `direct-url.ts` (the API and the seed), the seed, and the
  bring-up scripts. T4's lists split to say so (rule 8, below).
- **The name, `SYSTEM_DATABASE_URL`.** It ends in `DATABASE_URL`, so T4 counts a read of it and T3's
  guard lets it go up (both require that shape); it is not `DATABASE_URL`, which the API, the CLI
  and the seed still read as the owner, so no task code that reads the owner's name finds anything
  in a run; and "system role" is this plan's own word for it. The role is `ownpace_system`, a name
  the migration fixes and `.env` does not choose (it grants by name, as `app_user`'s do, and a
  setting that may hold one value is a trap: `stand-up-live.sh` has to refuse `APP_DB_USER` for
  that reason). Its password is `SYSTEM_DB_PASSWORD`.
- **The role**, managed migration `0033_a_system_role_that_is_not_the_owner.sql` (managed-only, so
  the managed chain; it runs after the ledger chain and grants on both chains' tables): `LOGIN
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS`, created if absent and the attributes
  stated again with `ALTER ROLE` whatever was there, **no password**, a member of no role, no
  default privileges. **`BYPASSRLS` is required**: every question these jobs ask crosses
  organisations over row-secured, FORCEd tables, and a role row security binds reads no row there
  with no organisation set, so the tick would start nothing, the purge erase nobody and the list
  name nobody, each as a quiet night.
- **The grants, the exact list**, one per statement the jobs send (the tick's hold, hold count,
  `ACTIVE_MAPPINGS_SQL`, `enabledDomainsForMappings`, `PASSES_IN_FLIGHT_SQL` and beat; retention's
  run-event, run, application-event and declined-request prunes and its invoice read; the purge's
  due query, live runs, landing a stale run, the revocation's read, `status = 'deleting'`,
  `purgeTenant`'s invoice detach, its delete from every `PURGED_TABLES` table and the tenant, and
  the receipt; the list; the audit key; the log page), each asked of Postgres rather than
  reasoned: `USAGE` on schema `public`; `SELECT, DELETE` on `tenant_closure`, `run_event`,
  `mailbox_mapping`, `mailbox`, `connection`, `migration_status`, `cutover_state`,
  `path_lifecycle`, `scope_selection`; `SELECT, DELETE, UPDATE (status)` on `tenant`; `SELECT,
  DELETE, UPDATE (status, finished_at, stats)` on `run`; `SELECT (tenant_id), DELETE` on the 29
  tables the purge only empties (`item`, `sync_checkpoint`, `cursor`, `collection_mapping`,
  `verification_run`, `verification`, `cutover_event`, `cutover`, `migration_discovery`,
  `decision`, `policy_preset`, `group_def`, `share_grant`, `apply_receipt`, `setup_step`,
  `backup_target`, `mapping_link`, `vat_consultation`, `occupancy_peak`, `bytes_moved`,
  `grant_link_allowance`, `payment_method`, `usage_metric`, `tenant_member`, `tenant_pricing`,
  `audit_log`, `rate_budget`, `byte_budget`, `support_read`); `SELECT (tenant_id, name), DELETE`
  on `billing_party`; `SELECT (id, tenant_id, state, decided_at), DELETE` on `access_request`;
  `SELECT (id, tenant_id, period_end, status, billed_to_name), UPDATE (tenant_id, billed_to_name)`
  on `invoice`; `SELECT (tenant_ref, purged_at), UPDATE (purged_at, retained_invoice_ids,
  purged_counts, revocations)` on `erasure_record`; `SELECT` on `platform_pause`; `SELECT, INSERT,
  UPDATE (beat_at)` on `sync_tick_beat` (the upsert reads `EXCLUDED.beat_at`, which needs `SELECT`
  on it: asked, a column grant on `task` alone was refused); `SELECT, INSERT` on `deployment_key`;
  `SELECT, INSERT, DELETE` on `app_event` (the prune picks rows by `ctid`, which a column grant
  does not cover: asked). Of the tables in `public`, only `platform_operator` and the `support_*`
  views have nothing. Cascades (a run's events, a verification's run) run as the table's owner, as
  every referential action does, and need nothing.
- **Its password: as `app_user`'s, as far as a public repository allows.** `app_user` is created
  with a published literal that the bring-up (`stand-up-live.sh`) or the rotation then replaces;
  this role gets no literal at all. `ensure-env-secrets.sh` generates `SYSTEM_DB_PASSWORD`
  (`openssl rand -hex 24`, live and the OTA stack alike, safe on a volume that exists because the
  role has none until it is set), and `bootstrap-managed.sh`'s `tasks` phase sets it on the role
  with `ALTER ROLE` over the database's socket, the value passed by name as `db_roles_set` passes
  the other two, on every run. On a `.env` from before this, brought up from a later phase
  (`deploy-live.sh` runs `--from data`), the phase runs `ensure-env-secrets.sh` itself, which fills
  in a missing secret and replaces none.
- **The bring-up asks first, and refuses** (`system_role_ready`, before `set-task-env.sh`, in the
  phase every bring-up runs: the nightly gate's, `deploy-live.sh`'s, `stand-up-live.sh`'s):
  `db_roles_system_fit` (`db-roles.sh`) asks the catalog over the socket for the role's
  attributes and memberships and refuses a superuser, a role that may create roles or databases,
  one that replicates, one that belongs to any role (it would take that role's rights with `SET
  ROLE`), one without `BYPASSRLS` or `LOGIN`, and none at all, naming every reason at once; then
  `db_roles_system_set`, then `db_roles_system_prove` (the role opens with the value over the
  stack's network and through the pooler). A password a URL cannot carry as it is is refused.
- **`set-task-env.sh`** composes `TASK_SYSTEM_DATABASE_URL` from `ownpace_system` and
  `${SYSTEM_DB_PASSWORD}` (refused empty, no default) and uploads it as `SYSTEM_DATABASE_URL`;
  uploads nothing composed from `POSTGRES_USER`/`POSTGRES_PASSWORD`; after the upload deletes
  `DATABASE_URL` and `DIRECT_DATABASE_URL` from the store, printing what each delete answered; and
  reads the list back, **failing** when either is still there.
- **PgBouncer**: the system role has a pair of its own (`auth_query` finds it; nothing to
  configure); its 25 take what the owner's did for the tasks, so the server-side total does not
  grow. Written in `pgbouncer.ini`. Not measured through a real PgBouncer, and Postgres's
  `max_connections` (the image's 100) was not measured against three pairs either: at their
  ceilings, 3 × 30 plus the direct connections is near it; in practice the owner's pair now serves
  no task.
- **The smoke** gains a section before its verdict: the role is what the migration made it, and
  the sync tick, on the system role now, beat within the readiness route's five minutes. The E2E
  (managed) workflow needs no change: its secrets step runs `ensure-env-secrets.sh` and persists
  the `.env` back, so the gate's `.env` gains `SYSTEM_DB_PASSWORD` once and keeps it.
- **Documents**: `docs/rls-guide.md` (note, opening, the table's three rows, the paragraph, §2's new
  `SYSTEM_DATABASE_URL` bullet, the owner's holders, the pitfall, the test list),
  `docs/operator-runbook.md` (*The database roles*, retitled from two to three, and the
  troubleshooting line), `docs/managed-bring-up.md` (phase 9, *The owner's names in the task
  environment*, *The system role*, the rotation's step 3), `SECURITY.md`, `README.md`, the SAD
  v1.11 (§16, §17.1), `managed.env.example` and `.env.example` (`SYSTEM_DB_PASSWORD`, empty), the
  worker README and help text, `pgbouncer.ini`, and the headers of `set-task-env.sh`,
  `deploy-tasks.sh`, `deploy-live.sh`, `stand-up-live.sh`, `ensure-env-secrets.sh`, `db-roles.sh`,
  `task-pools.ts` and the three jobs.

**The guards, and how they failed first.** Written before the build and run against this branch's
base, 9cbe3240 (logs in the session's scratchpad):

- Unit, six files, **47 of 235 failed**. `a-run-that-carries-no-superuser` (T3's), with the ratchet
  `OWNER_URL_UNTIL_T3_STEP_2` deleted and four new rules, `owner-name` (neither of the owner's names
  goes up, under any value), `system` (the system role's URL goes up, composed from its name and
  `${SYSTEM_DB_PASSWORD}` alone, after a refusal of an empty one), `deletes` (both names deleted
  after the upload, in a loop, and the list read back with exit 1), and the `owner` rule without
  its exception: 14 of 34, among them 8 new ways back, each red. `a-pass-that-opened-the-owners-pool`
  (T4's) gains **rule 8**: `CROSS_TENANT` splits into `ON_THE_SYSTEM_ROLE` (the three jobs and
  `task-pools.ts`, which read `SYSTEM_DATABASE_URL` and no other database URL) and `AT_THE_MACHINE`
  (the CLI and `direct-url.ts`, which never read it), no other file reads it, and no file that runs
  in a task reads `DATABASE_URL` or `DIRECT_DATABASE_URL`: 6 of 136. New,
  `a-superuser-the-bring-up-would-have-uploaded`: `db-roles.sh`'s question run against a stand-in
  for Compose (a fit role passes; a superuser, `CREATEROLE`, `CREATEDB`, `REPLICATION`, a
  membership, no `BYPASSRLS`, no `LOGIN`, the owner as the stack makes it, and no role are each
  refused; a question it could not ask is not an answer; the password by name, never in an argument,
  the statement kept out of the log; an empty one refused), `phase_tasks` asking before
  `set-task-env.sh`, and one name in the migration, `db-roles.sh` and the upload: 18 of 19 (the one
  that passed checks that `deploy-live.sh` and `stand-up-live.sh` run that phase).
  `a-task-pool-that-fell-back-to-the-owner`: 7 of 12. `a-knob-the-tasks-can-never-see` (its
  non-vacuity check now names `SYSTEM_DATABASE_URL`) and `every-audit-field-is-classified` (the key
  on `systemUrl`): 1 each.
- Integration, on a throwaway Postgres 16 with both chains, **new**,
  `apps/worker/src/jobs/a-system-role-that-is-not-the-owner.integration.test.ts` (32 cases): the
  role's attributes and no membership; its grants, table by table and column by column, equal to a
  list of its own; nothing on any schema, database, function or default but `public`'s `USAGE`;
  `DELETE` on every `PURGED_TABLES` table; logged in with a password set as the bring-up sets it,
  the tick's own `run` under a hold (starts nothing, counts what is in flight, beats) and free
  (starts A's due migration, leaves B's running one and the closed C's, beats), retention's `run`
  (A's old run and its log to the last invoice, the declined request, the old event), the purge's
  `run` (a run no runner holds landed, C revoked and erased from every purged table, its invoice
  detached with the buyer's name, the receipt counted), the list, the key and the log page; and 19
  refusals (a role, a database, `SUPERUSER`, `SET ROLE` to a server role and to the owner, the
  server's files and programs, a table of its own, a purged table's rows, a member's address, a
  request's name, an invoice's amounts, the operators, the operator's screens, and four writes it
  was not granted), each on a connection of its own in a transaction rolled back. The jobs are
  imported with the SDK's `schedules.task` handing back the config, so their `run` is called, and
  `trigger`, `runs.retrieve` and `configure` stood in. **Against the base it failed in `beforeAll`**,
  *role "ownpace_system" does not exist*, 32 not run. T2's guard and T1's, handed the system role
  (the owner's connection with `-c role=ownpace_system`) in place of `DATABASE_URL`, and now
  asserting the key's pool is `ownpace_system` and no superuser: 6 of 7 failed and 8 of 14 not run
  (*"DATABASE_URL is required, for the audit key's pool alone"*).

**Mutations, each red** (unit: the six files above; integration: the new guard on a fresh database
with both chains for each migration change, the role's attributes put back after each; restored
from a copy and compared after each):

| # | Mutation | Red |
|---|---|---|
| M1 | A fallback: the key's pool takes `SYSTEM_DATABASE_URL ?? DATABASE_URL` | 3 unit (rule 8 twice; *never reads the owner's DATABASE_URL*) |
| M2 | `set-task-env.sh` uploads `DATABASE_URL` again, the owner as it was | 7 unit (`owner`, `owner-name`, `credential`, and four earlier ways back whose anchors it moves) |
| M3 | The stored `DATABASE_URL` left in the store (`OWNER_NAMES` without it) | 2 unit |
| M4 | The bring-up's question removed from `phase_tasks` | 1 unit |
| M5 | The list on `DATABASE_URL` again | 5 unit; integration 4 (T2's list and digest, the new guard's list) |
| M6 | The tick on `DATABASE_URL` again | 4 unit (rule 8 twice, T4's non-vacuity, and `a-knob`, once it stopped counting the deletion list's quoted names as uploads) |
| M7 | The question lets a superuser through | 2 unit |
| M8 | The question lets a member of a role through | 1 unit |
| M8b | The question lets `CREATEROLE` through | 2 unit |
| M9 | The migration makes the role `SUPERUSER` | integration 21 of 32 (the attributes, the login, and every refusal) |
| M10 | The migration makes it `CREATEROLE` | integration 2 (the attributes; a role created) |
| M11 | A missing grant: `run_event` | integration 3 (the grants; retention's and the purge's runs fail) |
| M12 | An extra grant: `SELECT` on `item` | integration 2 (the grants; a purged table's rows read) |
| M13 | The migration makes it a member of `pg_read_server_files` | integration 2 (the attributes; `SET ROLE` taken) |
| M14 | `NOBYPASSRLS` | integration 6 (the attributes; the list refuses; the tick starts nothing and holds nothing; retention prunes nothing billed; the purge finds nobody) |
| M15 | `DATABASE_URL` uploaded carrying the system role's URL | 6 unit (`owner-name`, `credential`, and four anchors) |
| M16 | The beat's `UPDATE (beat_at)` not granted | integration 3 (the grants; both tick cases: the beat only warns, and stays old) |

M9 and M13 first ran on a refusal helper that shared the role's pool: a `SET ROLE` the broken role
was let through stayed on the pooled connection and turned the next case red for the wrong reason,
and a `CREATE ROLE` it was let through stayed on the cluster. Each refusal now runs on a
connection of its own, in a transaction rolled back, and `CREATE DATABASE`'s leftover is dropped;
both were run again (the table's figures), and the leftovers were removed. M1 is red in unit alone:
the integration guards hand no `DATABASE_URL`, so a fallback to it changes nothing they see.

**Where the build departs from §3:**

- **It deletes `DIRECT_DATABASE_URL` too**, on every run, which step 1 left to the owner by hand:
  the same four lines serve both names, and step 1's one-off is then done wherever this runs.
- **The script checks the list itself, and fails.** §3 says it "deletes the stored one as in step
  1"; step 1's check was the owner reading the list.
- **Column grants** where a job only picks rows (the purge's 29, `access_request`, `invoice`,
  `erasure_record`, `billing_party`, and the updates): §3 says tables. The role so reads nobody's
  mail ledger, audit trail, members, budgets or VAT log, only which organisation a row is.
- **The bring-up asks more than §3 names** (superuser and create role): create database,
  replication, membership, `BYPASSRLS` and `LOGIN` too, and proves the password where the tasks
  connect. It asks in `bootstrap-managed.sh`'s `tasks` phase, which the nightly gate,
  `deploy-live.sh` and `stand-up-live.sh` all run, so no separate step in the live scripts.
- **The smoke asks too**, after the run, and whether the tick still beats.
- **Not here:** `rotate-db-passwords.sh` rotates the owner and `app_user` and not this role (the
  bring-up sets `.env`'s value every run; changing it is `.env` then `--only tasks`); the list's
  role question still accepts a superuser as seeing every organisation, since the bring-up is
  where a superuser is refused; the three whole jobs still build their pool when imported, as
  before, where the split jobs build theirs in their run. Found in passing and not changed: the
  purge sends `BEGIN`, its statements and `COMMIT` through `drizzle(pool).execute`, each on
  whichever connection the pool hands out; they share one only because nothing else uses that pool
  meanwhile.

**For the owner, on each plane.** Nothing by hand if it goes as written. The nightly gate's next
run (or a hand-dispatched E2E (managed)) generates `SYSTEM_DB_PASSWORD` into the persisted `.env`,
starts the API, which creates the role, sets its password, uploads `SYSTEM_DATABASE_URL`, deletes
`DATABASE_URL` and `DIRECT_DATABASE_URL`, and deploys; live does the same on the first
`deploy-live.sh` of a tag that carries this, whose bring-up generates the password in live's own
`.env`. Two things to know: from the upload to the end of that deploy, the tasks deployed before it
find no `DATABASE_URL` and refuse at their start, the tick every minute among them (live's hold
covers it; on the OTA stack the status page may show the scheduler late for those minutes), which
is why this is to merge after the nightly has started; and if `set-task-env.sh` fails with *"the
task environment still holds"*, the store kept a row it could not delete, and
`docs/managed-bring-up.md`, *The owner's names in the task environment*, has the by-hand delete and
where to look. The deploy is one-way (a migration).

**Before this merges, `main` has to come in, with two lines.** While this was built, `main` gained
managed `0031_the_person_a_migration_is_for.sql` (#1332, 0153 T2), so this migration is `0033`,
applied after it (the runner orders by file name). #1332 also adds `person_migration` and `person`
to `PURGED_TABLES`, and the purge, now as `ownpace_system`, deletes from both: add them to `0033`'s
purge-only list (`SELECT (tenant_id), DELETE`, 29 tables becoming 31) and to the integration
guard's `EXPECTED`. Until then the guard's *DELETE on every table the purge empties* and its purge
case name both, and on a stack the purge of a closed organisation would stop at
`person_migration`, permission denied.

Gates, run last, on the tree as committed: `pnpm -s typecheck` green; eslint on the 27 changed
`.ts` files clean; `vitest run --project unit scripts apps/worker packages/managed`, 259 files,
4495 tests, all passed; on a throwaway Postgres rebuilt by `scripts/local-pg.sh` with both chains,
10 integration files (the new guard, T1's, T2's, the pause, cutover-without-mail, cutover
preparation, rollback, the CLI's cutover lifecycle, tenant pricing, usage metering), 116 tests, all
passed, the cluster removed after; the workplan index, `LESSONS.md` and `OPERATIVE.md` current.
Not run: Atlas's migration lint (no Docker here; CI's `migration-lint` runs it), and `bash -n` in
the last pass. Nothing was exercised against a running stack.

**2026-09-28, later still (placed first, the latest): review fixes for T2, same branch, not
merged.** Review found two major things and three minor ones; one of the minor ones and one of the
major ones are the same gap, seen twice. Each is fixed here, in one more commit:

- **A split job could still read every organisation on the owner's connection (major, and the
  minor that saw the same gap).** Rule 6 of `a-pass-that-opened-the-owners-pool` rested on a split
  job having no owner's connection because its file reads no URL and builds no pool. That held of
  the job's file, not of what `task-pools.ts`, which may build the owner's pools, hands it. Review
  added one export to the module, `acrossOrganisations(work)`, which asked the role question and
  then called `work(list)` on the owner's pool of one, and with it read every organisation's
  coverage in the drift detector's run, every organisation's name and settings in the digest's (a
  `listTenants:` after the spread, which overrides it), and other organisations' connections from
  `run-discovery`, a per-tenant job. In review's run: typecheck and eslint clean, the six guard
  files 204 of 204, the integration guard 7 of 7, and the whole unit run of `apps/worker` and
  `scripts`, 232 files and 4129 tests, green. The integration guard runs the halves, never a task's `run`, so it could not
  see a read added there. The guard gains **rule 7**, which closes the module at both ends:
  - `task-pools.ts` exports `openTaskPools`, `activeOrganisations` and `ACTIVE_ORGANISATIONS_SQL`,
    and types, and nothing else (`TASK_POOLS_EXPORTS`, closed, each with what it hands out); no
    `export … from`, no default.
  - It imports `TASK_POOLS_IMPORTS` and nothing else: `Pool`, the two sinks, `pgDriver`, `log` and
    the two setters. No query builder, no schema.
  - Each pool it builds on the owner's URL (any pool whose connection string is not read from
    `APP_DATABASE_URL`, followed through its `const`: today the key's and the list's) is a
    `const`'s value, and that name is named again only as `.query(ACTIVE_ORGANISATIONS_SQL)` or
    `.query(SEES_EVERY_ORGANISATION_SQL)`, `.end()`, `.on(…)`, or, the key's, `pgDriver(…)` inside
    `auditExportOn(…)`. Returned, handed to a call, stored, spread or connected to is refused. Every
    `.query(` in the module asks one of the two by name, and each is held to its literal (`THE_LIST`,
    `THE_ROLE_QUESTION`).
  - `activeOrganisations` is declared `Promise<string[]>` and returns `rows.map((row) => row.id)`.
  - A file takes from `task-pools.ts` only what its kind may: a `PER_TENANT` file and the
    standalone worker `openTaskPools`, a `SPLIT` file that and `activeOrganisations`, any other
    source file nothing; types are free and tests are not read. No `import * as`, no `import(…)`, no
    re-export. And a `PER_TENANT` or `SPLIT` file, or the standalone worker, imports no value from
    another file on `CROSS_TENANT`, by any of those shapes.
  It reads each file's own imports: an owner's pool handed on through a module none of them imports
  directly would be out of its sight. No file on `CROSS_TENANT` exports a pool (the sync tick's is
  its module's own). Found-at-least checks: the module's two owner's pools found by name, both
  statements asked, every file that opens the pools among those that name the module. 31 new cases,
  127 in the file; on this branch's code, before any other change, all 127 pass, since the module
  already had this shape.
- **A second list the module built with drizzle was invisible to the rule on its statements
  (minor).** That rule reads string literals; `drizzle(list).select({ id, name, settings })
  .from(tenant)` has none. The closed imports refuse `drizzle-orm`, `drizzle-orm/node-postgres` and
  `@openmig/ledger/schema-pg`, the closed exports the new function, and the owner's-pool rule the
  pool handed to `drizzle(…)`; every `.query(` now asks a named constant held to its literal.
- **The integration guard proved less of the digest than it said (major).** It seeded failures and
  decisions alone, so a read made in a scope that is not its organisation's own, which answers
  nothing, met an expected zero in every other queue. Review moved four of the digest's reads
  (deletions, moves, the relocations applied, the sharing checklist) into the scope of the
  mapping's id, which is no organisation: every guard green. In production every organisation's
  digest would have reported none of those, and nothing would have said so. The seed now fills
  every queue the digest counts, A's number never B's, with rows that must not count beside those
  that must: failures A 2 and B 1; deletions the source reported and nobody acknowledged A 3 and B
  1, beside one of A's acknowledged; moves A 1 and B 2, beside one of A's acknowledged; relocations
  applied since the organisation's own last digest A 2 and B 1, each last digest seeded between two
  of its relocations, so a window read in the wrong scope falls back to a day and counts one more;
  open sharing rows A 1 and B 3, beside one of A's decided; both migrations in their cutover with
  the grace period over and nobody choosing, A for email and calendar, B for email; pending
  decisions A 1 and B 2. Each organisation's mail is compared line for line, eight lines each. Its
  header and the rls-guide's paragraph and test list now say so, and that it runs the halves, not
  the `run` bodies, which rules 6 and 7 hold statically.
- **"Half an hour apart" (minor).** The jobs run at 06:30, 07:00 and 08:00 UTC; `task-pools.ts`'s
  header and the sizing note in `pgbouncer.ini` now say so.
- **Not taken:** review's optional rule that each `SPLIT` file send no statement literal but its own
  exported builders. With the module closed, a split job's only connection is the tenant pool, and
  rule 6 holds every use of it to a scope, where a statement reads its organisation's rows or
  none; a statement in the wrong organisation's scope is what the integration guard's seed is now
  there for. A literal rule would add a list of statements to keep in step without a failure it
  alone catches.

**Each regression, against HEAD's guards and against these** (applied to this branch, run, and
reverted with `git apply -R`; the tree compared after each; logs in the session's scratchpad). The
unit column is `a-pass-that-opened-the-owners-pool` with the five other unit guards of T2's entry;
the integration column is `a-job-that-reads-each-organisation-as-itself` on a throwaway Postgres 16
with both chains:

| # | Regression | HEAD's guards | These |
|---|---|---|---|
| G1 | `acrossOrganisations(work)` in the module; the drift detector's run reads every organisation's coverage on it | unit 204 of 204 green | 3 of 127 red: the exports, the owner's pool handed to `work`, the drift detector takes `acrossOrganisations` |
| G2 | `activeOrganisations` rebuilt on `acrossOrganisations`; the digest's run overrides `listTenants` with every organisation's name and settings | 204 of 204 | 4 of 127: those three, and `activeOrganisations` returns `acrossOrganisations(…)` |
| G3 | The same module; `run-discovery`, per-tenant, exports `hostSeenElsewhere`, other organisations' connections read on the owner's pool | 204 of 204 | 4 of 127: the same, and `run-discovery` takes `acrossOrganisations` |
| G4 | `activeOrganisationsWithSettings`: a second owner's pool, read with drizzle; the digest's run takes it | 204 of 204 | 4 of 127: the exports, the imports, the pool handed to `drizzle`, the digest takes it |
| G5 | The sync tick exports its pool; the drift detector's run loads it with `import(…)` and reads every organisation's coverage | 204 of 204 | 1 of 127: a value from another file on `CROSS_TENANT` |
| I1 | The digest's deletions, moves, relocations applied and sharing checklist read in the scope of the mapping's id (review's) | integration 7 of 7 green | 1 of 7: A's mail has 4 of its 8 lines |
| I2 | The digest's last send read in the scope of no organisation (the nil id) | 7 of 7 | 1 of 7: A's relocations 3, not 2 |
| I3 | The grace periods read in the scope of the mapping's id | 7 of 7 (`managed-digest-sql`'s pin of that line red, 1 of 8) | 1 of 7: A's grace line gone |

Gates: `pnpm -s typecheck` green; `eslint` on the three changed TypeScript files clean. Unit,
`apps/worker` and `scripts`, 232 files and 4160 tests passed, T2's 4129 and the 31 new cases.
Integration on a throwaway Postgres 16 with both chains (`scripts/local-pg.sh`, its own directory
and port), as its owner: every `apps/worker` integration file, 7 files and 64 tests, the two that
need Stalwart skipped; the two row-security guards alone, 2 files and 21 tests. The three indexes
regenerated with `--write` and current under `--check`; `adr-operative.mjs --check` current; the
commit convention checked. Nothing was exercised against a running stack.

**2026-09-28, later still (placed second, under its review fixes): T2 built: the digest, the drift
detector and group discovery read each organisation as itself,** on branch
`claude/ownpace-public-readiness-y7orc6-three-jobs-read-each-organisation-as-itself`, stacked on
T1 step 2's branch at b99d7607 (#1323), not merged. Built on the owner's answer to open question 3,
*"0138 open question 3: a - split them"*. The sync tick, retention and the purge are unchanged, on
the owner's connection until T3 step 2. What changed:

- **Where the line fell, per job, read from the code.** For all three it is the same one question:
  which organisations are active, as ids. `activeOrganisations` (`task-pools.ts`) asks it once per
  run, `SELECT id FROM tenant WHERE status = 'active' ORDER BY id`, on `DATABASE_URL`, on a pool of
  one it closes before it answers. Everything else is one organisation's, read and written in that
  organisation's scope on the tenant pool `openTaskPools` builds, `app_user`:
  - *The digest.* Its list carried each organisation's name and settings (`SELECT id, name,
    settings FROM tenant WHERE status = 'active'`). Those are the organisation's own row, so they
    are read in its scope, by id; an organisation on the list whose own row reads nothing there is
    refused with its id, never skipped (hard rule 9). Recipients and migrations run in `withTenant`;
    the queues, the auto-applied count, the sharing checklist, the last send, the send's own audit
    row and the pending decisions on `tenantScopedDb`, one ledger and one decision store per
    organisation; the grace periods in `withTenant`, as before.
  - *The drift detector.* Its list carried id and name, and the name was not used. Coverage and the
    Microsoft sources run in one `withTenant`; the decision and preset stores on `tenantScopedDb`,
    so no transaction stays open while Graph is asked.
  - *Group discovery.* Its list was every source connection of every active organisation, with its
    `config`, on the owner's pool. A connection's config is its organisation's own (the Graph
    tenant, for some kinds a stored account), so the list is now the organisations, and each one's
    sources are read in its scope (`ORDER BY id`). The iteration is still per source connection, and
    the summary is the same (`sources` summed over organisations).
- **The list refuses on a connection row security binds.** Decided and proven. On `app_user`, with
  no organisation set, `tenant` answers no row, so a list read there is empty, and each job would
  visit nobody and report zeros: a quiet morning, indistinguishable from nothing to do. So
  `activeOrganisations` first asks `SELECT rolsuper OR rolbypassrls … FROM pg_roles WHERE rolname =
  current_user` and refuses when the answer is no; T3 step 2's system role, `BYPASSRLS`, will pass
  it. It never reads `APP_DATABASE_URL`, and refuses without `DATABASE_URL`.
- **T1's module, not a second mechanism.** The three call `openTaskPools()`, as the per-tenant jobs
  do: the tenant pool on `APP_DATABASE_URL` with no fallback, the audit key's pool of one, and the
  sinks it points. The operator's log page's events go to the tenant pool (`app_user` may insert
  into `app_event`); the audit lines, the digest's `digest_sent_*` rows among them, read their key
  on the key's pool (`deployment_key` is closed to `app_user`). They open the pools in their run
  and end them in `afterwards(() => pools.end())`, as run-cutover and run-rollback do: a daily job
  holds no pool between runs, and a failure, the list's refusal included, is on the log page before
  the pool closes. Nothing at import: the three modules build nothing when loaded, so the two unit
  files that import them no longer set `DATABASE_URL`.
- **Each job's per-organisation half is exported**, the run keeping the list, the pools and the
  network: `digestLedgerOn`, `driftOfOrganisation` and `groupsOfOrganisation`, and their statements
  (`digestOrganisationSql`, `digestRecipientsSql`, `digestMappingsSql`, `coverageSql`,
  `microsoftSourcesSql`, `sourcesSql`). The statements are drizzle `sql` for one organisation, run
  in its scope, as T1 step 1 moved the bare helpers, and each still filters by the organisation
  itself. `microsoftSourcesSql` asks `kind IN (…)` over `microsoftSourceKinds()` where
  `MICROSOFT_SOURCES_SQL` asked `kind = ANY($2::text[])`; the digest's text constants became these
  builders, and `managed-digest-sql.unit.test.ts` reads them as the text and parameters they send.
- **Headers.** Each job's says why it crosses organisations and what it reads of each;
  `task-pools.ts`'s says what it builds for the split jobs.
- **Grants, asked of the catalog** (Postgres 16 with both chains, `scripts/local-pg.sh`): `app_user`
  may select, insert, update and delete on `tenant`, `tenant_member`, `mailbox_mapping`, `mailbox`,
  `connection`, `item`, `audit_log`, `share_grant`, `decision`, `policy_preset`, `group_def`,
  `path_lifecycle`, `scope_selection` and `cutover_state`, every one of them row-secured and
  `FORCE`d; may insert into `app_event` and read none; has nothing on `deployment_key`; and may read
  `pg_roles`. Every per-organisation statement of the three needs no more. **None was missing, so
  there is no migration.** The integration guard below writes through each.
- **PgBouncer: `app_user`'s 25 now also serve these three, and 25 holds.** Each job visits one
  organisation and one scope at a time and awaits each, so its tenant pool never opens a second
  connection: the integration guard asserts `totalCount` at most 1 after each job's half for two
  organisations. They run once a day, at 06:30, 07:00 and 08:00 UTC, for seconds, so they do not
  meet one another. At worst one lands on a full tick's burst, 24 by T1 step 2's measurement, as the
  25th, still inside the pool. The owner's side gains one connection per split run for the list, two
  statements, closed before the first organisation is read. Written beside `default_pool_size` in
  `pgbouncer.ini`. Not measured through a real PgBouncer.
- **Documents**: `docs/rls-guide.md` (update note, the opening, the table: the split jobs'
  per-organisation half in force, their list on the owner, the three whole jobs not in force; the
  guard paragraph; §2's `APP_DATABASE_URL` and `DATABASE_URL` bullets, which now say who holds the
  cross-tenant connection in the tasks; the `set-task-env.sh` row; the pitfall; the test list),
  `SECURITY.md`, `README.md`, the SAD v1.10 (§16, §17.1), `docs/operator-runbook.md` (the two
  roles, the digest, the troubleshooting line), `docs/managed-bring-up.md` (phase 9),
  `managed.env.example`, `.env.example`, `pgbouncer.ini`, the worker README, the headers of
  `deploy-tasks.sh` and `set-task-env.sh`, T3's guard's reason and header, and
  `a-pass-under-row-security`'s header. Every sentence that said *the six scheduled jobs* connect
  as the owner.

**The guards, and how they failed first.** Each written before the build and run against this
branch's base, b99d7607:

- `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts`: the three leave `CROSS_TENANT` for a
  third kind, `SPLIT`, closed, each entry saying why the job crosses organisations and what it
  reads per organisation. A `SPLIT` file reads no database URL and builds no pool (which did not
  keep the owner's connection out of it: review, above, reached it through the module, and rule 7
  closes that); takes its pools from `openTaskPools`, points
  no sink, takes the tenant pool and its end only and ends nothing outside `afterwards`; calls
  `activeOrganisations`; and names its tenant pool, under any name and as any parameter typed
  `Pool`, only as the first argument of `withTenant` or `tenantScopedDb`, or hands it to a
  function of its own file that takes a `Pool`. No file but the three and the module names
  `activeOrganisations`, and the module's statements are the list (ids from `tenant`) and the role
  question, nothing else. Found-at-least checks: the three files and their task registrations, at
  least two scopes opened on each one's tenant pool, the list and the role question in the module,
  and eleven shapes of a tenant pool used outside a scope, each seen. **23 of 99 failed**: seven
  per job (on `CROSS_TENANT` while reading `DATABASE_URL`; builds a pool; no `openTaskPools` and
  both sinks pointed itself; takes nothing from it; reads a URL and builds a pool; no
  `activeOrganisations`; opens no scope on a tenant pool) and two for the module (no
  `activeOrganisations`, no list). The shape cases passed.
- `apps/worker/src/jobs/a-run-that-kept-a-testers-words.unit.test.ts`: a task that opens its pools
  in its run is now one of five, the three beside run-cutover and run-rollback, and opens them
  before anything it throws or awaits. **1 of 60 failed**.
- `apps/worker/src/jobs/a-task-pool-that-fell-back-to-the-owner.unit.test.ts`, three cases on the
  list, without a database: refuses without `DATABASE_URL` and never reads `APP_DATABASE_URL`;
  asks one connection on the owner's URL, the role question first, and ends it; refuses on a
  connection row security binds. **3 of 11 failed** (*"activeOrganisations is not a function"*).
- `apps/worker/src/jobs/a-job-that-reads-each-organisation-as-itself.integration.test.ts`, new, 7
  cases, on a throwaway Postgres, handed its database: A and B active, C closed; each with its
  owners and a viewer, a named migration, failed items past their retries, pending decisions, and
  A with a dismissed mailbox and a standing answer. The list names A and B and not C, and refuses
  on `app_user`, where the bare statement answers no row. The digest, on the pools the job opens,
  sends A's owner A's migration by name, A's two failures and A's one decision, and B's owner B's,
  with no queue unread; records each send in its own organisation and prints both audit lines. The
  drift detector closes A's new mailbox by A's standing answer, does not ask again about the one A
  dismissed, and raises B's in B, each handed its own organisation's source. Group discovery
  records A's two groups, asks A's one question, states A's IMAP blind spot, records B's in B, and
  converges on a second run. Each of the three runs as `app_user`, asks no pool but the tenant pool
  and the audit key's for a connection (the key's found first, as the sink finds it), and holds one
  connection at a time. And each of the six per-organisation statements answers in its
  organisation's scope, answers nothing for A in B's scope, and finds nothing outside a scope.
  **Against the base it failed at import, no case run**: `managed-digest.ts` threw *"DATABASE_URL
  environment variable is required"*, its owner's pool built when the module loaded. **Against a
  stand-in with the per-organisation half on the owner's pool** (the tenant pool's URL set to the
  owner's), **4 of 7 failed**, each *"expected { Object (role, superuser) } to deeply equal { role:
  'app_user', superuser: 'off' }"*, after every content assertion before it had passed: the queries
  carry their filters, and what the split adds is the net. On this branch all 7 pass.

**Mutations, each red in at least one guard** (the four unit files above, `every-audit-field-is-classified`,
`managed-digest-sql` and `a-detector-that-knows-the-microsoft-account`, and the integration guard;
restored from a copy after each, and the files compared with it):

| # | Mutation | Red |
|---|---|---|
| M1 | A per-organisation read on the owner's pool: the drift detector's coverage on `new Pool({ connectionString: process.env.DATABASE_URL, max: 1, idleTimeoutMillis: 1_000 })`, the key's own options, with its own filter | 4 unit; integration 1 (*ECONNREFUSED*: the guard hands no `DATABASE_URL`); with the owner's URL in the environment, as a run has it, integration 1: *"a pool other than the tenant pool and the audit key's was asked"* |
| M2 | A per-organisation read outside `withTenant`: the digest's recipients as `pool.query(…)` on the tenant pool | 1 unit; integration 1, both organisations *"due … but has no active owner or admin"*, nothing sent |
| M3 | The list on `app_user`: `activeOrganisations` reads `APP_DATABASE_URL` | 2 unit; integration 2, the list refuses (*"asked on a connection that row security binds"*) |
| M3b | The same, with the role question gone | 3 unit; integration 3: the list is `[]`, and the digest reports `tenants: 0, sent: 0` |
| M4 | A fallback: `openTaskPools` takes `APP_DATABASE_URL ?? DATABASE_URL` | 1 unit; integration green (both set) |
| M4b | A fallback the other way: the list takes `DATABASE_URL ?? APP_DATABASE_URL` | 1 unit; integration green (both set) |
| M5 | The pool ended before the failure's event: group discovery ends its pools in its run's own `finally` | 2 unit |
| M6 | A fourth job put on `SPLIT` without a reason: `managed-retention` moved there with `''` | 9 unit |
| M7 | The list reads more than ids: `SELECT id, name, settings FROM tenant …` | 1 unit; integration green (it still hands back ids) |
| M7b | The cross-tenant half reading a per-organisation table: group discovery's old list (`connection` joined to `tenant`, with `config`) added to the module | 1 unit |
| M8 | Every organisation's digest stores scoped to the first organisation asked | unit green (every read is in a scope); integration 1. On `ed8aa77a`'s seed B's digest read nothing of B's and stayed quiet, `sent: 1`; on the review's fuller seed B's mail still goes out and the send's audit row is refused in A's scope (*"recording the send time failed"*), so `{ warnings, errors }` is not empty |
| M9 | The digest's organisation row read outside its scope | 1 unit; integration 1, *"is on the list of active organisations, and its own row reads nothing in its own scope"* |
| M10 | Group discovery's sources read outside the scope | 1 unit; integration 2, `sources: 0` for both organisations |
| M11 | The drift detector opens its pools at its module's top again | 1 unit, and `a-detector-that-knows-the-microsoft-account` fails at import (7 skipped); integration fails at import |

M4 and M4b are red in the module's unit test alone, as T1 step 2's own fallback mutation was: the
integration guard hands both URLs, so a fallback changes nothing it can see. M8 is the reverse:
every statement is in a scope, the wrong one, which no static rule can tell and the integration
guard does, for the queues its seed fills: review, above, found four it left empty.

**Where the build departs from §3:**

- **Group discovery's list is the organisations, not the source connections.** §3 had *"for group
  discovery, the list of source connections across them"*. That list carried each connection's
  config, which is the organisation's own, so it moved into the scope; the list is the same for all
  three jobs.
- **The digest's list lost the names and settings.** §3 did not say; the settings decide whether
  and in which language an organisation is written to, and are its own row.
- **The jobs read no owner's URL at all.** §3 T4 has T2's jobs on its list *"for their list of
  organisations"*. The list is `task-pools.ts`'s, which T4 already names for the audit key, so a
  split job file names no database URL and builds no owner's pool: stricter than a job that may
  read the URL for its list only, and checkable by the rules T1 already enforces, with the
  module's own surface closed by rule 7 since review (above).
- **The pools are opened per run**, as run-cutover's and run-rollback's are, not at the module's
  top, where the three built their one owner pool.
- **The list refuses on a connection that cannot see every organisation.** §3 did not ask; it is
  the one way the split could fail quietly.
- **Not here:** T5 step 2's guide check that the guide names every entry of T4's lists, and the
  move of those lists to a plain module both guards import (§3 T4).

Gates: `pnpm -s typecheck` green; `eslint` on the 12 changed TypeScript files clean. Unit, `apps/worker`
and `scripts`, 232 files and 4129 tests passed (`packages/ledger` and `packages/orchestration` are
untouched). Integration on a throwaway Postgres 16 with both chains (`scripts/local-pg.sh`, its own
directory and port), as its owner, each guard deriving `app_user` from it: the two row-security
guards, 2 files and 21 tests; every `apps/worker` integration file, 7 files and 64 tests, the two
that need Stalwart skipped. The three indexes regenerated with `--write` and current under
`--check`; `adr-operative.mjs --check` current; the commit convention checked.

Still open: T3 step 2 (PR E), which moves the three whole jobs, the list and the audit key to the
system role, with the owner's one-off deletion (2026-09-27); T5 step 2 (PR F); the wall-time
comparison (T1 step 2's entry). Nothing was exercised against a running stack; the nightly deploys
`main`'s tasks to the OTA plane, where this runs once merged.

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

**2026-09-28: T6 built, the permission report reads as `app_user`,** on branch
`claude/ownpace-public-readiness-y7orc6-a-permission-report-under-row-security`, not merged. The
owner answered T0 today, *"0138 T0: build the fix first."* (recorded in #1295, above). The
report's pool was not in the task table (T5 step 1's note, above); it is T6 now, and it goes first
because it is small, depends on nothing, and is the last owner pool on the API's request path.

- **The change.** `apps/api/src/routes/permissions.ts` no longer opens a pool of its own on
  `DATABASE_URL`. Its three helpers read on `getDbPool()`, the request path's `app_user` pool,
  inside `withTenant` for the caller's organisation: `resolveMappingMailbox` and
  `tenantTargetConduct` in one transaction each, `tenantInventoryScans` its three lookups in one.
  The SQL is the same, with its own `tenant_id` filters kept, now sent through `db.execute`. The
  scans and the target's measurement still run after the rows are read, outside any transaction.
  It calls the ledger's `withTenant`, which `withTenantDb` in `auth.ts` wraps, so that the two door
  tests that stub `withTenantDb` with one stored row (`a-limit-on-tests`,
  `a-probe-that-does-not-read-aloud`) still answer the report's reads from their own fake.
- **Its answers for the caller's own rows are unchanged.** The integration test's two cases about
  A's own rows pass on `main`'s code as well, with `DATABASE_URL` set to the owner as `managed.yml`
  gives it to the API. The four unit files that run the helpers pass once their fakes answer on a
  client, as `withTenant` uses one: 33 cases, one of them new, which checks that every lookup runs
  with `app.current_tenant` set to the organisation it was asked for.
- **Guard: `apps/api/src/routes/a-report-under-row-security.integration.test.ts`.** The real app,
  as `app_user`, two organisations. A has a Google source, a migration of its own mailbox, and a
  migration whose source mailbox is B's, seeded as the owner because no API door writes one. B has
  a Microsoft account and a CalDAV target. Asked as A: its own migration resolves to its address;
  the one naming B's mailbox answers 409 in the report and in the sharing rescan, and neither
  answer carries B's address; every section is written for A's Google source, with no Microsoft or
  Exchange sentence and no section for B's target. **Failed first:** on `main`'s
  `permissions.ts`, with `DATABASE_URL` set to the owner, 2 of its 4 cases fail: the report's
  heading carried B's address, and the rescan answered 200 and ran the scans. With no
  `DATABASE_URL`, all 4 fail (`connect ECONNREFUSED`). Mutations of the fix: the scope set to
  another organisation fails 2 of 4 (A's rows read as nothing) and the new unit case; the reads run
  on the bare pool with no transaction fail 2 of 4 the same way; the mapping lookup's own
  `mm.tenant_id` filter deleted passes all 4, because row security is now the net under it.
- **Guard: `scripts/a-route-that-opened-the-owners-pool.unit.test.ts`,** a guard of its own and
  not T4's scan widened to `apps/api`. T4's lists are about tasks (the jobs that span
  organisations, and the ratchet T1 empties), and a route has no reason to read the owner's URL,
  so for routes there is no list, only zero. T4's file is also what T1 and T5 step 2 change next.
  The new guard parses every non-test `.ts` in `apps/api/src`: a file that reads a database URL
  other than `APP_DATABASE_URL` (T4's four forms, its pattern checked against T4's file), builds a
  pool or client itself, or names `migrationConnectionString` or `poolerInFront`, must be on a
  closed list of four that are not the request path (`index.ts`, `middleware/auth.ts`,
  `scripts/operator.ts`, `scripts/seed-managed.ts`), and no route may be on it. It also reads the
  api service's environment in `managed.yml` and requires the names composed from
  `${POSTGRES_USER` to be exactly `DATABASE_URL` and `DIRECT_DATABASE_URL`, both counted, and
  `APP_DATABASE_URL` to be `app_user`'s. **Failed first:** on `main`'s `permissions.ts`, 1 of 8
  cases fails (*"builds a pool (new Pool), reads DATABASE_URL"*). 6 mutations, each red: a new
  file in `services/` opening `DIRECT_DATABASE_URL`; `const { DATABASE_URL: … } = process.env` in
  a route; `drizzle(process.env.APP_DATABASE_URL!)` in a route; `main`'s `permissions.ts` put on
  the list; an owner URL added to the api service under another name; a route calling
  `migrationConnectionString`.
- **The documents.** `docs/rls-guide.md`: the report's row joins the request path's (in force),
  §2's two bullets lose the exception, the T4 paragraph names the new guard, and the pitfall says
  the report's pool was the owner's until today. Also corrected, because they named the two routes:
  the runbook's *The two database roles*, `SECURITY.md`, `README.md`, the architecture document's
  §17.1 isolation row, the api service's comment in `managed.yml`, `managed.env.example` and
  `.env.example`.

Run here: the unit files with `npx vitest run --project unit`, and the integration test against
`scripts/local-pg.sh` (Postgres 16, both chains) with a config that has no Testcontainers setup;
`pnpm test:integration` did not run (no container runtime in this session). Nothing was run
against a stack. Still open: T1 and T2; T3 step 2, and the owner's one-off deletion; T5 step 2,
after T1 to T3.

**2026-09-28, later: review fixes, same branch, not merged.** Review ran mutations on scratch
copies and found the report's tests and T6's guard narrower than the entry above says. Each fix
was run here against the first version and against the fix:

- **Nothing held the target lookup to the caller's organisation.** A had no DAV target, so
  `tenantTargetConduct` asked in another organisation read nothing, the report left out *What the
  target will do with what we write* without a word, and every case passed: the integration test
  4 of 4, the four unit files 33 of 33 (the two door tests' fakes answered with the stored target
  whatever the tenant). A now has a CalDAV target at `localhost` port 1, where nothing listens:
  its measurement fails at once, a failed measurement is still written as the section, and the
  last case requires the section. The fakes in `a-limit-on-tests` and
  `a-probe-that-does-not-read-aloud` record `app.current_tenant` from `withTenant`'s `set_config`
  and answer the target in its own organisation only, as row security would, and each asserts
  the scope; `a-share-scan-that-never-ran` does the same for the mapping lookup. The target
  lookup asked in another organisation now fails 1 of 4 integration cases and 4 of 34 unit cases;
  the mapping lookup asked in another organisation fails the new unit case and the case about A's
  own migration.
- **The mapping lookup was right only under row security.** It joined `mailbox` on
  `source_mailbox_id` alone, and the entry above found that deleting its `tenant_id` filter left
  all 4 green. The join now also asks `mb.tenant_id = mm.tenant_id`. On the owner's connection,
  which `getDbPool()` falls back to without `APP_DATABASE_URL`, the test passes 4 of 4 with it and
  fails the two cases about B's mailbox (the report and the rescan) without it. As `app_user` it
  passes either way, so no test in the repository holds the condition: one would have to set
  `DATABASE_URL` from a test, which `an-integration-test-is-handed-its-database` forbids.
- **T6's guard exempted whole files, and two hold request-path code.** `middleware/auth.ts` is
  `authenticate` as well as `getDbPool()`, and `index.ts` defines `/metrics`, `/health` and
  `/api/auth/mode`. Both already built a pool and read `DATABASE_URL`, and the guard kept a set of
  what a file reaches, so a second owner pool in either changed nothing. The entry above calls all
  four "not the request path". Both files are now pinned to exactly what they reach, one line per
  occurrence, each with the function it sits in. The two scripts stay exempt whole, and a case
  checks that nothing outside `apps/api/src/scripts` imports them.
- **The guard's header said a helper that opens the owner's pool is caught at the helper.** True
  inside `apps/api/src`, not for a package function that falls back to `DATABASE_URL` when it is
  handed no connection. `OWNER_URL_HELPERS` now names the eleven found today, each with the file a
  case checks still defines it: `buildDeps` and `buildDomainDeps` (through `openLedger`, which is
  not exported), `runAllDomains`, `discoverAllDomains`, `verifyMapping`, `applianceOpener`,
  `applyMappingDeletion`, `applyMappingRelocation`, `buildDepsFromMapping`,
  `buildDomainDepsFromMapping` and `createLedgerVerificationReader`. None is called in
  `apps/api/src`. T1 part 2 takes each off the list as it removes the fallback (§3 T6). The
  header's *What it does not see* now names the connection `index.ts` hands on instead of opening
  it where it is used: the audit key's pool of one. 4 mutations, each passing all 7 cases of the
  first version and failing 1 case of the fix: a second owner pool in `auth.ts`; a handler in
  `index.ts` on an owner pool; a route calling `verifyMapping(config)`; a route re-exporting from
  `scripts/operator.ts`. `main`'s `permissions.ts` still fails it, 1 of 12.
- **The documents said no request reaches the owner.** The guide's note said the request path
  "has no owner pool left", and `managed.yml` said of `DATABASE_URL` "No route reads it". The
  operator's audit download (`routes/support.ts`, through `audit-key.ts`) and the line printed
  after an audit event commits both read the pseudonym key through `index.ts`'s pool of one on
  the owner's URL. It holds no organisation's rows. The note, §2's row for that pool, the guide's
  paragraph on T6's guard, the comment in `managed.yml` and the runbook's *The two database roles*
  now say so.
- **The branch was behind `main`,** where #1295 had recorded T0 in this block, its rows and open
  question 1. It is now on `origin/main` (73d94eb7), the changes carried over uncommitted, with
  #1295's entry kept above and the T6 entry no longer saying #1295 is not merged. The index and
  `docs/LESSONS.md` were regenerated.

Run here: the four unit files and T6's guard with `npx vitest run --project unit`, the
integration test against `scripts/local-pg.sh`, and each mutation above on the working tree,
restored after. `pnpm test:integration` did not run (no container runtime in this session).
Nothing was run against a stack.

**2026-09-28, later still: `main` merged into this branch, #1302 (T1 step 1) with it,** by a merge
commit; this branch is still not merged. #1302 merged 2026-09-28 (c33b441c). Both had rewritten
the same lines of `docs/rls-guide.md` and of this block, and the result keeps both, each sentence
checked against the merged code:

- **This block and the task table.** T1 step 1's entries come first, as they reached `main`
  first, then T6's. T1's row says step 1 is done in #1302; T6's row is as built here.
- **The guide.** Its note at the top keeps T1 step 1's sentence, then T6's. Its table keeps T6's
  row for the request path and its fuller row for the audit key's pool, and T1 step 1's task row.
  The paragraph under the table keeps T1 step 1's account and ends with T6's guard in place of the
  sentence that said the report's pool was not in the task table. Two cross-references that
  pointed at the wrong section (*"§1's task row"*, *"§2's row for it"*) now name *Where row
  security holds today*.
- **T6's guard's list of package functions.** `OWNER_URL_HELPERS` named eleven that fell back to
  `DATABASE_URL` (the review fixes, above). T1 step 1 removed the fallback of ten of them:
  `buildDeps` and `buildDomainDeps` (through `openLedger`), `runAllDomains`,
  `discoverAllDomains`, `verifyMapping`, `applianceOpener`, `applyMappingDeletion`,
  `applyMappingRelocation`, `buildDepsFromMapping` and `buildDomainDepsFromMapping`. Each is handed
  its ledger or its pool now, so each left the list at this merge, as §3 T6 asks.
  `createLedgerVerificationReader` stays: handed a connection string, it still opens a pool of its
  own. The guard's case for a package function names it instead of `verifyMapping` and
  `buildDeps`, and a route handing `buildDepsFromMapping` what `getDbPool()` gave it is a shape the
  guard must not count. `docs/LESSONS.md` was regenerated, which drops the three orchestration
  files from what the guard reads.

Run here: T6's guard, 11 of 11; T4's, 59 of 59; `a-connection-the-docs-did-not-know-about`, 6 of
6; with the other `scripts` tests that read the guide, this plan or the index, 10 files and 381
tests in all, every one passing; the report's four unit files, 34 of 34; `pnpm -s typecheck` green. The
integration tests were not run again.

Still open: T1 step 2 and T2; T3 step 2, and the owner's one-off deletion (2026-09-27); T5 step 2,
after T1 to T3; the pre-step-1 baseline, which T1 step 1's review fixes left to be taken before
#1302 merged and this block does not record as taken.

**2026-09-28, later still: T1 step 2 built: the per-tenant tasks connect as the application role**
(parts 1 and 5), on branch
`claude/ownpace-public-readiness-y7orc6-the-tasks-connect-as-the-application-role`, on `main` at
83eb73ed (#1302 merged by the owner), not merged. What changed:

- **`openTaskPools`** (`apps/worker/src/jobs/task-pools.ts`, part 1): the one place a per-tenant
  task's pools are built, with nothing done at import. It builds two. The tenant pool is on
  `APP_DATABASE_URL`, `app_user`; it refuses to start when that is unset or blank and never takes
  `DATABASE_URL` in its place. The audit key's pool is ONE connection on `DATABASE_URL`, closed a
  second after its last use, with an error handler, for `deployment_key` alone (part 5, the API's
  `auditKeyPool` in a task). A missing `DATABASE_URL` refuses too, since every audit line would
  be lost. It points the process's sinks: the operator's log page at the tenant pool (`app_user`
  may insert an `app_event`), the audit export at the key's pool. `end()` ends the tenant pool
  only; the key's pool closes its own connection, so a line whose key read is under way as a run
  finishes is not cut off.
- **The eight jobs** take their pool from it: six at their top, as before, and `run-cutover` and
  `run-rollback` per run, ending the tenant pool in their `finally` as before. None reads
  `DATABASE_URL` or points a sink itself. `run-confirmation`'s rate budget was already on the
  job's pool (step 1), so it is on `app_user` now.
- **The standalone worker** (`apps/worker/src/index.ts`) takes its pools the same way: its ledger,
  cursors and status store on `tenantScopedDb(pools.tenant, config.tenantId)`, and its phase read
  inside `withTenant`. It needs `APP_DATABASE_URL` now (help text and worker README say so), and
  left `CROSS_TENANT`.
- **T4's ratchet is gone.** `KNOWN_REMOVED_BY_T1`, `_AS_LANDED`, `_AT_MOST` and the case that
  pinned them are deleted; `task-pools.ts` is on `CROSS_TENANT` with its reason, the owner's URL for
  the key alone. T3's `OWNER_URL_UNTIL_T3_STEP_2` stays until E, its reason rewritten.
- **Everything a pass touches, asked of `app_user`.** Every read and write a per-tenant pass makes
  was listed (the eight jobs, `cutover-gate.ts`, `stopping-a-pass.ts`, the builders,
  `build-reindexers.ts`, `build-confirmation-readers.ts`, `run-confirmation-pass.ts`,
  `enabled-domains.ts`, the cutover store, the mapping port, the month's peak). All run inside
  `withTenant` or `tenantScopedDb`, bar the budgets (`plainDb`) and the app-event sink. No
  `packages/core`, `packages/connectors` or `packages/engines` file opens the database. The grants,
  asked of the catalog with both chains applied: `app_user` may select, insert, update and delete
  on `rate_budget` and `byte_budget`, neither has row security, may only insert on `app_event`,
  has nothing on `deployment_key`, and has what each pass statement needs on the row-secured
  tables it touches (`occupancy_peak` and `bytes_moved` without delete, which no pass does). None
  was missing (§3 T1, *"What it will find"*). The guard below writes through each of them.
- **Comments and tests.** `stopping-a-pass.ts`, `db.ts` (`tenantScopedDb`),
  `build-deps-from-mapping.ts` (three), `run-discovery.ts` (two), `run-delta-sync.ts` (one) and
  `job-resolution.ts` said the tasks run as the owner, and say what holds now. Ten unit tests that
  import a job, or the tick, which imports `run-delta-sync`, set `APP_DATABASE_URL` beside
  `DATABASE_URL` first. `a-run-that-kept-a-testers-words` accepts `openTaskPools()` as a job's log
  page wiring and checks the module's; `every-audit-field-is-classified` accepts it as a job's
  audit wiring and checks, as it does the API's, that the key is read on its own pool of one on the
  owner's URL and not on the tenant pool.

**The guards, and how they failed first.** Written before the build, each run against the code on
`main` at 83eb73ed:

- `scripts/a-pass-that-opened-the-owners-pool.unit.test.ts`, with the ratchet deleted and three new
  rules: a task file is on `PER_TENANT` or `CROSS_TENANT`; a `PER_TENANT` file and the standalone
  worker call `openTaskPools` and point no sink; `task-pools.ts` has no top-level statement that
  runs anything. **28 of 76 cases failed**: the eight jobs and the standalone worker read
  `DATABASE_URL` and are on no list, the eight build a pool, the nine do not call `openTaskPools`,
  and `task-pools.ts` does not exist.
- `apps/worker/src/jobs/a-task-pool-that-fell-back-to-the-owner.unit.test.ts` (new, 7 cases): the
  refusals, the two pools, which pool each sink asks for a connection (without a database, by
  which pool's `connect` is called), and an import with no `APP_DATABASE_URL`. **Failed at
  import**: no module.
- `scripts/every-audit-field-is-classified.unit.test.ts`: **1 of 23 failed**, the new case that
  reads the key's wiring in `task-pools.ts`.
- `apps/worker/src/jobs/a-pass-under-row-security.integration.test.ts` gains its third
  assertion, six cases on the pools `openTaskPools` opens: it connects as `app_user` and a pass's
  handle counts its organisation's three connections and one tenant, and the step before a data
  type finds the migration; an audit event prints its line, twice, once through the rollback's own
  mapping port (status, paths, the month's peak and the audit row in one scope) and once through
  the pass's ledger; the log page takes an event; the budgets spend; the run, its event, the
  status and the first-copy bytes land; a confirmation pages its three items. Against a stand-in
  module wired the way the jobs were on `main` (one pool on `DATABASE_URL`, both sinks on it) **1
  of 12 failed**: *"expected 5 to be 3"*, the owner's pool counting every organisation's
  connections. Against the switch done naively (one pool on `APP_DATABASE_URL`, both sinks on it)
  **1 of 12 failed**: *"[audit-export] a line was not written (permission denied for table
  deployment_key)"*. On this branch all 12 pass.

**Mutations, each red** (the guards above, and the log-page guard, run after each; restored from a
copy after each):

| # | Mutation | Red |
|---|---|---|
| 1 | `run-verification` back on `new Pool({ connectionString: process.env.DATABASE_URL })` | 5 unit cases in 3 files |
| 2 | `openTaskPools` falls back: `APP_DATABASE_URL ?? DATABASE_URL` | 1 unit (the refusal); integration green, both set |
| 3 | The key's pool removed: the audit sink on the tenant pool | 2 unit; integration, the line not written |
| 4 | The key's pool on `APP_DATABASE_URL` | 2 unit; integration, the line not written |
| 5 | One scope removed: the mail builder's cursors on `plainDb` | integration, *invalid input syntax for type uuid: ""* |
| 6 | A per-tenant job put back on an exemption list (`run-delta-sync` on `CROSS_TENANT`) | 2 unit |
| 6b | The same, with the job reading `DATABASE_URL` again | 2 unit |
| 7 | `task-pools.ts` builds a `new Pool()` at import | 1 unit |
| 7b | `task-pools.ts` calls `openTaskPools()` at import | 1 unit, and the module's own test file fails to import |
| 8 | The standalone worker on the owner (`createPgDb(process.env.DATABASE_URL)`) | 3 unit |
| 9 | `run-rollback` points the audit sink at its tenant pool after `openTaskPools` | 1 unit |
| 10 | The key's pool without its error handler | 1 unit |
| 11 | A ninth task file on neither list | 1 unit |
| 12 | The log page's events on the key's pool | 2 unit; integration green (the owner may insert too) |

**PgBouncer: decided to keep `default_pool_size = 25`, and documented it** (`pgbouncer.ini`,
beside the setting; `docs/operator-runbook.md`, the two roles). Since this step the API's request
path and every per-tenant task share `app_user`'s server connections; before it, the tasks used the
owner's. The evidence:

- In transaction mode a client holds a server connection for one transaction. Every tenant scope
  is one transaction: a store's statement (`BEGIN`, the tenant, the statement, `COMMIT`; 1.33 ms on
  a local Postgres, the review fixes' entry above) or a short `withTenant` block. No scope in the
  pass path awaits a source or a target inside it; the confirmation pages and batches for that
  reason (`run-confirmation-pass.ts`).
- A pass holds at most one open transaction per item worker (`DEFAULT_CONCURRENCY`, 4), and the tick
  starts at most `MAX_PASSES_IN_FLIGHT` passes (3 on the OTA stack, 6 on live, 0143 T1). Measured on
  a local Postgres 16 as `app_user`, each pass on a pool of its own as the jobs build them, running
  `PgLedger.find` and `recordIfAbsent` on `tenantScopedDb` in a loop and counting the backends with
  an open transaction (`pg_stat_activity`, `xact_start` set) for 8 seconds:

  | Passes × workers | Network time per item | Open transactions: mean | p99 | max |
  |---|---|---|---|---|
  | 6 × 4 | none (the busiest case) | 18.3 | 24 | 24 |
  | 6 × 4 | 20 ms | 8.5 | 24 | 24 |
  | 6 × 4 | 200 ms | 0.8 | 10 | 20 |
  | 3 × 4 | none | 9.3 | 12 | 12 |

  The ceiling is passes × workers, 24 on live, under the 25 before the API asks for any. Past 25 a
  query waits for the next `COMMIT` (milliseconds), then the reserve's 5 after 3 s; the
  `query_wait_timeout` of 120 s is not in reach. Hand-started runs (a verification, a
  confirmation, a cutover's final sync) are outside the tick's cap and add to a burst the same way.
- The server-side total does not grow: the per-tenant load moved from the owner's pair to
  `app_user`'s, and the owner's pair now serves the six scheduled jobs and the audit key's one
  connection per task.

Not measured: the same through a real PgBouncer (none on this machine) and on the OTA stack. The
revisit trigger is written beside the setting: `MAX_PASSES_IN_FLIGHT` times the pass concurrency
past about 24, or `SHOW POOLS` showing `app_user`'s `cl_waiting` above 0 for more than a moment.

**Wall time: what the owner compares.** This session cannot reach the OTA stack. §3 asks for one
pass's wall time before and after; the baseline is from before step 1 (the review fixes' entry
above). Three E2E (managed) runs are to compare, each on `main`, all three green:

1. **Before**: #209, scheduled, 2026-09-28 10:02 UTC, on `a0897c0b`, before #1302.
2. **Step 1 alone**: #211, dispatched on `main` at `4991094a`, 2026-09-28 14:55 UTC, which
   contains #1302 and not this step. It separates the transaction per statement (step 1) from the
   switch. It exists already: had this step waited for the next scheduled run, one that merged
   before it would have left none. A later scheduled run between the two merges is a second sample,
   if there is one.
3. **After**: the first run whose `main` contains this step, scheduled or dispatched.

Where each shows: the job log of E2E (managed), in the smoke's output
(`./deploy/compose/smoke-managed.sh`, tee'd to the log and to the artifact
`managed-e2e-evidence-<run id>`, file `smoke-managed-<run id>.log`, kept 7 days, so the first
one's artifact lapses on 2026-10-05; the job log is kept longer). Two lines, one per pass the smoke
asks for: `sync (mail): the pass finished after Ns — itemsProcessed=…` and `sync (dav): …`. N is
counted in 2 s polls from the enqueue to the terminal `run` row, so it includes the wait for a
runner. The pass alone is in the OTA stack's own `run` rows, if retention has not pruned them,
and it is picked out BY ITS RUN ID, never by the date: every E2E (managed) run, a branch's
dispatch as well, deploys its own checkout's tasks to the same OTA plane (`e2e-managed.yml`,
"Bring the stack up": `bootstrap-managed.sh --from data --with-demo`, whose `tasks` phase runs
`deploy-tasks.sh`), and runs #205 to #211 deployed seven different builds on 2026-09-28 alone; the seed
leaves both demo mappings active too, so the tick runs them every quarter hour on whatever build
is deployed then. The line just above each `finished after` line, `sync (mail): {…"runId":"…"…}`,
prints the enqueue's answer, and `run-delta-sync` stores that id on its row as
`orchestrator_ref` (the smoke follows the pass by the same column):
`SELECT finished_at - started_at, stats->'domainSeconds' FROM run WHERE orchestrator_ref = '<the
runId from that E2E run's log>'`. What to expect of the switch itself: no extra round trip. The tenant
pool connects as `app_user`, so there is no `SET LOCAL ROLE`, as §3 once expected; what is added
is Postgres evaluating each policy's predicate. Measured locally as the review fixes' entry
measured step 1 (`PgLedger.find` on `tenantScopedDb`, 1,500 calls per figure, the owner's pool and
`app_user`'s alternating, eight pairs over two runs on a loaded machine): the owner 1.11 to 2.43
ms, `app_user` 1.22 to 2.04 ms. In six pairs `app_user` was slower by 0.11 to 0.71 ms, in the two
that opened each run the owner was slower by 0.56 and 0.85 ms; the median difference is about 0.3
ms. So the shape, not the size on the stack. A difference between 2 and 3 larger than the
nightly's own spread between two runs of the same code is the thing to look at.

**Where the build departs from §3:**

- **The key's pool reads `DATABASE_URL`, not `DIRECT_DATABASE_URL`.** The API's reads the direct
  URL; a run has no direct URL since T3 step 1. Two statements, each its own transaction, so the
  pooler's transaction mode is no obstacle.
- **The module refuses without `DATABASE_URL` as well**, for the key. T3 step 2 (E) renames what
  it reads with the upload.
- **The standalone worker moved too**, and left `CROSS_TENANT`. §3 T4 had it there as the dev
  entrypoint.
- **Two more guards changed than §3 names**, because they read the jobs' wiring as text:
  `every-audit-field-is-classified` and `a-run-that-kept-a-testers-words`, each now also checking
  the module.
- **The tick imports `run-delta-sync`**, so its process builds the per-tenant pools at import too,
  lazily, with no connection until one is used, and needs `APP_DATABASE_URL` present, which every
  run has. Its own sinks, set after, stay on its own pool.

**For the owner, on a stack.** Nothing by hand: `APP_DATABASE_URL` is uploaded every night, and
`set-task-env.sh` runs before `deploy-tasks.sh`. One consequence to know: a stale `app_user`
password on a plane now stops every per-tenant task, where before it stopped only the API. The
password rotation already re-uploads both URLs (`docs/managed-bring-up.md`, "Changing the database
passwords", step 3). Live takes this from a tag, as any change (0132 T1g).

Gates: `pnpm -s typecheck` green; `eslint` on the 31 changed TypeScript files clean. Unit tests
all passed: `packages/ledger`, `apps/worker`, `packages/orchestration`, `apps/selfhost` (the
appliance, which already passed its handles and runs unchanged) and `packages/core`, 265 files
and 2649 tests; `apps/api`, `packages/managed`, `packages/shared` and `packages/connectors`, 318
files and 4284 tests; `scripts`, 198 files and 3484 tests, `a-connection-the-docs-did-not-know-about`
among them. Integration against a Postgres 16 with both chains (`scripts/local-pg.sh`), as its
owner, a superuser, the row-security guard deriving `app_user` from it: every Postgres-only
integration file in `packages/ledger`, `apps/worker` and `packages/orchestration`, 23 files and
217 tests. The four that need Stalwart or Nextcloud were not run. The three indexes are current.
Nothing was exercised against a running stack.

Still open: the wall-time comparison (above); T2 (PR D); T3 step 2 (PR E), with the owner's one-off
deletion (2026-09-27); T5 step 2 (PR F); the permission report's pool (T5 step 1's note).

**2026-09-28, later still: review fixes for step 2, same branch, not merged.** Review found one
blocking thing and six minor ones (one of them twice). Each is fixed here, in one more commit:

- **The jobs were handed the owner's pool (blocking).** `openTaskPools` returned the key's pool,
  `auditKey`, beside the tenant pool, and nothing kept a job from taking it. Review changed one
  token in each of three jobs (`const { auditKey: pool } = openTaskPools()` in `run-verification`,
  `openTaskPools().auditKey` in `run-delta-sync`, `pools.auditKey` in `run-rollback`), and all 486
  tests of the 31 unit files that guard this stayed green; the integration guard never loads a
  job's own pool. A pass could have gone back to the superuser with every guard green. `TaskPools`
  now carries `tenant` and `end` alone, and the key's pool belongs to the audit sink and to
  nothing else. The module's own test finds it the way the sink does, as the pool asked for a
  connection (a spy on `Pool.prototype.connect`), and so does the integration guard, which asks it
  who it is. `a-pass-that-opened-the-owners-pool` gains two rules: a `PER_TENANT` file and the
  standalone worker take `tenant` from what `openTaskPools` hands back, and `end` only inside
  `afterwards(…)`, and nothing else (read off the call, out of a destructuring or off a binding,
  and the lot handed on counts as taking all of it); and no file but the module names `auditKey`.
- **A failed cutover's or rollback's event never reached the log page.** Both open their pools per
  run and ended the tenant pool in their own `finally`, which runs before `leavesAReference`
  records the failure. The sink, which is on that pool, then met *"Cannot use a pool after calling
  end on the pool"*, and `recordAppEvent` said so as a warning: the plane's error carried a
  reference that named no event. Not new (`main` ended its one pool the same way), but this step
  redrew that contract. `leavesAReference` now hands a run a third argument, `afterwards`, and ends
  what the run handed it there once the run has returned or its failure is recorded, last handed
  first; an end that fails is logged and changes neither the plane's error nor the output.
  `run-cutover` and `run-rollback` call `afterwards(() => pools.end())` as soon as they open their
  pools, and `run-rollback` now opens them first, before its notify check, whose refusal also left
  a reference with no event (in a fresh process the sink was not pointed yet).
- **The sync tick needs `APP_DATABASE_URL` too.** It imports `run-delta-sync`, which opens its pools
  when it is loaded, so without it no tick runs, and no scheduled sync. The runbook's
  troubleshooting line sent the operator to the per-tenant runs only. It, the runbook's two roles
  and `managed.env.example` now say so.
- **SECURITY.md** still said 0138 *moves the tasks to the application role*. It now says what T2
  and T3 step 2 do, as the SAD's §17.1 row does.
- **The wall-time comparison** (above) picked a pass out by the date, which mixes builds, and waited
  for a scheduled run that may never come. It now names #211 as the step-1-alone run and picks a
  pass out by its run id (`orchestrator_ref`), which the smoke prints.
- **Comments.** `job-resolution.ts`'s second copy of *"Row security does not bind the tasks yet"*,
  and the integration guard's opening, now in the past tense, with its lost ` *` back.

**The guards, and how they failed first**, each run against this branch's previous commit
(df9d5d4f):

- Unit, three files: **6 of 147 failed**. In `a-pass-that-opened-the-owners-pool`, `run-cutover` and
  `run-rollback` take *"end, outside afterwards"*. In `a-run-that-kept-a-testers-words`, the three
  new cases on `afterwards` (*"afterwards is not a function"*; the order was only
  `['recorded task.run-cutover.failed']`). In `a-task-pool-that-fell-back-to-the-owner`, *"expected
  [ 'auditKey', 'end', 'tenant' ] to deeply equal [ 'end', 'tenant' ]"*. A seventh case, added
  next, that a task opening its pools in its run opens them before anything it throws and ends them
  in `afterwards`, failed on the previous `run-cutover` and `run-rollback` (*"expected … to contain
  'afterwards(() => pools.end());'"*). The rule that no file but the module names `auditKey` passed
  there, no job naming it yet; review's three changes turn it red (A1 to A3 below).
- Integration, `a-pass-under-row-security`: **1 of 13 failed**, the new last case. Its first half,
  the pools ended in the run's own `finally`, lost the event with the warning review quoted, on the
  previous code as on this; its second half, through `afterwards`, ended no pool (*"expected false
  to be true"*).

**Mutations, each red** (the four unit guards and the integration guard; `tsc` where a job names
the key's pool):

| # | Mutation | Red |
|---|---|---|
| A1 | `run-verification` takes the key's pool: `const { auditKey: pool } = openTaskPools()` (review's first change) | `tsc`; 2 unit (it takes `auditKey`; it names it) |
| A2 | `run-delta-sync`: `openTaskPools().auditKey` (review's second) | `tsc`; 2 unit |
| A3 | `run-rollback`: `pools.auditKey` (review's third) | `tsc`; 2 unit |
| A4 | The module hands the key's pool back again, in its type and its return | 1 unit (what it hands back) |
| A5 | Handed back, and `run-verification` takes it for its tenant pool: review's whole regression, `tsc` green | 3 unit |
| B1 | `run-cutover` ends its pools in its own `finally` again | 2 unit |
| B2 | `run-rollback` opens its pools after the notify refusal again | 1 unit |
| B3 | The wrapper ends what the run opened before it records the failure | 2 unit; integration, the event lost |
| B4 | The wrapper never ends it | 3 unit; integration, the pool not ended |
| B5 | The wrapper lets a failed end replace the plane's error | 1 unit |
| B6 | `run-rollback` no longer ends its pools | 1 unit |
| 2 | `openTaskPools` falls back: `APP_DATABASE_URL ?? DATABASE_URL` (re-run) | 1 unit |
| 3 | The key's pool removed: the audit sink on the tenant pool (re-run) | 3 unit; integration, the line not written |
| 4 | The key's pool on `APP_DATABASE_URL` (re-run) | 3 unit; integration, the line not written |
| 10 | The key's pool without its error handler (re-run) | 1 unit |
| 12 | The log page's events on the key's pool (re-run) | 2 unit; integration (the old shape's event lands, on the key's pool, which nothing ended) |

The re-runs are the step's own mutations that touch what changed here: the module's test now finds
the key's pool by the connection the sink asks for, and still catches each.

Gates: `pnpm -s typecheck` green; `eslint` on the 9 changed TypeScript files clean. Unit tests:
`apps/worker`, `packages/orchestration`, `packages/ledger`, `packages/core` and `apps/selfhost`, 265
files and 2654 tests; `scripts` and `apps/api/src/routes/migrations`, 241 files and 4086 tests,
`a-connection-the-docs-did-not-know-about` among them. Integration, on a throwaway Postgres 16 with
both chains (`scripts/local-pg.sh`), the row-security guard as `app_user`: the same 23 files, 218
tests. The three indexes are current. Nothing was exercised against a running stack.

**2026-09-28, later still: re-review fixes for step 2, same branch, not merged.** Re-review found
two minor things. Both are fixed here, in one more commit:

- **The guard saw an end only on the name `openTaskPools`'s result was bound to.** Re-review added
  `} finally { await pool.end(); }` to run-cutover's `try`, on `const pool = pools.tenant`, and
  kept `afterwards(() => pools.end())`. `tsc` and `eslint` passed, and so did every job unit file
  beside the jobs, `a-pass-that-opened-the-owners-pool`, `a-run-that-carries-no-superuser` and
  `every-audit-field-is-classified` (24 files, 408 tests), while at run time the tenant pool was
  ended before the failure's event, and the event was lost again: the last entry's second finding,
  back in the shape `main` ended its one pool in. `a-pass-that-opened-the-owners-pool` now counts
  every `end` a `PER_TENANT` file or the standalone worker names, called or not: off any name, by
  its key (`pool['end']`) or out of a destructuring (`{ end: close }`). It lets one stand only
  where it waits for `afterwards`: in a function handed to that call, or handed to it itself
  (`afterwards(pools.end)`). An end in the call's own arguments (`afterwards(pools.end())`) runs at
  once, and counts as outside now; the previous version let anything under the call pass. It does
  not ask which object a name holds, so any other `end` in those nine files must wait for
  `afterwards` too (none has one). It reads each file alone: an end in another file's function
  that the pool is handed to it does not see (none has one). `docs/rls-guide.md` and
  `task-pools.ts`'s header said the guard held the pool's end to `afterwards` under any name, and
  now say what it reads and what it does not.
- **The permission report's lines.** #1303 (0138 T6, merged on `main` after this branch's base)
  moved the permission report and the sharing rescan onto `getDbPool()` inside `withTenant`, and
  added `a-route-that-opened-the-owners-pool` for `apps/api`. This branch still said, in
  `SECURITY.md`, `README.md`, `.env.example`, `managed.env.example` and the SAD's §17.1 row, that
  two API routes read on the owner's connection, and `docs/rls-guide.md` still had the report's own
  row, the two §2 bullets, the pitfall, and *"not in 0138's task table yet"*. Each of those lines
  sits in a hunk `main` changed too, so a merge that kept this branch's side would have put the
  claims back on `main`. They now carry #1303's wording, word for word where the text is #1303's
  alone (the guide's T6 note, the request path's row, the audit key's row, the two §2 bullets, and
  the paragraph on the `apps/api` guard). On this commit alone they are ahead of the code:
  `permissions.ts` opens its own pool on `DATABASE_URL`, and 0138 T6 and its guard are not here,
  until this branch merges `main`, the next step. Asked of a merge that was not made
  (`git merge-tree` of this commit and `origin/main` at 979ef36f): every conflict left in those six
  files is about the tasks, and this branch's side of each carries none of the old claims.
  `docs/operator-runbook.md` and `managed.yml`, whose lines on the two routes this branch never
  touched and still carries, take #1303's text without a conflict.

**The guard, and how it failed first.** The shapes went into *"sees what a file takes"* before
the change, eleven of them: the re-review's, the tenant pool destructured off the call or off the
whole, `pools.tenant.end()`, under a second name by its key, taken out of a destructuring, in a
helper of the file's own, in `afterwards`'s own arguments, and three that wait. Against the
previous version the eight that end too early each failed (*"expected [ 'tenant' ] to deeply
equal [ 'end, outside afterwards', 'tenant' ]"*, and for the re-review's own shape *"expected [
'end', 'tenant' ] …"*); the three that wait passed. With the change all 80 cases pass.

**Mutations**, each run against the previous version of the guard and against this one, beside
`tsc`, `eslint` on the job, the 21 unit files beside the jobs, `a-run-that-carries-no-superuser`
and `every-audit-field-is-classified`; restored from a copy after each:

| # | Mutation | Previous guard | This guard |
|---|---|---|---|
| C1 | run-cutover also ends `pool` (`const pool = pools.tenant`) in its own `finally`, the end in `afterwards` kept (the re-review's change) | all green, `tsc` and `eslint` too | 1 unit (run-cutover takes *"end, outside afterwards"*) |
| C2 | run-cutover takes `const { tenant: pool } = pools`, and ends `pool` in its own `finally` | all green | 1 unit |
| C3 | run-rollback ends `pools.tenant.end()` in its own `finally` | all green | 1 unit |
| C4 | run-rollback hands `afterwards` an end already called (`afterwards(await pools.end().then(…))`), which `tsc` accepts | 1 unit (`a-run-that-kept-a-testers-words`, the text it looks for) | 2 unit |

Gates: `pnpm -s typecheck` green; `eslint` on the two changed TypeScript files clean. Unit:
`scripts`, 198 files and 3495 tests, `a-connection-the-docs-did-not-know-about` among them;
`apps/worker`, 26 files and 364 tests. The three indexes regenerated, unchanged, and current. No
integration run: nothing a pass runs changed (the guard, a comment in `task-pools.ts`, and
documents). Nothing was exercised against a running stack.

**2026-09-28, later still: `main` merged into this branch, at 979ef36f,** by a merge commit, not
a rebase; this branch is still not merged. `main` had moved thirteen commits past 83eb73ed,
among them #1303 (T6, above) and #1320 (0085 T2, *a closed organisation gets no pass*). Every
conflict keeps both sides, each sentence checked against the merged code:

- **The six documents that say where row security holds** (`.env.example`, `README.md`,
  `SECURITY.md`, `managed.env.example`, the SAD's §17.1 row, `docs/rls-guide.md`). `main`'s
  side of each conflict was #1303's text on step 1's base, saying no task connects as
  `app_user`; this branch's side already carried #1303's wording (the re-review's entry, above)
  and says what step 2 did. This branch's side, then. The guide's T6 note, its request-path and
  audit-key rows and its paragraph on the `apps/api` guard were #1303's words on both sides, and
  merged without a conflict.
- **This block and the task table.** T6's two entries, `main`'s, come before T1 step 2's, as
  #1303 merged first. T1's row keeps step 2's status and takes #1302's commit from `main`'s.
  T6's row said *"not merged"* on `main`; it says done in #1303 now.
- **The workplan index and `docs/LESSONS.md`**: regenerated with `--write`, not edited.

**#1320's reads, under `app_user`.** 0085 T2 reads `tenant.status` in three places a per-tenant
task reaches: the step before each data type and `whyThePassStops`
(`stopping-a-pass.ts`), `buildDepsFromMapping` (in the transaction that reads mail's phase) and
`buildDomainDepsFromMapping` (in `loadDomainConnections`'s). Each calls `organisationIsOpen`
inside `withTenant` for the organisation, and `tenant`'s select policy (ledger 0028) lets a
scope read its own row, so none of them needed changing. The tick's `AN_OPEN_ORGANISATION_WHERE`
reads every organisation's status in one statement, and the tick stays on the owner with the
other cross-tenant jobs (T2). Proving it mattered more than usual: on `app_user` a read outside
a scope finds no row, and no row is not an open organisation, so every pass would stop as closed
and every build would be refused with the close's own sentence, and nothing would say why.

- **`a-pass-under-row-security`** gains a case on the pools `openTaskPools` opens: with A closed
  by the owner, `whyThePassStops` and the step answer `organisation_closed`, both builders refuse
  with `account_closed`, and B's answer is what it was; reopened, A runs again. Three mutations,
  each restored after. The step's status read moved outside the scope
  (`organisationIsOpen(plainDb(db), …)`): 2 of 14 cases red, *"expected { halt:
  'organisation_closed' } to deeply equal { run: true }"*, while `main`'s
  `a-closed-organisation-is-read-by-nobody`, which runs on the owner, stays 5 of 5. The domain
  builder's read moved outside the scope: 3 of 14 red, each a `CredentialRefusalError` *"This
  organisation was closed."* for an open organisation, the owner's file again 5 of 5. The step's
  close check deleted: 1 of 14 red, the new case.
- **The one code change the merge needed.** `main`'s new
  `a-closed-organisation-gets-no-pass.unit.test.ts` imports the tick, which imports
  `run-delta-sync`, which opens its pools at import through `openTaskPools`. Without
  `APP_DATABASE_URL` the file failed at import (*"APP_DATABASE_URL is required: a per-tenant task
  reads and writes tenant data as app_user, …"*, 20 tests skipped). It now sets an unused one, as
  the five tick tests beside it have since step 2, and passes 20 of 20.
- **The guide** says so: the per-tenant task row names the organisation's own `tenant` row among
  its scoped reads, the cross-tenant row names the tick's read of every organisation's status,
  and the paragraph and the list entry for `a-pass-under-row-security` name the new case.

Gates on the merge: `pnpm -s typecheck` green; `eslint` on the 33 TypeScript files that differ
from `origin/main` clean. Unit tests all passed: `apps/worker`, `packages/orchestration`,
`packages/ledger`, `packages/core` and `apps/selfhost`, 267 files and 2686 tests; `apps/api` and
`packages/managed`, 140 files and 1848 tests; `scripts`, 205 files and 3724 tests. The first run
of `scripts` failed one, the `docs/LESSONS.md` drift guard: the index had been regenerated while
the merge still had unmerged paths, and it came out short; regenerated once they were staged, it
passes. Integration against a Postgres 16 with both chains (`scripts/local-pg.sh`), as its
owner, the row-security guard deriving `app_user` from it: every Postgres-only integration file,
67 files and 593 tests, all passing (24 in `apps/worker`, `packages/ledger` and
`packages/orchestration`, `a-closed-organisation-is-read-by-nobody` among them, 224 tests; 43 in
`apps/api`, `packages/managed`, `apps/selfhost` and `packages/core`, `a-report-under-row-security`
among them, 369 tests). The 16 that need Stalwart or Nextcloud were not run. The three indexes
are current. Nothing was exercised against a running stack.

Still open: the wall-time comparison (T1 step 2's entry); T2 (PR D); T3 step 2 (PR E), with the
owner's one-off deletion (2026-09-27); T5 step 2 (PR F). The permission report's pool, which T1
step 2's entry still listed, is T6, done in #1303.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's answer: build first, or accept in writing | 📋 **Decided 2026-09-28** (open question 1): (a), T1 to T4 built before the first invitation | §4 and open question 1. 0131 T5's row for this plan. The recommendation was (b): accept in writing for the alpha, with T5's first step, T3's first step and T4 in place before the first invitation. |
| T1 Per-tenant tasks read and write as the application role | Step 1 ✅ **done** in #1302, merged 2026-09-28 (c33b441c; parts 2 to 4). Step 2 🔨 **built 2026-09-28**, not merged (parts 1 and 5, the switch). Both before the first invitation (T0 (a), 2026-09-28) | §3. Eight jobs, the builders that opened their own ledger from `DATABASE_URL` (step 1 hands them the job's pool), the stores that filtered by their own `WHERE` (step 1 scopes them), and the audit sink's key (step 2 reads it on a pool of one of its own). Step 2: the eight jobs and the standalone worker take their pools from `openTaskPools` (`task-pools.ts`), `app_user` on `APP_DATABASE_URL`, with no fallback. Wall time before and after: the owner compares three E2E (managed) runs, #209, #211 and the first with step 2 (Status, 2026-09-28, later still). |
| T2 The owner's reach kept to the jobs that span tenants | 🔨 **built 2026-09-28**, not merged; before the first invitation (T0 (a), 2026-09-28) | §3. The sync tick, retention and the purge keep the owner's connection. The digest, the drift detector and group discovery are split (open question 3, answered 2026-09-28): the list of active organisations, ids only, on `DATABASE_URL` through `activeOrganisations` (`task-pools.ts`), and each organisation read and written in its own scope on `openTaskPools`'s tenant pool, `app_user`. Guards: `a-pass-that-opened-the-owners-pool` (its `SPLIT` kind) and `a-job-that-reads-each-organisation-as-itself` (integration). No grant was missing. |
| T3 No superuser in a run's environment | Step 1 ✅ **done** in #1222, merged 2026-09-27. Step 2 🔨 **built 2026-09-28, review fixed 2026-09-29** (`main` merged in, 0033 amended before any stack ran it), not merged; before the first invitation (T0 (a), 2026-09-28). Its bring-up deletes step 1's stored value too, so the owner's one-off is done wherever it runs. Dispatch no E2E (managed) for it until it is about to merge | §3. Step 1: stop uploading `DIRECT_DATABASE_URL`, which no task reads. Step 2: the sync tick, retention, the purge, the split jobs' list and every task's audit key connect as `ownpace_system` (`SYSTEM_DATABASE_URL`, managed migration 0033): `BYPASSRLS`, no superuser, no role or database of its own, a member of no role and no role a member of it, column-exact grants (31 purge-only tables, `person` and `person_migration` among them), a grant to PUBLIC counted as its own; `set-task-env.sh` asks about the role before every upload and uploads its URL, and its forget run, after a deploy that went through, deletes `DATABASE_URL` and `DIRECT_DATABASE_URL`; the bring-up refuses an unfit role before the upload and clears every setting on it with its password. Guards: T3's and T4's (rule 8), `a-superuser-the-bring-up-would-have-uploaded` (runs the phase), `a-system-role-that-is-not-the-owner` (integration). Step 3: 🅿️ **Parked (trigger: the service admits people the owner has not let in personally)**. |
| T4 A guard that fails when a per-tenant job opens the owner's pool | ✅ **done** in #1222, merged 2026-09-27, as a ratchet; the ratchet emptied and deleted by T1 step 2 (2026-09-28, not merged) | §3. A closed list of the files that may read a database URL other than `APP_DATABASE_URL`. Under T0's option (b) it landed first as a ratchet: T1 step 1 took the three orchestration files off `KNOWN_REMOVED_BY_T1` (11 to 8), step 2 took the eight jobs and deleted the list, and added `task-pools.ts` to `CROSS_TENANT` for the audit key alone, with rules that every task file is per-tenant or cross-tenant and every per-tenant one takes its pools from `openTaskPools`. |
| T5 The documents say which connection the tasks use | ✅ **Step 1 done** in #1218, merged 2026-09-27. Step 2 📋 **Proposed**, after T1 to T3 | §3. Step 1: what is true today, and an owner pool in the API that §1 missed (Status, 2026-09-27). Step 2: what T1 to T3 built. The legal texts' sentence goes to 0139. |
| T6 The permission report reads as the application role | ✅ **done** in #1303, merged 2026-09-28 (683525c8) | §3. `apps/api/src/routes/permissions.ts`, which the report and the sharing rescan use, on `getDbPool()` inside `withTenant`. Guards: `a-report-under-row-security` (integration, as `app_user`, two organisations) and `a-route-that-opened-the-owners-pool`. Found by T5 step 1 (Status, 2026-09-27). |

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
  `managed-drift-detect` and `managed-group-discovery`. *Since T1 step 2 (Status, 2026-09-28) the
  eight per-tenant jobs take their pools from `openTaskPools`, on `APP_DATABASE_URL`. Since T2
  (Status, 2026-09-28, the entry at the top) so do the digest, the drift detector and group
  discovery, which read only their list of organisations on `DATABASE_URL`; the other three
  scheduled ones are unchanged.*
- **What they do not read.** *(T1 step 2, Status 2026-09-28, changed the first half: the eight
  per-tenant jobs read `APP_DATABASE_URL` through `openTaskPools`, and `DATABASE_URL` for the
  audit key alone.)* No task reads `APP_DATABASE_URL` or `DIRECT_DATABASE_URL`. No code
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
  *T1 step 2 (Status, 2026-09-28) gave the per-tenant tasks the same answer: a key pool of one
  on the owner's URL, in `openTaskPools`.*
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

*Built 2026-09-28 (Status, the entry at the top), not merged.* The line fell at the list alone for
all three: the ids of the active organisations, read once per run by `activeOrganisations`
(`task-pools.ts`). The digest's organisation row (its name and settings) and group discovery's
source connections, which the list carried before, are each organisation's own and are read in
its scope.

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

*Built 2026-09-28, review fixed 2026-09-29 (Status, the two entries at the top), not merged.* The
role is `ownpace_system`, its URL `SYSTEM_DATABASE_URL`; the grants are per column where a job only
picks rows; the script also deletes `DIRECT_DATABASE_URL`, in a run of its own after the deploy,
and fails when the store still holds either name; the bring-up asks about create database,
replication, membership both ways, `BYPASSRLS` and `LOGIN` besides superuser and create role, and
`set-task-env.sh` asks the same before every upload; and every setting on the role is cleared
with its password.

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

### T6 — the permission report reads as the application role

Found by T5 step 1 (Status, 2026-09-27), outside §1: `apps/api/src/routes/permissions.ts` built its
own pool on `DATABASE_URL`, so the permission report and the sharing rescan read `connection`,
`mailbox_mapping` and `mailbox` as the owner. Its three helpers take `getDbPool()` and run inside
`withTenant` for the caller's organisation, like every other route, and keep their own `tenant_id`
filters. The mapping lookup's join also asks for the mapping's own organisation, so it is right on
the owner's connection too, which `getDbPool()` falls back to without `APP_DATABASE_URL`. Guards:
an integration test as `app_user` with two organisations, in which a migration naming another
organisation's mailbox resolves to nothing and each lookup has a row of the caller's to lose, and a
unit guard that fails when a file in `apps/api/src` reads the owner's URL, builds a pool, or names
a package function that reaches the owner for its caller, without being on its closed list, which
no route may join. When T1 part 2 removes a function's fallback, the function leaves that guard's
`OWNER_URL_HELPERS`: T1 step 1 (#1302) removed the orchestration builders', and they left it when
this branch took `main` in (Status, 2026-09-28). T4's scan is not widened to the API: its lists are
about tasks, and T1 and T5 step 2 change its file.

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
- **The rest of the API's request path.** It already connects as `app_user` (§1). The one
  exception, found on 2026-09-27, was the permission report's own pool; that is T6.

## Open questions

1. **T0: (a) or (b)?** If (b), the date or event that ends the acceptance, and the reason, for
   0131 T5. **Answered 2026-09-28: (a)**, *"0138 T0: build the fix first."* Nothing is accepted in
   writing, so there is no end date to state.
2. **T3's end state.** Is the system role of step 2 the end, or should step 3's functions follow
   at its trigger, so that no run holds a credential that reads past the policies? Recommended:
   step 2 for the alpha, step 3 before the service admits people the owner has not let in.
   **Answered 2026-09-28: as recommended.** The owner: *"yes, For the Alpha, the jobs that span
   organisations get their own account, one that is not a superuser."* Step 2 (PR E) is the
   alpha's end state; step 3 stays parked until the service admits people the owner has not let
   in.
3. **The digest, the drift detector and group discovery.** Split them as T2 proposes, or keep
   them whole on the system connection? They are on T4's list either way, for their list of
   organisations. Splitting puts their per-tenant reads under the policies. Keeping them whole is
   less work, and leaves those reads past the policies too.
   **Answered 2026-09-28: split them**, *"0138 open question 3: a - split them"*. T2 splits the
   three: the list of organisations from the cross-tenant connection, each organisation's reads
   through `withTenant` on the application pool (PR D, after C).
