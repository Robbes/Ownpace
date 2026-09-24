# Workplan 0143 — A box with a known size

> **In one line:** Sizing the reference machine for the alpha's two stacks: Trigger.dev machine presets, a pass cap in `managed-sync-tick`, per-organisation limits, streamed files to `JmapFileTarget`, a largest-file refusal, plane retention and a measured load rehearsal.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
nobody knows how much the reference machine can carry. No task says which machine it needs, and
nothing caps how many passes run at once. No organisation has a limit it cannot raise itself, and
the managed stack has never been measured under load. A few failure modes only show at a
tester's scale: a streamed file into a JMAP target, one very large file, and one very large
mailbox. The owner answered the questions that set the size of the alpha: at most 20 people, for
a few weeks, on the reference machine, with CI staying on it (§2). The owner then chose to have
this plan written: *"W11 write, W12 write, W13 write, W14 write, W15 explaoin, W16 write, W17
write, W18 explain, W19 write"*. 0131 §5 calls it W13.

The plan sizes the machine for that alpha, and does not hope. It names the numbers (T0) and gives
every task a stated machine and the tick a cap (T1). It limits what one organisation can make the
machine do (T2). It fixes the JMAP file target (T3) and refuses a file no pass can carry (T4). It
lets every data type of a migration have a turn (T5), and it deals with what grows on the disk
(T6, T7). T8 turns on the statistics the rehearsal needs. T9 is one measured rehearsal of the
alpha's shape on the reference machine, and T10 covers the quotas every tester shares at the
providers.

**The minimum before the first invitation is T0, T1, T2a with T2d's runbook step, T3a, T4 and
T9** (§4). The rest follows the first invitation, and one of them, T5, comes due before a
particular kind of tester is let in.

Nothing is built. Four neighbouring fixes were drafted in the consistency PR, #1137, which
merged on 2026-09-24:

- a manual *Sync now* and a final pass carry the mapping's `concurrencyKey`;
- `ThrottleLimiter`'s header stops advertising a global concurrency cap it does not have;
- the pooler's comment in `managed.yml` gives the pool sizes a managed pass really opens;
- `docs/performance.md` says which levers the code has already pulled.

Each was checked at `main` after the merge, and each is named where it comes up.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers use a second compose project, `ownpace-live`, at the production names, beside
the OTA stack (`ownpace-managed`), which stays the nightly gate's target and the demo (0131 D3,
0132 D7). Each stack has its own Trigger.dev plane (0132 T1c). So this plan sizes both stacks on
the one machine (D6, §1). T1's caps are set for each stack, and its formula subtracts the other
stack. T9 runs on the OTA stack, which has the demo servers that live never gets, with live
standing beside it. T2d's runbook step is carried by 0142 T6. Checked again at the same time:
T2d's step now stops a `continuous` migration by the lifecycle's own move rather than by
`paused`, which the lifecycle refuses after a cutover (§3). T1's preset now names the tasks that
copy or list. And the multi-connection `PgRateBudget` test that §1 called missing exists (0083).

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's numbers | ⏳ **Owner** | §3. **Alpha minimum.** Five provisional numbers before T9, and final ones after it. They are written in this block. |
| T1 Every task names its machine, and the tick knows the box's size | 📋 **Proposed** (D1, D2, D6) | §3. **Alpha minimum.** An explicit preset for the tasks that copy or list, a check on whether its memory is enforced, a cap on passes in flight overall and per organisation, set for each stack, and the host's memory in the bring-up. |
| T2 What one organisation can make the machine do | 📋 **Proposed** (D1, D3) | §3. **T2a** (a cap on migrations per organisation) and **T2d's runbook step** are **alpha minimum**. **T2b** (a minimum schedule interval) and **T2c** (`throttleConfig` is the operator's) come after, and are cheap enough to ride in T2a's PR. T2d's runbook step goes into 0142 T6's runbook. **T2d's built hold** comes after. |
| T3 A streamed file reaches a JMAP target | 📋 **Proposed** | §3. **T3a**, the refusal that tells the truth, is **alpha minimum**. **T3b**, the streamed upload, comes after. Until T3b lands, the owner points a tester who wants files on JMAP at WebDAV, as 0141 T8 already says. |
| T4 A file no pass can carry is refused up front, with a sentence | 📋 **Proposed** (D1) | §3. **Alpha minimum.** A stated largest file, refused before a byte moves, and parked for a person rather than retried. The kill loop for smaller files that are still too slow comes after. |
| T5 Every data type of a migration gets a turn in a pass | 📋 **Proposed** | §3. After the first invitation. It has to be built **before a tester with a large Microsoft 365 mailbox and more than mail ticked** is granted. Small data types go first, and each type gets a fair share of what is left. |
| T6 Runs of organisations that are never invoiced | 🅿️ **Parked (trigger: the alpha runs past the 60-day run window, or its organisations carry on after it)** | §3. Nothing an alpha of a few weeks writes is old enough to prune, even with the rule changed. |
| T7 What the task plane keeps, and for how long | 📋 **Proposed** | §3. After the first invitation, sooner if T9's runway is short. Registry clean-up on both planes, task-event and run-record retention, host image and build-cache pruning, and the ClickHouse volume the OTA stack left behind. |
| T8 `pg_stat_statements` on | 📋 **Proposed** | §3. Before T9 if it is ready. Not a condition of the first invitation. Utility statements are not tracked, so a password change is never recorded. |
| T9 One measured rehearsal of the alpha's shape | 📋 **Proposed** (the script); ⏳ **Owner** (the sitting) | §3. **Alpha minimum.** Twenty organisations × M migrations against the demo servers, on the OTA stack with live standing beside it, plus one large drive and one large mailbox of the owner's own. Memory, containers, pool waits, statements and disk are recorded for the whole machine. The numbers set T0's final values and the invite ceiling. |
| T10 What the providers let every tester do together | 📋 **Proposed** | §3. After the first invitation. Graph mail joins the shared budget, and the Google Drive and Google DAV faces wait out a 429. 0141 hands this item to this plan. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24. Where a fact rests on the review
alone, or could not be checked from the repository, it says so.

### Two stacks on one machine, once 0132 T1 lands

- Today the reference machine runs one managed stack. `managed.yml` pins `name: ownpace-managed`
  and gives 17 services a fixed `container_name`, so a second project cannot start yet (0132 §1
  and T1).
- Under 0132 D7, `ownpace-live` comes up beside it with its own Postgres, identity provider, API
  and web app, and a Trigger.dev plane of its own (0132 T1b to T1d). 0132 T1c counts the cost: *"A
  second ClickHouse, Redis, MinIO, registry and supervisor on the machine. 0143 sizes both stacks
  together"*.
- The same machine goes on running three other loads:
  - the OTA stack, which the managed gate rebuilds from `main` with the demo every night
    (`e2e-managed.yml`, `cron: '30 3 * * *'`);
  - the appliance's nightly, which brings a full appliance stack up at 23:30 and 01:30 UTC
    (`e2e.yml`, on `[self-hosted, linux, arm64]`);
  - `ci.yml`'s and `security-scan.yml`'s jobs on a push to `main`, on the same self-hosted runner.
- The owner reports that the machine has the room (D6). Nothing in the repository measures it.

### No task says which machine it needs, and nothing enforces one

- `apps/worker/trigger.config.ts` sets `maxDuration: 3600` and retries, but no `machine`. No task
  under `apps/worker/src/jobs/` sets one either. 0120 says so in its own words: *"On managed no
  machine preset is set at all, which means Trigger.dev's smallest default."*
