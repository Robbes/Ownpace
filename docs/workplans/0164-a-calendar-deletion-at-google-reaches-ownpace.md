# Workplan 0164 — A calendar deletion at Google reaches Ownpace

> **In one line:** An event deleted in a Google calendar during a migration reaches *Deleted on the old system* as a reported removal, so its copy can be removed through the gated path: by hand, as today; in bulk, with one confirmation; and by itself only if the owner changes the rule that forbids it.

## Status — 2026-11-22 (update this block at the end of every session)

**2026-11-22, 03:10 UTC, latest: T3's second review is answered, on
`claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`; it is still held for alpha.15, and
one question waits for the owner.** The second adversarial review said *merge after these fixes*:
- **Nothing is pressed beside a run while the list is read again** (F-A). The rows of a run wait
  their turn, with no button of their own, from the confirming press on, not only once the list
  has been read again. A keep pressed in that window was overwritten, and the row's removal
  ordered; a single delete there ran beside the run's. A run that orders nothing gives the
  buttons back, and *Stop* is offered while the list is read.
- **`removed_not_recorded` stops the whole run** (F-C). It proves the ledger changed under a
  removal: when the owner restores a folder at the source mid-run, the next items are still
  reported until the pass reaches them. The row still counts as deleted, and the summary says why
  the run stopped.
- **Three surviving mutants are killed** (F-D): the 403/404 check, a failed receipt counted as a
  refusal, and a refused receipt with an unknown code. The test over the real operating service
  now also covers a receipt, a 404, `removed_not_recorded` on a receipt and on the appliance, the
  hold, a request that got no answer, and the appliance's own answer.
- **One removal at a time is under way per migration's run** (F-E): a run does not wait for a
  single press still under way, nor for another migration's run on the same page. ADR-0024, the
  panel and the runbook say so.
- **Answers are kept per migration and item** (F-F). `QueueScreen` kept a row's answer under its
  hash alone, and a mail item's hash comes from its Message-ID, so a run in one migration marked
  the same message in another *Deleted on the new system too*. Deletions, Moves and Failures now
  hand each migration only its own answers.
- **Words** (F-G, F-H). *Could not be carried out* is now *did not answer*. A late receipt says it
  may still delete. A hold, a closed account and a 502 that could not queue the removal are *not
  deleted*, nothing started, and stop the run. The breaker's sentence names one data type of one
  migration, *not ours* and *not found* cover their other cases, and *changed* no longer says
  "since you confirmed". Only the server's words are marked English under *Technical details*.
- **ADR-0024's operative rules** (F-I) say again that a run goes through the same call and all
  seven gates, is offered only where a single delete is, names the count, and stops whole, and
  that *Stop* or a closed page orders nothing more. Detail moved to the narrative and to ADR-0030
  made room. Other claims (F-J): *Cancel* no longer claims the button's place, and the shared
  index, §4.2 and the prose-boundary note say what holds.
- **Accessibility** (F-K): the focus returns to the button after Cancel or Escape and stays in the
  confirmation while it is open, and Escape works from anywhere in it. The queue is read again
  once, when a run ends (F-L), and the refusal codes are held at run time too (F-M).
- **Open, for the owner (F-B):** should the bulk take in only `reported` rows, with `trashed` rows
  keeping their single press? Mail's known false positive, a message both in the bin and in a
  live folder (`domain-sync.ts`), would become a permanent tombstone through the bulk, and below
  20 items the breaker never applies. The evidence filter is unchanged until the owner answers.
- **Tests:**
  - the page's test, 53 cases, holds each finding;
  - the test over the real operating service now covers a receipt, a 404, `removed_not_recorded`
    on a receipt and on the appliance, a hold, a request that got no answer, the appliance's own
    answer, and the three failures the review's mutants lived on;
  - core, over the real `applyDeletion` and `MemoryLedger`, holds `removed_not_recorded` stopping
    a run, the review's restored folder included.

  44 mutants, each undone byte for byte, all killed. 17 of them (N28 to N44) are new for this
  review.
- **Next:** CI, a look at F-B by the owner, then E2E (managed).

