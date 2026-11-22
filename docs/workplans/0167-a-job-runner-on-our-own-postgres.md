# Workplan 0167 — A job runner on our own Postgres

> **In one line:** pg-boss (MIT) on our own Postgres in place of self-hosted Trigger.dev for the managed edition's jobs: a spike that proved nine points against a real Postgres, directly and through PgBouncer, then the replacement in steps, from the runner, imported by nothing, to Trigger.dev's removal.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22, later still, after the second review: a NOLOGIN jobs role is not "not made yet", and four smaller holes.**
The coordinator's second review of #2041 confirmed the first five fixes, and E2E (managed) run
45044295985 passed at `3fc7556b`, with the role made, fit, set and proven on the OTA stack. `main`
(#2043, T6's first step) is merged in, with both Status entries kept, main's T5 and T6 rows and this
branch's T7 row.

- **`rotate-db-passwords.sh` and a NOLOGIN `ownpace_jobs`.** `db_roles_list` lists login roles only,
  so `--check` and `--sync` took a NOLOGIN role for one not made yet: exit 0 and "done". Both now ask
  the fit question whenever the role is not a login role. They skip only on its empty answer
  (`DB_ROLES_JOBS_MISSING`). `--check` then names the refusal and exits 2; `--sync` sets the two,
  leaves the jobs role and exits 1. Taking the old shortcut in either fails the NOLOGIN test.
- **`--sync`'s exit merges the skip** by the script's own rule (a refusal anywhere is 1, otherwise
  a question not asked is 2). The NOT DONE line is printed whatever the two's proof found, and the
  Exit codes block names the skip. Saying it only when the two passed fails its test.
- **A temporary table no longer counts as owned elsewhere** (`pg_temp_N`, `pg_toast_temp_N`). In
  transaction pooling, a temporary table can outlive its client on a server connection. A test holds a
  fit role with a temporary table; without the clause it fails.
- **Two more privileges are counted:**
  - **A `public` relation whose ACL names the role or PUBLIC** (`aclexplode`, grantee 0 or the
    role), on every version. This counts PostgreSQL 17's MAINTAIN, which the privilege functions'
    list does not name. Its test grants MAINTAIN through PUBLIC on 17 and later, so it runs on CI's
    18; here, on 16, it checks that 16 has no MAINTAIN.
  - **EXECUTE on `pgbouncer_auth`'s functions**, through PUBLIC as well, as a new last field. The
    bring-up revokes PUBLIC's EXECUTE just before the question; `--sync` does not. Not counting it
    fails its test.
- **`a-system-role-that-is-not-the-owner`** failed 1 of 41 while `pg_stat_statements` existed in the
  shared database. Its relations query now leaves extension-owned relations out, and it passes 41 of
  41 with the extension and without it.
- **`docs/managed-bring-up.md`'s grants query** filters by database (run here against a database
  grant and a column grant), and names the lookup function's remedy.
- **Evidence.** On a `scripts/local-pg.sh` cluster (PostgreSQL 16.15):
  - **The integration file:** `Tests 40 passed (40)`.
  - **`a-system-role-that-is-not-the-owner`:** `41 passed (41)`, with the extension and without it
    (1 failed with it before).
  - **`rotate-db-passwords`:** `68 passed (68)`.
  - **Every unit file under `scripts/` and `deploy/`:** 7,644 tests, 7,610 passed. The one failure is
    `every-release-is-a-starting-point`, for this checkout's 12 tags.
  - **Broken once each, then restored byte for byte:**
    - the temporary-schema clause: 1 failed;
    - the lookup count: 1 failed;
    - `--check`'s and `--sync`'s NOLOGIN shortcut: 1 each;
    - the skip said only at rc 0: 1.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.

**2026-11-22, later still, after review: the fit question no longer refuses every real stack.**
The coordinator's review of #2041 found the question refused every stack that has
`pg_stat_statements`. The data phase creates that extension in the app's database just before the
question runs, and its install script grants PUBLIC SELECT on its two views in `public`. So the
answer counted 2 relations of `public`, and the bring-up died: E2E (managed) and live's alpha.16
deploy after its copy and checkout. The integration test had passed because the Testcontainers
database has no such extension, and the unit stubs answer a canned line.

- **Fixed.** The `public` count leaves out relations an extension owns (`pg_depend` `e`). The test
  now runs what the phase runs before the file, in the phase's order: `setup-auth.sql`, then the
  extension, in the shared database and in the copy's. Against the old question the new file failed
  28 of 36. Against the new one it passes 37 of 37, and taking only the extension clause out fails 28.
