# Workplan 0162 — A test organisation copies only what is marked

> **In one line:** Testing on live with a real account: an organisation the operator marks as a test copies only the items whose title carries its marker, such as `[Ownpace-test]`, filtered where the source is first listed, and its migrations can never be finished or switched over.

## Status — 2026-11-21 (update this block at the end of every session)

**2026-11-21, later: four of the five things T1 settles first, settled, on
`claude/ownpace-public-readiness-y7orc6-0162-t1-doors`, from `main` at `17548646`; not merged.**
T3 merged as #2003 on 2026-11-21 (`cba6c64d`); its E2E (managed) run 44911194184 was green on
its head. Still inert: nothing sets the column, and no migration anywhere carries a marker. The
fifth, the Finish page's End and Keep, comes with T1.

1. **The sharing rescan and the permission report keep only what the marker selects.** Both read
   the account's sharing through `migrationInventoryScans` (`apps/api/src/routes/permissions.ts`).
   It now reads the migration's marker from its own row and, under one, runs the two scans once
   and keeps a grant only when the thing it is on carries the marker in its own name, by T2's
   `carriesMarker` (`markedSharesOnly`, `marked-only.ts`). The thing's own name decides, as for a
   file: a marked folder's share is kept, an unmarked file in it is not, and a marked file in an
   unmarked folder is. So nothing about an unmarked item is saved into `share_grant` or returned
   in the report.
   - Each scan now says that name beside the label around it (`PermissionGrant.ownName`): a Drive
     file's name, the last segment of a Nextcloud share's path, and Graph's item and calendar
     names. Never the mailbox a calendar's label starts with, and never the id a Graph label ends
     in where Graph gave no name.
   - A grant a scan gave without a name (a Nextcloud share without a path; a Drive file, a Graph
     item or a calendar without a name) can be neither kept nor set aside. The rescan then
     answers 409 and saves nothing, and the report answers 409, both with `code: test_migration`
     and one sentence in English and Dutch (`A_TEST_MIGRATIONS_SHARING_NAMED_NOTHING`, in
     shared's `permissions.ts`). The Sharing page shows a refused rescan's reason in its reader's
     language, where it said the request did not complete; that holds for every migration, and
     for a closed organisation's refusal and a migration that records no mailbox too.
   - The report asked for by address (`?mailbox=`) names no migration and reads every source the
     organisation connected. It is refused, with `code: test_organisation`, in an organisation one
     of whose migrations carries a marker (`A_TEST_ORGANISATIONS_SHARING_IS_PER_MIGRATION`).
   - No row needs cleaning up: no migration has carried a marker, so no rescan saved a test's
     sharing.
2. **A Dropbox rename and the bin: confirmed, and fixed.** Through the real `DropboxFileSource`
   over a fake HTTP answer: a marked file renamed out of the marker is listed under its new name
   with the same `id`, and its old, marked path answers `list_folder` with `include_deleted` as a
   tombstone, which has no id. The pass recorded the old path's copy as `trashed`, the evidence
   an apply may act on, on every pass, while the file was still there. A rename between two
   marked names got the same `trashed` beside its relocation.
   - What ties the two is the ledger: the row the old path keys holds the `id` its copy was made
     from (`sourceRef`), and the listing gives the same `id` under the new name. Under a marker
     the file pass now gathers the handle of every file the source lists, kept or set aside
     (`listedFileRefs`, `domain-sync.ts`), and the bin passes over a row whose handle is among
     them. A file renamed out of the marker and then deleted for good is still reported as
     `trashed`, at once.
   - Dropbox's developer documentation could not be reached from where this was built, so the
     fake follows the connector's own reading of the API (`DropboxEntry`, `listTrashedPaths`) and
     is unconfirmed against Dropbox. The fix does not rest on it: it reads the row's handle and
     the listing, never the tombstone's fields.
   - Found on the way, and left as it is: without a marker the same tombstone is read as the bin
     too, beside the relocation. Changing that changes what every Dropbox migration reports,
     which is not this plan's to decide; a test holds that a migration that is not a test
     reports as before.
3. **IMAP subjects in memory: they stay as they are.** Every path that receives a listed message
   was read, and none stores or logs `MailItem.subject`:
   - the pass (`reconcile.ts`): a message is keyed by its Message-ID and named from the bytes it
     fetched (`displayNameForMessage`), which is also the name a failure row stores; the loop's
     log lines carry key prefixes;
   - its bin read: keys only;
   - discovery (`discoverSource`): counts, sizes and key hashes;
   - `fetch` and the two mail writers (`jmap-target.ts`, `imapflow-dav-target.ts`): they read
     `raw.rfc822` only;
   - the wrappers between (`GmailFolderView`, `MailSourceWithGraphFallback`, `MarkedOnlyMail`):
     none logs, and imapflow's own logger is off (`logger: false`).

   The one reader is T2's mail filter (`MarkedOnlyMail`, `carriesMarker(item.subject, …)`), and it
   needs it: without a subject no message carries the marker.
4. **A status update no longer switches a test migration over.** `updateTransition` takes the
   migration's marker and refuses the four moves that would: declaring the cutover (`active` or
   `paused` to `cutover`) and entering the lane (`cutover` or `done` to `continuous`). It answers
   with `test_migration` and T3's sentence in both languages (`A_TEST_IS_NOT_SWITCHED_OVER`).
   `PUT /api/migrations/:id` reads the marker with the status, in its own transaction, and
   answers `message` and `messageNl`. Pausing stays open, as does leaving the lane, and a resume
   is still Start's, which takes a test. `active` or `paused` to `continuous` keeps the table's
   own refusal (`before_cutover`). The appliance passes no marker.

