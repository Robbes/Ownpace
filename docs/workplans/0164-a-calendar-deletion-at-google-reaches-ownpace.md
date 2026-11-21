# Workplan 0164 — A calendar deletion at Google reaches Ownpace

> **In one line:** An event deleted in a Google calendar during a migration reaches *Deleted on the old system* as a reported removal, so its copy can be removed through the gated path: by hand, as today; in bulk, with one confirmation; and by itself only if the owner changes the rule that forbids it.

## Status — 2026-11-21 (update this block at the end of every session)

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
| T2 The reader that reports removals | builder | 📋 **Decided**: A, as T1 showed | §3.1: `sync-collection` with the token kept; removed members as `reported`, changed ones read by `calendar-multiget` |
| T3 Apply in bulk | builder | 📋 **Decided** (T0 (b)), after T2 | §4.2. ADR-0024 amended |
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
will remove. Each item still goes through every gate on its own, so an edited copy, an adopted
one or a breaker trip refuses that item and says why, and the rest go on. ADR-0024's "per item"
is read as "each item decided by itself"; an amendment says so in the owner's words.

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
