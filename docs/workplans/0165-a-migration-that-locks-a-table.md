# Workplan 0165 — A migration that locks a table

> **In one line:** Which migrations lock a table, why migration-lint's Atlas cannot see it, and a squawk report on each migration a pull request adds or changes, report only; by the owner's answers, no rule blocks, the runner gets a lock timeout, and no file runs outside a transaction.

## Status — 2026-11-21 (update this block at the end of every session)

**2026-11-21, last: T4, a lock timeout in the runner, built as #2002, and the report reads it.**
On `claude/ownpace-public-readiness-y7orc6-migration-lock-timeout`, from `main` at `77eea91d`, with
#2000's branch merged in.
- **The runner.** `applyOne` (`packages/ledger/src/migrate.ts`) runs `SET LOCAL lock_timeout` to
  `MIGRATION_LOCK_TIMEOUT`, five seconds, right after each file's `BEGIN`. Past it the file rolls
  back with nothing applied, the start fails with a message that says it waited for a lock, and
  the next start tries again. The advisory lock taken before any file still waits for another
  migrator, and there is no `statement_timeout`. D3 named no value; moving it is one line. The
  managed chain goes through the same runner. ADR-0045 records it.
- **The report.** `require-lock-timeout`, which squawk raises on 123 files because it reads each
  file alone, is now marked *met by the runner* (`MET_BY_THE_RUNNER` in
  `scripts/migration-locks-report.mjs`): a changed file's finding is listed with that mark and
  gets no warning on its line, and the history counts say why. `a-lock-a-migration-takes` holds
  the mark to the runner: it fails if `applyOne` stops setting a lock timeout between `BEGIN` and
  the file. Three mutations each fail it: the rule taken out of the map (2 tests), the mark's
  warning put back (1), the runner's `SET LOCAL` removed (1).

**2026-11-21, later: the owner's answers, and squawk's first reading.**
- **The answers.** Asked D1 to D4 (§6), the owner answered *"I take your recommendation.
  Continue"*. So: D1, the report stays as built, on squawk v2.73.0. D2, no rule blocks now. D3, a
  lock timeout in the runner, in its own pull request with a test. D4, no file runs outside a
  transaction. D3 named no value; the builder chose 5 seconds (T4).
