# Workplan 0162 — A test organisation copies only what is marked

> **In one line:** Testing on live with a real account: an organisation the operator marks as a test copies only the items whose title carries its marker, such as `[Ownpace-test]`, filtered where the source is first listed, and its migrations can never be finished or switched over.

## Status — 2026-11-20 (update this block at the end of every session)

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
| T1 The test organisation and its marker | builder | 📋 **Planned** | §3. Support marks an organisation, only while it holds no migration. Each migration records the marker when it is created, in a ledger column no route updates. ADR-0053. The column, `mailbox_mapping.test_marker` (ledger migration 0070), was built with T2 on 2026-11-20; nothing writes it yet. |
| T2 The marker where the source is first listed | builder | 🔨 **Built 2026-11-20, inert until T1 sets the column** | §4. `MarkedOnly`, one wrapper per source port (`marked-only.ts`), applied by every builder of a mapping's source in both editions; the cursor, collection and file rules in `domain-sync.ts`; the column it reads (ledger 0070). Not merged. The E2E smoke waits for T1. |
| T3 Never finished, never switched over | builder | 📋 **Planned** | §5. Finish, ending or keeping a data type, the cutover gate and the cutover commands refuse a test migration and name the reason; it ends by being deleted. |
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