**2026-11-22, 01:50 UTC, earlier: T3 takes the keep fix from `main` and says `already_kept` in
both languages; it is still held for alpha.15.** On
`claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`:
- **Merged:** `main` with #2027 (the entry below) and the third alpha.14 fold (#2028). ADR-0024
  keeps both amendments, 2026-11-21 and then 2026-11-22. Its operative rules are within their
  300 words again: the first rule's "per item" now says only what it reads as, "each item decided
  by itself", and the 2026-11-21 rule is cut to the rule itself, its reasons left in its
  amendment.
- **A row somebody kept during a run** is refused `already_kept` when its turn comes, if the keep
  was recorded before its removal began: on the request, or on managed on its receipt, when the
  job asks again. That refusal is the row's own, and the run goes on. The page lists the row
  under *Not deleted*, with a sentence of its own in English and Dutch and the server's words
  under *Technical details*. A keep that lands while that row's removal is under way cannot stop
  it, and the page lists the row as deleted, as the ledger records it.
- **Tests:** a keep in another tab mid-run, on the page, on the request and on a receipt
  (`apps/web/src/pages/a-delete-all-each-decided-by-itself.unit.test.tsx`), and in core over the
  real `applyDeletion` and `MemoryLedger`, before the row's turn and during its removal
  (`packages/core/src/a-delete-all-through-every-gate.unit.test.ts`). Four more mutants, each
  undone byte for byte: a kept row said as any refusal, one that stops the run, one counted as
  deleted, and `keptCheck` taken out of `applyDeletion`. Each made a test fail, and the 23 before
  them still do.
- **Next:** a second review, then E2E (managed).

**2026-11-22, earlier: a deletion the owner kept is never applied, fixed on its own; T3 is held
for alpha.15.** Found in the review of T3 (*Delete all of these here too*, on
`claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`): a keep pressed in another tab during
a run was removed when the run reached it. It held for a single press too, since neither
`applyDeletion` nor the ledger's conditional UPDATE read `deletion_acknowledged_at`, where a move
already had `already_kept`. So it was fixed on its own, on
`claude/ownpace-public-readiness-y7orc6-deletion-kept`, ahead of T3:
- **Core:** `applyDeletion` and `evaluateApplyDeletion` refuse `already_kept` at the same point,
  after `already_applied` and the phase, before anything is sent to the target. The managed job
  asks again at the removal, so a keep made while the removal waited in the queue wins.
- **What it cannot stop:** a keep that lands while a removal is already under way. The copy is
  removed before the row is recorded, so the ledger records the removal as what it was
  (tombstoned and applied), and keeps the keep's own time.
- **The refusal after cutover** no longer says a rollback re-opens a kept entry: a kept one stays
  kept, and a rollback admits again only what nobody answered.
- **Tests:** core over `MemoryLedger` (keep then press, the managed order, the race, a removed
  row, `after_cutover` first; the case of an item that came back calls `clearAbsent` directly);
  the ledger's half on PGlite as `app_user`, and on Postgres as the superuser CI's integration job
  uses; the managed route over HTTP; the appliance's `applyMappingDeletion`; the worker job's
  half pinned by its source shape, since it cannot be run in a test.
- **Records:** ADR-0024 (*Amendment, 2026-11-22*), the arch doc §11.1, the operator runbook, the
  CHANGELOG.
- **Follow-up, alpha.15:** a keep given in the earlier-exports queue is not cleared by
  `clearEarlierExport` when the format is switched back, so a later deletion of that item arrives
  already kept, filed as decided and never offered. Clear it there, or keep it so: not changed
  here.
- **T3** is held out of alpha.14, and its review's other findings are fixed on its own branch for
  alpha.15.
- **Next:** this fix's E2E (managed), then T3 again.

**2026-11-22, 00:15 UTC, earlier: T3 was reviewed and is held for alpha.15; its findings are fixed
on `claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`.** An adversarial review of #2024
found one blocker and three majors. The blocker is fixed from `main` in a pull request of its own
(below); the rest is fixed here:
- **The confirmation is a control of its own** (F2, F5). The button opens it over the rows as they
  were then, a frozen set, and it names how many. *Cancel* comes first and takes the focus.
  *Delete N* ignores the second click of a double click and any click within
  800 ms of opening. Nothing is ordered unless the page's rows at that press, and the list read
  again from the server, are both the frozen set, compared row by row.