- **What squawk read in CI** (#2000's run, job 136798002326, on GitHub's amd64 runner). Both sums
  were as pinned, the binary said `squawk 2.73.0`, and it read all 129 files, none refused. §5
  has the counts. Two rules fire on 123 files each: `require-lock-timeout` and
  `require-statement-timeout`. squawk reads each file alone, so it cannot see a timeout the
  runner sets; T4 marks the first one as met by the runner in the report.

**2026-11-21: read, and a report built, report only.** On
`claude/ownpace-public-readiness-y7orc6-migration-locks`, from `main` at `87663d7`.
- **The finding.** An outside, read-only check (DATA-1b, "Database changes that lock a table",
  of 2026-11-21, on `75d7949d`) ran squawk 2.66.0 with its own configuration over the migrations'
  SQL. It reports a count, "measured", with no threshold, so nothing passed or failed. The list
  the owner forwarded names 25 places, all in `packages/ledger/migrations/`, the last in 0043.
- **What they are (§3).** Each is one of four shapes: a CHECK or FOREIGN KEY added without
  `NOT VALID`, a `CREATE INDEX` without `CONCURRENTLY`, or a `DROP INDEX` without it. No place
  changes a column's type, adds a required column without a default, renames or drops a column.
  Reading every file by statement shape finds 120 such places in both chains (the ledger's
  baseline left out): 61 in the ledger, 20 of them from 0044 on, and 59 in the managed chain. 36 of
  the 120 are on a table the same file creates, which is empty.
- **Why CI saw none of it (§4).** migration-lint's Atlas community v1.4.0 registers four
  analyzers for Postgres, by its source at the tag: destructive changes, data-dependent changes, a
  dropped foreign key, and renames. None reads a lock. On `main`'s last migration run it read 129
  files and gave 4 diagnostics, all MF101 ("a unique index might fail on duplicate entries"),
  warnings only.
- **Why CONCURRENTLY is not the fix here (§2).** `runMigrations` applies each file inside one
  `BEGIN`/`COMMIT` (`packages/ledger/src/migrate.ts`, `applyOne`). `CREATE INDEX CONCURRENTLY`
  cannot run in a transaction, and every lock a file takes is held to its `COMMIT`. 0023's own
  header says so. So 20 of squawk's places can never be met by a new migration as things stand.
- **Built here, report only (T2).** `.github/workflows/migration-locks.yml` runs squawk 2.73.0,
  the static build from its GitHub release, checked by its sha256 for both architectures before it
  runs, over every file of both chains, each read as one transaction. The job summary lists every
  finding in a file the pull request adds or changes, with a warning on its line, and counts the
  rest per rule as history. No finding fails it. A pin-watch row keeps the version current.
- **Tests.** The new guard `scripts/a-lock-a-migration-takes.unit.test.ts` (18 tests) runs the
  report end to end against a stand-in squawk. It also fails if the runner stops wrapping a file in
  a transaction. `scripts/a-pin-that-knows-it-is-behind.unit.test.ts` gains 8 tests that run the
  install step under bash with `curl` and `uname` stubbed. Two mutations of the report (a failed
  run read as clean, and the transaction option dropped) each fail the guard.
- **Not run here.** squawk itself: by rule, a downloaded binary runs only in CI. Its sums were
  read from the downloaded bytes without running them, and they match the ones GitHub's release
  page shows. This pull request's own run is the first measure (§5).
- **Open.** The owner's D1 to D4 (§6).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | ✅ **Decided 2026-11-21** (D1 to D4, as advised) | §6. The owner's answer is quoted in the Status entry of 2026-11-21, later. |
| T1 Read the finding | builder | ✅ **Done 2026-11-21** | §2 to §4: each listed place, what it locks, the rest of both chains, and what Atlas reads. |
| T2 squawk, report only | builder | 🔨 **Built**, a draft pull request (D1) | `migration-locks.yml`, `scripts/migration-locks-report.mjs`, a pin-watch row, two guards. Fails nothing; not a required check. |
| T3 A squawk rule that blocks | builder | 🅿️ **Parked 2026-11-21, by owner decision** (D2: not now; trigger: a lock measured to hurt) | If ever: only for files a pull request adds, and only rules a migration here can meet (§5, option C). |
| T4 A lock timeout in the runner | builder | 📋 **Decided 2026-11-21** (D3); 🔨 **built** as #2002 (Status, 2026-11-21, last) | `SET LOCAL lock_timeout = '5s'` per file in `applyOne`, with a test, in its own pull request. The report then marks `require-lock-timeout` as met by the runner. |
| T5 A file applied outside a transaction | — | ✅ **Decided 2026-11-21: no** (D4) | Would make CONCURRENTLY possible and give up the all-or-nothing file the runner keeps. |

## 1. Why

The outside check reads `main` after the merge. Its DATA-1b check counts statements that take a
strong lock on a table, or rewrite it, while they run. On a large, busy table that can stop every
read or write for as long as the statement takes. The question it raises is not about the files
already applied. Those are history: an applied migration never changes (ADR-0045,
`scripts/a-chain-that-only-grows.unit.test.ts`), so its count for them will not go down. The
question is what a new migration should be held to, and whether CI should say so before the
merge.

## 2. How a migration is applied

- **One transaction per file.** `runMigrations` takes an advisory lock, then for each file not yet
  in its bookkeeping table runs `BEGIN`, the file, the bookkeeping `INSERT`, and `COMMIT`
  (`applyOne` in `packages/ledger/src/migrate.ts`). The managed chain uses the same runner with its
  own bookkeeping and lock (`packages/managed/src/migrate-managed.ts`). No migration file opens or
  ends a transaction of its own; the new guard holds that.
- **So every lock is held to the end of the file.** Postgres releases a table lock at `COMMIT`.
  A file that adds a CHECK keeps the `ACCESS EXCLUSIVE` lock through every later statement in it.
- **So CONCURRENTLY cannot be used.** `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY`
  refuse to run inside a transaction block. A migration that tried would fail at start-up, and the
  integration tests, which apply both chains, would fail first. 0023's header says the same:
  *"Plain CREATE INDEX, not CONCURRENTLY, and that is forced rather than chosen."*
- **NOT VALID helps only across two files.** `ADD CONSTRAINT … NOT VALID` skips the scan of
  existing rows. `VALIDATE CONSTRAINT` then scans under a weaker lock (`SHARE UPDATE EXCLUSIVE`),
  which lets reads and writes go on. In one file that gains nothing, since the strong lock from the
  `ADD` is still held when the scan runs. Split over two files, each its own transaction, it works.
  No migration here has ever used `NOT VALID`.
- **No lock timeout.** Neither the runner nor any file sets `lock_timeout`; the baseline's
  `pg_dump` preamble sets it to 0 for its own session, and the runner's `RESET ALL` undoes that. A
  migration that asks for a strong lock while a long query holds a weaker one waits, and every
  query on that table queues behind it.
- **Who else is connected.** On the appliance, the migrations run before it serves, so nothing
  else holds a lock. On the managed stack, the API runs both chains when it starts (`apps/api/src/
  index.ts`), and a failed migration exits the process, which compose restarts. The worker and the
  Trigger.dev tasks are other processes on the same database, so they can be reading and writing
  while the API migrates.
- **Size.** The architecture sizes a tenant at about 25 mailboxes (§21), and the managed service
  grows by tenants. `item` is the largest table: one row per copied mail, event, contact and file,
  for every tenant. Most tables the listed places touch hold a handful of rows per tenant
  (`connection`, `tenant`, `mailbox_mapping`, `group_def`). The lock times below were not measured
  here.

## 3. Each place the outside check lists

The line is squawk's, which points at the clause; a statement can start a line earlier. The rule
is the one the statement's shape trips in squawk's documentation (read from squawk's own `docs/`
on GitHub, since its site was not reachable from here).

| Place | Statement | squawk rule | Table | What it locks while it runs |
|---|---|---|---|---|
| 0003:30 | `ADD CONSTRAINT verification_status_check CHECK` | `constraint-missing-not-valid` | `verification` | `ACCESS EXCLUSIVE` and a scan of every row |
| 0003:51 | `CREATE INDEX verification_run_mapping_started_idx` | `require-concurrent-index-creation` | `verification_run`, created in the same file | nothing anyone else uses: the table is new and empty |
| 0004:44 | `CREATE INDEX apply_receipt_item_idx` | `require-concurrent-index-creation` | `apply_receipt`, created in the same file | as above |
| 0005:25 | `CREATE UNIQUE INDEX uk_decision_pending_subject` (partial) | `require-concurrent-index-creation` | `decision` | `SHARE` (writes wait, reads go on) for the build. Atlas MF101 warns too |
| 0006:47 | `ADD CONSTRAINT group_def_pattern_check CHECK` | `constraint-missing-not-valid` | `group_def` | `ACCESS EXCLUSIVE` and a scan |
| 0006:50 | `CREATE UNIQUE INDEX uk_group_def_source_address` | `require-concurrent-index-creation` | `group_def` | `SHARE` for the build. Atlas MF101 |
| 0008:22, 0012:22, 0015:20, 0018:14, 0019:16, 0034:59 | `ADD CONSTRAINT connection_kind_check CHECK`, after dropping it, to widen the list of account kinds | `constraint-missing-not-valid` | `connection` | `ACCESS EXCLUSIVE` and a scan |
| 0010:20 | `ADD CONSTRAINT apply_receipt_action_check CHECK` | `constraint-missing-not-valid` | `apply_receipt` | `ACCESS EXCLUSIVE` and a scan |
| 0016:55 | `CREATE UNIQUE INDEX uk_share_grant_identity` | `require-concurrent-index-creation` | `share_grant`, created in the same file | nothing anyone else uses |
| 0020:47 | `CREATE UNIQUE INDEX uk_setup_step_identity` | `require-concurrent-index-creation` | `setup_step`, created in the same file | nothing anyone else uses |
| 0022:32 | `DROP INDEX uk_mapping_source_target` | `require-concurrent-index-deletion` | `mailbox_mapping` | `ACCESS EXCLUSIVE`, briefly |
| 0022:34 | `CREATE UNIQUE INDEX uk_mapping_source_target_prefix` | `require-concurrent-index-creation` | `mailbox_mapping` | `SHARE` for the build; and the `ACCESS EXCLUSIVE` from line 32 is still held. Atlas MF101 |
| 0023:32, 0023:42 | `CREATE INDEX ix_run_active`, `ix_run_started` | `require-concurrent-index-creation` | `run` | `SHARE` for each build |
| 0023:53 | `CREATE INDEX ix_mapping_active` | `require-concurrent-index-creation` | `mailbox_mapping` | `SHARE` for the build |
| 0025:28 | `ADD CONSTRAINT tenant_status_check CHECK` | `constraint-missing-not-valid` | `tenant` | `ACCESS EXCLUSIVE` and a scan |
| 0042:71, 0042:78 | `ADD CONSTRAINT … FOREIGN KEY (mapping_id) REFERENCES mailbox_mapping(id) ON DELETE CASCADE` | `adding-foreign-key-constraint` | `verification_run`, `apply_receipt`, and `mailbox_mapping` | `SHARE ROW EXCLUSIVE` on both tables and a scan of the first |
| 0043:48, 0043:55 | `ADD CONSTRAINT … FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE` | `adding-foreign-key-constraint` | `verification_run`, `apply_receipt`, and `tenant` | `SHARE ROW EXCLUSIVE` on both tables and a scan of the first |

**The list is not every place before 0044.** It names 25, and skips places between the ones it
names: 0023:70 (an index on `item`), 0031:91, 0035:100 and 104, nine CHECKs in 0036 (`item` among
them), and the connection-kind CHECK in 0037, 0038 and 0039. It may be one page of a longer list.

**The rest, read the same way.** A short script read every statement of both chains by its shape
(not squawk; squawk runs only in CI). Leaving out the ledger's baseline, which is a `pg_dump` of an
applied database that creates every table it indexes:

| Shape (squawk rule) | Ledger | of them from 0044 | Managed | On a table the same file creates |
|---|---:|---:|---:|---:|
| CHECK without `NOT VALID` (`constraint-missing-not-valid`) | 34 | 12 | 21 | 0 |
| FOREIGN KEY without `NOT VALID` (`adding-foreign-key-constraint`) | 5 | 1 | 4 | 1 |
| `UNIQUE` constraint added (`disallowed-unique-constraint`) | 1 (0067:49) | 1 | 0 | 0 |
| `CREATE INDEX` without `CONCURRENTLY` (`require-concurrent-index-creation`) | 20 | 6 | 34 | 35 |
| `DROP INDEX` without `CONCURRENTLY` (`require-concurrent-index-deletion`) | 1 | 0 | 0 | 0 |
| **All** | **61** | **20** | **59** | **36** |

The ones on `item`, the largest table: 0023:70 (index), 0036:38 and 44 (CHECKs), 0045:67 (CHECK),
0045:77 (FOREIGN KEY), 0045:88 and 0046:59 (indexes), and 0056:25 (CHECK). No file in either chain
changes a column's type, adds a `NOT NULL` column without a default, sets `NOT NULL` on an existing
column, renames a column or drops one. The one `DROP NOT NULL` (managed 0001:581) takes no scan.

## 4. What migration-lint reads today

`migration-lint` (`ci.yml`) installs Atlas community v1.4.0, checked by its sha256, and runs
`atlas migrate lint --latest 999` over both chains, staged into one directory, against a disposable
Postgres 18. It runs when a migration changes.

- **Its analyzers.** In Atlas's source at tag v1.4.0 (commit `e933d0b70620`, the one the CI binary
  names), `sql/postgres/postgrescheck` registers four for Postgres: `destructive` (DS101 to DS103:
  a dropped schema, table or column), `datadepend` (MF101 to MF104: a unique index, or `NOT NULL`,
  added on data that may not fit), `condrop` (CD101: a dropped foreign key) and `incompatible`
  (BC101, BC102: a renamed table or column). There is no analyzer there for a lock, a scan, a
  table rewrite, `CONCURRENTLY` or `NOT VALID`. No `atlas.hcl` here configures one, and none exists
  in that source to configure. Atlas's site lists more analyzers; it was not reachable from here
  (atlasgo.io), and whatever it lists beyond these four is not in the community source this binary
  is built from.