What is proven, and how. 50 new cases in ten unit test files, four of them new. Each door or rule
refuses or filters with a marker, and lets the same migration through without one:

- the sharing rescan and the permission report, at the API's own doors on PGlite, through the real
  Nextcloud scan over a faked OCS answer and the real Drive scan over a faked Drive answer, with
  `share_grant` read outside any route (10): the marked things saved and reported and no unmarked
  one, nor anyone an unmarked thing was shared with; the refusals in both languages, with nothing
  written; the report asked for by address refused in a test organisation, and made in another; and
  every share kept for a migration without a marker;
- `markedSharesOnly` (5), and the name each of the four scans gives and does not give (4);
- the Dropbox rename, through the real `DropboxFileSource` and `runFileSync` (7);
- the status update, at the API's own door on PGlite with the rows, the paths and the audit read
  outside it (7), in `updateTransition`'s whole table (13), and in the handler's text (1);
- the Sharing page, in English and Dutch (3).

Twenty-two mutations, each one change, each caught, each file restored byte for byte (`cmp`): each
refusal taken out (the update's 9 of 20, its declare half 5, its enter half 4; the handler's marker
7 of 58, its Dutch 4 of 20; the rescan's and the report's 1 of 10 each; the report asked for by
address 1 of 10; an unnamed grant kept 3 of 42), each filter undone (every grant kept 6 of 42, the
label read instead of the name 4 of 42, the marker ignored by the scans 5 of 10), each name left out
(Nextcloud 4 of 20, Drive 2 of 53, Graph's calendar and item 1 of 12 each, Graph naming by id 1 of
12), the Dropbox rule (the bin's check 3 of 7, the set-aside handles 2 of 7, the kept ones 1 of 7,
the rule for every migration 1 of 7), and the page 2 of 21.

Gates: `tsc --noEmit` (the root, `apps/web`, `test/ui` and `site`), TypeScript 6's second opinion,
and ESLint over the whole repository found nothing; the six docs checks pass. The whole `unit`
project passed, 1,154 files and 18,044 cases with 37 skipped, but for two guards under `scripts/`
that run pnpm themselves (`ui-build-output`, and three cases of
`a-measurement-that-could-not-reach-the-deployments-client`), which could not run it on the machine
that built this: the pnpm version `main` names is not installed there. `unit-browser` (`apps/web`)
passed, 190 files and 3,748 cases. Six integration files that drive the touched doors passed on
Postgres 16.15 (`local-pg.sh`), 77 cases. Node 22.22.0 ran them all: no Node 26 is installed there.
The edits after the long runs, comments and the fixtures' addresses, were run again in the files
that read them, and the mutations were run again on the final files.

Not done:
- T1 itself, and with it the fifth thing, the Finish page's End and Keep.
- A test organisation that holds no migration, between two runs (§6 step 7), is not known to the
  report asked for by address until T1 records the organisation's own marker, which goes beside
  `testsWithAMarker`.
- The appliance has no test migrations (§3): its sharing rescan, its report and its status update
  read no marker.
- A test migration's permission report does not say in itself that it lists marked things only:
  T1's banner is not in the Markdown the Finish page downloads.

**2026-11-21: T3 built, on `claude/ownpace-public-readiness-y7orc6-0162-t3-never-finished`, from
`main` at `87663d70`, merged as #2003 (`cba6c64d`; *was:* not merged).** Inert, as T2 is:
nothing sets the column yet, so no migration is refused today. T2 merged as #1975 on 2026-11-21
(`45a758af`). Its E2E (managed) run 44881786816 was green and applied ledger migration 0070 on
the test environment.

- **Each door reads the marker from the migration's own row**, where it never changes, and
  refuses with one of two sentences. They are in `lifecycle.ts`, English and Dutch side by side
  (`A_TEST_IS_NOT_FINISHED`, `A_TEST_IS_NOT_SWITCHED_OVER`).
  - **Finish.** `finishTransition` takes the marker and refuses with *A test migration is not
    finished: delete it when the test is over.*, code `test_migration`, just before its `paused`
    refusal. `force` does not go over it. The managed route reads the marker in `scope()`, with
    the status.
  - **Ending or keeping a data type.** `endOrKeepDataType` (`path-lifecycle-wiring.ts`) reads it
    with `readPathPhases`, in the press's own transaction, and refuses End and Keep with the same
    sentence. The route answers it in both languages (`message` and `messageNl`, `reason` and
    `reasonNl`). The Finish page shows the half in its reader's language.
  - **The cutover's preparation.** `prepareCutover`, the `run-cutover` job's body, refuses before
    anything else: no ledger is made, no final sync runs, no gate is asked, and READY_FOR_CUTOVER
    is never reached. It is a refusal, not a failed cutover, so nothing is recorded and nothing is
    retried. The task reads the marker with `testMarkerOf` (`cutover-gate.ts`). The door that
    enqueues the job, `POST /api/migrations/:id/cutover`, refuses it too, by its own rule that it
    never accepts what the job refuses, and enqueues nothing.
  - **The cutover commands.** `approveCutover`, `executeCutover` and `completeCutover` refuse with
    *A test migration is not switched over: delete it when the test is over.*, before anything is
    read or written, with or without `--yes`, and for one data type too. The CLI reads the marker
    once.
  - **The gate's report.** `runCutoverGate` and the owner's Finish check (`run-verification`) hand
    the marker to `verificationConfigFor`. `runVerification` measures as before.
    `canProceedToCutover` is false whatever the verdict, the first recommendation is the
    sentence, and the report carries `testMarker`. The Verify page's box and the Finish page's
    step 1 say why from that marker, in English and Dutch.
  - **Delete stays open.** Nothing in delete reads the marker. A test migration is deleted through
    the real route, and then its account, which is refused while the migration uses it, as any
    account is.
