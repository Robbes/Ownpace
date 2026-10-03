# Workplan 0150 — Dropbox native formats, and the downloads that will not hand themselves over

> **In one line:** Dropbox entries marked `is_downloadable: false` (Paper docs as `.paper` files, and any other kind T2 finds) refuse `files/download` with 409 `unsupported_file`; export each kind in the user's chosen format via `files/export`, or state a refusal and park it on first sight, as Drive does.

## Status — 2026-10-03 (update this block at the end of every session)

**2026-10-03: the demo Nextcloud's follow-up built, a fresh install on Postgres and a script for
one on SQLite** (the owner, 2026-09-29: *"You take that aswell"*), on branch
`claude/mailbox-sync-errors-c2xsw2-a-demo-nextcloud-on-postgres`, not merged.

- **A fresh install starts on Postgres.** `managed.yml` gives Nextcloud's first install
  `POSTGRES_*`: host `postgres`, database and role `nextcloud`, and `.env`'s
  `NEXTCLOUD_DB_PASSWORD`, which `ensure-env-secrets.sh` generates. It now waits for postgres to be
  healthy. The bring-up's `data` phase makes the role (a login, nothing more) and the database
  before the first start (`deploy/compose/nextcloud-db.sh`). After Nextcloud answers, it says which
  database Nextcloud uses.
- **A role an installed Nextcloud uses keeps its password.** That Nextcloud connects with the value
  in its own `config.php`, so the bring-up never sets one on it; it says when the two differ. Only
  when no Nextcloud is installed does an existing role take `.env`'s value. A database that still
  holds a gone install's tables stops the phase, with the command that drops it: an install into
  them retries for two minutes and stops at *"The Login is already being used"*.
- **`deploy/compose/nextcloud-to-postgres.sh`** has three modes:
  - `--check`, the default, changes nothing.
  - `--convert` moves an install still on SQLite, with both of 2026-09-29's workarounds. It stops
    Nextcloud first, so nothing writes to SQLite after the copy begins. It runs the converter in a
    one-off container without `--all-apps`, giving it the password on standard input from a file.
    It counts every table's rows on both sides, because Nextcloud 34's converter fails in its last
    step after the copy and before it switches `config.php`, so its exit code cannot tell a whole
    copy from half of one. It sets the counters with `nextcloud-counters.sql` (the morning's
    statement) and writes `config.php`'s five database settings in one `occ config:import`.
  - `--sync-password` makes `.env`'s value the one `config.php` and the role hold, `config.php`
    first. It repairs the morning's state first: the role changed before `config.php`.

  Both start Nextcloud again whatever happens. A failed step of `--convert` leaves it on SQLite as
  it was; a `--sync-password` that fails after writing `config.php` says so, and a second run sets
  only the role.
- **Proved in Docker, on Nextcloud 34.0.4 and Postgres 18, with invented data:**
  - A fresh stack through the real `data` phase: the role and the database made, and Nextcloud
    installed on Postgres. It made no role of its own, and the database is closed to PUBLIC.
  - A 34 install on SQLite, with accounts, files, an event, a contact, a preview, a disabled app
    with a table, and a small job id beside Nextcloud's own. The converter stopped at
    `oc_jobs_id_seq` (exit 7). 129 tables and 780 rows matched, 106 counters were set, and then
    files, an event, a contact and a preview were written with new ids.
  - A row Postgres refuses: the copy check stopped the move, `config.php` was put back, and
    Nextcloud answered on SQLite. The next run cleared the half copy and finished.
  - The morning's state: Nextcloud answering 500, then put right by `--sync-password`.
- **Guards:**
  - `scripts/a-demo-nextcloud-on-the-stacks-postgres.unit.test.ts`, 45 cases, with a docker
    stand-in. It runs the script as it is, and the bring-up's two functions as they are written.
  - `scripts/a-counter-no-default-names.unit.test.ts`, 13 cases: the counter statement on PGlite.
- **For the OTA stack, after the merge:** the next gate run generates `NEXTCLOUD_DB_PASSWORD`, and the
  bring-up notes that `config.php` holds another value. With the migrations paused,
  `./deploy/compose/nextcloud-to-postgres.sh --sync-password` makes them one.

**2026-09-29: a move that keeps its key is reported once, not twice (found while testing #1384).**
In the file domain `runDomainSync` runs both move detectors. The item loop saw an item listed in
another folder under the same key, and `classifyKnownItem` returned `'moved'`, so the loop recorded
and reported the move. Then the end-of-pass reconciliation (`detectPathKeyedMoves`) found the row
absent from its old folder. It read the move the loop had just recorded and reported it again, so
the result showed `moved: 2` with two identical entries. That doubled count reached the pass's
stats, the worker's "N item(s) are now in a different source" line and the pass's own `[sync]` warning. The
moves queue was never wrong: the ledger holds one row, and the second `recordMove` wrote the same
values. The issue first blamed the reconciliation's content-matching branch, but a probe
showed the second report came from its remembered-move branch. A key-preserving move creates
nothing, so the matching branch has nothing to match it with.

- **What changed.** The loop keeps the keys it classified `'moved'` this pass (`movedByTheLoop`),
  and the reconciliation leaves those rows alone. A move that changes the key (ADR-0030) never
  reaches the loop as the old row, so it is reported by the reconciliation once, as before. The
  comment saying a same-key arrival is impossible now gives the real reasons. Nothing touches the
  target: this only removes a second report.
- **Proved** by three cases in `packages/core/src/move-detection.unit.test.ts`, through the real
  `runDomainSync` with the memory stores:
  - a move that keeps its key is reported once on each pass it stays open, and once acknowledged,
    no longer reported;
  - a move that changes its key is reported once;
  - both kinds on one pass are reported once each.

  Two of the cases fail on `main` (`expected 2 to be 1`, `expected 3 to be 2`). #1384's guard in
  `copied-items-asked-a-window-at-a-time.unit.test.ts` now expects `moved: 1` and fails on
  `main` too.

**2026-09-29, morning: the OTA stack's Nextcloud moves from SQLite to Postgres (the owner's
decision).** The E2E (managed) gate went red on `main` twice, #222 and #223, and not because of any
merged change. The demo Nextcloud (service `nextcloud`) answered HTTP 500 when asked for a new
calendar object and for a DELETE. Its own log named the cause: *"SQLSTATE[HY000]: General error: 5
database is locked"*.

- **Why.** That Nextcloud keeps its database in SQLite (`SQLITE_DATABASE` in `managed.yml`), and
  the owner's own migrations write into the same Nextcloud: the Dropbox one alone since this
  plan's #1340, at 12 to 34 GB an hour. SQLite takes one writer at a time. Nextcloud 34 already
  runs it in WAL mode, so reads never wait. But a request that read first and then wants to write
  after another has written is refused at once, and Nextcloud writes a great deal for every file it
  stores:
  - the file's row;
  - every parent folder up to the root;
  - with no Redis configured, the file lock itself (`DBLockingProvider`).

  So the gate's writes and the migrations' writes collided. The migrations' own uploads meet the
  same refusal now and then; it is recorded as the target refusing the file and retried on the
  next pass.
- **Weighed.** Four ways were put to the owner:
  1. pausing the migrations for every gate run, which costs up to a pass of copying each time and
     leaves the migrations colliding with one another;
  2. Nextcloud's file locks in Redis, which means fewer collisions, not none;
  3. a Nextcloud of the gate's own;
  4. Postgres, which removes the cause.

  The owner chose Postgres: *"ok, we'll move to postgres."*
- **Done by hand on the OTA stack, the same morning**, while the migrations were paused and no
  gate run was active. `config.php` was copied first; that copy was the whole way back until the
  migrations resumed. Then a `nextcloud` role and database were made in the stack's Postgres, and
  Nextcloud's own converter was run, `occ db:convert-type` (Nextcloud 34,
  `core/Command/Db/ConvertType.php`). The converter holds the maintenance page while it copies,
  switches `config.php` only after its last step, and never changes the SQLite file. On this
  install it failed twice, and each failure left Nextcloud on SQLite:
  - **With `--all-apps`, before copying anything.** It builds tables for disabled apps as well,
    and the disabled LDAP app cannot load here (*"Could not resolve
    OCA\User_LDAP\ILDAPWrapper"*). It ran without it: tables for the enabled apps only.
  - **In its last step, after copying every table.** `PgSqlTools::resynchronizeDatabaseSequences`
    finds each id counter's table through the column whose default names that counter. It fails
    on the first counter no default names, which here was `oc_preview_locations_id_seq`: *"SELECT
    setval('oc_preview_locations_id_seq', (SELECT MAX() FROM ))"*. Nextcloud's newer-style
    (identity) columns have no such default either.

  So the last step was done by hand. Every counter was set from the column that owns it
  (`pg_depend`), counting only the ids within the counter's own range, one counter at a time.
  `oc_jobs` holds ids Nextcloud generates itself, beyond its counter's range, and that range check
  was the second attempt's fix. Then `config.php`'s database settings were set with
  `occ config:system:set`, `dbtype` last. **113 counters were set, none failed**, and Nextcloud
  answered on Postgres (`occ status`, `occ user:list`). The statement was proven beforehand on a
  local Postgres with the same five kinds of counter:
  - an ordinary one;
  - an identity column's;
  - the preview case;
  - generated ids beside old ones;
  - an empty table's.
- **Still open, and this session's** (built 2026-10-03, above; the owner, 2026-09-29: *"You take that aswell"*), after
  #1358, which is rewriting `db-roles.sh`: a fresh demo install still starts on SQLite. New
  installs should start on Postgres, and an install still on SQLite should be converted by a
  script that carries the two workarounds above, not by hand. Neither `copy-before-update.sh` nor
  any other copy includes this Nextcloud's database, as none included its SQLite file.

**2026-09-29, morning: where the Dropbox passes spend their time, and items already copied asked
about a window at a time (T1)**, merged as #1384 (`8674bbc`). From the owner's readings on the OTA
stack, counts and times only.

- **Where the passes spend their time.** The four passes from 03:00 to 06:00: making folders
  ready 0.0 minutes, listing Dropbox 0.3 minutes, the first new file 2.1, 2.6, 3.1 and 3.8
  minutes in, items handled 6,706, 9,907, 13,042 and 15,725. By 07:00, 18,693 files and 173.7 GB
  were copied, of the 55,245 files and 439.1 GB the start screen counted. The hours since #1340
  reached the stack, at about 02:27 UTC, copied 12 to 34 GB each, where the hours before it
  copied under 5 GB.
- **Found.** The first new file came later on every pass, about 11 ms later for each file copied
  before it. Dropbox has no change feed (0055 T3), so every pass lists every file the account
  holds, and `runDomainSync` asked the ledger about each one with a `find` of its own: one
  transaction each on a managed stack (`tenantScopedDb`). By the end of the first copy that would
  be about 11 minutes of every pass, and the same on every pass after it.
- **What changed.** `Ledger.findMany`, optional on the port, returns the rows that exist for a
  list of keys, in one statement. The pass reads a collection's items a window of 500 at a time
  (`ledgerReadAhead`) and uses the answer for one thing only. An item already copied, unchanged,
  where it was, with no absence, reported deletion or move waiting to be written down, is counted
  as skipped on the window's word (`quietSkip`). Every other item, a new one included, is asked
  about with its own `find`, as before, so every write is still decided on a row read just before
  it. A window that cannot be read leaves its items to their own `find`.
- **Proved** by two tests:
  - `packages/core/src/copied-items-asked-a-window-at-a-time.unit.test.ts` (19 cases), through
    the real `runDomainSync` with the memory stores:
    - 1,200 copied items are read in 3 windows, with no `find`;
    - a new item, a changed one, a moved one and one counted absent are each still asked about
      afresh and acted on;
    - a stale window row is overruled by the fresh one;
    - a window that fails, and a ledger without `findMany`, each fall back to one `find` per item.
  - `packages/ledger/src/a-window-of-keys-in-one-read.unit.test.ts` (3 cases): `PgLedger.findMany`
    on PGlite, row for row the same as `find`.

  14 of 15 mutations caught. The survivor removes the early return for an empty list, which only
  saves a statement, since an empty `IN` list matches nothing.
- **What to expect once deployed:** the first new file about half a minute into a pass (the
  listing), however many files are copied already. Each pass gets back the minutes it spent
  asking about copied files: about 4 now, about 11 by the end of the first copy.

**2026-09-29, morning: #1340 proven on the owner's migration, and the next wall on another: a
folder made ready on every pass (T1)**, merged as #1379 (`40d6887`). From the owner's readings on
the OTA stack, counts and times only.

- **#1340 proven live.** Every Dropbox pass still runs its 50 minutes, since the first copy is not
  done, and each gets far further. Items handled per pass, before the fix reached the stack (20:30
  to 02:03): 1,574, 1,940, 2,209, 2,555, 2,842, 4,228. After (03:00 to 06:00): 6,705, 9,906,
  13,040, 15,720. No errors.
- **Found on the owner's Microsoft migration.** A pass that found nothing new spent 14.0 of its
  15.7 minutes in `collectionSetupMs` and handled 0 items. `runDomainSync` made every collection
  ready on the target before listing it, on every pass, and on a WebDAV target that lists the
  collection's parent directory there. So a pass with nothing to copy still asked the target about
  every folder the migration has.
- **What changed.** A collection with a cursor was made ready by the pass that stored that cursor,
  so it is made ready again only when an item in it is written: once, on the first write, however
  many are written at the same time. A collection without a cursor, new or never read through, is
  made ready before its listing, as before, so an empty source folder is still made on the target
  the first time a pass sees it. A refusal to make a known collection ready fails that
  collection's items, each recorded, where it used to fail the pass before its listing.
  `collectionSetupMs` and `collectionsOpened` say what they count now.
- **Proved** by `packages/core/src/a-folder-made-ready-once.unit.test.ts` (6 cases, 4 failing on
  `main`, through the real `runDomainSync` with the memory stores). 5 of 5 mutations caught.
- **What to expect once deployed:** a pass that finds nothing new spends seconds in
  `collectionSetupMs` instead of 14 minutes. The Dropbox migration gains the same once its first
  copy is done, and its folders already copied stop costing a listing each on every pass now.

**2026-09-29, morning: D10's two lines kept.** Asked to confirm the start screen's two lines,
*"You can start once the count is in, or after 15 minutes at most."* and *"The count did not
finish within 15 minutes. You can start anyway: …"*, the owner answered *"Yes"*. Both stay as
built in #1351, in English and in Dutch.

**2026-09-29, night: T1's measurements took the gate's fourth-level check red, and the check
now reads a count as a count.** On branch `claude/ownpace-public-readiness-y7orc6-a-count-is-not-a-fourth-level`.

- **What failed.** E2E (managed) #216 on `main` (`74b70906`): *the migration screen's shape:
  top-level keys='domains,migration', item-level names=1*. Since #1335 a completed pass writes
  its `PassMetrics` to `last_pass_metrics`, which the operator's screen for one migration (level
  3, 0110) shows, and `PassMetrics` has always carried `items`, a count. The check looked for a
  key named `items` anywhere, whatever it held. Durations and counts are what §17 allows there,
  and nothing item-level reached the screen.