- **What it said on `main`.** The run on `45a758af` (job 136786017380): *"125 versions ok, 4 with
  warnings"*, *"4 diagnostics"*, all MF101: ledger 0005:25, 0006:50 and 0022:34, and managed
  0061:57. Warnings do not fail the job.
- **So it covers** a dropped or renamed column or table (the outside check's "renamed or dropped
  column") and a `NOT NULL` column added without a default (MF103), and nothing in §3's table.

## 5. Options

| | What | Catches | Costs | Advice |
|---|---|---|---|---|
| A | Nothing new; Atlas stays as it is | Drops, renames, `NOT NULL` on existing data | Nothing. The outside check keeps counting after the merge | Not enough on its own: no check sees a lock before the merge |
| B | **squawk, report only** (built here) | Every class in §3, plus a changed column type and others Atlas lacks | A new tool: two downloads of about 22 MB from github.com per run (the host osv-scanner's release comes from), a pin-watch row, an upkeep pull request when squawk releases. False findings: index rules on a new table (squawk skips those when told each file is one transaction), and rules no file here can meet (marked in the report) | **Yes.** Report only, so its noise costs a reading and never a merge |
| C | A squawk rule that blocks, on files a pull request adds | What the rule names | A red check on most migration pull requests unless the house style changes: of the 20 ledger places from 0044 on, 12 are CHECKs on an existing table. Each enum widening then needs two files: `ADD … NOT VALID`, then `VALIDATE CONSTRAINT` | **Not now** (D2) |
| D | Atlas's own lock analyzers | — | Not in the community build. Its paid edition with a login in CI | No |
| E | A lock timeout in the runner | Not a check: it changes what a migration that waits does | A code change in `applyOne` and a test. A migration that waits longer than the timeout fails, the API exits, compose restarts it, and it tries again | **Yes**, as its own change (D3) |
| F | Let a file run outside a transaction | Makes `CONCURRENTLY` possible | The file is no longer all-or-nothing with its bookkeeping row; a half-applied file needs a hand repair | **No**, not at this size (D4) |

**What B does in detail.** `.github/workflows/migration-locks.yml`, job `squawk (report only)`:
- Runs on a pull request or a push to `main` that touches either chain, the workflow or its
  script, and on dispatch. GitHub-hosted. Not in `ci.yml`, so `ci-complete` never waits for it.
- Installs squawk v2.73.0, `squawk-linux-musl-x64` and `-arm64` (static builds) from
  `https://github.com/sbdchd/squawk/releases/download/v2.73.0/`. Both sums are checked before
  anything runs. They are the sums GitHub's release page shows for those assets, and the same sums
  were read from the downloaded bytes on 2026-11-21. squawk publishes no checksum file. v2.73.0
  was published on 2026-11-15, past the three-day floor. The outside check ran 2.66.0; this pins
  the newest, and the pin watch's new `squawk` row keeps it current against upstream's git tags.
- Runs squawk once per file with `--reporter gcc --assume-in-transaction --pg-version 18.0`. A
  finding in a file the change adds or changes is listed in full, with a warning on its line. Every
  other file is history, counted per rule. The two `CONCURRENTLY` rules are marked "cannot be met
  here". A file squawk could not read is listed and warned about. Nothing fails the job except the
  install step refusing a download whose sum is wrong, which runs nothing.

**What it read, on its first run** (#2000, job 136798002326, 2026-11-21). All 129 files, none
refused; no file was changed by the pull request, so every file counted as history:

| Rule | Places | Files | What it is here |
|---|---:|---:|---|
| `require-lock-timeout` | 123 | 123 | No file sets `lock_timeout`. Since T4 the runner sets it for each file, which squawk, reading each file alone, cannot see; the report marks it met by the runner |
| `require-statement-timeout` | 123 | 123 | No file sets `statement_timeout`. D3 sets none on purpose: a migration that holds its lock and is working, such as an index build, should finish, not be cut off halfway |
| `ban-drop-constraint` | 65 | 41 | The drop that comes before each re-added CHECK, as in the connection-kind widenings |
| `constraint-missing-not-valid` | 62 | 40 | §3's CHECKs, and the baseline's |
| `prefer-bigint-over-int` | 21 | 8 | A column type preference, not a lock |
| `require-concurrent-index-creation` | 19 | 13 | Cannot be met here. The 35 indexes on a table the same file creates dropped out, as squawk's documentation says |
| `adding-foreign-key-constraint` | 8 | 6 | §3's foreign keys |
| `ban-drop-not-null` | 1 | 1 | Managed 0001:581 |
| `disallowed-unique-constraint` | 1 | 1 | Ledger 0067:49 |
| `require-concurrent-index-deletion` | 1 | 1 | Cannot be met here: ledger 0022:32 |

So squawk and §3's reading agree on the lock classes, within the baseline's few. squawk also counts
rules §3 did not look for. None of them fails anything.

## 6. Decisions for the owner

- **D1. Keep the squawk report built here, report only?** It runs on every pull request that
  changes a migration, lists that pull request's findings, and fails nothing. It pins squawk
  v2.73.0, the newest release, not the outside check's 2.66.0.
  - Options: keep it as built; keep it on 2.66.0, to match the outside check's count; or drop it
    (option A).
  - Advice: **keep it as built.** It is the only check that sees a lock before the merge, and
    report only means its noise costs a reading, not a merge. The newest release is what the pin
    watch would ask for in a week anyway.
  - **Answer, 2026-11-21: as advised.**
- **D2. Should a squawk rule ever block a merge?**
  - Options: never; not now, and decided again when a lock is measured to hurt; or now, for files
    a pull request adds.
  - Advice: **not now.** At today's size the scan under the lock lasts milliseconds on the tables
    in §3. A blocking rule would make most migration pull requests red, or double the files of each
    enum widening.
  - If the owner says yes: block only files a pull request adds, since history never changes. Use
    only rules a migration here can meet: `constraint-missing-not-valid` and
    `adding-foreign-key-constraint` on an existing table (the fix is `NOT VALID` in one file and
    `VALIDATE CONSTRAINT` in the next), and the table-rewrite rules, `changing-column-type` and
    `adding-required-field`, which no file has broken yet. Never the two `CONCURRENTLY` rules while
    each file is one transaction. Keep the job out of `ci-complete` until it reports nothing on
    `main`, as 0163 did with its checks.
  - **Answer, 2026-11-21: as advised, not now** (T3, parked).
- **D3. Give each migration file a lock timeout in the runner?**
  - What: `SET LOCAL lock_timeout` at the start of each file's transaction in `applyOne`, so a
    migration that waits behind a long query fails after a few seconds instead of making every
    query on that table wait behind it. The API then exits and compose restarts it.
  - Options: yes, with a value the owner picks (a few seconds); or no.
  - Advice: **yes, in its own pull request, with a test.** At this size, waiting for a lock is a
    likelier outage than the lock itself. It is a code change, not a CI check.
  - **Answer, 2026-11-21: as advised.** No value was named; the builder chose 5 seconds, a named
    constant in `migrate.ts`, so moving it is a one-line change (T4).
- **D4. Allow a migration file to run outside a transaction, so `CONCURRENTLY` can be used?**
  - Options: no; or a marker in the file that `applyOne` reads.
  - Advice: **no, not now.** Each file is all-or-nothing with its bookkeeping row today. Without
    the transaction, a file that fails halfway leaves the schema half-changed, and only a hand
    repair fixes that. 0023's header names the answer if a table ever grows that large: an index
    built out of band, not a change to the runner.
  - **Answer, 2026-11-21: as advised, no.**

## 7. What was read, and from where

- squawk's rule pages, from `docs/docs/` in squawk's repository on GitHub
  (raw.githubusercontent.com), since squawkhq.com was not reachable from here. Quoted:
  `require-concurrent-index-creation`, *"This rule ignores indexes added to tables created in the
  same transaction"*; `ban-concurrent-index-creation-in-transaction`, *"this is not allowed when
  the CONCURRENTLY option is used"*; the CLI's `--assume-in-transaction`, *"Assume that a
  transaction will wrap each SQL file when run by a migration tool"*.
- squawk v2.73.0's two musl assets, downloaded into an empty directory and hashed with
  `python3 -I`, never run. Their digests on GitHub's release page were read the same day.
- Atlas's source at tag v1.4.0, a sparse clone of `sql/sqlcheck`, `sql/postgres/postgrescheck` and
  `cmd/atlas/internal/cmdapi`, read as text. atlasgo.io was not reachable from here.
- The migration-lint log of `main`'s run on `45a758af`, through the GitHub API.