- **Three new answers**, for the roles the review found that still read as fit:
  - **Grants naming the role** (`pg_shdepend` `a`): a table, column, schema, function, default
    privilege or the database. This covers USAGE and EXECUTE on `pgbouncer_auth.user_lookup`, CREATE
    or USAGE on `public` by name, and `ALTER DEFAULT PRIVILEGES … TO ownpace_jobs`.
  - **CREATE on the database**, by name or through PUBLIC.
  - **CREATE on `public`**, by name or through PUBLIC.

  A sequence's USAGE is now counted with the `public` relations. Each case has its own test, 11 new
  in all; with the by-name count disabled 4 fail, and with the sequence clause out 1 fails.
- **`jobs-role.sql` has no REVOKE any more.** It would take back a PUBLIC grant on an existing
  schema before the question saw it, against the file's own "repairs nothing". A new schema grants
  PUBLIC nothing anyway. A case runs the file again after such a grant and expects the refusal; with
  the REVOKE put back it fails.
- **`rotate-db-passwords.sh --sync` no longer lets an unfit jobs role block the other two.** It names
  the jobs role and leaves it exactly as it is, still sets and proves the owner and `app_user`, then
  exits 1 (2 when the question could not be asked). `--sync` is how the operator puts the two back
  while the stack may be down; a changed jobs role is a separate fault. Making it refuse again, or
  exit 0, each fails its test.
- **Docs.** `docs/managed-bring-up.md` gains *The jobs role*: every refusal with its remedy, and
  the query that lists what names the role (run here against real grants). The refusal points there.
  `docs/operator-runbook.md`'s roles line names `ownpace_jobs` (and `ownpace_system`, which it had
  left out). The rls-guide row says what the question leaves out and counts.
