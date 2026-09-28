# Workplan 0143 — A box with a known size

> **In one line:** Sizing the reference machine for the alpha's two stacks: Trigger.dev machine presets, a pass cap in `managed-sync-tick`, per-organisation limits, streamed files to `JmapFileTarget`, a largest-file refusal, plane retention and a measured load rehearsal.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28, late: T1 step 2 built, every task names its machine (0131 §6, group M4, step 6)** on
branch `claude/mailbox-sync-errors-c2xsw2-every-task-names-its-machine`, not merged.

- **What the kill left of the question.** The owner's first Dropbox pass on the fixed build (0150,
  Status) peaked at 307 MiB of 512 on `small-1x`, copying a 409 MB file, and sat at 120 to 160 MiB
  while it was not copying. So `small-1x`, chosen in open question 7, holds a file pass with about
  200 MiB to spare. Mail's worst case (§3: four bodies held whole) is not measured; T9 measures it.
- **Built.** `trigger.config.ts` names `small-1x` as every task's machine, and `run-delta-sync`
  and `run-discovery` name it again, each beside what it was measured at. Nothing changes on the
  plane, which gave every task `small-1x` already. What changes is that it is chosen, where the
  plane reads it, and a change to it is a change to the caps' arithmetic.
- **Proved** by `apps/worker/src/jobs/a-machine-every-task-names.unit.test.ts` (3 cases), which
  fails on today's code. The SDK's own types refuse a preset that does not exist.
- **Left of T1:** the plane's limit, back with the owner (open question 9).

**2026-09-28, night: the Dropbox kill code read (0150 T1).** The owner's Dropbox passes were killed
for memory (SIGKILL on `small-1x`) while copying. The cause was a defect, not the preset: Node's
`fetch` held every uploaded file above 8 MB whole. It is fixed in 0150's branch
`claude/mailbox-sync-errors-c2xsw2-an-upload-that-kept-every-byte`, and after it three 256 MiB
files peaked at 195 MiB. So the kill says nothing against `small-1x` (open question 7), and step 2
and the plane's limit no longer wait on it. Verification's checksum read of a sampled file had the
same shape, and streams too since the branch
`claude/mailbox-sync-errors-c2xsw2-a-checksum-that-downloaded-the-whole-file` (0150's Status).

**2026-09-28, afternoon: T1 step 3's tick half merged in #1296 (`67b3e9e`), and live's number
set.** Asked to put live's number in live's `.env`, the owner answered: *"i added
'MAX_PASSES_IN_FLIGHT=6'"*. The tick reads it once live runs a build with #1296, whose bring-up
uploads it to the task environment (`deploy-live.sh` runs `bootstrap-managed.sh`, which runs
`set-task-env.sh`). The OTA stack's `.env` leaves it blank, for 3. Step 2 and the plane's limit
still wait for the kill code of the owner's Dropbox passes (0150, open question 1).

**2026-09-28, midday: T1 step 3's tick half built (0131 §6, group M4, step 6)** on branch
`claude/mailbox-sync-errors-c2xsw2-a-tick-that-knows-the-box-size`, not merged.

- **The cap, in the tick.** After phase 2, `managed-sync-tick.ts` counts the copying passes in
  flight (`PASSES_IN_FLIGHT_SQL`: open run rows of `BILLABLE_RUN_KINDS`, younger than
  `STALE_RUN_AFTER_MS`), on the stack and per organisation. `withinCapacity` then takes the
  eligible migrations longest-waiting first, one that never ran first and the id breaking a tie,
  while the stack and the organisation both have room. The rest are `heldForCapacity` in the
  summary, beside `heldBack` and the new `inFlight`, and one line gives their count.
- **The numbers.** `MAX_PASSES_IN_FLIGHT`, blank for 3, which is the OTA stack's; live's `.env`
  sets 6 (open question 7). `MAX_PASSES_PER_ORGANISATION`, blank for 2 (open question 1).
  `set-task-env.sh` uploads both. `managed.env.example` gives the formula for live, from the
  memory both stacks may use (open question 8). A value that is not a whole number of at least 1
  stops the tick, naming it, and the incident runbook's row for scheduled syncs says so.
- **What the count cannot see.** A pass the plane has not started has no run row. The next tick
  usually picks the same migration again, and that second pass waits on the migration's own
  queue. A migration that waited longer can start beside it, so the last minute's passes that
  have not started can pass the cap. The plane's limit is the backstop (below).
- **The rehearsal says so.** `rehearse-capacity.sh --seed` no longer says the tick starts every
  migration within the minute. It names the two caps it reads from the stack's `.env`, and
  `docs/performance.md` says the sitting sets them to the numbers it measures (T9).
- **Proved** by `apps/worker/src/jobs/a-tick-that-knows-the-box-size.unit.test.ts`, 17 cases, 16
  of which fail on the tick before this. They cover:
  - §3's two cases;
  - the order, a tie, a full stack, and an organisation's own choices;
  - the count, executed on the ledger's schema in PGlite;
  - the defaults and the refusals;
  - the tick read as text: it counts, chooses after phase 2 from every eligible migration, and
    enqueues only what it chose.

  27 of 27 mutations killed.
- **What is left of T1:** step 2, the explicit preset, and the plane's environment limit, which
  open question 7 set at 6 and 3. That limit counts every run, the tick's own and a cutover
  waiting on its final sync among them, and the docker supervisor keeps a waiting run's slot
  (step 1). At exactly the tick's cap, a stack full of passes would hold back the tick itself. So
  the limit goes back to the owner, proposed a little above the cap. Both wait for the kill code
  of the owner's Dropbox passes (0150, open question 1): if the kill is the memory, the pass
  preset grows, and the numbers with it.

**2026-09-28, late morning: open questions 7 and 8 answered, and what holds the machine's memory.**

- **Open question 7:** *"yes, as proposed"*. Every task stays on `small-1x`. Live's `prod`
  environment runs at most 6 at once and the OTA stack's at most 3, each set in its own
  `triggerdb` and read back on every bring-up. T1 steps 2 and 3 build it.
- **What holds the memory, read by the owner on the machine:**
  - No process holds much of it. The largest hold under 1 GB each: Trigger.dev's webapp and the
    Docker daemon about 0.7 GB, ClickHouse 0.4 GB, MinIO 0.2 GB.
  - `/proc/meminfo`: 121.7 GB in all, 3.1 GB available. Anonymous memory is 5.1 GB, the page cache
    1.8 GB, the kernel's slab 2.4 GB and shared memory 0.5 GB. There are no huge pages.
  - One GPU process, not part of either stack, holds 106 GiB (108,933 MiB). The reference
    machine's GPU shares its main memory, so that is where the 110 GB is.
- **So the stacks had about 15 GB, and the machine was swapping.** At the caps above, with live
  beside the OTA stack, they need about 18 GB:
  - two stacks' resident services of about 4 GB each;
  - 1.5 GB and 3 GB of passes;
  - about 2 GB for the appliance's nightly;
  - 20% headroom.
- **Open question 8, answered the same morning:** *"yes, stack needs 20GB, rest will only use
  100GB"*. The stacks get 20 GB, and the GPU process keeps to at most 100 GB, which is the owner's
  step before live. T1's formula starts from those 20 GB, not from the host's memory.
- **0150 found the owner's Dropbox passes killed before they end,** every one since 2026-09-25
  (0150, Status). If the kill is the memory, it is T1's preset that kills them.

**2026-09-28, morning: T0's machine reads, taken by the owner on the reference machine.**

- **A task's container:** `536870912 500000000`. So every task runs on `small-1x`, half a CPU and
  512 MB, enforced, as T1 step 1 read in the source. A sync tick's runner used 190 MB of its 512.
- **`triggerdb`:** eight environments, two projects' `prod`, `dev`, `stg` and `preview`, each with
  `maximumConcurrencyLimit` 300.
- **The host:** 121 GB of memory, 115 GB in use and 5 GB available; 15 GB of swap, 10 GB in use.
  The stacks' containers use about 4 GB of it (`docker stats`), so about 110 GB is held outside
  them.

So nothing bounds how many runs start at once but 300 per environment, 150 GB at 512 MB each, on
a machine with 5 GB to spare. Open question 7 proposes the cap and the preset.

**2026-09-28: T1 step 1, the half upstream's source answers (0131 §6, group M4, step 6's first
read).** Step 1 asks the plane five things before a preset is chosen. Four are answered by
Trigger.dev's source at the pinned v4.5.16, and by `@trigger.dev/platform` 1.3.0, the preset
table that version's webapp pins. Nothing was run against a stack. What only the machine can
say is at the end, with T0, which stays the owner's.