- **Not in §5, and left as it is.**
  - `PUT /api/migrations/:id`: a status update still declares a test migration's cutover
    (`active` to `cutover`, `updateTransition`) and enters the lane from there.
  - The appliance has no test migrations (§3). Its Finish, its ending of a data type
    (`endOrKeepPath`, called directly) and its check (`verifyMapping`) pass no marker.
  - `start-cutover` and `verify` in the CLI are not refused. `verify` cannot move a test's ledger
    on, because the gate's report holds it.
  - The progress lines read `canProceedToCutover` (`checkFactsOf`), so they say a test whose check
    passed did not pass.
  - The Finish page offers End and Keep for a test's data types: `pathEndingChoices` does not read
    the marker. The press is refused, in the reader's language.
- **Two more for T1**, after the three in the entry on T2's review findings below:
  4. **A status update still declares a test migration's cutover.** `PUT /api/migrations/:id`
     moves it from `active` or `paused` to `cutover` (`updateTransition`). It is then after its
     cutover: the source is no longer the authority, a status update may enter the continuous
     lane from there, and only the CLI's rollback brings it back. Every later door of the cutover
     refuses it, but §2 (e) says a test is never switched over, so this door has to refuse it too
     before any marker is set.
  5. **The Finish page offers End and Keep for a test's data types**, and each press is refused.
     With T1's banner, the page should offer neither.

What is proven, and how. 54 new cases: 53 in eight unit test files, four of them new, and one in
`a-pass-under-row-security.integration.test.ts`; one case of `a-final-sync-of-every-data-type`
now reads the marker in the two calls it reads. Each door refuses with a marker and lets the same
migration through without one:
- the API's own routes on PGlite, with the rows read outside any route (10): Finish, forced or
  not; End and Keep, in both languages; the cutover's door, with nothing enqueued; and delete,
  then the account;
- `finishTransition` and the two sentences (8); `runVerification` (5); `prepareCutover`, the
  gate's configuration, `testMarkerOf` on PGlite, and the doors that read the marker, read as text
  (9); `approve`, `execute` and `complete`, each refusing before any read, without `--yes` and for
  one data type (12); the Verify page (3), the Finish page (5) and the web service (1);
- on Postgres 16 (`local-pg.sh`), under row security as `app_user`: the marker read in its
  organisation's scope and not in another's, and the gate's report holding it.

Twenty-three mutations, each one change, each caught, each file restored byte for byte (`cmp`):
each refusal taken out (`finishTransition` 5 of 62 fail, `endOrKeepDataType` 2 of 38, the
preparation 3 of 41, the cutover's door 1 of 18, `approve`, `execute` and `complete` 3 of 67
each, `canProceedToCutover` 2 of 12), each reader or hand-on of the marker taken out (the Finish
route 2 of 10, the task 1 of 41, the CLI 1 of 41, the gate 2 of 41, the Finish check 2 of 41, the
configuration 1 of 41, `testMarkerOf` 1 of 41, and on Postgres 1 of 15), and each word of it (the
recommendation 2 of 12, the report's marker 1 of 12, the Dutch half at the route 2 of 10, in the
web service 1 of 10 and on the page 1 of 59, the Verify page 2 of 26, the Finish page's step 1
2 of 59). Gates: `pnpm typecheck` and ESLint on the changed files found nothing. The whole
`unit` project passed, in four runs, 1,155 files and 18,066 cases with 33 skipped, `scripts/`
among them (304 files, 7,433 passed); `unit-browser` (`apps/web`), 189 files and 3,723 cases. Five
integration files that run the touched doors passed on Postgres 16.15, 60 cases. Node 22.22.0 ran
them all: no Node 26 is installed here.

Not done: the E2E smoke of a test migration waits for T1, which is what makes one.

**2026-11-21: two review findings on T2 fixed on its branch, merged as #1975 (`45a758af`; *was:*
still not merged), and three prerequisites for T1 recorded.** Still inert: nothing sets the column.

