# Workplan 0134 — No backups during the alpha, said truthfully

> **In one line:** Making the alpha's no-backups decision true on `ownpace-live`: `BACKUP_RETENTION_DAYS=0` so the erasure sentence says so, alpha-conditions wording, a runbook note on a lost machine, an off-machine `.env` copy, and a design for drilled database backups.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: open question 3 (a) built (0131 §6, group M3, step 4's second half)**, not
merged. What a task run leaves in `triggerdb` is now a reference and a category, and a tester's
words stay out of it: a failed run's error, discovery's output and the run's logs.

- **A failed run's error.** Every task's `run` is wrapped in `leavesAReference`
  (`apps/worker/src/jobs/what-a-run-leaves.ts`), so whatever it throws leaves as, for example,
  `run-discovery failed (network). Reference 1a2b3c4d.` The words go to the container's output
  on a line with the same reference, and the operator's log page gets `task.<id>.failed`. A pass's
  data type keeps the reference its own catch already records as `sync.<domain>.failed`:
  `email sync failed (source_refused). Reference ….`
  - The class still decides the retry. A pass that stopped itself after items failed in a row, and
    a task's own verdict (an `AbortTaskRunError`, such as a refused cutover), fail once. Everything
    else is retried, as before.
  - It is done inside `run`, because Trigger.dev's `run()` span records the exception it sees before
    any `catchError` hook could replace it. *[upstream]* `TriggerTracer.startActiveSpan` and
    `TaskExecutor`, 4.5.16.
- **Discovery's output.** A data type it could not count keeps its category and a reference. The
  words stay in discovery's own row, where the wizard reads them, and the log page gets
  `discovery.<domain>.failed`. Nothing reads a run's output back.
- **The run's logs.** `trigger.config.ts` sets `disableConsoleInterceptor: true`. *[upstream]*
  With it on, a deployed run copied every `console.*` line into the plane's store and wrote it to
  the container's output too; with it off, only the second happens. So the smoke's runner-log
  capture reads what it read before. The six tasks that used the SDK's `logger`, which writes to the
  plane directly, now use `log`.
- **Every task points its errors at the log page.** Only `run-delta-sync` did before, so a
  `recordAppEvent` in any other task recorded nothing.
- **Proved.** `apps/worker/src/jobs/a-run-that-kept-a-testers-words.unit.test.ts`, 54 cases.
  - It runs the failure path with invented words (a folder and an address): the error that leaves
    holds neither, in its message, its stack or its JSON; the container's output holds them under
    the error's reference; the event has that reference and category; a data type's recorded
    reference is kept and nothing is recorded twice; a verdict and a pass's stop still fail once.
  - It runs discovery's outcomes the same way, and reads every one of the fourteen task files: each
    runs inside `leavesAReference` under its own id, none uses the SDK's `logger`, each sets the
    event sink. It reads the config for the interceptor.
  - On `main` it cannot load, because the module does not exist. With only the module added, 36 of
    the 54 fail: every case about the tasks and the config.
  - **Mutations: 18, all killed:** the interceptor left on; one task outside the wrapper; an
    ordinary error kept as it was; the words in the sentence; a pass's stop retried; a task's
    verdict retried; an error made twice; no event for a failed run; another reference for the
    words; no words in the output; a pass's recorded reference ignored; the payload's ids dropped;
    discovery keeping the words; discovery's event not recorded; `run-discovery` returning the
    words; a task logging through the SDK again; a task without the sink; `run-delta-sync`
    rethrowing the words.
- **Guards that changed with the rule.** `a-deliberate-stop-that-was-retried` asserted that a
  pass's abort keeps its own sentence, and that every other error reaches Trigger.dev as the same
  object. Now the first says the pass stopped itself, with a category and a reference and without
  the last item's words, and the others assert the class alone: an ordinary error, a lookalike and
  a thrown string are retried, not aborted. Its cases for an abort failing once and for an error
  made twice stand. Four guards that found a task's body by `run: async (` find it by the wrapped
  line now.
- **The runbook** says where a task's words are now: three table rows, and a troubleshooting entry
  for a failure that reads only a category and a reference.
- **What is left.**
  - The change takes a task re-deploy: the nightly gate's, on the OTA stack; live's, from its tag.
  - Runs from before it keep what they held. Live has run no tester's pass yet.
  - T1 (c)'s checks, run on live after a tester's first pass, confirm that the store holds no words.
  - `run-rollback` is started by hand only, from the dashboard, and its payload holds what the
    operator types there: a reason and a DNS domain. Nothing in the product starts it.
- **One departure, and open question 6.** (a) said the words go to the container's output for a
  month. A task's container is removed when its run ends (the supervisor's default, `AutoRemove`),
  so a task's words last as long as its run. Most failures are also written where a person reads
  them, in the application's own records: a pass's run log and status, discovery's row, a
  verification run, an apply receipt, a cutover's ledger. The erasure reaches those. A failure
  outside them, such as a tick that could not reach its database, keeps its category and reference
  after the run, and not its words.

**2026-09-27, evening: the owner answered open question 3: (a)**, *"1a"*. What a failed run,
discovery and a run's logs would leave in Trigger.dev's own database carries a reference and a
category instead, and the full text goes to `app_event` and the container output, a month each,
as the Test button's answer already does (0136 T3). Then the dumps of live's `triggerdb` hold
nothing of a tester's, keeping them stays harmless, and `BACKUP_RETENTION_DAYS=0` stays true. It
is a change to the worker and orchestration, M's to build next. Until it lands, the store can
still hold that text, as T1 (c) found.

**2026-09-27: T3 built (0131 §6, group M3, step 5)**, merged as #1238. What a lost machine
costs is written where the owner will look for it, and two texts that said a lost database costs
nothing now say what it costs.

- **The runbook** gains *If the machine is lost during the alpha*: what only the machine held,
  what a tester keeps, why losing live's `.env` alone costs testers more than losing the machine,
  the owner's five steps, and no squash during the alpha. *Backup & restore* now opens by saying
  that `ownpace-live` takes no backups during the alpha, and that its recipe is for a deployment
  that does.
- **ADR-0020's operative rule** is amended in place (ADR-0038) to what is built: the reindex is the
  worker's command in both editions, run by hand; the appliance warns at start-up; nothing runs it
  automatically. Its amendment at the end says so, and that the database the ledger lives in is
  not a rebuildable cache. `OPERATIVE.md` is regenerated.
- **The downgrade refusal** in `packages/ledger/src/migrate.ts` no longer says *"nothing
  irreplaceable lives here"*, and no longer advises a drop. It names what no target rebuilds, and
  says that a database holding real data is restored from a backup, never dropped. A comment in
  `migrate-upgrade.unit.test.ts` that relied on the old advice is corrected.
- **No squash of either migration chain during the alpha** is recorded here, in the runbook, and
  in the refusal, which names `squash-migrations.sh` as never run once real data exists. 0146 T3
  makes the script itself refuse, after the alpha tag.