- **A preset's limits are enforced, and have been all along.** The self-hosted supervisor starts
  every task container with the run's preset as its limits: `NanoCpus` from its CPUs and
  `Memory` from its gigabytes (`apps/supervisor/src/workloadManager/docker.ts`), while
  `DOCKER_ENFORCE_MACHINE_PRESETS` is on. It is on by default (`env.ts`), and `managed.yml` does
  not set it. That is the name upstream's self-hosting guide gives, now checked against v4.5.16.
- **Every task runs on `small-1x` today: half a CPU and 512 MB.** No task names a machine, and
  neither does `trigger.config.ts`, so the plane gives each run its default preset
  (`machinePresetFromConfig`). The table, unless `MACHINE_PRESETS_OVERRIDE_PATH` replaces it, which
  `managed.yml` does not set:

  | Preset | CPUs | Memory |
  |---|---|---|
  | `micro` | 0.25 | 0.25 GB |
  | `small-1x`, the default | 0.5 | 0.5 GB |
  | `small-2x` | 1 | 1 GB |
  | `medium-1x` | 1 | 2 GB |
  | `medium-2x` | 2 | 4 GB |
  | `large-1x` | 4 | 8 GB |
  | `large-2x` | 8 | 16 GB |

  The runner hands V8 80% of that: `--max-old-space-size=410` on `small-1x`
  (`maxOldSpaceSizeForMachine`).
- **So a pass that outgrows its memory already fails alone,** inside its own container, and takes
  nothing from the database. That is what step 2 wanted from enforcement. The other side is that
  the preset step 2 chooses is a real limit: one that is too small fails passes rather than
  slowing them. The worst case §3 lists has to fit in it, and T9 measures what does.
- **The cap's formula can divide by the preset's memory**, as step 3 hoped, rather than by T9's
  observed peak, because the supervisor enforces it.
- **A run that waits on another keeps its container while it waits.** The docker supervisor has no
  checkpoints: its workload manager has none, and no `TRIGGER_CHECKPOINT_URL` is set. So a
  cutover's final sync holds two containers, the cutover's and its pass's, each at its own preset.
- **Nothing bounds how many run at once but the environment's limit.** A self-hosted plane gives
  a new environment its organisation's limit (`getDefaultEnvironmentConcurrencyLimit` without a
  billing client), and a new organisation `DEFAULT_ORG_EXECUTION_CONCURRENCY_LIMIT`, 300 by
  default. `managed.yml` sets neither. The supervisor takes runs as they come: its resource
  monitor is off by default (`RESOURCE_MONITOR_ENABLED`). The limit is a column,
  `"RuntimeEnvironment"."maximumConcurrencyLimit"` in `triggerdb`, so it can be read back and set.