- What the default is, and how much memory a preset gets on a self-hosted plane, cannot be read
  from this repository. The installed SDK (`@trigger.dev/core` 4.5.16, the version `managed.yml`
  pins) is not consistent about it:
  - its preset list is headed *"// Default is small-1x"* (`dist/commonjs/v3/schemas/common.js`);
  - its type comments give a default of 0.5 vCPU and 1 GB;
  - its schema fallback for a run's machine is `{ name: "small-1x", cpu: 1, memory: 1 }`.

  The table that maps a preset to memory belongs to the plane, not to the SDK. The SDK sizes V8's
  heap to 80% of whatever memory the preset reports (`maxOldSpaceSizeForMachine`, overhead 0.2).
- The supervisor's environment in `managed.yml` (`trigger-supervisor`) sets no concurrency and no
  memory enforcement. No service in `managed.yml` has a memory or CPU limit. A search of
  `managed.yml` and `managed.env.example` for `CONCURRENCY`, `ENFORCE`, `mem_limit` or `cpus`
  finds nothing. So whether a task container is held to its preset's memory is unknown. If it is
  not, one pass that grows can take memory from Postgres, the identity provider and the API on the
  same host. The review could not check this either. It can only be seen on the machine
  (`docker inspect` of a running task container, T1).

### Nothing caps the number of passes

- `run-delta-sync` runs on `queue({ name: 'delta-sync', concurrencyLimit: 1 })`, and the comment
  above it says the limit is *"partitioned by `concurrencyKey: mappingId`"*. That is one pass per
  migration, and it is not a cap on the machine. The tick sets the key (`concurrencyKey: row.id`
  in `managed-sync-tick.ts`), and so do `/start` and the manual *Sync now* route, which is also
  the final pass before a cutover (`apps/api/src/routes/migrations/index.ts`). *Sync now* has set
  it since #1137 (merged 2026-09-24). `run-cutover.ts` passes `concurrencyKey: mappingId` to the
  final sync it starts. `run-discovery` has the same shape per migration.
- So the number of passes running at once is the number of migrations that are due. The tick's
  `ENQUEUE_CONCURRENCY = 8` limits how many enqueue calls it makes in parallel, not how many runs
  execute. The tick looks at what is already running only per migration (`running` in
  `ACTIVE_MAPPINGS_SQL`, counted as `skippedRunning`). It counts the total only while an operator
  hold is open, to report the drain.
- The tick decides that a migration is due from its newest run row's `started_at`
  (`ACTIVE_MAPPINGS_SQL`). A run row is opened when the pass starts (`run-delta-sync.ts`, *"Open
  the run-ledger row up front"*). A run that is waiting in the plane's queue therefore has no run
  row, and its migration is due again on the next tick. A cap enforced only by the plane would
  make the tick queue the same waiting migration again every minute. So the cap belongs in the
  tick (T1).
- `ACTIVE_MAPPINGS_SQL` has no `ORDER BY`. The order in which due migrations are enqueued is
  whatever Postgres returns.
- The architecture document states the intent and nothing enforces it:
  *"per-tenant workspace/namespace, secret scope, concurrency/rate budget"* (§16), and *"Per
  tenant a small concurrency (3-5 parallel mailbox syncs) suffices"* (§21).
- `ThrottleLimiter` paces requests inside one pass; it does not cap passes. Since #1137 (merged
  2026-09-24) its header in `packages/shared/src/throttling.ts` says so: *"Concurrency cap per
  limiter instance (one per pass/process — NOT service-wide; the shared, cross-process limit is the
  RateBudget)"*.

### What one pass holds in memory

- Items in flight per folder: `DEFAULT_CONCURRENCY = 4` (`packages/shared/src/concurrency.ts`).
- Mail bodies are held whole. `RawMessage.rfc822` is a `Uint8Array` (`packages/shared/src/mail.ts`),
  and nothing refuses a mail by size in `imapflow-source.ts`, `graph-mail-source.ts` or
  `jmap-target.ts`. A folder's listing is a materialised array (`listSince` in
  `packages/shared/src/ports.ts`). A search of `packages/` and `docs/` for a provider's largest
  message size finds none.
- Files above 8 MB stream on every file source since 0120 (`STREAM_FILES_LARGER_THAN_BYTES` in
  `packages/shared/src/file-body.ts`). The exception is a Google native document's export, which is
  never streamed. The buffered ceiling is 256 MB (`MAX_BUFFERED_FILE_BYTES`), which the same file
  describes as *"at most three copies of one item … across `concurrency` items"*.

### No organisation has a limit it cannot raise

- **Migrations.** `maxMappings` and `maxUsers` are in the tenant settings schema
  (`UpdateTenantSchema` in `apps/api/src/routes/tenants/index.ts`). The route that writes them is
  `requireRole('owner', 'admin')`, so the organisation sets its own limit. Nothing outside two
  unit tests reads either key, so neither limits anything.
- **Cadence.** The create route accepts any valid cron (`schedule: z.string().optional()`), and
  `describeCronScheduleProblem` (`packages/shared/src/cron-schedule.ts`) checks syntax only.
  `* * * * *` is accepted, and it asks for a pass (a container) every minute. The wizard offers
  four cadences, hourly, daily, six-hourly and every 15 minutes (`CreateMapping.tsx`), and sends
  `0 2 * * *` when none is picked. The tick's fallback for a migration without a schedule is every
  15 minutes, at a minute offset of its own (`defaultScheduleFor`, beside
  `DEFAULT_SYNC_SCHEDULE = '*/15 * * * *'` in `packages/orchestration/src/sync-due.ts`). The update
  route does not write a schedule, so the cadence is fixed at creation.
- **Throttle.** The create route accepts `throttleConfig: z.record(z.string(), z.unknown())` and
  stores it through `parseThrottleConfig` (`packages/shared/src/config.ts`), which checks only that
  each value is an integer (`reqInt`). Zero and negative values pass. The stored
  `requestsPerSecond` becomes the refill rate of the organisation's shared budget
  (`tenantThrottleLimiter` in `build-deps-from-mapping.ts`). `downloadBytesPerDay` replaces the
  Gmail ceiling in `imapDownloadPlan` (`packages/shared/src/rate-budget.ts`). A value above
  2 500 000 000 raises Gmail's ceiling, and a value of 0 or below makes `imapDownloadPlan` return
  no meter at all (`ceiling > 0` in the same function). That second effect was not in the review.
  It is deliberate for a server with no ceiling of its own: `byte-budget.unit.test.ts` asserts that
  a nonsense value reads as *"no meter, never as a zero ceiling"*, for another host. For
  `imap.gmail.com` it switches Gmail's own ceiling off as well, and no test covers that case. The
  web app never sends `throttleConfig`, so only a hand-made request can set it.
- **Stopping one organisation.** The operator hold (managed migration 0023, `platform_pause`) stops
  every organisation at once: the tick reads it (`readOpenPause`) and starts nothing. There is no
  hold for one organisation. The support routes have one write, the member-opened mark. An
  operator belongs to no organisation, so the operator cannot pause a tester's migration through
  the API either.
- **The public doors** are rate-limited (`createKnockLimiter`, used by `access-requests.ts` and
  `problem-reports.ts`). Signed-in routes are not. A connection test makes outbound probes with a
  26-second budget (`DOOR_BUDGET_MS` in `apps/api/src/routes/connections.ts`), and no limit per
  organisation applies to it.
- **The admission gate is the owner.** Every organisation is made by a grant in the access queue
  (0131 §1). The request form asks *"What are you moving?"* with the hint *"Roughly how many
  mailboxes, and from where"* (`access.note`, `access.noteHint`), and *"Which package looks
  right?"* (`access.tier`). Neither asks how many GB there are, or how large the largest file is.

### A streamed file never reaches a JMAP target

`JmapFileTarget` (`packages/connectors/src/jmap-file-target.ts`) reads `raw.content` and nothing
else:

- on create, when `raw.content` is absent, it throws *"No content for ${naturalKey}; refusing to
  create an empty node in its place."*;
- on update, the same, *"refusing to blank the node on the target"*;
- `uploadContent(content: Uint8Array, …)` posts one `Blob`.