- **Fixed in the gate.** `smoke-managed.sh` looks for the item-level names where they hold
  anything but a number (a fourth level would add a list, an object or a string), and prints
  the names it found. `scripts/a-count-the-gate-took-for-a-fourth-level.unit.test.ts` runs the
  gate's own jq on #216's answer (red on `74b70906`: 1 for 0) and on four fourth levels; four
  mutations, each red.

**2026-09-29, night: Start waits for the count, 15 minutes at most (T3 (d), D10; 0131 §6, group
M8)**, merged as #1351 (`9f89bbd`).

- **What was open.** On 2026-09-28 the owner pressed Start at 17:23, and the count, with the Paper
  line and its tick-box, landed at 17:30. The screen stopped asking at five minutes, and Start
  never waited. The owner chose to hold it, up to 15 minutes (D10).
- **Built,** in `ConfirmMigration.tsx`:
  - While a count the screen waits for is still coming, Start is greyed out and a line beside it
    says *"You can start once the count is in, or after 15 minutes at most."* It waits for every
    data type the migration carries, as the rows already did (#1314); one that answered with an
    error has answered.
  - The screen asks every two seconds for five minutes, then every ten, and stops at fifteen.
    Then Start opens with a line: *"The count did not finish within 15 minutes. You can start
    anyway: anything that cannot be copied is listed on the migration's page once it is found."*
    Both lines are in Dutch too.
  - Nothing holds Start when nothing is counting: a refused count (the operator's hold) or a
    migration that cannot be read leaves it as it was.
  - The appliance's confirm page is not this screen, and is unchanged.
- **Proved** by `apps/web/src/components/a-start-pressed-before-the-count.unit.test.tsx`
  (6 cases, on the screen's own timers). One existing case changed its fixture: the refusal
  tick's test counted files for a migration that carried mail, so Start now waited for the mail.

**2026-09-28, night, last: the 40 minutes were the target's walk, found and fixed (T1; 0131 §6,
group M8)**, merged as #1340 (`774b831`).

- **Found, from the owner's readings** (counts and times only, from the migration's rows):
  - the migration has no target folder, so the writer's root is the owner's whole Nextcloud
    account;
  - the 20:30 pass finished one folder in its first five minutes, then copied nothing until
    21:10, and 222 files in its last ten minutes;
  - only one folder has ever finished: one cursor row, last written in that pass's first five
    minutes.

  The code says why. The source's root folder needs no walk: `ensureDirectory('')` returns at
  once, and its files, all copied by earlier passes, are skipped by the ledger before any write.
  That is the folder that finished. The first folder below it calls `ensureCollectionPath`,
  which walked the whole account (`keysUnderRoot`, one `PROPFIND` per directory, one after
  another) before it made anything ready. Then the pass copied until its deadline. The killed
  18:07 pass shows the same shape: its first copies came about 45 minutes in.

- **What changed.** The WebDAV writer no longer walks everything under its root before its first
  write (`keysUnderRoot`). A directory is listed the first time something in it is asked about,
  once, and its listing is shared by every item asking at the same moment. A directory the writer
  made itself is known to be empty and is never listed. One the server says was there already
  (405) is listed when asked about. One that cannot be listed falls back to the per-item check,
  as the walk's failure did. The answers are the walk's: the same adoption of a file the target
  holds, the same refusal of a directory where a file has to go. What it costs is what the pass
  touches, where it cost the whole target, on every pass.
- **Proved** by `packages/engines/src/a-walk-of-the-whole-target.unit.test.ts` (8 cases, against
  a fake DAV server that writes down every request; 3 fail on the old writer). 8 of 8 mutations
  caught.
- **Not changed:** the source still lists every folder in full on every pass, since Dropbox has no
  delta per folder. That is the other suspect. The first pass's `collectionSetupMs`, against
  `listCollectionsMs` and `collectionListingMs`, says which of the two the minutes were.
- **What to expect once deployed:** the first copy within a few minutes of a pass's start, and
  about five times as many files a pass. At the 20:30 pass's copying rate (about 4 GB in ten
  minutes), a 50-minute pass copies about 20 GB, so the ~435 GB left takes about a day of
  back-to-back passes rather than four or five. The timings (#1335) show it: `collectionSetupMs`
  should fall from about 38 minutes to seconds.

**2026-09-28, late: the fix proven on the owner's migration, and the next wall: 40 minutes before
the first copy (T1; 0131 §6, group M8)**, merged as #1335. From the owner's readings on the OTA
stack, with the migration's id left out.

- **Proven live.** The first pass on the fixed build (#1328 and #1329, deployed as v20260928.12)
  started at 20:30 UTC and ended `COMPLETED_SUCCESSFULLY` at its 50-minute deadline. It handled
  1,574 files with 0 errors and copied 222 of them (1,351 copied before, 1,573 after). The largest
  was 409 MB. The pass peaked at 307 MiB of its 512: 120 to 160 MiB while it was not copying, and
  218 to 307 MiB while it copied the large files. Before the fix, that one file would have killed
  it. The start screen showed the Paper doc's line and asked for the tick before Start (D5).
- **The red error on the migration page is older.** *"Dropbox answered 500 on files/list_folder:
  unexpected error occurred"* was recorded on 2026-09-25 at 18:00 UTC, and it is the migration's one
  failure. The 500 is Dropbox's own server error. It shows two follow-ups: the source retries no
  5xx, so one failed listing ends the files for that pass; and the failure reads as one nobody
  could classify.
- **The next wall: the pass copied nothing for its first 40 minutes.** A copy's ledger row is made
  when the copy is written, and the 222 rows were made between 21:10 and 21:20. So a pass copies
  about 4 GB, and the ~435 GB left would take about 100 passes. Where the 40 minutes went was
  recorded nowhere. The pass timed its work per item (fetch, write, ledger, hash), and the work it
  does per collection had no clock. The managed runner then dropped even the per-item numbers:
  `markCompleted` was called without them.
  - **Suspects.** The target: before its first write, the WebDAV writer walks everything under its
    root, one PROPFIND per directory, one at a time (`keysUnderRoot`), and it does this on every
    pass. For a migration with no target folder, that is the whole account. Or the source: every
    pass lists every collection in full (Dropbox has no delta per folder), including the hundreds
    already copied.
- **Done on this branch.** The pass times what it does per collection: listing the collections
  (`listCollectionsMs`), making each ready on the target (`collectionSetupMs`, which includes that
  walk), listing each one's items (`collectionListingMs`), how many it opened, and the time to its
  first write (`firstWriteAfterMs`). The managed runner keeps each data type's measurements in
  `run.stats.domainMetrics`, one set per pass, including a pass stopped at its deadline. A
  completed data type's status row keeps them too (`last_pass_metrics`), as the appliance's does.
- **Proved** by `a-pass-that-kept-no-clock-for-its-collections` in core (4 cases, the real
  `runDomainSync` with phases of known length: each lands where it was spent, the first write is
  measured from the start, and a pass that wrote nothing, or only found copies already there, has
  no first write) and `a-pass-that-kept-no-clock` in the worker (3 source guards).
- **Next.** Once deployed, one pass's `run.stats` names the phase. The fix follows from it.

**2026-09-28, night, later: the same wall at cutover, closed (T1; 0131 §6, group M8)**, merged as
#1329.

- **What was found.** Verification reads a sample of the copied files back from the target and
  hashes them (§20). The WebDAV writer's `contentHashFor` read each sampled file whole into memory
  first, as its client read every response. A sample is any file a migration copied, so a sampled
  video on a pass machine of half a gigabyte would kill a verification the way the uploads killed
  the passes. It was found while reading the client for the entry below. It never ran on the
  owner's migration, which has not reached its cutover.
- **Done on this branch.**
  - The writer's client takes `stream`, as the WebDAV source's does, and hands a streamed
    response back unread.
  - `contentHashFor` asks for a stream on a whole-file hash and hashes the file as it arrives.
  - `container-parts` still reads the bytes whole. A container is opened to be hashed, and it is
    a rendering this product asked for.
  - A refused read cancels its stream. A read that breaks off is `undefined`, never a hash of part
    of a file.
- **Proved** by `a-checksum-that-downloaded-the-whole-file` (6 cases). Among them, a real 64 MiB
  file through the real client and `fetch` holds 0 MiB three quarters in, where it held 48. 5 of 5
  mutations killed.
- **Both memory tests now settle before they read.** The server stops for a moment, then two full
  collections run a turn apart. Unsettled, a reading could count memory that was freed but not yet
  swept: 0 to 5 MiB over 20 runs of the upload test, and up to 32 MiB here. Settled, both read 0
  in 10 runs with the fix, and 52 and 48 MiB without it.

**2026-09-28, night: what killed every pass, found and fixed (T1's open half; 0131 §6, group M8)**,
merged as #1328. From the owner's readings on the OTA stack, with the migration's id left out, and
measured here.

- **The kill, from the plane's own record.**
  - On 2026-09-25, five passes from 13:24 to 17:00 UTC ended `COMPLETED_SUCCESSFULLY` after 50 to
    52 minutes: each stopped at the 50-minute soft deadline.
  - From 18:00 that day every pass ended `CRASHED`, *"Process exited with code -1 after signal
    SIGKILL."*, after 40 to 51 minutes on `small-1x`. That is nine up to 2026-09-26 10:08, and the
    two started today at 17:23 and 17:25.
  - In the same hours the plane ran 179 passes of other migrations to completion.
- **That is memory.** `small-1x` gives a run half a gigabyte, and the supervisor enforces it (0143
  T1 step 1). The kernel ends a process at that limit with SIGKILL. Trigger.dev reads exit code
  137, or V8's own out-of-memory handler, as `TASK_PROCESS_OOM_KILLED`. A process ended by a signal
  has no exit code, so it reads *"code -1 after signal SIGKILL"* (`internalErrorFromUnexpectedExit`,
  v4.5.16).
- **While copying, not at the end.** The ledger holds 1,351 files copied, one adopted and one
  failed (the Paper doc), of 55,245. The newest copy was written at 18:52 today, as the last pass
  died. No pass has reached the end of the account.
- **What held the memory: every file above 8 MB, whole.**
  - Such a file crosses as a stream (`FileBody`), so that nothing holds it, and the WebDAV writer
    sends it with Node's `fetch`.
  - Unless a request's redirect mode is `error`, fetch sends a clone of the request and keeps the
    original, in case a redirect has to send it again (`httpNetworkOrCacheFetch`). Cloning a
    stream body tees it (`cloneBody`), and the original's branch is never read. It keeps every
    chunk the upload sends.
  - A file of a few hundred megabytes, or a few large ones in flight together (four at a time),
    took a pass past half a gigabyte. The next pass met the same file again.
  - The writer's own tests pass it a client of their own, so no test ran the real client's `fetch`.
- **Measured** on Node 24.21.0 (undici 7.29.1), the tasks' runtime (`runtime: 'node-24'`):

  | | Peak | Held after |
  |---|---|---|
  | A 128 MiB upload, as it was | 166 MiB | 103 MiB |
  | The same, with `redirect: 'error'` | 48 MiB | none |
  | Three 256 MiB files through `DropboxFileSource.fetch` and `upsertFile`, as it was | 432 MiB | 260 MiB |
  | The same, fixed | 195 MiB | none |

  With the egress rule on, the last two read 421 and 256 MiB before, and 218 and 5 MiB after.
- **Done on this branch.**
  - `STREAMED_REQUEST_INIT` in `file-body.ts` holds `duplex: 'half'` and `redirect: 'error'`, and
    says why.
  - Both clients that send a stream, the WebDAV writer's and the WebDAV source's, spread it, and
    no other request carries it.
  - Refusing a redirect loses nothing. Fetch could not follow one with a stream body anyway, and a
    303 would have turned the upload into a GET that sends nothing.
  - **Proved** by `an-upload-that-kept-every-byte` (engines, 3 cases) and
    `a-dav-upload-that-would-keep-every-byte` (connectors, 2 cases). Among them, a real 64 MiB
    upload through the real `fetch` holds 0 to 1 MiB three quarters in, where it held 52. 7 of 7
    mutations killed.
- **What proves it on the OTA stack:** the first pass after this is deployed copies past the files
  the passes died on, and ends `COMPLETED_SUCCESSFULLY` or at its deadline, not `CRASHED`.
- **Not the cause:** the folder walk and the bin read each hold every entry of the account at once
  (29 MiB on 55,245 files, and more with tombstones). Since #1324 (`14a9383`) they read a page at a
  time. That lowers what a pass holds once it reaches every folder, which no pass has yet done.
- **The start screen's count (D5)** landed at 17:30:24: 55,245 files, and one Paper doc refused
  under the migration's policy at the time. The pass had begun at 17:23, before it landed. Whether
  Start should wait for the count is the owner's to decide, and was asked the same evening.
**2026-09-28, evening, later: T1's open half, the kill read, and a first fix (0131 §6, group M8)**
merged in #1324 (`14a9383`).
From the owner, on the OTA stack, from the plane's own record, with the migration's id left out.

- **The passes.**
  - On 2026-09-25, five passes from 13:24 to 17:00 UTC ended `COMPLETED_SUCCESSFULLY` after 50 to
    52 minutes: each stopped at the 50-minute soft deadline.
  - From 18:00 that day to 10:08 the next, nine ended `CRASHED`. Each reads
    `TASK_PROCESS_EXITED_WITH_NON_ZERO_CODE`, *"Process exited with code -1 after signal
    SIGKILL."*, after 40 to 51 minutes. Two were tried a second time and died again.
  - Today's pass, started at 17:23 on the tasks deployed that evening, died the same way after 45
    minutes. Every one ran on `small-1x`.
  - In the same hours the plane ran 179 passes of other migrations to completion, so the plane is
    not the cause.
- **Why that is memory.**
  - `small-1x` gives a run half a gigabyte, and the supervisor enforces it (0143 T1 step 1).
  - A process that reaches the container's limit is killed by the kernel with SIGKILL.
  - Trigger.dev records `TASK_PROCESS_OOM_KILLED` only for exit code 137, or when V8's own
    out-of-memory handler is in stderr. A process ended by a signal has no exit code, so it reads
    *"code -1 after signal SIGKILL"* (`internalErrorFromUnexpectedExit` in
    `packages/core/src/v3/errors.ts`, v4.5.16).
  - The hour's hard limit would read `MAX_DURATION_EXCEEDED`, and it was 9 to 20 minutes away.
- **Where: a prime suspect, not yet proved.** *Corrected in the entry above:* not where. The
  passes died while copying, and none reached the steps below; Node's `fetch` held each uploaded
  file whole.
  - The kills began with the first pass after five that had stopped at their deadline. That fits
    a step that runs only on a pass that reached every folder.
  - Three steps run only then, and each holds the whole account at once:
    1. the bin read (`listTrashedPaths`);
    2. the tombstones as keys, with one ledger read each (`resolveDiscardedItems`);
    3. every placed row, for the move detector (`placedItems`).
  - The bin read held the most. It gathered every entry of a recursive listing with
    `include_deleted` into one array before it looked at any: every live file, and every tombstone
    Dropbox keeps. The folder walk that starts each pass did the same with every live file.
- **Measured** with a scratch benchmark, not committed, on synthetic entries shaped like Dropbox's,
  beside the owner's 55,245 files. It reads what the bin read holds at its last page, above the
  baseline, after garbage collection:

  | Tombstones | Before | After |
  |---|---|---|
  | none | 29.2 MiB | 1.1 MiB |
  | 200,000 | 68.9 MiB | 22.1 MiB |
  | 900,000 | 210.8 MiB | 95.9 MiB |

  - The folder walk held 29.2 MiB before, and 1.1 MiB after.
  - Past about a million entries both stop at the 1,000-page guard, which the pass reads as a bin
    it could not read.
  - For scale, a tick used 190 MB of its 512 (0143).
- **Not known:**
  - how many tombstones the owner's account lists. With many, the keys and the ledger reads after
    the bin read still hold them all, and this fix is not enough alone;
  - whether memory also grows across the walk itself.
- **Done on this branch.** `listPages` hands a listing over a page at a time. The folder walk and
  the bin read each finish a page before they ask for the next. A listing that never stops paging
  is still refused, and `listSince` still reads one folder whole. **Proved** by
  `a-bin-read-that-held-the-whole-account` (4 cases); 5 of 5 mutations killed.
- **What proves it:** the first pass on the OTA stack after this is deployed ends
  `COMPLETED_SUCCESSFULLY` and closes its run. If it dies again, the run container's memory, read
  every 30 seconds while it runs, says where (open question 1).
- **The start screen's count (D5)** landed at 17:30:24: 55,245 files, and one Paper doc refused
  under the migration's policy at the time. The pass had begun at 17:23, before it landed. The
  screen does not hold Start while it counts (#1314's open point), and whether it should is the
  owner's to decide.

**2026-09-28, evening: T8 begun on the OTA stack, T2's listing read, and a tasks deploy that could
not build (0131 §6, group M8)**, merged in #1322 (`979ef36`). The owner ran the steps written for
T8 after #1311 and #1314.

- **T2's listing of the owner's account (open question 3).**
  - **What it holds:** 55,245 files and 320 folders. Exactly one is a Paper doc, and none is a
    template. No other kind refuses a download.
  - **The doc's formats:** it is listed at 200 bytes, and offers `html` (its `export_as`) and
    `markdown`. Both exports answered 200: 27,041 bytes as HTML and 6,312 as Markdown, each
    result carrying `export_hash` and `paper_revision`.
  - **The name:** Dropbox names the Markdown export `.markdown`. This plan names it `.md` (D4),
    and the source never reads Dropbox's name, so nothing changes.
  - **Its version:** `content_hash`, `rev` and `server_modified` are all set on it.
  - **So** (a), (c) and (d) are answered. (b), which of those an edit moves, waits on the
    `--versions` diff around an edit.
- **T1's kill code:** the plane's `TaskRun` held no `run-delta-sync` row for the migration.
  Whether that history is gone is being read, with a count per task that prints no payload.
  *Corrected in the entry above:* the rows were there, and a query by the migration's own run tag
  found them.
- **For T1:** every pass lists all 55,245 files, because the source keeps no change feed per
  folder (its header says why). That alone makes a pass long.
- **The tasks deploy failed, after the images had rebuilt.**
  - **What happened:** `deploy-tasks.sh` bundles the tasks from the checkout's own
    `node_modules`. The OTA checkout had been installed before `packages/shared` took undici
    (0136), so the bundle stopped at `Could not resolve "undici/lib/dispatcher/agent.js"`. The
    api and web were then on the new code, and every pass on the old bundle.
  - **Why:** the runbook's update steps never installed.
  - **The owner, the same evening:** *"yes, make deploy-tasks.sh run pnpm install"*.
  - **Done on this branch:** `deploy-tasks.sh` runs `pnpm install --frozen-lockfile` at the root
    before anything else, and refuses by name without `pnpm`. The runbook's update section says
    so.
  - **Proved** by `a-bundle-built-from-a-stale-install` (3 cases), which runs the real script
    with stubs.

**2026-09-28, late afternoon: the start screen waits for the count it asked for (T3 (d), D5, on
the way back from a pause)**, merged in #1314 (`9d5296b`). Found while writing the owner's steps
for T8. *Review and start* on a paused migration starts a new count,
but the preflight keeps one row per data type and overwrites it. So the screen still held the
rows of the last count, took them as the answer, and stopped asking. After a format change that
showed the count under the old format: Paper docs that *will not be copied*, and a tick-box for
them, while the count under Markdown landed on a screen that no longer asked.

- **The fix.** `ConfirmMigration` waits, per data type, for a row counted at or after the
  migration's `updatedAt`. Every change a person makes moves it, and the preflight's key holds
  it, so a change always starts a new count. A row with an error is shown whatever its age:
  `recordDiscoveryError` keeps the time of the counts beside it, not of the error. The screen
  reads the migration afresh, not from the five-minute cache.
- **Proved** by `a-count-taken-before-the-change` (7 cases); 8 of 8 mutations killed. The
  appliance's confirm page reads its own route and is not changed.

**2026-09-28, afternoon: T3 (d), the screens (0131 §6, group M8, step 3's last part)**, merged
in #1311 (`dee0a33`), which the owner merged himself. A person can now choose the format on
either screen, and is told before Start what a choice leaves behind.

- **The chooser.** `PaperFormatChooser` offers `refuse` and each format in
  `DROPBOX_PAPER_FORMATS`, the list the shared parser accepts. The line under it names the file a
  doc becomes (`.md`), or says, in caution, that the docs stay behind. The wizard renders it for
  every Dropbox migration that carries files, with Markdown suggested (D1), and sends
  `nativeFilePolicies: { paper }`, `refuse` included.
- **The panel.** `ExportPolicyPanel` renders it on a Dropbox migration (D7: one key, one panel,
  one rule), titled *Export format for Paper docs*. It holds the choice as the map the route
  takes, so the save and the comparison are the same as Drive's. Before the press it says a
  new format copies each doc again under its new name and keeps the old copy. After it, it says
  the next pass tries the docs left behind, counting Paper rows by name. The other kinds of
  Dropbox's own share their category, and no format here exports them. It says nothing of the
  kind after a save of `refuse`.
- **Before Start (D5).** `DropboxFileSource.nativeRefusals()` counts, by Dropbox id, each Paper
  doc or template the migration refuses, under `refuse` or in a format its file does not offer.
  The preflight already reads any source's count, and `native-kind-key` names the kind *Dropbox
  Paper docs*, so the confirm screen's line and tick-box cover them.
- **The words.** The Paper refusal names the setting as Drive's does, and says the next pass
  copies the doc and closes the line. `failure.policyRefused.dropbox` names *Export format for
  Paper docs* and *Try again*, and keeps the other kinds' remedy. The guides, `dropbox-setup.md`
  and the feature matrix say what the screens now do.
- **Proved** by `a-paper-doc-counted-before-start` in `connectors` (5 cases), and on the screens
  by new cases in `a-setting-with-nowhere-to-set-it` (7), `CreateMapping` (5) and
  `a-chooser-with-two-arrivals` (4), with `a-remedy-chosen-by-source` now holding the setting's
  name in both languages. 31 of 31 mutations killed.

**2026-09-28, afternoon: T3 (a) and (c), the setting's way in (0131 §6, group M8, step 3's
second part)**, merged in #1310 (`cd74069`). A migration can now hold a format for its Paper
docs, and both editions hand it to the source.

- **(a) The values.** `dropbox-native-policy.ts` in `shared`: `markdown` and `html`, Dropbox's
  own `export_format` strings, and `refuse`. `parseDropboxSource`, exported from `config.ts`,
  reads a Dropbox source for both editions: the appliance's mapping file, the create and update
  doors, and the managed builder. An unknown value, a Google kind, or Drive's one format for
  every kind (`nativeFilePolicy`) on a Dropbox source is refused by name.
- **(c) The doors and the builders.** Create stores `nativeFilePolicies.paper` beside the root,
  on the connection and on a reused connection's override. The update door merges it into the
  mapping's own override, as it does Drive's formats, and now asks which source a format is
  for: a Paper format on a migration that does not copy from Dropbox, or a Google format on
  one that does, answers 400 naming `sourceConfig.nativeFilePolicies`, and nothing is written.
  Until now a Google format sent to a Dropbox migration was stored and never read, and a Paper
  format was refused everywhere, by Drive's parser. The factory and the managed builder hand the
  format to the source. The builder reads the `paper` kind alone, so a Google format merged
  into a Dropbox row before stays ignored rather than stopping every pass, and it reads the
  root as before, so an empty one still means the whole account. The revision rule's
  consequence names a Paper doc beside a Google document, and a Dropbox snapshot records the
  Paper format, `refuse` when unset. The API spec, `dropbox-setup.md` §3 and the feature matrix
  say so.
- **Proved** by `a-paper-format-a-migration-keeps` in the API (15 cases),
  `a-paper-format-stored-and-never-read` in `orchestration` (9), and a fifth case in
  `a-paper-doc-exported-once`: a format switched later copies the doc again under its new name,
  and the old copy is an earlier export, never a deletion. 28 of 28 mutations killed. (d), the
  screens, is next; until it lands the managed edition takes the format through the API only.

**2026-09-28, afternoon: T3 (b) and T4 built in the source (0131 §6, group M8, step 3's first
part, with step 4)**, merged in #1301 (`2dc3d4f`), which the owner marked ready and merged
himself. `DropboxFileSource` takes `nativeFilePolicies: { paper }`, `markdown`, `html` or `refuse`
(the default, D1), and a value it does not know stops it at construction. Nothing sets it yet:
the create and update doors, the builder and the screens are T3 (a), (c) and (d), next. So no
migration's behaviour changes with this.

- **The name, at listing (T3 (b), D4).** Under a format Dropbox offers for the file, a Paper doc
  or template is listed with the suffix appended: `Notes.paper` as `Notes.paper.md` or
  `Notes.paper.html`, and the key is that name. `formerPaths` names it under every other policy,
  `refuse` included, and `sourceIdentity` is its Dropbox id (D8). `listKeys` answers from the
  same listing. A tombstone carries no export information, so a deleted `.paper` or `.papert` is
  evidence under its listed name and the one the policy in force gives it. Any other kind is
  never renamed, and keeps its T5 refusal.
- **The export (T4).** One `files/export` call on the content host, the id and the format in the
  header, answered buffered and before the size picks a stream, with the export's own length and
  `rendering` set. A format the file does not offer is refused before any request, as
  `policy_refused`, naming the format; so is Dropbox's `invalid_export_format`. Every other
  refusal, `retry_error` and `non_exportable` among them, stays an ordinary failure (D2).
- **D8's ADRs.** ADR-0046 gains an operative rule for Dropbox, and ADR-0030's rule on pairing by
  id names a Paper doc beside a Google document. Both have a dated section.
- **Proved** by `a-paper-doc-that-arrives` in `connectors` (20 cases), and by
  `a-paper-doc-exported-once` through the real file pass (4), with exports that differ on every
  fetch: written once, not again while the listing's version holds, again after an edit, a parked
  row closed once a format is chosen, and a rename reported as moved by its id. 24 of 24
  mutations killed. T2's listing (open question 3) still decides whether an edit in Paper moves
  `content_hash` or only `server_modified`; the version reads both. That listing is not
  recorded here yet, and still decides both.

**2026-09-28, afternoon: T2's listing, as a tool the owner runs.** On branch
`claude/mailbox-sync-errors-c2xsw2-a-listing-that-names-no-file`, merged in #1300 (`fb70284`).
Open question 3 needs a real account, so `scripts/dropbox-native-inventory.mjs` reads one and
prints what T3 and T4 build on, naming no file, no folder and no token:

- **(a) the formats:** per kind, `export_as` and `export_options`, and an export probe: one file
  per kind, `files/export` once in each format it offers, keeping only the status, the size, the
  suffix of the name Dropbox gives it, and whether the result header carries `export_hash` and
  `paper_revision`;
- **(b) the version:** `--versions` prints one line per such file, with `rev`,
  `server_modified`, `content_hash` and `size`, under a label cut from a hash of its Dropbox id.
  Run it before and after editing one Paper doc, and `diff` shows which fields the edit moved;
- **(c) the kinds:** every kind the listing marks `is_downloadable: false`, and how many of each
  offer no export (D5). A kind prints only as a plain short extension, so no name leaks through
  it;
- **(d) the sizes:** the smallest and largest listed size per kind.

It calls `files/list_folder`, its `continue`, `files/export` and, for the appliance's three
variables, the token refresh, and nothing else. It asks again after a 429, after Dropbox's
`Retry-After`, and reports nothing from a listing that never ends. The token is
`DROPBOX_ACCESS_TOKEN`, for instance one the Dropbox App Console generates for the app's own
account, read without echo. A host without Node runs it in a container, from stdin. **Proved** by
`a-listing-that-names-no-file`, 23 cases against a fake Dropbox; 27 of 27 mutations killed. In
the same change T1's row stops naming the Paper doc the owner's migration met: it says "a Paper
doc", since a file's name from the owner's account stays out of the repository.

**2026-09-28, afternoon: the export moves before the alpha (D6, amended).** Asked whether M8's
steps 3 and 4 should come before the alpha after all, the owner answered: *"yes, paper export
before the alpha"*. So T3, the format per kind, and T4, the export, join the alpha minimum. T7 (a),
detecting Paper docs outside the file tree, stays after the alpha: D3 chose to detect them, not to
export them. T2's listing of the owner's account still comes before T3's and T4's code merges
(open question 3), and T9's lines change again when T4 lands. T9's first change merged in #1298
(`93958ac`).

**2026-09-28, midday: T9's words, with T5 (0131 §6, group M8, step 2)** on branch
`claude/mailbox-sync-errors-c2xsw2-paper-docs-said-as-they-go`, not merged, after step 1 merged in
#1297 (`a34c152`). `docs/dropbox-setup.md` and both Dropbox guides now say what T5 does: a Paper
doc, or any other document Dropbox keeps in a format of its own, is refused by name and waits on
the Failures page, and Paper docs outside the file tree are not seen (T7). The guides say it
without internal references, as their lint requires. The same edit corrects *"deleted-entry read
is not yet supported"*: the tombstones have been read since 0055 T3b. `docs/feature-matrix.md`
gains the open-gaps row (T3, T4), the Dropbox column's line and the legacy-Paper line among what
floats. The known-limitations entry waits for 0144 T2's page.

- **The owner on T5's remedy, the same day:** *"sentence ok, continue"*. That is the Dropbox
  sentence on the Failures page, in both languages, as built in step 1.
- **And on the export:** *"ofcource we do want to support Paper into other formats. Those are in
  other M8 steps, right?"* They are: M8 steps 3 and 4 (T3, the format per kind, and T4, the
  export), after the alpha by D6 unless the owner moves them up. T3 first needs T2's listing of
  the owner's account (open question 3).

**2026-09-28, midday: T5 and T6 (a) built (0131 §6, group M8, step 1)** on branch
`claude/mailbox-sync-errors-c2xsw2-a-paper-doc-refused-by-name`, not merged. The owner, the same
morning: *"Start M8"*. That was before open question 1's last part, the kill code. What T5 needs
from open question 1 is the refusal as Dropbox gave it, and that is in (the entry below). The kill
code bears on T1's open half, why every pass is killed, which T5 does not change.

- **The listing reads Dropbox's mark.** `DropboxEntry` gains `is_downloadable` and `export_info`.
  A file listed with `is_downloadable: false` carries `exportOnly` on its item: its kind, the
  name's extension, and the formats Dropbox offers.
- **`fetch` refuses it first,** before any download and before the size chooses a stream, so the
  refusal stays the source's. `DropboxNativeRefused` is split as Drive's is:
  - `policy_refused` for a Paper doc (D9) and for any kind Dropbox exports. The message names the
    file and the kind and says this service does not export them yet (D6): *"Export it from
    Dropbox yourself, or leave it behind."*
  - `source_refused` for a kind Dropbox offers no export for (D5).

  Both are decisions, so the file is parked on its first attempt and never counts toward a pass's
  25 failures in a row (T6 (a)).
- **Beyond this plan's text:** a file the listing did not mark, answered with 409
  `unsupported_file` on download, is refused the same way, since that is the answer the owner's
  migration met. Any other answer stays an ordinary failure.
- **The remedy by source (D9).** `FailuresQueue` carries the migration's `sourceKind`: the source
  connection's kind on managed, the mapping's `source.type` on the appliance, `dropbox` on both.
  `remedyKey(category, sourceKind)` in `failure-key.ts` gives a Dropbox migration's
  `policy_refused` its own sentence, in both languages, which names no setting. The Failures
  rows and the group panel ask it, and Drive's sentence is unchanged. `failure-category.ts`'s
  definition of `policy_refused` gains the paragraph D9 asks for, which T3 takes out again.
- **Proved.**
  - `packages/connectors/src/a-paper-doc-refused-by-name.unit.test.ts`, 11 cases: the mark, the
    refusal before any download (a Paper doc listed above 8 MB included), both categories and their
    words, the download's `unsupported_file` answer, and three other answers that stay ordinary.
    It holds here the cases T5 named for `a-refusal-we-wrote-and-then-could-not-read`, which cannot
    import a connector. `retry_error` comes from `files/export`, so it arrives with T4.
  - `a-park-that-counted-as-five-attempts`, three cases through the real sync loop against a
    Dropbox that refuses as it refused the owner. The Paper doc is parked on one attempt as
    `policy_refused` while the rest is copied, and is not fetched on the next pass. Thirty Paper
    docs listed before a file no longer stop the pass before it. All three fail on the source
    before this, the way the owner's migration did.
  - `apps/web/src/i18n/a-remedy-chosen-by-source.unit.test.tsx`, 11 cases: `remedyKey`; the
    sentence in both languages; the page in English and Dutch, where a Dropbox queue's two rows
    and group say Dropbox's sentence and a Google queue's, or a server's that sends no source, say
    Drive's; and a guard that only `failure-key.ts` and the three data-type screens index
    `FAILURE_KEY` themselves.
  - Both `/failures` answers name the source: the appliance's in `selfhost-queues`, managed's in
    `a-queue-that-names-its-source`, both run by CI's integration job.

  20 of 20 mutations killed.
- **The owner's row** waits on a person at five attempts from before this. Once this is merged
  and deployed, Retry on it is T8's first step: the next pass reads the listing again and parks it
  as `policy_refused`.
- **Next, M8 step 2:** T9's lines in the Dropbox docs and guides, and the feature-matrix row.

**2026-09-28, later: open question 1, the error text, and passes that never end.** From the
owner, on the OTA stack, with the migration paused:

- **The error text, in full,** with the file's name left out:
  `Dropbox refused the download of "…" (409): {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"}`.
  That is T1 (a) as read.
- **The passes:** the last ten are `incremental` runs from 2026-09-25 18:00 to 2026-09-26 11:00
  UTC, started about two hours apart. Every one is still `running`, with no counts. The owner
  paused the migration after the last one, and the tick never enqueues a paused migration, which
  is why none has started since.
- **None ended, so none ended with a stop.** A pass that ends closes its row. So does one that stops
  at its 50-minute soft deadline, or before a data type once the migration is paused. These were
  killed outright: out of memory in the task's 512 MB container (0143), or at the 60-minute hard
  limit. The tick started the next one when the open row was two hours old (`STALE_RUN_AFTER_MS`,
  twice the hard limit). What a pass wrote before its kill stays, which fits the one Paper row at
  five attempts.
- **So T1's open half has moved.** The question is no longer why one file stops a pass, but why
  every pass is killed before it ends. Trigger.dev records which kill ended each run
  (`TASK_PROCESS_OOM_KILLED`, `MAX_DURATION_EXCEEDED`); the query is under open question 1.

**2026-09-28: open question 1, a first reading.** From the owner's managed migration, on the OTA
stack, with the migration paused:

- **One `.paper` row:** `last_error_category` `source_refused`, `attempt_count` 5, `parked_at`
  NULL, and none below 5. That is T1 (a)'s reading and T8's expectation.
- **One Paper doc cannot stop a pass.** The 25-in-a-row stop needs 25 (T1 (b)), so it does not
  explain "no other file moves" in this migration. That stays T1's open half.
- **Still owed:** the pass summaries, and the row's error text in full.

**2026-09-26, later still: the owner answered open question 4, and D9 was checked against the
code.** The owner, word for word: *"open question 4: (a), policy_refused as recommended"*. So a
Paper doc states `policy_refused` before T3 as well as after, and the Failures page chooses its
remedy by the migration's source as well as by its category, so a Dropbox migration's Paper docs
are not told to use Google's setting (D9). That change is part of T5, in the alpha minimum. D9 as
first written named four screens. A review against the code found that the Failures page shows the
remedy in two files, its rows and its group panel, and that the other three screens read a
domain-level category that never holds `policy_refused`. So T5 now changes the two places on the
Failures page only, and the failures payload carries the migration's source for them (T5, D9).
Open question 4 keeps its text, with the answer under it. Three things stay open: T1's evidence
(open question 1), the owner's own words (open question 2), and T2's listing of the owner's
account (open question 3).

**2026-09-26, later: the correction reviewed, and the branch rebased on `main` at `979c7974`.** A
review of this correction against the code found it wrong in places, and each is fixed here. Only an
item that is fetched and written resets the 25-in-a-row tripwire, so once the rest of the tree is
copied, 25 Paper docs still being retried stop a pass, whatever folders they are in (T1 (b), defect
2). That is a new candidate for T1's open half. A row at the ceiling waits on a person with
`parked_at` NULL; only a decision error is parked (T1, T8). A tombstone carries no
`is_downloadable`, so the trash read can name a Paper doc only by its extension (T3 (b)). This
correction had written the category a Paper doc states before T3 as a decision, but the owner's
answer does not settle it, so it is now open question 4 (answered later the same day: D9). #1194
merged on 2026-09-26, so the consent asks for `account_info.read` and T7 (a) has its scope. T8
now has the owner press Retry before recording, and counts for 0141 T3 only under 0141 T3's own
conditions. Dropbox's missing 429 handling has a home now, 0055 T3 (e).

**2026-09-26: corrected against the code, and the owner's decisions recorded.** At the owner's
request 0150 was checked against `main` at `dff5af13`, and against Dropbox's API spec
(`dropbox-api-spec`) and SDKs on GitHub. dropbox.com was not reachable from the check, so every
Dropbox fact below that no real account has shown is marked as such. When this correction was
written, every file and line of this repository it cites was read again at `main` `e9abd451`. After
the rebase, the files that changed on `main` since then were read again at `979c7974`, so every line
number of this repository's code and docs below is `979c7974`'s. The spec's lines are those of
`dropbox-api-spec` at `404afad5`, and rclone's those of its `master` at `9dc8b71a`, both read on
2026-09-26. T1's two mechanisms were wrong. The Paper 409 reads `source_refused` today, not
`target_refused`. And one failing file cannot stop a pass, though 25 Paper docs still being retried
in one pass can (T1 (b)). So T1 is 🟡, and the cause of "no other file moves" is open. The Dropbox
names in T3, T4 and *The shape of the fix* were not Dropbox's (`export_as_html`,
`export_as_markdown`, `e_tag`, `unsupported_export_type`). The exported name is chosen at listing,
because it is the natural key. An exportable Paper doc with no format chosen is `policy_refused`
once a format can be chosen (D1), and before that as well (D9). T6 (b) was already built. The
owner was then asked whether to open this correction with the recommended answers, and answered:
*"yes, open the 0150 docs PR with your recommendations"*. Those answers are D1 to D8
(*Decisions*). Four things stayed open: T1's evidence (open question 1), the owner's own words
(open question 2), T2's listing of the owner's account, which decides open question 3 and is
needed before T3, and the category a Paper doc states before T3 (open question 4, since answered:
D9). Nothing is built.

**The alpha minimum (decided, D6):** T5 and T6 (a), T9's lines in the Dropbox docs and guides and
its feature-matrix row, and a 0144 known-limitations entry. Until T3 lands, the refusal points to
no setting, and it states `policy_refused` with a remedy that names none (D9). One part of the
recommendation did not hold: 0144's page is itself planned for after the first invitation (0144
T2), so until it exists a tester reads the limit in the Dropbox guides (T9), and the 0144 entry is
written with 0144 T2 (D6). **Since 2026-09-28 also T3 and T4** (D6, amended): the owner,
*"yes, paper export before the alpha"*. **After:** T7 (a). An M group builds the plan: M8 in
0131 §6 (D7).

| Task | Status | Evidence |
|---|---|---|
| T1 the live failure, read from the wire | 🟡 **Partly diagnosed** (2026-09-25; corrected 2026-09-26). The open half ✅ **answered 2026-09-28**: every pass from 2026-09-25 18:00 was killed for memory while copying, because Node's `fetch` held every uploaded file above 8 MB whole; fixed by `STREAMED_REQUEST_INIT`; ✅ **proven on the OTA stack 2026-09-28**: the first pass on the fixed build ended at its 50-minute deadline with 222 files copied, the largest 409 MB, at a peak of 307 MiB of 512 (Status) | **Known.** The owner's managed migration met a Paper doc (`.paper`), and `files/download` answered 409 `unsupported_file`. This plan first quoted the error as `Dropbox refused the download of "…paper" (409): {"error":{".tag":"unsupported_file"}}`, with the path shortened. The full text, and the screen or row it was read from, were not recorded (open question 1). `download()` throws a bare `Error` with no stated category and no decision mark (`dropbox-file-source.ts`:383-385). Dropbox's spec says what the tag means: *"This file type cannot be downloaded directly; use :route:`export` instead."* (`files.stone`:1002-1005). **Not as first written.** (a) The row reads `source_refused`, not `target_refused`. `fetchRaw` is `sided('source', deps.fetchRaw)` (`domain-sync.ts`:880), and the matching rule turns a source-side refusal into `source_refused` (`failure-category.ts`:324-328, :366). So the owner is told the old account would not hand the file over (`strings.ts`:1340-1341). The code has worked this way since 2026-09-17. Only a `.paper` listed above 8 MiB would read `target_refused`, because it is downloaded inside `body.open()` (`dropbox-file-source.ts`:411-417) under the target's `upsert` (`domain-sync.ts`:892). (b) One file cannot stop a pass. `consecutiveFailures` lives for one pass (:969). Only an item fetched and written resets it (:1713); an item skipped before the fetch does not (:1402-1414), and neither does one that waits on a person (:1444-1456). The per-item catch carries on (:1746). The file is tried on 5 passes, then waits on a person and is not fetched again (`MAX_ITEM_ATTEMPTS`, `ports.ts`:1896; `domain-sync.ts`:332, :1445). Its `parked_at` stays NULL, because only a decision error is parked (:1860; `ledger.ts`:564, :844). **Open: why "no other file moves".** First read the owner's pass summaries (created, skipped, failed, needs decision), whether any pass ended with a stop, and the `.paper` rows (`last_error_category`, `attempt_count`, `parked_at`), with how many have `attempt_count` below 5. Candidates: (1) once the other files are copied, later passes show created 0 and skipped N beside one failure, which can read as "nothing moved". (2) An account holding 25 or more Paper docs: once the rest of the tree is copied, every Paper doc still being retried counts toward 25 in that pass, whatever folder it is in, and the 25th stops the pass (`PassAbortError`, :1909-1916). A stopped pass does not reach the folders listed after the 25th failure, so new or changed files there do not move until the Paper docs reach the ceiling. #1182's root-path 409 is ruled out for the passes that show the Paper 409, because those passes listed the root first (`domain-sync.ts`:1170). 0128's per-data-type stop (#1174, #1179) is not yet ruled out. **Answered 2026-09-28 (Status):** from 2026-09-25 18:00 every pass was killed for memory while copying, before any reached the end of the account (1,351 of 55,245 files copied). Node's `fetch` held every file above 8 MB whole while it uploaded it. Neither candidate above is what ended them, nor the bin read, suspected first; it and the folder walk read a page at a time since #1324. |
| T2 the native-format inventory, before any code | 📋 **Proposed** (the rule, from the API spec); the listing's tool ✅ **merged 2026-09-28** in #1300 (`scripts/dropbox-native-inventory.mjs`, naming no file); the owner's listing ✅ **read 2026-09-28** (open question 3: (a), (c) and (d) answered; (b) waits on an edit) | **The rule.** Dropbox states on every listed file whether it must be exported. `is_downloadable` means *"If true, file can be downloaded directly; else the file must be exported."* `export_info` *"must be set if is_downloadable is set to false"*. It holds `export_as` (the default format) and `export_options` (the others) (`files.stone`:822-826, :693-702). The kind table keys on these fields, with the extension as the kind's label. `DropboxEntry` carries neither field today (`dropbox-file-source.types.ts`:56-67). T5 needs only this rule. T3 and T4 also need the listing. **Record from a real listing, per kind** (open question 3): `is_downloadable`; `export_info`; whether `files/export` answers, and with which `export_format` values; the listed size; and whether `content_hash`, `rev` or `server_modified` moves after an edit. The version decides a rewrite (`domain-sync.ts`:350-354; `dropbox-file-source.ts`:451). **Kinds to look for:** `.paper` and `.papert`. `.web`, Dropbox's own shortcut: reported as not downloadable, and one report (rclone issue #8391) says it exports in a `url` format; not checked. Any `.gdoc`/`.gsheet`/`.gslides` left in the account: the spec's own export example turns `Prime_Numbers.gsheet` into `Prime_Numbers.xlsx` (`files.stone`:1664, :1682). `.url` and `.webloc` are ordinary files that download and migrate today; they are not native kinds. |
| T3 the arrival format per kind, chosen by the user and named at listing | 📋 **Decided 2026-09-26** (D1, D4, D5, D7, D8). **Before** the alpha since 2026-09-28 (D6, amended) — *was:* after the alpha. (b) the name at listing ✅ **merged 2026-09-28** in #1301 (`2dc3d4f`); (a) and (c) ✅ **merged 2026-09-28** in #1310 (`cd74069`); (d) ✅ **merged 2026-09-28** in #1311 (`dee0a33`), and its start screen's wait for a new count in #1314 (`9d5296b`); Start's wait for the count (D10) ✅ **merged 2026-09-29** in #1351 (`9f89bbd`) | The owner asked that the user picks the format that arrives (*The owner's words*). **(a) The values.** A kind's choices are the wire's `export_format` strings for it: `html` and `markdown` for Paper, which is what rclone sends (rclone `master` at `9dc8b71a`, `backend/dropbox/dropbox.go`:141-144). Each file's choice is checked against its `export_as` and `export_options`, as rclone does (:1802-1806). The stored setting may use repo-style names mapped to them. A kind with no export path offers no format. No format chosen means refuse (D1). The wizard shows the Paper picker for every Dropbox migration that carries files, and suggests Markdown (D1). **(b) The name is chosen at listing.** The sync loop writes under the listed path and keeps only the bytes from `fetch()` (`dav-sync.ts`:382, :392, :406; `webdav-target-writer.ts`:252, :799). So `listSince`/`toFileItem` name each native entry under the policy in force, as Drive's `exportedNameUnder` does (`google-drive-source.ts`:227-237, :466). The rule is D4's: the suffix is appended, so `Notes.paper` arrives as `Notes.paper.md`. That name is the natural key. Each entry carries `formerPaths` for its names under every other policy, `refuse` included (`google-drive-source.ts`:1116; `dav-sync.ts`:409). So a switch closes a row parked under the old name (`supersedeFormerNames`, `ports.ts`:1683). `sourceIdentity` is the Dropbox id; its comment says it is set only for a Google document today (`file.ts`:103-114). `listKeys` uses the same naming, because it answers from the same listing (`dropbox-file-source.ts`:273-280). `listTrashedPaths` cannot: a tombstone (`.tag: "deleted"`) carries neither `is_downloadable` nor `export_info`, only the fields every entry has and `is_restorable` (`files.stone`:765-788, :896-899), and the source reads only its `.tag` and `path_display` (`dropbox-file-source.ts`:301-314). So a tombstone is the one place the rule falls back to the extension (`.paper`, `.papert`): `listTrashedPaths` emits both the listed name (`Notes.paper`) and the name under the policy in force. A key no ledger row holds resolves to nothing downstream (:296-299), and a row parked under `refuse` still carries the listed name. Drive's own bin read does not rename at all (`google-drive-source.ts`:864, in `originalPathOf`). The version stays the listing's `fileVersion(content_hash, server_modified)` (`dropbox-file-source.ts`:451; ADR-0046, #1083), never the export's hash. **(c) The places the setting passes through,** as Drive's does. D7: the key is `nativeFilePolicies`, reused with a `paper` kind. So the Google-typed kinds and values widen (`google-native-coverage.ts`:110; `config.ts`:214, :1278-1283), and the update door's check becomes source-aware: today it runs the Google parser for every source and would answer 400 (`apps/api/src/routes/migrations/index.ts`:1760). Export a `parseDropboxSource` from the Dropbox branch (`config.ts`:1046-1052, today inside the private `parseSource`, :977) and call it from the create and update doors, as Drive's `parseGoogleDriveSource` is called (`index.ts`:195). It then becomes the one authority for both editions. Today managed builds the Dropbox config itself (`index.ts`:201-205), and the create door's gate and that config drop a setting sent today without a word (:509, :201-205). The factory hands the source `rootPath` and the endpoints only (`dropbox-source-factory.ts`:97-101). Managed's builder hands it `rootPath` only, read straight from the stored JSON (`build-deps-from-mapping.ts`:1110-1111); it reads the policy through the same parser, as the create door does. The wizard's gate and the settings panel's both ask `carriesGoogleNativeFiles` (`CreateMapping.tsx`:1364-1365; `ExportPolicyPanel.tsx`:214; `google-native-coverage.ts`:248). Also: the panel's title (`strings.ts`:557 EN, :2890 NL); the Dropbox remedy sentence T5 adds (D9), which from T3 on names the new setting, while `failure.policyRefused` stays Drive's, word for word (`strings.ts`:1328-1329, :2403-2404); the `source.nativeFilePolicy` revision rule, its consequence and snapshot (`config-revision.ts`:66, :136-145, :394), with 0125's wording; `openapi.yaml`:1885-1898; and the appliance's mapping key with `dropbox-setup.md` §3. The web `MaskedConfigSchema` already names both keys (`mapping-service.ts`:211-238), so D7 needs nothing there. The values stay `z.string()`, with no API enum. T8's export half, on the existing mapping, needs the update door. **(d) Before Start.** Add a `nativeRefusals()` count on `DropboxFileSource` for the confirm screen (`run-discovery.ts`:167-170; `native-refusals.tsx`). It counts `policy_refused` files only, as Drive's does, because the confirm line offers a format as the remedy (`google-drive-source.ts`:459, :1206-1209; `strings.ts`:117-118). Add a `paper` entry in `native-kind-key.ts`, with EN/NL `discovery.refusedNative.kind.paper`; today an unknown kind reads "Google files" (`strings.ts`:105). **(e) Done when** ADR-0046's operative rule names Dropbox: a rewrite follows the listing's version, and a renamed export is paired by the Dropbox id (D8). **Guards:** a listing under a Paper format names the entry and its `formerPaths`, and a second pass creates nothing (extend `dropbox-file-source.unit.test.ts`:111; fails today, because no entry is renamed). The tombstone tests (:322) pin that a deleted `.paper` is emitted under both names. A PUT to `/api/migrations/:mappingId` on a Dropbox migration carrying a `paper` format in `nativeFilePolicies` is accepted and written (400 today, from `UpdateMappingSchema`, `index.ts`:1760): add a Dropbox case beside the 400 case in `apps/api/src/routes/migrations/a-format-that-had-to-fit-all-four-kinds.unit.test.ts`:349, and a merge case in `a-setting-the-route-dropped-in-silence`. Extend `a-policy-the-client-threw-away` and the chooser guard `a-chooser-one-google-kind-could-not-reach`, or add a Dropbox sibling. |
| T4 the export path | 📋 **Decided 2026-09-26** (D2, D8). **Before** the alpha since 2026-09-28 (D6, amended) — *was:* after the alpha. ✅ **Merged 2026-09-28** in the source, with T3 (b), in #1301 (`2dc3d4f`) | `POST https://content.dropboxapi.com/2/files/export` with `Dropbox-API-Arg: {"path": <id>, "export_format": <value>}`. It uses the same content host and header argument as `download()` (`files.stone`:2753-2764, `host = "content"`, `style = "download"`), the same id (`sourceRef`, `dropbox-file-source.ts`:454), and the same scope, `files.content.read`, which the consent asks for since #1194 (`DROPBOX_CONSENT_SCOPES`, `dropbox-consent.ts`:50-53, set on the URL at :80) and which every migration's token must carry (`DROPBOX_REQUIRED_SCOPES`, :38-41). **A preview route (D2).** Dropbox marks it `is_preview = true`, *"subject to breaking changes without notice"* (`stone_cfg.stone`:11-13); `files/download` is not marked (`files.stone`:2727-2736). A contract test pins the request and the result, and T8 records the live answer. An answer the code does not recognise stays an ordinary, retryable failure (T5). **The result** is `export_metadata` (`name`, `size`, `export_hash`, `paper_revision`) plus `file_metadata`, in the `Dropbox-API-Result` response header (`files.stone`:1669-1690). There is no `e_tag`. The name comes from the listing (T3 (b)). The header can only confirm it, through an optional `headers` on `DropboxTransport`'s response, added like `body?` (`dropbox-file-source.types.ts`:18-35). **Before the size gate, always buffered.** `fetch()` decides the kind before `item.size > STREAM_FILES_LARGER_THAN_BYTES` (`dropbox-file-source.ts`:411, 8 MiB). An export returns `content` with `item.size = bytes.byteLength`. It never returns a `FileBody` whose `sizeBytes` is the `.paper` listing size (:415), which the target would send as `Content-Length` (`webdav-target-writer.ts`:958). Drive does the same (`google-drive-source.ts`:948, :968, :994). The export is read as bytes, never as text. **Done when** ADR-0046's amendment (D8) covers the export as built. **Guard:** a `.paper` listed above 8 MiB under an export policy returns buffered `content` from one `files/export` call, and never a body. Add it as a Dropbox sibling of `a-drive-file-that-has-no-size-until-it-exists`. It fails today, because the file goes to `files/download` in the streamed branch. |
| T5 a stated refusal, in the category a setting would change | ✅ **Done** in #1297, merged 2026-09-28 (`a34c152`) (the owner: *"Start M8"*) — *was:* 📋 **Decided 2026-09-26** (D1, D5, D6, D9). **Alpha minimum** | Split as Drive's `NativeFileRefused` does, by *"WHETHER A SETTING WOULD CHANGE THE ANSWER"* (`google-drive-source.ts`:143-205; the owner's choice of 2026-09-18, `failure-category.ts`:113-125). The listing reads T2's rule: `DropboxEntry` gains `is_downloadable` and `export_info`, and the item carries what `fetch()` needs to decide before any download and before the size gate, so the side stays `source`. An exportable kind with no format chosen, or with `refuse`, STATES `policy_refused` and names the setting (D1; `failure-category.ts`:134-143). A kind with no export path states `source_refused` (D5). **Before T3** there is no setting to name (D6), and a Paper doc still states `policy_refused` (D9). Its message says Ownpace does not export Paper docs yet, and that it can be left behind. Until T3 that departs from half of the category's written definition, *"a setting on the mapping is what changed the answer"* (`failure-category.ts`:135-137), so T5 adds to that comment a kind this build does not export yet, whose remedy is chosen by source and names no setting until one exists (D9); T3 takes the addition out. The ledger's column comments say the same as the definition (`0051_a_refusal_that_was_ours.sql`:79-82, :96-99) and hold again from T3, so no migration changes them. **The remedy by source (D9).** `FAILURE_KEY` picks a remedy by category alone (`apps/web/src/i18n/failure-key.ts`:28-38), and `failure.policyRefused` speaks of Google files and names *Export format for Google files* (`strings.ts`:1328-1329, NL :2403-2404). An item's category reaches two places, both on the Failures page: each row (`Failures.tsx`:90) and, when more than one failure is queued, the group panel, which looks the remedy up in its own file (`apps/web/src/components/queues/FailureGroupPanel.tsx`:274; `Failures.tsx`:159-164). Both choose it by the migration's source as well: a Dropbox migration's `policy_refused` rows and group get a Dropbox sentence, in both languages, that names no setting until T3 and names T3's setting from then on. Drive's text stays as the owner worded it on 2026-09-22. **Where the source comes from.** Neither `ItemFailure` (`ports.ts`:1932) nor `FailuresQueue` (`operating-contract.ts`:151) carries it, and the page cannot ask for the mapping on the appliance, which has no mapping API (`MappingDetail.tsx`:123-124). So `FailuresQueue` gains the migration's source kind, set by both editions' `/failures`: managed reads the source connection's `kind`, as the completion report already does (`apps/api/src/routes/migrations/operating-routes.ts`:304-324; the route, :367), and the appliance reads its mapping's `source.type` (`apps/selfhost/src/index.ts`:1761). The page hands it to its rows and to `FailureGroupPanel`. **Not the domain-level screens.** The Connections page, the support view, the live progress and the progress link (`Connections.tsx`:374, `Support.tsx`:956, `LiveProgress.tsx`:187, `View.tsx`:127) show `migration_status.last_error_category`. Only `markFailed` writes it, from a message with no stated category (`migration-status-store.ts`:253), and no rule over a message yields `policy_refused` (`failure-category.ts`:346-348), so it cannot reach them, and they stay as they are. The progress link's own sentence (`view.failure.policyRefused`, `strings.ts`:1063-1064) names neither provider anyway. A row parked before T3 keeps its category until Retry is pressed (`ledger.ts`:875-879), or until a chosen format changes its key (T3 (b)). Every refusal carries `markNeedsDecision`, and names the file and the kind. **Export answers, by tag (from T4).** Drive's rule applies: *"A reason absent from this set is treated as retryable"* (`drive-refusal.ts`:54-59). `non_exportable` (*"This file type cannot be exported. Use :route:`download` instead."*) on an entry whose download was already refused is a stated `source_refused`; on any other entry it means the kind table is wrong. `invalid_export_format` is prevented by checking the choice against `export_as` and `export_options` first; if it still comes, it is a stated `policy_refused`. `retry_error` (*"The exportable content is not yet available. Please retry later."*), any other or unknown tag, 429 and 5xx are ordinary failures, with no decision mark and no stated category. They are retried, and still count toward the tripwire. `path/not_found` on the listed id means the file is gone since the listing; it is not a refusal. `unsupported_export_type` does not exist (`files.stone`:1014-1021). **Guards:** fetching a `.paper` with no format states its category and is a decision error (extend `packages/connectors/src/dropbox-file-source.unit.test.ts`). This fails today, because the code throws a bare `Error` (`dropbox-file-source.ts`:383-385). A `retry_error` and a 409 with an unknown tag are not decision errors (extend `a-refusal-we-wrote-and-then-could-not-read`). A Dropbox migration with two or more `policy_refused` failures shows the Dropbox sentence in its rows and in the group panel, in both languages, and a Drive migration's still shows *Export format for Google files* (beside `a-category-that-reached-a-screen-with-nothing-to-say.unit.test.ts`); this fails today, because the remedy is chosen by category alone. Both `/failures` answers carry the source kind: extend the appliance's case (`apps/selfhost/src/selfhost-queues.integration.test.ts`:314), and add one for managed's, whose route test lists the route only (`operating-routes.unit.test.ts`:58). The choice is made in one place, a `remedyKey(category, sourceKind)` in `failure-key.ts`, and a guard reads `apps/web/src` and fails on any file outside `failure-key.ts` that indexes `FAILURE_KEY` itself, apart from `Connections.tsx`, `Support.tsx` and `LiveProgress.tsx`, which it names with the domain-level reason above, so a new screen that shows an item's remedy cannot miss the source. |
| T6 park on first sight | (a) ✅ **Done** with T5 in #1297, merged 2026-09-28 (`a34c152`) — *was:* 📋 **Decided 2026-09-26** (D6), **alpha minimum**. (b) ✅ **Already built** | **(a)** T5's refusals are decision errors, so the file is parked on its first attempt, instead of waiting on a person after its fifth. It never counts toward the 25-in-a-row tripwire (`domain-sync.ts`:1771-1773). That matters for an account with 25 or more Paper docs: once the rest of the tree is copied, every one still being retried counts toward the same 25 in a pass, whatever folder it is in (T1 (b)). Drive met the same case: refused Google Forms stopped a whole pass over a folder of Docs (:1764-1770). Only the decision set T5 names parks; a transient export answer never does. This does not by itself explain "no other file moves" (T1); if T1 finds the tripwire candidate, T6 (a) is what removes it. **Guard:** extend `a-park-that-counted-as-five-attempts` with a Dropbox `.paper`, parked after one attempt (today it waits on a person after five and is never parked). **(b) Already built.** A failed item is recorded and the pass carries on (`domain-sync.ts`:1746; `failure-isolation.unit.test.ts`:137, :245). A Dropbox-shaped case there is a regression test, not a guard that fails today. |
| T7 Paper docs outside the file tree (legacy Paper) | (a) 📋 **Decided 2026-09-26** (D3), **after** the alpha (D6). (b) 🅿️ **Parked (trigger: the owner reopens D3, for instance when a tester asks for legacy Paper docs, or Dropbox offers a route for them that is not deprecated)** | When Dropbox's `paper_as_files` feature is off, *"the user's Paper docs are stored separate from Dropbox files and folders and should be accessed via the /paper endpoints"* (`users.stone`:71-76). `files/list_folder` is the only file listing the source makes (`dropbox-file-source.ts`:149, :167, and the probe's :227, :244), and it never returns them: no 409, no failure row, no count. Today the docs' *"Sharing state, file requests, Paper docs and version history stay behind"* covers them (`docs/dropbox-setup.md`:111). Once T9 changes that line, they need a sentence of their own. **(a) Detect and say so (D3).** One `users/features/get_values` call for `paper_as_files` (`users.stone`:355-361), and a stated line: "Paper docs outside the Dropbox file tree were not migrated". Its scope, `account_info.read`, is the one the source already needs for `users/get_space_usage` (`dropbox-file-source.ts`:211; `users.stone`:364-370). #1194 merged into `main` on 2026-09-26, and the consent URL now asks for it (`DROPBOX_CONSENT_SCOPES`, `dropbox-consent.ts`:50-53, set on the URL at :80), so (a) has its scope. The reason it had to be asked for, that Dropbox grants only the scopes the URL names, comes from Dropbox's OAuth guide as read in a search engine's excerpts (0140's Status, 0140:106-115); it was not checked here, because dropbox.com was blocked. 0140 §3's T7 (b) still names the two files scopes only (0140:725), and 0140's Status records the departure. A `missing_scope` answer is stated as "could not check", never read as "not legacy" (`account-qualification.unit.test.ts`:484). Summaries of Dropbox's migration guide say a `paper_as_files` account can also hold legacy docs (not checked). So the docs keep a general line too (T9). **(b) Their export** needs `paper/docs/list` and `paper/docs/download`, which are deprecated (`paper.stone`:4, :52, :95). It stays parked because D3 chose not to export them. **Guard for (a):** a `missing_scope/account_info.read` answer is reported as "could not check" (beside the space-usage case in `packages/orchestration/src/account-qualification.unit.test.ts`:484, or in `dropbox-file-source.unit.test.ts`). |
| T8 live proof | ⏳ **Owner** | On the owner's managed migration. **First** read the existing `.paper` row's `attempt_count` and `parked_at`. Expect `attempt_count` 5 (fewer if passes stopped, T1 (b)) and `parked_at` NULL. An ordinary failure waits on a person because of its count, and only a decision error is parked (`domain-sync.ts`:332, :1860; `ledger.ts`:564, :844; the test "still waits on a person once its attempts run out", `a-park-that-counted-as-five-attempts.unit.test.ts`:133-146). Neither kind is fetched again until Retry (`ledger.ts`:875-879). **If the row waits on a person, press Retry once T5 has landed**, and record the category and message from that new attempt. Retry is needed whenever the key does not change: throughout the alpha (D6), and after T3 under `refuse`. Only a chosen format renames the entry, and then its `formerPaths` close the old row (T3 (b)). **Then record:** the Paper doc exported (under which name) or parked with its stated category; what `files/export` answered (the `export_format` values the entry offers, and the result header); the pass summary (created, skipped, failed, needs decision), with the rest of the tree moving, which must not be expected from T6 alone; and a second pass that creates nothing. In the pass that parks it, a refused Paper doc counts under both failed and needs decision (`domain-sync.ts`:1771-1772, :1885-1887). Later passes count it under needs decision only (:1444-1448), and it never counts toward the tripwire. **If the owner connects Dropbox again** after #1194, record the Test's *Measured* line on that token. `users/get_space_usage` needs `account_info.read`, so a figure there shows on the wire that the grant carries it (T7 (a)); once T7 (a) is built, its own call must not answer `missing_scope`. The token answer's `scope` field is read and checked at the exchange but not stored (`dropbox-consent.ts`:160), so it cannot be recorded afterwards. **Name the stack** (open question 1). It counts as 0141 T3's Dropbox half only if it meets 0141 T1's rules (0141:465-483) and also does what 0141 T3 asks: on live, a tree with nested folders, and a rename and a deletion after the first pass, the deletion arriving as `trashed`-class evidence (0141:552-560), with the first consent after 0140 T7 (b) recorded (0141:561-562). Otherwise it is a regression proof only. This is the row the whole plan exists for. |
| T9 the words become true, here and in other plans | ✅ **The docs, the guides and the matrix changed** with T5 in #1298, merged 2026-09-28 (`93958ac`); they changed again with T3 (d), merged in #1311 (`dee0a33`), which says what the screens do; the 0144 entry waits for its page — *was:* 📋 **Decided 2026-09-26** (D6), alpha minimum. Its cross-references ✅ **landed 2026-09-26** with this correction | The docs already say Paper docs *"stay behind"* (`docs/dropbox-setup.md`:111, `docs/guides/en/dropbox.md`:26, `docs/guides/nl/dropbox.md`:26), while the code tries every `.paper` and fails. They change with the code, not before. When T5 lands, and again when T4 lands, change them to what the code does: Paper docs are refused and parked by name, later exported in the chosen format, and Paper docs outside the file tree still stay behind (T7). The same lines' next sentence, that a deleted-entry read *"is not yet supported"* (`docs/dropbox-setup.md`:113-114; the guides' :26), is a separate inaccuracy: `listTrashedPaths` has read tombstones since 0055 T3b (`dropbox-file-source.ts`:301-305; `dav-sync.ts`:432-436). T9 corrects it in the same edit. Add a Dropbox native-files row to the open gaps in `docs/feature-matrix.md`, where only "Dropbox against a real account" stands today (:403). Add a 0144 known-limitations entry once 0144 T2's page exists, which is after the first invitation; until then the Dropbox guides carry the limit (D6). With the matrix row it is a `gap` entry, which the guard 0144 T2 proposes would require; that guard does not exist yet. **Cross-references, landed 2026-09-26:** 0055 T3 (native formats go to 0150, and (e), Dropbox's missing 429 handling); 0141 T3 (its sitting records the Paper doc; T8); 0125 (the `nativeFilePolicy` may-change row widens its wording, D7); 0131 T5 (a 0150 row, and the range "0132 to 0149" becomes "0132 to 0150") and 0131 §6 (M8, an M group for 0150, D6 and D7); 0144 T2 (the known-limitations entry, a `gap` entry, proposed, written with 0144 T2). |

## What this is

The owner's live Dropbox→Nextcloud migration sticks on one file. The error is the wire telling us
what it is: a Dropbox Paper document lists in `files/list_folder` like any file, but
`files/download` answers 409 `unsupported_file`. Paper docs are not files, they are editors,
exactly like a Google Doc is not a file and Drive answers `cannotExportFile` or needs
`files.export`. The connector is modelled on the Drive source for listing, cursors, and keys, but
the Drive source's native-file machinery (the export policy, the stated refusal, the parked
decision) was not carried across. Workplan 0055 listed Paper docs under *What does not migrate*
(`docs/dropbox-setup.md`:109-111, and later the guides), but built nothing to leave them behind:
`listSince` keeps every `.tag: file` entry (`dropbox-file-source.ts`:257-260), and `fetch()` sends
each one to `files/download`. The connector had never been run against a real account (0055 T3 (a)
⛔, the matrix's ⏳), so the gap stayed hidden until the owner's migration met a Paper doc.

And `.paper` is the canary, not the whole bird. Other Dropbox entries may refuse download for the
same structural reason, and we should not discover each one through a new owner incident:

- **`.paper` / `.papert`**: Paper docs and templates. They are listed as files on accounts with
  Dropbox's `paper_as_files` feature, which the spec describes for new Paper users (`paper.stone`:4;
  `users.stone`:71-76). Summaries of Dropbox's migration guide date it from 2019, and say older
  accounts moved later (not checked). They carry `is_downloadable: false` and are exported via
  `files/export`, in a format the entry's `export_info` lists.
- **`.web`**: Dropbox's own web shortcut. Reported as not downloadable. Whether `files/export`
  answers for it is for T2 to record (one report says it does, in a `url` format). `.url` and
  `.webloc` are not on this list: they are ordinary files that `files/download` returns, and they
  migrate today.
- **Google files in Dropbox** (`.gdoc`, `.gsheet`, `.gslides`). The API documents them as
  exportable: its own `files/export` example turns `Prime_Numbers.gsheet` into
  `Prime_Numbers.xlsx` (`files.stone`:1664, :1682). This plan first said third-party tools left
  them and that Dropbox would not export them. Reports say they came from Dropbox's own Google
  integration, and that from 2023 such files were moved to Google Drive, leaving shortcuts, or
  converted to Office files, so few may remain (search summaries; not checked). T2 records what a
  real account lists. An entry with `export_info` is exported like Paper.

The rule behind every entry above is one field, not an extension: an entry with
`is_downloadable: false` must be exported (`files.stone`:822-826). A tombstone is the one place the
rule has to fall back to the extension, because a deleted entry carries neither field
(`files.stone`:896-899; T3 (b)). "Online-only" is a desktop sync state with no field in the API, so
it is not a kind.

Three defects, one root: **the Dropbox source treats native formats as ordinary download failures.**

1. **An unstated category.** The bare `Error` from `download()` is classified from its prose and
   from the side the pass tagged. `fetchRaw` is tagged `source`, so the row reads `source_refused`
   today, and the owner is told the old account would not hand the file over
   (`strings.ts`:1340-1341). That is the wrong answer for a Paper doc Dropbox would export: the old
   account would hand it over, and only Ownpace declines it, which is `policy_refused`
   (`failure-category.ts`:134-143). Only a category stated where the error is thrown can say so.
   Before T3 there is no setting to change the answer, and a Paper doc still states
   `policy_refused`, with a remedy that names no setting (D9). A `.paper` listed above 8 MiB is
   downloaded inside the target's write, and reads `target_refused`. In the Drive source,
   `NativeFileRefused` states the category (`google-drive-source.ts`:124-210). `drive-refusal.ts`
   only marks a download refusal as a decision.
2. **Not a decision.** A file that fails the same way every time is not the world breaking, but
   the Paper 409 is an ordinary error. It is tried on five passes, and then waits on a person. It
   counts toward the 25-in-a-row tripwire (`domain-sync.ts`:58). Only an item fetched and written
   resets the count (:1713); a file skipped before the fetch does not (:1402-1414). Once the rest
   of the tree is copied, every Paper doc still being retried counts toward 25 in that pass,
   whatever folder it is in, so 25 retryable failures in one pass stop that pass
   (`PassAbortError`, :1909-1916). A stopped pass does not reach the folders listed after the 25th
   failure, so new or changed files there do not move until the Paper docs reach the ceiling. One
   Paper doc alone cannot trip it. For Dropbox, which lists every folder in full on every pass
   (`dropbox-file-source.ts`:253, :267-268), a held cursor costs nothing. Whether any of this
   explains "no other file moves" is T1's open half.
3. **No way out.** No setting makes a `.paper` migratable, so the only honest answer is "leave it
   behind". The docs already promise that, but the code does not do it: it tries and fails (T9).
   Dropbox offers `files/export` for `.paper` files, with the format passed as `export_format`
   from the entry's own `export_info` (for Paper, `html` and `markdown`). That is the same shape as
   Drive's `files.export`. The route is marked preview (T4).

## The owner's words

This section is for the owner's own words, dated and with their place, as the other plans quote
them. None were recorded for 0150. The two commits that wrote the plan carry a subject line only,
and PR #1183's description paraphrases (*"no other file moves"*). So, plainly:

- **The format picker.** The owner asked that the user choose the format that arrives at the
  target (T3). The words, their date and where they were said were not recorded.
- **One file stops everything.** The owner reported that one file stops the migration and no other
  file moves (T1, T6). The words, their date and where they were said were not recorded.
- **The T1 error** was quoted with its path shortened, and where it was read was not recorded (T1).

Open questions 1 and 2 ask for them.

## Decisions

On 2026-09-26 the owner read the check of this plan, with its questions and a recommended answer
for each, and was asked: *"Should I open a docs PR with those corrections? It would use my
recommended answers unless you answer differently."* The answer, word for word: *"yes, open the
0150 docs PR with your recommendations"*.

So the eight questions that were choices take the option marked *Recommended*. Each decision gives
the question in plain words, then the answer as given, as 0149 §2 does. For D1 to D8 the answer is
the owner's one sentence above; D9 quotes its own. After it comes the option that sentence takes,
as the question put it. Where a fact in a recommendation did not hold against the code, the
decision says so and says what follows. The question on T1's evidence was not a choice, and stays
open (open question 1). A review of this correction found one more choice that none of the eight
settles, the category a Paper doc states before T3. It was asked as open question 4, and the owner
answered it the same day (D9).

**D1 — no format chosen, and when the picker shows (T3, T5).** *When a migration has chosen no
format for Paper docs, is a Paper doc refused, or exported as Markdown or HTML?* — *"yes, open the
0150 docs PR with your recommendations"* (2026-09-26), so option (a): no format chosen means
refuse. A stated `policy_refused`, parked on first sight, as Drive does when nothing is set
(`config.ts`:237; `google-drive-source.ts`:316). The wizard shows the Paper picker for every Dropbox
migration that carries files, and suggests Markdown, which Nextcloud's Text app opens. Which
formats a real `.paper` offers is for T2 to confirm (open question 3). Before T3 there is no format
to choose; the category a Paper doc states then is D9's.

**D2 — building on a preview route (T4).** *`files/export` is marked `is_preview`, "subject to
breaking changes without notice". Build on it, or wait until Dropbox drops the flag?* — *"yes,
open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): build on it, with a
contract test, a live record in T8, and answers the code does not recognise kept retryable. It is
the only route Dropbox offers for `.paper` files, and the `/paper` routes are deprecated.