- **What the machine answers, for T0:**
  - on a running task container,
    `docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'`, where
    `536870912 500000000` confirms the two findings above;
  - in `triggerdb`, `SELECT slug, "maximumConcurrencyLimit" FROM "RuntimeEnvironment";`;
  - the host's memory, `free -g`, and what both stacks use, `docker stats --no-stream`.

**2026-09-27, late: T5 (c) built (0131 §6, group M4, step 4)** on branch
`claude/mailbox-sync-errors-c2xsw2-a-domain-that-waits-its-turn`, merged as #1262. The owner chose (c)
the same evening (open question 3).

- **Small first.** `passOrder` (`packages/shared/src/pass-deadline.ts`) takes contacts, calendars
  and tasks before mail and files, whatever order the mapping or the caller listed them in. A
  type it does not know goes last, in the order it came.
- **A fair share of what is left.** `domainDeadline(passDeadline, now, typesLeft)` hands a type
  `now + (passDeadline − now) ÷ typesLeft`, this type included, and the last one whatever
  remains. The delta-sync task asks it before each type, so time a small type does not use flows
  to mail and files, which then share what is left, about half each. No type is handed a moment
  past the pass's own deadline.
- **In the pass.** `run-delta-sync.ts` sorts its data types with the first and hands each of the
  five branches its share from the second, the mail branch included. A type that stops at its
  share is logged as having stopped *at its share of this pass's time*. Its cursors stay where
  they are, as at the pass's deadline before.
- **Proved.**
  - `packages/shared/src/a-domain-that-waits-its-turn.unit.test.ts`, 7 cases: the order; a subset
    and an unknown type; the first of two handed no more than half; the last handed the pass's
    deadline; none past it, whenever asked; and five types in a 50-minute pass where the small
    three use four minutes, leaving mail 23 minutes and files the rest.
  - `apps/worker/src/jobs/every-data-type-gets-a-turn.unit.test.ts`, 4 cases, the task body read
    as text: it sorts with `passOrder`, asks `domainDeadline` once per type inside the loop, and
    hands every one of the five branches its share and none of them the whole pass.
- **The line for 0144** below, *"your calendars, contacts and files may not start until the
  mail's first copy is done"*, is no longer true once this merges.

**2026-09-27, late: T4 (a) built (0131 §6, group M4, step 2)**, merged as #1259. The owner answered
the two questions it raised the same evening.

- **The owner's answers, 2026-09-27.**
  - **The limit is 10 GB, not T0's provisional 2 GB:** *"I however want the limit higher then 2GB
    per file. Max it at 10 GB per file."*
  - **A category of its own, `too_large`:** *"yes 'too large' sounds good"*. §3 said
    `policy_refused`, whose remedy on the Failures page sends the reader to *Export format for
    Google files*, and whose count the export panel shows as format refusals: wrong for a video
    on OneDrive. Its remedy, EN and NL, is the one put to the owner: *"Not migrated: larger than
    this service copies during the alpha. Copy these files by hand, or leave them behind."*
- **What it does.** A managed file pass carries `largestFileBytes`, from `LARGEST_FILE_MB`
  (blank is 10240, 10 GB; `packages/orchestration/src/largest-file-setting.ts`), which
  `set-task-env.sh` uploads. In `runFileSync`'s `fetchRaw`, before `source.fetch`, a listed file
  above it is refused with §3's sentence (`fileTooLarge`, `packages/core/src/largest-file.ts`):
  *"<path> is 12.4 GB. During the alpha this service copies files up to 10 GB, because a larger
  file can take longer than one pass may run. Nothing was copied and nothing was changed; every
  other file continues. Copy this one by hand."* The error is a decision, parked on first sight,
  and states `too_large`. A value it cannot read stops the file pass, naming it. The appliance
  passes no limit.
  - An already-copied file that has not changed is skipped by the ledger before any fetch, so it
    is never refused. A changed one above the limit is.
  - A file whose listing carries no size is copied as before.
  - The API spec's four lists of categories name the tenth, and so do the vocabulary's own pins
    and the list of categories that need a person.
- **What 10 GB asks of the machine.** A pass stops taking new work at 50 minutes and is killed at
  60, so a 10 GB file needs about 25 to 30 Mbit/s, sustained from source to target. A slower one
  is killed with its pass and starts again on the next one, every pass, until T4's half after the
  alpha counts those attempts. T9 measures the rate.
- **Proved.**
  - `packages/core/src/a-file-no-pass-can-carry.unit.test.ts`, the real `runFileSync` over a fake
    source. A 12.4 GB file is refused with the sentence, and its download is never started. Every
    other file is copied, and the refused one is parked as a `too_large` decision. One byte over
    is refused, one byte under is copied, and with no limit nothing is refused. The two refusal
    cases fail on `main`.
  - `packages/orchestration/src/a-file-no-pass-can-carry.unit.test.ts`: the setting's default and
    refusals, the managed builder reading it, `set-task-env.sh` uploading it, and the appliance
    building its pass without it.
  - The web guards that every category reaches both screens in both languages pass with the
    tenth.
- **Where the limit is said.** The feature matrix, under Files. §3 also names the owner's grant
  step and 0144's known-limitations page; those are the owner's and 0144's.