- **Proved.** A new case in `packages/ledger/src/migrate-upgrade.unit.test.ts`, beside the
  existing refusal case, runs on every checkout. The existing case needs the release's tag and a
  migration the release lacks. The new one records a version this build does not ship and reads
  the refusal: it must still refuse, name the backup and say not to drop, and must say neither
  *"nothing irreplaceable"* nor *"drop and recreate"*. It fails on `main`.
  `scripts/adr-operative.unit.test.ts` holds `OPERATIVE.md` to the amended rule.
  - **Mutations:** 6, all killed: the refusal saying *"nothing irreplaceable"* again, no longer
    saying not to drop, no longer naming the backup, or advising *"drop and recreate"*; a newer
    database not refused; `OPERATIVE.md` left behind the amended rule. The runbook's section and
    the ADR's words are prose, and no guard reads them.
- **T1 (a) and (b) merged as #1214.** T1 (c), the check of the Trigger.dev store, is M3's step 4
  and is not in this change. Neither are T4, the copy off the machine, which is the owner's, nor
  T2's paragraph, which the lawyer reads.

**2026-09-27: T1 (c) checked (0131 §6, group M3, step 4), with 0139 T6's task runner's stores,**
merged as #1240. Read from
the repository at `101696e`, and from Trigger.dev's own source at the pinned 4.5.16 where marked
*[upstream]*. Nothing was run against a stack. **The finding: Trigger.dev's own database,
`triggerdb`, can hold a tester's personal data, keeps it with no limit, and every dump of it
carries it.** So open question 3 now has the premise it waited for.

- **What gets in.** The task payloads are ids, fixed values and a hash, and hold no names. Three
  things carry text that can name a tester's folders, files or mailboxes, a DAV user name (often
  an address), a Message-ID, or the provider's own words:
  - `run-discovery`'s output, which keeps each failed data type's error as it was thrown
    (`packages/orchestration/src/discovery.ts`, returned by `run-discovery.ts`);
  - the error of any failed run, kept for each attempt. A pass that stops after 25 failures in a
    row carries the last item's error (`domain-sync.ts`, *"Last error: …"*);
  - the run's logs. *[upstream]* During a run, Trigger.dev captures `console.*` as the run's log
    events, and this repository's `log.*` writes to `console.*`; `trigger.config.ts` does not
    turn that off. Folder paths, file names, collection paths and mailbox names are logged on
    ordinary paths, not only on errors.
- **Where it is kept.** *[upstream]* A run's payload, output and error are columns of its row in
  `triggerdb`. Only a payload of 512 KB or more, or an output of 128 KB or more, goes to the object
  store, and this repository's are far smaller. Run logs go to `triggerdb`'s `TaskEvent` table by
  default (`EVENT_REPOSITORY_DEFAULT_STORE`, which `managed.yml` does not set), not to ClickHouse
  as `managed.yml`'s comments say. So §3's sentence that the task events *"are not in those
  dumps"* is probably wrong for this stack. The checks below settle it.
- **For how long.** Nothing in `deploy/compose/` sets a retention for `triggerdb`'s runs or
  events, for ClickHouse, or for MinIO. *[upstream]* Trigger.dev has no run-row retention
  setting. The erasure (`packages/managed/src/offboarding.ts`) never reaches Trigger.dev. Only
  `reset-trigger.sh`, run by hand, removes the run history.
- **The dumps.** `trigger-version.sh backup` dumps the whole of `triggerdb`, gzipped and not
  encrypted, on the same machine, and keeps the newest seven by count, not by age
  (`TRIGGER_BACKUP_KEEP`). The gate's drill takes one on every run, on the OTA stack. On live
  nothing takes one on a schedule, so a dump taken by hand lives until seven newer ones exist.
- **So `BACKUP_RETENTION_DAYS=0` is not yet true for live**, once a tester's pass has run and live's
  `triggerdb` is dumped: that dump is a backup of their data, with no age limit. Nothing is dumped
  on live yet, and no tester has been let in.
- **The checks that settle what the upstream defaults leave open, on live:**
  - in `triggerdb`: `SELECT "taskEventStore", count(*) FROM "TaskRun" GROUP BY 1;` and the row
    count of `"TaskEvent"`;
  - in `trigger-api`: `printenv EVENT_REPOSITORY_DEFAULT_STORE RUN_REPLICATION_ENABLED`;
  - in ClickHouse, the row counts of `trigger_dev.task_events_v1` and `task_runs_v2`;
  - in MinIO, a listing of the `packets` bucket.
- **The decision is open question 3, updated below.** Nothing in this change alters code.

**2026-09-27, build: T1 (a) and (b) built on branch
`claude/ownpace-public-readiness-y7orc6-a-retention-somebody-stated`, merged as #1214.** (a) is the wording and (b) the
start-up check, as 0131 §6 R1 step 5 names them. (c), the check of the Trigger.dev store before
the sentence is trusted, is 0131 M3's step 4 and is not built here.

(a) Seven days is no longer called the reference deployment's retention. `managed.env.example`'s
*Backups* block, the header of `erasure-timeline.ts` and the comment on
`DEFAULT_BACKUP_RETENTION_DAYS`, the `managed.yml` comment above `BACKUP_RETENTION_DAYS`, the
runbook's `backupRetentionDays` row and the paragraph under it, and 0085 T5's row now say that 7
assumes backups exist, that nothing in this repository backs up the application database yet, and
that `ownpace-live` sets 0 during the alpha. The bring-up's *What this does not cover* bullet says
a stack without backups sets 0, that `ownpace-live` does during the alpha, and points here. The
refusal `backupRetentionDaysFromEnv` gives a value that is not a whole number no longer says
*"Leave it unset for the default of 7 days"*: it names the same two answers as the start-up
check. The constant stays 7.

(b) `describeBackupRetentionProblem` in `apps/api/src/config-guards.ts`, run at start-up by
`assertBackupRetentionConfig`, which `index.ts` calls next to `assertProductionUrlConfig`. A blank
`BACKUP_RETENTION_DAYS`, unset or empty, is a warning in production, and fatal with
`OWNPACE_STAGE=alpha` whatever `NODE_ENV` says. Both messages name `BACKUP_RETENTION_DAYS`, the two
honest answers (`0`, or the number of days backups are kept) and this plan. The alpha setting is
read by `alphaFrom`, the reader the grant mail uses. A stated number, `0` or `7` or any other, is
never a problem. **The severity is open question 4, and the owner's answer is still owed.** This
builds the plan's recommendation: a warning in production, fatal on an alpha stack. If the owner
chooses a warning only, `fatal: true` becomes `false` in `describeBackupRetentionProblem`
(`config-guards.ts`), and its doc comment and alpha message change with it. The guard's alpha
cases, its header and the alpha `describe` title change too. So does every sentence that says the
API refuses to start on the alpha: `managed.env.example` (the *Backups* and `OWNPACE_STAGE`
blocks), the `managed.yml` comment, `erasure-timeline.ts`'s header, the `index.ts` boot comment,
the runbook paragraph under `backupRetentionDays`, bring-up §8g and 0085 T5's 2026-09-27 note. A
grep of those files for `refus` finds each one. The `BACKUP_RETENTION_DAYS=0` line in §8g stays
either way. Until T0 is done, live's API, started with the alpha setting, refuses to start, and
the refusal names the line to set. That is what the check is for.