**D3 — Paper docs outside the file tree (T7).** *Detect such an account and say so, leave it to
the docs line, or build the deprecated `paper/docs/*` export?* — *"yes, open the 0150 docs PR with
your recommendations"* (2026-09-26), so option (a): detect it and say so; do not export. The
detection needs `account_info.read`. #1194 merged on 2026-09-26, and the consent URL now asks for
it (T7). That it had to be asked for at all rests on Dropbox's OAuth guide as read in a search
engine's excerpts (0140's Status), not checked here.

**D4 — the arrival name (T3 (b)).** *`Notes.paper.md` or `Notes.md`?* — *"yes, open the 0150 docs
PR with your recommendations"* (2026-09-26), so option (a): append, `Notes.paper.md`. This is the
rule the owner chose for Drive on 2026-09-23 (0042 T8 (c), `Budget.xls.xlsx`), and it cannot
collide with a real `Notes.md`. Replacing would put two items on one key, which the ledger cannot
hold (`google-drive-source.ts`:38-41).

**D5 — a kind with no export path (T3, T5).** *A stated refusal, parked, or a new "skip, counted"
outcome?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so option (a):
a stated `source_refused`, parked, which the person leaves behind, as a Drive shortcut is. It needs
no new core outcome: `fetch()` returns bytes or throws (`ports.ts`:324-331; `dav-sync.ts`:385-388).
Dropping the entry at listing would be the silent skip `an-item-the-listing-dropped-in-silence`
warns about. That guard would not catch a plain `continue`, because it reads only a `catch` that
logs *Failed to process*, so D5's guard must: extend the natural-key cases of
`dropbox-file-source.unit.test.ts` (:89, :111) so that a listing holding a `.paper` entry returns
it as an item. **One part of the recommendation did not hold.** It said the confirm screen counts
such a file. Drive's count before Start covers `policy_refused` files only, on purpose, because
its line offers a format as the remedy (`google-drive-source.ts`:459, :1206-1209;
`strings.ts`:117-118), and a Drive shortcut is not counted. So T3 (d) follows Drive, and a kind
with no export path shows on the Failures page, as a Drive shortcut does.