- **Not in this change:** the attempts counted for a file under the limit that is still too slow
  (T4's half after the alpha). The ledger's column comments (migration 0051) still list the nine
  categories of their day.

**2026-09-27, late: T2a built (0131 §6, group M4, step 3)**, merged as #1258. The owner accepted
T0's provisional numbers the same day (open question 1), five migrations per organisation among
them.

- **Creating a migration is refused once the organisation has five that are not finished.**
  `POST /api/migrations` answers 409, `migration_cap`: *"This organisation has 5 migrations that
  are not finished, and may have 5 at once. Finish or delete one before you add another, or ask
  whoever runs this service for more."* Every status but `done` counts, a draft among them.
  Nothing is written for a refused one.
- **One create at a time per organisation.** The cap is held in the create's own transaction,
  under a per-organisation advisory lock taken before the count, as `live-link-limit.ts` holds
  the grant links. Two presses at once cannot both be the fifth.
- **The number is the deployment's:** `MAX_MIGRATIONS_PER_ORGANISATION`, blank for 5
  (`apps/api/src/routes/migrations/migration-cap.ts`). `managed.yml` passes it to the api and the
  env example documents it. A value that is not a whole number of at least 1 stops the api at
  start, naming it.
- **`maxMappings` and `maxUsers` left the generic organisation update.** Nothing read either.
  Values already stored stay inert. A cap on members belongs with 0131's open question 6 and 0137.
- **Proved.**
  - `apps/api/src/routes/migrations/a-migration-past-the-cap.unit.test.ts`, 8 cases through the
    real routes on PGlite:
    - the sixth is refused with the sentence, and nothing is written;
    - a finished one does not count, and a draft does;
    - another organisation's do not;
    - the setting moves the cap, and one it cannot read is refused;
    - the organisation update stores neither key.

    4 fail on `main`. The plan names it as an integration test; the routes are proved on PGlite,
    like the other route guards.
  - `a-migration-past-the-cap.integration.test.ts`: two creates at once with a cap of one, on a
    real Postgres with two connections. The second waits for the lock and is refused. It runs in
    CI's integration job.
  - Mutations: 12 of 14 killed. Two survive the unit guard, for stated reasons:
    - the lock removed: PGlite has one connection and cannot show a race; the integration test
      is written for it;
    - the organisation filter removed from the count: row security already scopes it to the
      caller's organisation, so the filter is a second fence and the mutant is equivalent.
- **Not in this change:** T2b and T2c, which §3 says could ride here, come as their own step, and
  T2d's built hold comes after.

**2026-09-27, evening: the owner answered open questions 1 and 3.**

- **Open question 1, T0's provisional numbers: accepted for now**, *"accept proposals for now"*:
  - 2 passes in flight per organisation (`MAX_PASSES_PER_ORGANISATION`, T1);
  - 5 migrations per organisation (T2a);
  - a 2 GB largest file (T4), which the owner raised to 10 GB later the same evening (T4's
    entry above);
  - invitations in waves of about five (§4).

  The overall cap (`MAX_PASSES_IN_FLIGHT`) still comes from T1's formula, read on the machine.
  T9 replaces all of them.
- **Open question 3, T5's rule: (c)**, *"5c"*: the small data types first, then a fair share of
  what is left. M4's step 4 builds it.

**2026-09-27: T2d's runbook step written (0131 §6, group M4, step 8, with 0142 T6)**, merged as
#1252. Step 3 of `docs/incident-runbook.md` carries it, as §3 gives it:

- as the database owner on live's database, the organisation's migrations in a state that runs
  passes, listed with their id and status first, because the list is what puts each one back;
- then each moved by the lifecycle's table: an `active` one to `paused`, a `continuous` one to
  `cutover`, and never a `continuous` one to `paused`;
- the two limits: the tester can undo it, and the step goes around the route, row security and
  the status-change record, so the date and the organisation go in the incident's record.

0142 T6's guard asks `updateTransition` itself for the three moves, so a change to the table fails
there before the runbook tells anybody to do what the product refuses. T2d's built hold comes
after, as planned.

**2026-09-27: T3a built (0131 §6, group M4, step 1)**, merged as #1243. A file larger than
8 MB (`STREAM_FILES_LARGER_THAN_BYTES`) reaches a target as a stream, and `JmapFileTarget` cannot
write one. It said *"No content for …"*, which reads as an empty file. It now says, when it would
create the file and when it would rewrite it: *"<path> is 12.4 MB. A JMAP target cannot take a
file larger than 8 MB yet. Nothing was copied and nothing was changed; every other file continues.
A WebDAV target, such as Nextcloud, can take it."* (`tooLargeForJmapYet`). It never reads the
stream. A file with neither bytes nor a stream is still refused as having no content. The
feature matrix says the 8 MB, where it names JMAP files as a target.

- **Proved.** Three cases in `packages/connectors/src/jmap-file-target.unit.test.ts`, through the
  real target against a fake JMAP server: a new file and a rewrite each get the sentence, and
  nothing is uploaded or set; a file with neither still says *"No content for"*. The first two
  fail on `main`.
  - **Mutations:** 7, all killed: a new file, or a rewrite, still said to have no content; the
    sentence without the size, without a target that can take it, or naming the 256 MB memory
    ceiling as the limit; the stream read before the refusal; a file with neither refused as too
    large.
- **Not in this change:** T3b, the streamed upload. The refusal is not parked on first sight:
  like any failure it is retried, and parked after its attempts. T4 brings the category that
  parks at once.

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

**2026-09-27, build: T9's script built on branch
`claude/ownpace-public-readiness-y7orc6-a-rehearsal-that-cleans-up`, not merged** (0131 §6 R7,
step 10). The sitting is still the owner's, and nothing has been measured.

`deploy/compose/rehearse-capacity.sh` has three modes.

- **`--seed N M`** writes N organisations in one transaction, N and M from 1 to 99. Every id
  starts with `ca9a0000-0000-4000-8000-`, a family nothing else in the repository uses.
  - Each organisation gets a copy of demo tenant A's mail pair: the demo IMAP mailbox as the
    source, the demo Stalwart over JMAP as the target. When M is 2 or more it also gets demo
    tenant B's Nextcloud pair. The copies carry the demo's sealed credentials as they are, so the
    script needs no key.
  - It writes M migrations on `*/15 * * * *`. Odd ones are mail migrations, even ones file
    migrations. Each one writes under a folder of its own, `capacity-rehearsal-<tag>-oNN-mNN`. The
    tag is the UTC minute of the seed, or `REHEARSAL_TAG`.
  - A migration that never ran is due at once (`sync-due.ts`), so every first pass starts on the
    next tick.
  - It refuses when an earlier rehearsal is still there, and when the demo rows are missing (the
    refusal names `--with-demo`). It also refuses when its role is not a superuser.
- **`--sample [--count K]`** prints a line every 10 seconds. It also appends the line to
  `samples-<UTC time>.log` under `<persisted directory>/rehearsal/`. The persisted directory is
  `~/.persistent/<project>`, with the project Compose reports. The line holds:
  - the runner containers on the Docker daemon, both stacks', and each one's memory
    (`docker stats`). A runner whose memory `docker stats` cannot read (`-- / --`, for one that
    exits while it collects) is still counted, and written as `name:?`;
  - the host's available and total memory, the swap in use and the load (`/proc`);
  - PgBouncer's `SHOW POOLS`: the clients waiting, summed over the pools, and the longest wait,
    read by column name. It asks over `127.0.0.1` inside the PgBouncer container, as the
    service's own healthcheck in `managed.yml` does;
  - Postgres' `numbackends`, summed over the stack's Postgres server.

  A value it could not read is written as `?`, never as 0.
- **`--remove`** deletes every row whose organisation carries the prefix, then the organisations.
  That covers the seed's rows and everything the passes wrote under those organisations since. It
  reads the tables with a `tenant_id` from the schema, counts each one, checks that nothing is
  left, and does all of this in one transaction.
  - It takes two runs. The tick enqueues a pass without a run row, and the pass writes its row
    only when it starts, so no count of rows can see a queued pass. While any rehearsal migration
    is active, `--remove` pauses them all and removes nothing. A queued pass that starts after
    that finds its migration paused and stops before its first data type.
  - It removes nothing while a pass is running. A pass counts as running while its run row is
    younger than the tick's staleness window (2 hours). It also removes nothing while a pass
    started, or a migration was paused, within the last 5 minutes (`REMOVE_QUIET_MINUTES`),
    because the queue may not have drained. Each of these refusals says to run it again.
  - A `--remove` after everything is gone finds nothing and says so.

**Live's marker is named once.** `deploy/compose/stack-kind.sh` holds `STACK_KIND_KEY=STACK_KIND`,
`STACK_KIND_LIVE=production`, `STACK_KINDS_NOT_LIVE` (empty today) and two predicates. So 0132
T1g's working name, `STACK_KIND=production`, is now the name. Both predicates read the file with
`env_value`. Surrounding whitespace, quotes, an `export` and the case of the value make no
difference.

- `stack_is_live <env-file>` is true for exactly live's marker. It is for a check that must find
  the marker before it goes on: 0132 T6's `deploy-live.sh`.
- `stack_may_be_live <env-file>` is true for live's marker and for anything that could be a slip
  of it: any value not listed in `STACK_KINDS_NOT_LIVE`, and a line naming the key that
  `env_value` cannot read (indented, or with spaces around `=`). It is for refusals, which err
  towards live. A kind given to the OTA stack later goes in that list.

The script refuses in every mode, before any `docker` call, in three cases:

- the marker, or a slip of it, is in the `.env`;
- the marker, or a slip of it, is exported into the shell;
- the shell has a `COMPOSE_PROJECT_NAME` that the checkout's `.env` does not choose.

It passes that `.env` to Compose with `--env-file`, so a `COMPOSE_ENV_FILES` in the shell cannot
make Compose read another one. It refuses before any `exec` when the project `docker compose
config` reports is not the checkout's choice: the `.env`'s `COMPOSE_PROJECT_NAME`, else
`managed.yml`'s `name:`.

0132 T1g records that its gate refusal, T5's `--with-demo` refusal and T6's `deploy-live.sh` are
to source the same file. Live's `.env` has to carry the line from its first bring-up (0132 T1b,
step 2).