- **An item still at the source is no deletion under a marker (§2 (f)).** An event whose title
  carried the marker was copied, the marker was taken out of its title, and it then moved to
  another calendar. The calendar it left reported its address removed, the one it is in listed
  it, and the wrapper set it aside, so the pass had not seen its key: it recorded a deletion with
  the evidence `reported`, the kind an apply may act on. The same account without a marker
  reports a move and no deletion. Contacts and tasks whose sources report removals took the same
  path. Now the wrapper hands back what it sets aside (`unmarked` carries the items, no longer
  only their number), the pass keys them with its own `naturalKey`, and the two conclusions that
  rest on whether an item was seen alive, a removal the source reports and a key in the owner's
  bin, count those keys as seen. Nothing else reads them: a file's absence and a former name are
  decided as before, and nothing about a set-aside item is written. Its copy stays where it was
  last copied, and no move is recorded for it, since the test no longer copies it. Without a
  marker no listing carries `unmarked`, the set of set-aside keys is empty, and the pass does
  what it did.
  - Proof, in `a-test-migration-copies-only-what-is-marked`, for events, tasks and contacts
    through the real wrapper and passes: copied, marker taken out, moved gives no deletion and no
    move, and the copy keeps its last marked title; without a marker the same three steps give
    `moved: 1` and no deletion; and an item whose marker was taken out and that is then deleted
    at the source is still reported. With the fix reverted the first fails for all three
    (`expected [ 'reported' ] to deeply equal []`), and so do two cases in
    `what-a-marker-changes-in-the-loop`: the removal case, now with an item that left the marked
    set and moved, and a new bin case, a message listed again under its id without the marker
    while its marked copy is in the bin (`[ 'trashed' ]`): 5 of 52 fail. Each half taken out
    alone is caught: the removals (4 of 52), the bin (1 of 52), the keys never gathered (5 of 52).
- **Tests that passed with the feature removed now fail.** With the four `markedOnly*` factories
  returning the bare source and the pass's changes reverted (`domain-sync.ts`, `dav-sync.ts` and
  `reconcile.ts` as at `bf9ede75`), 19 of the 46 cases in the three test files still passed, 10
  of them beyond the intended controls without a marker. Each of the 10 now depends on the
  feature:
  - `what-a-marker-changes-in-the-loop`: the rename between two marked names runs beside a file
    renamed out of the marker in the same pass (no drift, never a deletion); the binned file is
    `trashed` on that evidence alone over two passes (no drift, `absentPasses` 0); the removal
    case holds the item that left the marked set. Its fixture answers every key a folder holds
    only for files, as the passes do: for the other data types that listing had shown the loop
    test the key the wrapper set aside, which hid the defect above.
  - `a-test-migration-copies-only-what-is-marked`: the cursor case asserts that nothing was
    created and nothing recorded, for all five data types.
  - `a-file-renamed-out-of-the-marker`: the rename between two marked names runs beside a file
    renamed out of the marker and an unmarked control; the binned file beside a binned unmarked
    control, with no absence counted. Each fake file has its own bytes, so a rename pairs only
    with the file it is.

  The same removal of the feature now fails 44 of 57; the 13 that pass are the controls without
  a marker, 4 of them new. Every file was restored byte for byte (`cmp`) after each mutation.
- **For T1, before any marker can be set:**
  1. **The sharing rescan is not filtered by the marker.** `POST
     /api/migrations/:mappingId/sharing/rescan` reads the migration's source through
     `migrationInventoryScans` (`apps/api/src/routes/permissions.ts`), whose `scanDrive` lists a
     Google Drive source's shares (`listOwnedShareGrants`) or a Nextcloud or WebDAV source's
     (`scanNextcloudShares`), and saves them through `upsertShareGrants` into `share_grant`: each
     shared item's label, its grantee and the role, for the whole account. The permission report
     (`GET /api/permissions/report`) reads the same scans and returns them as text. Neither goes
     through the builders, so neither is wrapped.
  2. **Not confirmed: a Dropbox rename and the bin.** A file renamed in Dropbox may leave a
     tombstone (`.tag: "deleted"`) at its old path, which `listTrashedPaths` lists. Under a marker
     the bin filter keeps it by its old, marked name, so a file renamed out of the marker would
     reach the queue as `trashed` while it is still there.
  3. **Every IMAP message carries its subject in memory.** `imapflow-source.ts` attaches
     `subject` from the envelope to every listed message of every IMAP migration, marked or not,
     test or not. Nothing stores it.

**2026-11-20: T2 built, with the ledger column it reads; nothing sets the column yet.** The first
of two pull requests, on branch `claude/ownpace-public-readiness-y7orc6-test-scope-filter`, not
merged. It changes nothing a running migration does: no route, job or script writes the column,
so every migration reads NULL and gets its sources as before. T1 sets it.

- **The column** (ledger migration 0070): `mailbox_mapping.test_marker`, NULL for a migration
  that is not a test, otherwise 3 to 64 characters with no control character (a CHECK). A
  BEFORE UPDATE trigger refuses any change, removal or late setting of it, for every role, while
  every other update of the row goes through (§2 (c)). `readPathPhases` carries it as
  `testMarker`.