**D6 — the alpha (all tasks).** *Must Paper docs migrate in the alpha?* — *"yes, open the 0150
docs PR with your recommendations"* (2026-09-26), so option (a): no. The alpha minimum is T5,
T6 (a), T9's lines (the Dropbox docs and guides, and the feature-matrix row) and a 0144
known-limitations entry. T3 and T4 come after. Until T3, the refusal points to no setting.
**Amended 2026-09-28:** asked whether Paper export should come before the alpha after all, the
owner answered *"yes, paper export before the alpha"*. So T3 and T4 join the alpha minimum, with
T2's listing before them (open question 3). T7 (a) stays after the alpha.
**One part of the recommendation did not hold.** The 0144 entry lives on the page 0144 T2 builds
after the first invitation (0144:210). Until that page exists, the Dropbox guides carry the limit
(T9), and the entry is written with 0144 T2.

**D7 — the key, and who builds it (T3).** *Reuse `nativeFilePolicies` with a `paper` kind, or add
a Dropbox key?* — *"yes, open the 0150 docs PR with your recommendations"* (2026-09-26), so
option (a): reuse `nativeFilePolicies` with a `paper` kind. The update door's check becomes
source-aware (today it runs the Google parser for every source, `index.ts`:1760). The Google-typed
kinds widen (`google-native-coverage.ts`:110; `config.ts`:1278-1283). 0125's revision row widens
its wording. One key, one panel, one revision rule. **The builder is an M group**, M8 in 0131 §6,
because this is connector work. Files that R's groups change are touched from M8's step 2 (from
step 1 since D9, which puts `strings.ts` and the failures route in T5): T9's lines edit
`docs/guides/*/dropbox.md`, in R3's `docs/guides/`, and `feature-matrix.md`, in R2's list, and
T3's wizard and create-route edits touch `CreateMapping.tsx` and the create route. So by 0131 §6's
out-of-turn rule those steps wait for R's open pull request on those files, or rebase on it, and
the description says which.