**The guard, and that it failed first.** `scripts/a-rehearsal-that-cleans-up.unit.test.ts` has 39
cases (21 at the build, 18 more from the review fixes below), with stubbed `docker` and `psql`.

- The `docker` stub runs `compose exec … sh -c` locally, so the script's own psql command line is
  what runs. It picks the project the way Compose does and logs it with every call.
- The `psql` stub runs the SQL on PGlite, with both migration chains applied and the demo rows in
  place. So seed-then-remove is checked against the real schema.
- The rows a pass writes (runs, events, items, a rate budget) are added by hand between the seed
  and the removal, with a row in `support_read`, which has no foreign key to `tenant`, and one in
  `access_request`, whose key refuses the delete. Afterwards no table with a `tenant_id` holds a
  rehearsal row, and the demo's rows are all still there.
- Other cases: the refusals before any `docker` call, the two-run removal, the second seed, the
  missing demo, `--seed 2 3` and `--seed 1 1` round trips, and every field of the sample line, with
  `?` when a value cannot be read.

On the unchanged code: 13 failed and 8 skipped, every case on `ENOENT`, because neither
`rehearse-capacity.sh` nor `stack-kind.sh` existed. Each of these mutations turns it red:

- the `.env` check removed;
- the marker compared with its case, or with its double quotes;
- the marker spelled out in the script;
- the shell's `COMPOSE_PROJECT_NAME` check removed;
- the organisations not deleted;
- the removal limited to the seed's four tables;
- no wait for a pass in flight;
- the staleness window moved off the tick's;
- the tick's default schedule instead of `*/15`;
- one folder per organisation;
- the unreadable pooler written as 0;
- every container counted as a task;
- `maxwait_us` ignored.