- **The wrapper**, `MarkedOnly` (`packages/orchestration/src/marked-only.ts`), one per source
  port. An item is kept when its own title carries the marker anywhere, ignoring case: a
  message's subject, from the envelope the IMAP listing already fetches (`MailItem.subject`; no
  body is read); an event's or a task's `SUMMARY`, a series decided by its master and its
  overrides going with it; a contact's `FN`; a file's own name. Removals pass through unfiltered.
  It forwards what callers look for by name, and only where the source has it: `measureMailbox`,
  `countMessages`, `nativeRefusals`, `storageUsage`, `listTopLevelFolders`, `listKeys`
  (unfiltered), `listTrashedPaths` (the bin's marked names), `snapshot` and `ContactSource.fetch`.
- **The pass** (`domain-sync.ts`). The wrapper says how many items it set aside (`unmarked`), so
  a read the marker emptied stores its cursor. Under a marker a collection is made when its first
  marked item is written, not at first sight. A file that a marked listing no longer shows, with
  nothing to explain it (no bin, no reported removal, no move to another marked name), is neither
  drift nor ever an inferred deletion. That settles §4's question about files: before this, a
  file renamed out of the marker was reported as deleted, `inferred`, two passes later, while it
  was still there under its new name. Keeping the old path in `listKeys` was not taken: it would
  also have hidden a binned or removed marked file from the queue, which §6's step 5 needs.
- **Where it is applied.** Managed: `buildDepsFromMapping` (mail, after Gmail's view) and
  `buildDomainDepsFromMapping`, which serve discovery, the passes and both apply jobs. The
  appliance: `buildDeps` and `buildDomainDeps`, handed the marker from `readPathPhases` by
  `runAllDomains`, `discoverAllDomains` and the apply openers.

What is proven, and how. In the six new unit test files and the IMAP source's, 163 cases pass:
the wrapper (26); the five data types through the real passes (31); a Drive file renamed out of
the marker, through the real `GoogleDriveSource` (5); the pass's three rules (10); the IMAP
source (59, one new: the subject from the envelope); the column on PGlite (16), and the same 16
on Postgres 16 (`local-pg.sh`, a fresh database); and the guard `a-source-built-without-its-marker` (16), which takes one mapping with a marker and one
without, per source family, through every reader above in both editions, and checks each source
built for the wrapper and its marker. Sixteen mutations, each one change, each caught, each
file restored byte for byte (`cmp`): the wrapper missing on one path, five ways (a managed
builder, an appliance builder, the apply opener, the appliance's pass, its count: 4, 4, 2, 1 and
1 of the guard's 16 fail); a case-sensitive match (9 fail); mail's removals filtered (2); the
cursor not stored, in the pass (6) or in the wrapper (10); collections made at first sight (7);
one optional method not forwarded, `measureMailbox` (1) or `listKeys` (2); the trigger dropped
(2 of 16, on PGlite and again on Postgres); and three more: a file's unexplained absence counted
(3), control characters let through the CHECK (6), the subject not carried (1).

Two guards already on `main` were met on the way, by the first full unit run.
`a-domain-union-typed-out-by-hand` caught the new guard writing the data types out by hand; it now
walks `DISCOVERY_DOMAINS`. `mapping-updated-at` asserted that the ledger chain creates no trigger
at all, and 0070's tripped it. Its own message says what to do then: check whether the trigger
stamps `updated_at`. 0070's does not, so that case now names every trigger the chain creates and
fails on any other, catching `CREATE OR REPLACE` and `CREATE CONSTRAINT` triggers, which it let
through before, and a new case reads 0070's function body and fails if it sets a column. Three
more mutations hold the two, each caught and restored: a trigger that stamps `updated_at`, a
second trigger nobody read, and the data types written out by hand again. Gates: `pnpm lint` and
`pnpm typecheck` found nothing; the whole unit project passed, 1,140 files and 17,791 cases with
33 skipped, where `main` at `bf9ede75` has 1,134 files and 17,684 cases with the same 33 skipped;
the six docs checks, `git diff --check` and `commit-convention` passed.

Not done, or not exact yet:
- the E2E smoke in §4's proof waits for T1, which is what makes a test organisation's migration;
- under a marker a file's absence is not counted, so a marked file that leaves the source without
  being seen in its bin (deleted for good at once, emptied from the bin between two passes, or on
  a WebDAV server with no bin) is never reported as deleted. The bins of Drive, Dropbox, Box and
  Nextcloud are read on every pass, which is how §6's step 5 deletes;
- Microsoft 365 mail: Graph's delta listing selects no subject, so a test migration from it would
  copy no mail, never all of it; T4 tests a Google account;
- discovery counts marked items only, but its count of collections is every folder, and what the
  wrapper forwards as measures is of the whole account: `measureMailbox`, `countMessages`,
  `storageUsage`, and `nativeRefusals`, the preflight's count of files Google will not export,
  since a refused file never reaches the wrapper.

**2026-11-20: proposed and agreed.** The owner decided to build a test scope, and the same evening
agreed to the decisions in §2 as written. T1 to T3 are next. No lane reads a Google account. A fresh Google account made only
for testing was suspended by Google on 2026-11-20. The account that is there is the operator's
own, which 0141's proofs already ran against by hand, and copying it whole is the wrong test:
- it moves years of private mail and calendars into a test target;
- its events name other people as guests. On 2026-11-19 a target mailed the guests of copied
  events (0160 T2).

This plan copies only a few items made for the test from that real account, chosen by a marker
in their own titles, so that the copy, the update and the deletion of each data type can be
watched on live. Nothing unmarked is written to the ledger or to the target.

Read for this plan, on `main` at `5fe1c9ea`:
- how each Google source lists its items (§4);
- where the counts, the verification and the cutover gate get their numbers (§4, §5);
- how a deletion at the source reaches the queue (§2 (f)).

Nothing was built with it.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | ✅ **Decided 2026-11-20** | §2, agreed as written. A marker in the item's own title, set on an organisation by an appointed operator, fixed for the life of each migration, applied where the source is first listed; a test migration is never finished or switched over; losing the marker deletes nothing. |
| T1 The test organisation and its marker | builder | 📋 **Planned** | §3. Support marks an organisation, only while it holds no migration. Each migration records the marker when it is created, in a ledger column no route updates. ADR-0053. The column, `mailbox_mapping.test_marker` (ledger migration 0070), was built with T2 on 2026-11-20; nothing writes it yet. Five things to settle first, in Status, 2026-11-21: three found with T2's review findings and two with T3. |
| T2 The marker where the source is first listed | builder | ✅ **Merged** as #1975 on 2026-11-21 (`45a758af`), inert until T1 sets the column | §4. `MarkedOnly`, one wrapper per source port (`marked-only.ts`), applied by every builder of a mapping's source in both editions; the cursor, collection and file rules in `domain-sync.ts`, and since 2026-11-21 a set-aside item counted as seen by the removals and the bin; the column it reads (ledger 0070). E2E (managed) run 44881786816 was green and applied ledger migration 0070. The E2E smoke of a marked migration waits for T1. |
| T3 Never finished, never switched over | builder | ✅ **Merged** as #2003 on 2026-11-21 (`cba6c64d`), inert until T1 sets the column | §5. Finish, ending or keeping a data type, the cutover's preparation (its door and its job), the gate's report and `approve`, `execute` and `complete` refuse a test migration and name the reason; the Verify and Finish pages say it in English and Dutch; delete stays open. E2E (managed) run 44911194184 was green on its head. |
| T4 The scenarios on live | owner | 📋 **Proposed** | §6. Marked items and an unmarked control of each data type in a real Google account; copy, change, delete and a lost marker, each watched at the target and in the guest's inbox. |
| T5 Asking Google first | builder | 🅿️ **Parked** | §7. Server-side search, so that Ownpace never reads an unmarked title. Trigger: a test account too large to list whole, or the owner asking for it. |

## 1. Why

- **No lane reads a Google account.** Each lane is either seeded or reads a non-Google source:
  - E2E (managed) and E2E (self-hosted) copy sources they seed themselves.
  - E2E (o365) reads a Microsoft 365 test source.
  - The live-target lane (0105 T4) sends to, and watches, a target that is not ours.

  Google sources have been proven by hand, on the operator's own account (0141, *Live proofs*).
- **A Google source needs a Google account that may be read.** A fresh account made only for
  testing was suspended by Google on 2026-11-20. A dedicated account, when one is available,
  works with this plan unchanged.
- **Copying the operator's own account whole is the wrong test.**
  - It moves private mail and calendars into a test target.
  - A calendar copy writes other people's names as guests, and a target may mail them
    (ADR-0043). On 2026-11-19 one did (0160 T2).
  - Its counts are too large to check by eye.
- **Marking test data is already how this repository tells test from real.** The live-target
  lane tags its mail (`openmig-live-…` and `openmig-control-…`), and the smoke tags its seeds
  (`smoke-<stamp>`). This plan does the same for items in a real account: the person making
  them writes the marker into their titles.

## 2. The decisions (T0)

Proposed on 2026-11-20, and agreed by the owner that evening as written.

- **(a) A marker, in the item's own title.** The default is `[Ownpace-test]`. An item is in
  scope when its own title contains the marker, ignoring case:
  - **Mail:** the subject.
  - **Events:** the `SUMMARY`. A recurring series is decided by its master's `SUMMARY`, and its
    overrides follow it.
  - **Contacts:** the `FN`.
  - **Tasks:** the title.
  - **Files:** the file's name.

  Nothing else decides: not the folder, the label, the sender or the guests. A reply,
  `Re: [Ownpace-test] …`, stays in scope.
- **(b) Set on an organisation, by an appointed operator only.** The operator marks an
  organisation as a test organisation, with its marker, from Support. This uses the same
  `platform_operator` check as *reopen* and *close*. Every migration created in that
  organisation carries the marker from its creation, recorded on the migration itself. No
  customer sees the switch. An organisation becomes a test, or stops being one, only while it
  holds no migration.
- **(c) Fixed for the life of a migration.** The marker is written when the migration is
  created, and is never changed or removed. Removing it from a running migration would start
  copying everything. A real move is a new migration, in an organisation that is not a test.
- **(d) Applied once, where the source is first listed.** One wrapper around the source does
  it, applied where the source is built, as `GmailFolderView` already is. So these all see the
  same marked set:
  - discovery;
  - every pass, and the bin scan;
  - verification, whose source count is the ledger's;
  - every count on the screens.

  Nothing unmarked enters the ledger, and nothing unmarked is written to the target.
- **(e) A test migration is never finished or switched over.** These refuse it and name the
  reason: *Finish*, ending or keeping a data type, the cutover gate and the cutover commands.
  The screens say *Test* throughout. A test migration ends by being deleted.
- **(f) Losing the marker deletes nothing.** An item whose marker is taken out of its title
  keeps its last copy on the target, as any item does that the source stops offering. Only a
  real deletion at the source reaches *Deleted on the old system*, and only *Delete it here
  too*, confirmed, removes the copy (ADR-0024).
- **(g) Guests as today.** The marker changes what is copied, not how. A test event's guests
  are written as for any event on that target (ADR-0043). The scenarios (§6) give a test event
  one guest only: the operator's own second address.
- **(h) Every source kind, Google first.** The wrapper reads only titles that the listings carry,
  so it fits every source. T4 runs it with Google.

## 3. T1 — the test organisation and its marker

- **The organisation's marker** lives in the managed edition, in a managed migration that only
  adds. It is set by `POST /api/support/tenants/:tenantId/test` with `{ marker }`, and cleared
  by `DELETE` on the same path.
  - Both routes sit behind `isAppointedOperator`, and anyone else gets a 404, as for `reopen`.
  - Each refuses while the organisation holds a migration.
  - Each writes an audit row.
- **The marker's form:** 3 to 64 printable characters, with no control characters, trimmed. The
  default `[Ownpace-test]` is offered, not assumed.
- **Each migration's own copy.** Ledger migration 0070 adds `mailbox_mapping.test_marker text
  NULL`, and only adds.
  - `POST /api/migrations` copies the organisation's marker into it, in the transaction that
    creates the migration.
  - No route writes it afterwards. A guard reads every `UPDATE` of `mailbox_mapping` in the
    repository, and refuses any that names the column.
- **Why a column, and not `scope_selection.filters`.** That `jsonb` is per data type and read
  by nothing. Its check constraint admits `email`, `calendar`, `contact` and `file`, but not
  `task`. A column that every builder of a source must read is harder to forget than a key
  inside a value nobody reads.
- **The contract and the screens.**
  - The migration's operating contract carries `testMarker`.
  - Every page of a test migration shows a banner, in both languages: *Test: only items whose
    title contains `[Ownpace-test]` are copied. This migration cannot be finished.*
  - The lists show a *Test* badge.
- **ADR-0053**, *A test organisation copies only what is marked*, records (a)–(h) with T1.
- **Self-host** is not in T1, because it has no operator role. Its `MappingConfig` can carry a
  marker later, if the appliance needs one.

## 4. T2 — the marker where the source is first listed

**One wrapper per source port.** `MarkedOnly` wraps the mail `SourceConnector`, the
`CalendarSource` (events and tasks), the `ContactSource` and the `FileSource`
(`packages/shared/src/ports.ts`).

- **Where it is applied.** It lives in `packages/orchestration`, and is applied wherever a
  mapping's source is built when the mapping has a marker:
  - managed: `buildDepsFromMapping` and `buildDomainDepsFromMapping`
    (`build-deps-from-mapping.ts`);
  - Gmail: after `GmailFolderView`.

  Those builders serve every reader of the source, so all of these see the wrapped source:
  - discovery (`run-discovery.ts`);
  - the passes (`run-delta-sync.ts`);
  - the apply-deletion and apply-relocation jobs.
- **It forwards every optional method** that callers look for by name: `measureMailbox`,
  `nativeRefusals`, `listKeys`, `listTrashedPaths`, `snapshot` and `ContactSource.fetch`.
  `GmailFolderView` once lost `measureMailbox` this way, and its comment says so.

**Per data type:**

| Data type | Read from | Note |
|---|---|---|
| Mail | the envelope's subject | `MailItem` gains `subject`. The listing already fetches every message's envelope (`fetchListing`, `imapflow-source.ts`) and drops the subject today. |
| Events | `SUMMARY` | A series by its master; an override goes with its series. |
| Contacts | `FN` | |
| Tasks | the title | `google-tasks-source.ts` already maps it to the summary. |
| Files | the file's own name | `listKeys` stays the inner, unfiltered listing. Absence-counting is seeded from it, so an unmarked file that was never copied can never become an inferred deletion. |

**What a filter needs from the pass:**

- **Removals pass through unfiltered.** A removal names no title, and
  `resolveReportedRemovals` already skips a key the ledger never copied
  (`if (!row) continue;`, `domain-sync.ts`).
- **A read the marker emptied is not a read that saw nothing.** Today a first read with no items
  stores no cursor (`firstReadSawNothing`, `domain-sync.ts`). Every collection without a marked
  item would then be listed whole again on every pass. The wrapper reports how many items it set
  aside, so that the cursor is stored. `listedElsewhere` already does this for a folder that
  holds only subfolders.
- **Collections are made when their first marked item is written.** Today a collection is made
  on the target the first time a pass sees it, even when it is empty (`if (prev === undefined)
  await collectionIdOf();`). Under a marker that would create every one of the operator's
  folders, labels and calendars, empty, on the test target. With a marker, it waits for the
  collection's first marked item.
- **Counts.**
  - Discovery reads through the same wrapper, so it counts marked items only.
  - Verification's source count is the ledger's (`countItems`), so it agrees without a change.
  - Today discovery and the passes already disagree about Trash and Spam: the passes leave them
    out (`excludedCollections`), while discovery's `isExcluded` hook has no caller. That is not
    this plan's to fix; the marker does not depend on it.
- **Files are keyed by their path.** A rename that drops the marker is a move to a path the
  wrapper does not list, after which the old path counts as absent. A test settles that this
  stays out of the deletion queue, as (f) says. If it does not, the wrapper keeps the old path
  in `listKeys` for as long as the ledger holds it.

  *Settled 2026-11-20, with T2:* it did not stay out. Two passes later the old path was reported
  as deleted, `inferred`. Under a marker the pass now counts no such absence, and a binned or
  reported marked file still reaches the queue; the old path is not kept in `listKeys`, which
  would have hidden those too (Status, 2026-11-20).

**Proof:**

- **Unit cases, per data type:**
  - a marked item and an unmarked one;
  - the marker in another case;
  - a recurring series with an override;
  - a renamed item;
  - an empty filtered read that stores its cursor;
  - a removal of an unmarked key.
- **A guard** takes one fixture mapping with a marker through every managed builder path
  (discovery, the pass, apply-deletion, apply-relocation) and asserts that the source each path
  gets is wrapped.
- **Mutations**, each caught:
  - the wrapper missing on one path;
  - a case-sensitive match;
  - removals filtered;
  - the cursor not stored;
  - collections made at first sight;
  - one optional method not forwarded.
- **E2E (managed).** The smoke seeds one marked and one unmarked item per data type, into a test
  organisation's migration. Only the marked items may arrive, and discovery, the ledger and
  verification must report the same counts.

## 5. T3 — never finished, never switched over

- **`finishTransition`** (`packages/shared/src/lifecycle.ts`) refuses a test migration with:
  *A test migration is not finished: delete it when the test is over.* It sits beside its
  `paused` refusal.
- **`endOrKeepDataType`** (`apps/api/src/routes/migrations/path-lifecycle-wiring.ts`) refuses
  with the same reason.
- **The cutover.**
  - The `run-cutover` job's gate refuses before `READY_FOR_CUTOVER`.
  - `approveCutover`, `executeCutover` and `completeCutover` (`cutover-commands.ts`) refuse.
  - `canProceedToCutover` is false for a test migration, and its recommendations name the reason.
    The Verify and Finish pages show it.
- **Delete stays open.** A test migration, and its account, are deleted as any other is.
- **Proof:** each of these refuses with a marker and allows without one, and each refusal, taken
  out, is caught by its test.

## 6. T4 — the scenarios on live (what the owner does)

**Before:** a release with T1–T3 runs on live. The operator's Google account is a test user of
the Google client. The client stays in *Testing* (0140), where a refresh token lasts 7 days, so
the account is connected again for a run more than a week after the last one. Mail and files
need the `gmail` and `google-drive` sources, unless `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted` is
set.

1. **Make an organisation for testing.** In Support, mark it as a test organisation, with the
   marker `[Ownpace-test]`.
2. **In the Google account, make the marked items:**
   - a mail with a small attachment;
   - an event;
   - a weekly series, with one occurrence moved;
   - an all-day event;
   - an event whose only guest is your own second address;
   - a contact;
   - a task with a due date;
   - a PDF in Drive.

   Each title starts with `[Ownpace-test]`. Then make one **control** of each kind, titled
   `Control …`, without the marker.
3. **Connect the account in the test organisation, and start one migration into a test
   target.** Let the first pass finish. Expect:
   - every marked item at the target, and no control;
   - the counts on the screens equal to the marked items;
   - the verification passing;
   - no invitation at the second address.
4. **Change things, then press *Sync now*:** a title (keeping the marker), an event's time, a
   task done. Expect the changes at the target, and no update mail.
5. **Delete one item of each kind at the source.** Press *Sync now*, then *Delete it here too*
   and *Confirm delete*. Expect them gone at the target, and no cancellation mail.
6. **Take the marker out of one title, then press *Sync now*.** Expect the target to keep its
   last copy, and nothing under *Deleted on the old system*.
7. **Press *Finish*.** Expect a refusal naming the test. Then delete the migration. The account
   can stay for the next run.

Each step's result, with its counts, goes into this Status block.

## 7. Later, and what this does not do

- **T5, asking Google first (parked).**
  - **Trigger:** a test account too large to list whole, or the owner asking that Ownpace read
    no unmarked title at all.
  - **Mail:** `UID SEARCH SUBJECT` (or Gmail's `X-GM-RAW`) per folder, then the envelopes of
    those UIDs only.
  - **Drive:** `name contains`.
  - **Calendars:** a calendar-query with `text-match` on `SUMMARY`.
  - **Contacts:** an addressbook-query on `FN`.
  - Whether Google's DAV servers honour those two queries is not measured. The Tasks API has no
    search.
- **What it reads until then.** The wrapper sees the title of every item that the listings
  already return. That means:
  - every message's envelope;
  - every event, contact and task;
  - every file name.

  It keeps none that is unmarked: nothing unmarked is stored in the ledger, logged, or written to
  the target. The grants are the ones Google requires for those protocols, as for any Google
  migration: IMAP and CalDAV are full access, and Ownpace only reads (`a-source-that-only-reads`).
  The account can be disconnected at any time.
- **Not a customer feature.** No plan offers it, and the switch sits behind the operator role.
- **Not a measure of volume or speed.** Its counts are small by design.

## Open questions

1. **Where the marker may stand.** Is it anywhere in the title, or at the start only? Proposed:
   anywhere, so that `Re: [Ownpace-test] …` stays in.
2. **A file in a marked folder.** Is it in scope though its own name has no marker? Proposed:
   no. The file's own name decides, one rule for every data type.
3. **Non-Google sources in a test organisation.** Should it refuse every source that is not
   Google? Proposed: no, by (h).