**D8 — an ADR (T3, T4).** *Amend ADR-0046, or write a new ADR for Dropbox exports?* — *"yes, open
the 0150 docs PR with your recommendations"* (2026-09-26), so option (a): amend ADR-0046's operative
rule to name Dropbox: a rewrite follows the listing's version, and a renamed export is paired by
the Dropbox id. The amendment is part of T3's and T4's definition of done, in their pull requests.
ADR-0046 is not amended here, because nothing is built.

**D9 — the category a Paper doc states before T3 (T5).** *Before T3 there is no format to choose.
Does a Paper doc then state `policy_refused`, with a remedy that names no setting, or
`source_refused`?* (open question 4) — *"open question 4: (a), policy_refused as recommended"*
(2026-09-26), so option (a): `policy_refused`, as D1 reads; the remedy for a Paper doc names no
setting until T3 and names the new setting from T3 on; Drive's text stays as it is. So a Paper doc
states `policy_refused` from T5 on, before T3 and after: the old account would hand the file over,
and only Ownpace declines it (`failure-category.ts`:135-136). No row has to change category when T3
lands. Until T3, the other half of that definition, *"a setting on the mapping is what changed the
answer"* (:136-137), does not hold for a Paper doc, because there is no setting yet. D9 departs
from it until then, and T5 says so in that comment. The question gave the migration's source only
as an example of how the remedy could be chosen; the plan takes it. **One part of the
recommendation did not hold.** It said the change touches `strings.ts` and the Failures page. The
page shows the remedy from two files, its rows (`Failures.tsx`:90) and its group panel
(`FailureGroupPanel.tsx`:274), and neither has the source to choose by: no payload the page reads
carries it, and the appliance has no mapping API to ask. So the failures payload carries the
source kind, and T5 also touches the shared contract and both editions' `/failures`. The
Connections page, the support view and the live progress show a remedy by category too, but from
the domain-level category, which never holds `policy_refused`, so they do not change (T5). In the
alpha minimum, `strings.ts` and the managed failures route are files R's groups change (0131 §6,
M8 step 1).