**2026-09-27, review fixes, same branch.** A review of the build found these, and one commit
fixes them all:

- **The removal came too early.** It removed as soon as no run row said `running`, but a queued
  pass has no row yet. It now takes two runs, as above.
- **`COMPOSE_ENV_FILES` got past every check.** Compose reads the files it names instead of the
  checkout's `.env`, including their `COMPOSE_PROJECT_NAME`. Now `--env-file` and the project
  check, as above. Checked with `docker compose config` (v5.1.1, no daemon needed):
  `COMPOSE_ENV_FILES` naming another `.env` changes the project, and `--env-file` wins over it.
- **The refusal did not err towards live**, though `stack-kind.sh` said it did. `STACK_KIND=prod`,
  `STACK_KIND='production '` and an indented line all passed. Now `stack_may_be_live`, as above.
- **One unreadable runner lost the whole task group.** A `-- / --` line made `tasks`,
  `task_mem_mib` and `task_mem_max_mib` all `?`, at the quarter-hour peaks T9 records.
- **`SHOW POOLS` asked `-h pgbouncer`**, which was unproved. Now `127.0.0.1`. That line tripped
  `scripts/the-check-postgres-never-made.unit.test.ts`, which refused every loopback `psql` that
  carries a password, because Postgres trusts the loopback. PgBouncer does not: pgbouncer.ini
  asks every connection for its password, and has no hba file. So that guard now accepts a
  loopback `psql` aimed at PgBouncer's own `listen_port`, and only there, with a case that checks
  the premise in pgbouncer.ini.
- **The guard tested text in two places.** It now imports `STALE_RUN_AFTER_MS` from the tick,
  and runs the default 10 s interval rather than reading it. Each PGlite case has its own
  120 s timeout, because the unit project falls back to vitest's 5 s.
- **The guard never reached a table where the sweep matters.** Every table it filled cascades
  from `tenant`, so the delete loop could go and nothing turned red. Now it also fills
  `support_read`, which has no foreign key to `tenant`, and `access_request`, whose key refuses
  the delete.
- **Paths no case ran:** a seed with M = 1 or an odd M, `numbackends` and the host fields as `?`,
  and a shell `COMPOSE_PROJECT_NAME` that matches the checkout's. Each has a case now.
- **Two sentences said more than the script does.** "Odd ones copy mail": a mail migration
  adopts. "A later seed never adopts an earlier seed's files": one with a reused `REHEARSAL_TAG`
  does. Both are corrected here, and the tag's help in the script says so.

On the script before these fixes, 18 of the 39 cases failed: every one that the fixes above are
about. The ones that passed on it cover what it already did right, such as a matching
`COMPOSE_PROJECT_NAME`, `numbackends` and the host as `?`, and the default interval. Each of
these mutations turns the guard red:

- `--env-file` dropped;
- the project check dropped;
- the file or the shell refusal back on the exact marker;
- either whitespace trim in `stack_kind_clean` dropped;
- the unreadable-line check dropped;
- a code line spelling `production`, or reading `$STACK_KIND` directly;
- a shell `COMPOSE_PROJECT_NAME` refused even when the checkout chooses the same;
- one unreadable runner making the group `?`;
- `-h pgbouncer`;
- `numbackends` or the host fields written as 0;
- the pause-first step dropped, the quiet window dropped, or its pause half dropped;
- the delete loop dropped (the organisations' cascade then leaves `support_read`'s row, and
  `access_request` refuses);
- even migrations as mail, or M = 1 asking for the Nextcloud pair;
- the default interval moved off 10 s, and the staleness window moved off the tick's.

**Departures from §3.**

1. **A mail migration adopts; it does not copy.** The JMAP target adopts a message found anywhere
   in the account by its Message-ID (`targetKeys` in `jmap-target.ts`, ADR-0020). Demo tenant A
   has already filed the demo mailbox's messages in that account. So the folder prefix keeps each
   file migration a first copy, but not a mail migration. A rehearsal mail migration is still a
   real pass: a container, an IMAP listing and the target's enumeration. But it adopts. The mail
   load that counts is step 3's large mailbox. §3's sentence is corrected below.
2. **`--remove` takes back rows, not copies.** The copies the passes wrote into the demo target
   accounts stay, and the removal names their folders. The Trigger.dev plane's records of the
   runs stay too (T7). Each seed's folders carry its tag, so a later seed with another tag does
   not adopt an earlier seed's files. A reused `REHEARSAL_TAG` does, and the script's help says
   so. The owner's large drive and mailbox (step 3) are not the script's.
3. **No member rows.** Nothing in a pass reads one, and the daily digest mails members.
4. **Task containers are counted on the whole daemon**, as the containers whose names start with
   `runner-` (the ones `smoke-managed.sh` watches). So the count is both stacks'. It is the
   machine that is measured.