- **Evidence.** On a `scripts/local-pg.sh` cluster (PostgreSQL 16.15), with the shared database put
  back afterwards (no `ownpace_jobs`, `pgbouncer_auth`, `pgboss` or extension left):
  - **The integration file:** `Tests 37 passed (37)`.
  - **Every unit file under `scripts/` and `deploy/`:** 310 files, 7,634 tests, 7,600 passed. The one
    failure is `every-release-is-a-starting-point`, because this checkout holds only 12 tags (it
    passed on CI's full checkout of this branch).
  - **`a-password-the-repository-knows` and `rotate-db-passwords`:** `Tests 170 passed (170)`, with 3
    new unfit lines in (f).
  - **Broken once each, then restored byte for byte:**
    - `jobs-role.sql`'s REVOKE put back: 2 failed.
    - The bash check of the by-name grants made a no-op: 1 failed.
    - `--sync` refusing on an unfit jobs role: 1 failed.
    - The skip exiting 0: 1 failed.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.

**2026-11-22, later still: the jobs' role and schema, made by the managed bring-up (T7, its first part).**
On branch `claude/ownpace-public-readiness-y7orc6-jobs-role`, from T5's branch. Nothing connects as
the role yet, and no service in `managed.yml` changed; no file in either migration chain and none of
the Trigger.dev, identity-provider and ClickHouse image lines moved, so live's deploy of alpha.16
from alpha.14 stays reversible by `deploy-live.sh`'s own rule.

- **Why the bring-up and not a migration, read from the scripts.** Alpha.14's `deploy-live.sh`
  takes the copy with its own `copy-before-update.sh`, then `git checkout --detach <tag>`, then runs
  that tag's `bootstrap-managed.sh --from data`. So the data phase of the release being deployed is
  the first code of it that runs, and every `--from data` passes `load_env` first. The role is made
  there, as `pgbouncer_auth` is (`setup-auth.sql`), between postgres and the pooler.
- **What was built.** `deploy/compose/jobs-role.sql`: `ownpace_jobs`
  (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`, no password) when
  it does not exist, `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ownpace_jobs`, and
  `REVOKE ALL ON SCHEMA pgboss FROM PUBLIC`. It creates and never alters, so a role that was changed
  is refused, not repaired. `db-roles.sh` gains `db_roles_jobs_ensure`, `db_roles_jobs_fit`,
  `db_roles_jobs_set` and `db_roles_jobs_prove`. The data phase runs ensure, fit and set after
  `setup-auth.sql`, and prove after the pooler is up. `load_env` seeds a missing
  `JOBS_DB_PASSWORD`, before the file is sourced and before any Compose call, through
  `ensure-env-secrets.sh --only JOBS_DB_PASSWORD`, a new mode that fills in that key and nothing
  else (a whole run there would generate the database passwords `load_env` refuses as missing on a
  real address). Also: `managed.env.example`, `rotate-db-passwords.sh` (`--check` asks the role,
  `--sync` judges it and then sets it), `stand-up-live.sh` (generates it, in `URL_PASSWORDS`, and
  no volume keeps it), `docs/rls-guide.md` and `SECURITY.md`.
- **The question, field by field.** Superuser, create role, create database, replication,
  BYPASSRLS, login, inherit; roles it belongs to and roles that belong to it; whether it owns
  `pgboss`; objects it owns outside it but for TOAST (relations, functions, types, schemas and
  databases, and anything else through `pg_shdepend`); relations of `public` it holds any privilege
  on, a column's included, through itself or PUBLIC; and privileges on `pgboss`, or on a relation
  in it, granted to anyone but the role.
- **The copy and the rollback (the open question).** `scripts/a-jobs-role-that-owns-only-its-queue.integration.test.ts`
  makes a database of its own, with both chains, the file and pg-boss with one job queued. It dumps
  it with `copy-before-update.sh`'s flags and restores it over itself with the runbook's rollback
  flags (`pg_restore -d postgres --clean --if-exists --create`), both read from those files. The
  schema is still the role's, the job is in it, the question answers fit, and the runner starts on it
  as the role. The roles are cluster-wide and not in the dump, as the runbook says for the others: on
  a new server the roles' dump comes first (step 7's note).
- **Evidence.** On a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16.15; CI's
  Testcontainers run on 18 is the one to trust for the version):
  - **The new integration file:** `Tests 26 passed (26)`, 2.1 s, with `pg_dump` and `pg_restore`
    this machine's (their major is the server's; on CI the harness image's, on the host network).
    Afterwards no `ownpace_jobs`, no `pgboss` and no copy database are left.
  - **The guards that read what changed** (the ten files touched or run by the phase): `Tests 1079
    passed (1079)`. Every unit file under `scripts/` and `deploy/`: 310 files, 7,631 tests. The first
    run failed 2: `a-demo-on-a-real-address`, whose checkout has no `ensure-env-secrets.sh` (its OTA
    `.env` now carries the key), and `lessons`, regenerated. Both pass now.
  - **Broken once each, then restored byte for byte** (sha256 the same):
    - `NOINHERIT` dropped from `jobs-role.sql`: 20 of 26 integration tests failed.
    - The fit question's `public` privilege clause made `false`: the PUBLIC column grant case failed.
    - `--no-owner` added to the runbook's restore: the restore test failed, the schema no longer
      the role's.
    - In `a-password-the-repository-knows` (f): no `jobs_role_proven` failed 2; the seed running the
      whole generator failed 1; the fit answer ignored failed 9.
    - In `rotate-db-passwords`: no `check_jobs` failed 2; `--sync` without the question failed 2.
    - `managed-env-contract`: load_env without the seed failed 1.
    - `bootstrap-managed`: `--only` going on past its key failed 2.
    - `a-first-bring-up-of-live`: the key judged by `postgres_data` failed 1.
    - `a-connection-the-docs-did-not-know-about`: the guide's row changed failed 1.
  - **Gates:** `pnpm typecheck` 0 and `pnpm lint` 0.
- **Next:** T6 and the rest of T7 (the worker service, `JOBS_DATABASE_URL`, the switch).

**2026-11-22, later still: T6's first step, the job catalog and the jobs made runner-neutral.**
On branch `claude/ownpace-public-readiness-y7orc6-pgboss-a1-catalog`, from `main` with T5 merged
(#2038). Nothing that runs changes: Trigger.dev runs every job under the same ids, queues, machines
and retries, nothing runs on pg-boss, and nothing reads a switch. No migration in either chain, and
`deploy/compose` is untouched.

- **The job catalog**, `packages/scheduler/src/pg-boss/catalog.ts`, exported from
  `@openmig/scheduler/pg-boss`. Seventeen queues named by the tasks' ids: nine schedules on their
  crons, `stately`; eight on demand, `singleton` by the migration for the pass and the count, by
  `confirm:` and the migration for a confirmation, `standard` for the rest. Every queue: three
  attempts, from 5 s doubling to at most 60 s, an hour, a beat every 30 s and a 410 MB heap. One run
  at a time on a worker, but the pass: `MAX_PASSES_IN_FLIGHT` and one more (`concurrencyOf`). Polling
  every 2 s for a job asked for, 10 s for the tick and 30 s for the other schedules. Data: it
  imports nothing, and each entry is a `QueueSpec`. No subpath of its own, since nothing reads it at
  run time yet; the leakage guard's pattern for the subpath covers one.
- **The run context**, `apps/worker/src/jobs/run-context.ts`. `RunContext` carries `runId`,
  `attempt` and `runner`; `JobRunnerPort` offers `enqueue`, `enqueueAndWait`, `verdict` and `cancel`,
  and names its runner. The Trigger.dev half, `onTriggerDev`, holds the SDK calls the jobs made, with
  the arguments they had: the tick's `runDeltaSync.trigger(…)` with its `concurrencyKey` and tags,
  the cutover's `configure` and `triggerAndWait`, the purge's `runs.retrieve` and `runs.cancel`, and
  the pass's `ctx.run.id`, read as defensively as before.
  - The tick's `configure` now comes right before each enqueue, as the cutover's always did. Nothing
    else in the tick calls the SDK, and a tick that enqueues nothing no longer calls it.
  - Every job imports the module, so it loads only the SDK's two calls and does nothing when it is
    imported (rule 9 of `a-pass-that-opened-the-owners-pool`).
  - A pass's task reaches it from the job that enqueues one, as a loader, so each process loads the
    pass's module when it did before.
- **The seventeen jobs.** Each exports its run, `<job>Run`, wrapped in `leavesAReference` and taking a
  `RunContext`, and its zod schema: the eight on demand their own, each schedule an empty strict one.
  Each Trigger.dev definition is `run: onTriggerDev(<job>Run)` under the same id, queue and machine.
  Every run's body is as it was, at its own indentation, but for the calls above.
- **"Fails once" by name**, `failsOnceByName` and `FAILS_ONCE_NAMES` (`AbortTaskRunError`,
  `RunNotRetried`) in `what-a-run-leaves.ts`, for a runner that hears only an error's name. A task's
  own `RunNotRetried` is a verdict too; `AbortTaskRunError` is still the class the plane is handed.
- **The tick's interlock across runners, its Trigger.dev half.** Each runner's tick has a beat of
  its own, `managed-sync-tick-trigger` and `managed-sync-tick-pg-boss` (`SYNC_TICK_BEAT_ON` in
  `@openmig/managed`). Before the operator's hold, the tick reads the other runner's beat
  (`readTickBeat`, which takes a window now: 90 s). While that is fresh it starts no pass, says so,
  and beats as its runner alone. Otherwise it writes the shared beat and its runner's, at one time.
  The rule is written once for either runner; the pg-boss half's second rule, the shared beat newer
  than its own, is the worker's. No migration: 0030's CHECK admits both names, and 0033 grants the
  system role INSERT, SELECT and UPDATE (beat_at) on the whole table. A test reads both migrations
  and writes both beats as `ownpace_system` on PGlite.
- **Not taken: loading the pass lazily in the tick**, which would end the idle tenant pool the tick
  opens at import. The pass's module points the process's sinks at its own pools when it is
  imported, so loaded during the tick's run it would take them from the system pool. A throwaway
  test set a sink, imported the module, and the sink heard nothing after. The tick loads it at its
  top, as before.
- **Tests.**
  - New: `the-catalog-is-the-tasks` (17), `a-tick-that-holds-for-the-other-runner` (10) and
    `run-context` (12).
  - Changed: `a-run-that-kept-a-testers-words` and the five tests that read a run's body as text;
    `a-machine-every-task-names` (the catalog's heap); `a-deliberate-stop-that-was-retried` (the
    decision by name); `a-tick-that-says-it-ran` (five beats).
  - `a-failed-type-ends-no-pass` calls `runDeltaSyncRun` with a context, without mocking the SDK,
    and sees the context's id on the run row.
  - Guards: `scripts/a-pass-that-outlives-its-runner` (the catalog's hour), and the owners-pool
    guard's rule 9. `apps/selfhost/src/no-managed-leakage` now holds that no file under
    `packages/scheduler/src/pg-boss/` is reached: the catalog imports nothing, so a relative import
    of it passed the specifier check.
  - `a-system-role-that-is-not-the-owner`: the tick, as the system role, holds while the pg-boss
    runner's beat is fresh, and starts passes again once it is gone.
- **Mutated**, each once, and restored byte for byte (`cmp`), each failing the test meant for it, 17
  in all:
  - the catalog: a cron, a key, the attempts, the hour, the heap;
  - the tick: its hold beating the shared beat, its last beat of its runner, a window of 0 ms
    (integration, 1 of 41 failed);
  - the beats: a key the CHECK refuses, the window ignored;
  - the run context: `configure` dropped, the verdict's order swapped, a job module imported;
  - the rest: `RunNotRetried` dropped from the names, the pass's id lost, the appliance importing
    the catalog by a relative path, a definition that does not call `onTriggerDev`.
- **Gates.**
  - `tsc --noEmit` 0, and ESLint 0 on the 40 changed TypeScript files.
  - Unit, every file of `apps/worker` and `packages/scheduler`: 54 files, 656 tests.
    `packages/managed`, the appliance's leakage guard and the API's two beat tests: 69 files, 868.
  - Every guard under `scripts/`: 307 of 310 files, 7,570 tests, 37 skipped. Two failed because
    they run pnpm, which could not run here: `ui-build-output` and
    `a-measurement-that-could-not-reach-the-deployments-client`. `lessons` failed until
    `docs/LESSONS.md` was regenerated. The 58 that read the jobs, the catalog, `trigger.config.ts`,
    the workplans or the CHANGELOG all passed, 2,162 tests.
  - The worker's integration files on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL
    16.15 here; CI's Testcontainers run is the one to trust for 18): 8 files, 107 tests. The two that
    need a Stalwart server skip.
  - The six docs checks pass.
- **CHANGELOG:** one line under *Unreleased*, *Changed*.
- **Next:** T6's other steps: the worker that runs the jobs on pg-boss, the API's doors and the
  operator's commands.

**2026-11-22, later: the owner's yes, and the runner as production code (T4, T5).**
The owner, after the spike: *"Put in the successful spike (replace triggerdev)."* Earlier the same
day they had approved the spike. [ADR-0054](../adr/0054-the-managed-editions-jobs-run-on-pg-boss.md)
records the decision: the managed edition's jobs move from self-hosted Trigger.dev to pg-boss on
our own Postgres, worked by a worker container, and ADR-0004's self-host half stands. It is
accepted and *Pending*: in force at T7, and until then Trigger.dev runs every job. ADR-0004 is
amended in place, as ADR-0051 prescribes: its status, its first operative rule and a new
amendment log.

On branch `claude/ownpace-public-readiness-y7orc6-pgboss-runner`, from `main` at `0683eb04`
(alpha.15's fold), with the spike's changes brought in squashed. The spike's own commits fail
`commit-convention`, the one job that failed on draft PR #2034, with `ci-complete`, which waits
on it (CI run 45025459438, where `integration-tests` passed the runner's 10 tests on both
architectures against Postgres 18.7). Nothing imports the runner at run time, and its API is §2's.

- **Names.** The test is `job-runner.integration.test.ts`. Its fixtures are in `__testing__/`, the
  repository's place for modules only tests load: `copy-pass.ts`, `worker-to-kill.ts` and
  `forked-passes.ts`. Its role is `ownpace_jobs_test`. No title or comment says "spike".
- **The pin guard §5 asked for**, `scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts`:
  - pg-boss exact in every manifest that names it, and one version in the lockfile;
  - the installed package the pinned one;
  - the runner's `PG_BOSS_SCHEMA_VERSION`, 46, equal to pg-boss 12.38.2's own `pgboss.schema` in
    its `package.json`. That is the version pg-boss installs and migrates to, and the one
    `PgBoss#schemaVersion()` reads back.
  - Mutated: a caret range failed 3 of its 6 tests, and the constant at 47 failed 1.
- **The run-time half.** pg-boss runs on a schema that a later release migrated further, without
  a word. So `start()` now refuses any version but 46, and stops pg-boss before it throws. A test
  of it joins the integration file, which now has 11.
- **The appliance.** `no-managed-leakage` forbids `pg-boss` and `@openmig/scheduler/pg-boss`.
  Mutated: the appliance's entry importing the subpath failed it, with both reasons named.
- **The evidence**, on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16.15 here; CI's
  Testcontainers run is the one to trust for 18):
  - **Run A, directly:** `Tests 11 passed (11)`, 73.5 s. Point 2 was killed at item 11 of 40 and
    settled 18.4 s after the kill.
  - **Run B, through PgBouncer 1.22.0 with `pool_mode = transaction`:** `Tests 11 passed (11)`,
    73.2 s; point 2 settled 18.9 s after the kill. PgBouncer's `SHOW STATS` counted 2,289
    transactions to the test database, on the pools of both roles.
  - **Gates:** `tsc --noEmit` 0, and ESLint 0 on the 11 changed TypeScript files. The scheduler's
    3 unit files and the 72 guards that read what this changes: 74 of 75 files passed, 3,001
    tests, 23 skipped. The one failure is `ui-build-output`, which builds `apps/web` through pnpm,
    and this session may not run pnpm. Every guard under `scripts/`, with those: 314 of 316 files,
    the other failure being `a-measurement-that-could-not-reach-the-deployments-client`, which
    runs `pnpm exec tsx`. The six docs checks pass, and so does `commit-convention`.
- **CHANGELOG:** one line under *Unreleased*, *Added*. The API's image installs
  `@openmig/scheduler`'s dependencies, so it now carries pg-boss; the appliance's bundle does not.
- **Next:** T6. T6 to T9 are not started.

**2026-11-22: the spike, the nine points run, and a stop for the owner's decision.**
On branch `spike/pg-boss-orchestrator`, from `main` at `9c63582`. Nothing outside
`packages/scheduler`, this plan and the workplan index changed. Trigger.dev is still the only
orchestrator the editions run: the runner is reachable only through the new
`@openmig/scheduler/pg-boss` subpath, and nothing imports it. So the branch has no runtime switch
to set, because it has nothing at runtime to switch. `deploy/compose`, the images, the release
scripts and every Trigger.dev code path are untouched. No CHANGELOG line, by the coordinator's
instruction (alpha.15's fold is in flight).

**The evidence.** `packages/scheduler/src/pg-boss/pg-boss-spike.integration.test.ts`, 10 tests,
run twice on a throwaway cluster from `scripts/local-pg.sh` (PostgreSQL 16 here; production runs 18,
so CI's Testcontainers run is the one to trust for the version):

- **Run A, directly against Postgres:** `Tests 10 passed (10)`, 73.0 s.
- **Run B, through PgBouncer 1.22 with `pool_mode = transaction`:** `Tests 10 passed (10)`, 71.6 s.
  PgBouncer's own `SHOW STATS` counted the suite's transactions through it to the test database
  (4,361 across two runs).
- Both are runs of the committed code. Point 2 settled 18.6 s after the kill in each.
- **The per-run process:** `run-in-child.unit.test.ts`, 4 passed.
- **The repository gates on the branch:**
  - `pnpm typecheck` 0 and `pnpm lint` 0.
  - `pnpm test`: 1367 of 1368 files and 22,282 tests passed, 40 skipped. The 1 failure is
    `scripts/every-release-is-a-starting-point.unit.test.ts` ("lists no release that is not
    tagged"). This checkout carries 4 tags, so alpha.1 onward read as untagged. The branch
    touches neither tags nor `CHANGELOG.md`, and CI's full checkout is the one to read it.
- **Three guards the first unit run caught, now fixed:**
  - `an-image-that-shipped-what-it-never-runs`: no `import()` of a computed name, so the run's
    module is now the forked entry (`serveRuns`).
  - `a-subpath-the-alias-swallowed`: the new subpath is pinned in `tsconfig.base.json` and
    `vitest.aliases.ts`.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The runner | builder | ✅ **Done 2026-11-22** | `job-runner.ts`, and `run-in-child.ts` with `serveRuns`, the forked run's entry; §2. |
| T1 The nine points | builder | ✅ **Done 2026-11-22**, 8 passed, 1 passed in part | §3: point 8's CPU half is the worker container's, not the runner's. |
| T2 Through PgBouncer and a plain role | builder | ✅ **Done 2026-11-22** | Run B above; point 7. |
| T3 Gates | builder | ✅ **Done 2026-11-22** | Typecheck and lint 0; unit 22,282 passed, 1 failed for missing tags in this checkout (Status entry). CI not dispatched, by instruction. |
| T4 The owner's decision | owner | ✅ **Decided 2026-11-22: yes** | The owner, after the spike: *"Put in the successful spike (replace triggerdev)."* They had approved the spike earlier that day. ADR-0054 records it; §5 lists what it starts. |
| T5 This runner, merged | builder | ✅ **Done 2026-11-22**, #2038 | The spike as production code, imported by nothing at run time; ADR-0054; the pin guard and the schema refusal (the Status entry of 2026-11-22, later). |
| T6 The jobs on the runner, behind a switch | builder | 🟡 **Started 2026-11-22**: its first step, the job catalog and the jobs made runner-neutral, built on `claude/ownpace-public-readiness-y7orc6-pgboss-a1-catalog` | §5: the tasks under `apps/worker/src/jobs` and the API's enqueue paths (`enqueue-unless-held.ts`, `job-resolution.ts`) on the runner, one at a time, from `managed-sync-tick` and `run-delta-sync`; `orchestrator_ref` the job id. The switch is off, so Trigger.dev stays the path that runs. The first step (the Status entry of 2026-11-22, later still) changes nothing that runs: the catalog of the seventeen queues, each job's run behind a run context with the Trigger.dev calls moved into it, and the Trigger.dev half of the tick's interlock across runners. Still to come: the worker, the API's doors and the operator's commands. |
| T7 The worker service, and the switch on | builder, owner | 🟡 **Started 2026-11-22**: the role and schema, built on `claude/ownpace-public-readiness-y7orc6-jobs-role` | A worker service in `managed.yml`, with `cpus: 0.5` and a memory limit, and the jobs' schema and role made by the bring-up; the switch on; the deploy and the managed E2E moved to it. ADR-0054 comes into force here (its *Pending*), and ADR-0004's first rule then names pg-boss. |
| T8 Trigger.dev's services stopped | builder, owner | ⬜ **Not started** | Stopped on the stacks, their volumes kept as the way back. |
| T9 Trigger.dev removed | owner | ⬜ **Not started** | Later, and only on the owner's word: Trigger.dev's code, images, scripts, pins and volumes removed. |

## 1. Why, and what was asked

The research of 2026-11-22 (not in the repository; an artifact the owner holds) compared
replacements for self-hosted Trigger.dev, which brings about ten services, Docker-socket access for
its supervisor, a steady stream of advisories and one-way migrations at every version move. It
recommended spiking pg-boss first: MIT, no new service, the ledger's Postgres. The owner approved
the spike the same day. This plan was that spike; since the owner's decision (T4) it also holds
the steps that replace Trigger.dev (T5 to T9).

What the managed edition actually takes from Trigger.dev, read from the code on `9c63582`:

- 9 cron schedules, one every minute (`managed-sync-tick`);
- 8 on-demand `schemaTask`s;
- one pass per mapping (`queue({ concurrencyLimit: 1 })` plus `concurrencyKey: mappingId`, on
  `run-delta-sync` and `run-discovery`);
- discovery's join window (`idempotencyKey` plus `idempotencyKeyTTL`, `job-resolution.ts`);
- whole-task retries, 3 attempts with exponential backoff, and `AbortTaskRunError` to stop them;
- a one-hour `maxDuration`, and `machine: 'small-1x'`;
- one `triggerAndWait`, in `run-cutover.ts`;
- `runs.retrieve` and `runs.cancel`, in `managed-purge-closed.ts`;
- tags on runs.

No checkpoints, no `wait.*`.

## 2. What was built

`packages/scheduler/src/pg-boss/`, behind its own subpath so neither edition loads pg-boss:

- **`job-runner.ts`, `PgBossJobRunner`.** Queues declared at start, each with its retry policy,
  time limit and heartbeat. It offers:
  - `enqueue` with `serializeBy` (the per-key limit), `idempotency` (key plus TTL) and `tags`;
  - `enqueueAndWait`;
  - `work`, with `RunNotRetried` settled as pg-boss's `deadletter`;
  - `status`, `cancel`, `schedule` and `unschedule`;
  - `overview` and `recentFailures`.

  The join window is ours, not pg-boss's. Its `singletonSeconds` is a clock-aligned slot that
  shares `singletonKey` with the per-key limit, so the runner looks for an earlier run with the
  same key inside a transaction holding `pg_advisory_xact_lock`.
- **`run-in-child.ts`.** One forked Node process per run, with V8's heap capped. A cancel kills it
  with SIGKILL. The run's module is the process's entry and ends in `serveRuns({...})`, so nothing
  imports a computed name.
- **`__testing__/`** (`spike-fixtures/` in the spike). A create-if-absent copy pass
  (`copy-pass.ts`), a worker process that is killed (`worker-to-kill.ts`), and the passes a forked
  process runs, the runaway among them (`forked-passes.ts`), all for the tests.
- **Dependencies.** `pg-boss@12.38.2`, MIT, published 2026-11-10, inside the three-day floor's
  limit with nothing to exclude. Its dependencies are `pg`, `cron-parser`, `rrule-temporal` and
  `serialize-error`. `pg` is now a direct dependency of `@openmig/scheduler` too, from the catalog.

## 3. The nine points

The tests use a role made for them: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owning only
a fresh schema. The schema is created for it, because the role may not create one.

| # | Point | Result | Evidence (test in `job-runner.integration.test.ts`) |
|---|---|---|---|
| 1 | A tick racing a manual start yields one running pass per mapping | ✅ passed | `point 1`: 6 enqueues for one mapping and 2 for another, at once, on two workers of 4 slots each. All 8 completed. At most 1 active per mapping, 2 side by side across mappings, and each run of the first mapping started after the one before it ended. |
| 2 | A pass killed with SIGKILL is picked up again, and converges | ✅ passed | `point 2`: the worker process was killed at item 11 of 40. The run settled 18.1 s later (run B), on attempt 2 in another process, with exactly 40 rows, attempts `[1, 2]`, and the second attempt copying 29. |
| 3 | A cancel reaches the running pass within one heartbeat | ✅ passed | `point 3`: the handler's `signal` aborted under 10 s after `cancel()`, and the run reads `cancelled`. |
| 4 | Discovery's join window keeps its semantics | ✅ passed | `point 4`: 10 concurrent asks with one key gave 1 run and 9 joins. A reload after it finished, inside the window, joined it. Past the window, measured from that run's creation, a new run started. A different key on the same mapping was a new run that never overlapped the first. |
| 5 | Cutover waits for its final sync without an await primitive | ✅ passed | `point 5`: `enqueueAndWait` polls the child's row. The child waited behind the pass already running on its mapping and carried the cutover's tags. A `RunNotRetried` came back verbatim after 1 attempt of the 3 allowed, and a failure that cleared on its third attempt came back `ok`. |
| 6 | The every-minute tick never overlaps itself | ✅ passed | `point 6`: a `stately` queue. 6 ticks offered in a burst were let in at most 2 (one running, one waiting). The `* * * * *` schedule fired, and at most 1 tick ever ran at a time. |
| 7 | Through PgBouncer in transaction mode, as a non-superuser role, RLS intact | ✅ passed | Run B. `point 7a`: the role is not a superuser and may not create a schema. It owns nothing outside its schema (and `pg_toast`), can read no `public` table, and added no extension. `7b`: every `public` table's `relrowsecurity` and `relforcerowsecurity` are as they were before the run. |
| 8 | Per-worker limits stop a runaway pass the way `small-1x` does | 🟡 passed in part | Memory: `point 8` and `run-in-child.unit.test.ts`. A pass that runs away dies alone at its heap cap with V8's `FATAL ERROR … heap limit` in the run's error, is failed after its attempts, and the same worker then completes the next run. CPU: no process can cap its own CPU. That stays the worker container's `cpus:` or Kubernetes `resources.limits`, the same cgroup mechanism Trigger.dev's runner containers use. On this machine a cgroup with a quota of 50000/100000 throttled a busy child in 31 of 33 periods, which shows the mechanism, not this code. |
| 9 | An operator can see queued, running and failed work | ✅ passed | `point 9`: `overview()` showed 1 active, 1 queued and 1 failed, with the active key. `recentFailures()` gave the failed run's error verbatim, with its attempt and tags. There is no dashboard; pg-boss's own (`@pg-boss/dashboard`, MIT) was not tried. |

## 4. What the spike found that the research did not say

1. **The heartbeat sweep defaults to a minute.** A run whose worker died is failed and retried by
   pg-boss's supervise pass, `superviseIntervalSeconds`, default 60. On the first run of point 2
   that put the pickup at 59 s. The runner now sets 15 by default; the tests use 1.
2. **One run per key is not first in, first out.** A `singleton` queue limits a key to one active
   run, but which waiting run goes next is not promised. In point 4 the edited count ran before the
   original. Trigger.dev's queues keep order. Nothing here needs the order, since every pass is an
   idempotent delta, but if something ever did, `key_strict_fifo` is pg-boss's answer: it
   holds a failed job's key until it is dealt with, which is a different contract.
3. **The join window is ours to keep.** pg-boss has no idempotency key with a TTL measured from the
   first run. The runner's is about forty lines and one advisory lock.
4. **No await, and no tags field.** Cutover polls the child's row (1 s by default). Tags ride in the
   job's data.
5. **Unhandled `error` events.** pg-boss reports trouble as an `error` event. The runner logs it
   verbatim rather than let it kill the process or swallow it (hard rule 9).

## 5. For the owner: what a decision would start

**Decided 2026-11-22: yes** (T4). [ADR-0054](../adr/0054-the-managed-editions-jobs-run-on-pg-boss.md)
records it, and the steps are T5 to T9, one pull request each. What follows is the section as it
was written before the decision.

Nothing below is done, and none of it starts without the owner's word.

- **If yes:**
  - an ADR superseding ADR-0004's managed half;
  - the tasks under `apps/worker/src/jobs` moved behind the runner, one at a time, starting with
    `managed-sync-tick` and `run-delta-sync`;
  - `enqueue-unless-held.ts` and `job-resolution.ts` changed to it;
  - `orchestrator_ref` becoming the job id;
  - a worker service in `managed.yml` with `cpus: 0.5` and a memory limit;
  - then, last, the Trigger.dev services, scripts and pins removed.
- **If not yet:** the branch can stay a draft, or be closed; it changes nothing that runs.
- **What it would not settle:** pg-boss has one main maintainer, so if it were taken, a guard
  should pin the version and watch its schema version (`schemaVersion()`), as the other pins are
  watched. Built in T5: `scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts`, and
  `start()`'s refusal of any other schema version.