**D10 — Start and the count it is pressed on (T3 (d)).** *Should the start screen hold Start while
it is still counting what the source holds?* The owner pressed Start at 17:23 on 2026-09-28, and
the count, with the Paper line and its tick-box, landed at 17:30; the screen stopped asking at five
minutes, and that count took about seven. — *"Hold, up to 15 min"* (2026-09-28), the first of
three options, over *"Hold, up to 5 min"* and *"Keep as is"*. So Start stays greyed out while a
count the screen waits for is still coming, with a line saying so. After five minutes the screen
keeps asking, more slowly. If the count has not landed within fifteen minutes, Start opens with a
line saying it did not finish. Built in `ConfirmMigration.tsx` (Status, 2026-09-29). The owner
kept both lines as written on 2026-09-29: *"Yes"*.

## The shape of the fix (Drive, mirrored)

- **The listing names what arrives.** It reads `is_downloadable` and `export_info`, and names each
  native entry under the policy in force (D4: `Notes.paper.md`), with `formerPaths` for its other
  names. That name is the natural key, as in Drive. The listing still keeps every entry; nothing is
  filtered out. A tombstone carries neither field, so the trash read names a deleted `.paper` by
  its extension, under both names (T3 (b)). The version stays the listing's
  `content_hash`/`server_modified`, if T2 shows it moves on an edit.