- **A fault is not a refusal** (F3). Only a 403 or 404 with a code in `APPLY_REFUSAL_CODES`
  (`@openmig/shared`, held equal to core's `ApplyRefusal` by
  `packages/core/src/a-refusal-code-the-page-knows.unit.test.ts`), or the 500
  `removed_not_recorded`, counts as a refusal. Anything else is a press that did not answer.
- **A press that did not answer stops the run** (F4, F6), its row *not known*. That is a fault, a
  hold, a time-out, a receipt that failed, or one that did not land within five minutes.
  Repeated failures to read a receipt are said while it is being read.
- **The breaker and deleting by hand turned off stop the whole run** (F8, F14), every data type:
  what the breaker suspects is the whole account's.
- **Three groups afterwards** (F7): deleted (one removed by somebody else, and one the ledger
  could not record, included), not deleted, and not known. The summary counts each and says what
  stopped a run.
- **A failed refresh keeps the page** (F9): Deletions, Moves and Failures keep their rows under
  the error, so a run under way and its report stay.
- **Accessibility** (F10): one status line for progress and the summary, with the lists outside
  it. The focus goes to *Cancel*, then *Stop*, then the summary. The lists' headings are h4,
  under the migration's h3.
- **Words** (F12, F15): every claim of one at a time, each answered before the next, the count
  confirmed being the count ordered, or the rest going on, now says what holds: in the ADR, its
  operative rules, the arch doc §11.1, the runbook, the CHANGELOG, the guidance and the page.
  *Not found* says Ownpace has no record of the item, and a changed list with one row left asks
  for no second confirmation.
- **Tests** (F11): the review's four surviving mutants are killed. They were a re-read compared by
  count only, rows not marked *Waiting its turn*, a closed page that went on ordering, and one
  that went on polling. One test runs the page over the real operating service, with only axios's
  transport replaced (`apps/web/src/pages/a-delete-all-answered-over-http.unit.test.tsx`).