**Not checked, because it needs the machine.** The script has never run against a real stack. Its
first real run is the sitting. The guard checks the script against stubs, and two things are
unproved until then:

- the exact `docker stats` output;
- the `SHOW POOLS` columns of the pinned PgBouncer.

**Open, and whose.**

- The sitting and T0's numbers: the owner's.
- 0132 T1g's, T5's and T6's checks sourcing `stack-kind.sh`: those tasks' builds. The gate's and
  T5's refusals use `stack_may_be_live`; T6's `deploy-live.sh` uses `stack_is_live`.
- A pass the plane holds in its queue for longer than the 5-minute quiet window can still start
  after the removal. It fails on its first write, because its organisation is gone, and writes
  nothing to the database, but the plane records a failed run. The sitting will show whether the
  window is long enough: the owner's.
- Taking back the copies in the demo targets: not built. It is the owner's call whether it matters
  on the demo stack.
- Real first copies of mail, for example with a JMAP target account per organisation: open, if
  the sitting shows the mail passes matter beside step 3's mailbox.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's numbers | 📋 **Provisional numbers accepted 2026-09-27** (open question 1): 2 passes per organisation, 5 migrations, waves of about five, and the largest file 10 GB, which the owner raised from 2 GB the same evening (T4); ✅ **the overall cap decided 2026-09-28**: `small-1x`, live 6, the OTA stack 3 (open question 7), and 20 GB for the stacks beside a GPU process held to 100 GB (open question 8); ⏳ **Owner**: that GPU process held to 100 GB before live — *was:* ⏳ **Owner** for the overall cap on the machine, the machine reads taken 2026-09-28 (open question 7) | §3. **Alpha minimum.** Five provisional numbers before T9, and final ones after it. They are written in this block. |
| T1 Every task names its machine, and the tick knows the box's size | 📋 **Proposed** (D1, D2, D6); step 1 read in upstream's source 2026-09-28: presets are enforced, and every task runs on `small-1x`, half a CPU and 512 MB; step 3's tick half ✅ **done** in #1296, merged 2026-09-28 (`67b3e9e`): 3 passes at once on a stack unless its `.env` says otherwise, and 2 per organisation, longest-waiting first; live's `.env` sets 6 since 2026-09-28 (the owner); step 2 🔨 **built 2026-09-28** on its branch: every task names `small-1x`; the plane's limit ⏳ **Owner** (open question 9) | §3. **Alpha minimum.** An explicit preset for the tasks that copy or list, a check on whether its memory is enforced, a cap on passes in flight overall and per organisation, set for each stack, and the host's memory in the bring-up. |
| T2 What one organisation can make the machine do | 🔨 **T2a built 2026-09-27**, merged as #1258: five unfinished migrations per organisation, the deployment's number; **T2d's runbook step written 2026-09-27**, merged as #1252, in 0142 T6's runbook; T2b, T2c and T2d's built hold 📋 **Proposed** — *was:* 📋 **Proposed** (D1, D3) | §3. **T2a** (a cap on migrations per organisation) and **T2d's runbook step** are **alpha minimum**. **T2b** (a minimum schedule interval) and **T2c** (`throttleConfig` is the operator's) come after, and are cheap enough to ride in T2a's PR. T2d's runbook step goes into 0142 T6's runbook. **T2d's built hold** comes after. |
| T3 A streamed file reaches a JMAP target | 🔨 **T3a built 2026-09-27**, merged as #1243: the refusal names the file, its size and WebDAV; T3b 📋 **Proposed** — *was:* 📋 **Proposed** | §3. **T3a**, the refusal that tells the truth, is **alpha minimum**. **T3b**, the streamed upload, comes after. Until T3b lands, the owner points a tester who wants files on JMAP at WebDAV, as 0141 T8 already says. |
| T4 A file no pass can carry is refused up front, with a sentence | 🔨 **(a) built 2026-09-27**, merged as #1259: 10 GB, the owner's number, and a category of its own, `too_large`; the attempts after the alpha 📋 **Proposed** — *was:* 📋 **Proposed** (D1) | §3. **Alpha minimum.** A stated largest file, refused before a byte moves, and parked for a person rather than retried. The kill loop for smaller files that are still too slow comes after. |
| T5 Every data type of a migration gets a turn in a pass | ✅ **done** in #1262, merged 2026-09-27: (c), small first, then a fair share of what is left — *was:* 📋 **Decided 2026-09-27: (c)** (open question 3) | §3. After the first invitation. It has to be built **before a tester with a large Microsoft 365 mailbox and more than mail ticked** is granted. Small data types go first, and each type gets a fair share of what is left. |
| T6 Runs of organisations that are never invoiced | 🅿️ **Parked (trigger: the alpha runs past the 60-day run window, or its organisations carry on after it)** | §3. Nothing an alpha of a few weeks writes is old enough to prune, even with the rule changed. |
| T7 What the task plane keeps, and for how long | 📋 **Proposed** | §3. After the first invitation, sooner if T9's runway is short. Registry clean-up on both planes, task-event and run-record retention, host image and build-cache pruning, and the ClickHouse volume the OTA stack left behind. |
| T8 `pg_stat_statements` on | 📋 **Proposed** | §3. Before T9 if it is ready. Not a condition of the first invitation. Utility statements are not tracked, so a password change is never recorded. |
| T9 One measured rehearsal of the alpha's shape | ✅ **The script done** in #1235, merged 2026-09-27 — *was:* 📋 Proposed. ⏳ **Owner** (the sitting) | §3. **Alpha minimum.** Twenty organisations × M migrations against the demo servers, on the OTA stack with live standing beside it, plus one large drive and one large mailbox of the owner's own. Memory, containers, pool waits, statements and disk are recorded for the whole machine. The numbers set T0's final values and the invite ceiling. |
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
  route did not write a schedule, so the cadence was fixed at creation. Since 2026-09-28 the
  migration page changes it (0125 T8), through the update route, which accepts what create
  accepts.
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

  *(Built 2026-09-28, see the Status block. The formula starts from the memory both stacks may
  use, 20 GB, rather than the host's (open question 8), and step 1 found the preset enforced.)*

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
(b) puts all eight API enqueue sites through one function, `enqueueUnlessHeld` (2026-09-27), so
the operator hold covers them. After the alpha, the same function can refuse *Sync now* for an
organisation at its cap, with a sentence.

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
  due migration. *(Built 2026-09-28: 17 cases, 16 of which fail on the tick before it. See the
  Status block.)*
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
  minutes, the wizard's fastest cadence. The sentence names the floor. Since 0125 T8 the update
  route writes a schedule too, and both doors refuse through one function,
  `refuseUnreadableSchedule` in `apps/api/src/routes/migrations/index.ts`: the floor goes there,
  and holds on both.
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
(Later the same day the owner kept it, labelled experimental: 0148 D10.)

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
  one does a real first copy. *(2026-09-27, found in the build: true of the file migrations only.
  The JMAP target adopts a message found anywhere in the account by its Message-ID, and demo
  tenant A has filed the demo mailbox's messages there already, so a mail migration adopts. See
  the Status block.)*
- `--sample` appends one line every 10 seconds to a file under the persisted directory:
  - each task container's memory;
  - the number of task containers;
  - the host's available memory, swap and load;
  - PgBouncer's `SHOW POOLS` (`cl_waiting`, `maxwait`);
  - Postgres' `numbackends`.
- `--remove` takes back everything `--seed` made and counts what it removed, the way
  `seed-demo-dav-content.sh --remove <tag>` takes back one `--fresh <tag>` set. *(As built,
  2026-09-27: every row of the rehearsal's organisations, the passes' rows included, in two runs:
  the first pauses the rehearsal's migrations, and a later one removes once no pass is running and
  the queue has been quiet for 5 minutes. The copies in the demo targets stay, and it names their
  folders.)*
- It refuses a `.env` that carries live's marker (0132 T1g: `STACK_KIND=production`, named once in
  `deploy/compose/stack-kind.sh` since 2026-09-27), as 0132 T5's refusal of `--with-demo` does.
  Rehearsal organisations never reach the stack testers use. *(As built, 2026-09-27: it refuses
  anything that could be a slip of the marker as well, and names its `.env` to Compose with
  `--env-file`. See the Status block.)*