- **`fetch()` decides by kind, before the size gate.** An exportable kind with no format chosen, or
  with `refuse`, gets a stated `policy_refused` that names the setting (D1). Before T3 it names
  none, and still states `policy_refused`; the Failures page gives a Dropbox migration a remedy
  that names no setting (D9). A kind with no export path gets a stated `source_refused` (D5). A
  kind with a format chosen goes through `files/export`, buffered, with an `export_format` the
  entry offers. Every other file downloads as today.
- **An export answer is routed by its tag.** `non_exportable` and `invalid_export_format` are
  stated refusals (T5). `retry_error`, any other or unknown tag, 429 and 5xx are ordinary failures,
  and are retried. `path/not_found` means the file is gone. The wire text is quoted every time.
- **Parked as a decision** on the first attempt, so the pass keeps moving. On the Failures page, a
  `policy_refused` Paper doc sits with the policy refusals the owner knows from Drive, and a
  `source_refused` entry sits with what the source would not hand over. The confirm screen counts
  the `policy_refused` ones before Start, as Drive's does (T3 (d)).

## What is NOT here

- No export of Paper docs outside the file tree (legacy Paper). T7 (a) detects such an account and
  says so; the deprecated `paper/docs/*` export stays parked, because D3 chose not to export them
  (T7 (b)).