Every file source hands a file above 8 MB over as a `body` and no `content`, a Google export
excepted (`packages/core/src/dav-sync.ts`, `fetchRaw`). The contract in
`packages/shared/src/file.ts` says a consumer that must handle both *"reads `content ?? body`, and
a target that cannot stream refuses above `MAX_BUFFERED_FILE_BYTES` rather than trying"*. So every file above 8 MB written to
a JMAP target fails, and the tester is told *"No content for …"*, which is not the reason. The
JMAP target carries files (`jmap: ['email', 'contact', 'file']` in
`packages/shared/src/target-domains.ts`), and AGENTS.md calls JMAP *"the primary target
protocol"*. 0120 names `jmap-file-target.ts` as one of the two file targets, and it moved only the
WebDAV writer. The WebDAV writer's `uploadStreamed` is the shape to follow: one request, a
streaming body, `Content-Length` from the body's size, and one hasher per attempt.

### One file can take longer than a pass may run

- A pass stops taking new work at 50 minutes (`PASS_SOFT_DEADLINE_MS`), and the runner kills it at
  60 (`PASS_HARD_LIMIT_MS`, tied to `maxDuration` by `a-pass-that-outlives-its-runner`). The
  deadline is checked before an item starts (`stopIfPastDeadline` in `domain-sync.ts`: *"the item
  in flight when the clock runs out is allowed to complete"*).
- No transfer can be aborted. A search for `AbortSignal` or `signal:` in
  `webdav-target-writer.ts`, `graph-drive-source.ts`, `google-drive-source.ts`,
  `dropbox-file-source.ts` and `box-file-source.ts` finds nothing. A body is *"Re-openable, not
  restartable"* (0120): every attempt starts at byte 0.
- A killed pass never closes its run row. `run-delta-sync.ts` says of its `finally`: *"It does
  NOT run when the process is killed outright, which is what a `maxDuration` kill or an OOM
  does."* The tick believes a `running` row for twice the hard limit, measured from
  the pass's start (`STALE_RUN_AFTER_MS`, and `started_at <=` in `ACTIVE_MAPPINGS_SQL`). So a
  migration is enqueued again about an hour after the kill.
- Failures are counted per item, up to `MAX_ITEM_ATTEMPTS = 5` (`packages/shared/src/ports.ts`). A
  killed pass records no failure, so a file that cannot finish inside one pass is attempted again
  on every pass, from byte 0. It never reaches the attempt ceiling, and every pass of its
  migration that reaches it ends in the runner's kill.
- Nothing states a largest file. The only large-file fixture is 32 MB (0120 T6), and
  `pass-deadline.ts` says of its own number: *"Nobody here has yet watched a real 100 GB copy
  against a slow target"*.
- A failure that will not change on retry has a shape already: `markNeedsDecision`
  (`packages/shared/src/needs-decision.ts`) parks an item *"on first sight: recorded with its
  reason, handed to a person, never retried automatically"*.

### One data type can hold a pass's whole budget

`run-delta-sync.ts` computes one deadline for the whole pass (*"shared by every domain — not per
domain"*) and runs the data types one after the other (`for (const domain of domains)`). A data
type handed a deadline that has already passed lists nothing (`domain-sync.ts`, *"a pass handed a
deadline that has already passed lists nothing either"*). The order is not chosen:
`enabledDomains` and `enabledDomainsForMappings` (`packages/orchestration/src/enabled-domains.ts`)
select from `scope_selection` with no `ORDER BY` and collect into a `Set`.

A Gmail mailbox stops early each day at its byte ceiling, and the pass moves on to the next data
type. A mail source with no daily ceiling does not stop early, and a Microsoft 365 mailbox is one.
The Graph mail source never calls the shared budget, only `handleRateLimited`
(`pg-rate-budget.ts`: *"the mail sources never call the shared budget at all"*). So a large first
copy of such a mailbox takes the whole 50 minutes of every pass. If mail comes first, the
tester's calendars, contacts and files do not start until the mail's first copy is done. A large
drive does the same to whatever comes after files. No comment or test records this.

### The Gmail meter, a planning fact for every Gmail tester

`GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY = 2_500_000_000` (`packages/shared/src/rate-budget.ts`). The
constant cites Google's own page, *"Downloaden via IMAP: 2500 MB" per day, per account*, and 0090
T1 verified it on 2026-08-26. The site's calculator uses the same figure (`GMAIL_IMAP_GB_PER_DAY =
2.5` in `site/calculator.mjs`), and the failure category `quota_exceeded` names it. At that rate
the first copy of a Gmail mailbox takes at least:

| Mailbox | Days of mail download, at least |
|---|---|
| 10 GB | 4 |
| 25 GB | 10 |
| 50 GB | 20 |
| 75 GB | 30 |

So in an alpha of a few weeks, a Gmail mailbox much above 50 GB does not finish its first copy.
The same ceiling bounds what a Gmail tester's mail costs the machine: 2.5 GB a day at most. A
Microsoft 365 mailbox has no such ceiling in this code, which makes it the heavier tester for the
machine.

### What grows on the disk

- The bring-up's host prerequisites give disk only: *"~15 GB free disk"*
  (`docs/managed-bring-up.md`, *Before you start*). They give no memory or CPU figure, and
  `bootstrap-managed.sh`'s preflight warns below 15 GB free. Container output goes to the journal
  for a month when that prerequisite is followed (0129 T3).
- `item` is never pruned, because it is the idempotency ledger (0082).
- **Run rows.** Managed retention prunes a tenant's runs only as far back as its newest issued
  invoice, and *"a tenant with none is skipped entirely, keeping all of its runs"*
  (`apps/worker/src/jobs/managed-retention.ts`). No route or job can issue an invoice today (0131
  §1: the invoice route answers `409 billing_model_retired`). So no run row is pruned for any
  organisation on managed. `run_event` (60 days) and `app_event` (30 days) are pruned regardless.
- **The task plane.** `managed.yml` sets no retention for the Trigger.dev database, ClickHouse's
  task events, MinIO's payloads or the task registry. The only retention setting it names is
  `BACKUP_RETENTION_DAYS`. Nothing in `deploy/` or `scripts/` garbage-collects the registry or
  prunes images. The tick alone is a Trigger.dev run every minute, so 1 440 run records a day on
  each plane before a single pass. Once live stands beside the OTA stack there are two planes.
  `clickhouse-disable-system-logs.xml` switches off ClickHouse's own log tables. `managed.yml`
  says the old `clickhouse_data` volume *"remains on disk until somebody deliberately removes
  it"*. That leftover is the OTA stack's; live starts on the current volume.
- **Two of everything.** The bring-up's *"~15 GB free disk"* is for one stack. Live adds its own
  images, database, ClickHouse, MinIO and registry (0132 T1c).
- The Trigger.dev database dumps of `trigger-version.sh drill` are bounded to the newest seven
  (`TRIGGER_BACKUP_KEEP`, default 7).
- 0099 records the cost of getting this wrong on the same machine: *"the second disk leak on that
  machine in two days"*.

### Nothing has been measured

- `docs/performance.md` has one measurement, the PGlite ledger bench (*"Real throughput is ~270
  items/s"*). Its lever list has been up to date since #1137 (merged 2026-09-24). It has no
  managed figure.
- 0082 names three missing measurements. The tick logging its own duration is done: the summary's
  `ms`, and the warning at 30 s in `managed-sync-tick.ts`. The multi-connection `PgRateBudget`
  test is done too: `packages/ledger/src/pg-rate-budget.integration.test.ts`, *"PgRateBudget under
  real concurrency"*, cites 0083 and 0082 T5. `pg_stat_statements` is still missing:
  `managed.yml`'s `postgres` service has no `command` and no `shared_preload_libraries`, and 0083
  lists it as not done.
- 0084 on the managed gate: *"Not a performance test. It proves the stack works, not that it is
  fast."* The only soak is the O365 24-hour option, which is dispatched by hand
  (`e2e-o365.yml`, `soak_test_24h`).
- The pooler: transaction mode, `default_pool_size = 25`, `reserve_pool_size = 5`,
  `max_client_conn = 500`, `query_wait_timeout = 120` (`deploy/compose/pgbouncer/pgbouncer.ini`).
  Since #1137 (merged 2026-09-24) the file's comment says the timeout is a wait for a connection,
  *"not a statement timeout"*. The pooler's reason in `managed.yml` now says a pass opens *"the
  job's own plus one per domain"* pool, so the ceiling without pooling is *"concurrent-passes times
  up to twenty"* connections.

### The providers' quotas are shared, and some faces do not wait out a 429

- Graph mail is not paced by the shared budget (above).
- `google-drive-source.ts` and `google-drive-transport.ts` contain no handling of `429`,
  `Retry-After` or `rateLimitExceeded`. The Tasks source does (0126 T5). The CalDAV and CardDAV
  sources, which serve Google's calendars and contacts, take a slot from the limiter before each
  request (`send` → `waitForSlot`), but a search for `429` in `caldav-source.ts` and
  `carddav-source.ts` finds nothing.
- Every Google tester's requests are spent against the deployment's one Google project.
  `packages/shared/src/rate-budget.ts` says the same of Microsoft's per-app quotas. Which
  Microsoft registration a tester consents to is 0140's subject.
- 0141 hands this group to this plan: *"Capacity, including Google's project quota shared by every
  tenant with no 429 backoff outside Tasks (0126 T5): 0143."*

## 2. The owner's decisions (2026-09-24)

Each gives the question in plain words and the answer as given, typos included. Where an answer
needed a reading, the reading is the one 0131 states, and it is repeated here.

**D1 — the size and length of the alpha.** *Is the test free or paid, for how many people, for
how long, and in which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the
test posture: *"Free. A few weeks. No obligations both sides."*

So the machine is sized for at most 20 organisations, each doing a first copy during a few weeks.
The first copy is the expensive part. The architecture document says so (*"The **real constraint
is the initial copy**"*, §21), and the Gmail table in §1 shows it.

**D2 — where it runs.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as "CI
stays".) On a tester stack separate from CI: *"Yes, but its a controlled rest. I Let people in and
support them. Max 10/20 people"* ("rest" is read as "test").

So the alpha runs on the reference machine, and CI stays on it. D6 later put testers on a second
stack beside the OTA stack, at the production names rather than the OTA address. The envelope has
to leave room for everything else the machine runs (§1): the OTA stack and its nightly gate, the
appliance's nightly twice a night (`e2e.yml`), and CI on a push to `main`. Live's passes get what
is left.

**D3 — the owner is the gate.** *What may a member and a viewer do, and should only owners and
admins invite?* — *"I am the gate for letting people in the test."*

So the admission cap needs no code: the owner grants. T9 gives the owner the number, and
granting in waves (§4) is the owner's lever as well. What code must add is what the gate cannot
see: what an organisation does once it is in (T2).

**D4 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. On the missing database backup: *"No obligations during
controlled test"*.

So the disk needs no room for a schedule of application-database dumps during the alpha. The one
dump 0132 T6 keeps across a deploy, if the owner wants a way back, is the exception. 0134 carries
the rest. What the rehearsal (T9) writes does not have to survive it.

**D5 — who runs what on the machine.** *If the current stack is reused, its demo secrets must be
rotated.* — *"Who would need/het credentials? I aupporrthe test. No one will be added to NetBird
network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".)

So the rehearsal is the owner's sitting, and the figures that count are the ones from the
reference machine. The rehearsal script must also run on any managed stack, so that a developer
can try a change to the caps on their own environment before the pull request.

**D6 — `ownpace-live` beside the OTA stack (0132 D7, which the sibling plans cite as 0132
D-new).** Later the same day the owner asked: *"check, can't i just (as a start) host a
'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain? What would i
need to do to keep alle seperate from each other?"* ("alle seperate" is read as "all separate".)
Asked whether to make that the decision, with testers on `ownpace-live`: *"Yes! The spark has a
lot free memory and disk, it will fit."*

So two managed stacks share the machine, each with its own Trigger.dev plane, and this plan sizes
both. "It will fit" is the owner's report. T9 is where it is measured, and T0's final numbers come
from that measurement.

## 3. What each task does

### T0 — the alpha's numbers (owner)

Five numbers, provisional before T9 and final after it, written in this block with the date:

1. **Passes in flight, overall** (`MAX_PASSES_IN_FLIGHT`, T1).
2. **Passes in flight, per organisation** (`MAX_PASSES_PER_ORGANISATION`, T1). The architecture
   document's 3–5 is for a mature service. For the alpha the proposal is 2.
3. **Migrations per organisation** (T2a). The proposal is 5: a family, or a small office's first
   few mailboxes.
4. **The largest file** (T4). The proposal is 2 GB until T9 has measured. At 1 MB/s that is about
   34 minutes, which starts at the beginning of a pass and finishes inside its 50.
5. **Invitations** (§4): how many at once, and in how many waves, up to D1's 20.

For the first number, the provisional value comes from the formula in T1. The owner reads the
machine's memory (`free -g`) and what both stacks already use (`docker stats --no-stream`) and
applies it. The first two numbers are live's. The OTA stack gets its own, small ones, because its
passes are the demo's and the gate's (T1). No figure about the machine goes into this repository
beyond what T9 records.

### T1 — every task names its machine, and the tick knows the box's size

**Step 1, read what the plane gives (on the machine, before choosing).**

- Log the machine a run was given. At the start of `run-delta-sync`, one line with the run
  context's `machine` (the SDK's `TaskRunContext` carries it). It stays in the code, so every
  run's log says what it had.
- Check whether a task container is held to that memory:
  `docker inspect --format '{{.HostConfig.Memory}}'` on a running task container. `0` means no
  limit.
- Read the self-hosted supervisor's settings at v4.5.16 for two things: enforcing a preset's
  memory on the containers it starts, and how many runs it takes at once. Upstream's self-hosting
  guide names `DOCKER_ENFORCE_MACHINE_PRESETS` for the first. That name was not checked against
  v4.5.16 here.
- Read whether the plane's environment concurrency limit can be set and read back on a
  self-hosted plane.
- Read whether a run that waits on another keeps its container while it waits. `run-cutover`
  starts the final sync with `runDeltaSync.triggerAndWait`, so a cutover may hold a container of
  its own beside the pass it waits for.

The answers are written in this block.

**Step 2, the preset.**

- `trigger.config.ts` gets an explicit default `machine`, so no task runs on a preset nobody chose.
- `run-delta-sync` gets its own, because it is the task that runs a copy pass: the tick's, *Sync
  now*'s, `/start`'s and a cutover's final sync alike. `run-discovery` gets one too, because it
  lists everything a migration holds. `run-cutover` itself copies nothing and waits for the pass
  it started, so the default serves it. The pass preset is the smallest whose memory covers the
  worst case, which is written beside it:
  - four mail bodies in flight, held whole;
  - a folder's listing;
  - buffered files up to 8 MB, three copies each, four at a time;
  - the runtime.

  T9 replaces the estimate with the measured peak, plus a margin that is stated too.
- If step 1 finds the supervisor can enforce the preset's memory, `managed.yml` sets that on
  `trigger-supervisor`. A pass that outgrows its memory then fails alone and loudly, instead of
  taking memory from the database. If it cannot, the bring-up says so, and T0's cap is computed
  from T9's observed peak rather than from the preset.

**Step 3, the cap, in the tick.** After phase 2 of `managed-sync-tick.ts`:

- The tick counts the copying runs in flight: `run` rows with `status = 'running'`, fresher than
  `STALE_RUN_AFTER_MS`, of the kinds in `BILLABLE_RUN_KINDS`. It counts them overall and per
  organisation. The hold path already runs a similar count, over every kind, to report the drain.
- It enqueues at most `MAX_PASSES_IN_FLIGHT − running` of the due migrations, and at most
  `MAX_PASSES_PER_ORGANISATION − running(organisation)` per organisation.
- Longest-waiting first: ordered by `last_started`, a migration that never ran first. With a cap
  in place, the order decides who waits, so it can no longer be whatever Postgres returns.
- The rest are counted in the summary as `heldForCapacity`, beside `heldBack` and
  `skippedRunning`. One log line names the count, not the migrations.
- Both numbers are task-environment settings, uploaded by `set-task-env.sh` like
  `LEDGER_RUN_RETENTION_DAYS`. Each stack uploads its own from its own checkout, because each has
  its own plane (0132 T1c). Each tick counts only its own stack's runs, so the two values together
  must fit the machine. `managed.env.example` gives the formula for live:

  > live's passes in flight = (host memory − both stacks' resident services − the OTA stack's
  > passes at its own cap − the appliance nightly's stack (`e2e.yml`) − 20% headroom) ÷ the pass
  > preset's memory, or ÷ T9's measured peak when the supervisor does not enforce the preset.

**Why the tick and not only the plane.** A run waiting in the plane's queue has no run row, so
the tick queues its migration again every minute (§1). If step 1 finds the plane's environment
limit can be set, it is set a little above `MAX_PASSES_IN_FLIGHT` as a backstop, to leave room for
the passes the tick does not start.

**What the tick does not start.** Eight enqueue sites in the API start tasks the tick does not
start: *Sync now*, `/start`, discovery, verification, cutover, confirmation, and the two apply
tasks. *Sync now* (with its key since #1137, merged 2026-09-24), `/start` and a cutover's final
sync are `run-delta-sync` passes. They open an `incremental` run row, so the count sees them
once they run, but the tick does not stop them from starting. They share the migration's
one-pass queue, so T2a's cap on migrations bounds them. Discovery has a one-per-migration queue
too. Verification, cutover, confirmation and the two apply tasks open no copying run row, so the
count does not see them. None has a queue of its own. Verification and confirmation join a run
already in progress instead of starting a second (*"Joined, not stacked"*, `operating-routes.ts`).
Each of the five starts from a request somebody makes. T9 records whether they matter. 0132 T6
proposes one function for all eight API enqueue sites so that the operator hold covers them. After
the alpha, the same function can refuse *Sync now* for an organisation at its cap, with a
sentence.

**The host, in the bring-up.** *Before you start* gains a memory and CPU line beside the disk
line. It gives the formula above, and T9's measured figure for both stacks' resident services.

**Guards.** Each of these fails on today's code:

- `scripts/a-machine-every-task-names.unit.test.ts`: `trigger.config.ts` sets `machine`, and
  `run-delta-sync.ts` and `run-discovery.ts` set their own. Each value is one of the SDK's
  `MachinePresetName` values. It fails today, because there is no `machine` anywhere.
- `apps/worker/src/jobs/a-tick-that-knows-the-box-size.unit.test.ts`. The choice is a pure
  function exported from the tick, `withinCapacity(due, running, caps)`, because the tick itself
  needs a database, a runner and a queue, which is why `a-drain-that-only-said-so` reads it as
  text. The test drives the function:
  - with a cap of 2 and one pass running, one of three due migrations is chosen, and it is the one
    that waited longest;
  - with 1 per organisation, a second migration of an organisation that already has a pass
    running is held back, and counted as `heldForCapacity`.

  A text check, in the manner of `a-drain-that-only-said-so`, confirms the tick enqueues only
  what the function chose. It fails today, because neither exists and the tick enqueues every
  due migration.
- If step 1 finds the enforcement setting, `scripts/a-supervisor-that-holds-its-runs.unit.test.ts`
  finds it in `trigger-supervisor`'s environment.

### T2 — what one organisation can make the machine do

**T2a, a cap on migrations (alpha minimum).**

- `POST /api/migrations` refuses to create a migration when the organisation already has
  `MAX_MIGRATIONS_PER_ORGANISATION` migrations that are not finished (status other than `done`).
  The answer is a 409 with a sentence the tester can act on: finish or delete one, or ask the
  owner.
- The number is one deployment setting passed to the API. A per-organisation override that only an
  operator can write comes later, if the alpha shows it is needed.
- `maxMappings` and `maxUsers` leave `UpdateTenantSchema`, so an owner can no longer store a limit
  that limits nothing. Values already stored stay inert, because nothing reads them. The case in
  `a-number-to-call.unit.test.ts` whose title says the generic update *"keeps its two keys"*
  changes with it. A cap on members belongs with 0131's open question 6 and 0137.
- **Guard:** `apps/api/src/routes/migrations/a-migration-past-the-cap.integration.test.ts`. The
  migration one past the cap is refused with the sentence, and a finished one does not count. An
  owner's `PUT /api/tenants/:id` with `settings.maxMappings` leaves `settings` without it. It fails
  today on both halves.

**T2b, a minimum schedule interval.**

- A shared helper, `shortestGapMinutes(expression)` in `packages/shared/src/cron-schedule.ts`,
  computes the shortest gap between runs over a week with croner, which the tick already uses.
- The managed create route refuses a schedule whose gap is under the floor. The floor is 15
  minutes, the wizard's fastest cadence. The sentence names the floor.
- The tick treats a stored schedule that is faster than the floor as the floor, so rows created
  before the check do not keep a pass a minute.
- The appliance is untouched. Its cadence is its owner's call on its owner's machine.
- **Guard:** the helper's unit test, and a route test. `* * * * *` and `*/5 * * * *` are refused,
  and `*/15 * * * *` and `0 2 * * *` are accepted. A stored `* * * * *` is due at most every 15
  minutes. It fails today.

**T2c, `throttleConfig` is the operator's.**

- On managed, a create body with `throttleConfig` is refused with a sentence: this setting is not
  the organisation's. The web app never sends it (§1), so no tester loses anything.
- For values already stored, `build-deps-from-mapping.ts` clamps `requestsPerSecond` and
  `maxConcurrent` to `DEFAULT_THROTTLE_CONFIG`'s values.
- `imapDownloadPlan`, the one place both editions decide the meter, changes for both editions. A
  configured value for `imap.gmail.com` can lower Gmail's ceiling, never raise it. A value of 0 or
  below gives the built-in ceiling instead of no meter. Raising Gmail's ceiling only gets the
  account locked, on either edition.
- **Guard:** in `byte-budget.unit.test.ts`, `imapDownloadPlan('imap.gmail.com', 10_000_000_000)`
  and `…, 0)` both give 2 500 000 000, and `…, 1_000_000_000)` gives 1 000 000 000. A route test
  refuses `throttleConfig` on managed. It fails today on the first two.

**T2d, stopping one organisation.**

- **For the first invitation, a runbook step (alpha minimum).** An entry in 0142 T6's incident
  runbook, on live's database. As the database owner, write down the id and status of each of one
  organisation's migrations in a state that runs passes (`PASS_RUNNING_STATES`: `active` and
  `continuous`). Then move each by the lifecycle's own table (`updateTransition` in
  `packages/shared/src/lifecycle.ts`):
  - an `active` migration to `paused`, the table's *"pause"*;
  - a `continuous` migration to `cutover`, the table's *"stop"*. Never to `paused`: the table
    refuses `continuous` → `paused`, because after a cutover *"the source is no longer the
    authority on what exists"* (0117 D4). From `paused`, a press of *Start* would make it
    `active` again and bring the deletion detector back.

  The list is what puts each one back as it was. A pass in flight stops before its next data
  type, because `run-delta-sync` re-reads the migration between data types (`mappingStillRuns`).
  The owner then writes to the tester, whom the owner supports anyway (D2). Two limits are stated
  with the step:
  - the tester can undo it: *Start* from `paused`, or entering the lane again from `cutover`;
  - the step bypasses the route, row security and the status-change record the route writes
    (0109 T1), so the entry says to note the date and the organisation in the same runbook.
- **The built hold, after.**
  - A managed migration adds an organisation hold with the same shape as `platform_pause`. An
    operator writes it (`WHERE EXISTS (platform_operator …)`), and a non-operator's write changes
    nothing and is answered 404.
  - The tick skips that organisation's migrations.
  - 0132 T6's single enqueue function refuses with the hold's sentence.
  - The organisation's members see the sentence where they see the platform hold.
- **Guard for the built hold:**
  `apps/worker/src/jobs/a-hold-on-one-organisation.integration.test.ts`, on the pattern of
  `a-pause-nobody-could-press`:
  - a held organisation's due migrations are not enqueued, and another organisation's are;
  - a member's write to the hold changes nothing.

  It fails today.

**Not in T2.** A limit on connection tests and OAuth starts per organisation (the 26-second probe
budget, §1) is 🅿️ **Parked (trigger: a door that lets in people the owner has not granted)**.
While every organisation is the owner's grant (D3), a tester who hammers the connection test is a
person the owner can write to. Where those probes may go is 0136's subject. The review also found
no cap on an archive's total bytes or member count (the zip reader caps its central directory
and each read at 256 MB, `zip-archive.ts`). That is not planned here: as the wizard offers it,
the archive card cannot work on managed at all (0131 §1 and T2), and 0148 T3 is to hide it there.

### T3 — a streamed file reaches a JMAP target

**T3a, the refusal tells the truth (alpha minimum).** When `raw.content` is absent and `raw.body`
is present, `JmapFileTarget` throws a sentence, not *"No content for …"*. The sentence names the
file, its size, and that a JMAP target cannot take files over 8 MB yet, and it says a WebDAV target
can. It is a few lines, and it makes the failure line tell the tester what to do. Until T3b lands,
the owner points a tester who wants files on JMAP at WebDAV when granting, as 0141 T8 already says.
0144 T2's known-limitations page says it once that page exists, which 0144 plans for after the
first invitation.

**T3b, the streamed upload.**

- `uploadContent` gains a streamed path shaped like `WebDAVTargetWriter.uploadStreamed`: the body
  opened per attempt, `Content-Length` from `body.sizeBytes`, and one request.
- Before uploading, the target reads the session's `maxSizeUpload`, a JMAP core capability. A file
  larger than it is refused up front, with a sentence that names the server's own limit, because
  the server would refuse it anyway. What the demo Stalwart advertises is read from its session,
  not assumed.
- **Guard:** `packages/connectors/src/a-jmap-file-nothing-holds.unit.test.ts`, on the pattern of
  0120's `a-dropbox-file-nothing-holds`. A 32 MB body from a stub source arrives at the fake
  upload endpoint byte for byte, with its length, and `content` is never materialised. A body over
  `maxSizeUpload` is refused before any request. It fails today with *"No content for"*.
- 0141 T8's nightly leg is what proves it against a real Stalwart.

### T4 — a file no pass can carry is refused up front, with a sentence

**The limit.**

- `LARGEST_FILE_MB`, a managed task-environment setting. `build-deps-from-mapping.ts` reads it and
  passes it into the file loop as `largestFileBytes`.
- The appliance passes none. It has no runner kill, so nothing is refused there.
- The value is T0's. The rule behind it is written beside the setting: the largest file must
  finish inside one pass's soft deadline at the slowest rate T9 measured, with a margin.

**The refusal.**

- In the file adapter's `fetchRaw` (`packages/core/src/dav-sync.ts`), before `source.fetch`: a
  listed file whose `size` is above the limit is refused. It is refused before a byte is read, so
  no download starts and no daily byte meter is spent on it.
- The error carries `markNeedsDecision` and the category `policy_refused`. That category is
  *"STATED by the code that refused"* (`packages/shared/src/failure-category.ts`), and its comment
  widens from the migration's own settings to *the migration's or this service's stated limits*.
  So the file is parked on first sight and not retried.
- The sentence, a draft for 0144 to match: *"<path> is 12.4 GB. During the alpha this service
  copies files up to 2 GB, because a larger file can take longer than one pass may run. Nothing
  was copied and nothing was changed; every other file continues. Copy this one by hand."*

**Where the limit is said.** Before anything happens, not only after:

- the owner's grant step (§4): the owner asks a tester moving files what their largest file is.
  Before the first invitation this is the only place, because 0144 plans its known-limitations
  page (T2) for after it;
- 0144 T2's known-limitations page, in Dutch first, once it exists. 0144 T1's short guide, section
  2 (*Voordat u begint*), is where the line fits sooner if the owner wants it written down.

**Guard:** `packages/core/src/a-file-no-pass-can-carry.unit.test.ts`.

- A listed file one byte over the limit is refused, and the fake source's `fetch` is never called.
  It lands as a decision with the sentence.
- One byte under is fetched.
- With no limit, nothing is refused, which is the appliance's case.

It fails today, because the loop fetches every file.

**After the alpha: the kill loop below the limit.** A file under the limit can still meet a slower
day than T9 measured. The loop counts an attempt when a transfer above the streaming threshold
starts, not only when it fails. A transfer the runner kills then still counts, and after
`MAX_ITEM_ATTEMPTS` the item is parked with the same sentence. Resumable transfer is the real
fix. 0120 says of a body that *"there is no resume-from-offset"*, and `webdav-target-writer.ts`
calls what is missing *"the resumable-upload work"*.

### T5 — every data type of a migration gets a turn in a pass

**The options.**

- **(a) Rotation:** the data type that hit the deadline last pass goes last. This needs state per
  pass, and one large data type still takes a whole pass when it is not last.
- **(b) Least progressed first.** This needs a measure of progress for each data type, and
  discovery counts are not always there.
- **(c) Small first, then a fair share of what is left.** *Recommended.*
  - Order the data types contact, calendar, task, email, file. The first three are bounded and
    usually finish in minutes.
  - Before each data type, hand it the deadline `now + (passDeadline − now) ÷ types left`. The
    last one gets whatever remains.
  - Time a small data type does not use flows to the ones after it. Every deadline is at or before
    the pass's own, so the comment's rule still holds: *"Five domains each given the whole budget
    is five times the budget"*.
  - A large mailbox and a large drive share what remains, about half each. It needs no state and
    it is deterministic.

**Where.** Two pure functions beside `pass-deadline.ts`, `passOrder(domains)` and
`domainDeadline(passDeadline, now, typesLeft)`. `run-delta-sync.ts` sorts `domains` with the first
and hands each data type the second, including the mail branch, which takes `deadline` today.

**Guard:** `packages/shared/src/a-domain-that-waits-its-turn.unit.test.ts` for both functions.
The first of two data types is handed a deadline no later than half-way, and no deadline passes
the pass's own. A text check in `apps/worker/src/jobs/`, as `a-drain-that-only-said-so` reads the
task body, confirms the loop uses them. It fails today, because every data type is handed the same
`deadline`.

**Until it is built,** the line for 0144 to publish is: *"With a large Microsoft 365 mailbox, your
calendars, contacts and files may not start until the mail's first copy is done."* 0144 T2 lists
it in its known-limitations page, which 0144 plans for after the first invitation. Before then,
the owner says it when granting (§4), and can also suggest that such a tester ticks mail alone
first.

### T6 — runs of organisations that are never invoiced (parked)

The run rule keeps every run of an organisation with no issued invoice, and none can be issued
(§1). The rule does not matter during the alpha. The run window is 60 days
(`DEFAULT_RUN_RETENTION_DAYS`), so nothing an alpha of a few weeks writes would be old enough to
prune even if the rule changed. T9 measures what the rows cost in the meantime. 0139 T6's
statement that *"run rows stay until the alpha ends or the organisation is erased"* stays true.
The OTA stack's demo tenants fall under the same rule, so their run rows are kept too, unless one
of them holds an invoice issued before the route was retired. That cannot be seen from here. T9's
row counts show what their runs cost the machine.

**When the trigger fires:** with the alpha setting on (0131 T1), managed retention prunes an
organisation with no issued invoice by the window alone. That is `safeUpTo: 'nothing-is-billed'`,
the appliance's answer in `apps/selfhost/src/index.ts`. The day billing returns, the setting is
off and today's rule applies. The observed tier's GB moved is read from `bytes_moved`
(`packages/managed/src/bytes-moved.ts`), not from run rows, so pruning does not change it.
**Guard:** `apps/worker/src/jobs/a-run-nobody-will-bill.unit.test.ts`. With the setting on, an
organisation without an invoice is pruned by the window. Without it, it is skipped, which is the
control.

### T7 — what the task plane keeps, and for how long

These are four stores and one leftover, each read at v4.5.16 before anything is set. Every store
exists once per plane, so on each stack.

- **The registry.**
  - `trigger-registry` gets `REGISTRY_STORAGE_DELETE_ENABLED=true`.
  - A script, `deploy/compose/registry-forget.sh`, deletes the manifests of task deployments
    older than the newest K, with K at least 2, so a run still on the previous version keeps its
    image. Which version a queued run takes when a new one is deployed is read at v4.5.16 with the
    rest.
  - It then runs `registry garbage-collect` with the registry stopped: on live inside 0132 T6's
    deploy window, and on the OTA stack outside the managed gate's hours.
  - **Guard:** `scripts/a-registry-that-forgets-old-tasks.unit.test.ts` drives it with a stubbed
    `docker` and `curl`. It keeps the newest K, deletes the rest, and refuses K below 2. It fails
    today, because there is no script.
- **Host images and build cache.** `docker image prune` and `docker builder prune` with an
  `until=` filter, in 0132 T7's daily duties. Not `docker system prune -a`, which
  `docs/TROUBLESHOOTING.md` gives for a full reset: this machine also runs CI (D2).
- **ClickHouse task events and MinIO payloads.** Read whether upstream's schema at v4.5.16 sets a
  TTL. If it does not, set one that matches 0139 T6's answer for how long task events may hold a
  tester's data. The same setting serves both plans.
- **Trigger.dev's own run records.** Each stack's tick adds 1 440 a day to its own plane. Read
  whether the v4.5.16 web app prunes old runs, and set it if it can.
- **The leftover, on the OTA stack.** Once `docker volume inspect` shows no container uses the old
  `clickhouse_data` volume, the owner removes it, as `managed.yml` describes (*"`docker volume rm
  ownpace-managed_clickhouse_data`"*).

0142 T3's daily summary is what shows whether any of this is needed sooner. Until it exists, T9
gives the growth per day and the runway (§4).

### T8 — `pg_stat_statements` on

- `managed.yml`'s `postgres` service gets a `command` with
  `shared_preload_libraries=pg_stat_statements` and `pg_stat_statements.track_utility=off`.
  Utility statements are not tracked, so an `ALTER ROLE … PASSWORD` (0132 T2) is never kept in the
  statistics view.
- The app phase of `bootstrap-managed.sh` runs `CREATE EXTENSION IF NOT EXISTS
  pg_stat_statements` as the database owner. It is idempotent.
- The operator runbook gains the one query for the ten statements with the most total time.
- The appliance and PGlite are untouched.
- Changing the command recreates the database container. On live it goes in with a hold and a
  drain (0132 T6). The OTA stack takes it with the gate's next redeploy from `main`.
- Before relying on it, `SELECT name FROM pg_available_extensions WHERE name =
  'pg_stat_statements'` on the machine confirms the image ships it.
- **Guard:** `scripts/a-database-that-counts-its-queries.unit.test.ts`. The `postgres` command
  preloads the library with utility tracking off, and the bring-up creates the extension. It fails
  today.

### T9 — one measured rehearsal of the alpha's shape (owner's sitting)

**The script.** `deploy/compose/rehearse-capacity.sh`, which runs on any managed stack except live
(D5).

- `--seed N M` creates N rehearsal organisations with fixed-prefix ids, as the demo seed does, each
  with M migrations on `*/15`. The sources are the demo IMAP mailbox and the demo Nextcloud's
  files (`seed-demo-dav-content.sh`). The targets are the demo Stalwart and Nextcloud. Each
  migration writes under its own `targetFolderPrefix`, so none adopts another's copies and every
  one does a real first copy.
- `--sample` appends one line every 10 seconds to a file under the persisted directory:
  - each task container's memory;
  - the number of task containers;
  - the host's available memory, swap and load;
  - PgBouncer's `SHOW POOLS` (`cl_waiting`, `maxwait`);
  - Postgres' `numbackends`.
- `--remove` takes back everything `--seed` made and counts what it removed, the way
  `seed-demo-dav-content.sh --remove <tag>` takes back one `--fresh <tag>` set.
- It refuses a `.env` that carries live's marker (0132 T1g, working name `STACK_KIND=production`),
  as 0132 T5's refusal of `--with-demo` does. Rehearsal organisations never reach the stack testers
  use.
- **Guard:** `scripts/a-rehearsal-that-cleans-up.unit.test.ts` drives it with a stubbed `docker`
  and `psql`. Every id `--seed` creates is one `--remove` deletes, the sample line has the fields
  above, and a `.env` with live's marker is refused before anything is written. It fails today,
  because there is no script.

**The sitting.** It happens on the reference machine, on the OTA stack, after 0132 T0's step 3
(live stood up), so that the machine carries both stacks while it is measured. The rehearsal needs
the demo servers, and only the OTA stack has them: live is brought up without `--with-demo` (0132
T1b).

1. The OTA stack runs a `main` that carries T1, T2a, T3a and T4, as the nightly gate deploys it,
   with T8 if it is ready. Live stands idle beside it, with its own caps uploaded.
2. Seed N = 20 organisations × M = T0's migration cap.
3. Add the two real loads, from the owner's own accounts (where they run is open question 4):
   - **one large drive** with a file just under T0's largest-file number and one just over it,
     to the demo Nextcloud;
   - **one large mailbox** that is not Gmail. A Gmail mailbox would measure the 2.5 GB meter, not
     the machine. It has calendars and contacts ticked as well, so T5's effect is visible.
4. Run for at least six hours, including one of the appliance nightly's runs (`e2e.yml`, 23:30
   or 01:30 UTC), because that is the machine live shares (D2). The sitting ends before the
   managed gate's 03:30 UTC run, which rebuilds the OTA stack, or that workflow is disabled for
   the night (open question 5).
5. Take back the seed. Afterwards, revoke the owner's own grants at Google and Microsoft. They were
   stored on the OTA stack, whose demo-era values 0132 T5 leaves in place (parked for that stack).

**What is recorded,** in this block, and as a *Measured: the managed stack* section in
`docs/performance.md`. It gives the machine's memory and core count and nothing that says where
the machine is.

- The machine each pass was given, and whether its container had a memory limit (T1 step 1).
- Each stack's resident services' memory, idle and under the load. Live's idle figure is the one
  T1's formula subtracts.
- Peak memory per pass container: mail and files, first copy and delta.
- The most task containers at once, and the lowest available host memory. Any OOM kill:
  `State.OOMKilled` on a container, or the kernel log.
- PgBouncer's largest `cl_waiting` and `maxwait`, and Postgres' most connections.
- The tick's largest `ms`.
- The time from due to started for a capped migration.
- The large file's rate. Whether the file under the limit finished inside one pass with a matching
  hash, and whether the file over it was refused with the sentence.
- The mailbox's items and bytes per pass, and when its calendars and contacts first started.
- Disk before and after: `docker system df -v`, `pg_database_size` for each stack's three
  databases (the application's, the identity provider's and Trigger.dev's), and row counts of
  `run`, `run_event` and `item`. From these, the growth per migration per day and the **runway**
  (free space ÷ growth per day).
- The ten statements with the most total time, with T8.
- Counts of `rate_limited` and `quota_exceeded` failures, for T10.

**Pass or fail.**

- No container was OOM-killed.
- Available host memory stayed above 15%.
- No two successive samples had `cl_waiting > 0`.
- The tick stayed under its own 30-second warning.
- The runway is at least twice the alpha's planned length.
- T4's two files behaved as stated.

If a line fails, T0's numbers come down and the rehearsal runs again. The owner may instead
invite fewer. The outcome sets T0's final numbers and `PASS_SOFT_DEADLINE_MS`, if the slowest item
says it must move. `pass-deadline.ts` asks for exactly that: *"read what its slowest item cost and
move this number to fit"*.

### T10 — what the providers let every tester do together

- **Graph mail joins the shared budget.** `graph-mail-source.ts` takes a slot from the
  organisation's `PgRateBudget` before each request, as the other Graph faces do, instead of only
  `handleRateLimited`. The comment in `pg-rate-budget.ts` that says it does not is updated with
  it. **Guard:** a unit test in which the mail source's requests draw from the budget. It fails
  today.
- **Google faces wait out a 429.** `google-drive-source.ts`, and the DAV sources when they serve
  Google, get what the Tasks source got in 0126 T5:
  - wait out a `429` or `503` (`Retry-After`, otherwise one second, once);
  - read Google's 403 `rateLimitExceeded` or `userRateLimitExceeded` as `rate_limited`, so a
    tester is never told to reconnect over a limit that clears by itself.

  **Guard:** the Drive source's unit test gains those cases. It fails today.
- **A budget for the whole deployment**, per provider application. This is decided from T9's and
  the alpha's counts of `rate_limited`, not before. 🅿️ **Parked (trigger: `rate_limited`
  failures, in T9 or during the alpha, that are not one tester's own)**.
- **Streaming mail bodies** (`docs/performance.md`, lever 6) is 🅿️ **Parked (trigger: T9 or the
  alpha shows a mail pass's peak memory near its preset)**.

## 4. The alpha: the minimum, and what comes after

**Before the first invitation: T0, T1, T2a with T2d's runbook step, T3a, T4 and T9.**

- **T0**, because every other task needs its numbers.
- **T1**, because without it nobody can say what 20 first copies at once do to the database on the
  same machine. Today the answer is "as many passes as are due, each with whatever memory it
  takes".
- **T2a**, because the wizard lets a tester create any number of migrations. T2b and T2c are only
  reachable by a hand-made request, and T1's per-organisation cap already bounds how many passes
  they can have running at once. **T2d's runbook step** is there because the only stop today
  stops everyone.
- **T3a**, because JMAP is the primary target, and today its failure line names the wrong reason.
- **T4**, because a file too large for one pass loops from byte 0 for ever, and every pass of its
  migration that reaches it ends in the runner's kill.
- **T9**, because every number above is a guess until it has run once on the machine that will
  carry it, with both stacks on it.

0131 T5's go/no-go table carries a row for this plan since the cross-plan review of 2026-09-24,
taken from the text below. The row:

- T1, T2a, T3a and T4 are on `ownpace-live`, and live's caps are uploaded;
- T9 passed with live standing beside the OTA stack, and its numbers and the runway are written
  in this block;
- T0's final numbers are set;
- T2d's step is in 0142 T6's runbook.

As with the other rows, the owner may instead accept a gap in writing, dated, with the reason.

**Granting, with the machine in mind (the owner's steps, D3).**

- **Invite in waves.** The first copy is the expensive part (D1). A wave of about five
  organisations goes first, and the next wave is granted when most of the first wave's first
  copies are through. That keeps the peak at a wave's first copies, not at 20 of them. The wave
  size is T0's fifth number.
- **Ask how large.** When granting, the owner asks what the request form does not: roughly how
  many GB of mail and files, and the largest file. That answer tells the owner three things:
  - with the Gmail table (§1), whether a Gmail mailbox's first copy fits in the alpha's weeks;
  - with T4's number, whether a file will be refused;
  - whether a large Microsoft 365 mailbox makes T5 due.
- **Point JMAP files at WebDAV** until T3b and 0141 T8 are done.

**After the first invitation, in this order:**

1. **T2b and T2c**, in T2a's PR if they cost nothing more, and otherwise straight after.
2. **T5**, before a tester with a large Microsoft 365 mailbox and more than mail ticked is
   granted.
3. **T3b**, then 0141 T8's nightly leg.
4. **T8**, before T9 if it is ready, and otherwise after it, so that the alpha's own weeks are
   recorded.
5. **T7**, sooner when T9's runway or 0142 T3's summary says so. Until 0142 T3 exists, the owner
   reads `df -h` and `docker system df` once a week, as 0142 §4 says.
6. **T10**, and **T2d's built hold**.
7. **T4's kill-loop half.**
8. **T6**, only when its trigger fires.

## Not in this plan

- **Being told when the disk fills, the queue stalls or the pooler waits:** 0142 T3 and T4. This
  plan sets what those alerts guard, and 0142 measures.
- **The deploy procedure, the hold over every API enqueue, and the daily duties:** 0132 T6 and T7.
  T1, T7 and T8 put steps in them.
- **Backups, and whether the Trigger.dev dumps are backups:** 0134.
- **How long task events and payloads may hold a tester's data:** 0139 T6. T7 sets the setting.
- **Where a tester's connection probes may go:** 0136.
- **Live proof of the sources and targets,** including JMAP files beyond our own Stalwart: 0141.
- **What testers are told:** the known-limitations lines above (the largest file, the Gmail days,
  JMAP files, the order of data types) are handed to 0144 to publish, and 0144 T2 lists them in
  the alpha part of its known-limitations page. The alpha conditions are 0139's.
- **A release name for the commit T9 measured:** 0146.
- **In-app guides that state these limits:** W15, now 0148. Its JMAP guide says that a file over
  8 MB does not reach a JMAP target yet, and leaves the limits themselves to this plan (0148 T4,
  *Not in this plan*).

## Open questions

1. **T0's provisional numbers.** The proposals are 2 passes per organisation, 5 migrations per
   organisation, a 2 GB largest file, and waves of about five. The overall cap comes from T1's
   formula on the machine. Are these acceptable until T9 replaces them?
2. **T3 for the first invitation.** (a) T3a only, with JMAP files pointed at WebDAV, which is
   recommended and keeps the minimum small. (b) T3b before the first invitation, if the owner
   expects the first testers to want their files on a JMAP target.
3. **T5's rule.** (c), small first and then a fair share, is recommended. Or (a) rotation, or (b)
   least progressed first.
4. **T9's large mailbox and drive.** Does the owner have a large mailbox that is not Gmail, for
   example a Microsoft 365 one, to put through the rehearsal? And where do those two loads run?
   (a) On the OTA stack with the rest of the sitting, storing the grants for a day under the
   demo-era values 0132 T5 leaves in place there, and revoking them after. (b) On live, from the
   owner's own organisation to the owner's own targets, where the grants are held under live's
   own keys. (b) keeps real grants off the demo stack, but it is a real migration of the owner's
   data rather than a rehearsal.
5. **T9's night.** The sitting runs on the OTA stack, which the managed gate rebuilds at 03:30 UTC.
   (a) End it before the gate's run. (b) Disable `e2e-managed.yml` for that night and enable it
   again after. (a) is recommended, because it leaves the gate alone.
6. **If T9 shows the machine carries fewer than 20.** Invite fewer, or keep 20 and make the waves
   smaller? Waves are recommended, because the load that matters is first copies at once, not
   organisations.