- **Guard:** `scripts/a-rehearsal-that-cleans-up.unit.test.ts` drives it with a stubbed `docker`
  and `psql`. Every id `--seed` creates is one `--remove` deletes, the sample line has the fields
  above, and a `.env` with live's marker is refused before anything is written. It failed while
  there was no script, and passes with it (2026-09-27, Status block).

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
   formula on the machine. Are these acceptable until T9 replaces them? **Answered 2026-09-27:
   yes, for now**, *"accept proposals for now"*.
2. **T3 for the first invitation.** (a) T3a only, with JMAP files pointed at WebDAV, which is
   recommended and keeps the minimum small. (b) T3b before the first invitation, if the owner
   expects the first testers to want their files on a JMAP target.
3. **T5's rule.** (c), small first and then a fair share, is recommended. Or (a) rotation, or (b)
   least progressed first. **Answered 2026-09-27: (c)**, *"5c"*.
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
7. **The overall cap and the tasks' preset (T0, T1 steps 2 and 3), 2026-09-28.** The machine
   reads are in the Status block. *Recommended:*
   - every task stays on `small-1x`: a tick used 190 MB of its 512;
   - live's `prod` environment runs at most 6 at once, about 3 GB, and the OTA stack's at most 3,
     about 1.5 GB, each set in its own `triggerdb` and read back on every bring-up;
   - before live, what holds the machine's other 110 GB is known, since live adds a second stack
     of about the same size.

   Or other numbers. *Answered 2026-09-28: "yes, as proposed". What holds the 110 GB was read the
   same morning: one GPU process (Status, and open question 8).*
8. **The GPU process and the stacks (T0, T1 step 3), 2026-09-28.** One GPU process, not part of
   either stack, holds 106 of the machine's 121 GB, and the machine is swapping. At open question
   7's caps the two stacks need about 18 GB with headroom. How much may that process keep once
   live runs? *Recommended:* at most about 100 GB, so the stacks keep about 20 GB. *Answered
   2026-09-28: "yes, stack needs 20GB, rest will only use 100GB".*
9. **The plane's limit, a little above the tick's cap (T1 step 3's plane half), 2026-09-28.** Open
   question 7 set each environment's limit at the tick's cap, 6 on live and 3 on the OTA stack.
   The limit counts every run, and the docker supervisor keeps a waiting run's slot (T1 step 1):
   the tick itself, a cutover waiting on its final sync, a count, a verification. At exactly the
   cap, a stack full of passes holds back the tick and everything else. *Recommended:* the cap
   plus two, 8 on live and 5 on the OTA stack: one for the tick, one for a cutover waiting on its
   pass. At most 1 GB more on each stack, when both extra slots are held at once, which open
   question 8's 20 GB still covers. Set in each stack's `triggerdb` and read back on every
   bring-up, as open question 7 said. Or other numbers.