- No Paper→Nextcloud *format conversion* beyond what Dropbox's own export renders (no HTML→md reflow
  in our code — we move what Dropbox hands over).
- No special case for Google files in Dropbox. They follow the same `is_downloadable`/`export_info`
  rule as every other entry.
- No change to Drive, Box or WebDAV native handling; their tests are the regression net. The shared
  piece T3 widens, `ExportPolicyPanel`, keeps its Drive behaviour. T5 chooses the `policy_refused`
  remedy by source (D9), and Drive's sentence, `failure.policyRefused`, is unchanged.
- No 429 or `Retry-After` handling for the Dropbox connector as a whole. It is missing for
  `list_folder` and `download` too, and it predates this plan. 0055 T3 (e) records it, not planned
  yet (hard rule 4). T5 only makes sure a 429 on export is never turned into a decision.
- No change to the product docs in this correction; T9 changes them when T5 lands.

## Lessons that apply

Before editing a file, grep `docs/LESSONS.md` for it (`AGENTS.md`, session protocol). For this plan:

- `a-deck-that-would-be-rewritten-nightly`: a rewrite follows the listing's version (T3 (b));
- `a-list-somebody-deletes-on-the-strength-of`: the key and the absence count (T3 (b));
- `a-chooser-one-google-kind-could-not-reach`: the chooser's coverage (T3 (c));
- `a-ceiling-the-screen-could-not-see`: the screen shows what the server honours (T3 (c)).

Two guards already read `dropbox-file-source.ts`. The byte-read lesson,
`the-decode-that-was-waiting-in-the-next-connector`, covers the export's bytes (T4).
`a-hash-that-was-never-sha256` says change detection stays on the version: an exported entry's
listed `content_hash` is the `.paper`'s block hash, never the export's (T3 (b)).

## Open questions

1. **T1's evidence (T1, T8).** From the owner's migration: the pass summaries (created, skipped,
   failed, needs decision), and whether any pass ended with a stop; the `.paper` rows
   (`last_error_category`, `attempt_count`, `parked_at`, and the error text each stores, in full),
   with the number of rows whose `attempt_count` is below 5; and the stack the migration runs on.
   *Recommended:* read them before anything is built. They decide T1's open half, and whether T8
   counts for 0141 T3. *Partly answered 2026-09-28:* one row, `source_refused`, 5 attempts, not
   parked. *Later the same day:* the error text in full, and the passes: ten, and none ended
   (Status). *Answered later still:* each was killed for memory while copying, SIGKILL on
   `small-1x` (Status), read from the plane's own record by the migration's run tag. The read
   prints no payload; blank out any file name a message holds before pasting it anywhere:

   ```bash
   docker exec -i ownpace-managed-trigger-db psql -U trigger -d triggerdb <<'SQL'
   SELECT "createdAt", "friendlyId", status, "taskVersion", error->>'code' AS code,
          left(error->>'message', 160) AS message, "machinePreset", "attemptNumber",
          round(extract(epoch FROM ("updatedAt" - coalesce("startedAt", "createdAt"))) / 60) AS ran_min
     FROM "TaskRun"
    WHERE "taskIdentifier" = 'run-delta-sync' AND 'mapping:MIGRATION-ID' = ANY("runTags")
    ORDER BY "createdAt" DESC LIMIT 20;
   SQL
   ```

   *Still owed:* the first pass after the fix is deployed, read the same way. If it dies too, the
   run container's memory while it runs says where. A run's container is named `runner-` and its
   `friendlyId` without `run_`. Its memory, every 30 seconds, stopped with Ctrl-C:

   ```bash
   while true; do
     docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' |
       sed -n "s/^runner-/$(date -u +%H:%M:%S) runner-/p"
     sleep 30
   done | tee -a pass-memory.log
   ```
2. **The owner's words (*The owner's words*).** The request for a format picker, and the report
   that one file stops everything, were never recorded word for word, with a date and a place. If
   the owner still has them, in a message or a screenshot, they go into that section as given. If
   not, the section keeps saying they were not recorded, and nothing waits on them.
3. **What T2's listing decides (T2, T3, T4).** Not a question for the owner, apart from the listing
   itself, which needs the owner's account. (a) Which `export_format` values a real `.paper` offers,
   so D1's suggested Markdown is one the entry lists. (b) Whether `content_hash`, `rev` or
   `server_modified` moves after a Paper edit. If none does, T3 (b) picks another signal and says
   why, and D8's ADR-0046 amendment names it. (c) Which other kinds a real account lists (`.web`,
   Google files), and which of them have no export path, so fall under D5. (d) The size a `.paper`
   is listed with. *Answered 2026-09-28, from the owner's account, apart from (b):* (a) `html`,
   its `export_as`, and `markdown`, and both exports answer; (c) one Paper doc among 55,245
   files, no template, and no other kind that refuses a download; (d) 200 bytes, against 27,041
   exported as HTML and 6,312 as Markdown. (b) waits on the `--versions` diff around an edit;
   all three fields are set on the doc.
4. **The category a Paper doc states before T3 (T5).** D1 took `policy_refused` for a Paper doc
   with no format chosen, and D6 said that until T3 the refusal points to no setting. Neither says
   which category applies before T3, when there is no format to choose, and the two meet on the
   Failures page. It picks a group's remedy by category alone (`apps/web/src/i18n/failure-key.ts`:32),
   and the `policy_refused` remedy names Google's setting: *"Choose one both sides can handle under
   Export format for Google files"* (`strings.ts`:1328-1329). This correction first wrote the
   answer as `source_refused`, under *Decisions*. The owner did not decide that, so it is asked
   here.
   (a) `policy_refused`, as D1 reads. The old account would hand the file over, and only Ownpace
   declines it, which is what the category means (`failure-category.ts`:134-143). The cost: for a
   Paper doc its remedy must name no setting, and Drive's text must stay as it is, because the
   owner reworded it on 2026-09-22 to name the setting. The remedy follows the category alone
   today, so the Failures page has to choose it by more than the category, for instance by the
   migration's source. That touches `strings.ts` and the Failures page, which R's groups change,
   in the alpha minimum. From T3 on, the row keeps its category, and the remedy names the new
   setting.
   (b) `source_refused`, with the item's own message saying Ownpace does not export Paper docs yet.
   No change to the Failures page. The cost: the group's remedy says *"the old account would not
   hand this over"* and *"Try again if that has changed"* (`strings.ts`:1340-1341). That is the
   answer defect 1 calls wrong, and it disagrees with the item's own message. A row parked this way
   keeps `source_refused` after T3, until Retry is pressed (`ledger.ts`:875-879) or a chosen format
   changes its key (T3 (b)).
   *Recommended:* (a). It is D1 as the owner took it, the category's own definition fits, and no
   row has to change category when T3 lands.
   *Answered 2026-09-26: (a) (D9).* The owner: *"open question 4: (a), policy_refused as
   recommended"*.