The guard is `apps/api/src/a-retention-somebody-stated.unit.test.ts`, with 20 cases. All 20 failed
on the unchanged code, in a scratch worktree of `origin/main` with only the guard copied in:
neither `describeBackupRetentionProblem` nor `assertBackupRetentionConfig` existed (*"is not a
function"*), and `index.ts` never called the check. Each of eight mutations made at least one case
fail: the alpha case only
warning (5 failed), the alpha case waiting for production (3), `index.ts` not calling the check
(1), an empty line not counted as blank (7), a second reading of the setting that does not trim
(1), a stated `0` counted as blank (3), the warning without the answer `0` (2), and a warning
outside production (3).

Departures from §3. The test for a blank value is one exported predicate,
`backupRetentionIsBlank` in `erasure-timeline.ts`, which `backupRetentionDaysFromEnv` and the
check both use, so the two cannot disagree about which values nobody stated. `UrlConfigProblem`
is renamed `ConfigProblem`, because it now also describes a problem that is not a URL; nothing
else imported it. §8g of `docs/managed-bring-up.md` gains `BACKUP_RETENTION_DAYS=0` beside
`OWNPACE_STAGE=alpha`, and the `OWNPACE_STAGE` block of `managed.env.example` says to set it to 0:
an operator who followed §8g as it stood would now meet the refusal. §8g also gives T0 step 3's
read-back. §3 names only the header and the constant's comment in `erasure-timeline.ts`; the
refusal in `backupRetentionDaysFromEnv` changed too, because its *"Leave it unset"* led straight
into the start-up refusal on the alpha. Its test, and the test title that still called the
default *the reference deployment's window*, changed with it.

Review fixes, the same day. The refusal test in `erasure-timeline.unit.test.ts` now asks for
both answers and for no *"Leave it unset"*; it failed on the old message before the message
changed. The guard's wiring case matched `assertBackupRetentionConfig(` anywhere in the boot
block, so it still passed with the call commented out; it now matches each call as code at the
start of a line, and commenting out either call (this one or `assertProductionUrlConfig`) makes
it fail.

Still open: T0, the owner's (0 in live's `.env`, with 0132 T1b). T1 (c), 0131 M3's. Open question
4, the owner's. T2 to T5 as the table says.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
nothing backs up the managed application database, including the identity provider's database
beside it. It also found that the erasure sentence quotes a seven-day backup retention by
default, for backups that do not exist. This plan adds that the keys every stored credential and
every account depend on exist only on that one machine. The owner decided that the alpha has no
backups and no obligations (§2). This plan builds no backup for the alpha. It makes that decision
true wherever the product, the documents or the alpha conditions suggest otherwise. It writes
down what a lost machine costs a tester, recommends one copy of the keys off the machine, and
parks the backup build with a trigger.

Nothing of this plan is built. The runbook's manual recipe was fixed in #1137, merged
2026-09-24: it now dumps the identity provider's database and the cluster roles as well, and
notes that neither dump is usable without `.env`, that a copy of `.env` is kept off the host, and
that the managed recipe is not drilled.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
Testers' data now lives on `ownpace-live`, a second stack on the same machine (D6), so every
statement this plan makes about testers is about live, and the OTA stack (`ownpace-managed`)
holds none of it. T0 sets `0` in live's `.env` when 0132 T1b seeds it, T4's copy is of live's
`.env`, T5's drill and dump follow live's timer and deploy (0132 T6, T7), and §1 cites the
runbook's recipe and `docs/deployment.md` as fixed in #1137.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's steps on the reference machine | ⏳ **Owner** | §3. `BACKUP_RETENTION_DAYS=0` in live's `.env` (`~/.persistent/ownpace-live/.env`, which live's checkout links to), set when 0132 T1b seeds it and read back from live's API container. T4's copies, if the owner takes them. Dates and outcomes go in this block, never values. |
| T1 The erasure sentence says there are no backups | ✅ **done** in #1214, merged 2026-09-27: (a) the wording and (b) the start-up check, a warning in production and fatal with the alpha setting on (open question 4, the owner's answer still owed). (c), the check of the Trigger.dev store, done 2026-09-27, merged as #1240: it found tester data, and open question 3 was answered (a) the same day. That (a) built 2026-09-28, not merged: a run's error, discovery's output and its logs leave Trigger.dev a reference and a category — *was:* 📋 Decided 2026-09-24 (D1) for the setting and the wording; the start-up check 📋 Proposed | §3. The close response then says *"This deployment keeps no backups"*. The comments that say the reference deployment keeps seven days are corrected. The code default stays 7, for the reason §3 gives. (a) is the wording, (b) the start-up check, (c) *A check before the sentence is trusted*. |
| T2 The alpha conditions say it, in Dutch first | 📋 **Decided 2026-09-24** (D1, D2, D3) | §3. A paragraph drafted here for 0139's lawyer's pass. 0131 T1's note carries the short form. |
| T3 What a lost machine costs, written down | ✅ **done** in #1238, merged 2026-09-27: the runbook's section, ADR-0020 amended, the downgrade refusal, no squash in the alpha — *was:* 📋 **Proposed** | §3. A runbook section for the owner. ADR-0020's operative rule is amended to what is built. No squash of either migration chain during the alpha. |
| T4 The keys and the list of testers, once, off the machine | ⏳ **Owner** (recommended) | §3. A copy of live's `.env` that only the owner can open, taken after live's first bring-up (0132 T1b to T1d) and before the first tester connects. The list of testers, because the access queue that holds it would be lost too. |
| T5 Backups of both databases, encrypted, off the machine, drilled | 🅿️ **Parked (trigger: before the first paying customer, or when the alpha ends, whichever comes first)** | §3. Both databases and the roles, one retention number for the pruning and the erasure sentence, a restore drill in the managed gate and on live's timer (0132 T7), a dump before each migrating deploy of live (0132 T6), a stated RPO and RTO. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, unless it says otherwise.
Since D6 the stack that will hold testers' data is `ownpace-live`. It is not up yet: a second
project cannot start beside the 17 fixed container names until 0132 T1 is done. It is brought up
from the same `managed.yml`, so what is said here of the code holds for it.

**Nothing backs up the application database.** `docs/managed-bring-up.md`, *What this does not
cover*, says so: *"Nothing here backs up `ownpace-db` — including the identity provider's
tables, which after 8b hold the only copy of who can sign in."* A search of `deploy/`, `scripts/`
and `.github/` for `pg_dump`, `pg_dumpall`, `pgbackrest`, `wal-g`, `restic` and `borg` finds one
managed backup, `deploy/compose/trigger-version.sh`, which dumps Trigger.dev's own `triggerdb`.
The other hits are the appliance's README, that script's unit test, the squash script's schema
dumps and a spike. The identity provider keeps its accounts in a second database on the same
server: `managed.yml` points the `zitadel` service at host `postgres` (container `ownpace-db`,
volume `postgres_data`) with `ZITADEL_DATABASE_POSTGRES_DATABASE: ${ZITADEL_DB_NAME:-zitadel}`.

