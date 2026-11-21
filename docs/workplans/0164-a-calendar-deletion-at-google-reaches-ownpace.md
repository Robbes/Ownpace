# Workplan 0164 — A calendar deletion at Google reaches Ownpace

> **In one line:** An event deleted in a Google calendar during a migration reaches *Deleted on the old system* as a reported removal, so its copy can be removed through the gated path: by hand, as today; in bulk, with one confirmation; and by itself only if the owner changes the rule that forbids it.

## Status — 2026-11-21 (update this block at the end of every session)

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
| T1 What Google answers | builder | 📋 **Next** (T0 (d): yes) | §3.1. Read-only, on the owner's test migration on the test environment. Counts and status codes only |
| T2 The reader that reports removals | builder | 📋 **Proposed** | §3. A, or B if T1 shows Google reports no removals through CalDAV |
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