- **The blocker (F1) is not this branch's.** A *Keep* did not stop a later apply of the same row,
  by hand or in a run. It is fixed from `main` in its own pull request (#2027, the entry above):
  core refuses `already_kept` before anything is sent to the target. Once that is on `main`, this
  branch takes it and says `already_kept` in both languages.
- **Follow-up, not built** (F13): two pages can run at once. On managed, a press joins a queued
  receipt by reading first and inserting after, and `apply_receipt` has no partial unique index
  on `state = 'queued'`. So two presses of one row in the same moment can queue two jobs, and gate
  7 still records one removal. Closing it needs a migration, so it is left for a decision.
- **Next:** CI on the pull request and a second review, then E2E (managed).

**2026-11-21, 22:55 UTC, earlier: T3 is built, on
`claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`, as §4.2, and not yet on the test
environment.** The entry above supersedes this one where they differ: the breaker now stops the
whole run, not only its data type, and a press that did not answer stops it too. *Delete all of these here too* on *Deleted on the old system*
(`apps/web/src/components/queues/DeleteAllPanel.tsx`), on T2 as merged in #2019:
- **The loop lives in the page**, not in a new endpoint that loops server-side. It presses each row's own *Delete it here
  too* in turn, through the same call, and reads each answer to its end before the next press: the
  appliance's answer, or a managed receipt polled to `applied`, `refused` or `failed`
  (`applyEachInTurn`, `packages/shared/src/apply-each-in-turn.ts`). No route was added. Why:
  - every gate, the operator's hold and a closed organisation stay where a single press meets
    them, and on managed each row keeps its own receipt, its own `apply_deletion.ordered` audit
    row with the person who pressed, and its own job, which runs every gate again;
  - reading each answer to its end is what lets the breaker's rule hold for a refusal on a
    receipt too, which a route that queued every row at once could not see in time;
  - one removal at a time is under way per migration's run, as a person pressing would;
  - a page closed mid-run presses nothing more, and what was pressed finishes where it runs;
  - a second press orders only what is still waiting, and the route joins a press already queued.
- **Offered only where a single delete is:** deleting by hand on (read as the panel above reads it,
  and not offered while that cannot be read), rows `mayOfferApply` offers, two at least, none
  pressed on the page yet. One confirmation, which names the count; the list is read again first,
  and a list that changed orders nothing.
- **The breaker:** gate 6 refuses every apply for a data type while it trips, because no item in
  that queue is trustworthy then. So a `mass_deletion_suspected` refusal, on the request or on a
  receipt, stops every later row of that data type in the run, even if the share has dropped by
  then; another data type goes on behind its own breaker. Every other refusal is that row's
  answer, and the next row is pressed.
- **Afterwards** the page lists what was deleted and what was not: a sentence per refusal code in
  English and Dutch, the server's words and code verbatim under *Technical details*. *Stop*
  presses nothing more, and the rows never reached get their buttons back.
- **Records:** ADR-0024 (operative rules in place, *Amendment, 2026-11-21*), the arch doc §11.1, the
  operator runbook, `docs/i18n-prose-boundary.md` (class 2), the queues' guidance, the glossary,
  the CHANGELOG.
- **Tests:** the loop over the real `applyDeletion` and `MemoryLedger`, one row refused by each
  gate and the rest removed, and a breaker that trips mid-run
  (`packages/core/src/a-delete-all-through-every-gate.unit.test.ts`); the loop by itself
  (`packages/shared/src/apply-each-in-turn.unit.test.ts`); the page
  (`apps/web/src/pages/a-delete-all-each-decided-by-itself.unit.test.tsx`). Eight mutants, each
  undone byte for byte: a gate skipped for a run (an assumed row taken by the page, and ownership
  taken out of `applyDeletion`), the run going on past the breaker, the press with no
  confirmation, the button after cutover, the button with deleting by hand off, the refusals not
  shown, and the report gone once the list is empty. Each made a test fail.
- **Found, not changed:** a deletion somebody chose to keep can still be applied. Neither
  `applyDeletion` nor the ledger's conditional UPDATE reads `deletion_acknowledged_at`, where a
  relocation has `already_kept`; a kept row pressed through the API is removed. The page offers
  no button on a kept row, and a run reads the list again before it presses anything, but a *Keep*
  pressed in another tab during a run is not seen. Left for a decision, as it changes the single
  press too.
- **Next:** E2E (managed) on the pull request, then T5 (§6) after the merge.

**2026-11-21: T2 is built, on `claude/ownpace-public-readiness-y7orc6-0164-t2-reader`, as
§3.1 A, reviewed twice and fixed, and not yet on the test environment.** The CalDAV source reads a
`sync-collection` answer whose members carry no calendar data as a list of members to read, keyed
on what the server answers and not on its host (`packages/connectors/src/caldav-source.ts`):
- **The REPORT is the one T1 measured:** the token, `sync-level` 1, then the properties (RFC 6578
  §6.1). A server that answers `sync-level` with a 400 is asked once more without it, and that
  answer stands, whatever it is.
- **The pages are followed to the last** (§3.6): a 507 for the calendar is a page, and only the last
  page's token is kept. Up to 100 pages; a reading whose pages do not end is listed whole. A page
  that gives no token keeps the token it was sent.
- **The members are read with `calendar-multiget`** (RFC 4791 §7.9), 50 hrefs a request, and each is
  handed on under the href `sync-collection` gave, which is what a later 404 names.
- **The removals are carried up as `removed`**, which the sync loop turns into `reported` evidence,
  through every gate it has. Nothing is applied: a person applies a removal by hand, as for any
  other reported one, and no apply gate changed.
- **A 404 in a reading with no token** is reported when the ledger holds a copy of that href and
  passed over when it does not. An existing Google migration holds no token, so its first pass on
  this reader sends none, and the deletions made while it listed whole are in that answer alone.
  The reasoning is in the source and in `docs/dav-sync.md`.
- **A recorded move is never reported as a removal** (`domain-sync.ts`, refusal 5 of
  `resolveReportedRemovals`): a reading of the calendar it left with no token names the old href,
  while the calendar it went to, read with its token, names it no more. A file moved by path is not
  such a move.
- **A refused token** (403 or 409 with `DAV:valid-sync-token`) is dropped and the calendar read
  again with none, once, in the same pass. Any other refusal of the first page lists the calendar
  whole. A 5xx or a rate limit keeps the token it was sent; anything else drops it, so the next pass
  reads the calendar with none, as this source always did.
- **A multiget that falls short**, a 404 for a member included, lists the calendar whole for that
  pass, as before, and keeps the removals and the token, so nothing is left out.
- **The token is saved only once the pass has handled what it read**, by the loop's rules: a
  retryable failure or an unreached calendar keeps it where it was. A calendar's token is held for
  its removals only while one of them can become a deletion, so one whose reading named only
  removals never copied goes on from its token while another calendar stays unreadable.
- **For a server that sends its data** (Nextcloud, Infomaniak, Cirrux) the reading is the same,
  except what is listed above for every server: `sync-level` 1, the retry with no token after a
  refused token, the token kept after a 5xx or a rate limit, the token kept by a page that gives
  none, the token's XML entities decoded, and a member that arrives without data read rather than
  passed over.

The first review of #2019 found a move reported as a removal when the two calendars were read
differently, a multiget 404 that lost an event, a first reading repeated on every pass while one
calendar stayed unreadable, the REPORT differing from T1's, a token with an `&` sent back changed,
five mutants that survived, and a calendar's path in the log. All but the third are fixed and
tested. The third is fixed for removals that cannot become deletions, and tested; what is left is
recorded in `docs/dav-sync.md`: while a calendar stays unreadable, a calendar whose reading named
the removal of a copy is read again from its held cursor on every pass, until a pass reaches every
calendar.

The second review found two ways a calendar could stop reporting removals for good, and both are
fixed and tested. A stale token refused without naming `DAV:valid-sync-token`, with a 410, say,
was kept, so every pass after it listed the calendar whole and reported no removal; any refusal but
a 5xx or a rate limit now drops the token. And after a 400 to `sync-level`, a refused token in the
answer to the retry was not heard; the retry's answer now stands. A page that gives no token now
keeps the one it was sent, which saves a whole reading. The tests run the real source over
`GoogleLikeCalDav`, a fake that answers as Google did, in the connectors, in the sync loop, and
over a real Postgres, where the reported removal is the one the gated apply takes. 47 mutants, each
taking out one rule, each made a test fail.
- **Next:** E2E (managed) on the pull request, then the owner's test (T5) after the merge.

**2026-11-21, last: T1 ran on the test environment, and A is the reader.** Built as #2008
(`d4c4cfdb`) and run by the owner from `main` at `17a9a460`, on their Google test migration, the
newest of two whose calendars come from Google over CalDAV. What it printed, counts and status codes
only:
- **Five calendars.** The first reading, one `sync-collection` with no token for each, was answered
  207 every time, with a sync token and no calendar data. Members with 200 and with 404, per
  calendar: 3,624 and 3, over 15 pages; none; 35 and none; 1,896 and 5, over 8 pages; 673 and 7,
  over 5 pages.
- **Between the readings** the owner changed one test event and deleted another, in the same
  calendar.
- **The second reading, with each calendar's token,** was answered 207 every time, with a new
  token. That calendar listed 1 changed member (200) and 1 removed (404); the other four, none.
- **The verdict line:** "A is the reader. Google listed 1 removed event as 404, and 1 changed one
  as 200 (workplan 0164 §3.1)."
- **What it settles.** Google reports a removal through CalDAV once it is asked with a token, so B
  (Google's Calendar API) is not needed, and neither is a step in the Google Cloud console.
- **Two things for T2 to read.** Google's answer with no token also lists 404 members: removals it
  still remembers, which RFC 6578 does not ask for in a first answer. And it pages: 15 pages for
  3,627 members.
- **Next:** T2, the reader of §3.1.

**2026-11-21, later: T1 is built, on `claude/ownpace-public-readiness-y7orc6-0164-t1-measure`, and
not yet run.** `./deploy/compose/operator.sh measure-google-sync` is a command of the worker's CLI
(`apps/worker/src/cli/measure-google-sync.ts`). It chooses the migration itself, the newest whose
calendars come from Google over CalDAV, and prints its id and creation date. It reads each calendar
with one `sync-collection` with no token, asks the owner in English and Dutch to change one event
and delete another at Google, reads each calendar again with that token, and ends with §3.1's
verdict. Its tests hold four things:
- nothing but PROPFIND and REPORT, and nothing but Google's CalDAV host, is sent to a calendar,
  refused before sending, a redirect included;
- the database is read in one transaction opened `READ ONLY`, rolled back before Google is asked;
- every line it prints is counts and status codes, and a run over hrefs, names, titles, tokens and
  ETags that carry an address prints none of them;
- a 404 inside a propstat is not a removal.

Eleven mutants, each breaking one of those or the wrapper's hand-off to the worker, each made a
test fail. The selection query ran on a real Postgres
with both chains: it chose the newest of three qualifying migrations and skipped a closed
organisation, a migration without calendars, a withdrawn grant and a CalDAV source. The sign-in
mints an access token as every pass does and keeps it in memory; nothing is written.
- **Next:** the owner runs it on the test environment, by *How to run T1* (§3.1), from `main`.
  What it prints goes here, then T2 on what it shows.

**2026-11-21: the decisions (T0), each as advised.** Nothing is built yet. §5 has each one.
- **(a) The reader:** A, `sync-collection`, measured first (T1). B, Google's Calendar API, only if
  T1 shows Google lists no removed event through CalDAV.
- **(b) Bulk apply:** yes (T3), with one confirmation and every gate kept.
- **(c) Removal by itself:** not in the first build, so T4 stays parked. A reported removal is
  applied by hand: one at a time, as today, or in bulk once T3 is built.
- **(d) T1:** yes. Read-only, on the owner's test migration on the test environment, recorded as
  counts and status codes only.
- **Next:** T1, then T2 on what it shows.

**2026-11-20: proposed, not yet decided.** Nothing is built. The owner asked for this after the
test of 0160 §4: an event deleted in Google never reached *Deleted on the old system*. They want
old and new kept in step by hand, in bulk or even automatically. Their reason: in some target
apps a deletion by hand cannot be made without mailing the guests, and Ownpace's removal can.

The decisions are in §5 (T0). T1 is a read-only measurement that needs the owner's yes, because
it reads their own Google calendars.

Read for this plan, on `main` at `8b8fac07`:
- how the CalDAV source reads a Google calendar (`packages/connectors/src/caldav-source.ts`);
- what reaches the deletions queue, and from where (`packages/core/src/domain-sync.ts`);
- what may remove a copy: ADR-0024 and hard rule 2 (`AGENTS.md`).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | ✅ **Decided 2026-11-21**, each as advised | §5: reader A, measured first; bulk apply yes; nothing removed by itself in the first build; T1 yes |
| T1 What Google answers | builder | ✅ **Done 2026-11-21**: built as #2008, run by the owner; A is the reader | §3.1 and *How to run T1*: `./deploy/compose/operator.sh measure-google-sync`. Read-only, on the owner's test migration on the test environment. Counts and status codes only |
| T2 The reader that reports removals | builder | 🟡 **Built 2026-11-21**, on `claude/ownpace-public-readiness-y7orc6-0164-t2-reader` | §3.1 A: `sync-collection` followed through its pages, with the token kept; removed members as `reported`, changed ones read by `calendar-multiget` |
| T3 Apply in bulk | builder | 🟡 **Review**, held for alpha.15: built 2026-11-21, both reviews' findings fixed and the keep fix (#2027) taken 2026-11-22, on `claude/ownpace-public-readiness-y7orc6-0164-t3-bulk-apply`; F-B open for the owner | §4.2: *Delete all of these here too*, each row's own press through every gate, after one confirmation over a frozen set; the breaker, `not_enabled`, `removed_not_recorded`, or a press not answered or not started stops the run. ADR-0024 amended |
| T4 Removal by itself | builder | 🅿️ **Parked** | §4.3. Only if the owner changes hard rule 2 and ADR-0024 |
| T5 The owner's test | owner | 📋 **Proposed** | §6. An event with the owner's second address as its only guest, deleted at Google, applied, no mail |

## 1. Why

- **A Google calendar deletion is never seen.** In the owner's test of 2026-11-20 (0160 §4,
  step (3)), an event deleted in Google never reached *Deleted on the old system*. Read on `main`:
  - Google answers a `sync-collection` REPORT (RFC 6578) with a 207 that carries no calendar
    data. The source reads that as "nothing", and when it sent no sync token it does not trust
    it: it lists the calendar whole with `calendar-query` (RFC 4791 §7.8) instead
    (`caldav-source.ts`, "WHEN `sync-collection` DOES NOT ANSWER"). So every pass lists every
    event again: *6,212 skipped* in that test.
  - A whole listing names what is there, not what went. It returns `removed: []`, and the comment
    beside it leaves a deleted event to absence counting.
  - Absence counting runs for files alone (`domain === 'file'`, `domain-sync.ts`), and a
    calendar has no bin to read (`listDiscardedKeys` is for files). So nothing ever says the event
    went.
  - Google Tasks is read through its own API with `showDeleted=true`, and does report deletions
    (`google-tasks-source.ts`).
- **Keeping old and new in step needs removals.** During a migration both systems are in use. An
  event cancelled at the source stays at the target until someone removes it there.
- **Removing it at the target by hand can mail the guests.** Some calendar apps offer no "don't
  notify" choice. Ownpace's removal sends a `DELETE` with `Schedule-Reply: F`, to a copy whose
  guests are marked `SCHEDULE-AGENT=CLIENT` (ADR-0043), which tells the server to send nothing.

## 2. What holds today

- **Hard rule 2** (`AGENTS.md`): "Never auto-delete/overwrite on the target; surface source
  deletions as user decisions."
- **ADR-0024:** `apply` is the only destructive path, "per item, owner-called, never automatic",
  behind seven gates. Gate (1) is the per-migration opt-in, **Turn on deleting by hand** on the
  Deletions page. Gate (3) takes positive evidence only: `reported` (the source's own removal
  report) or `trashed` (found in the bin), never `inferred`. Gate (6) is the mass-deletion breaker,
  20% of at least 20. Nothing is applied after cutover.
- So a Google calendar deletion needs a **reported** removal before any mode below can act on it.

## 3. How a Google deletion could be read

### 3.1 A: `sync-collection`, read the way RFC 6578 describes (recommended, after T1)

A `sync-collection` answer lists each changed member by its href and ETag, and each removed
member with a 404 status. It need not carry the data, and Google's carries none. The source
would:
- keep the removed hrefs as `removed`, which the sync loop already turns into `reported`
  evidence (the path Nextcloud, Infomaniak and Cirrux calendars take today);
- fetch the changed members' data with `calendar-multiget` (RFC 4791 §7.9), a few at a time;
- keep the sync token, so a pass reads what changed instead of every event.

**Unverified at Google.** What Google returns has to be measured first (T1), on the owner's
test migration on the test environment, read-only and with their yes:
- one `sync-collection` with no token, and one with the token it returned;
- an event changed and one deleted in between;
- recorded as counts and status codes only. Google's hrefs carry the calendar's id, which for a
  person's main calendar is their address, so no href, title or address goes into a record.

If Google lists the deleted event as a 404, A is the reader. If it does not, B is.

**Built as `measure-google-sync`** (T1), a command of the worker's CLI that the owner runs once on
the test environment: `./deploy/compose/operator.sh measure-google-sync`
(`apps/worker/src/cli/measure-google-sync.ts`). Its REPORT asks for what the CalDAV source asks
for (`resourcetype`, `getetag`, `calendar-data`) and adds `sync-level` 1, which RFC 6578 puts in
every `sync-collection` and the source leaves out. Should Google refuse that with 400, it asks
once more without it, as the source does, and says so. A truncated answer (a 507 for the calendar)
is followed with its token. The verdict line is the rule above, with the changed event as the
control: when Google lists no change either, it says so rather than presenting that as a measured
B. A member with another status (a 410, say) is named, not counted as either.

#### How to run T1

On the test environment's host. The command needs a checkout of `main` that has it, the stack's
database and its `.env`; nothing deployed runs it, so the checkout is a folder of its own.

Before step 1, in Google Calendar, in the account the test migration copies from: have two events
made for this test, there before step 5 starts (make two, on any day, if there are none). The
command asks you to change one and delete the other.

1. `git -C ~/ownpace-managed fetch origin main`
2. `git -C ~/ownpace-managed worktree add --detach ~/ownpace-0164-t1 FETCH_HEAD`
3. `ln -s ~/ownpace-managed/deploy/compose/.env ~/ownpace-0164-t1/deploy/compose/.env`
4. `cd ~/ownpace-0164-t1 && pnpm install --frozen-lockfile`
5. `cd ~/ownpace-0164-t1 && ./deploy/compose/operator.sh measure-google-sync`

   It prints the migration it chose, by id and creation date: check that it is the test migration,
   whose page in Ownpace has that id at the end of its address (Ctrl-C stops it at any point, and
   nothing at Google has changed). It reads every calendar,
   then asks, in English and Dutch, for the change and the deletion. Make both at Google, come
   back, and press Enter. It reads every calendar again and ends with `Verdict:`. Send back all it
   printed: it is counts and status codes only.
6. `git -C ~/ownpace-managed worktree remove --force ~/ownpace-0164-t1`

   This removes the folder of steps 2 to 4 and nothing else; the `.env` the link points to stays.

### 3.2 B: the Google Calendar API

`events.list` with a sync token and `showDeleted=true` returns a deleted event with
`status: "cancelled"`. The sign-in already asks for `https://www.googleapis.com/auth/calendar`.
The Calendar API has to be turned on in the Google Cloud project, which is an owner step. It is a
second reader for Google beside CalDAV, with its own paging, quota and tests, so it costs more
than A.

### 3.3 C: confirm an absence with a `GET` (not recommended now)

When a whole listing stops naming a copied event, the source could ask for it by its href, and
take a 404 as the answer. This works for any server that only lists, but a 404 can also come from
a moved calendar or a changed href. That is weaker than a removal report, so it would be a new
kind of evidence, which gate (3) does not take today.

## 4. How a removal is then applied

### 4.1 By hand (exists)

With **Turn on deleting by hand** on, each removal on *Deleted on the old system* has its own
**Apply**. Once Google's removals are reported (T2), this works for them unchanged.

### 4.2 In bulk (proposed, T3)

An **Apply all** for the removals the page shows, with one confirmation that names how many it
will remove. Each item still goes through every gate on its own, so an edited copy or an adopted
one refuses that item and says why, and the rest go on. A breaker trip, deleting by hand turned
off, a removal the ledger could not record, or a press that did not answer stops the whole run.
ADR-0024's "per item" is read as "each item decided by itself"; an amendment says so in the
owner's words. Open, for the owner (F-B in the Status above): whether the bulk takes in only
`reported` rows, with `trashed` rows keeping their single press.

### 4.3 By itself (needs the rule changed, T4)

Hard rule 2 and ADR-0024 forbid it today, and only the owner can change that. If they do, the
proposal is:
- a switch per migration and per data type, off by default, beside **Turn on deleting by hand**;
- `reported` evidence only, and every other gate unchanged, the breaker per pass;
- a removal applied at the pass after the one that reported it, if the source still reports it
  gone;
- nothing after cutover, as today;
- each removal written to the audit log and shown on the Deletions page as done.

## 5. The decisions (T0)

Decided on 2026-11-21, each as advised (Status, 2026-11-21).

- **(a) The reader.** A, measured first (T1); B only if Google reports no removals through
  CalDAV. *Advice:* A. It also ends the whole listing on every pass.
- **(b) Bulk apply.** *Advice:* yes. It saves a click per item and keeps every gate.
- **(c) Removal by itself.** *Advice:* not in the first build. Build A and bulk apply, watch the
  reported removals on the test environment, then decide, with the safeguards of §4.3 written
  into hard rule 2 and ADR-0024.

## 6. The owner's test (T5)

On the test environment, in a migration from the owner's Google calendars:
1. A future event whose only guest is the owner's second address, copied.
2. Deleted at Google. After **Sync now**, it is on *Deleted on the old system*, as reported.
3. Applied (by hand, then once in bulk with another): the copy is gone at the target, and the
   guest gets no mail.