- **The manual recipe** in `docs/operator-runbook.md`, *Backup & restore (§22.1)*, dumped
  `-d openmigrate` only, and left out the `zitadel` database and the cluster roles. That was
  fixed in #1137, merged 2026-09-24: the recipe now dumps `zitadel` and runs
  `pg_dumpall --roles-only`. Its notes say that neither dump is usable without `.env`, that a
  copy of it is kept off the host, apart from the dumps, and that the managed recipe has not been
  drilled. Its restore lines still show `openmigrate` only.
- **The appliance has what managed lacks.** `docs/selfhost-quickstart.md` gives the recipe and
  says *"Keep the dump off the host."* The nightly `e2e.yml` step *"Run Backup/Restore Drill
  (§22.1)"* runs `test/e2e/selfhost-backup-restore.e2e.test.ts`.
- **What the architecture promises.** Its CI gates list *"**Backup/restore** drill (managed
  DB)"*, and its managed rollout lists *"**DB backup before migrate**"*. Neither is built.
  `docs/deployment.md` promised the same until #1137, merged 2026-09-24; it now lists the backup
  before migrate as not built. 0132 T6 has the architecture say so too; the drill is T5 here.

**The Trigger.dev store is dumped, on the same machine.** `trigger-version.sh backup` writes to
`${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/ownpace-managed}/trigger-backups` (unless
`MANAGED_BACKUP_DIR` is set) and keeps seven dumps (`TRIGGER_BACKUP_KEEP`, default 7). The
managed gate runs `trigger-version.sh drill` on every run (`e2e-managed.yml`, *"Backup/Restore
drill for the Trigger.dev control plane"*), and each drill takes a real dump. That gate runs on
the OTA stack only and never on live (0132 T1g). On live's own plane nothing scheduled takes these
dumps until 0132 T7's timer runs the drill there. The script names the container `trigger-db`
(`TRIGGER_DB_CONTAINER`) and the OTA stack's directory by default, and 0132 T1 and T1b make it
find live's. The task payloads the API enqueues for verification, deletion and relocation are
ids, plus a hash for the last two (checked in `operating-routes.ts`; the other enqueue sites were
not checked). This plan did not check what a task returns, or what a failed run records, in that
store.

**The erasure sentence promises backups.** 0085 T5 is marked *"✅ **Built 2026-08-18**"*, with
*"**Retention is 7 days**"*.

- `packages/shared/src/erasure-timeline.ts` sets `DEFAULT_BACKUP_RETENTION_DAYS = 7`, and
  `backupRetentionDaysFromEnv` returns it for an unset or empty value.
- `managed.yml` passes `BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-}` to the API, so a blank
  line in `.env` arrives empty and becomes 7.
- `managed.env.example` says: *"The reference deployment is 7 (owner, 2026-08-18). Leave blank for
  that. Set it to 0 ONLY if this deployment genuinely takes no backups"*.
- `POST /api/tenants/:tenantId/close` (`apps/api/src/routes/tenants/index.ts`) answers
  `backupsExpireAt`, `backupRetentionDays` and `erasureCompletesText` in English and Dutch.
  `closeTenant` records the number and the date on `erasure_record` (`backup_retention_days`,
  `backups_expire_at`).

With seven days the English sentence reads: *"We remove your data from the live service on
{date}. Backups that still contain it expire within a further 7 days, so the erasure completes by
{date}. We do not edit backups retrospectively — they expire."* With 0 it reads: *"We remove your
data from the live service on {date}. This deployment keeps no backups, so that completes the
erasure."* The Dutch has the same two forms.

Live's `.env` is seeded from `managed.env.example` (0132 T1b), where the line is blank, so live
would give the seven-day form unless T0 sets `0`. With a blank line the sentence names backups
that do not exist. The data is gone sooner than promised, not later, so the promised date is
kept. The sentence is still wrong about what exists. The OTA stack's `.env` cannot be read from
the repository, so this plan does not know which of the two that stack says today. It holds no
tester's data (D6).

Today no screen shows the sentence. The web app has no caller for the close route, and the
operator belongs to no organisation (0131 §1). The sentence is only in the route's answer, so it
reaches whoever calls the route: a tester who owns an organisation and calls it directly, the
owner once 0131 T4 gives the owner a way to close an organisation, and testers in the ordinary
way once a close screen exists (W14, now 0144). Every close records the number on
`erasure_record` either way.

**What the other documents say.** The legal drafts do not mention backups of the service. The
terms and the site say *"It is not a backup service"*, which describes the product, not the
service's own records. The privacy draft's §11 says credentials are encrypted *"under a
separately held key"*. The key is held apart from the database, in `.env`, but on the same
machine. The runbook's backup section opens *"Back up the control-plane DB before every
migration/upgrade"*, and its *Upgrade* starts with a backup. Nothing in the repository does
either, for either stack on the reference machine, and 0132 T6 replaces that procedure for live.

**The keys live on one machine.** The bring-up's rename section says of the persisted
directory (`~/.persistent/open-migrate-managed` before the rename, `~/.persistent/ownpace-managed`
after it) that it *"holds the stack's `.env` — including `SECRET_ENCRYPTION_KEY`, the key that
decrypts every stored credential"*, and that *"nothing else will recreate it"*. Its section *One
box, one stack, one `.env`* makes the operator's checkout's `.env` a link to that file. The gate
copies the file into its checkout on every run and, after filling blanks, copies it back
(*"PERSIST IT BACK"*, `e2e-managed.yml`). That is the OTA stack's file. Live's is
`~/.persistent/ownpace-live/.env`, linked from live's checkout the same way, with keys of its own
generated at its first bring-up (0132 T1b, T1d). The gate never restores or writes it (0132 T1g).
`setup-zitadel.sh` does set its `ZITADEL_PAT_EXPIRY` line to the provisioning token's real expiry
on every run, which changes it at each rotation, and 0132 T7 proposes a daily run. So the machine
holds two sets of keys, and only live's protect testers' data.

- `SECRET_ENCRYPTION_KEY` encrypts every stored credential. `packages/core/src/secrets.ts`
  decrypts only its version 1, so a lost key cannot be replaced without every credential being
  entered again. The key is also in the Trigger.dev task environment (`set-task-env.sh`). That
  store is in `triggerdb` and its dumps, on the same machine, encrypted under
  `TRIGGER_ENCRYPTION_KEY`, which is in the same `.env`.
- `ZITADEL_MASTERKEY` encrypts the identity provider's own data. The example says that
  *"replacing a live one strands every account"*. The repository puts it in `.env` (and so in
  the persisted copy, and for the OTA stack in the gate's checkout) and on the `zitadel`
  service's command line, and nowhere else.
- Until #1137, merged 2026-09-24, none of `docs/managed-bring-up.md`, `docs/operator-runbook.md`,
  `docs/release.md`, `SECURITY.md` or `managed.env.example` mentioned a copy off the machine. The
  runbook's backup notes now say *"Keep a copy off the host, apart from the dumps."* The other
  four still do not.
- The repository has already paid once for a key it no longer held.
  `apps/api/src/scripts/secret-readability.ts` records the reference deployment on 2026-09-08:
  *"The rows were simply older than a key rotation nobody has a record of."*

**What a lost ledger costs.** ADR-0020's operative rules say the ledger is *"a **rebuildable
cache + audit log**"*, that writes are *"create-if-absent by natural key"*, and that reindex
*"auto-runs when the ledger is empty but the target is not"*. What is built:

- **A pass adopts what the target already holds.** It counts that item as `adopted` and creates
  nothing (`packages/core/src/domain-sync.ts`). The WebDAV, CalDAV, CardDAV, JMAP and IMAP
  target writers report such a match (`adopted: true`). Whether every writer finds the match in
  every case was not re-verified here. ADR-0020 itself names, as *"a per-provider check"*,
  whether each target's import keeps the Message-ID or `UID` the match relies on.
- **An adopted item never follows its source again.** `classifyKnownItem` answers
  `'leave-adopted'`. The owner's own wording for a migration that is deleted and set up again
  (`mappings.delete.more`, 2026-09-23) says what that means: *"What it finds already there is no
  longer updated when it changes at the source, and anything you deleted or moved on the new side
  comes back."*
- **Reindex is a worker command-line tool.** It is `reindex --tenant <t> --mapping <m> --yes` in
  `apps/worker/src/cli/index.ts`, run on the host with the database URL and the key. No API route
  or screen offers it on either edition.
- **Nothing runs it automatically.** The appliance warns at start-up on an active mapping with an
  empty ledger (`lostLedgerWarning`). The managed edition neither warns nor runs it. 0026 T1
  item 5 built the command and the warning, not an automatic run. The operative rule overstates
  what exists.

On the managed edition the database holds more than the ledger. The runbook says so: *"it also
holds tenant, member, mapping, billing, and audit rows that are not derivable from the target"*.
The migration runner's downgrade refusal (`packages/ledger/src/migrate.ts`) still says *"the
ledger is a rebuildable cache (ADR-0020), so nothing irreplaceable lives here"*. That is true of
the ledger's items and not of the rest. `scripts/squash-migrations.sh` says: *"Do not run this
once real data exists anywhere."*

**A migration file is one transaction.** `applyOne` in `migrate.ts` wraps each file in
`BEGIN`/`COMMIT` and rolls back on failure. The runner refuses a build older than the schema. So
a deploy that brings one migration file, and fails in it, leaves the previous schema, and the
previous build still runs. A deploy that brings several files and fails in a later one keeps the
earlier ones, and the previous build then refuses to start. A migration that succeeds can only be
followed forward.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where an
answer needed a reading, the reading is stated.

**D1 — no backups during the alpha.** *How much data may be lost, how quickly must the service be
back, and where are backups kept?* — *"None during the test"*. *Nothing backs up the application
database, including the identity provider's; build one before testers?* — *"No obligations during
controlled test"*.

**D2 — what the alpha is.** *Is the test free or paid, for how many people, how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* On a tester stack apart from CI and the
nightly gate, reachable from the internet: *"Yes, but its a controlled rest. I Let people in and
support them. Max 10/20 people"* ("rest" is read as "test").

**D3 — the legal surface comes first.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the address, the btw-id and the hosting details?* —
*"Yes before, Alpha, and i can supply."* On the legal blocker (the texts a tester meets are not
ready): *"I will update"*.

**D4 — one machine.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as
"CI stays", as 0131 reads it.) D6 changes the address: testers use the production names, on a
second stack on this machine.

**D5 — nobody else holds the secrets.** *If the current stack is reused, its demo secrets must be
rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to NetBird
network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".) Under D6 the current stack
is not reused for testers.

**D6 — `ownpace-live` beside `ownpace-managed` (0132 D-new, recorded there as D7).** The owner
asked: *"check, can't i just (as a start) host a 'ownpace-live' as production, next to the
current 'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each
other?"* The proposal put back to the owner: make "ownpace-live beside ownpace-managed" 0132's
decision, with the container-name parameterisation as its first task, and testers on
`ownpace-live`. The owner's answer: *"Yes! The spark has a lot free memory and disk, it will
fit."* So testers use `ownpace-live`, on the production names from 0091, and `ownpace-managed`
stays the OTA stack: the nightly gate's target and the demo. CI never touches live.

**What this plan reads from them.** The alpha gets no backup of any kind that holds a tester's
records (D1). Those records are on live (D6): its application database, its identity provider's
database and its `.env`, and whatever its Trigger.dev store keeps (T1's check). The OTA stack
holds none of them. Every place that
suggests a backup exists is corrected (T1, T3), and testers are told before they start, in Dutch
first (T2, with D2 and D3). One machine carries live, the OTA stack and CI (D4, D6), so losing it
ends all three at once, and T3 says what then happens to testers. Any copy of the keys stays with
the owner alone (D5, T4). The backups ADR-0015 asks for (*"Stack DR is ours"*) are
T5, with a trigger. ADR-0015 is not amended: the alpha is a stated exception for a bounded time,
and T5 is the work the ADR already asks for.

## 3. What each task does

### T0 — the owner's steps on the reference machine

1. Set `BACKUP_RETENTION_DAYS=0` in live's `.env`, `~/.persistent/ownpace-live/.env`, when
   0132 T1b seeds it, before live's first bring-up. Live's checkout links to that file (0132
   T1b), so that is one edit. The gate never restores or backfills live's `.env` (0132 T1g), so no
   scheduled run undoes it.
2. If live is already up by then, recreate its API from `~/ownpace-live`:
   `docker compose -f deploy/compose/managed.yml up -d api`.
3. Read it back from `~/ownpace-live`: `docker compose -f deploy/compose/managed.yml exec api
   printenv BACKUP_RETENTION_DAYS` prints `0`.
4. If the owner accepts T4, take its copies after live's first bring-up (0132 T1b to T1d) and
   before the first tester connects.
5. Record the date of each step in the Status block.

The OTA stack holds no tester's data (D6), so its value is not a condition of the alpha. The
same edit in its persisted `.env`, `~/.persistent/ownpace-managed/.env`, which the gate restores,
makes the demo's sentence true as well.

### T1 — the erasure sentence says there are no backups

**The setting (decided).** T0 sets `0`. From then on the close response carries the zero form,
in both languages, and `erasure_record` stores `0` and a `backups_expire_at` equal to the purge
date. 0085 T5 designed for this: the number is recorded per erasure, *"because the retention
can change and the date the customer was given cannot"*. When T5 builds backups, the number goes
back up, and records made during the alpha keep what they said.

**The wording (decided, follows the setting).**

- `managed.env.example`, the *Backups* block: `ownpace-live`, the stack that holds testers' data,
  takes no backups during the alpha and sets `0` (0134). Seven is the owner's number for when it
  does (0085 T5). Nothing in this repository backs up this database yet, so a blank line promises
  backups the stack does not make.
- `erasure-timeline.ts`: the same correction in the file's header and in the
  `DEFAULT_BACKUP_RETENTION_DAYS` comment. The constant stays 7.
- `managed.yml`: the comment above `BACKUP_RETENTION_DAYS` says *"Unset means the 7-day default"*.
  It gains that the default assumes backups exist, and that `ownpace-live` sets 0 during the
  alpha.
- `docs/operator-runbook.md`, the `backupRetentionDays` row and the sentence *"The default is the
  reference deployment's"* under it: the default of 7 assumes backups exist, and `ownpace-live`
  sets 0 during the alpha.
- `docs/workplans/0085-ending-the-service-and-meaning-it.md`, T5: a dated note pointing here.
- `docs/managed-bring-up.md`, *What this does not cover*: the backups bullet points here.

**Why the default stays 7.** Neither default is true for every deployment. A deployment that
takes backups and is left on 0 would tell a customer their erasure is complete while a backup
still holds their data. A deployment without backups left on 7 erases sooner than it says, and
only the mention of backups is wrong. The first mistake is the one a supervisory authority asks
about, so 7 stays the fallback, and the start-up check below makes a blank line visible.

**The start-up check (proposed).** `apps/api/src/config-guards.ts` gains
`describeBackupRetentionProblem(env)`, beside `describeUrlConfigProblems` and with the same
shape.

- In production, an unset or empty `BACKUP_RETENTION_DAYS` is a warning. The warning names both
  honest answers: `0` when nothing is backed up, and the number of days backups are kept when
  they are.
- When 0131 T1's alpha setting is on, which 0131 T5 asks for on live, the same condition is
  fatal whatever `NODE_ENV` says, so an alpha stack cannot start while it quotes backups by
  default. It does not wait for production because `managed.yml` defaults `NODE_ENV` to
  `development`, and making it a required value is 0132 T4, which is proposed.
- `index.ts` calls it next to `assertProductionUrlConfig`.

The guard is `apps/api/src/a-retention-somebody-stated.unit.test.ts`.

- In production, an empty value gives one non-fatal problem that names `BACKUP_RETENTION_DAYS`,
  `0` and this plan.
- With the alpha setting on, the same value is fatal, in production and outside it.
- `0` and `7` give none. Without the alpha setting, a value outside production gives none.

It fails today, because no such check exists.

**A check before the sentence is trusted.** Read what each task in `apps/worker/src/jobs/`
returns, and what a failed run's error can carry, and confirm that Trigger.dev keeps both in
`triggerdb` (this plan did not check Trigger.dev's own storage). If either can hold a tester's
personal data (an address, a folder name, a provider's error text), then the dumps of live's
Trigger.dev store are backups in the erasure sentence's sense. `BACKUP_RETENTION_DAYS` must then cover how long a
dump lives, or the dumps must stop (open question 3). *(2026-09-27: the check found tester data, and
the next sentence is probably wrong for this stack; see the Status block.)* The task events and
large payloads are not in those dumps: `managed.yml` describes ClickHouse as the task-event store and MinIO as the store
for large payloads. They are not backups, but they can outlive an erasure, so the finding on
them goes to 0139 T6 with the other logs. The findings are written in the Status block.

### T2 — the alpha conditions say it, in Dutch first

0131 T1's note already says *"nothing is backed up"* / *"er worden geen back-ups gemaakt"*. The
alpha conditions (0139) need the full statement: what is not backed up, what survives, and what
a tester does. The draft below goes through the lawyer's pass (D3), and the lawyer decides the
final words. The Dutch is what testers read first (D2).

> **Geen back-ups.** Tijdens de alfa maken wij geen back-ups van de eigen gegevens van de dienst:
> uw organisatie, de accounts die u hebt gekoppeld, uw verhuizingen en hun geschiedenis, en uw
> Ownpace-inlogaccount. Gaat de machine waarop de alfa draait verloren, dan gaan die gegevens mee
> verloren. Uw eigen gegevens niet: Ownpace verwijdert niets uit uw oude account, en wat naar uw
> nieuwe aanbieder is gekopieerd, blijft daar staan. Wij laten u dan opnieuw toe, net als de
> eerste keer. U logt opnieuw in, koppelt uw accounts opnieuw en zet uw verhuizingen opnieuw op.
> De eerste ronde herkent wat al bij uw nieuwe aanbieder staat en kopieert dat niet nog een keer.
> Wat hij herkent, wordt daarna niet meer bijgewerkt als het in uw oude account verandert, en wat
> u bij uw nieuwe aanbieder hebt verwijderd of verplaatst, wordt opnieuw gekopieerd. Als dit
> gebeurt, laten wij het u per e-mail weten. De toegang die u ons bij Google, Microsoft of een
> andere aanbieder hebt gegeven, blijft daar bestaan tot u die intrekt. Gaat de machine verloren,
> trek die toegang dan in, en geef haar opnieuw wanneer u opnieuw koppelt.

> **No backups.** During the alpha we make no backups of the service's own records: your
> organisation, the accounts you connected, your migrations and their history, and your Ownpace
> sign-in. If the machine the alpha runs on is lost, those records are lost with it. Your data is
> not: Ownpace removes nothing from your old account, and what was copied to your new provider
> stays there. We would then let you in again, as the first time. You sign in again, connect your
> accounts again and set up your migrations again. The first pass recognises what is already at
> your new provider and does not copy it a second time. From then on, what it recognised is no
> longer updated when it changes in your old account, and anything you deleted or moved at your
> new provider is copied back. We will tell you by email if this happens. The access you gave us
> at Google, Microsoft or another provider stays there until you withdraw it. If the machine is
> lost, withdraw it, and grant it again when you reconnect.

Every sentence rests on a fact in §1 or T3. *"Removes nothing from your old account"* rests on the
drain, removal at the source, being 0117 T3, which 0117 D1 deferred on 2026-09-09. *"Recognises
what is already there"* rests on ADR-0020's natural-key match and `mappings.delete.more`; §1 says
which writers were seen to report a match and what was not re-verified, and that check is done
for the targets the alpha offers before the paragraph goes out. *"We will tell you by email"*
needs T4's list of testers.

The erasure sentence and this paragraph must agree. If the owner keeps a dump before each deploy
(open question 1), both change together.

### T3 — what a lost machine costs, written down

**What survives, and what does not.** Everything in this section is about live (D6). The OTA
stack is lost with the same machine, but it holds no tester's data.

| What | Where it is | After the machine is lost |
|---|---|---|
| The tester's mail, calendars, contacts and files | Their old account | Untouched. No connector removes anything at a source (0117 T3 deferred). |
| The copies already made | Their new account | Stay. They belong to the tester. |
| The ledger (`item`, cursors, status) | `openmigrate` on live's `postgres` service | Lost. A re-created migration's first pass adopts what the target holds, and reads the whole source again once. |
| Organisations, members, connections and their credentials, migrations and their settings, run history, pending deletion decisions, the audit log, access requests | `openmigrate` | Lost. None of it can be derived from a target. |
| Every sign-in identity | Live's `zitadel` database, same server | Lost. |
| The keys and passwords | Live's `.env` | Lost, unless T4. |
| The Trigger.dev account, project and keys | Live's `triggerdb` and its dumps, same machine | Lost. Recreating them *"needs a person and a browser"* (`trigger-version.sh`). |
| Grants and app passwords the tester gave | At Google, Microsoft, Dropbox, Box and the rest | Survive at the provider. The stored copy was on the lost machine, encrypted under a key that was on the same machine. The tester withdraws them (T2). |
| Google test-user entries, the owner's OAuth clients | At the providers | Survive. |

So a lost machine costs a tester their setup and a first pass, not their data. Their copies stop
following the source, and what they removed at the target comes back. That is the same cost as
deleting a migration and setting it up again, which the product already explains
(`mappings.delete.more`).

**Three cases, not one.**

| What is lost | Without T4 | With T4 |
|---|---|---|
| The whole machine | Every tester starts again (T2). | The same for testers. The owner keeps the OAuth client secrets, the mail login and the rest of live's `.env`. The two keys protect nothing any more and can be replaced at no cost. |
| Live's `.env` only (a deleted persisted directory, a file overwritten) | Every stored credential is unreadable, so every tester reconnects every account. Every identity is stranded, so the identity provider's database is started again and every tester registers again. Organisations, migrations and ledgers survive. Whether a person who registers again is matched to their old membership (`tenant_member` keeps both `user_id` and `email`) was not checked. | Nothing is lost. |
| Live's database only | Every tester starts again (T2). | The same. |

The second case is the one T4 is for. It loses no tester data, and without the copy it costs every
tester more than the first case does. The gate never writes live's `.env` (0132 T1g), but it is
still written after the bring-up: by `setup-zitadel.sh` on every run, and by hand. The OTA
stack's file, which the gate rewrites every night, sits beside it under `~/.persistent/`. And the
repository already records one key the deployment no longer held (§1).

**Where it is written.**

- `docs/operator-runbook.md` gains *If the machine is lost during the alpha*, with the owner's
  steps:
  1. Tell each tester, from T4's list, with T2's paragraph.
  2. Bring live up again as 0132 T1b to T1e do, with T4's copy of live's `.env` if there is one.
     Empty its `ZITADEL_PAT_EXPIRY` line first: a new identity provider reads that date once, at
     first initialisation, and a date already past gives a provisioning token that is born
     expired. `setup-zitadel.sh` seeds a fresh date only into an empty line. If the old machine
     could be in someone else's hands, replace every value: nothing depends on the old ones any
     more, and the OAuth client secrets are replaced in each provider's console.
  3. Do Trigger.dev's one-time steps on live's plane (0132 T1c).
  4. Grant each tester again as they come back.
  5. Record the date and what was lost in this plan's Status block.
- The runbook's *Backup & restore* section gets one opening sentence: `ownpace-live` takes no
  backups during the alpha (0134), and the recipe is for a deployment that does. Its notes
  already say, since #1137 (merged 2026-09-24), that the managed recipe is not drilled.
- **ADR-0020's operative rule** is amended in place (ADR-0038) to what is built: reindex is a
  worker command in both editions, the appliance warns at start-up on an empty ledger, and
  nothing runs it automatically. `node scripts/adr-operative.mjs --write` regenerates
  `OPERATIVE.md`, and `scripts/adr-operative.unit.test.ts` fails if that step is skipped.
- **The downgrade refusal's sentence** in `migrate.ts` stops saying *"nothing irreplaceable lives
  here"*. It says instead that the ledger's items can be rebuilt from the target, but that the
  organisations, connections, credentials and accounts beside them cannot, so a database with real
  data is restored from a backup rather than dropped. The guard is an assertion beside the existing
  refusal tests in `packages/ledger/src/migrate-upgrade.unit.test.ts`: the refusal names the backup
  and does not say "nothing irreplaceable". It fails today.
- **No squash of either migration chain during the alpha.** For the testers, a squash would be the
  same as a lost database: the runner refuses the old chain, and the remedy the refusal gives is to
  drop the database. `squash-migrations.sh` already says not to run it once real data exists. This
  plan records that the alpha is when real data exists.

### T4 — the keys and the list of testers, once, off the machine (recommended)

**The copy of live's `.env`.** After live's first bring-up has given it its values (0132 T1b to
T1d), and before the first tester connects, copy `~/.persistent/ownpace-live/.env` once to a
place off the machine that only the owner can open. Live never had the demo-era values (0132 T5),
so nothing has to be replaced first. It must be an encrypted file, and not in the repository, a
CI secret, a chat or a mail (D5). Keep it apart from any database dump (T5), so that no single
thing lost or stolen is both the data and its key. The OTA stack's `.env` is not part of this
task: nothing in it protects a tester's data (D6).

- Refresh the copy whenever a value in live's `.env` changes, and write the date of each copy in
  the Status block. `ZITADEL_PAT_EXPIRY` is the exception: `setup-zitadel.sh` moves it at every
  rotation of the provisioning token (§1), and a restore empties it anyway (T3).
- To check that the copy still matches without printing either file, decrypt it to a temporary
  file and compare the two with the `ZITADEL_PAT_EXPIRY` line left out of both (`grep -v`, then
  `cmp -s`). It answers same or different, and the temporary file is removed afterwards.

**The list of testers.** Keep each tester's name, address and the date they were let in off the
machine too. The access queue that holds this is in the database a lost machine takes with it,
and T2's *"we will tell you by email"* depends on it. It is personal data the owner holds for the
alpha, so 0139's conditions and privacy text name it.

**What it costs.** Minutes, once, then a refresh when `.env` changes. What it prevents is T3's
second case.

### T5 — backups of both databases, drilled (parked)

**Trigger:** before the first paying customer, or when the alpha ends, whichever comes first.
Whether growing beyond D2's bounds also fires it is open question 5.

**The design, for when it fires.**

- **A script with the verbs `trigger-version.sh` already has.** `deploy/compose/app-db-backup.sh`
  offers `backup`, `backups`, `drill` and `restore … --yes`.
  - It dumps `openmigrate` and `zitadel` from the stack's `postgres` service with
    `pg_dump --format=custom`, and the cluster roles with `pg_dumpall --roles-only`. It reaches
    the service through the stack's project name (0132 T1), never a fixed `ownpace-db`, so run
    from `~/ownpace-live` it dumps live. Without the roles, a restore dies on the first `GRANT`
    (`selfhost-quickstart.md`).
  - It verifies each dump the way `trigger-version.sh` verifies its own.
- **Encrypted before it leaves the machine**, to a public key whose private half is not on the
  machine. A stolen machine then cannot read its own backups.
- **Copied off the machine**, to storage in the EU that the owner chooses. This plan names none.
- **One retention number.** The script prunes by `BACKUP_RETENTION_DAYS`, so the pruning and the
  erasure sentence cannot disagree. The owner's 7 (0085 T5) comes back then. The Trigger.dev dumps
  follow the same number, or their own is argued in the task.
- **A schedule.** It runs daily on live from 0132 T7's timer (`box-duties.sh`, run from
  `~/ownpace-live`).
- **A dump before each migrating deploy.** It becomes a required step (step 4) of 0132 T6's
  procedure for deploying live from a tag.
- **A drill in the managed gate**, beside the Trigger.dev one: dump, restore into throwaway
  databases, compare per-table row counts and the roles. It is modelled on `trigger-version.sh
  drill` and `selfhost-backup-restore.e2e.test.ts`. This meets the architecture's *"Backup/restore
  drill (managed DB)"*. The gate proves the script on the OTA stack on every run. Live's own dumps
  are proven by the same drill on 0132 T7's timer, which that plan's guard
  (`a-duty-the-gate-used-to-do`) then requires, because it is a step the gate does to its stack.
- **A stated RPO and RTO.** The RPO is at most one day with a daily schedule. The RTO is what the
  drill measures, plus a bring-up. Both go in the runbook, and the retention goes in the privacy
  text's §9 table.
- **A one-page procedure for a machine that is gone**, using T4's copy, rehearsed once.

**Guards, when built.**

- `scripts/a-backup-of-every-database-the-stack-uses.unit.test.ts`: every database a service in
  `managed.yml` uses on `postgres` is named in the script, and the roles dump is present. Today
  those databases are `POSTGRES_DB` and `ZITADEL_DATABASE_POSTGRES_DATABASE`. The guard fails
  while the script does not exist, and later whenever a service adds a database the script does
  not dump.
- Tests of every refusal that fires before the first `docker` call, and of the structural
  promises (the drill never names a live database in a `DROP`, `restore` cannot run without
  `--yes`, the gate or timer runs the drill), in the pattern of
  `scripts/trigger-version.unit.test.ts`, which deliberately stubs no Docker.

## 4. Order

T0 goes with live's first bring-up (0132 T1b): it takes minutes, and live then never quotes
backups it does not make. Then T1's wording and start-up check, in one PR, and T1's check of the
Trigger.dev store. T2 goes to
0139 with the rest of the alpha conditions, before the lawyer's pass. T3 is one PR: the runbook
section, the ADR amendment with its regenerated `OPERATIVE.md`, and the one code change, the
refusal sentence in `migrate.ts`. T4 comes after live's first bring-up (0132 T1b to T1d) and
before the first invitation. T5 waits for its trigger.

## Not in this plan

- The procedure that deploys live from a tag, and whether it includes a dump: 0132 T6 and 0146,
  and open question 1 here.
- The timer that does the gate's duties for live: 0132 T7.
- Replacing the demo-era secrets: 0132 T5, closed for live, which starts with values of its own.
  T4's copy is taken after live's first bring-up.
- The alpha conditions, and the privacy text's wording on the key and on the list of testers:
  0139.
- What the end of the alpha does to organisations and identities: 0131 T4.
- Rotating `SECRET_ENCRYPTION_KEY` without stranding credentials (`SECURITY.md`: *"no
  rotation"*). Not planned.
- Being told that the machine is down: W12, now 0142.

## Open questions

1. **A dump before each deploy (0132 open question 4).** (a) None. This is D1 read literally:
   the erasure sentence says no backups, and that is exactly true. A migration file that fails
   rolls back by itself, and a deploy that brings one file leaves the previous build able to run
   (§1). A deploy that brings several files and fails in a later one leaves no build that starts
   until a fix goes forward. A migration that succeeds and damages rows leaves testers where a
   lost machine does, which T2 already tells them. *Recommended for the alpha.* (b) A dump of
   live's two databases before each deploy of live (0132 T6, step 4), kept on the machine until
   the next deploy succeeds and never
   longer than N days. `BACKUP_RETENTION_DAYS` is then N, and T2 gains one sentence: *a copy made
   before an update is kept at most N days, only to undo a failed update*. It is a reasonable
   choice. The one rule is that the number follows the dump.
2. **T4: take the copy of `.env` and the list of testers off the machine?** Recommended: yes,
   both, before the first invitation. Where they are kept is the owner's choice, within T4's
   rules.
3. **The dumps of live's Trigger.dev store during the alpha.** Keep them, as the orchestration
   plane's rollback aid, if T1's check finds no tester data in the store? Or stop them for the
   alpha? Keeping them is recommended, because that store is what *"cannot be rebuilt
   unattended"*. 0132 T7 runs the drill on live's plane for as long as this answer keeps them. If
   T1's check does find tester data, `BACKUP_RETENTION_DAYS` must cover how long they live. The
   gate never runs on live (0132 T1g), so until 0132 T7's timer runs, a dump of live's store lives
   until someone runs the script against live seven more times. With a daily drill it lives about
   seven days. The OTA stack's dumps hold no tester's data (D6).
   *2026-09-27: T1's check found tester data* (the Status block): run errors, discovery's output
   and, probably, the run logs, kept in `triggerdb` with no limit. Three ways to make the sentence
   true again:
   - **(a) Keep it out of Trigger.dev.** A failed run's error, discovery's output and the run's
     logs carry a reference and a category, and the full text goes to `app_event` (a month) and
     the container output (a month), as the Test button's answer already does (0136 T3). Then the
     dumps hold nothing of a tester's, keeping them stays harmless, and `0` stays true.
     *Recommended.* It is a change to the worker and orchestration, M's to build.
     **Answered 2026-09-27: (a)**, *"1a"*. **Built 2026-09-28** (the Status block), with one
     departure: a task's words last as long as its container, which is open question 6.
   - **(b) Stop dumping live's `triggerdb` for the alpha**, and say in the privacy text that
     Trigger.dev keeps a run's error text until the alpha ends and the stack is reset.
   - **(c) Prune by age.** Dumps kept at most N days, with `BACKUP_RETENTION_DAYS` = N, and a job
     that deletes Trigger.dev's run history older than a month. It writes into upstream's schema,
     which changes between Trigger.dev versions.
4. **T1's start-up check.** A warning in production and fatal on an alpha stack, as proposed? Or
   a warning only? *(2026-09-27: still owed. T1 (b) builds the proposal, on its branch.)*
5. **An alpha that outgrows D2.** More than 20 people, or a charge, is no longer the alpha D1 was
   answered for. Should that fire T5's trigger as well? Recommended: yes.
6. **A task's words after its run (2026-09-28).** Open question 3's (a) is built, with the words a
   task writes going to its container's output. The supervisor removes a task's container when
   its run ends, so those words last as long as the run, not a month. Choose between:
   - **(a) Enough for the alpha.** The application's own records keep what a person acts on: a
     pass's run log and status, discovery's row, a verification run, an apply receipt, a cutover's
     ledger. The log page keeps every failure's reference and category for a month. The erasure
     reaches all of these, and nothing else keeps a tester's words. *Recommended.*
   - **(b) A month on the host.** Docker's `journald` log driver, set in the daemon's own
     configuration on the reference machine, with a month's retention. It keeps a removed
     container's output, the API's included. It is the owner's machine setting, and a second place
     that holds testers' words, which the erasure does not reach.
